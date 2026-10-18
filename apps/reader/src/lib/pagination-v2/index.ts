export { PaginationTracer } from "./diagnostics/tracer";
export type {
  PaginationRunTimings,
  PaginationTracerSnapshot,
} from "./diagnostics/tracer";
export {
  resolveCanonicalRangeText,
  resolveContentAnchorRangeToHighlight,
} from "./engine/highlight-selection";
export type { ResolvedHighlightSelection } from "./engine/highlight-selection";
export { resolveDomEndpointToContentAnchor } from "./engine/selection-anchors";
export type { PaginationCommand, PaginationEvent } from "./protocol";
export { layoutPages } from "./shared/layout-pages";
export {
  layoutPreWrapLines,
  layoutTextLines,
} from "./shared/layout-text-lines";
export {
  measureCollapsedSpaceWidth,
  measureSingleLineWidth,
} from "./shared/measure";
export {
  parseChapterHtml,
  parseChapterHtmlWithCanonicalText,
} from "./shared/parse-html";
export { clearPrepareCache, prepareBlocks } from "./shared/prepare-blocks";
export {
  inferPublisherBodyFontScale,
  normalizePublisherBodyFontScale,
} from "./shared/publisher-body-scale";
export {
  DEFAULT_PARAGRAPH_SPACING,
  getBlockSpacing,
  getLineHeight,
  headingScale,
} from "./shared/spacing";
export { DEFAULT_SPREAD_CONFIG } from "./types";
export type {
  Block,
  BookPageBreakHints,
  ChapterCanonicalText,
  ContentAnchor,
  FontConfig,
  HighlightMark,
  ImageSlice,
  InlineRole,
  InlineRun,
  LayoutTheme,
  LinkRef,
  Page,
  PageFragment,
  PageSlice,
  PaginationConfig,
  PaginationStatus,
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
  ResolvedLeafPage,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpacerSlice,
  SpreadConfig,
  SpreadGapReason,
  SpreadIntent,
  SpreadSlot,
  TextBlock,
  TextCursorOffset,
  TextRenderMode,
  TextRun,
  TextSlice,
} from "./types";
export { usePagination } from "./use-pagination";
export type {
  UsePaginationOptions,
  UsePaginationResult,
} from "./use-pagination";
