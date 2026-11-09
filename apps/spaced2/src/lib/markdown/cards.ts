import { useEffect, useRef, useSyncExternalStore } from "react";
import { plainCard, type RenderedCard } from "./model";
import type { RenderTask } from "./render.worker";

/**
 * Card Markdown, rendered in a worker and kept by source text. The first
 * load has no Markdown, KaTeX or highlighter code: the worker loads them,
 * and KaTeX and the highlighter only for a card that needs them. A card
 * that review preloads is ready before it shows, so the next card after a
 * grade paints from this cache in the same frame.
 */
export type { RenderedCard };

const LIMIT = 256;
const cache = new Map<string, RenderedCard>();
/** Renders that failed show their source; the next request tries again. */
const failed = new Map<string, RenderedCard>();
const listeners = new Set<() => void>();
type Pending = {
  id: number;
  priority: RenderTask["priority"];
  promise: Promise<RenderedCard>;
  resolve(card: RenderedCard): void;
};
const pending = new Map<string, Pending>();
const byId = new Map<number, string>();
let nextId = 1;

let worker: Worker | undefined;
let workerFailed = false;
function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
      type: "module",
      name: "markdown",
    });
    worker.onmessage = (
      event: MessageEvent<
        { id: number; result: RenderedCard } | { id: number; error: string }
      >,
    ) => {
      const text = byId.get(event.data.id);
      if (text === undefined) return;
      if ("result" in event.data) return void settle(text, event.data.result);
      console.error("Could not render a card", event.data.error);
      void settle(text, plainCard(text), { keep: false });
    };
    worker.onerror = (event) => {
      console.error("The Markdown worker stopped", event.message);
      workerFailed = true;
      worker?.terminate();
      worker = undefined;
      for (const text of [...pending.keys()])
        void settle(text, plainCard(text), { keep: false });
    };
  } catch (error) {
    console.error("Could not start the Markdown worker", error);
    workerFailed = true;
  }
  return worker;
}

let mathStyles: Promise<unknown> | undefined;
/** KaTeX's CSS, once a card with maths renders. Its fonts load as used. */
const loadMathStyles = () =>
  (mathStyles ??= import("katex/dist/katex.min.css").catch(() => {}));

let diagrams: Promise<typeof import("pele/lazy")> | undefined;
/** Loads Pele's code for these diagrams' types, before their card shows. */
function loadDiagrams(sources: string[]) {
  diagrams ??= import("pele/lazy");
  return diagrams
    .then((pele) =>
      Promise.all(sources.map((s) => pele.load(pele.detectType(s)))),
    )
    .catch(() => {
      // The card draws when it shows, and loads what it needs then.
      diagrams = undefined;
    });
}

/**
 * Resolves a render. A failed one (`keep: false`) shows its source text
 * where it is on screen, and is not cached: a later request tries again.
 */
async function settle(
  text: string,
  card: RenderedCard,
  { keep = true }: { keep?: boolean } = {},
) {
  const task = pending.get(text);
  if (!task) return;
  byId.delete(task.id);
  // The card shows with its styles, so maths never flashes unstyled.
  if (card.math) await loadMathStyles();
  pending.delete(text);
  if (card.diagrams.length) void loadDiagrams(card.diagrams);
  if (keep) {
    failed.delete(text);
    cache.set(text, card);
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
  } else {
    if (failed.size >= 64) failed.clear();
    failed.set(text, card);
  }
  task.resolve(card);
  listeners.forEach((listener) => listener());
}

/** The rendered card, if it is ready. */
export function cachedCard(text: string) {
  return cache.get(text);
}

/**
 * Renders a card side. "now" is for a card on screen; "later" waits behind
 * every card on screen.
 */
export function renderCard(
  text: string,
  priority: RenderTask["priority"] = "now",
): Promise<RenderedCard> {
  const ready = cache.get(text);
  if (ready) return Promise.resolve(ready);
  const waiting = pending.get(text);
  if (waiting) {
    if (waiting.priority === "later" && priority === "now") {
      waiting.priority = "now";
      getWorker()?.postMessage({
        id: waiting.id,
        text,
        base: location.href,
        priority,
      } satisfies RenderTask);
    }
    return waiting.promise;
  }
  let resolve!: (card: RenderedCard) => void;
  const promise = new Promise<RenderedCard>((done) => (resolve = done));
  const task: Pending = { id: nextId++, priority, promise, resolve };
  pending.set(text, task);
  byId.set(task.id, text);
  const target = getWorker();
  if (target)
    target.postMessage({
      id: task.id,
      text,
      base: location.href,
      priority,
    } satisfies RenderTask);
  // Without a worker, the card shows its text as written.
  else void settle(text, plainCard(text), { keep: false });
  return promise;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The rendered card for `text`, or undefined until it is ready.
 * `keepPrevious` shows the last text's card until the new one is ready, as
 * a preview does while its text changes.
 */
export function useRenderedCard(
  text: string,
  { keepPrevious = false }: { keepPrevious?: boolean } = {},
) {
  const card = useSyncExternalStore(
    subscribe,
    () => cache.get(text) ?? failed.get(text),
  );
  // The cache can drop a card that is on screen; it stays.
  const last = useRef<{ text: string; card: RenderedCard }>();
  if (card) last.current = { text, card };
  useEffect(() => {
    if (!cache.has(text)) void renderCard(text);
  }, [text]);
  if (card) return card;
  if (last.current && (keepPrevious || last.current.text === text))
    return last.current.card;
  return undefined;
}
