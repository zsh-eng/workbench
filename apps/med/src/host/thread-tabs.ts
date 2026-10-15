import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { agentSessionSchema, MAX_SESSIONS } from "../shared/saved-review";

// Open tabs and cold history. A thread is a tab (open) or in history
// (closed). The host keeps which, the order of the tabs, and when each thread
// closed, in one small file in the state folder (`tabs.json`), so every window
// and the CLI agree. The host polls only the tabs: their agents' states, their
// Git work, and their subagents. History is read when a picker asks for it.
//
// A thread whose record is gone, because history pruned its captures, keeps a
// stub here: what history lists and what resumes its agent. A found session
// that was a tab keeps one too, so it stays listed after Med stops finding it.

const DAY = 24 * 60 * 60 * 1000;
/** A closed thread keeps its captures this long; then only its stub stays. */
export const CAPTURES_KEPT_MS = 30 * DAY;
/** A stub stays in history this long after its thread closed. */
export const STUBS_KEPT_MS = 180 * DAY;

export const tabStubSchema = z.object({
  title: z.string().max(400),
  createdAt: z.string().max(64).optional(),
  repository: z
    .object({ id: z.string().max(200), name: z.string().max(200), path: z.string().max(8192) })
    .optional(),
  checkout: z.string().max(8192).optional(),
  linked: z.boolean().optional(),
  branch: z.string().max(400).optional(),
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).default([]),
  pullRequestUrl: z.string().max(2048).optional(),
  /** The thread's last change when the stub was made, in milliseconds. */
  updatedAt: z.number().optional(),
});
export type TabStub = z.infer<typeof tabStubSchema>;

const entrySchema = z.object({
  /** The repository group of the tab, so a new tab goes to the top of its group. */
  group: z.string().max(8192).optional(),
  /** When it went to history; absent while it is a tab. */
  closedAt: z.number().optional(),
  /** Its place among the tabs when it closed, for Undo and Reopen closed tab. */
  place: z.number().int().nonnegative().optional(),
  /** The auto-close rule closed it. */
  auto: z.boolean().optional(),
  /** The first prompt of its lead session, for history's search. */
  prompt: z.string().max(400).optional(),
  stub: tabStubSchema.optional(),
});
export type TabEntry = z.infer<typeof entrySchema>;

const stateSchema = z.object({
  version: z.literal(1),
  /** The tabs, top first. */
  order: z.array(z.string().max(200)).max(1000),
  entries: z.record(z.string().max(200), entrySchema),
  /** The last pruning, in milliseconds. */
  prunedAt: z.number().optional(),
});
type TabsState = z.infer<typeof stateSchema>;

export type ThreadTabs = ReturnType<typeof createThreadTabs>;

/** The tabs store. Changes apply in memory at once; `save()` writes them. */
export function createThreadTabs(options: { file: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  let state: TabsState = { version: 1, order: [], entries: {} };
  let saving = Promise.resolve();
  let dirty = false;
  const listeners = new Set<() => void>();
  const changed = () => {
    dirty = true;
    for (const listener of listeners) listener();
  };
  const entry = (id: string) => (state.entries[id] ??= {});

  const tabs = {
    /** Reads the file. False when there is none yet, as before the first start. */
    async load(): Promise<boolean> {
      try {
        const parsed = stateSchema.safeParse(JSON.parse(await readFile(options.file, "utf8")));
        if (!parsed.success) return false;
        state = parsed.data;
        // An entry and its place in the order agree.
        state.order = [...new Set(state.order)];
        for (const id of state.order) delete entry(id).closedAt;
        return true;
      } catch {
        return false;
      }
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
    isOpen: (id: string) => state.order.includes(id),
    /** Whether Med has a record of the thread: a tab, or in history. */
    known: (id: string) => id in state.entries,
    order: (): readonly string[] => state.order,
    entry: (id: string): Readonly<TabEntry> | undefined => state.entries[id],
    /** The closed threads, the most recently closed first. */
    closed() {
      return Object.entries(state.entries)
        .flatMap(([id, value]) =>
          value.closedAt !== undefined && !state.order.includes(id)
            ? [{ id, ...value, closedAt: value.closedAt }]
            : [],
        )
        .sort((a, b) => b.closedAt - a.closedAt);
    },
    /**
     * Opens a thread as a tab: at its old place with `restore`, else at the
     * top of its group's tabs (a new group goes to the top). `replace` puts it
     * in the place of another tab, such as the found session that it saves.
     * False when it was open already.
     */
    open(
      id: string,
      place: { group?: string; restore?: boolean; replace?: string; prompt?: string } = {},
    ) {
      const item = entry(id);
      if (place.group) item.group = place.group;
      if (place.prompt && !item.prompt) item.prompt = place.prompt.slice(0, 400);
      if (state.order.includes(id)) {
        if (place.group || place.prompt) dirty = true;
        return false;
      }
      const replaced = place.replace ? state.order.indexOf(place.replace) : -1;
      let at: number;
      if (replaced >= 0) {
        // The saved thread is the session now; history does not list it twice.
        at = replaced;
        state.order.splice(replaced, 1);
        delete state.entries[place.replace!];
      } else if (place.restore && item.place !== undefined)
        at = Math.min(item.place, state.order.length);
      else {
        const first = state.order.findIndex(
          (other) => !!item.group && state.entries[other]?.group === item.group,
        );
        at = Math.max(0, first);
      }
      state.order.splice(at, 0, id);
      delete item.closedAt;
      delete item.place;
      delete item.auto;
      changed();
      return true;
    },
    /** Sends a tab to history. False when it was closed already. */
    close(id: string, details: { auto?: boolean; at?: number; quiet?: boolean } = {}) {
      const index = state.order.indexOf(id);
      const item = entry(id);
      if (index < 0 && item.closedAt !== undefined) return false;
      if (index >= 0) {
        state.order.splice(index, 1);
        item.place = index;
      }
      item.closedAt = details.at ?? now();
      if (details.auto) item.auto = true;
      else delete item.auto;
      if (!details.quiet) changed();
      else dirty = true;
      return index >= 0;
    },
    /** Puts the tabs in this order. Tabs that it leaves out keep their places
     * after it; IDs that are not tabs are ignored. */
    reorder(order: readonly string[]) {
      const wanted = [...new Set(order)].filter((id) => state.order.includes(id));
      const rest = state.order.filter((id) => !wanted.includes(id));
      const next = [...wanted, ...rest];
      if (next.every((id, index) => id === state.order[index])) return false;
      state.order = next;
      changed();
      return true;
    },
    setGroup(id: string, group: string) {
      const item = state.entries[id];
      if (!item || item.group === group) return;
      item.group = group;
      dirty = true;
    },
    setPrompt(id: string, prompt: string) {
      const item = state.entries[id];
      if (!item || item.prompt) return;
      item.prompt = prompt.slice(0, 400);
      dirty = true;
    },
    /** Keeps what history needs of a thread whose record is gone. */
    setStub(id: string, stub: TabStub) {
      const item = entry(id);
      const next = tabStubSchema.parse(stub);
      if (JSON.stringify(item.stub) === JSON.stringify(next)) return;
      item.stub = next;
      dirty = true;
    },
    /** Removes the thread from tabs and history. */
    forget(id: string) {
      if (!(id in state.entries) && !state.order.includes(id)) return false;
      state.order = state.order.filter((other) => other !== id);
      delete state.entries[id];
      changed();
      return true;
    },
    /**
     * The first start with tabs: each thread opens or closes as the rule of
     * the migration says (src/host/server.ts), in the order given.
     */
    migrate(threads: { id: string; open: boolean; closedAt?: number; group?: string }[]) {
      state = { version: 1, order: [], entries: {} };
      for (const thread of threads) {
        state.entries[thread.id] = {
          ...(thread.group ? { group: thread.group } : {}),
          ...(thread.open ? {} : { closedAt: thread.closedAt ?? now() }),
        };
        if (thread.open) state.order.push(thread.id);
      }
      changed();
    },
    prunedAt: () => state.prunedAt ?? 0,
    setPrunedAt(at: number) {
      state.prunedAt = at;
      dirty = true;
    },
  };
  return tabs;
}
