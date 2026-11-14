// A thread's view follows its end while the agent writes, and lets go at the
// reader's first sign of a move up, as chat views do (shadcn's
// MessageScroller, use-stick-to-bottom). The signs are inputs: a wheel up, a
// touch that drags the content down, a key that scrolls up, a selection that
// the reader drags. Each lets go at the input, before the view's next write: a
// view that still followed would undo a small move with that write, or cancel
// a smooth scroll, and text that streams in writes each frame.
//
// A move of the view is the reader's only after such an input or while a
// pointer is down in the view, as on its scroll bar. Other moves are the
// browser's, such as its clamp when the thread gets shorter, and do not let go.
// The view follows again when the reader takes it to the end, or when the
// thread gets shorter and its end comes to the view; a view that does not move
// does not, so a reader a few pixels up stays there. A wheel or a key that
// goes past the end follows at the input: the browser scrolls a wheel before
// it sends the event, and stops at the end as it was then, which text that
// streams in has moved on.

/** Within this distance of its end, a view is at the end. */
const END = 32;
/** How long after an input a move up is still the reader's. */
const RECENT = 500;
/** How far an arrow key scrolls. */
const LINE = 40;

/** Whether the view is at its end. */
export function atEnd(node: HTMLElement) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < END;
}

/** How far a key scrolls a focused view down, and up as a negative distance. */
function keyDistance(event: KeyboardEvent, node: HTMLElement) {
  const page = node.clientHeight;
  // ⌘↑ and ⌘↓ go to the start and the end on a Mac.
  if (event.key === "ArrowDown") return event.metaKey ? Infinity : LINE;
  if (event.key === "ArrowUp") return event.metaKey ? -Infinity : -LINE;
  if (event.key === "PageDown") return page;
  if (event.key === "PageUp") return -page;
  if (event.key === "End") return Infinity;
  if (event.key === "Home") return -Infinity;
  // Space on a button in the view presses it.
  if (event.key === " " && event.target === node) return event.shiftKey ? -page : page;
  return 0;
}

/**
 * Reads the reader's moves in a view that follows its end, through `stuck`.
 * `changed` runs when an input lets go or follows, before the view moves.
 * The caller calls `check` on scroll and before it follows, and `wrote`
 * after each move that it makes itself, so the next check does not take it
 * for the reader's.
 */
export function followEnd(node: HTMLElement, stuck: { current: boolean }, changed = () => {}) {
  let top = node.scrollTop;
  // When the reader last showed a move up or let go of the pointer, and
  // whether a pointer is down in the view.
  let up = Number.NEGATIVE_INFINITY;
  let pressed = false;
  let touch: number | undefined;
  // The reader moves the view by this distance, up when it is negative.
  const move = (distance: number) => {
    let follows = stuck.current;
    // Up lets go, unless the view is at its top.
    if (distance < 0) {
      up = performance.now();
      if (node.scrollTop > 0) follows = false;
    }
    // Down to the end, or past it, follows.
    else if (node.scrollHeight - node.scrollTop - node.clientHeight - distance < END)
      follows = true;
    if (follows === stuck.current) return;
    stuck.current = follows;
    changed();
  };
  const onWheel = (event: WheelEvent) => {
    // A pinch is a wheel with Control, and a wheel across a wide block scrolls it.
    if (!event.deltaY || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    // A region inside the view that can scroll that way takes the wheel.
    for (
      let at = event.target instanceof Element ? event.target : null;
      at && at !== node;
      at = at.parentElement
    )
      if (
        (event.deltaY < 0 ? at.scrollTop > 0 : at.scrollTop + at.clientHeight < at.scrollHeight) &&
        /auto|scroll/.test(getComputedStyle(at).overflowY)
      )
        return;
    const scale = [1, LINE, node.clientHeight][event.deltaMode] ?? 1;
    move(event.deltaY * scale);
  };
  const onTouchStart = (event: TouchEvent) => {
    touch = event.touches[0]?.clientY;
  };
  // A finger that moves down drags the content down: the view goes up.
  const onTouchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY;
    if (y === undefined) return;
    if (touch !== undefined && y > touch) move(touch - y);
    touch = y;
  };
  const onKey = (event: KeyboardEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.defaultPrevented || target?.closest("input, textarea, select, [contenteditable]"))
      return;
    // Focus that moves can scroll an element above into view.
    if (event.key === "Tab") {
      up = performance.now();
      return;
    }
    const distance = keyDistance(event, node);
    // Keys scroll the view that has focus; elsewhere, a move up that follows is the reader's.
    if (target && node.contains(target)) {
      if (distance) move(distance);
    } else if (distance < 0) up = performance.now();
  };
  const onPress = () => {
    pressed = true;
  };
  // The last scroll of a drag in the view can come after its pointer's release.
  const onRelease = () => {
    if (pressed) up = performance.now();
    pressed = false;
  };
  // A selection that the reader drags in the view: the text holds still under it.
  const onSelect = () => {
    const selection = node.ownerDocument.getSelection();
    if (pressed && selection && !selection.isCollapsed && node.contains(selection.anchorNode))
      move(-1);
  };
  const doc = node.ownerDocument;
  node.addEventListener("wheel", onWheel, { passive: true });
  node.addEventListener("touchstart", onTouchStart, { passive: true });
  node.addEventListener("touchmove", onTouchMove, { passive: true });
  node.addEventListener("pointerdown", onPress);
  doc.addEventListener("pointerup", onRelease);
  doc.addEventListener("pointercancel", onRelease);
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("selectionchange", onSelect);
  return {
    /** Reads the move since the last check or write. */
    check() {
      // A hidden view has no place to read.
      if (!node.clientHeight) return;
      const y = node.scrollTop;
      const gap = node.scrollHeight - y - node.clientHeight;
      if (y + 1 < top) {
        // The browser's clamp, as the thread gets shorter, leaves the view at its very end.
        if (gap >= 1 && (pressed || performance.now() - up < RECENT)) stuck.current = false;
        else if (gap < END) stuck.current = true;
      } else if (y > top + 1 && gap < END) stuck.current = true;
      top = y;
    },
    /** The view moved itself. */
    wrote() {
      top = node.scrollTop;
    },
    dispose() {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("pointerdown", onPress);
      doc.removeEventListener("pointerup", onRelease);
      doc.removeEventListener("pointercancel", onRelease);
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("selectionchange", onSelect);
    },
  };
}
