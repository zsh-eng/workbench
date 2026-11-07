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
