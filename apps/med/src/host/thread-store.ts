import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { agentSessionSchema } from "../shared/saved-review";
import { keepAside } from "./runtime/state-file";

// The threads that Med keeps, by ID: an agent session's key, or a review's ID
// for a review that no session handed off. A thread is a tab (open) or
// archived. The host keeps which, the reader's name and pin for each, what
// they saw, and what lists an archived thread without reading its agent, in
// one small file in the state folder (`threads.json`), so every window and
// the CLI agree. The host polls only the tabs.

/** The seen marks that the file keeps, the newest first. */
const SEEN_KEPT = 1000;

const placeSchema = z.object({
  repository: z
    .object({ id: z.string().max(200), name: z.string().max(200), path: z.string().max(8192) })
    .optional(),
  checkout: z.string().max(8192).optional(),
  branch: z.string().max(400).optional(),
  linked: z.boolean().optional(),
});
export type ThreadPlace = z.infer<typeof placeSchema>;

const entrySchema = z.object({
  /** When it was archived; absent while it is a tab. */
  closedAt: z.number().optional(),
  /** The auto-archive rule archived it. */
  auto: z.boolean().optional(),
  /** The name that the reader gave the thread in Med, in place of its agent's title. */
  name: z.string().max(120).optional(),
  /** The session's first prompt, for the archive's search. */
  prompt: z.string().max(400).optional(),
  /** A session thread's agent session, with the folder it worked in last. */
  session: agentSessionSchema.optional(),
  /** Med keeps the session whether or not it finds it: Med started it, the
   * reader kept it in Med, or it handed off a review. */
  kept: z.boolean().optional(),
  /** What lists the thread while Med does not read its agent: its last
   * title, when it began, its last change, and where it worked. */
  title: z.string().max(400).optional(),
  createdAt: z.string().max(64).optional(),
  updatedAt: z.number().optional(),
  place: placeSchema.optional(),
  /** The branch that the thread's Changes start from, which the reader
   * chose; without it, the repository's base branch. */
  base: z.string().max(256).optional(),
  /** The Superagent's session (superagent.ts), which Med makes once. */
  superagent: z.boolean().optional(),
});
export type ThreadEntry = z.infer<typeof entrySchema>;

const stateSchema = z.object({
  version: z.literal(2),
  entries: z.record(z.string().max(200), entrySchema),
  /** The pinned threads, in the reader's order. */
  pins: z.array(z.string().max(200)).max(1000).optional(),
  /** The last pruning, in milliseconds. */
  prunedAt: z.number().optional(),
  /** The newest change of each thread that the reader has seen, by its
   * `updatedAt`, so every window and the CLI agree on what is new. */
  seen: z.record(z.string().max(200), z.number()).optional(),
  /** When Med began to keep the marks: a thread's change from before it, and
   * a thread without a mark, count as seen up to it. */
  seenSince: z.number().optional(),
});
type StoreState = z.infer<typeof stateSchema>;

export type ThreadStore = ReturnType<typeof createThreadStore>;

/** The store in a file's text, with each entry checked on its own. */
function readStore(text: string): { state?: StoreState; partial: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { partial: true };
  }
  const whole = stateSchema.safeParse(raw);
  if (whole.success) return { state: whole.data, partial: false };
  const file = z
    .object({ version: z.literal(2), entries: z.record(z.string(), z.unknown()) })
    .passthrough()
    .safeParse(raw);
  if (!file.success) return { partial: true };
  const entries: StoreState["entries"] = {};
  for (const [id, value] of Object.entries(file.data.entries)) {
    const entry = entrySchema.safeParse(value);
    if (entry.success && id.length <= 200) entries[id] = entry.data;
  }
  return { state: { version: 2, entries }, partial: true };
}

/** The newest marks, at most `SEEN_KEPT` of them. */
const keepSeen = (marks: Record<string, number>) =>
  Object.keys(marks).length <= SEEN_KEPT
    ? marks
    : Object.fromEntries(
        Object.entries(marks)
          .sort((a, b) => b[1] - a[1])
          .slice(0, SEEN_KEPT),
      );

/** The thread store. Changes apply in memory at once; `save()` writes them. */
export function createThreadStore(options: { file: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  // Med keeps seen marks from when this host started: a thread that changes
  // after that, such as the first one made, is new until the reader sees it.
  const started = now();
  let state: StoreState = { version: 2, entries: {} };
  let saving = Promise.resolve();
  let dirty = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    state.seenSince ??= started;
    dirty = true;
    for (const listener of listeners) listener();
  };
  const entry = (id: string) => (state.entries[id] ??= {});

  const store = {
    /** Reads the file. False when there is none yet, as before the first
     * start, or when Med can read none of it. An entry that Med cannot read
     * costs only itself, and a file that it could not read in full keeps a
     * copy beside it. */
    async load(): Promise<boolean> {
      let text: string;
      try {
        text = await readFile(options.file, "utf8");
      } catch {
        return false;
      }
      const read = readStore(text);
      if (read.partial) await keepAside(options.file);
      if (!read.state) return false;
      state = read.state;
      return true;
    },
    /** Writes the changes since the last write, atomically, one write at a time. */
    save(): Promise<void> {
      saving = saving.then(async () => {
        if (!dirty) return;
        dirty = false;
        await mkdir(dirname(options.file), { recursive: true, mode: 0o700 });
        const temporary = `${options.file}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
          await rename(temporary, options.file);
        } catch (error) {
          dirty = true;
          await unlink(temporary).catch(() => {});
          throw error;
        }
      });
      return saving;
    },
    /** Runs after each change, such as to send the thread list again. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    isOpen: (id: string) => id in state.entries && state.entries[id]!.closedAt === undefined,
    /** Whether Med has a record of the thread: a tab, or archived. */
    known: (id: string) => id in state.entries,
    entry: (id: string): Readonly<ThreadEntry> | undefined => state.entries[id],
    /** Every thread that Med keeps a record of. */
    ids: (): string[] => Object.keys(state.entries),
    /** The tabs. */
    openIds: (): string[] =>
      Object.entries(state.entries).flatMap(([id, value]) =>
        value.closedAt === undefined ? [id] : [],
      ),
    /** The archived threads, the most recently archived first. */
    closed() {
      return Object.entries(state.entries)
        .flatMap(([id, value]) =>
          value.closedAt !== undefined ? [{ id, ...value, closedAt: value.closedAt }] : [],
        )
        .sort((a, b) => b.closedAt - a.closedAt);
    },
    /** Opens a thread as a tab. False when it was open already. */
    open(
      id: string,
      details: Partial<Pick<ThreadEntry, "session" | "kept" | "prompt" | "superagent">> = {},
    ) {
      const item = entry(id);
      const fresh = item.closedAt !== undefined || !Object.keys(item).length;
      if (details.session) item.session = details.session;
      if (details.kept) item.kept = true;
      if (details.superagent) item.superagent = true;
      if (details.prompt && !item.prompt) item.prompt = details.prompt.slice(0, 400);
      if (!fresh) {
        if (details.session || details.kept || details.prompt) dirty = true;
        return false;
      }
      delete item.closedAt;
      delete item.auto;
      changed();
      return true;
    },
    /** Archives a tab. False when it was archived already. */
    close(id: string, details: { auto?: boolean; at?: number; quiet?: boolean } = {}) {
      const item = entry(id);
      if (item.closedAt !== undefined) return false;
      item.closedAt = details.at ?? now();
      if (details.auto) item.auto = true;
      else delete item.auto;
      if (!details.quiet) changed();
      else dirty = true;
      return true;
    },
    /** Keeps what lists the thread while Med does not read it; no change
     * that the list shows, so it is written with the next one. */
    remember(id: string, facts: Partial<ThreadEntry>) {
      const item = state.entries[id];
      if (!item) return;
      const next = { ...item, ...facts };
      if (JSON.stringify(next) === JSON.stringify(item)) return;
      state.entries[id] = entrySchema.parse(next);
      dirty = true;
    },
    setPrompt(id: string, prompt: string) {
      const item = state.entries[id];
      if (!item || item.prompt) return;
      item.prompt = prompt.slice(0, 400);
      dirty = true;
    },
    /** The branch that the thread's Changes start from; none for the base. */
    setBase(id: string, base: string | undefined) {
      const item = entry(id);
      if (item.base === base) return false;
      if (base) item.base = base;
      else delete item.base;
      changed();
      return true;
    },
    /** The pinned threads, in the reader's order. */
    pins: (): readonly string[] => state.pins ?? [],
    /** Pins the thread at `at` among the pins (under the others without it),
     * moves a pinned one there, or unpins it. False when nothing changed. */
    setPinned(id: string, pinned: boolean, at?: number) {
      const pins = state.pins ?? [];
      const others = pins.filter((other) => other !== id);
      const next = pinned
        ? others.toSpliced(Math.min(Math.max(at ?? others.length, 0), others.length), 0, id)
        : others;
      if (next.length === pins.length && next.every((other, index) => other === pins[index]))
        return false;
      state.pins = next;
      changed();
      return true;
    },
    /** Names the thread; without a name, it shows its agent's title again.
     * False when the name was the same. */
    setName(id: string, name: string | undefined) {
      const item = entry(id);
      if (item.name === name) return false;
      if (name) item.name = name;
      else delete item.name;
      changed();
      return true;
    },
    /** The newest change of the thread that the reader has seen. */
    seen(id: string) {
      // The file keeps it with the next change: a read alone writes nothing.
      state.seenSince ??= started;
      return state.seen?.[id] ?? state.seenSince;
    },
    /** The reader saw the thread's changes up to `at`; a lower mark makes
     * the later ones new again. False when the mark was the same. */
    see(id: string, at: number) {
      if (state.seen?.[id] === at) return false;
      state.seen = keepSeen({ ...state.seen, [id]: at });
      changed();
      return true;
    },
    /** The marks that a browser kept before the host did: each fills a mark
     * that the host does not have, or moves one forward. */
    mergeSeen(marks: Readonly<Record<string, number>>) {
      const next = { ...state.seen };
      let moved = false;
      for (const [id, at] of Object.entries(marks)) {
        // A browser's mark fills one that the host lacks, even an older one:
        // a thread unread before the host kept marks stays unread.
        if (!(id in state.entries) || (next[id] !== undefined && next[id] >= at)) continue;
        next[id] = at;
        moved = true;
      }
      if (!moved) return false;
      state.seen = keepSeen(next);
      changed();
      return true;
    },
    /** `to` takes `from`'s place: its name, pin, and marks, as a session that
     * Med continues in a fork. `from` is archived. */
    handOver(from: string, to: string, facts: Partial<ThreadEntry> = {}) {
      const old = state.entries[from];
      const item = entry(to);
      if (old?.name && !item.name) item.name = old.name;
      if (old?.base && !item.base) item.base = old.base;
      Object.assign(item, facts);
      delete item.closedAt;
      const pins = state.pins ?? [];
      const at = pins.indexOf(from);
      if (at >= 0) state.pins = pins.includes(to) ? pins.toSpliced(at, 1) : pins.with(at, to);
      const mark = state.seen?.[from];
      if (mark !== undefined) state.seen = { ...state.seen, [to]: mark };
      if (old && old.closedAt === undefined) old.closedAt = now();
      changed();
    },
    /** Removes the thread from tabs and the archive. */
    forget(id: string) {
      if (!(id in state.entries)) return false;
      if (state.pins?.includes(id)) state.pins = state.pins.filter((other) => other !== id);
      if (state.seen) delete state.seen[id];
      delete state.entries[id];
      changed();
      return true;
    },
    /** Replaces everything, as the move from `tabs.json` does at the first
     * start of this Med (src/host/thread-migration.ts). */
    replace(next: Omit<StoreState, "version">) {
      state = stateSchema.parse({ version: 2, ...next });
      changed();
    },
    prunedAt: () => state.prunedAt ?? 0,
    setPrunedAt(at: number) {
      state.prunedAt = at;
      dirty = true;
    },
  };
  return store;
}
