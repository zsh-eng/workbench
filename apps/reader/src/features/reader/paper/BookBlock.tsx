import type { CSSProperties } from "react";

/**
 * The book around the page (Debug curl).
 *
 * A phone shows one page, the right-hand one, with the spine at the screen's
 * left edge. The book is still there: the leaves still to read lie under
 * this one, and those already read lie on the left-hand stack beyond the
 * spine. Each stack's height comes from its pages: book paper is about
 * 0.1 mm a leaf, and a phone page holds about 0.4 of a paperback's.
 *
 * - The unread stack's fore-edge shows at the right, as a band of leaf
 *   edges seen a little from the side, so it narrows as you read.
 * - The read stack stands at the spine and shades the gutter from the
 *   window (the room's key light comes from the upper left), so that shade
 *   widens as you read. Seen from above, the stack itself is off the
 *   screen; its shadow is what reaches this page.
 *
 * The turning leaf is the page less its fore-edge band, so a leaf laid
 * back down meets the stack's edge, and its shade falls over the band.
 */

/** Height of one phone page's share of a leaf on screen, CSS px. */
const PAGE_CALIPER_PX = 0.073;
/** How far the band of edges can widen: the page's margin is narrow. */
const MAX_FORE_EDGE_PX = 7;
/** Seen a little from the right: the share of the stack's height that shows. */
const SIDE_VIEW = 0.4;
/** The gutter's shade can reach this far, and darken by up to this much. */
const MAX_GUTTER_PX = 44;
const MAX_GUTTER_DEPTH = 14;

/** Px of the stage the unread stack's fore-edge takes, at the right. */
export function foreEdgeWidth(unreadPages: number): number {
  if (unreadPages <= 0) return 0;
  const seen = unreadPages * PAGE_CALIPER_PX * SIDE_VIEW;
  return Math.max(
    0.5,
    MAX_FORE_EDGE_PX * (1 - Math.exp(-seen / MAX_FORE_EDGE_PX)),
  );
}

/** How far the read stack's shade reaches into the gutter, and how dark. */
function gutterShade(readPages: number): { width: number; depth: number } {
  const height = readPages * PAGE_CALIPER_PX;
  return {
    width: Math.min(MAX_GUTTER_PX, 1.6 * height),
    depth: MAX_GUTTER_DEPTH * (1 - Math.exp(-height / 6)),
  };
}

export function BookBlock({
  readPages,
  unreadPages,
}: {
  readPages: number;
  unreadPages: number;
}) {
  const edge = foreEdgeWidth(unreadPages);
  const gutter = gutterShade(readPages);
  return (
    <>
      {gutter.width >= 1 && (
        <div
          className="reader-book-gutter"
          data-reader-book-gutter
          aria-hidden="true"
          style={
            {
              "--gutter-width": `${gutter.width.toFixed(2)}px`,
              "--gutter-depth": `${gutter.depth.toFixed(2)}%`,
            } as CSSProperties
          }
        />
      )}
      {edge > 0 && (
        <div
          className="reader-book-fore-edge"
          data-reader-book-fore-edge
          aria-hidden="true"
          style={{ "--fore-edge": `${edge.toFixed(2)}px` } as CSSProperties}
        />
      )}
    </>
  );
}
