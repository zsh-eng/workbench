import * as stylex from "@stylexjs/stylex";
import type { ComponentProps, ReactNode } from "react";
import type { SavedCommit } from "../../shared/review-guide";
import { tokens } from "../theme.stylex";
import { ColumnHandle, useColumnWidth } from "./ColumnResize";
import { FileSidebar } from "./FileSidebar";
import { RailCommits } from "./guide/GuideRail";

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
