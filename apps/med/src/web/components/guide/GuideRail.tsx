import * as stylex from "@stylexjs/stylex";
import { memo, type ReactNode } from "react";
import type { ParsedReviewFile } from "../../../shared/review";
import type { SavedCommit } from "../../../shared/review-guide";
import type { GuideScope, GuideSection } from "../../data/guide";
import { hoveredPath } from "../../data/hovered-path";
import { picked, tokens, ui } from "../../theme.stylex";
import { ColumnHandle, useColumnWidth } from "../ColumnResize";
import { Icon } from "../Icon";
import { PathLabel } from "../PathLabel";
import { clippedTooltip } from "../ToolButton";
import { Progress } from "./Progress";

export interface GuideRailProps {
  sections: readonly GuideSection[];
  commits: readonly SavedCommit[];
  moreCommits?: boolean;
  scope: GuideScope;
  filesById: ReadonlyMap<string, ParsedReviewFile>;
  /** File IDs the reader marked as viewed. */
  viewed: ReadonlySet<string>;
  /** Changed files in the review, and how many are viewed. */
  total: number;
  done: number;
  onScope(scope: GuideScope): void;
  onFile(section: string, fileId: string): void;
  onToggleViewed(fileIds: readonly string[], viewed: boolean): void;
  /** Above the Guide, such as a stack's layers. */
  top?: ReactNode;
}

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * The Guide's table of contents: the Overview, the agent's segments, and the
 * range's commits. The open segment lists its files, each with a viewed mark.
 */
export const GuideRail = memo(function GuideRail({
  sections,
  commits,
  moreCommits,
  scope,
  filesById,
  viewed,
  total,
  done,
  onScope,
  onFile,
  onToggleViewed,
  top,
}: GuideRailProps) {
  const { measure, width, pane } = useColumnWidth("guide", () => 268);
  return (
    <nav ref={measure} aria-label="Guide" {...stylex.props(styles.rail, styles.width(width))}>
      {top}
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(ui.label)}>Guide</span>
        <span {...stylex.props(ui.grow)} />
        <span
          {...stylex.props(styles.count)}
          aria-label={`${done} of ${total} files viewed`}
          title={`${done} of ${total} changed files viewed`}
        >
          <span {...stylex.props(styles.countDone)}>{done}</span>/{total}
        </span>
      </div>
      <div {...stylex.props(styles.meter)} aria-hidden="true">
        <span {...stylex.props(styles.meterFill(total ? done / total : 0))} />
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
        {sections.length > 0 && (
          <ol aria-label="Segments" {...stylex.props(styles.list)}>
            {sections.map((section) => {
              const open = scope.kind === "segment" && scope.key === section.key;
              const seen = section.fileIds.filter((id) => viewed.has(id)).length;
              return (
                <li key={section.key} {...stylex.props(styles.item)}>
                  <button
                    type="button"
                    aria-current={open ? "page" : undefined}
                    aria-label={`${section.number}. ${section.title}${section.critical ? ", needs care" : ""}, ${seen} of ${section.fileIds.length} files viewed`}
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
                        {section.additions > 0 && (
                          <span {...stylex.props(ui.added)}>+{section.additions}</span>
                        )}
                        {section.deletions > 0 && (
                          <span {...stylex.props(ui.removed)}>−{section.deletions}</span>
                        )}
                        <span>
                          {section.fileIds.length} {section.fileIds.length === 1 ? "file" : "files"}
                        </span>
                        {section.notes.length > 0 && (
                          <span {...stylex.props(styles.notes)}>
                            <Icon name="note" size={11} />
                            {section.notes.length}
                          </span>
                        )}
                      </span>
                    </span>
                    <Progress value={seen} total={section.fileIds.length} />
                  </button>
                  {open && section.fileIds.length > 0 && (
                    <ul aria-label={`Files in ${section.title}`} {...stylex.props(styles.files)}>
                      {section.fileIds.map((id) => {
                        const file = filesById.get(id);
                        if (!file) return null;
                        const isViewed = viewed.has(id);
                        return (
                          <li key={id} {...stylex.props(styles.fileRow)}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isViewed}
                              aria-label={`Viewed ${file.path}`}
                              title={isViewed ? "Viewed" : "Mark as viewed"}
                              onClick={() => onToggleViewed([id], !isViewed)}
                              {...stylex.props(styles.check, isViewed && styles.checked)}
                            >
                              {isViewed && <Icon name="check" size={10} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => onFile(section.key, id)}
                              onPointerEnter={() => hoveredPath.set(file.path)}
                              onPointerLeave={() => hoveredPath.set(null)}
                              {...clippedTooltip(file.path)}
                              {...stylex.props(styles.file, isViewed && styles.fileViewed)}
                            >
                              <PathLabel path={file.path} folder={false} />
                              <span {...stylex.props(ui.grow)} />
                              <span {...stylex.props(styles.fileStat)}>
                                {file.info.additions > 0 && (
                                  <span {...stylex.props(ui.added)}>+{file.info.additions}</span>
                                )}
                                {file.info.deletions > 0 && (
                                  <span {...stylex.props(ui.removed)}>−{file.info.deletions}</span>
                                )}
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
        {commits.length > 0 && (
          <RailCommits
            commits={commits}
            more={moreCommits}
            current={scope.kind === "commit" ? scope.id : null}
            onCommit={(id) => onScope({ kind: "commit", id })}
          />
        )}
      </div>
      <div {...stylex.props(styles.keys)} aria-hidden="true">
        <kbd {...stylex.props(styles.kbd)}>j</kbd>
        <kbd {...stylex.props(styles.kbd)}>k</kbd>
        <span>segments</span>
        <kbd {...stylex.props(styles.kbd)}>v</kbd>
        <span>viewed</span>
      </div>
      <ColumnHandle kind="guide" width={width} pane={pane} label="the Guide" />
    </nav>
  );
});

/**
 * A range's commits, as the Guide and the Changes rail list them. Changes adds
 * a first row for the whole range.
 */
export function RailCommits({
  commits,
  more,
  current,
  onCommit,
  whole,
}: {
  commits: readonly SavedCommit[];
  more?: boolean;
  /** The commit that shows, if one does. */
  current: string | null;
  onCommit(id: string): void;
  /** A row for the whole range, "Whole range" unless `label` names it. */
  whole?: { current: boolean; label?: string; onShow(): void };
}) {
  return (
    <>
      <div {...stylex.props(styles.section)}>
        <span {...stylex.props(ui.label)}>Commits</span>
        <span {...stylex.props(styles.sectionCount)}>
          {commits.length}
          {more ? "+" : ""}
        </span>
      </div>
      <ol aria-label="Commits" {...stylex.props(styles.list)}>
        {whole && (
          <li>
            <button
              type="button"
              aria-current={whole.current ? "page" : undefined}
              onClick={whole.onShow}
              {...stylex.props(styles.row, styles.commit, whole.current && [styles.on, picked])}
            >
              <span aria-hidden="true" {...stylex.props(styles.sha, styles.all)}>
                all
              </span>
              <span {...stylex.props(styles.commitSubject)}>{whole.label ?? "Whole range"}</span>
            </button>
          </li>
        )}
        {commits.map((commit) => {
          const open = current === commit.id;
          return (
            <li key={commit.id}>
              <button
                type="button"
                aria-current={open ? "page" : undefined}
                {...clippedTooltip(commit.subject)}
                onClick={() => onCommit(commit.id)}
                {...stylex.props(styles.row, styles.commit, open && [styles.on, picked])}
              >
                <span {...stylex.props(styles.sha)}>{commit.id.slice(0, 7)}</span>
                <span data-clip="" {...stylex.props(styles.commitSubject)}>
                  {commit.subject}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

const styles = stylex.create({
  // A narrow pane gives the diff the room; the Overview lists the segments.
  rail: {
    position: "relative",
    display: { default: "flex", "@container (max-width: 720px)": "none" },
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
  countDone: { color: tokens.text },
  meter: {
    flexShrink: 0,
    height: 2,
    marginInline: 14,
    marginBottom: 8,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: tokens.fillStrong,
  },
  meterFill: (scale: number) => ({
    display: "block",
    height: "100%",
    backgroundColor: tokens.green,
    transform: `scaleX(${scale})`,
    transformOrigin: "left",
    transitionProperty: "transform",
    transitionDuration: "320ms",
    transitionTimingFunction: tokens.easeOut,
  }),
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
  check: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 14,
    height: 14,
    padding: 0,
    marginInlineEnd: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.lineStrong, ":hover": tokens.faint },
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.canvas,
    cursor: "pointer",
    outline: {
      default: "none",
      ":focus-visible": `2px solid ${tokens.accentLine}`,
    },
    outlineOffset: 1,
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
  },
  checked: {
    borderColor: { default: tokens.green, ":hover": tokens.green },
    backgroundColor: tokens.green,
  },
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
  fileViewed: { color: tokens.faint, textDecorationLine: "none" },
  fileStat: {
    display: "flex",
    gap: 5,
    flexShrink: 0,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  section: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
    paddingInline: 8,
    minHeight: 24,
  },
  sectionCount: {
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  commit: { minHeight: 30, paddingInline: 8, gap: 9 },
  sha: {
    flexShrink: 0,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  // As wide as a short hash, so the subjects line up.
  all: { width: "7ch" },
  commitSubject: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },
  keys: {
    display: { default: "flex", "@media (max-height: 560px)": "none" },
    alignItems: "center",
    gap: 5,
    flexShrink: 0,
    height: 32,
    paddingInline: 14,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11,
  },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 16,
    height: 16,
    paddingInline: 3,
    boxSizing: "border-box",
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10,
  },
});
