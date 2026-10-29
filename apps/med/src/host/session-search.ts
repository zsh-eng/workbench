import { realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parseFoundThreadId, type FoundAgent, type SessionEntry } from "../shared/found-sessions";
import {
  HEAD_BYTES,
  codexDayFolders,
  folderNames as names,
  isRollout,
  readEdge,
  readHead,
  rolloutId,
  scanLines,
} from "./found-sessions";
import { userHome } from "./service/discover";

// `med thread find` and `med thread adopt` reach the Claude Code and Codex
// sessions of any age on this computer. The thread list shows only the recent
// ones in the registered repositories (found-sessions.ts). A search lists
// every transcript and reads its head once per change of the file; for Claude
// Code it also reads the end, where a title that the user sets later goes.
// Codex's archived sessions are in the search too.

/** Claude Code appends a title that the user sets, and its summaries. */
const TITLE_TAIL_BYTES = 64 * 1024;
/** Transcripts that a search reads at once. */
const READS = 16;
/** Sessions that the search keeps; it forgets all of them past this. */
const MAX_CACHED = 20_000;
/** The shortest start of an ID that names a session. */
const MIN_PREFIX = 6;

/** What a transcript says about its session, for a search. */
export interface SessionInfo {
  agent: FoundAgent;
  id: string;
  path: string;
  archived?: true;
  mtimeMs: number;
  createdAt: number;
  cwd?: string;
  /** Claude Code's custom title or agent name, or Codex's thread name. */
  name?: string;
  summary?: string;
  /** The first sentence of the first prompt, as a thread name. */
  prompt?: string;
  /** The first prompt, cut to 2000 characters. */
  text?: string;
  title: string;
  /** A Codex guardian review or subagent: its parent shows it. */
  automatic?: true;
}

type Listed = { agent: FoundAgent; path: string; id?: string; archived?: true };

const validId = (id: string | undefined): id is string => !!id && /^[A-Za-z0-9_-]{1,128}$/.test(id);

/** Every transcript: Claude Code's projects, and Codex's day folders and archive. */
async function listTranscripts(home: string) {
  const files: Listed[] = [];
  const projects = join(home, ".claude", "projects");
  for (const folder of await names(projects))
    for (const name of await names(join(projects, folder)))
      if (name.endsWith(".jsonl"))
        files.push({
          agent: "claude",
          path: join(projects, folder, name),
          id: basename(name, ".jsonl"),
        });
  for (const folder of await codexDayFolders(join(home, ".codex", "sessions")))
    for (const name of await names(folder))
      if (isRollout(name))
        files.push({ agent: "codex", path: join(folder, name), id: rolloutId(name) });
  const archived = join(home, ".codex", "archived_sessions");
  for (const name of await names(archived))
    if (isRollout(name))
      files.push({
        agent: "codex",
        path: join(archived, name),
        id: rolloutId(name),
        archived: true,
      });
  return files;
}

/** The transcript at a path, when it is one in the agents' folders. */
async function transcriptAt(path: string, home: string): Promise<Listed | undefined> {
  const real = await realpath(path).catch(() => undefined);
  if (!real) return undefined;
  const parts = (folder: string) => {
    const inside = relative(folder, real);
    return inside && !inside.split(sep).includes("..") ? inside.split(sep) : [];
  };
  for (const base of new Set([home, await realpath(home).catch(() => home)])) {
    const claude = parts(join(base, ".claude", "projects"));
    if (claude.length === 2 && claude[1]!.endsWith(".jsonl"))
      return { agent: "claude", path: real, id: basename(claude[1]!, ".jsonl") };
    const codex = parts(join(base, ".codex", "sessions"));
    if (codex.length === 4 && isRollout(codex[3]!))
      return { agent: "codex", path: real, id: rolloutId(codex[3]!) };
    const archived = parts(join(base, ".codex", "archived_sessions"));
    if (archived.length === 1 && isRollout(archived[0]!))
      return { agent: "codex", path: real, id: rolloutId(archived[0]!), archived: true };
  }
  return undefined;
}

async function readInfo(file: Listed, mtimeMs: number): Promise<SessionInfo | undefined> {
  const head = await readHead(file.agent, file.path);
  // A Codex rollout has its title in the session index; a long head is not needed.
  const first = scanLines(file.agent, head.lines, { early: file.agent === "codex" });
  const last =
    file.agent === "claude" && head.size > HEAD_BYTES
      ? scanLines("claude", (await readEdge(file.path, "tail", TITLE_TAIL_BYTES)).lines)
      : undefined;
  const id = file.agent === "codex" ? (first.id ?? file.id) : file.id;
  if (!validId(id)) return undefined;
  const cwd = last?.cwd ?? first.cwd;
  const name = last?.name ?? first.name;
  const summary = last?.summary ?? first.summary;
  return {
    agent: file.agent,
    id,
    path: file.path,
    ...(file.archived ? { archived: true as const } : {}),
    mtimeMs,
    createdAt: first.createdAt ?? mtimeMs,
    ...(cwd ? { cwd } : {}),
    ...(name ? { name } : {}),
    ...(summary ? { summary } : {}),
    ...(first.prompt ? { prompt: first.prompt } : {}),
    ...(first.text ? { text: first.text } : {}),
    title: name ?? summary ?? first.prompt ?? "Agent session",
    ...(first.source && first.source.kind !== "session" ? { automatic: true as const } : {}),
  };
}

/** A session for the API, with the thread that holds it and its repository. */
export function sessionEntry(
  info: SessionInfo,
  extra: { thread?: { id: string; archived?: boolean }; repository?: string } = {},
): SessionEntry {
  return {
    agent: info.agent,
    id: info.id,
    title: info.title,
    ...(info.text ? { prompt: info.text.replace(/\s+/g, " ").slice(0, 200) } : {}),
    ...(info.cwd ? { cwd: info.cwd } : {}),
    path: info.path,
    createdAt: new Date(info.createdAt).toISOString(),
    updatedAt: new Date(info.mtimeMs).toISOString(),
    ...(info.archived ? { archived: true } : {}),
    ...(extra.repository ? { repository: extra.repository } : {}),
    ...(extra.thread ? { thread: extra.thread } : {}),
  };
}

/**
 * Finds Claude Code and Codex sessions of any age: by words, for `med thread
 * find`, and by ID or path, for `med thread adopt`.
 */
export function createSessionSearch(options: {
  /** Codex Desktop's thread names, by session ID. */
  codexNames(): Promise<Map<string, string>>;
  /** Transcripts that are not threads: the forks that a question made. */
  excluded?(agent: FoundAgent, id: string): boolean;
  home?: () => string;
}) {
  const home = options.home ?? userHome;
  const cache = new Map<string, { mtimeMs: number; size: number; info?: SessionInfo }>();

  /** The sessions of these transcripts, newest first: one per session, from
   * its newest file, and only those with a prompt or a name. */
  const sessions = async (files: readonly Listed[]) => {
    const infos: SessionInfo[] = [];
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const file = files[next++]!;
        const info = await stat(file.path).catch(() => undefined);
        if (!info?.isFile()) continue;
        let known = cache.get(file.path);
        if (!known || known.mtimeMs !== info.mtimeMs || known.size !== info.size) {
          const read = await readInfo(file, info.mtimeMs).catch(() => undefined);
          known = { mtimeMs: info.mtimeMs, size: info.size, ...(read ? { info: read } : {}) };
          if (cache.size >= MAX_CACHED) cache.clear();
          cache.set(file.path, known);
        }
        if (known.info) infos.push(known.info);
      }
    };
    await Promise.all(Array.from({ length: READS }, worker));
    const codexNames = files.some((file) => file.agent === "codex")
      ? await options.codexNames().catch(() => new Map<string, string>())
      : new Map<string, string>();
    const newest = new Map<string, SessionInfo>();
    for (const info of infos) {
      if (options.excluded?.(info.agent, info.id)) continue;
      const name = (info.agent === "codex" && codexNames.get(info.id)) || info.name;
      // A session without a prompt or a name has done nothing to show.
      if (!info.prompt && !name) continue;
      const session = name ? { ...info, name, title: name } : info;
      const key = `${info.agent}:${info.id}`;
      const known = newest.get(key);
      if (!known || known.mtimeMs < session.mtimeMs) newest.set(key, session);
    }
    return [...newest.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  };

  return {
    /** Sessions whose title, first prompt, folder, or ID has each word of
     * `text`, ignoring case; newest first. No words lists the newest. */
    async find(text: string, limit = 20) {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const all = await sessions(await listTranscripts(home()));
      return all
        .filter((session) => {
          // Codex's guardian reviews and subagents show in their parents.
          if (session.automatic) return false;
          const haystack = [session.title, session.summary, session.text, session.cwd, session.id]
            .filter(Boolean)
            .join("\n")
            .toLowerCase();
          return words.every((word) => haystack.includes(word));
        })
        .slice(0, limit);
    },
    /**
     * The sessions that `input` names: the path of a transcript in the
     * agents' folders; `claude:<id>` or `codex:<id>`; a found thread's ID;
     * a session ID; or the start of one, of 6 characters or more. A full ID
     * wins over IDs that only start with it.
     */
    async lookup(input: string): Promise<SessionInfo[]> {
      const value = input.trim();
      if (value.includes("/") || value.endsWith(".jsonl")) {
        const file = await transcriptAt(value, home());
        return file ? sessions([file]) : [];
      }
      let agent: FoundAgent | undefined;
      let id = value;
      const found = parseFoundThreadId(value);
      const named = /^(claude|codex):(.+)$/.exec(value);
      if (found) ({ agent, id } = found);
      else if (named) [agent, id] = [named[1] as FoundAgent, named[2]!];
      if (!validId(id) || id.length < MIN_PREFIX) return [];
      const listed = (await listTranscripts(home())).filter(
        (file) => (!agent || file.agent === agent) && file.id?.startsWith(id),
      );
      const exact = listed.filter((file) => file.id === id);
      return sessions(exact.length ? exact : listed);
    },
    /** The sessions with these IDs, from one listing. */
    async exactly(wanted: readonly { agent: FoundAgent; id: string }[]): Promise<SessionInfo[]> {
      if (!wanted.length) return [];
      const keys = new Set(wanted.map(({ agent, id }) => `${agent}:${id}`));
      return sessions(
        (await listTranscripts(home())).filter((file) => keys.has(`${file.agent}:${file.id}`)),
      );
    },
  };
}
