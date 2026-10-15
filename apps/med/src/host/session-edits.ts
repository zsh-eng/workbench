import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execProgram } from "../shared/agent-session-codex";
import type { EditSession } from "../shared/protocol";
import { findTranscript } from "./agent-transcripts";
import { userHome } from "./service/discover";

// The files that an agent session edited, from its transcript. Changes uses
// them for "Only this session's files" in a checkout that several sessions
// share. Each transcript is read once: a later call reads only the lines
// that the agent wrote since.
//
// - Claude Code: the `file_path` (or `notebook_path`) of Edit, Write,
//   MultiEdit, and NotebookEdit calls, also in the session's subagents.
// - Codex: the files of `apply_patch` calls, also in a shell command or an
//   exec program, relative to the turn's directory.
//
// A shell command that changes a file (sed -i, mv) is not an edit here.

/** The tools whose calls edit a file in Claude Code. */
const CLAUDE_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** At most this many files are kept for a session; the oldest edits go first. */
const MAX_FILES = 5000;
const CHUNK = 4 * 1024 * 1024;

type Json = Record<string, unknown>;
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/** The files of an apply_patch text: added, updated, deleted, and moved to. */
export function patchFiles(patch: string) {
  return [...patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)].map(
    (match) => match[1]!.trim(),
  );
}

/** One transcript, read up to `offset`. */
interface Read {
  offset: number;
  /** A line that the agent has not finished writing. */
  rest: Buffer;
  /** The directory that relative paths start from (Codex's turn). */
  cwd?: string;
  /** Absolute paths, in the order of their last edit. */
  files: Map<string, number>;
  order: number;
}

/** The edited files that one transcript line names, as absolute paths. */
function lineFiles(agent: EditSession["agent"], line: string, state: Read): string[] {
  // Most lines edit nothing; skip their parse.
  if (agent === "claude" ? !line.includes('"tool_use"') : !line.includes("Begin Patch"))
    return agent === "codex" && line.includes('"cwd"') ? (codexCwd(line, state), []) : [];
  let entry: Json | undefined;
  try {
    entry = record(JSON.parse(line));
  } catch {
    return [];
  }
  if (!entry) return [];
  if (agent === "claude") {
    const cwd = text(entry.cwd);
    const content = record(entry.message)?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      const block = record(part);
      if (block?.type !== "tool_use" || !CLAUDE_EDITS.has(String(block.name))) return [];
      const input = record(block.input);
      const path = text(input?.file_path) ?? text(input?.notebook_path);
      return path ? [isAbsolute(path) ? path : resolve(cwd ?? "/", path)] : [];
    });
  }
  const payload = record(entry.payload);
  if (entry.type === "turn_context" || entry.type === "session_meta") {
    state.cwd = text(payload?.cwd) ?? state.cwd;
    return [];
  }
  if (entry.type !== "response_item" || !payload) return [];
  const patches: string[] = [];
  let workdir: string | undefined;
  const take = (value: unknown) => {
    const body = text(value);
    if (body?.includes("*** Begin Patch")) patches.push(body);
  };
  if (payload.type === "custom_tool_call") take(payload.input);
  if (payload.type === "function_call") {
    let args: Json | undefined;
    try {
      args = record(JSON.parse(String(payload.arguments)));
    } catch {
      take(payload.arguments);
    }
    workdir = text(args?.workdir);
    if (payload.name === "exec" && typeof args?.input === "string")
      patches.push(...execProgram(args.input).patches);
    else {
      take(args?.input);
      take(args?.cmd);
      const command = args?.command;
      if (Array.isArray(command)) for (const part of command) take(part);
      else take(command);
    }
  }
  if (payload.type === "local_shell_call") {
    const action = record(payload.action);
    workdir = text(action?.working_directory);
    const command = action?.command;
    if (Array.isArray(command)) for (const part of command) take(part);
  }
  const from = workdir ? resolve(state.cwd ?? "/", workdir) : (state.cwd ?? "/");
  return patches.flatMap(patchFiles).map((path) => (isAbsolute(path) ? path : resolve(from, path)));
}

/** A Codex line that names the turn's directory. */
function codexCwd(line: string, state: Read) {
  try {
    const entry = record(JSON.parse(line));
    if (entry?.type === "turn_context" || entry?.type === "session_meta")
      state.cwd = text(record(entry.payload)?.cwd) ?? state.cwd;
  } catch {
    /* Not a line to read. */
  }
}

/** Reads the lines that a transcript gained since the last read. */
async function readMore(agent: EditSession["agent"], path: string, state: Read) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    // A file that got shorter is a new file: read it again.
    if (size < state.offset) Object.assign(state, { offset: 0, rest: Buffer.alloc(0) });
    while (state.offset < size) {
      const length = Math.min(CHUNK, size - state.offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset);
      if (!bytesRead) break;
      state.offset += bytesRead;
      const bytes = Buffer.concat([state.rest, buffer.subarray(0, bytesRead)]);
      const end = bytes.lastIndexOf(10);
      state.rest = Buffer.from(end < 0 ? bytes : bytes.subarray(end + 1));
      if (end < 0) continue;
      for (const line of bytes.toString("utf8", 0, end).split("\n"))
        for (const file of lineFiles(agent, line, state)) {
          state.files.delete(file);
          state.files.set(file, state.order++);
          if (state.files.size > MAX_FILES) state.files.delete(state.files.keys().next().value!);
        }
    }
  } finally {
    await handle.close();
  }
}

export function createSessionEdits(options: { home?: () => string } = {}) {
  const home = options.home ?? userHome;
  const reads = new Map<string, Read>();
  const paths = new Map<string, string>();
  /** Real paths of the folders of edited files outside the checkout's path. */
  const folders = new Map<string, string>();
  /** Reads of one session that run; a second caller waits for the first. */
  const running = new Map<string, Promise<string[]>>();

  const transcript = async (session: EditSession) => {
    const key = `${session.agent}:${session.id}`;
    const known = paths.get(key);
    if (known && (await stat(known).then(Boolean, () => false))) return known;
    const path = await findTranscript(session, home());
    if (path) paths.set(key, path);
    return path;
  };

  const readFile = async (agent: EditSession["agent"], path: string) => {
    let state = reads.get(path);
    if (!state) {
      state = { offset: 0, rest: Buffer.alloc(0), files: new Map(), order: 0 };
      if (reads.size > 256) reads.clear();
      reads.set(path, state);
    }
    await readMore(agent, path, state);
    return state;
  };

  /** Absolute paths, the last edit last; none for an unknown session. */
  const files = async (session: EditSession): Promise<string[]> => {
    const path = await transcript(session);
    if (!path) return [];
    const states = [await readFile(session.agent, path)];
    // Claude Code's subagents edit for the session.
    if (session.agent === "claude") {
      const folder = join(dirname(path), session.id, "subagents");
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const name of names.filter((entry) => entry.endsWith(".jsonl")))
        states.push(await readFile("claude", join(folder, name)));
    }
    const all = new Map<string, number>();
    for (const state of states)
      for (const [file, order] of state.files) all.set(file, Math.max(all.get(file) ?? 0, order));
    return [...all].sort((a, b) => a[1] - b[1]).map(([file]) => file);
  };

  const shared = (session: EditSession) => {
    const key = `${session.agent}:${session.id}`;
    let read = running.get(key);
    if (!read) {
      read = files(session).finally(() => running.delete(key));
      running.set(key, read);
    }
    return read;
  };
  const inside = (file: string, root: string) => {
    const rel = relative(root, file);
    return rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel : undefined;
  };

  return {
    files: shared,
    /**
     * The session's edited files inside `checkout`, relative to it, the last
     * edit last. `real` is the checkout's real path, when a symbolic link
     * leads to it.
     */
    async paths(session: EditSession, checkout: string) {
      const roots = [checkout, await realpath(checkout).catch(() => checkout)];
      const found = new Set<string>();
      for (const file of await shared(session)) {
        let rel = roots.map((root) => inside(file, root)).find(Boolean);
        // A path under a symbolic link, such as /tmp, has another real path.
        if (!rel) {
          const folder = dirname(file);
          let known = folders.get(folder);
          if (known === undefined) {
            known = await realpath(folder).catch(() => "");
            if (folders.size > 1024) folders.clear();
            folders.set(folder, known);
          }
          if (known)
            rel = roots.map((root) => inside(join(known!, basename(file)), root)).find(Boolean);
        }
        if (rel) found.add(rel.split(sep).join("/"));
      }
      return [...found];
    },
  };
}
