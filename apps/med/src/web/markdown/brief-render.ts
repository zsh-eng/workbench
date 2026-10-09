import { resolveTheme } from "@pierre/diffs";
import type { MarkdownResult } from "./model";
import RenderWorker from "./render.worker?worker";

// One worker renders the briefs of every workspace in this window. Results are
// kept by theme and text, so a brief that rendered once, or ahead of time for a
// hidden workspace or another iteration, shows in the frame it is chosen.
const MAX_RESULTS = 24;
const results = new Map<string, MarkdownResult>();
const waiting = new Map<string, Promise<MarkdownResult>>();
// The worker keeps only its latest message, so tasks go one at a time. A brief
// on screen goes before the ones rendered ahead.
const queue: { key: string; text: string; theme: string; run(): void }[] = [];
let worker: Worker | undefined;
let busy = false;
let sequence = 0;
const replies = new Map<number, (data: MarkdownResult & { error?: string }) => void>();

const keyOf = (theme: string, text: string) => `${theme}\0${text}`;

export function renderedBrief(theme: string, text: string) {
  return results.get(keyOf(theme, text));
}

export function renderBrief(theme: string, text: string, urgent = true) {
  const key = keyOf(theme, text);
  const done = results.get(key);
  if (done) return Promise.resolve(done);
  const queued = queue.findIndex((task) => task.key === key);
  if (queued > 0 && urgent) queue.unshift(...queue.splice(queued, 1));
  const existing = waiting.get(key);
  if (existing) return existing;
  const promise = new Promise<MarkdownResult>((resolve, reject) => {
    const task = {
      key,
      text,
      theme,
      run: () => void send(task.key, text, theme).then(resolve, reject),
    };
    if (urgent) queue.unshift(task);
    else queue.push(task);
  });
  waiting.set(key, promise);
  void promise.catch(() => {}).finally(() => waiting.delete(key));
  next();
  return promise;
}

function next() {
  if (busy) return;
  const task = queue.shift();
  if (!task) return;
  busy = true;
  task.run();
}

async function send(key: string, text: string, themeName: string) {
  try {
    const theme = await resolveTheme(themeName);
    worker ??= createWorker();
    const id = ++sequence;
    const data = await new Promise<MarkdownResult & { error?: string }>((resolve) => {
      replies.set(id, resolve);
      worker!.postMessage({ id, text, theme, briefLinks: true });
    });
    if (data.error) throw new Error(data.error);
    const result = {
      blocks: data.blocks,
      headings: data.headings,
      milliseconds: data.milliseconds,
    };
    results.delete(key);
    results.set(key, result);
    while (results.size > MAX_RESULTS) results.delete(results.keys().next().value!);
    return result;
  } finally {
    busy = false;
    next();
  }
}

function createWorker() {
  const instance = new RenderWorker();
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
