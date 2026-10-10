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

/** Reads the complete lines from `offset`, and returns where the next read
 * starts and where the first line starts. */
async function readLines(path: string, offset: number, limit = Number.POSITIVE_INFINITY) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    if (size < offset)
      return { lines: [] as string[], next: size, first: size, truncated: false, reset: true };
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
    const first = truncated ? size - Buffer.byteLength(text) : start;
    return {
      lines: complete ? complete.split("\n") : [],
      next: first + consumed,
      first,
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
  /** The byte offset of the first view's first line; earlier pages end there. */
  start: number;
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
    if (!result) return { events: [] as SessionEvent[], truncated: false, first: 0 };
    source.offset = result.next;
    // A tail can start after a call. Its later updates still go to the
    // browser, which keeps them until an earlier page brings the call.
    const events = result.lines.flatMap((line) => source.line(line));
    return { events, truncated: result.truncated, first: result.first };
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
    start: first.first,
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

/** An earlier page reads at most this much before its end. */
const PAGE_BYTES = 4 * 1024 * 1024;

/**
 * The updates of the lines before byte offset `before`: a page that ends
 * where the first view or the page after it starts. Subagents that the page
 * starts come with it. `start` is where the next earlier page ends.
 */
export async function readTranscriptPage(
  session: Pick<AgentSession, "agent" | "id">,
  path: string,
  before: number,
) {
  const handle = await open(path, "r");
  let text: string;
  let start: number;
  try {
    const end = Math.min(Math.max(0, before), (await handle.stat()).size);
    start = Math.max(0, end - PAGE_BYTES);
    const buffer = Buffer.alloc(end - start);
    await handle.read(buffer, 0, buffer.length, start);
    text = buffer.toString("utf8");
    // A page starts inside a line unless it starts the file.
    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline < 0 ? "" : text.slice(newline + 1);
      start = end - Buffer.byteLength(text);
    }
  } finally {
    await handle.close();
  }
  const lines = text.split("\n").filter(Boolean);
  const events: SessionEvent[] = [];
  if (session.agent === "codex") {
    const reader = createCodexRolloutReader();
    for (const line of lines) events.push(...reader.line(line));
  } else {
    const subagents: [string, string][] = [];
    const reader = createClaudeTranscriptReader({
      onSubagent: (agentId, toolCallId) => subagents.push([agentId, toolCallId]),
    });
    for (const line of lines) events.push(...reader.line(line));
    for (const [agentId, toolCallId] of subagents) {
      const sub = join(dirname(path), session.id, "subagents", `agent-${agentId}.jsonl`);
      const read = await readLines(sub, 0, TAIL_BYTES).catch(() => undefined);
      if (!read) continue;
      const subReader = createClaudeTranscriptReader({ parentToolCallId: toolCallId });
      for (const line of read.lines) events.push(...subReader.line(line));
    }
  }
  return {
    events: events
      .sort((a, b) => a.at - b.at)
      .map((event) => ({ ...event, update: compactUpdate(event.update) })),
    start,
  };
}

/** A prompt in a transcript, for the turn index. */
export interface TranscriptTurn {
  /** The byte offset of the prompt's line. */
  offset: number;
  at: number;
  text: string;
}
const turnIndexes = new Map<
  string,
  { modifiedAt: number; scanned: number; turns: TranscriptTurn[] }
>();
/** Lines that can be a prompt: a user line that is not a tool result. */
const promptLine = (agent: AgentSession["agent"], line: string) =>
  agent === "codex"
    ? line.includes('"user_message"')
    : line.includes('"type":"user"') && !line.includes('"tool_result"');

/**
 * Each prompt in a transcript, with its byte offset. One scan reads the file
 * in pages; the index is kept and extended as the transcript grows.
 */
export async function transcriptTurns(
  session: Pick<AgentSession, "agent" | "id">,
  path: string,
): Promise<TranscriptTurn[]> {
  const info = await stat(path);
  let index = turnIndexes.get(path);
  if (!index || info.size < index.scanned) index = { modifiedAt: 0, scanned: 0, turns: [] };
  if (index.modifiedAt === info.mtimeMs) return index.turns;
  const handle = await open(path, "r");
  try {
    let offset = index.scanned;
    while (offset < info.size) {
      const length = Math.min(PAGE_BYTES, info.size - offset);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const end = buffer.lastIndexOf(10);
      // One line longer than a page: skip it whole.
      if (end < 0) {
        if (offset + length >= info.size) break;
        const next = await nextLine(handle, offset + length, info.size);
        offset = next;
        continue;
      }
      let lineStart = 0;
      while (lineStart <= end) {
        const lineEnd = buffer.indexOf(10, lineStart);
        const line = buffer.toString("utf8", lineStart, lineEnd);
        if (promptLine(session.agent, line)) {
          const reader =
            session.agent === "codex" ? createCodexRolloutReader() : createClaudeTranscriptReader();
          for (const event of reader.line(line)) {
            const update = event.update;
            if (update.sessionUpdate !== "user_message_chunk" || update.content.type !== "text")
              continue;
            const text = update.content.text.trim().split("\n")[0]!.slice(0, 160);
            // Commands and reminders that Claude Code writes as user lines are not prompts.
            if (text && !text.startsWith("<"))
              index.turns.push({ offset: offset + lineStart, at: event.at, text });
            break;
          }
        }
        lineStart = lineEnd + 1;
      }
      offset += end + 1;
    }
    index.scanned = offset;
    index.modifiedAt = info.mtimeMs;
    turnIndexes.set(path, index);
    return index.turns;
  } finally {
    await handle.close();
  }
}

/** The offset after the newline at or after `from`. */
async function nextLine(handle: Awaited<ReturnType<typeof open>>, from: number, size: number) {
  const buffer = Buffer.alloc(64 * 1024);
  let offset = from;
  while (offset < size) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline >= 0) return offset + newline + 1;
    offset += bytesRead;
  }
  return size;
}
