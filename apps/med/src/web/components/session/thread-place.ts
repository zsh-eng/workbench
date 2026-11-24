// A view inside a unit taller than itself, as in a long reply, keeps its
// place by the part of the unit at its top: a paragraph, a list item, a line
// of code. Its distance from the unit's top does not hold: a new width, as
// when the session rail or a pane beside the thread opens or closes, rewraps
// the text above, and the same distance lands paragraphs away. The browser's
// own scroll anchoring picks a box that starts in view the same way; the
// thread's is off, as it would count the virtual list's spacers.

/** A part of a unit, and where the view's top was against it. */
export interface PartPlace {
  part: Element;
  /** How far the view's top was below the part's top; negative above it. */
  delta: number;
  /** The part's height then: a view inside a part keeps its share of it. */
  height: number;
}

/**
 * The part of `unit` at `y`, a viewport coordinate: the first box in the
 * unit's order that starts at or below it and above `end`, so the text under
 * the view's top stays still; else the innermost box across it.
 */
export function partAt(unit: Element, y: number, end: number): PartPlace | undefined {
  let across: PartPlace | undefined;
  let stopped = false;
  // Walk descendants in pre-order, reading each box once and skipping subtrees
  // that end at or above the view's top.
  const visit = (parent: Element): PartPlace | undefined => {
    for (let node = parent.firstElementChild; node; node = node.nextElementSibling) {
      const box = node.getBoundingClientRect();
      if (!box.height || box.bottom <= y) continue;
      if (box.top >= end) {
        stopped = true;
        return undefined;
      }
      const place = { part: node, delta: y - box.top, height: box.height };
      if (box.top >= y) return place;
      across = place;
      const inner = visit(node);
      if (inner) return inner;
      if (stopped) return undefined;
    }
    return undefined;
  };
  return visit(unit) ?? across;
}

/**
 * How far the view scrolls to keep `place`, with its top at `y`, a viewport
 * coordinate; undefined when its part has left `unit`, as when its Markdown
 * renders. It reads where the part is on the page, not the list's offsets,
 * which lag the page within a resize.
 */
export function partMove(unit: Element, place: PartPlace, y: number): number | undefined {
  if (!unit.isConnected || !place.part.isConnected || !unit.contains(place.part)) return undefined;
  const box = place.part.getBoundingClientRect();
  if (!box.height) return undefined;
  // A view inside the part keeps its share of the part's height.
  const delta = place.delta > 0 ? (place.delta * box.height) / place.height : place.delta;
  return box.top + delta - y;
}
