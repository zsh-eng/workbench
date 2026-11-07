import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";
import type { SavedCommit } from "../../shared/review-guide";
import { picked, tokens, ui } from "../theme.stylex";
import { ColumnHandle, useColumnWidth } from "./ColumnResize";
import { FileSidebar } from "./FileSidebar";
import { clippedTooltip } from "./ToolButton";

/** As wide as the Guide's rail. */
const RAIL_WIDTH = 268;

type CommitProps = {
  commits: readonly SavedCommit[];
  moreCommits?: boolean;
  /** The commit of the range that shows, if one does. */
  commit: string | null;
  /** The whole comparison shows, not one of its commits. */
  whole: boolean;
  /** The row that shows the whole comparison again. */
  wholeLabel: string;
  onCommit(id: string): void;
  onWhole(): void;
  /** Commits that are new since the reader's last review. */
  fresh?: ReadonlySet<string>;
};

/**
 * The Changes page's sidebar: what the diff compares (`range`), the changed
 * files as a tree, and the commits. It sits where the Guide does in Review,
 * so the diff keeps its place between the pages. Its edge resizes it
 * (ColumnResize.tsx).
 */
export function ChangesRail({
  commits,
  moreCommits,
  commit,
  whole,
  wholeLabel,
  onCommit,
  onWhole,
  fresh,
  top,
  range,
  hidden = false,
  ...files
}: ComponentProps<typeof FileSidebar> &
  CommitProps & {
    top?: ReactNode;
    /** What the diff compares, under the heading. */
    range?: ReactNode;
    /** Hidden, it keeps its tree for its return. */
    hidden?: boolean;
  }) {
  const { measure, width, pane } = useColumnWidth("changes", () => RAIL_WIDTH);
  return (
    <nav
      ref={measure}
      aria-label="Files and commits"
      hidden={hidden}
      {...stylex.props(styles.rail, styles.width(width), hidden && styles.hidden)}
    >
      {top}
      <FileSidebar {...files} top={range} />
      <RangeCommits
        commits={commits}
        moreCommits={moreCommits}
        commit={commit}
        whole={whole}
        wholeLabel={wholeLabel}
        onCommit={onCommit}
        onWhole={onWhole}
        fresh={fresh}
      />
      <ColumnHandle kind="changes" width={width} pane={pane} label="the file list" />
    </nav>
  );
}

/** A range's or a branch's commits under its files. A range of one commit
 * lists none. */
export function RangeCommits({
  commits,
  moreCommits,
  commit,
  whole,
  wholeLabel,
  onCommit,
  onWhole,
  fresh,
}: CommitProps) {
  if (commits.length < 2) return null;
  return (
    <div {...stylex.props(styles.commits)}>
      <RailCommits
        commits={commits}
        more={moreCommits}
        current={commit}
        fresh={fresh}
        onCommit={onCommit}
        whole={{ current: whole, label: wholeLabel, onShow: onWhole }}
      />
    </div>
  );
}

/** A range's commits, after a first row for the whole range. */
function RailCommits({
  commits,
  more,
  current,
  fresh,
  onCommit,
  whole,
}: {
  commits: readonly SavedCommit[];
  more?: boolean;
  /** The commit that shows, if one does. */
  current: string | null;
  /** Commits that are new since the reader's last review. */
  fresh?: ReadonlySet<string>;
  onCommit(id: string): void;
  /** A row for the whole range, "Whole range" unless `label` names it. */
  whole: { current: boolean; label: string; onShow(): void };
}) {
  return (
    <>
      <div {...stylex.props(commitStyles.section)}>
        <span {...stylex.props(ui.label)}>Commits</span>
        <span {...stylex.props(commitStyles.sectionCount)}>
          {commits.length}
          {more ? "+" : ""}
        </span>
      </div>
      <ol aria-label="Commits" {...stylex.props(commitStyles.list)}>
        <li>
          <button
            type="button"
            aria-current={whole.current ? "page" : undefined}
            onClick={whole.onShow}
            {...stylex.props(
              commitStyles.row,
              commitStyles.commit,
              whole.current && [commitStyles.on, picked],
            )}
          >
            <span aria-hidden="true" {...stylex.props(commitStyles.sha, commitStyles.all)}>
              all
            </span>
            <span {...stylex.props(commitStyles.commitSubject)}>{whole.label}</span>
          </button>
        </li>
        {commits.map((commit) => {
          const open = current === commit.id;
          return (
            <li key={commit.id}>
              <button
                type="button"
                aria-current={open ? "page" : undefined}
                {...clippedTooltip(commit.subject)}
                onClick={() => onCommit(commit.id)}
                {...stylex.props(
                  commitStyles.row,
                  commitStyles.commit,
                  open && [commitStyles.on, picked],
                )}
              >
                <span {...stylex.props(commitStyles.sha)}>{commit.id.slice(0, 7)}</span>
                <span data-clip="" {...stylex.props(commitStyles.commitSubject)}>
                  {commit.subject}
                </span>
                {fresh?.has(commit.id) && (
                  <span
                    title="New since your last review"
                    aria-label="new"
                    {...stylex.props(commitStyles.fresh)}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

const styles = stylex.create({
  rail: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
  },
  width: (width: number) => ({ width }),
  hidden: { display: "none" },
  commits: {
    flexShrink: 0,
    maxHeight: "40%",
    overflowY: "auto",
    scrollbarWidth: "thin",
    paddingInline: 6,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
});

const commitStyles = stylex.create({
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
  list: { listStyle: "none", margin: 0, padding: 0 },
  row: {
    display: "flex",
    alignItems: "center",
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
  commit: { minHeight: 30, paddingInline: 8, gap: 9 },
  sha: {
    flexShrink: 0,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  // As wide as a short hash, so the subjects line up.
  all: { width: "7ch" },
  fresh: {
    flexShrink: 0,
    width: 6,
    height: 6,
    marginLeft: "auto",
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  commitSubject: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },
});
