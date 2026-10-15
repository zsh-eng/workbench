import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentSession } from "../shared/saved-review";
import type { ThreadSubagent } from "../shared/threads";
import { findTranscript, transcriptTurn } from "./agent-transcripts";

// The subagents of a tab's session, for the sidebar. Claude Code writes each
// subagent's transcript beside the session's own:
//
//   ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl
//   ~/.claude/projects/<project>/<session>/subagents/agent-<id>.meta.json
//
// The meta file names the subagent's task (`description`) and the tool call
// that started it (`toolUseId`), which is the subagent's tab in the Session
// pane. A transcript is read again only when it changes. Codex rollouts have
// no subagent transcripts, so a Codex thread lists none.

/** Subagents that changed within this time are listed; older ones are done. */
const RECENT_MS = 24 * 60 * 60 * 1000;
/** At most this many, the newest first. */
const MAX_LISTED = 8;
/** A turn whose transcript has not changed for this long has stopped. */
const STALE_MS = 5 * 60_000;

interface Read {
  mtimeMs: number;
  size: number;
  idle: boolean;
  activity?: string;
}

/** Reads the subagents of sessions, with caches for paths and transcripts. */
export function createThreadSubagents(options: { now?: () => number; home?: () => string } = {}) {
  const now = options.now ?? Date.now;
  const paths = new Map<string, string | null>();
  const reads = new Map<string, Read>();
  const metas = new Map<string, { description?: string; toolUseId?: string }>();

  const meta = async (path: string) => {
    let known = metas.get(path);
    if (!known) {
      try {
        const data = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        known = {
          ...(typeof data.description === "string" && { description: data.description }),
          ...(typeof data.toolUseId === "string" && { toolUseId: data.toolUseId }),
        };
      } catch {
        known = {};
      }
      if (metas.size > 1024) metas.clear();
      metas.set(path, known);
    }
    return known;
  };

  const read = async (path: string, id: string, info: { mtimeMs: number; size: number }) => {
    const known = reads.get(path);
    if (known?.mtimeMs === info.mtimeMs && known.size === info.size) return known;
    const { idle, turn } = await transcriptTurn({ agent: "claude", id }, path).catch(() => ({
      idle: true,
      turn: undefined,
    }));
    const next: Read = {
      ...info,
      idle,
      ...(turn?.activity && { activity: turn.activity }),
    };
    if (reads.size > 1024) reads.clear();
    reads.set(path, next);
    return next;
  };

  return {
    /** The subagents of a session, newest first. */
    async of(session: AgentSession): Promise<ThreadSubagent[]> {
      if (session.agent !== "claude") return [];
      let transcript = paths.get(session.id);
      if (transcript === undefined) {
        transcript = (await findTranscript(session, options.home?.())) ?? null;
        if (paths.size > 512) paths.clear();
        // A session without a transcript yet is looked for again later.
        if (transcript) paths.set(session.id, transcript);
      }
      if (!transcript) return [];
      const folder = join(dirname(transcript), session.id, "subagents");
      const names = await readdir(folder).catch(() => [] as string[]);
      const time = now();
      const files = (
        await Promise.all(
          names.flatMap((name) => {
            const id = /^agent-([\w-]{1,128})\.jsonl$/.exec(name)?.[1];
            if (!id) return [];
            return [
              stat(join(folder, name)).then(
                (info) => ({
                  id,
                  path: join(folder, name),
                  mtimeMs: info.mtimeMs,
                  size: info.size,
                }),
                () => undefined,
              ),
            ];
          }),
        )
      )
        .filter((file) => !!file && time - file.mtimeMs < RECENT_MS)
        .sort((a, b) => b!.mtimeMs - a!.mtimeMs)
        .slice(0, MAX_LISTED);
      return Promise.all(
        files.map(async (file) => {
          const { id, path, mtimeMs, size } = file!;
          const [state, about] = await Promise.all([
            read(path, id, { mtimeMs, size }),
            meta(join(folder, `agent-${id}.meta.json`)),
          ]);
          const working = !state.idle && time - mtimeMs < STALE_MS;
          return {
            id: about.toolUseId ?? `agent-${id}`,
            description: (about.description ?? "Subagent").slice(0, 200),
            state: working ? ("working" as const) : ("idle" as const),
            ...(working && state.activity ? { activity: state.activity } : {}),
            updatedAt: mtimeMs,
          };
        }),
      );
    },
  };
}
