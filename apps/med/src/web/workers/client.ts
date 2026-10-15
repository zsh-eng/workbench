import type { FileDiffMetadata } from "@pierre/diffs";

/** The most patch workers, whatever the number of cores. */
const WORKER_LIMIT = 2;

/** One patch worker for each 4 cores, from 1 to WORKER_LIMIT. */
export const patchWorkerCount = (cores = navigator.hardwareConcurrency || 4) =>
  Math.max(1, Math.min(WORKER_LIMIT, Math.floor(cores / 4)));

interface Owner {
  job: Job | null;
  shown: boolean;
}
interface Job {
  id: number;
  owner: Owner;
  patch: string;
  resolve(files: FileDiffMetadata[]): void;
  reject(error: Error): void;
}
interface Slot {
  worker: Worker | null;
  job: Job | null;
}

/**
 * The patch parsers of all workspaces share a few workers. A job of the
 * workspace on screen goes before the others, and a job of a hidden
 * workspace gives its worker up to it, to run again after.
 */
function createPatchPool(size: number) {
  const slots: Slot[] = Array.from({ length: size }, () => ({ worker: null, job: null }));
  const queue: Job[] = [];
  let sequence = 0;
  /** Ends a slot's worker with its job; the next job starts a new worker. */
  const stop = (slot: Slot) => {
    slot.worker?.terminate();
    slot.worker = null;
    slot.job = null;
  };
  const spawn = (slot: Slot) => {
    const worker = new Worker(new URL("./patch.ts", import.meta.url), { type: "module" });
    worker.onmessage = (
      event: MessageEvent<{ id: number; files?: FileDiffMetadata[]; error?: string }>,
    ) => {
      const job = slot.job;
      if (!job || event.data.id !== job.id) return;
      slot.job = null;
      job.owner.job = null;
      if (event.data.error) job.reject(new Error(event.data.error));
      else job.resolve(event.data.files ?? []);
      pump();
    };
    worker.onerror = () => {
      const job = slot.job;
      stop(slot);
      if (job) {
        job.owner.job = null;
        job.reject(new Error("The patch parser stopped. Refresh to try again."));
      }
      pump();
    };
    return worker;
  };
  /** Jobs on screen go first, in their order, then the others. A hidden job
   * that gave its worker up goes first among the others. */
  const enqueue = (job: Job, again = false) => {
    if (!job.owner.shown && !again) return void queue.push(job);
    const hidden = queue.findIndex((entry) => !entry.owner.shown);
    queue.splice(hidden < 0 ? queue.length : hidden, 0, job);
  };
  const pump = () => {
    while (queue.length) {
      const next = queue[0]!;
      let slot = slots.find((entry) => !entry.job);
      if (!slot && next.owner.shown) {
        slot = slots.find((entry) => entry.job && !entry.job.owner.shown);
        if (slot) {
          const hidden = slot.job!;
          stop(slot);
          enqueue(hidden, true);
        }
      }
      if (!slot) return;
      queue.shift();
      slot.job = next;
      slot.worker ??= spawn(slot);
      slot.worker.postMessage({ id: next.id, patch: next.patch });
    }
  };
  /** Takes back an owner's job, queued or running. */
  const cancel = (owner: Owner, reason: Error) => {
    const job = owner.job;
    if (!job) return;
    owner.job = null;
    const queued = queue.indexOf(job);
    if (queued >= 0) queue.splice(queued, 1);
    const slot = slots.find((entry) => entry.job === job);
    if (slot) stop(slot);
    job.reject(reason);
  };
  return {
    parser(shown: boolean) {
      const owner: Owner = { job: null, shown };
      let closed = false;
      return {
        parse(patch: string): Promise<FileDiffMetadata[]> {
          if (closed) return Promise.reject(new Error("Review closed"));
          cancel(owner, new DOMException("A newer review replaced this parse.", "AbortError"));
          return new Promise((resolve, reject) => {
            owner.job = { id: ++sequence, owner, patch, resolve, reject };
            enqueue(owner.job);
            pump();
          });
        },
        /** The parser's workspace shows or hides. */
        show(next: boolean) {
          if (owner.shown === next) return;
          owner.shown = next;
          const job = owner.job;
          const queued = job ? queue.indexOf(job) : -1;
          if (queued < 0) return;
          queue.splice(queued, 1);
          enqueue(job!);
          pump();
        },
        dispose() {
          closed = true;
          cancel(owner, new Error("Review closed"));
          pump();
        },
      };
    },
  };
}

let pool: ReturnType<typeof createPatchPool> | undefined;

/**
 * A patch parser on the shared workers. It keeps only its latest request, so
 * one workspace's load never cancels another's. `shown`: its view is on
 * screen, until `show(false)`.
 */
export function createPatchParser({ shown = false } = {}) {
  pool ??= createPatchPool(patchWorkerCount());
  return pool.parser(shown);
}
