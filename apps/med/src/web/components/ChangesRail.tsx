import * as stylex from "@stylexjs/stylex";
import type { ComponentProps } from "react";
import type { SavedCommit } from "../../shared/review-guide";
import { tokens } from "../theme.stylex";
import { FileSidebar } from "./FileSidebar";
import { RailCommits } from "./guide/GuideRail";

/**
 * The Changes tab's rail in a saved review: the changed files as a tree, and
 * the range's commits. It sits where the Guide's rail does, so the diff keeps
 * its place between the tabs.
 */
export function ChangesRail({
  commits,
  moreCommits,
  commit,
  whole,
  onCommit,
  onWhole,
  narrow,
  ...files
}: ComponentProps<typeof FileSidebar> & {
  /** The review pane has little room: the rail gives the diff more. */
  narrow: boolean;
  commits: readonly SavedCommit[];
  moreCommits?: boolean;
  /** The commit of the range that shows, if one does. */
  commit: string | null;
  /** The saved comparison shows. */
  whole: boolean;
  onCommit(id: string): void;
  onWhole(): void;
}) {
  return (
    <nav aria-label="Files and commits" {...stylex.props(styles.rail, narrow && styles.narrow)}>
      <FileSidebar {...files} />
      {commits.length > 1 && (
        <div {...stylex.props(styles.commits)}>
          <RailCommits
            commits={commits}
            more={moreCommits}
            current={commit}
            onCommit={onCommit}
            whole={{ current: whole, onShow: onWhole }}
          />
        </div>
      )}
    </nav>
  );
}

const styles = stylex.create({
  // As wide as the Guide's rail.
  rail: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    width: 268,
    minHeight: 0,
    borderRightWidth: 1,
    borderRightStyle: "solid",
    borderRightColor: tokens.line,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
  },
  narrow: { width: 220 },
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
