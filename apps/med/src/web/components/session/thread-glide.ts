// A thread that follows its end moves the view to the end as soon as new
// content lands, so the content jumps up by the new block's height in one
// frame. The glide takes that move over (FLIP): the scroll position goes to
// the end at once, as before, and the content starts where it was, shifted
// down by the same distance with a transform, then slides into place.
//
// Only the transform animates. The compositor runs the animation without
// layout or paint on the main thread, which is busy rendering the Markdown
// that streams in. The scroll position is already final, so following,
// anchoring, the range of units, and the reader's inputs read the same
// numbers as without the glide; offsetTop and sizes ignore transforms.

/** How long the content takes to slide into place. */
const GLIDE_MS = 320;
/** Quick at the start and soft at the end, like the blocks' fade. */
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

/**
 * Glides `content` into place after the view that holds it moves down by a
 * distance at once. A move longer than `max` jumps: the content above the
 * view's new range may not be rendered.
 */
export function glideContent(content: HTMLElement, max: number) {
  const reduced = content.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)");
  let slide: Animation | undefined;
  return {
    /** The view moved down by `distance` to follow its end. */
    moved(distance: number) {
      if (distance < 0.5 || reduced?.matches) return;
      // A glide under way: the content is still this far below its place.
      let from = distance;
      if (slide?.playState === "running") {
        from += new DOMMatrixReadOnly(getComputedStyle(content).transform).m42;
        slide.cancel();
      }
      slide = undefined;
      if (from > max) return;
      slide = content.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], {
        duration: GLIDE_MS,
        easing: EASING,
      });
    },
    /** The view jumped, as to the latest work: no glide is left over. */
    stop() {
      slide?.cancel();
      slide = undefined;
    },
  };
}
