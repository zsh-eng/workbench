import * as stylex from "@stylexjs/stylex";
import { memo, type ReactNode } from "react";
import type { ParsedReviewFile } from "../../../shared/review";
import type { GuideScope, GuideSection } from "../../data/guide";
import { picked, tokens, ui } from "../../theme.stylex";
import { ColumnHandle, useColumnWidth } from "../ColumnResize";
import { LineCounts } from "../DiffStat";
import { Icon } from "../Icon";
import { PathLabel } from "../PathLabel";
import { clippedTooltip } from "../ToolButton";

export interface GuideRailProps {
  sections: readonly GuideSection[];
  scope: GuideScope;
  filesById: ReadonlyMap<string, ParsedReviewFile>;
  onScope(scope: GuideScope): void;
  onFile(section: string, fileId: string): void;
  /** Above the Guide, such as a stack's layers. */
  top?: ReactNode;
  /** At the heading's end, such as the sidebar's hide button. */
  controls?: ReactNode;
  /** What changed since the reader's last review, after the first hand-off. */
  since?: { files: number };
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Guide's table of contents: the Overview, what is new since the
 * reader last looked, and the agent's segments. The open segment lists its
 * files.
 */
export const GuideRail = memo(function GuideRail({
  sections,
  scope,
  filesById,
  onScope,
  onFile,
  top,
  since,
  controls,
}: GuideRailProps) {
  const { measure, width, pane } = useColumnWidth("guide", () => 268);
  return (
    <nav ref={measure} aria-label="Guide" {...stylex.props(styles.rail, styles.width(width))}>
      {top}
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(ui.label)}>Guide</span>
        <span {...stylex.props(ui.grow)} />
        {controls}
      </div>
      <div {...stylex.props(styles.scroll)}>
        <button
          type="button"
          aria-current={scope.kind === "overview" ? "page" : undefined}
          onClick={() => onScope({ kind: "overview" })}
          {...stylex.props(
            styles.row,
            styles.overview,
            scope.kind === "overview" && [styles.on, picked],
          )}
        >
          <Icon name="brief" size={14} />
          <span {...stylex.props(styles.title)}>Overview</span>
        </button>
        {since && (
          <button
            type="button"
            aria-current={scope.kind === "since" ? "page" : undefined}
            aria-label={`New since you looked, ${since.files} ${since.files === 1 ? "file" : "files"} changed`}
            onClick={() => onScope({ kind: "since" })}
            {...stylex.props(
              styles.row,
              styles.overview,
              scope.kind === "since" && [styles.on, picked],
            )}
          >
            <Icon name="history" size={14} />
            <span {...stylex.props(styles.title)}>New since you looked</span>
            <span {...stylex.props(ui.grow)} />
            <span {...stylex.props(styles.count)}>{since.files}</span>
          </button>
        )}
        {sections.length > 0 && (
          <ol aria-label="Segments" {...stylex.props(styles.list)}>
            {sections.map((section) => {
              const open = scope.kind === "segment" && scope.key === section.key;
              return (
                <li key={section.key} {...stylex.props(styles.item)}>
                  <button
                    type="button"
                    aria-current={open ? "page" : undefined}
                    aria-label={`${section.number}. ${section.title}${section.critical ? ", needs care" : ""}`}
                    onClick={() => onScope({ kind: "segment", key: section.key })}
                    {...clippedTooltip(section.title)}
                    {...stylex.props(styles.row, styles.segment, open && [styles.on, picked])}
                  >
                    <span {...stylex.props(styles.number, section.automatic && styles.auto)}>
                      {section.automatic ? "··" : pad(section.number)}
                    </span>
                    <span {...stylex.props(styles.body)}>
                      {/* Two lines at most; a longer title shows whole in the tooltip. */}
                      <span
                        data-clip="lines"
                        {...stylex.props(
                          styles.title,
                          styles.lines,
                          section.automatic && styles.autoTitle,
                        )}
                      >
                        {section.title}
                      </span>
                      <span {...stylex.props(styles.meta)}>
                        {section.critical && (
                          <span {...stylex.props(styles.critical)} title="Needs care">
                            <Icon name="alert" size={11} />
                          </span>
                        )}
                        <span>
                          {section.fileIds.length} {section.fileIds.length === 1 ? "file" : "files"}
                        </span>
                        <LineCounts additions={section.additions} deletions={section.deletions} />
                        {section.notes.length > 0 && (
                          <span {...stylex.props(styles.notes)}>
                            <Icon name="note" size={11} />
                            {section.notes.length}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                  {open && section.fileIds.length > 0 && (
                    <ul aria-label={`Files in ${section.title}`} {...stylex.props(styles.files)}>
                      {section.fileIds.map((id) => {
                        const file = filesById.get(id);
                        if (!file) return null;
                        return (
                          <li key={id} {...stylex.props(styles.fileRow)}>
                            <button
                              type="button"
                              onClick={() => onFile(section.key, id)}
                              {...clippedTooltip(file.path)}
                              {...stylex.props(styles.file)}
                            >
                              <span {...stylex.props(styles.fileName)}>
                                <PathLabel path={file.path} folder={false} />
                              </span>
                              <span {...stylex.props(styles.fileLines)}>
                                <LineCounts
                                  additions={file.info.additions}
                                  deletions={file.info.deletions}
                                />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <ColumnHandle kind="guide" width={width} pane={pane} label="the Guide" />
    </nav>
  );
});

const styles = stylex.create({
  // A narrow pane gives the diff the room; the Overview lists the segments.
  rail: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
    backgroundColor: tokens.canvas,
    fontFamily: tokens.ui,
  },
  width: (width: number) => ({ width }),
  head: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInline: 14,
  },
  count: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  scroll: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    scrollbarWidth: "thin",
    paddingInline: 6,
    paddingBottom: 12,
  },
  list: { listStyle: "none", margin: 0, padding: 0 },
  item: { marginBottom: 1 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    boxSizing: "border-box",
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
    outlineOffset: -2,
  },
  on: {
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
    color: tokens.selectedText,
  },
  overview: {
    minHeight: 32,
    paddingInline: 8,
    marginBottom: 6,
    color: tokens.muted,
    fontSize: 12.5,
  },
  segment: { alignItems: "flex-start", paddingBlock: 7, paddingInline: 8 },
  number: {
    flexShrink: 0,
    width: 16,
    paddingTop: 1,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  auto: { letterSpacing: "0.1em" },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    flex: "1",
    minWidth: 0,
  },
  title: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  // A title wraps to two lines, then ends with an ellipsis.
  lines: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    whiteSpace: "normal",
    overflowWrap: "anywhere",
  },
  autoTitle: { color: tokens.muted, fontWeight: 450 },
  critical: { display: "inline-flex", color: tokens.warning },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  notes: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    color: tokens.accent,
  },
  files: {
    listStyle: "none",
    margin: 0,
    marginBottom: 6,
    paddingBlock: 3,
    paddingInlineStart: 26,
    paddingInlineEnd: 0,
  },
  fileRow: { display: "flex", alignItems: "center", gap: 2 },
  fileName: { display: "flex", flex: "1", minWidth: 0 },
  fileLines: { fontSize: 10.5 },
  file: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: "1",
    minWidth: 0,
    height: 26,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    textAlign: "left",
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
    outlineOffset: -2,
  },
});
