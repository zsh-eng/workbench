/**
 * Where a page's running title and number go. The layout leaves room for
 * them and `PageFurniture` draws them, both from this plan.
 *
 * One page has its number centred at the foot and no title. Two pages on a
 * tablet read as an open book: a title over each page, and the numbers at
 * the outer top corners on the titles' line, where the eye barely travels on
 * a page that short. Two pages on a computer stand taller, so their numbers
 * sit centred at the foot, where each page ends.
 */
export interface PageFurniturePlan {
  /** A running title over each page. */
  titles: boolean;
  /** The numbers share the titles' row, at the outer corners. */
  numbersAtHead: boolean;
  /** A row over the text: titles, numbers, or both. */
  headRow: boolean;
  /** A row under the text: the numbers. */
  footRow: boolean;
}

export function planPageFurniture(options: {
  columns: number;
  isTablet: boolean;
  showTitles: boolean;
  showNumbers: boolean;
}): PageFurniturePlan {
  const spread = options.columns === 2;
  const titles = spread && options.showTitles;
  const numbersAtHead = spread && options.isTablet;
  return {
    titles,
    numbersAtHead,
    headRow: titles || (numbersAtHead && options.showNumbers),
    footRow: options.showNumbers && !numbersAtHead,
  };
}

/** A furniture row is one body line, set half a line clear of the text. */
export function getFurnitureRowHeight(lineHeight: number): number {
  return lineHeight + getFurnitureGap(lineHeight);
}

export function getFurnitureGap(lineHeight: number): number {
  return Math.round(lineHeight / 2);
}
