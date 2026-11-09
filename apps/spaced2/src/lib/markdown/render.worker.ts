/// <reference lib="webworker" />
import { renderCardMarkdown } from "./render";

/**
 * Renders card Markdown off the main thread. The card on screen ("now")
 * goes before the cards that review preloads ("later"); a later task that
 * the screen asks for moves to the front.
 */
export type RenderTask = {
  id: number;
  text: string;
  base: string;
  priority: "now" | "later";
};

const now: RenderTask[] = [];
const later: RenderTask[] = [];
let running = false;
let current: number | undefined;

self.onmessage = (event: MessageEvent<RenderTask>) => {
  const task = event.data;
  if (task.id === current) return;
  const waiting = later.findIndex((queued) => queued.id === task.id);
  if (waiting >= 0) {
    if (task.priority === "later") return;
    later.splice(waiting, 1);
  }
  (task.priority === "now" ? now : later).push(task);
  if (!running) void drain();
};

async function drain() {
  running = true;
  for (let task; (task = now.shift() ?? later.shift()); ) {
    current = task.id;
    try {
      const result = await renderCardMarkdown(task.text, task.base);
      self.postMessage({ id: task.id, result });
    } catch (error) {
      self.postMessage({
        id: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  current = undefined;
  running = false;
}
