import { baseOf, changesBase, type RegisteredRepository } from "../shared/protocol";
import type { Thread } from "../shared/threads";
import { git } from "./runtime/process";

// A thread's `unlanded` field is the work that its base branch does not have
// yet. The base is the branch of the repository's
// main checkout, such as main. A thread's work is its checkout's commits
// ahead of the base, and, for a thread on working changes, the checkout's
// uncommitted changes. A thread on a commit range does not count the
// checkout's uncommitted changes: they can be another task's, as in a main
// checkout that several sessions share.
//
// The thread list never waits for Git: it takes the last result, and reads
// run in the background, one at a time.

/** A checkout's work is read again this often, and at most this often
 * (`SOON_MS`) after its thread changed. */
const AGAIN_MS = 30_000;
const SOON_MS = 4000;
/** Threads that changed within this time are read; older ones are not. */
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

type Unlanded = NonNullable<Thread["unlanded"]>;

export { baseOf, changesBase };

export function createCheckoutWork(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const abort = new AbortController();
  const known = new Map<string, { at: number; value?: Unlanded }>();
  let reading: Promise<void> | undefined;

  const read = async (checkout: string, base: string, working: boolean) => {
    const settings = { signal: abort.signal, timeoutMs: 10_000 };
    const [ahead, status] = await Promise.all([
      git(checkout, ["rev-list", "--count", `refs/heads/${base}..HEAD`], settings),
      working
        ? git(checkout, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], {
            ...settings,
            maxBytes: 1024 * 1024,
          })
        : undefined,
    ]);
    return {
      base,
      ahead: Number(ahead.toString("utf8").trim()) || 0,
      uncommitted: !!status && status.length > 0,
    };
  };

  return {
    /**
     * The threads with the work of their checkouts, as the last reads found
     * it. It starts reads for checkouts whose result is old. `working` says
     * whether a thread is on its checkout's working changes.
     */
    annotate(
      threads: Thread[],
      repositories: readonly RegisteredRepository[],
      working: (thread: Thread) => boolean,
    ): Thread[] {
      const time = now();
      const due: { key: string; checkout: string; base: string; working: boolean }[] = [];
      const annotated = threads.map((thread) => {
        if (!thread.checkout || !thread.repository || time - thread.updatedAt > RECENT_MS)
          return thread;
        const base = baseOf(repositories.find((entry) => entry.id === thread.repository!.id));
        if (!base) return thread;
        const onWorking = working(thread);
        const key = `${thread.checkout}\0${base}\0${onWorking}`;
        const last = known.get(key);
        const age = last ? time - last.at : Infinity;
        // A thread changed since the last read, such as a turn that ended;
        // read it again soon. A turn that runs is read when it ends.
        const changed = !!last && thread.updatedAt > last.at;
        const busy = thread.state === "working" && !!last;
        if (!busy && (age > AGAIN_MS || (changed && age > SOON_MS)))
          due.push({ key, checkout: thread.checkout, base, working: onWorking });
        return last?.value ? { ...thread, unlanded: last.value } : thread;
      });
      if (due.length && !reading)
        reading = (async () => {
          for (const entry of due) {
            if (abort.signal.aborted) return;
            const at = now();
            const value = await read(entry.checkout, entry.base, entry.working).catch(
              () => undefined,
            );
            known.set(entry.key, { at, ...(value && { value }) });
          }
          if (known.size > 512) known.clear();
        })().finally(() => {
          reading = undefined;
        });
      return annotated;
    },
    /** Waits for the reads that run, for tests and measurements. */
    settle: () => reading ?? Promise.resolve(),
    close() {
      abort.abort();
    },
  };
}
