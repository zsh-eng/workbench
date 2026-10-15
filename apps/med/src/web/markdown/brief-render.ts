import { resolveTheme } from "@pierre/diffs";
import type { MarkdownResult } from "./model";
import RenderWorker from "./render.worker?worker";

// One worker renders the briefs of every workspace in this window, and the
// replies of agent sessions. Results are kept by theme and text, so a brief
// that rendered once, or ahead of time for a hidden workspace or another
// iteration, shows in the frame it is chosen. Session replies have their own
// cache, so a long session does not push the briefs out.
export type RenderCache = "brief" | "session";
const MAX_RESULTS: Record<RenderCache, number> = { brief: 24, session: 200 };
const results: Record<RenderCache, Map<string, MarkdownResult>> = {
  brief: new Map(),
  session: new Map(),
};
const waiting = new Map<string, Promise<MarkdownResult>>();
// Tasks go to the worker in batches, which it renders in order with a reply
// to each, so a thread's replies do not wait for the page between them. A
// brief on screen goes before the ones rendered ahead. Two batches can be in
// flight: the page takes a batch's replies only when it is free, so a thread
// read ahead while a workspace mounts does not wait for that.
interface Task {
  key: string;
  text: string;
  theme: string;
  cache: RenderCache;
  keep: boolean;
  urgent: boolean;
  resolve(result: MarkdownResult): void;
  reject(error: unknown): void;
}
const queue: Task[] = [];
const BATCH = 8;
let worker: Worker | undefined;
/** Themes that the worker has; a batch names them rather than copying each. */
let workerThemes = new Set<string>();
const IN_FLIGHT = 2;
let inFlight = 0;
let flushing = false;
/** Themes as the worker takes them, once resolved, so a batch goes at once. */
const resolved = new Map<string, Awaited<ReturnType<typeof resolveTheme>>>();
let sequence = 0;
const replies = new Map<number, (data: MarkdownResult & { error?: string }) => void>();

const keyOf = (theme: string, text: string) => `${theme}\0${text}`;

export function renderedBrief(theme: string, text: string, cache: RenderCache = "brief") {
  return results[cache].get(keyOf(theme, text));
}

/**
 * Renders Markdown in the worker. `keep: false` renders without caching the
 * result, for the partial text of a reply that is still streaming.
 */
export function renderBrief(
  theme: string,
  text: string,
  urgent = true,
  options: { cache?: RenderCache; keep?: boolean } = {},
) {
  const promise = enqueue(theme, text, urgent, options);
  // The tasks of one turn, such as a thread's replies, go in one batch: a
  // batch can wait for the replies of the ones in flight, and the page can be busy.
  if (!flushing) {
    flushing = true;
    queueMicrotask(() => {
      flushing = false;
      next();
    });
  }
  return promise;
}

/** Renders several texts in one batch that goes to the worker now, before
 * the render that a store update just scheduled. */
export function renderBriefs(
  theme: string,
  texts: string[],
  urgent = true,
  options: { cache?: RenderCache; keep?: boolean } = {},
) {
  const promises = texts.map((text) => enqueue(theme, text, urgent, options));
  next();
  return promises;
}

function enqueue(
  theme: string,
  text: string,
  urgent: boolean,
  { cache = "brief", keep = true }: { cache?: RenderCache; keep?: boolean },
) {
  const done = results[cache].get(keyOf(theme, text));
  if (done) return Promise.resolve(done);
  const key = `${cache}\0${keep}\0${keyOf(theme, text)}`;
  const queued = queue.findIndex((task) => task.key === key);
  if (queued > 0 && urgent) queue.unshift({ ...queue.splice(queued, 1)[0]!, urgent });
  const existing = waiting.get(key);
  if (existing) return existing;
  const promise = new Promise<MarkdownResult>((resolve, reject) => {
    const task = { key, text, theme, cache, keep, urgent, resolve, reject };
    if (urgent) queue.unshift(task);
    else queue.push(task);
  });
  waiting.set(key, promise);
  void promise.catch(() => {}).finally(() => waiting.delete(key));
  return promise;
}

function next() {
  if (inFlight >= IN_FLIGHT || !queue.length) return;
  inFlight++;
  // Urgent tasks come first, and all of them go: the ones on screen.
  const urgent = queue.findIndex((task) => !task.urgent);
  void send(queue.splice(0, Math.max(BATCH, urgent < 0 ? queue.length : urgent))).finally(() => {
    inFlight--;
    next();
  });
}

async function send(tasks: Task[]) {
  const themes = new Map<string, ReturnType<typeof resolveTheme>>();
  const sent: { task: Task; id: number; theme: Awaited<ReturnType<typeof resolveTheme>> }[] = [];
  for (const task of tasks) {
    const known = resolved.get(task.theme);
    if (known) {
      sent.push({ task, id: ++sequence, theme: known });
      continue;
    }
    if (!themes.has(task.theme)) themes.set(task.theme, resolveTheme(task.theme));
    try {
      const theme = await themes.get(task.theme)!;
      resolved.set(task.theme, theme);
      sent.push({ task, id: ++sequence, theme });
    } catch (error) {
      task.reject(error);
    }
  }
  if (!sent.length) return;
  worker ??= createWorker();
  const done = sent.map(
    ({ task, id }) =>
      new Promise<void>((settle) =>
        replies.set(id, (data) => {
          settle();
          if (data.error) return task.reject(new Error(data.error));
          const result = {
            blocks: data.blocks,
            headings: data.headings,
            milliseconds: data.milliseconds,
          };
          if (task.keep) {
            const key = keyOf(task.theme, task.text);
            const kept = results[task.cache];
            kept.delete(key);
            kept.set(key, result);
            while (kept.size > MAX_RESULTS[task.cache]) kept.delete(kept.keys().next().value!);
          }
          task.resolve(result);
        }),
      ),
  );
  // Replies show web links as pills with their site's icon. In replies,
  // comments, and answers, $HOME and $3 are text: only $$ starts math.
  worker.postMessage({
    batch: sent.map(({ task, id, theme }) => {
      const known = workerThemes.has(task.theme);
      workerThemes.add(task.theme);
      return {
        id,
        text: task.text,
        ...(known ? { themeName: theme.name } : { theme }),
        briefLinks: true,
        webLinks: task.cache === "session",
        plainDollars: task.cache === "session",
      };
    }),
  });
  await Promise.all(done);
}

function createWorker() {
  const instance = new RenderWorker();
  workerThemes = new Set();
  instance.onmessage = ({ data }) => {
    const reply = replies.get(data.id);
    replies.delete(data.id);
    reply?.(data);
  };
  instance.onerror = () => {
    for (const reply of replies.values())
      reply({
        blocks: [],
        headings: [],
        milliseconds: 0,
        error: "The brief could not render. Reload the review to retry.",
      });
    replies.clear();
    instance.terminate();
    if (worker === instance) worker = undefined;
  };
  return instance;
}
