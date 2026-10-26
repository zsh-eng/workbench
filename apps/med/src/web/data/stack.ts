import { useCallback, useSyncExternalStore } from "react";
import type { Comparison } from "../../shared/protocol";
import type {
  PartShape,
  PullRequestState,
  SavedReview,
  SavedReviewTarget,
} from "../../shared/saved-review";

/**
 * A stack's or a set's parts as the Review shows them (docs/STACKS.md): the
 * shown version's comparisons, bottom first, each with its part's title,
 * state, and counts.
 */
export interface StackLayer {
  /** From 1, bottom first. */
  number: number;
  /** The part's ID, or the target's for a comparison without a part. */
  id: string;
  title: string;
  state?: PullRequestState;
  pullRequestUrl?: string;
  pullRequestTitle?: string;
  /** The branches of its base and head, as the agent named them. */
  base?: string;
  head?: string;
  target: SavedReviewTarget;
  files?: number;
  additions?: number;
  deletions?: number;
  comments: number;
}

export interface Stack {
  shape: PartShape;
  layers: StackLayer[];
  /** The base branch under the bottom layer, such as main. */
  base: string;
}

/** The parts of the version that shows `targetId`, or of the latest version. */
export function stackOf(saved: SavedReview | null | undefined, targetId: string | null) {
  if (!saved?.parts) return null;
  const iterations = saved.iterations ?? [];
  const iteration =
    (targetId && iterations.find((entry) => entry.targetIds.includes(targetId))) ||
    iterations.at(-1);
  const byId = new Map(saved.targets.map((target) => [target.id, target]));
  const own = (iteration?.targetIds ?? saved.targets.map((target) => target.id)).flatMap(
    (id) => byId.get(id) ?? [],
  );
  const targets = own.filter((target) => !target.commentReviewId);
  if (!targets.length) return null;
  const order = new Map(saved.parts.items.map((part, index) => [part.id, index]));
  const sorted = targets.toSorted(
    (a, b) =>
      (order.get(a.part ?? "") ?? targets.indexOf(a) + 1000) -
      (order.get(b.part ?? "") ?? targets.indexOf(b) + 1000),
  );
  const layers = sorted.map((target, index): StackLayer => {
    const part = saved.parts!.items.find((entry) => entry.id === target.part);
    const totals = part ? saved.partTotals?.[part.id] : undefined;
    const counts = totals?.targetId === target.id ? totals : undefined;
    return {
      number: index + 1,
      id: part?.id ?? target.id,
      title: part?.title ?? target.label,
      ...(part?.state && { state: part.state }),
      ...(part?.pullRequestUrl && { pullRequestUrl: part.pullRequestUrl }),
      ...(part?.pullRequestTitle && { pullRequestTitle: part.pullRequestTitle }),
      ...((part?.base ?? target.names?.base) && { base: part?.base ?? target.names?.base }),
      ...((part?.head ?? target.names?.head) && { head: part?.head ?? target.names?.head }),
      target,
      ...(counts && {
        files: counts.files,
        additions: counts.additions,
        deletions: counts.deletions,
      }),
      comments: counts?.comments ?? 0,
    };
  });
  return {
    shape: saved.parts.shape,
    layers,
    base: layers[0]?.base ?? "base",
  } satisfies Stack;
}

/** Layers `from` to `to` (indexes, either order) as one comparison: from the
 * lower one's base to the upper one's head. Both are commits, so the
 * comparison never changes and caches. */
export function layerRange(layers: readonly StackLayer[], from: number, to: number): Comparison {
  const low = layers[Math.min(from, to)]!.target;
  const high = layers[Math.max(from, to)]!.target;
  return { kind: "range", base: low.base, head: high.head, mergeBase: true };
}

/** The layers that a comparison spans, when it is a range of this stack. */
export function rangeOf(layers: readonly StackLayer[], comparison: Comparison) {
  if (comparison.kind !== "range") return null;
  const from = layers.findIndex((layer) => layer.target.base === comparison.base);
  const to = layers.findLastIndex((layer) => layer.target.head === comparison.head);
  return from >= 0 && to >= from ? { from, to } : null;
}

/** A layer's review state in the sidebar's strip and the rail. */
export type LayerProgress = "unreviewed" | "progress" | "approved" | "changes";

export const progressLabels: Record<LayerProgress, string> = {
  unreviewed: "Unreviewed",
  progress: "In progress",
  approved: "Approved",
  changes: "Changes requested",
};

/** Every file viewed is a verdict: approved, or changes requested when the
 * reader commented. Some files viewed, or a comment, is in progress. */
export function layerProgress(
  viewed: number,
  files: number | undefined,
  comments: number,
): LayerProgress {
  if (files !== undefined && files > 0 && viewed >= files)
    return comments > 0 ? "changes" : "approved";
  return viewed > 0 || comments > 0 ? "progress" : "unreviewed";
}

/** The lowest layer that waits for review: not done, not merged or closed. */
export function nextUnreviewed(
  layers: readonly { state?: PullRequestState }[],
  progress: readonly LayerProgress[],
) {
  return layers.findIndex(
    (layer, index) =>
      layer.state !== "merged" &&
      layer.state !== "closed" &&
      progress[index] !== "approved" &&
      progress[index] !== "changes",
  );
}

/**
 * How many of each layer's files the reader viewed, by target ID, so the
 * sidebar can draw a stack's progress without its diffs. The Review writes
 * it when a layer shows and when its marks change (`med:layers:v1:<review>`).
 */
const PREFIX = "med:layers:v1:";
type Counts = Readonly<Record<string, { viewed: number; files: number }>>;
const EMPTY: Counts = {};
const cache = new Map<string, Counts>();
const listeners = new Map<string, Set<() => void>>();
let listening = false;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(review: string): Counts {
  const cached = cache.get(review);
  if (cached) return cached;
  let counts: Counts = EMPTY;
  try {
    const raw = storage()?.getItem(PREFIX + review);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") counts = parsed as Counts;
  } catch {
    /* Unreadable counts start empty. */
  }
  cache.set(review, counts);
  return counts;
}

/** Records how many of a layer's files are viewed. */
export function setLayerViewed(review: string, targetId: string, viewed: number, files: number) {
  const current = read(review);
  const before = current[targetId];
  if (before?.viewed === viewed && before.files === files) return;
  // A thread keeps the counts of its newest 64 comparisons.
  const entries = Object.entries(current).filter(([id]) => id !== targetId);
  const next = Object.fromEntries([...entries.slice(-63), [targetId, { viewed, files }]]);
  cache.set(review, next);
  try {
    storage()?.setItem(PREFIX + review, JSON.stringify(next));
  } catch {
    /* The counts still apply to this window. */
  }
  for (const listener of listeners.get(review) ?? []) listener();
}

function subscribe(review: string, listener: () => void) {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("storage", (event) => {
      if (!event.key?.startsWith(PREFIX)) return;
      const review = event.key.slice(PREFIX.length);
      cache.delete(review);
      for (const listener of listeners.get(review) ?? []) listener();
    });
  }
  let set = listeners.get(review);
  if (!set) listeners.set(review, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** Each layer's viewed count, by target ID. */
export function useLayerViewed(review: string | null): Counts {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => (review ? subscribe(review, listener) : () => {}),
      [review],
    ),
    () => (review ? read(review) : EMPTY),
    () => EMPTY,
  );
}

/** A layer that the sidebar asks a thread to show once it opens. */
const requests = new Map<string, string>();
const requestListeners = new Set<() => void>();

export function requestLayer(reviewId: string, partId: string) {
  requests.set(reviewId, partId);
  for (const listener of requestListeners) listener();
}

/** The thread's requested layer, which only one taker gets. */
export function takeLayer(reviewId: string) {
  const part = requests.get(reviewId);
  requests.delete(reviewId);
  return part;
}

export function peekLayer(reviewId: string) {
  return requests.get(reviewId);
}

export function subscribeLayers(listener: () => void) {
  requestListeners.add(listener);
  return () => {
    requestListeners.delete(listener);
  };
}
