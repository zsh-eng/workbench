import type {
  PageFragment,
  PageSlice,
  TableSlice,
  TextSlice,
} from "@/lib/pagination-v2";
import {
  CONTENT_ANCHOR_BLOCK_ID_ATTR,
  CONTENT_ANCHOR_END_ATTR,
  CONTENT_ANCHOR_START_ATTR,
  serializeTextCursorOffset,
} from "@/lib/pagination-v2/content-anchor-dom";
import {
  getInlineRaisePx,
  getNoteRefMetrics,
} from "@/lib/pagination-v2/shared/inline-presentation";
import { measureTextWidth } from "@/lib/pagination-v2/shared/measure";
import { cn } from "@/lib/utils";
import {
  EPUB_HIGHLIGHT_END_ATTRIBUTE,
  EPUB_HIGHLIGHT_START_ATTRIBUTE,
  toCssTextAlign,
} from "@/types/reader.types";
import type { CSSProperties, ReactNode } from "react";
import { Fragment } from "react";
import { LazyImage } from "./shared/LazyImage";

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const FONT_SHORTHAND_RE =
  /^(?:(italic|normal|oblique(?:\s+[-\d.]+deg)?)\s+)?(\d{3}|normal|bold|bolder|lighter)\s+(\d+(?:\.\d+)?)px\s+(.+)$/;

interface PageSliceViewProps {
  slice: PageSlice;
  sliceIndex: number;
  baseFontSize: number;
}

function NoteRefBadge({ children }: { children: ReactNode }) {
  return <span className="reader-note-ref-badge">{children}</span>;
}

function isClusteredLinkFragment(fragment: PageFragment): boolean {
  return Boolean(fragment.link) && fragment.inlineRole !== "note-ref";
}

/** Highlight ids whose start or end cap a fragment leaves off. */
interface FlushHighlightEdges {
  start: Set<string>;
  end: Set<string>;
}

const NO_FLUSH_EDGES: FlushHighlightEdges = {
  start: new Set(),
  end: new Set(),
};

/**
 * Finds highlights that end where another begins with no space between, as
 * when two highlights split a word. Neither side gets a rounded cap there, so
 * the colours meet flush.
 */
function getFlushHighlightEdges(
  fragments: PageFragment[],
): FlushHighlightEdges[] {
  const edges = fragments.map(() => NO_FLUSH_EDGES);
  for (let index = 0; index < fragments.length - 1; index++) {
    const next = fragments[index + 1]!;
    if (next.leadingGap > 0) continue;
    const ending = fragments[index]!.highlightMarks?.filter((m) => m.isEnd);
    const starting = next.highlightMarks?.filter((m) => m.isStart);
    if (!ending?.length || !starting?.length) continue;
    edges[index] = {
      start: edges[index]!.start,
      end: new Set(ending.map((mark) => mark.id)),
    };
    edges[index + 1] = {
      start: new Set(starting.map((mark) => mark.id)),
      end: NO_FLUSH_EDGES.end,
    };
  }
  return edges;
}

function renderFragmentSequence(
  fragments: PageFragment[],
  keyPrefix: string,
  getStyle: (fragment: PageFragment, fragmentIndex: number) => CSSProperties,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const flushEdges = getFlushHighlightEdges(fragments);

  for (let index = 0; index < fragments.length;) {
    const fragment = fragments[index];
    if (!fragment) break;

    if (!isClusteredLinkFragment(fragment)) {
      nodes.push(
        renderLeadingGap(
          fragment,
          fragments[index - 1],
          `${keyPrefix}-gap-${index}`,
          getStyle(fragment, index),
        ),
      );
      nodes.push(
        renderInlineFragment(
          fragment,
          `${keyPrefix}-frag-${index}`,
          getStyle(fragment, index),
          flushEdges[index],
        ),
      );
      index += 1;
      continue;
    }

    const href = fragment.link?.href;
    const group: PageFragment[] = [fragment];
    let groupEnd = index + 1;

    while (groupEnd < fragments.length) {
      const nextFragment = fragments[groupEnd];
      if (
        !nextFragment ||
        !isClusteredLinkFragment(nextFragment) ||
        nextFragment.link?.href !== href
      ) {
        break;
      }

      group.push(nextFragment);
      groupEnd += 1;
    }

    if (group.length === 1) {
      nodes.push(
        renderLeadingGap(
          fragment,
          fragments[index - 1],
          `${keyPrefix}-gap-${index}`,
          getStyle(fragment, index),
        ),
      );
      nodes.push(
        renderInlineFragment(
          fragment,
          `${keyPrefix}-frag-${index}`,
          getStyle(fragment, index),
          flushEdges[index],
        ),
      );
      index = groupEnd;
      continue;
    }

    nodes.push(
      <span
        key={`${keyPrefix}-cluster-${index}`}
        className="reader-inline-link-cluster"
      >
        {group.flatMap((groupFragment, groupOffset) => [
          renderLeadingGap(
            groupFragment,
            fragments[index + groupOffset - 1],
            `${keyPrefix}-gap-${index + groupOffset}`,
            getStyle(groupFragment, index + groupOffset),
          ),
          renderInlineFragment(
            groupFragment,
            `${keyPrefix}-frag-${index + groupOffset}`,
            getStyle(groupFragment, index + groupOffset),
            flushEdges[index + groupOffset],
          ),
        ])}
      </span>,
    );
    index = groupEnd;
  }

  return nodes;
}

function wrapInHighlightMarks(
  text: string,
  marks: PageFragment["highlightMarks"],
  flushEdges: FlushHighlightEdges = NO_FLUSH_EDGES,
): ReactNode {
  if (!marks || marks.length === 0) return text;

  return marks.reduceRight<ReactNode>(
    (
      content: ReactNode,
      mark: NonNullable<PageFragment["highlightMarks"]>[number],
    ) => {
      return (
        <mark
          className="epub-highlight"
          data-highlight-id={mark.id}
          data-color={mark.color}
          {...(mark.isStart && !flushEdges.start.has(mark.id)
            ? { [EPUB_HIGHLIGHT_START_ATTRIBUTE]: "true" }
            : {})}
          {...(mark.isEnd && !flushEdges.end.has(mark.id)
            ? { [EPUB_HIGHLIGHT_END_ATTRIBUTE]: "true" }
            : {})}
        >
          {content}
        </mark>
      );
    },
    text,
  );
}

/**
 * Returns the highlights that continue across the space before `fragment`.
 *
 * Text with different formatting renders as separate fragments, and the space
 * between them renders as its own gap span. A highlight that covers both sides
 * must also cover the gap, or the background breaks at each formatting change.
 * Gap marks never carry start or end flags, so they get no end padding.
 */
function getGapHighlightMarks(
  fragment: PageFragment,
  previousFragment: PageFragment | undefined,
): NonNullable<PageFragment["highlightMarks"]> {
  if (!fragment.highlightMarks || !previousFragment?.highlightMarks) return [];

  const previousIds = new Set(
    previousFragment.highlightMarks.map((mark) => mark.id),
  );
  return fragment.highlightMarks
    .filter((mark) => previousIds.has(mark.id))
    .map((mark) => ({
      id: mark.id,
      ...(mark.color ? { color: mark.color } : {}),
    }));
}

function getFragmentAnchorData(fragment: PageFragment) {
  return {
    ...(fragment.anchorStart
      ? {
          [CONTENT_ANCHOR_START_ATTR]: serializeTextCursorOffset(
            fragment.anchorStart,
          ),
        }
      : {}),
    ...(fragment.anchorEnd
      ? {
          [CONTENT_ANCHOR_END_ATTR]: serializeTextCursorOffset(
            fragment.anchorEnd,
          ),
        }
      : {}),
  };
}

function getFragmentTypographyStyle(font: string): CSSProperties {
  const match = FONT_SHORTHAND_RE.exec(font.trim());
  if (!match) {
    return {
      font,
      lineHeight: "inherit",
    };
  }

  const [, fontStyle, fontWeight, fontSizePx, fontFamily] = match;

  // Avoid rendering the CSS font shorthand because it resets line-height before
  // lineHeight is re-applied, which makes inline line metrics harder to reason
  // about across browsers.
  return {
    fontFamily,
    fontSize: `${fontSizePx}px`,
    fontStyle: fontStyle ?? "normal",
    fontWeight,
    lineHeight: "inherit",
  };
}

function getSliceBaseTypographyStyle(
  slice: Extract<PageSlice, { type: "text" }>,
  baseFontSize: number,
): CSSProperties {
  const firstTextFragment = slice.lines
    .flatMap((line) => line.fragments)
    .find((fragment) => fragment.kind === "text" && fragment.text.length > 0);

  if (!firstTextFragment) {
    return {
      fontSize: Math.round(baseFontSize),
    };
  }

  const typographyStyle = getFragmentTypographyStyle(firstTextFragment.font);
  const { lineHeight: _lineHeight, ...fontStyle } = typographyStyle;
  return fontStyle;
}

function renderLeadingGap(
  fragment: PageFragment,
  previousFragment: PageFragment | undefined,
  key: string,
  style: CSSProperties,
) {
  if (fragment.leadingGap <= 0) return null;

  return (
    <span key={key} style={style}>
      {wrapInHighlightMarks(
        " ",
        getGapHighlightMarks(fragment, previousFragment),
      )}
    </span>
  );
}

function renderInlineFragment(
  fragment: PageFragment,
  key: string,
  style: CSSProperties,
  flushEdges?: FlushHighlightEdges,
) {
  const className = cn({
    "reader-inline-link":
      Boolean(fragment.link) && fragment.inlineRole !== "note-ref",
    "reader-inline-code": fragment.isCode,
    "reader-inline-superscript": fragment.inlineRole === "superscript",
    "reader-note-ref": fragment.inlineRole === "note-ref",
  });
  const content = wrapInHighlightMarks(
    fragment.text,
    fragment.highlightMarks,
    flushEdges,
  );
  const anchorData = getFragmentAnchorData(fragment);
  const raisePx = getInlineRaisePx(fragment.inlineRole, fragment.font);
  const noteRefMetrics =
    fragment.inlineRole === "note-ref"
      ? getNoteRefMetrics(
          fragment.font,
          measureTextWidth(fragment.text, fragment.font),
        )
      : null;

  if (fragment.link) {
    return (
      <a
        key={key}
        href={fragment.link.href}
        style={{
          ...style,
          ...(fragment.inlineRole === "superscript"
            ? {
                display: "inline-block",
                lineHeight: 1,
                transform: `translateY(-${raisePx}px)`,
              }
            : {}),
          ...(noteRefMetrics
            ? {
                boxSizing: "border-box",
                minWidth: `${noteRefMetrics.totalWidthPx}px`,
                height: `${noteRefMetrics.heightPx}px`,
                lineHeight: 1,
                transform: `translateY(-${noteRefMetrics.raisePx}px)`,
              }
            : {}),
        }}
        className={className}
        {...anchorData}
      >
        {noteRefMetrics ? <NoteRefBadge>{content}</NoteRefBadge> : content}
      </a>
    );
  }

  return (
    <span
      key={key}
      style={{
        ...style,
        ...(fragment.inlineRole === "superscript"
          ? {
              display: "inline-block",
              lineHeight: 1,
              transform: `translateY(-${raisePx}px)`,
            }
          : {}),
      }}
      className={className}
      {...anchorData}
    >
      {content}
    </span>
  );
}

/** A text slice's lines: each a `nowrap` span, so the page keeps the worker's breaks. */
function renderSliceLines(slice: TextSlice, key: string): ReactNode {
  return (slice.renderMode === "manual-justify"
        ? slice.lines.map((line, lineIndex) => {
            const trailingBoundaryFragment =
              line.fragments[line.fragments.length - 1]?.kind === "space"
                ? line.fragments[line.fragments.length - 1]
                : null;
            const contentFragments = trailingBoundaryFragment
              ? line.fragments.slice(0, -1)
              : line.fragments;

            return (
              <Fragment key={`${key}-line-${lineIndex}`}>
                <span
                  style={{
                    marginLeft:
                      line.indentPx !== undefined
                        ? `${line.indentPx}px`
                        : undefined,
                    whiteSpace: "nowrap",
                    wordSpacing:
                      line.wordSpacingPx !== undefined &&
                      Math.abs(line.wordSpacingPx) > 0.01
                        ? `${line.wordSpacingPx}px`
                        : undefined,
                  }}
                >
                  {renderFragmentSequence(
                    contentFragments,
                    `${key}-line-${lineIndex}`,
                    (fragment) => ({
                      ...getFragmentTypographyStyle(fragment.font),
                      marginRight:
                        fragment.marginRightPx !== undefined &&
                        Math.abs(fragment.marginRightPx) > 0.01
                          ? `${fragment.marginRightPx}px`
                          : undefined,
                    }),
                  )}
                </span>
                {trailingBoundaryFragment
                  ? renderInlineFragment(
                      trailingBoundaryFragment,
                      `${key}-line-${lineIndex}-trailing`,
                      {
                        ...getFragmentTypographyStyle(
                          trailingBoundaryFragment.font,
                        ),
                      },
                    )
                  : null}
              </Fragment>
            );
          })
        : slice.lines.map((line, lineIndex) => (
            <Fragment key={`${key}-line-${lineIndex}`}>
              <span
                style={{
                  marginLeft:
                    line.indentPx !== undefined
                      ? `${line.indentPx}px`
                      : undefined,
                  whiteSpace: "nowrap",
                }}
              >
                {renderFragmentSequence(
                  line.fragments,
                  `${key}-line-${lineIndex}`,
                  (fragment) => ({
                    ...getFragmentTypographyStyle(fragment.font),
                  }),
                )}
              </span>
              {lineIndex < slice.lines.length - 1 ? <br /> : null}
            </Fragment>
          )));
}

/** A repeated header's text belongs to an earlier page: no anchors. */
function withoutAnchors(slice: TextSlice): TextSlice {
  return {
    ...slice,
    lines: slice.lines.map((line) => ({
      ...line,
      fragments: line.fragments.map(
        ({ anchorStart: _start, anchorEnd: _end, ...fragment }) => fragment,
      ),
    })),
  };
}

/**
 * The rows of a table that fit this page, at the column widths and row
 * heights the worker chose. Fixed table layout keeps the browser from
 * choosing again; rules are inset shadows, so they take no space. Each cell
 * renders its lines as a paragraph does and is its own anchor block, so
 * selection, highlights and search work as in prose. A table wider than the
 * page scrolls sideways in its slice.
 */
function TableSliceView({
  slice,
  sliceIndex,
  baseFontSize,
}: {
  slice: TableSlice;
  sliceIndex: number;
  baseFontSize: number;
}) {
  const key = `${slice.blockId}-${sliceIndex}`;
  const firstBody = slice.rows.findIndex((row) => !row.header);
  const headCount = firstBody < 0 ? slice.rows.length : firstBody;
  const renderRow = (row: TableSlice["rows"][number], inHead: boolean) => (
    <tr
      key={`${key}-row-${row.index}-${row.continued ? "c" : "s"}-${row.repeated ? "r" : "o"}`}
      data-reader-table-row={row.index}
      {...(row.repeated ? { "data-reader-table-repeated": "" } : {})}
      {...(row.continued ? { "data-reader-table-continued": "" } : {})}
      style={{ height: `${row.height}px` }}
    >
      {row.cells.map((cell) => {
        const Cell = cell.header ? "th" : "td";
        const text = row.repeated ? withoutAnchors(cell.slice) : cell.slice;
        return (
          <Cell
            key={`${key}-cell-${cell.column}`}
            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
            rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
            scope={cell.header && inHead ? "col" : undefined}
            style={{
              padding: `${slice.cellPaddingY}px ${slice.cellPaddingX}px`,
            }}
          >
            <div
              data-reader-block-id={cell.slice.blockId}
              data-reader-line-count={text.lines.length}
              data-reader-line-height={text.lineHeight}
              className="reader-table-cell-text"
              {...(row.repeated
                ? {}
                : { [CONTENT_ANCHOR_BLOCK_ID_ATTR]: cell.slice.blockId })}
              style={{
                ...getSliceBaseTypographyStyle(text, baseFontSize),
                lineHeight: `${text.lineHeight}px`,
                height: `${text.lines.length * text.lineHeight}px`,
              }}
            >
              {renderSliceLines(text, `${key}-${cell.slice.blockId}`)}
            </div>
          </Cell>
        );
      })}
    </tr>
  );

  return (
    <div
      data-reader-page-slice={sliceIndex}
      data-reader-slice-type="table"
      data-reader-block-id={slice.blockId}
      data-reader-expected-height={slice.height}
      {...(slice.overflows ? { "data-reader-table-scroll": "" } : {})}
      className={cn("reader-table-slice", {
        "reader-table-slice-scroll": slice.overflows,
      })}
      style={{ height: `${slice.height}px` }}
    >
      <table className="reader-table" style={{ width: `${slice.width}px` }}>
        <colgroup>
          {slice.columnWidths.map((width, column) => (
            <col key={column} style={{ width: `${width}px` }} />
          ))}
        </colgroup>
        {headCount > 0 ? (
          <thead>
            {slice.rows.slice(0, headCount).map((row) => renderRow(row, true))}
          </thead>
        ) : null}
        {headCount < slice.rows.length ? (
          <tbody>
            {slice.rows.slice(headCount).map((row) => renderRow(row, false))}
          </tbody>
        ) : null}
      </table>
    </div>
  );
}

export function PageSliceView({
  slice,
  sliceIndex,
  baseFontSize,
}: PageSliceViewProps) {
  const key = `${slice.blockId}-${sliceIndex}`;

  if (slice.type === "spacer") {
    return (
      <div
        data-reader-page-slice={sliceIndex}
        data-reader-slice-type="spacer"
        data-reader-block-id={slice.blockId}
        data-reader-expected-height={slice.height}
        style={{ height: `${slice.height}px` }}
      />
    );
  }

  if (slice.type === "image") {
    return (
      <div
        data-reader-page-slice={sliceIndex}
        data-reader-slice-type="image"
        data-reader-block-id={slice.blockId}
        data-reader-expected-height={slice.height}
        className="flex w-full items-center justify-center"
        style={{ height: `${slice.height}px` }}
      >
        <LazyImage
          src={slice.src}
          alt={slice.alt ?? "Chapter image"}
          width={slice.width}
          height={slice.height}
          style={{
            objectFit: "contain",
          }}
        />
      </div>
    );
  }

  if (slice.type === "table") {
    return (
      <TableSliceView
        slice={slice}
        sliceIndex={sliceIndex}
        baseFontSize={baseFontSize}
      />
    );
  }

  const textAlign =
    slice.renderMode === "manual-justify"
      ? "left"
      : HEADING_TAGS.has(slice.tag) &&
          (slice.textAlign === "justify" ||
            slice.textAlign === "justify-knuth-plass")
        ? "left"
        : toCssTextAlign(slice.textAlign);

  return (
    <p
      data-reader-page-slice={sliceIndex}
      data-reader-slice-type="text"
      data-reader-block-id={slice.blockId}
      data-reader-line-count={slice.lines.length}
      data-reader-line-height={slice.lineHeight}
      data-reader-expected-height={slice.lines.length * slice.lineHeight}
      className={cn("m-0 box-border text-foreground", {
        "reader-blockquote":
          slice.tag === "blockquote" && !slice.publisherStyle,
        "reader-figcaption": slice.tag === "figcaption",
      })}
      {...{ [CONTENT_ANCHOR_BLOCK_ID_ATTR]: slice.blockId }}
      // There is a difference between the line height CSS property and the actual line height
      // that is rendered out.
      // For instance, with "Iowan Old Style" font on 17px, the rendered height of the box is
      // always 0.5px taller than the line height. E.g. 25px line height renders at 25.5px,
      // 24px line height renders at 24.5px, 28px line height renders at 28.5px, and so on.
      // Thus we need to set the `height` property to match the number of lines and line height
      // such that we don't get overflow in these cases.
      style={{
        // The block's own inline strut participates in native line layout, so
        // it needs to use the same base font as the rendered text fragments.
        ...getSliceBaseTypographyStyle(slice, baseFontSize),
        lineHeight: `${slice.lineHeight}px`,
        height: `${slice.lines.length * slice.lineHeight}px`,
        textAlign,
        marginLeft:
          slice.marginLeftPx !== undefined
            ? `${slice.marginLeftPx}px`
            : undefined,
        marginRight:
          slice.marginRightPx !== undefined
            ? `${slice.marginRightPx}px`
            : undefined,
      }}
    >
      {renderSliceLines(slice, key)}
    </p>
  );
}
