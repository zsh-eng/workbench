import type { ColumnSlice } from "./shared/layout-column";
import type {
  FontConfig,
  LayoutTheme,
  PageSlice,
  TextCursorOffset,
} from "./shared/types";

export type { ColumnSlice } from "./shared/layout-column";

// Re-export types that are unchanged from pagination v1
export { areFontConfigsEqual } from "./shared/types";
export type {
  Block,
  BlockTag,
  BookPageBreakHints,
  ChapterCanonicalText,
  FontConfig,
  HighlightMark,
  ImageBlock,
  ImageSlice,
  InlineRole,
  InlineRun,
  LayoutTheme,
  LinkRef,
  Page,
  PageFragment,
  PageLine,
  PageSlice,
  PaginationChapterDiagnostics,
  PaginationDiagnostics,
  PaginationResult,
  PreparedBlock,
  PreparedImageBlock,
  PreparedInlineItem,
  PreparedPageBreakBlock,
  PreparedSpacerBlock,
  PreparedTextBlock,
  PreparedTextItem,
  PublisherBlockRole,
  PublisherFontFace,
  PublisherStyleOptions,
  BookStylesheet,
  PublisherTextStyle,
  SpacerBlock,
  SpacerSlice,
  TextBlock,
  TextCursorOffset,
  TextRenderMode,
  TextRun,
  TextSlice,
} from "./shared/types";

// ---------------------------------------------------------------------------
// PaginationConfig (relayout-affecting) and SpreadConfig (projection only)
// ---------------------------------------------------------------------------

export interface PaginationConfig {
  fontConfig: FontConfig;
  layoutTheme: LayoutTheme;
  publisherBookStylingEnabled?: boolean;
  /** Per-leaf-page viewport dimensions. */
  viewport: { width: number; height: number };
}

export interface SpreadConfig {
  columns: 1 | 2 | 3;
  chapterFlow: "continuous" | "align-leftmost";
}

export const DEFAULT_SPREAD_CONFIG: SpreadConfig = {
  columns: 1,
  chapterFlow: "continuous",
};

// ---------------------------------------------------------------------------
// ContentAnchor — discriminated union replacing the flat interface in v1.
// A "text" anchor includes a precise cursor position within the text block;
// a "block" anchor pins to the start of the block (used for images, spacers).
// ---------------------------------------------------------------------------

export type ContentAnchor =
  | {
      type: "text";
      chapterIndex: number;
      blockId: string;
      offset: TextCursorOffset;
    }
  | {
      type: "block";
      chapterIndex: number;
      blockId: string;
    };

export type SpreadIntent =
  | { kind: "history"; targetIndex: number }
  | {
      kind: "linear";
      direction: "forward" | "backward";
    }
  | {
      kind: "jump";
      source:
        | "chapter"
        | "toc"
        | "search"
        | "highlight"
        | "note"
        | "handoff"
        | "internal-link"
        | "scrubber";
    }
  | {
      kind: "preview";
      source: "scrubber";
    }
  | {
      kind: "restore";
    }
  | {
      kind: "replace";
    };

// ---------------------------------------------------------------------------
// ResolvedLeafPage / ResolvedSpread — what the hook exposes and events carry.
// All numeric fields are computed on demand by the engine; nothing is cached.
// ---------------------------------------------------------------------------

export interface ResolvedLeafPage {
  currentPage: number;
  totalPages: number;
  currentPageInChapter: number;
  totalPagesInChapter: number;
  chapterIndex: number;
  content: PageSlice[];
}

export type SpreadGapReason = "chapter-boundary" | "end-of-book" | "unloaded";

export type SpreadSlot =
  | {
      kind: "page";
      slotIndex: number;
      page: ResolvedLeafPage;
    }
  | {
      kind: "gap";
      slotIndex: number;
      reason?: SpreadGapReason;
    };

export interface ResolvedSpread {
  slots: ReadonlyArray<SpreadSlot>;
  intent: SpreadIntent;
  currentPage: number;
  totalPages: number;
  currentSpread: number;
  totalSpreads: number;
  chapterIndexStart: number | null;
  chapterIndexEnd: number | null;
}

/** The current spread and the immediate pages that can be turned to. */
export interface ResolvedSpreadWindow {
  previous: ResolvedSpread | null;
  current: ResolvedSpread;
  next: ResolvedSpread | null;
  /**
   * The engine's reading anchor for `current`: a jump's exact target, or the
   * anchor that a page turn chose. Scroll mode places its column by it.
   */
  anchor?: ContentAnchor;
}

export type PaginationStatus = "idle" | "partial" | "recalculating" | "ready";

/**
 * One chapter laid out as a single scroll column (prototype, Debug mode).
 * Built from the chapter's pages, so `pageStarts` and `pageAnchors` map any
 * scroll offset to an exact page boundary and back.
 */
export interface ChapterColumnLayout {
  chapterIndex: number;
  /** The page width and height that the column and its pages were built for. */
  width: number;
  pageHeight: number;
  height: number;
  slices: ColumnSlice[];
  /** Column offset of the top of each chapter-local page. */
  pageStarts: number[];
  /** A content anchor for each page; it resolves back to that page. */
  pageAnchors: ContentAnchor[];
}
