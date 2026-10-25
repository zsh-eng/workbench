// Spread helpers for the pagination engine: project laid-out pages into
// spreads and resolve spread-level navigation and serialization details.
import type { Page } from "../shared/types";
import type {
  ContentAnchor,
  ResolvedLeafPage,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpreadConfig,
  SpreadGapReason,
  SpreadIntent,
} from "../types";
import { pickAnchorForPage, resolveAnchorToGlobalPage } from "./anchors";

type LeafRef = {
  chapterIndex: number;
  localPageIndex: number;
  globalPage: number;
};

type SpreadMapCell =
  | {
      kind: "page";
      leaf: LeafRef;
    }
  | {
      kind: "gap";
      reason: SpreadGapReason;
    }
  | {
      kind: "pad";
    };

type SpreadMap = Array<Array<SpreadMapCell>>;

interface SpreadProjection {
  spreadMap: SpreadMap;
  spreadIndexByGlobalPage: Map<number, number>;
}

interface SpreadComputationState {
  anchor: ContentAnchor;
  chapterPageOffsets: number[];
  isFullyLoaded: boolean;
  leadingGapSlots: number;
  pagesByChapter: (Page[] | null)[];
  spreadConfig: SpreadConfig;
  totalChapters: number;
  totalPages: number;
}

function buildResolvedLeafPage(
  pagesByChapter: (Page[] | null)[],
  totalPages: number,
  leaf: LeafRef,
): ResolvedLeafPage {
  const pages = pagesByChapter[leaf.chapterIndex] ?? [];
  const page = pages[leaf.localPageIndex];

  return {
    currentPage: leaf.globalPage,
    totalPages,
    currentPageInChapter: leaf.localPageIndex + 1,
    totalPagesInChapter: pages.length,
    chapterIndex: leaf.chapterIndex,
    content: page?.slices ?? [],
  };
}

function buildSpreadProjection(
  state: Omit<SpreadComputationState, "anchor" | "totalPages">,
): SpreadProjection {
  const {
    chapterPageOffsets,
    isFullyLoaded,
    leadingGapSlots,
    pagesByChapter,
    spreadConfig,
    totalChapters,
  } = state;
  const { columns, chapterFlow } = spreadConfig;

  const chapterLeaves: LeafRef[][] = [];
  for (let chapterIndex = 0; chapterIndex < totalChapters; chapterIndex++) {
    const pages = pagesByChapter[chapterIndex] ?? [];
    const offset = chapterPageOffsets[chapterIndex] ?? 0;
    const leaves = pages.map((_, localPageIndex) => ({
      chapterIndex,
      localPageIndex,
      globalPage: offset + localPageIndex + 1,
    }));
    chapterLeaves.push(leaves);
  }

  const spreads: SpreadMap = [];
  let currentSpread: SpreadMapCell[] = [];

  const pushCell = (cell: SpreadMapCell) => {
    currentSpread.push(cell);
    if (currentSpread.length >= columns) {
      spreads.push(currentSpread);
      currentSpread = [];
    }
  };

  const flushWithGap = (reason: SpreadGapReason) => {
    if (currentSpread.length === 0) return;
    while (currentSpread.length < columns) {
      currentSpread.push({ kind: "gap", reason });
    }
    spreads.push(currentSpread);
    currentSpread = [];
  };

  if (chapterFlow === "continuous") {
    for (let index = 0; index < leadingGapSlots; index++) {
      pushCell({ kind: "pad" });
    }

    for (let chapterIndex = 0; chapterIndex < totalChapters; chapterIndex++) {
      for (const leaf of chapterLeaves[chapterIndex] ?? []) {
        pushCell({ kind: "page", leaf });
      }
    }

    if (currentSpread.length > 0) {
      flushWithGap(isFullyLoaded ? "end-of-book" : "unloaded");
    }
  } else {
    for (let chapterIndex = 0; chapterIndex < totalChapters; chapterIndex++) {
      const leaves = chapterLeaves[chapterIndex] ?? [];
      if (leaves.length === 0) continue;

      if (currentSpread.length > 0) {
        flushWithGap("chapter-boundary");
      }

      for (const leaf of leaves) {
        pushCell({ kind: "page", leaf });
      }

      if (chapterIndex < totalChapters - 1 && currentSpread.length > 0) {
        flushWithGap("chapter-boundary");
      }
    }

    if (currentSpread.length > 0) {
      flushWithGap(isFullyLoaded ? "end-of-book" : "unloaded");
    }
  }

  if (spreads.length === 0) {
    const reason: SpreadGapReason = isFullyLoaded ? "end-of-book" : "unloaded";
    spreads.push(
      Array.from({ length: columns }, () => ({ kind: "gap", reason })),
    );
  }

  const spreadIndexByGlobalPage = new Map<number, number>();
  for (let spreadIndex = 0; spreadIndex < spreads.length; spreadIndex++) {
    const spread = spreads[spreadIndex];
    if (!spread) continue;
    for (const cell of spread) {
      if (cell.kind !== "page") continue;
      spreadIndexByGlobalPage.set(cell.leaf.globalPage, spreadIndex);
    }
  }

  return {
    spreadMap: spreads,
    spreadIndexByGlobalPage,
  };
}

export function buildResolvedSpreadWindow(
  intent: SpreadIntent,
  state: SpreadComputationState,
): ResolvedSpreadWindow | null {
  const anchorGlobalPage = resolveAnchorToGlobalPage(
    state.pagesByChapter,
    state.chapterPageOffsets,
    state.anchor,
  );
  if (anchorGlobalPage === null) return null;

  const projection = buildSpreadProjection(state);
  const spreadIndex = projection.spreadIndexByGlobalPage.get(anchorGlobalPage);
  if (spreadIndex === undefined) return null;

  const current = buildResolvedSpreadAtIndex(
    intent,
    state,
    projection,
    spreadIndex,
  );
  if (!current) return null;

  return {
    previous: buildResolvedSpreadAtIndex(
      intent,
      state,
      projection,
      spreadIndex - 1,
    ),
    current,
    next: buildResolvedSpreadAtIndex(
      intent,
      state,
      projection,
      spreadIndex + 1,
    ),
  };
}

function buildResolvedSpreadAtIndex(
  intent: SpreadIntent,
  state: SpreadComputationState,
  projection: SpreadProjection,
  spreadIndex: number,
): ResolvedSpread | null {
  if (spreadIndex < 0 || spreadIndex >= projection.spreadMap.length) {
    return null;
  }

  const spread = projection.spreadMap[spreadIndex];
  if (!spread) return null;

  const slots = spread.map((cell, slotIndex) => {
    if (cell.kind === "page") {
      return {
        kind: "page" as const,
        slotIndex,
        page: buildResolvedLeafPage(
          state.pagesByChapter,
          state.totalPages,
          cell.leaf,
        ),
      };
    }
    if (cell.kind === "gap") {
      return {
        kind: "gap" as const,
        slotIndex,
        reason: cell.reason,
      };
    }

    return {
      kind: "gap" as const,
      slotIndex,
    };
  });

  const pageSlots = slots.filter(
    (slot): slot is Extract<(typeof slots)[number], { kind: "page" }> =>
      slot.kind === "page",
  );
  const firstVisiblePage = pageSlots[0]?.page.currentPage;
  if (firstVisiblePage === undefined) return null;

  return {
    slots,
    intent,
    currentPage: firstVisiblePage,
    totalPages: state.totalPages,
    currentSpread: spreadIndex + 1,
    totalSpreads: Math.max(1, projection.spreadMap.length),
    chapterIndexStart: pageSlots[0]?.page.chapterIndex ?? null,
    chapterIndexEnd: pageSlots[pageSlots.length - 1]?.page.chapterIndex ?? null,
  };
}

export function resolveCurrentSpreadIndex(
  state: Omit<SpreadComputationState, "totalPages">,
): number | null {
  const anchorGlobalPage = resolveAnchorToGlobalPage(
    state.pagesByChapter,
    state.chapterPageOffsets,
    state.anchor,
  );
  if (anchorGlobalPage === null) return null;

  const projection = buildSpreadProjection(state);
  return projection.spreadIndexByGlobalPage.get(anchorGlobalPage) ?? null;
}

export function countTotalSpreads(
  state: Omit<SpreadComputationState, "anchor" | "totalPages">,
): number {
  return Math.max(1, buildSpreadProjection(state).spreadMap.length);
}

export function resolveAnchorForSpreadIndex(
  spreadIndex: number,
  state: Omit<SpreadComputationState, "anchor" | "totalPages">,
): ContentAnchor | null {
  const { spreadMap } = buildSpreadProjection(state);
  if (spreadIndex < 0 || spreadIndex >= spreadMap.length) {
    return null;
  }

  const spread = spreadMap[spreadIndex];
  if (!spread) return null;

  const firstPageCell = spread.find(
    (cell): cell is Extract<SpreadMapCell, { kind: "page" }> =>
      cell.kind === "page",
  );
  if (!firstPageCell) return null;

  return pickAnchorForPage(
    state.pagesByChapter,
    firstPageCell.leaf.chapterIndex,
    firstPageCell.leaf.localPageIndex,
  );
}
