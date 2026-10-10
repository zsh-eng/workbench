import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SessionEvent, SessionUpdate, ToolCallContent } from "../shared/agent-session";
import { createClaudeTranscriptReader } from "../shared/agent-session-claude";
import { createCodexRolloutReader } from "../shared/agent-session-codex";
import type { AgentSession } from "../shared/saved-review";
import { userHome } from "./service/discover";

/** The first view reads at most this much of the end of a transcript. Claude
 * Code transcripts of long sessions reach hundreds of megabytes. */
export const TAIL_BYTES = 8 * 1024 * 1024;
/** Limits for one update on the wire; larger output is cut. */
const MAX_TEXT = 64 * 1024;
const MAX_DIFF = 512 * 1024;
const MAX_IMAGE = 512 * 1024;
/** How often a followed transcript is checked for new lines. */
const POLL_MS = 400;

/** Claude Code keeps each session in ~/.claude/projects/<project>/<id>.jsonl. */
async function claudeTranscript(id: string, home: string) {
  const projects = join(home, ".claude", "projects");
  let entries: string[];
  try {
    entries = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const project of entries) {
    const path = join(projects, project, `${id}.jsonl`);
    if (
      await stat(path).then(
        (info) => info.isFile(),
        () => false,
      )
    )
      return path;
  }
  return undefined;
}

/** Codex keeps sessions in ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl.
 * Newer days are searched first, and only a bounded number of them. */
async function codexTranscript(id: string, home: string) {
  const root = join(home, ".codex", "sessions");
  const sorted = async (path: string) => {
    try {
      return (await readdir(path)).sort().reverse();
    } catch {
      return [];
    }
  };
  let days = 0;
  for (const year of await sorted(root))
    for (const month of await sorted(join(root, year)))
      for (const day of await sorted(join(root, year, month))) {
        if (++days > 400) return undefined;
        const folder = join(root, year, month, day);
        const file = (await sorted(folder)).find((name) => name.endsWith(`${id}.jsonl`));
        if (file) return join(folder, file);
      }
  return undefined;
}

/** The transcript file of an agent session, if it is on this computer. */
export function findTranscript(session: Pick<AgentSession, "agent" | "id">, home = userHome()) {
  return session.agent === "claude"
    ? claudeTranscript(session.id, home)
    : codexTranscript(session.id, home);
}

const cut = (value: string, limit: number) =>
  value.length > limit
    ? `${value.slice(0, limit)}\n… ${value.length - limit} more characters`
    : value;

/** Keeps updates small for the browser: no raw tool output, cut text, and no huge diffs or images. */
export function compactUpdate(update: SessionUpdate): SessionUpdate {
  if (update.sessionUpdate !== "tool_call" && update.sessionUpdate !== "tool_call_update")
    return update;
  const { rawOutput: _output, rawInput, ...rest } = update;
  const input = rawInput as Record<string, unknown> | undefined;
  // The thread shows a command; other input stays on this computer.
  const command = typeof input?.command === "string" ? cut(input.command, MAX_TEXT) : undefined;
  const content = update.content?.map((part): ToolCallContent => {
    if (part.type === "diff") {
      if ((part.oldText?.length ?? 0) + part.newText.length <= MAX_DIFF) return part;
      return {
        type: "content",
        content: {
          type: "text",
          text: `${basename(part.path)}: the diff is too large to show here.`,
        },
      };
    }
    if (part.type !== "content") return part;
    if (part.content.type === "text")
      return { ...part, content: { ...part.content, text: cut(part.content.text, MAX_TEXT) } };
    if (part.content.type === "image" && part.content.data.length > MAX_IMAGE)
      return {
        type: "content",
        content: { type: "text", text: "An image too large to show here." },
      };
    return part;
  });
  return {
    ...rest,
    ...(command ? { rawInput: { command } } : {}),
    ...(content ? { content } : {}),
  } as SessionUpdate;
}

/** Reads the complete lines from `offset`, and returns where the next read starts. */
async function readLines(path: string, offset: number, limit = Number.POSITIVE_INFINITY) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size < offset) return { lines: [] as string[], next: size, truncated: false, reset: true };
    let start = offset;
    let truncated = false;
    if (size - start > limit) {
      start = size - limit;
      truncated = true;
    }
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let text = buffer.toString("utf8");
    // A tail starts inside a line; skip to the next one.
    if (truncated) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "" : text.slice(newline + 1);
    }
    const end = text.lastIndexOf("\n");
    const complete = end < 0 ? "" : text.slice(0, end);
    const consumed = end < 0 ? 0 : Buffer.byteLength(text.slice(0, end + 1));
    return {
      lines: complete ? complete.split("\n") : [],
      next: truncated ? size - Buffer.byteLength(text) + consumed : start + consumed,
      truncated,
      reset: false,
    };
  } finally {
    await handle.close();
  }
}

/** The tail that tells whether a turn is open. */
const STATUS_TAIL_BYTES = 256 * 1024;

/** Whether the session's last turn has ended, from its transcript's tail. */
export async function transcriptIdle(session: Pick<AgentSession, "agent" | "id">, path: string) {
  const { lines } = await readLines(path, 0, STATUS_TAIL_BYTES);
  const reader =
    session.agent === "codex" ? createCodexRolloutReader() : createClaudeTranscriptReader();
  for (const line of lines) reader.line(line);
  return reader.idle();
}

export interface TranscriptFeed {
  /** The first view: the updates in the transcript's tail. */
  events: SessionEvent[];
  /** Earlier lines that the first view leaves out. */
  truncated: boolean;
  idle: boolean;
  modifiedAt: number;
}

/**
 * Reads a session's transcript and follows it. `onFeed` gets the first view
 * once, then `onEvents` gets new updates as the agent writes them, including
 * updates from the transcripts of subagents the session starts.
 */
export async function followTranscript(
  session: Pick<AgentSession, "agent" | "id">,
  path: string,
  handlers: {
    onFeed(feed: TranscriptFeed): void;
    onEvents(events: SessionEvent[], state: { idle: boolean; modifiedAt: number }): void;
  },
  signal: AbortSignal,
) {
  type Source = {
    path: string;
    offset: number;
    line(raw: string): SessionEvent[];
    idle?: () => boolean;
  };
  const sources: Source[] = [];
  const known = new Set<string>();
  // A tail can start after a call; its later updates have nothing to update.
  const keep = (event: SessionEvent) => {
    const update = event.update;
    if (update.sessionUpdate === "tool_call") known.add(update.toolCallId);
    if (update.sessionUpdate === "tool_call_update" && !known.has(update.toolCallId)) return false;
    return true;
  };
  const pending: Source[] = [];
  const subagents = join(dirname(path), session.id, "subagents");
  const addSource = (file: string, parentToolCallId?: string) => {
    if (session.agent === "codex") {
      const reader = createCodexRolloutReader();
      return { path: file, offset: 0, line: reader.line, idle: reader.idle };
    }
    const reader = createClaudeTranscriptReader({
      ...(parentToolCallId ? { parentToolCallId } : {}),
      onSubagent: (agentId, toolCallId) => {
        const sub = join(subagents, `agent-${agentId}.jsonl`);
        if (
          !sources.some((source) => source.path === sub) &&
          !pending.some((source) => source.path === sub)
        )
          pending.push(addSource(sub, toolCallId));
      },
    });
    return {
      path: file,
      offset: 0,
      line: reader.line,
      ...(parentToolCallId ? {} : { idle: reader.idle }),
    };
  };
  const main = addSource(path);
  sources.push(main);

  const read = async (source: Source, limit?: number) => {
    const result = await readLines(source.path, source.offset, limit).catch(() => undefined);
    if (!result) return { events: [] as SessionEvent[], truncated: false };
    source.offset = result.next;
    const events = result.lines.flatMap((line) => source.line(line)).filter(keep);
    return { events, truncated: result.truncated };
  };
  const drain = async () => {
    const events: SessionEvent[] = [];
    while (pending.length) {
      const source = pending.shift()!;
      sources.push(source);
      events.push(...(await read(source)).events);
    }
    return events;
  };
  const modified = async () => (await stat(path).catch(() => undefined))?.mtimeMs ?? 0;

  const first = await read(main, TAIL_BYTES);
  const events = [...first.events, ...(await drain())].sort((a, b) => a.at - b.at);
  handlers.onFeed({
    events: events.map((event) => ({ ...event, update: compactUpdate(event.update) })),
    truncated: first.truncated,
    idle: main.idle?.() ?? true,
    modifiedAt: await modified(),
  });

  let lastModified = 0;
  while (!signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    if (signal.aborted) break;
    const next: SessionEvent[] = [];
    for (const source of [...sources]) next.push(...(await read(source)).events);
    next.push(...(await drain()));
    const modifiedAt = await modified();
    if (next.length || modifiedAt !== lastModified)
      handlers.onEvents(
        next
          .sort((a, b) => a.at - b.at)
          .map((event) => ({ ...event, update: compactUpdate(event.update) })),
        { idle: main.idle?.() ?? true, modifiedAt },
      );
    lastModified = modifiedAt;
  }
}
