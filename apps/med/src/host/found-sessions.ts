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
import { createCodexRolloutReader } from "../shared/agent-session-codex";
import {
  FOUND_DAYS,
  foundSettingsSchema,
  foundThreadId,
  parseFoundThreadId,
  type FoundAgent,
  type FoundSettings,
  type FoundUpdate,
} from "../shared/found-sessions";
import type { RegisteredRepository } from "../shared/protocol";
import type { SessionEvent } from "../shared/agent-session";
import type { ThreadTurn } from "../shared/agent-status";
import type { AgentSession } from "../shared/saved-review";
import { threadTitle, type Thread } from "../shared/threads";
import { findTranscript } from "./agent-transcripts";
import { createCheckoutChanges } from "./checkout-changes";
import { changesBase } from "./checkout-work";
import { summarizeTurn } from "./thread-turns";
import { userHome } from "./service/discover";

// Med lists the threads that `med review create` or New thread saved. The
// user's other agent work runs in Claude Code and Codex, in the same
// repositories. This module finds those sessions from their transcripts, so
// the thread list shows all agent work on the registered repositories:
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
/** At most this many found threads show; the newest stay. */
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
/** The tail gives the turn's state, the latest title, and the directory. */
const TAIL_BYTES = 256 * 1024;
/** A turn whose transcript has not changed for this long has stopped. */
const STALE_MS = 5 * 60_000;

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
  cwd?: string;
  createdAt: number;
  /** The user's first prompt, through `threadTitle`. */
  prompt?: string;
  /** Claude Code's custom title or agent name, or Codex's thread name. */
  name?: string;
  summary?: string;
  idle: boolean;
  /** The last turn, from the tail (thread-turns.ts). */
  turn?: ThreadTurn;
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
  const found: {
    cwd?: string;
    createdAt?: number;
    prompt?: string;
    text?: string;
    name?: string;
    summary?: string;
    id?: string;
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
    if (cwd) found.cwd = cwd;
    const at = Date.parse(text(entry.timestamp) ?? "");
    if (!Number.isNaN(at)) found.createdAt ??= at;
    if (agent === "codex" && entry.type === "session_meta") found.id ??= text(payload?.id);
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
  return { ...found, idle, ...(turn && { turn: summarizeTurn(updates, idle) }) };
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
  return {
    agent,
    id,
    path,
    mtimeMs: info.mtimeMs,
    size: info.size,
    ...(cwd ? { cwd } : {}),
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

interface Checkout {
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

/** Claude Code transcripts in the project folders of the registered checkouts
 * and of folders inside them. */
async function claudeFiles(home: string, checkouts: readonly Checkout[], since: number) {
  const projects = join(home, ".claude", "projects");
  const folders = await readdir(projects).catch(() => [] as string[]);
  const prefixes = checkouts.map((checkout) => claudeProjectFolder(checkout.path));
  const wanted = folders.filter((folder) =>
    prefixes.some((prefix) => folder === prefix || folder.startsWith(`${prefix}-`)),
  );
  const files: Listed[] = [];
  for (const folder of wanted) {
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

/** A found session in its checkout. */
interface Found extends SessionFile {
  threadId: string;
  cwd: string;
  checkout: Checkout;
}

/**
 * Finds the recent Claude Code and Codex sessions of the registered
 * repositories. `threads()` gives them as threads for the thread list; the
 * reader can hide one, or all of them (`found-sessions.json` in the state
 * directory keeps the choice).
 */
export function createFoundSessions(options: {
  repositories(): RegisteredRepository[];
  /** Reads the repositories' worktrees again from Git. */
  refreshRepositories?(): Promise<unknown>;
  /** The sessions that Med runs through ACP: the agent's own session ID,
   * such as a Codex rollout's, and Med's ID for the session. */
  owned?(): Iterable<readonly [string, string]>;
  /** Transcripts that are not threads: the forks that a question made
   * (questions.ts). */
  excluded?(agent: FoundAgent, id: string): boolean;
  settingsFile: string;
  /** The change counts of checkouts, which the thread list shares. */
  changes?: ReturnType<typeof createCheckoutChanges>;
  home?: () => string;
  now?: () => number;
}) {
  const home = options.home ?? userHome;
  const now = options.now ?? Date.now;
  const counts = options.changes ?? createCheckoutChanges({ now });
  const abort = new AbortController();
  let settings: FoundSettings = { shown: true, hidden: [] };
  const files = new Map<string, SessionFile>();
  /** Real paths of session directories that are not a registered path. */
  const realPaths = new Map<string, string>();
  let found: Found[] = [];
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

  const place = async (cwd: string, checkouts: readonly Checkout[]) => {
    const { state, checkout } = await where(cwd, checkouts);
    // Read the worktrees again soon; the session waits for its own checkout.
    if (state === "nested") worktreesWanted = true;
    return checkout;
  };

  /** Codex rollouts that changed in the window. A session that started before
   * the window and runs again is in an older day folder: the full listing
   * finds it, and later scans read its folder too. */
  const recentCodex = async (since: number) => {
    const root = join(home(), ".codex", "sessions");
    const recent = windowFolders(root, now());
    if (now() - codexOlder.at < CODEX_ALL_MS)
      return codexFiles(new Set([...recent, ...codexOlder.folders]), since);
    const listed = await codexFiles(await codexDayFolders(root), since);
    const inWindow = new Set(recent);
    codexOlder = {
      at: now(),
      folders: new Set(
        listed.map((file) => dirname(file.path)).filter((folder) => !inWindow.has(folder)),
      ),
    };
    return listed;
  };

  const scan = async () => {
    const age = now() - worktreesRead;
    if (options.refreshRepositories && age > (worktreesWanted ? WORKTREES_SOON_MS : WORKTREES_MS)) {
      worktreesRead = now();
      worktreesWanted = false;
      inside.clear();
      await options.refreshRepositories().catch(() => {});
    }
    const checkouts = checkoutsOf(options.repositories());
    if (!checkouts.length) {
      found = [];
      return;
    }
    const since = now() - WINDOW_MS;
    const listed = [...(await claudeFiles(home(), checkouts, since)), ...(await recentCodex(since))]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_READS);
    const names = listed.some((file) => file.agent === "codex")
      ? await readCodexNames()
      : new Map<string, string>();
    const next: Found[] = [];
    const seen = new Set<string>();
    for (const file of listed) {
      if (abort.signal.aborted) return;
      let session = files.get(file.path);
      if (!session || session.mtimeMs !== file.mtimeMs || session.size !== file.size) {
        session = await readSession(file.agent, file.path, file, session).catch(() => undefined);
        if (!session) continue;
        files.set(file.path, session);
      }
      const key = `${session.agent}:${session.id}`;
      if (!session.cwd || seen.has(key) || options.excluded?.(session.agent, session.id)) continue;
      seen.add(key);
      const checkout = await place(session.cwd, checkouts);
      const name = session.agent === "codex" ? names.get(session.id) : undefined;
      // A session without a prompt or a name has done nothing to show.
      if (!checkout || !(session.prompt || session.name || name)) continue;
      next.push({
        ...session,
        ...(name ? { name } : {}),
        cwd: session.cwd,
        threadId: foundThreadId(session.agent, session.id),
        checkout,
      });
    }
    // Forget files that left the listing.
    const kept = new Set(listed.map((file) => file.path));
    for (const path of files.keys()) if (!kept.has(path)) files.delete(path);
    found = next;
  };

  /** Starts a scan when the last one is old; never waits for it. */
  const refresh = (force = false) => {
    if (scanning || !settings.shown || (!force && now() - scanned < SCAN_MS)) return scanning;
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
    /** Shows or hides found sessions, or one thread. */
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
    /**
     * The found sessions as threads, newest first: those that no saved
     * review names (archived ones too) and that the reader did not hide.
     */
    threads(reviews: readonly { sessions?: readonly AgentSession[] }[]): Thread[] {
      refresh();
      if (!settings.shown) return [];
      const claimed = new Set(
        reviews.flatMap((review) => (review.sessions ?? []).map((session) => session.id)),
      );
      // A Codex session that Med runs through ACP has a rollout with Codex's ID.
      for (const [own, id] of options.owned?.() ?? []) if (claimed.has(id)) claimed.add(own);
      const hidden = new Set(settings.hidden);
      // A fork can be named after the scan that read it.
      const listed = found
        .filter(
          (session) =>
            !claimed.has(session.id) &&
            !hidden.has(session.threadId) &&
            !options.excluded?.(session.agent, session.id),
        )
        .slice(0, MAX_FOUND);
      const time = now();
      const repositories = options.repositories();
      return listed.map((session): Thread => {
        const { checkout } = session;
        // The counts of the checkout's Changes: the branch's, or the uncommitted ones.
        const base = changesBase(
          repositories.find((entry) => entry.id === checkout.repository.id),
          checkout.branch,
        );
        const changes = counts.get(checkout.path, base, session.mtimeMs);
        const working = !session.idle && time - session.mtimeMs < STALE_MS;
        return {
          id: session.threadId,
          title: session.name ?? session.summary ?? session.prompt ?? "Agent session",
          createdAt: new Date(session.createdAt).toISOString(),
          updatedAt: session.mtimeMs,
          repository: checkout.repository,
          checkout: checkout.path,
          ...(checkout.linked ? { linked: true } : {}),
          ...(checkout.branch ? { branch: checkout.branch } : {}),
          agent: session.agent,
          state: working ? "working" : "idle",
          sessions: [{ agent: session.agent, id: session.id, cwd: session.cwd }],
          ...(changes ? { changes } : {}),
          ...(session.turn && { turn: session.turn }),
          found: true,
        };
      });
    },
    /**
     * The session of a found thread's ID, for the session routes: one in a
     * registered checkout, also before the first scan and after the reader
     * hid it or kept it in Med. Undefined for an ID that is not a found one.
     */
    async session(threadId: string): Promise<AgentSession[] | undefined> {
      const parsed = parseFoundThreadId(threadId);
      if (!parsed) return undefined;
      if (options.excluded?.(parsed.agent, parsed.id)) return [];
      const known = found.find((session) => session.threadId === threadId);
      if (known) return [{ agent: known.agent, id: known.id, cwd: known.cwd }];
      const path = await findTranscript(parsed, home());
      if (!path) return [];
      const info = await stat(path);
      const session = await readSession(parsed.agent, path, info).catch(() => undefined);
      const checkouts = checkoutsOf(options.repositories());
      if (!session?.cwd || session.id !== parsed.id || !(await place(session.cwd, checkouts)))
        return [];
      return [{ agent: parsed.agent, id: parsed.id, cwd: session.cwd }];
    },
    /**
     * The registered checkout of a session's directory, for adopt. A folder
     * inside a checkout that has its own `.git` is a worktree that the
     * registry does not know yet: with `refresh`, the worktrees are read
     * again once.
     */
    async locate(cwd: string, refresh = true) {
      let place = await where(cwd, checkoutsOf(options.repositories()));
      if (refresh && place.state === "nested" && options.refreshRepositories) {
        await options.refreshRepositories().catch(() => {});
        worktreesRead = now();
        inside.clear();
        place = await where(cwd, checkoutsOf(options.repositories()));
      }
      return place;
    },
    /** Codex Desktop's thread names, by session ID. */
    codexNames: readCodexNames,
    close() {
      abort.abort();
      if (!options.changes) counts.close();
    },
  };
}
