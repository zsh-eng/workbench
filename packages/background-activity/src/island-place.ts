/**
 * Where the activity island floats: at the top centre of the window, below
 * the safe area, as the Dynamic Island does. Where an app's own controls are
 * there (its tabs, a search field), it goes below them, and below the next
 * row if that one is taken too. island.tsx measures the controls.
 */

/** A control's box. One that `stays` (in a fixed or sticky bar) is in the
 *  window's coordinates, down to its bar's bottom edge; one that scrolls
 *  with the page is where it is at the page's top. */
export interface IslandObstacle {
  left: number;
  right: number;
  top: number;
  bottom: number;
  stays: boolean;
}

/** Space kept between the island and a control beside or above it; half
 *  of it below, where a row's box has room above its words. */
export const ISLAND_CLEARANCE = 8;

/**
 * The island's top, in the window at the page's top, and how far it rises
 * as the page scrolls (`rise`): controls that scroll away leave the top
 * free, while those that stay keep it below them.
 */
export function placeIsland({
  obstacles,
  left,
  right,
  top,
  height,
}: {
  obstacles: readonly IslandObstacle[];
  /** The island's sides at its open width. */
  left: number;
  right: number;
  /** The top centre: below the safe area. */
  top: number;
  height: number;
}): { top: number; rise: number } {
  const clear = (boxes: readonly IslandObstacle[]) => {
    let y = top;
    // Each step goes below one row of controls; a page has few rows.
    for (let step = 0; step < 6; step++) {
      let below = -Infinity;
      for (const box of boxes)
        if (
          box.left < right + ISLAND_CLEARANCE &&
          box.right > left - ISLAND_CLEARANCE &&
          box.top < y + height + ISLAND_CLEARANCE / 2 &&
          box.bottom > y - ISLAND_CLEARANCE / 2
        )
          below = Math.max(below, box.bottom + ISLAND_CLEARANCE);
      if (below === -Infinity) break;
      y = below;
    }
    return y;
  };
  const placed = clear(obstacles);
  const staying = clear(obstacles.filter((box) => box.stays));
  return { top: placed, rise: Math.max(0, placed - staying) };
}

/** How the island folds away: into the app's mark when it is near, else in
 *  place. Centres and the mark's width, in the window. */
export function islandFold({
  island,
  mark,
  near = 200,
}: {
  island: { x: number; y: number };
  mark: { x: number; y: number; width: number } | null;
  near?: number;
}): { dx: number; dy: number; width: number | null } {
  if (mark === null) return { dx: 0, dy: 0, width: null };
  const dx = mark.x - island.x;
  const dy = mark.y - island.y;
  if (Math.hypot(dx, dy) > near) return { dx: 0, dy: 0, width: null };
  return { dx, dy, width: mark.width };
}
