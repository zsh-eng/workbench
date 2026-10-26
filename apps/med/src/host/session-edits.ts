import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { execProgram } from "../shared/agent-session-codex";
import { commandWrites, type GeneratedKind, type Provenance } from "../shared/generated";
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
// A shell command that changes a file (sed -i, mv) is not an edit here. The
// shell commands are kept apart, for the generated files that they write
// (docs/GENERATED.md): Claude Code's Bash calls, and Codex's shell and exec
// commands.

/** The tools whose calls edit a file in Claude Code. */
const CLAUDE_EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** At most this many files are kept for a session; the oldest edits go first. */
const MAX_FILES = 5000;
/** At most this many shell commands are kept for a session; the oldest go first. */
const MAX_COMMANDS = 500;
/** Characters kept of each command. */
const MAX_COMMAND = 2000;
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
  /** Shell commands, in order. */
  commands: string[];
  order: number;
}

/** A shell command of a Codex call: the script of `bash -lc <script>`, or its words. */
function codexCommand(command: unknown): string | undefined {
  if (typeof command === "string") return command || undefined;
  if (!Array.isArray(command) || !command.every((part) => typeof part === "string")) return;
  const words = command as string[];
  if (words.length === 3 && /(?:^|\/)(?:ba|z)?sh$/.test(words[0]!) && /^-l?c$/.test(words[1]!))
    return words[2];
  return words.join(" ") || undefined;
}

/** The shell commands that one transcript line runs. */
function lineCommands(agent: EditSession["agent"], line: string): string[] {
  if (
    agent === "claude"
      ? !line.includes('"Bash"')
      : !line.includes('"function_call"') && !line.includes('"local_shell_call"')
  )
    return [];
  let entry: Json | undefined;
  try {
    entry = record(JSON.parse(line));
  } catch {
    return [];
  }
  if (agent === "claude") {
    const content = record(entry?.message)?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      const block = record(part);
      const command =
        block?.type === "tool_use" && block.name === "Bash" && record(block.input)?.command;
      return typeof command === "string" && command ? [command] : [];
    });
  }
  const payload = record(entry?.payload);
  if (entry?.type !== "response_item" || !payload) return [];
  if (payload.type === "local_shell_call") {
    const command = codexCommand(record(payload.action)?.command);
    return command ? [command] : [];
  }
  if (payload.type !== "function_call" || payload.name === "apply_patch") return [];
  let args: Json | undefined;
  try {
    args = record(JSON.parse(String(payload.arguments)));
  } catch {
    return [];
  }
  const command = codexCommand(args?.command) ?? codexCommand(args?.cmd);
  return command && !command.includes("*** Begin Patch") ? [command] : [];
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
      for (const line of bytes.toString("utf8", 0, end).split("\n")) {
        for (const file of lineFiles(agent, line, state)) {
          state.files.delete(file);
          state.files.set(file, state.order++);
          if (state.files.size > MAX_FILES) state.files.delete(state.files.keys().next().value!);
        }
        for (const command of lineCommands(agent, line)) {
          // A long command, such as one with a heredoc, keeps its start.
          state.commands.push(
            command.length > MAX_COMMAND ? command.slice(0, MAX_COMMAND) : command,
          );
          if (state.commands.length > MAX_COMMANDS) state.commands.shift();
        }
      }
    }
  } finally {
    await handle.close();
  }
}

export function createSessionEdits(options: { home?: () => string } = {}) {
  const home = options.home ?? userHome;
  const reads = new Map<string, Read>();
  const transcripts = new Map<string, string>();
  /** Real paths of the folders of edited files outside the checkout's path. */
  const folders = new Map<string, string>();
  /** Reads of one session that run; a second caller waits for the first. */
  const running = new Map<string, Promise<string[]>>();

  const transcript = async (session: EditSession) => {
    const key = `${session.agent}:${session.id}`;
    const known = transcripts.get(key);
    if (known && (await stat(known).then(Boolean, () => false))) return known;
    const path = await findTranscript(session, home());
    if (path) transcripts.set(key, path);
    return path;
  };

  const readFile = async (agent: EditSession["agent"], path: string) => {
    let state = reads.get(path);
    if (!state) {
      state = { offset: 0, rest: Buffer.alloc(0), files: new Map(), commands: [], order: 0 };
      if (reads.size > 256) reads.clear();
      reads.set(path, state);
    }
    await readMore(agent, path, state);
    return state;
  };

  /** The transcripts of a session: its own, and its Claude Code subagents'. */
  const states = async (session: EditSession): Promise<Read[]> => {
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
    return states;
  };

  /** Absolute paths, the last edit last; none for an unknown session. */
  const files = async (session: EditSession): Promise<string[]> => {
    const all = new Map<string, number>();
    for (const state of await states(session))
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

  /**
   * The session's edited files inside `checkout`, relative to it, the last
   * edit last. `real` is the checkout's real path, when a symbolic link
   * leads to it.
   */
  const paths = async (session: EditSession, checkout: string) => {
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
  };

  return {
    files: shared,
    paths,
    /**
     * For each generated file of `checkout`: whether one of the sessions
     * edited it with an edit tool (a hand edit), and the last of their shell
     * commands that writes such a file. A file with neither is left out.
     */
    async provenance(
      sessions: readonly EditSession[],
      checkout: string,
      files: readonly { path: string; kind: GeneratedKind; source?: string }[],
    ) {
      const edited = new Set<string>();
      const commands: string[] = [];
      for (const session of sessions) {
        for (const path of await paths(session, checkout)) edited.add(path);
        for (const state of await states(session)) commands.push(...state.commands);
      }
      const result: Record<string, Provenance> = {};
      for (const file of files) {
        let command: string | null = null;
        for (let index = commands.length - 1; index >= 0 && !command; index--)
          command = commandWrites(file, commands[index]!);
        if (edited.has(file.path) || command)
          result[file.path] = {
            ...(edited.has(file.path) && { edited: true }),
            ...(command && { command }),
          };
      }
      return result;
    },
  };
}
