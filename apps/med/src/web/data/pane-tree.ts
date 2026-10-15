/**
 * A workspace's panes as a tree of splits, as in a tiling window manager: a
 * split lays out its children in a row or a column, each with a share of the
 * split's length. Every function here returns a new tree and keeps the input.
 */

export type Axis = "row" | "column";
export interface PaneLeaf {
  id: string;
}
export interface PaneSplit {
  axis: Axis;
  children: PaneNode[];
  /** Each child's share of the split's length; they add up to 1. */
  sizes: number[];
}
export type PaneNode = PaneLeaf | PaneSplit;
/** Where a new pane goes, next to another pane. */
export type Side = "left" | "right" | "above" | "below";
export type Direction = Side;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** The gap between two children of a split, which resizes them. */
export interface Gutter {
  /** Child indexes from the root to the split. */
  path: number[];
  /** The gutter follows this child. */
  index: number;
  axis: Axis;
  rect: Rect;
  /** The split's length along its axis, less its gaps, in pixels. */
  length: number;
}

export const isSplit = (node: PaneNode): node is PaneSplit => "axis" in node;

/** The smallest pane, in pixels, along each axis. */
export const MIN_WIDTH = 220;
export const MIN_HEIGHT = 120;

export function leaves(node: PaneNode | null): string[] {
  if (!node) return [];
  return isSplit(node) ? node.children.flatMap(leaves) : [node.id];
}

export function has(node: PaneNode | null, id: string) {
  return leaves(node).includes(id);
}

/** The smallest box that shows every pane of `node` at its smallest. */
export function minimum(node: PaneNode, gap: number): { width: number; height: number } {
  if (!isSplit(node)) return { width: MIN_WIDTH, height: MIN_HEIGHT };
  const children = node.children.map((child) => minimum(child, gap));
  const gaps = gap * (children.length - 1);
  return node.axis === "row"
    ? {
        width: children.reduce((sum, child) => sum + child.width, gaps),
        height: Math.max(...children.map((child) => child.height)),
      }
    : {
        width: Math.max(...children.map((child) => child.width)),
        height: children.reduce((sum, child) => sum + child.height, gaps),
      };
}

/**
 * The panes that fit in `box`. Panes leave in `order` until the rest fit at
 * their smallest; the panes in `keep` stay. When the kept panes do not fit
 * either, only `last` shows, as on a phone.
 */
export function fit(
  root: PaneNode | null,
  box: Rect,
  gap: number,
  keep: readonly string[],
  last: string | null,
): PaneNode | null {
  const fits = (node: PaneNode) => {
    const size = minimum(node, gap);
    return size.width <= box.width && size.height <= box.height;
  };
  if (!root || box.width <= 0 || fits(root)) return root;
  let tree: PaneNode | null = root;
  for (const id of leaves(root)) {
    if (keep.includes(id)) continue;
    tree = remove(tree, id);
    if (!tree || fits(tree)) return tree;
  }
  return tree && fits(tree) ? tree : last && has(root, last) ? { id: last } : tree;
}

const sideAxis = (side: Side): Axis => (side === "left" || side === "right" ? "row" : "column");
const before = (side: Side) => side === "left" || side === "above";

/** A split's sizes scaled to add up to 1. */
function normalized(sizes: number[]) {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  return total > 0 ? sizes.map((size) => size / total) : sizes.map(() => 1 / sizes.length);
}

/** A split with one child becomes that child; a child split along the same axis joins its parent. */
function tidy(node: PaneNode): PaneNode {
  if (!isSplit(node)) return node;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, index) => {
    const next = tidy(child);
    const size = node.sizes[index] ?? 0;
    if (isSplit(next) && next.axis === node.axis) {
      next.children.forEach((grandchild, at) => {
        children.push(grandchild);
        sizes.push(size * (next.sizes[at] ?? 0));
      });
    } else {
      children.push(next);
      sizes.push(size);
    }
  });
  if (children.length === 1) return children[0]!;
  return { axis: node.axis, children, sizes: normalized(sizes) };
}

/**
 * Adds a pane beside another one, taking `share` of that pane's room. Without
 * `near`, or when `near` is not open, the pane goes beside the whole layout.
 */
export function insert(
  root: PaneNode | null,
  id: string,
  { near, side = "right", share = 0.5 }: { near?: string; side?: Side; share?: number } = {},
): PaneNode {
  const leaf: PaneLeaf = { id };
  const base = remove(root, id);
  if (!base) return leaf;
  const axis = sideAxis(side);
  const pair = (node: PaneNode): PaneSplit => ({
    axis,
    children: before(side) ? [leaf, node] : [node, leaf],
    sizes: before(side) ? [share, 1 - share] : [1 - share, share],
  });
  if (!near || !has(base, near)) return tidy(pair(base));
  const visit = (node: PaneNode): PaneNode => {
    if (!isSplit(node)) return node.id === near ? pair(node) : node;
    const index = node.children.findIndex((child) => !isSplit(child) && child.id === near);
    if (index >= 0 && node.axis === axis) {
      // A sibling in the same direction takes its share from the pane beside it.
      const children = [...node.children];
      const sizes = [...node.sizes];
      const room = sizes[index]!;
      sizes[index] = room * (1 - share);
      const at = before(side) ? index : index + 1;
      children.splice(at, 0, leaf);
      sizes.splice(at, 0, room * share);
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(visit) };
  };
  return tidy(visit(base));
}

/** Closes a pane; the pane beside it takes its room. */
export function remove(root: PaneNode | null, id: string): PaneNode | null {
  if (!root) return null;
  if (!isSplit(root)) return root.id === id ? null : root;
  const kept: { node: PaneNode; size: number }[] = [];
  // The room of a closed first child goes to the next one.
  let room = 0;
  root.children.forEach((child, index) => {
    const next = remove(child, id);
    const size = root.sizes[index] ?? 0;
    if (next) {
      kept.push({ node: next, size: size + room });
      room = 0;
    } else if (kept.length) kept[kept.length - 1]!.size += size;
    else room += size;
  });
  if (!kept.length) return null;
  return tidy({
    axis: root.axis,
    children: kept.map((entry) => entry.node),
    sizes: normalized(kept.map((entry) => entry.size)),
  });
}

/** The split at a path of child indexes, if there is one. */
function splitAt(root: PaneNode, path: number[]): PaneSplit | undefined {
  let node: PaneNode | undefined = root;
  for (const index of path) node = node && isSplit(node) ? node.children[index] : undefined;
  return node && isSplit(node) ? node : undefined;
}

function replaceAt(root: PaneNode, path: number[], next: PaneNode): PaneNode {
  if (!path.length) return next;
  if (!isSplit(root)) return root;
  const [index, ...rest] = path;
  return {
    ...root,
    children: root.children.map((child, at) =>
      at === index ? replaceAt(child, rest, next) : child,
    ),
  };
}

/**
 * Moves the boundary after child `index` of the split at `path` by `delta`
 * pixels; `length` is the split's length less its gaps. Neither child gets
 * smaller than the smallest pane.
 */
export function resize(
  root: PaneNode,
  path: number[],
  index: number,
  delta: number,
  length: number,
  gap = 0,
): PaneNode {
  const split = splitAt(root, path);
  if (!split || index < 0 || index + 1 >= split.children.length || length <= 0) return root;
  // A child that is a split keeps room for each of its panes.
  const min = (child: PaneNode) => {
    const size = minimum(child, gap);
    return (split.axis === "row" ? size.width : size.height) / length;
  };
  const a = split.sizes[index]!;
  const b = split.sizes[index + 1]!;
  const pair = a + b;
  const lowest = Math.min(min(split.children[index]!), pair / 2);
  const highest = pair - Math.min(min(split.children[index + 1]!), pair / 2);
  const next = Math.max(lowest, Math.min(highest, a + delta / length));
  const sizes = [...split.sizes];
  sizes[index] = next;
  sizes[index + 1] = pair - next;
  return replaceAt(root, path, { ...split, sizes });
}

/** Sets the sizes of the split at `path`, such as to restore a drag. */
export function withSizes(root: PaneNode, path: number[], sizes: number[]): PaneNode {
  const split = splitAt(root, path);
  if (!split || sizes.length !== split.children.length) return root;
  return replaceAt(root, path, { ...split, sizes: normalized(sizes) });
}

/** Gives every pane of each split the same share. */
export function balance(node: PaneNode): PaneNode {
  if (!isSplit(node)) return node;
  return {
    ...node,
    children: node.children.map(balance),
    sizes: node.children.map(() => 1 / node.children.length),
  };
}

/** Whether every split already gives its panes the same share. */
export function balanced(node: PaneNode | null): boolean {
  if (!node || !isSplit(node)) return true;
  const even = 1 / node.children.length;
  return node.sizes.every((size) => Math.abs(size - even) < 0.01) && node.children.every(balanced);
}

/** Whether two layouts put the same panes in the same splits, whatever their sizes. */
export function sameShape(a: PaneNode | null, b: PaneNode | null): boolean {
  if (!a || !b) return a === b;
  if (!isSplit(a) || !isSplit(b)) return !isSplit(a) && !isSplit(b) && a.id === b.id;
  return (
    a.axis === b.axis &&
    a.children.length === b.children.length &&
    a.children.every((child, index) => sameShape(child, b.children[index]!))
  );
}

/** Exchanges the places of two panes; every size stays. */
export function swap(root: PaneNode, a: string, b: string): PaneNode {
  if (!isSplit(root)) return root.id === a ? { id: b } : root.id === b ? { id: a } : root;
  return { ...root, children: root.children.map((child) => swap(child, a, b)) };
}

/** Moves a pane to a side of another, which gives it half of its room. */
export function move(root: PaneNode, id: string, near: string, side: Side): PaneNode {
  if (id === near || !has(root, id) || !has(root, near)) return root;
  const rest = remove(root, id);
  return rest ? insert(rest, id, { near, side, share: 0.5 }) : root;
}

/** A split's sizes in pixels. A child below its smallest size grows to it, and
 * the others give up the room in proportion to what they have above theirs. */
function fitted(node: PaneSplit, length: number, gap: number) {
  const along = (child: PaneNode) => {
    const size = minimum(child, gap);
    return node.axis === "row" ? size.width : size.height;
  };
  const mins = node.children.map(along);
  const sizes = node.children.map((_, index) => length * (node.sizes[index] ?? 0));
  const deficit = sizes.reduce((sum, size, index) => sum + Math.max(0, mins[index]! - size), 0);
  const spare = sizes.reduce((sum, size, index) => sum + Math.max(0, size - mins[index]!), 0);
  if (deficit <= 0 || spare <= 0) return sizes;
  const taken = Math.min(deficit, spare);
  return sizes.map((size, index) =>
    size < mins[index]! ? mins[index]! : size - ((size - mins[index]!) / spare) * taken,
  );
}

/** Each pane's rectangle and each gutter in `box`, with `gap` pixels between panes. */
export function layout(root: PaneNode | null, box: Rect, gap: number) {
  const panes = new Map<string, Rect>();
  const gutters: Gutter[] = [];
  const place = (node: PaneNode, rect: Rect, path: number[]) => {
    if (!isSplit(node)) {
      panes.set(node.id, rect);
      return;
    }
    const row = node.axis === "row";
    const total = row ? rect.width : rect.height;
    const length = Math.max(0, total - gap * (node.children.length - 1));
    const sizes = fitted(node, length, gap);
    let offset = row ? rect.x : rect.y;
    const end = offset + total;
    node.children.forEach((child, index) => {
      const last = index === node.children.length - 1;
      // Whole pixels; the last child takes what rounding left.
      const size = last ? end - offset : Math.round(sizes[index]!);
      const childRect = row
        ? { x: offset, y: rect.y, width: size, height: rect.height }
        : { x: rect.x, y: offset, width: rect.width, height: size };
      place(child, childRect, [...path, index]);
      offset += size;
      if (!last) {
        gutters.push({
          path,
          index,
          axis: node.axis,
          length,
          rect: row
            ? { x: offset, y: rect.y, width: gap, height: rect.height }
            : { x: rect.x, y: offset, width: rect.width, height: gap },
        });
        offset += gap;
      }
    });
  };
  if (root) place(root, box, []);
  return { panes, gutters };
}

/** The pane next to `id` in a direction: the one that shares the most of its edge. */
export function neighbor(rects: ReadonlyMap<string, Rect>, id: string, direction: Direction) {
  const from = rects.get(id);
  if (!from) return undefined;
  let best: { id: string; overlap: number; distance: number } | undefined;
  for (const [other, rect] of rects) {
    if (other === id) continue;
    const horizontal = direction === "left" || direction === "right";
    const distance =
      direction === "left"
        ? from.x - (rect.x + rect.width)
        : direction === "right"
          ? rect.x - (from.x + from.width)
          : direction === "above"
            ? from.y - (rect.y + rect.height)
            : rect.y - (from.y + from.height);
    if (distance < -1) continue;
    const overlap = horizontal
      ? Math.min(from.y + from.height, rect.y + rect.height) - Math.max(from.y, rect.y)
      : Math.min(from.x + from.width, rect.x + rect.width) - Math.max(from.x, rect.x);
    if (overlap <= 0) continue;
    if (!best || distance < best.distance || (distance === best.distance && overlap > best.overlap))
      best = { id: other, overlap, distance };
  }
  return best?.id;
}

/** A tree read back from storage, or null when it is not one. */
export function parseTree(value: unknown, known?: (id: string) => boolean): PaneNode | null {
  const read = (node: unknown, depth: number): PaneNode | null => {
    if (!node || typeof node !== "object" || depth > 8) return null;
    const entry = node as Record<string, unknown>;
    if (typeof entry.id === "string") return !known || known(entry.id) ? { id: entry.id } : null;
    if (
      (entry.axis !== "row" && entry.axis !== "column") ||
      !Array.isArray(entry.children) ||
      !Array.isArray(entry.sizes) ||
      entry.children.length !== entry.sizes.length
    )
      return null;
    const children: PaneNode[] = [];
    const sizes: number[] = [];
    const shares = entry.sizes as unknown[];
    entry.children.forEach((child, index) => {
      const next = read(child, depth + 1);
      const size = shares[index];
      if (next && typeof size === "number" && size > 0) {
        children.push(next);
        sizes.push(size);
      }
    });
    if (!children.length) return null;
    return tidy({ axis: entry.axis, children, sizes: normalized(sizes) });
  };
  const tree = read(value, 0);
  // Each pane shows once.
  const ids = leaves(tree);
  return ids.length === new Set(ids).size ? tree : null;
}
