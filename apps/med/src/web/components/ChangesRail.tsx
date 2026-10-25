import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
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
  /** The saved comparison shows. */
  whole: boolean;
  onCommit(id: string): void;
  onWhole(): void;
};

/**
 * The Changes tab's rail in a saved review: the changed files as a tree, and
 * the range's commits. It sits where the Guide's rail does, so the diff keeps
 * its place between the tabs. Its edge resizes it (ColumnResize.tsx).
 */
export function ChangesRail({
  commits,
  moreCommits,
  commit,
  whole,
  onCommit,
  onWhole,
  ...files
}: ComponentProps<typeof FileSidebar> & CommitProps) {
  const { measure, width, pane } = useColumnWidth("changes", () => RAIL_WIDTH);
  return (
    <nav
      ref={measure}
      aria-label="Files and commits"
      {...stylex.props(styles.rail, styles.width(width))}
    >
      <FileSidebar {...files} />
      <RangeCommits
        commits={commits}
        moreCommits={moreCommits}
        commit={commit}
        whole={whole}
        onCommit={onCommit}
        onWhole={onWhole}
      />
      <ColumnHandle kind="changes" width={width} pane={pane} label="the file list" />
    </nav>
  );
}

/** A range's commits under its files, in the rail or the Changed files pane.
 * A range of one commit lists none. */
export function RangeCommits({
  commits,
  moreCommits,
  commit,
  whole,
  onCommit,
  onWhole,
}: CommitProps) {
  if (commits.length < 2) return null;
  return (
    <div {...stylex.props(styles.commits)}>
      <RailCommits
        commits={commits}
        more={moreCommits}
        current={commit}
        onCommit={onCommit}
        whole={{ current: whole, onShow: onWhole }}
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
