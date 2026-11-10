import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createClaudeTranscriptReader } from "../shared/agent-session-claude";
import {
  createCodexRolloutReader,
  rolloutSource,
  type RolloutSource,
} from "../shared/agent-session-codex";
import {
  FOUND_DAYS,
  foundSettingsSchema,
  type FoundAgent,
  type FoundSettings,
  type FoundUpdate,
} from "../shared/found-sessions";
import type { RegisteredRepository } from "../shared/protocol";
import type { SessionEvent } from "../shared/agent-session";
import type { ThreadTurn } from "../shared/agent-status";
import { sessionKey, threadTitle } from "../shared/threads";
import { findTranscript } from "./agent-transcripts";
import { summarizeTurn } from "./thread-turns";
import { userHome } from "./service/discover";

// Every agent session that Med lists, from its transcript: the sessions that
// Med runs or keeps, and the ones it finds by itself because they worked in a
// registered repository lately. A session is not tied to the folder it
// started in: the index keeps the folders it worked in, and its place is the
// newest of them that is in a registered checkout. Transcripts are at
//
//
//   ~/.claude/projects/<cwd with each character other than A–Z, a–z, 0–9, and - as ->/<id>.jsonl
//   ~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl
//
// A scan reads directory listings and file sizes, and reads a transcript's
// head and tail only when the file changed. The thread list never waits for a
// scan: it takes the last one and starts the next when that one is old.
// Sessions of any age are for `med thread find` and `adopt` (session-search.ts).

const DAY = 24 * 60 * 60 * 1000;
/** Sessions whose transcript changed within this time are listed: the one
 * discovery window, for Claude Code and Codex. */
const WINDOW_MS = FOUND_DAYS * DAY;
/** Codex files a rollout under the day its session started. A scan lists the
 * day folders of the window, and the older folders that held a rollout in the
 * window at the last full listing; a full listing runs this often. */
const CODEX_ALL_MS = 60_000;
/** At most this many found sessions show; the newest stay. */
const MAX_FOUND = 40;
/** At most this many transcripts are read in one scan, newest first. */
const MAX_READS = 120;
/** The thread list starts a new scan when the last one is this old. */
const SCAN_MS = 3000;
/** Worktrees of the registered repositories are read again this often, so a
 * session in a new worktree shows; and sooner when a session names a
 * checkout that the registry does not know. */
const WORKTREES_MS = 60_000;
const WORKTREES_SOON_MS = 10_000;
/** The head of a transcript gives its directory, start, and first prompt. */
export const HEAD_BYTES = 64 * 1024;
/** Codex's first line holds its instructions and can be long. */
const META_BYTES = 1024 * 1024;
/** The tail gives the turn's state, the latest title, and the directories. */
const TAIL_BYTES = 256 * 1024;
/** A turn whose transcript has not changed for this long has stopped. */
export const STALE_MS = 5 * 60_000;
/** The folders that the index keeps of a session, the newest last. */
const MAX_FOLDERS = 8;

type Json = Record<string, unknown>;
const record = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
const parse = (line: string) => {
  try {
    return record(JSON.parse(line));
  } catch {
    return undefined;
  }
};

/** Claude Code names a project folder after its working directory. */
export const claudeProjectFolder = (cwd: string) => cwd.replace(/[^A-Za-z0-9-]/g, "-");

/** The session ID in a Codex rollout's file name. */
export const rolloutId = (name: string) =>
  /([0-9a-f]{8}-[0-9a-f-]{27})$/i.exec(basename(name, ".jsonl"))?.[1];

/** The complete lines of a file's first `bytes`, or of its last `bytes`. */
export async function readEdge(path: string, edge: "head" | "tail", bytes: number) {
  const handle = await open(path, "r");
  try {
    const { size } = await handle.stat();
    const start = edge === "tail" ? Math.max(0, size - bytes) : 0;
    const length = Math.min(bytes, size - start);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    // A tail starts inside a line, and a head ends inside one.
    const from = start > 0 ? buffer.indexOf(10) + 1 : 0;
    const end = buffer.lastIndexOf(10);
    const lines = end >= from ? buffer.toString("utf8", from, end).split("\n") : [];
    return { lines, size };
  } finally {
    await handle.close();
  }
}

/** What a transcript says about its session. */
interface SessionFile {
  agent: FoundAgent;
  id: string;
  path: string;
  mtimeMs: number;
  size: number;
  /** The folder it works in now. */
  cwd?: string;
  /** The folders it worked in, the newest last. */
  cwds: string[];
  createdAt: number;
  /** The user's first prompt, through `threadTitle`. */
  prompt?: string;
  /** Claude Code's custom title or agent name, or Codex's thread name. */
  name?: string;
  summary?: string;
  idle: boolean;
  /** The last turn, from the tail (thread-turns.ts). */
  turn?: ThreadTurn;
  /** Codex's own threads: a guardian review or a subagent, which its
   * parent's thread shows. Found sessions and search leave them out. */
  automatic?: RolloutSource["kind"];
}

/** A transcript's head: its first 64 KB, or for a Codex rollout whose first
 * line is longer, its first 1 MB. */
export const readHead = (agent: FoundAgent, path: string) =>
  readEdge(path, "head", HEAD_BYTES).then(async (read) =>
    agent === "codex" && read.lines.length === 0 && read.size > HEAD_BYTES
      ? readEdge(path, "head", META_BYTES)
      : read,
  );

/** Each title the lines give, the last one first, and the directory; with
 * `turn`, also what the last turn does or said. With `early`, it stops at the
 * first prompt once it has the directory (and a Codex session's ID). `text`
 * is the first prompt, cut to 2000 characters. */
export function scanLines(
  agent: FoundAgent,
  lines: readonly string[],
  { turn = false, early = false }: { turn?: boolean; early?: boolean } = {},
) {
  const reader = agent === "codex" ? createCodexRolloutReader() : createClaudeTranscriptReader();
  const cwds: string[] = [];
  const found: {
    cwd?: string;
    createdAt?: number;
    prompt?: string;
    text?: string;
    name?: string;
    summary?: string;
    id?: string;
    source?: RolloutSource;
  } = {};
  const updates: SessionEvent[] = [];
  for (const line of lines) {
    if (early && found.prompt && found.cwd && (agent === "claude" || found.id)) break;
    const entry = parse(line);
    if (!entry) continue;
    const payload = record(entry.payload);
    const cwd =
      agent === "codex"
        ? entry.type === "session_meta" || entry.type === "turn_context"
          ? text(payload?.cwd)
          : undefined
        : text(entry.cwd);
    if (cwd) {
      found.cwd = cwd;
      if (cwds.at(-1) !== cwd) {
        const at = cwds.indexOf(cwd);
        if (at >= 0) cwds.splice(at, 1);
        cwds.push(cwd);
      }
    }
    const at = Date.parse(text(entry.timestamp) ?? "");
    if (!Number.isNaN(at)) found.createdAt ??= at;
    if (agent === "codex" && entry.type === "session_meta") {
      found.id ??= text(payload?.id);
      found.source ??= rolloutSource(payload);
    }
    if (entry.type === "custom-title") found.name = text(entry.customTitle) ?? found.name;
    if (entry.type === "agent-name" && !found.name) found.name = text(entry.agentName);
    if (entry.type === "summary") found.summary = text(entry.summary) ?? found.summary;
    // The reader sees every line, so it knows whether the turn has ended.
    const events = reader.line(line);
    if (turn) updates.push(...events);
    if (found.prompt) continue;
    for (const event of events) {
      const update = event.update;
      if (update.sessionUpdate !== "user_message_chunk" || update.content.type !== "text") continue;
      const prompt = update.content.text.trim();
      // Commands and reminders that agents write as user lines are not
      // prompts. A prompt's first sentence names its task best.
      if (prompt && !prompt.startsWith("<")) {
        found.prompt = threadTitle(/^(.{16,}?)[.!?](?:\s|$)/.exec(prompt)?.[1] ?? prompt);
        found.text = prompt.slice(0, 2000);
      }
      break;
    }
  }
  const idle = reader.idle();
  return { ...found, cwds, idle, ...(turn && { turn: summarizeTurn(updates, idle) }) };
}

async function readSession(
  agent: FoundAgent,
  path: string,
  info: { mtimeMs: number; size: number },
  known?: SessionFile,
): Promise<SessionFile | undefined> {
  // The head does not change once it has its prompt, or once the file is
  // longer than the head; a new session reads it again until then.
  const headDone = known && (known.prompt || known.size > HEAD_BYTES);
  const head = headDone ? undefined : await readHead(agent, path);
  const first = head ? scanLines(agent, head.lines) : undefined;
  const tail = scanLines(agent, (await readEdge(path, "tail", TAIL_BYTES)).lines, { turn: true });
  const id =
    agent === "claude" ? basename(path, ".jsonl") : (first?.id ?? known?.id ?? rolloutId(path));
  if (!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return undefined;
  const cwd = tail.cwd ?? first?.cwd ?? known?.cwd;
  const cwds = [...(known?.cwds ?? []), ...(first?.cwds ?? []), ...tail.cwds].reduce<string[]>(
    (all, folder) => [...all.filter((other) => other !== folder), folder],
    [],
  );
  const source = first?.source?.kind ?? known?.automatic;
  return {
    agent,
    id,
    path,
    ...(source && source !== "session" ? { automatic: source } : {}),
    mtimeMs: info.mtimeMs,
    size: info.size,
    ...(cwd ? { cwd } : {}),
    cwds: cwds.slice(-MAX_FOLDERS),
    createdAt: first?.createdAt ?? known?.createdAt ?? info.mtimeMs,
    ...((first?.prompt ?? known?.prompt) ? { prompt: first?.prompt ?? known?.prompt } : {}),
    ...((tail.name ?? first?.name ?? known?.name)
      ? { name: tail.name ?? first?.name ?? known?.name }
      : {}),
    ...((tail.summary ?? first?.summary ?? known?.summary)
      ? { summary: tail.summary ?? first?.summary ?? known?.summary }
      : {}),
    // A tail that starts in a turn has seen its prompt only when it is short.
    idle: tail.idle,
    ...(tail.turn && { turn: tail.turn }),
  };
}

/** A registered checkout: a repository's own, or one of its worktrees. */
export interface Checkout {
  path: string;
  repository: { id: string; name: string; path: string };
  branch?: string;
  linked: boolean;
}

/** The registered checkouts: each repository's and its worktrees. */
function checkoutsOf(repositories: readonly RegisteredRepository[]) {
  const checkouts = new Map<string, Checkout>();
  for (const repository of repositories) {
    const owner = { id: repository.id, name: repository.name, path: repository.path };
    for (const tree of repository.worktrees)
      if (!tree.bare)
        checkouts.set(tree.path, {
          path: tree.path,
          repository: owner,
          ...(tree.branch ? { branch: tree.branch } : {}),
          linked: !!tree.linked,
        });
    if (!checkouts.has(repository.path))
      checkouts.set(repository.path, { path: repository.path, repository: owner, linked: false });
  }
  // The longest first, so a worktree inside its repository's folder wins.
  return [...checkouts.values()].sort((a, b) => b.path.length - a.path.length);
}

const within = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`);

type Listed = { agent: FoundAgent; path: string; mtimeMs: number; size: number };

/** Claude Code transcripts that changed since `since`, in every project folder. */
async function claudeFiles(home: string, since: number) {
  const projects = join(home, ".claude", "projects");
  // Every folder: Claude Code files a transcript under the folder where the
  // session started, and a session can start outside the repositories, as in
  // a notes folder, then work in a checkout. Its last `cwd` places it.
  const folders = await readdir(projects).catch(() => [] as string[]);
  const files: Listed[] = [];
  for (const folder of folders) {
    const entries = await readdir(join(projects, folder), { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        .map(async (entry) => {
          const path = join(projects, folder, entry.name);
          const info = await stat(path).catch(() => undefined);
          if (info && info.mtimeMs >= since)
            files.push({ agent: "claude", path, mtimeMs: info.mtimeMs, size: info.size });
        }),
    );
  }
  return files;
}

/** The names in a folder; none when it is missing. */
export const folderNames = (folder: string) => readdir(folder).catch(() => [] as string[]);
export const isRollout = (name: string) => name.startsWith("rollout-") && name.endsWith(".jsonl");

/** Every Codex day folder (`sessions/YYYY/MM/DD`), the newest first. */
export async function codexDayFolders(root: string) {
  const folders: string[] = [];
  const sorted = async (folder: string) => (await folderNames(folder)).sort().reverse();
  for (const year of await sorted(root))
    for (const month of await sorted(join(root, year)))
      for (const day of await sorted(join(root, year, month)))
        folders.push(join(root, year, month, day));
  return folders;
}

/** The day folders, by local date, of sessions that started in the window. */
function windowFolders(root: string, now: number) {
  const folders: string[] = [];
  for (let day = 0; day <= Math.ceil(WINDOW_MS / DAY); day++) {
    const date = new Date(now - day * DAY);
    folders.push(
      join(
        root,
        String(date.getFullYear()),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ),
    );
  }
  return folders;
}

/** Codex rollouts in these day folders that changed since `since`. */
async function codexFiles(folders: Iterable<string>, since: number) {
  const files: Listed[] = [];
  for (const folder of folders)
    await Promise.all(
      (await folderNames(folder)).filter(isRollout).map(async (name) => {
        const path = join(folder, name);
        const info = await stat(path).catch(() => undefined);
        if (info && info.mtimeMs >= since)
          files.push({ agent: "codex", path, mtimeMs: info.mtimeMs, size: info.size });
      }),
    );
  return files;
}

/** A session as the index has it: what its transcript says, and where it
 * works now. */
export interface IndexedSession extends SessionFile {
  /** The folder it works in now. */
  cwd: string;
  /** Its thread's ID (`sessionKey`). */
  key: string;
  /** Its name: the agent's title, its summary, or its first prompt. */
  title: string;
  /** The registered checkout that it works in now: the newest of its folders
   * that is in one. A session with none works outside the repositories. */
  checkout?: Checkout;
  /** Its turn has not ended, and its transcript changed lately. */
  working: boolean;
}

/** Sessions that the index read on their own, outside a scan, at most. */
const MAX_READ_ALONE = 256;

/**
 * The index of agent sessions. `found()` gives the recent sessions that
 * worked in a registered repository, which the thread list shows by itself;
 * `session()` reads any session that Med keeps, wherever it works. The
 * reader can hide one found session, or all of them (`found-sessions.json`
 * in the state directory keeps the choice).
 */
export function createSessionIndex(options: {
  repositories(): RegisteredRepository[];
  /** Reads the repositories' worktrees again from Git. */
  refreshRepositories?(): Promise<unknown>;
  settingsFile: string;
  /** Whether found sessions show before the reader chooses (default true). */
  shown?: boolean;
  home?: () => string;
  now?: () => number;
}) {
  const home = options.home ?? userHome;
  const now = options.now ?? Date.now;
  const abort = new AbortController();
  let settings: FoundSettings = { shown: options.shown ?? true, hidden: [] };
  const files = new Map<string, SessionFile>();
  /** Real paths of session directories that are not a registered path. */
  const realPaths = new Map<string, string>();
  /** The sessions of the last scan, newest first. */
  let recent: IndexedSession[] = [];
  /** Sessions read on their own, by key, the latest read last. */
  const alone = new Map<string, IndexedSession>();
  let scanned = 0;
  let scanning: Promise<void> | undefined;
  let worktreesRead = now();
  let worktreesWanted = false;
  let codexNames = { mtimeMs: -1, names: new Map<string, string>() };
  /** Codex day folders before the window that held a rollout in it, at the
   * last full listing. */
  let codexOlder = { at: -Infinity, folders: new Set<string>() };

  /** Codex Desktop names its threads in session_index.jsonl; the last name wins. */
  const readCodexNames = async () => {
    const path = join(home(), ".codex", "session_index.jsonl");
    const info = await stat(path).catch(() => undefined);
    if (!info || info.mtimeMs === codexNames.mtimeMs) return codexNames.names;
    const names = new Map<string, string>();
    for (const line of (await readEdge(path, "tail", TAIL_BYTES).catch(() => ({ lines: [] })))
      .lines) {
      const entry = parse(line);
      const id = text(entry?.id);
      const name = text(entry?.thread_name);
      if (id && name) names.set(id, name);
    }
    codexNames = { mtimeMs: info.mtimeMs, names };
    return names;
  };

  /** Whether a session's directory inside a checkout is the checkout's: it
   * is gone (a removed worktree), or a folder between it and the checkout has
   * its own `.git` (a worktree that the registry does not know yet, such as
   * one in .claude/worktrees, or a nested repository). */
  const inside = new Map<string, "own" | "gone" | "nested">();
  const belongs = async (path: string, checkout: string) => {
    const key = `${checkout}\0${path}`;
    let known = inside.get(key);
    if (known === undefined) {
      known = (await stat(path).catch(() => undefined))?.isDirectory() ? "own" : "gone";
      for (let folder = path; known === "own" && folder !== checkout; folder = dirname(folder))
        if (await stat(join(folder, ".git")).then(Boolean, () => false)) known = "nested";
      if (inside.size > 512) inside.clear();
      inside.set(key, known);
    }
    return known;
  };

  /** The registered checkout of a session's directory, or why there is none. */
  const where = async (cwd: string, checkouts: readonly Checkout[]) => {
    let path = cwd;
    let checkout = checkouts.find((entry) => within(cwd, entry.path));
    if (!checkout) {
      // A directory under a symbolic link, such as /tmp, has another real path.
      let real = realPaths.get(cwd);
      if (real === undefined) {
        real = await realpath(cwd).catch(() => "");
        if (realPaths.size > 512) realPaths.clear();
        realPaths.set(cwd, real);
      }
      path = real;
      checkout = real ? checkouts.find((entry) => within(real, entry.path)) : undefined;
    }
    if (!checkout) return { state: "outside" as const };
    const state = path === checkout.path ? "own" : await belongs(path, checkout.path);
    return state === "own" ? { state, checkout } : { state };
  };

  /** Where a session works now: the newest of its folders in a checkout. */
  const place = async (cwds: readonly string[], checkouts: readonly Checkout[]) => {
    for (const cwd of cwds.toReversed()) {
      const { state, checkout } = await where(cwd, checkouts);
      // Read the worktrees again soon; the session waits for its own checkout.
      if (state === "nested") worktreesWanted = true;
      if (checkout) return checkout;
    }
    return undefined;
  };

  /** A session file as the index lists it, or undefined when it has done
   * nothing to show: no folder, or no prompt or name. */
  const indexed = async (
    session: SessionFile,
    names: ReadonlyMap<string, string>,
    checkouts: readonly Checkout[],
  ): Promise<IndexedSession | undefined> => {
    const name = session.agent === "codex" ? names.get(session.id) : undefined;
    if (!session.cwd || session.automatic || !(session.prompt || session.name || name))
      return undefined;
    const checkout = await place(session.cwds.length ? session.cwds : [session.cwd], checkouts);
    return {
      ...session,
      cwd: session.cwd,
      ...(name ? { name } : {}),
      key: sessionKey(session),
      title: name ?? session.name ?? session.summary ?? session.prompt ?? "Agent session",
      ...(checkout && { checkout }),
      working: !session.idle && now() - session.mtimeMs < STALE_MS,
    };
  };

  /** Codex rollouts that changed in the window. A session that started before
   * the window and runs again is in an older day folder: the full listing
   * finds it, and later scans read its folder too. */
  const recentCodex = async (since: number) => {
    const root = join(home(), ".codex", "sessions");
    const listedNow = windowFolders(root, now());
    if (now() - codexOlder.at < CODEX_ALL_MS)
      return codexFiles(new Set([...listedNow, ...codexOlder.folders]), since);
    const listed = await codexFiles(await codexDayFolders(root), since);
    const inWindow = new Set(listedNow);
    codexOlder = {
      at: now(),
      folders: new Set(
        listed.map((file) => dirname(file.path)).filter((folder) => !inWindow.has(folder)),
      ),
    };
    return listed;
  };

  const refreshWorktrees = async () => {
    const age = now() - worktreesRead;
    if (options.refreshRepositories && age > (worktreesWanted ? WORKTREES_SOON_MS : WORKTREES_MS)) {
      worktreesRead = now();
      worktreesWanted = false;
      inside.clear();
      await options.refreshRepositories().catch(() => {});
    }
  };

  const scan = async () => {
    await refreshWorktrees();
    const checkouts = checkoutsOf(options.repositories());
    const since = now() - WINDOW_MS;
    const listed = [...(await claudeFiles(home(), since)), ...(await recentCodex(since))]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_READS);
    const names = listed.some((file) => file.agent === "codex")
      ? await readCodexNames()
      : new Map<string, string>();
    const next: IndexedSession[] = [];
    const seen = new Set<string>();
    for (const file of listed) {
      if (abort.signal.aborted) return;
      let session = files.get(file.path);
      if (!session || session.mtimeMs !== file.mtimeMs || session.size !== file.size) {
        session = await readSession(file.agent, file.path, file, session).catch(() => undefined);
        if (!session) continue;
        files.set(file.path, session);
      }
      const entry = await indexed(session, names, checkouts);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      next.push(entry);
    }
    // Forget files that left the listing, but for the sessions read alone.
    const kept = new Set([
      ...listed.map((file) => file.path),
      ...[...alone.values()].map((s) => s.path),
    ]);
    for (const path of files.keys()) if (!kept.has(path)) files.delete(path);
    recent = next;
  };

  /** Starts a scan when the last one is old; never waits for it. */
  const refresh = (force = false) => {
    if (scanning || (!force && now() - scanned < SCAN_MS)) return scanning;
    scanned = now();
    scanning = scan()
      .catch(() => {})
      .finally(() => {
        scanning = undefined;
      });
    return scanning;
  };

  const save = async () => {
    await mkdir(dirname(options.settingsFile), { recursive: true });
    const temporary = `${options.settingsFile}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, options.settingsFile);
  };

  return {
    /** Reads the reader's choices from the state directory. */
    async restore() {
      try {
        const parsed = foundSettingsSchema.safeParse(
          JSON.parse(await readFile(options.settingsFile, "utf8")),
        );
        if (parsed.success) settings = parsed.data;
      } catch {
        /* No choices yet. */
      }
    },
    settings: () => ({ shown: settings.shown }),
    /** Scans now, or joins the scan that runs, for measurements. */
    scan: () => refresh(true) ?? Promise.resolve(),
    /** Shows or hides found sessions, or one of them. */
    async update(input: FoundUpdate) {
      if (input.shown !== undefined) settings = { ...settings, shown: input.shown };
      if (input.hide) {
        const hidden = settings.hidden.filter((id) => id !== input.hide!.id);
        if (input.hide.hidden) hidden.push(input.hide.id);
        settings = { ...settings, hidden: hidden.slice(-500) };
      }
      await save();
      if (settings.shown) scanned = 0;
      return settings;
    },
    /** The recent sessions that worked in a registered checkout, newest
     * first, without those that the reader hid. */
    found(): IndexedSession[] {
      refresh();
      if (!settings.shown) return [];
      const hidden = new Set(settings.hidden);
      return recent
        .filter((session) => session.checkout && !hidden.has(session.key))
        .slice(0, MAX_FOUND);
    },
    /** The last read of a session, without reading it again. */
    known(key: string): IndexedSession | undefined {
      return alone.get(key) ?? recent.find((session) => session.key === key);
    },
    /**
     * A session as its transcript says now: from the last scan, else read on
     * its own, as for a session that Med keeps outside the window or the
     * repositories. Undefined when Med finds no transcript.
     */
    async session(session: { agent: FoundAgent; id: string }): Promise<IndexedSession | undefined> {
      const key = sessionKey(session);
      const scanned = recent.find((entry) => entry.key === key);
      const path = scanned?.path ?? alone.get(key)?.path ?? (await findTranscript(session, home()));
      if (!path) return undefined;
      const info = await stat(path).catch(() => undefined);
      if (!info) return undefined;
      const before = files.get(path);
      if (scanned && before?.mtimeMs === info.mtimeMs && before.size === info.size) return scanned;
      const last = alone.get(key);
      if (last && last.mtimeMs === info.mtimeMs && last.size === info.size) {
        // A turn ends by the clock as well as by its transcript.
        return { ...last, working: !last.idle && now() - last.mtimeMs < STALE_MS };
      }
      const file = await readSession(session.agent, path, info, before).catch(() => undefined);
      if (!file || file.id !== session.id) return undefined;
      files.set(path, file);
      const names = session.agent === "codex" ? await readCodexNames() : new Map<string, string>();
      const entry = await indexed(file, names, checkoutsOf(options.repositories()));
      if (!entry) return undefined;
      alone.delete(key);
      alone.set(key, entry);
      if (alone.size > MAX_READ_ALONE) alone.delete(alone.keys().next().value!);
      return entry;
    },
    /** Where a folder is: its registered checkout, for a session that Med
     * starts there or keeps. */
    async place(cwds: readonly string[]) {
      await refreshWorktrees();
      return place(cwds, checkoutsOf(options.repositories()));
    },
    /**
     * The registered checkout of a session's directory, for adopt. A folder
     * inside a checkout that has its own `.git` is a worktree that the
     * registry does not know yet: with `refresh`, the worktrees are read
     * again once.
     */
    async locate(cwd: string, refresh = true) {
      let found = await where(cwd, checkoutsOf(options.repositories()));
      if (refresh && found.state === "nested" && options.refreshRepositories) {
        await options.refreshRepositories().catch(() => {});
        worktreesRead = now();
        inside.clear();
        found = await where(cwd, checkoutsOf(options.repositories()));
      }
      return found;
    },
    /** Codex Desktop's thread names, by session ID. */
    codexNames: readCodexNames,
    close() {
      abort.abort();
    },
  };
}
export type SessionIndex = ReturnType<typeof createSessionIndex>;
