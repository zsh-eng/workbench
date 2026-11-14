import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";
import { ColumnHandle, useColumnWidth } from "./ColumnResize";
import { RepositoryFiles, type RepositoryFilesProps } from "./RepositoryFiles";

/** As wide as the other pages' sidebars. */
const RAIL_WIDTH = 268;

/**
 * The Files page's sidebar: the files of what the workspace shows, as a
 * tree. It sits where Changes' changed files and Review's guide do, and its
 * edge resizes it (ColumnResize.tsx). Hidden, it keeps its tree.
 */
export function FilesRail({
  hidden = false,
  ...files
}: RepositoryFilesProps & { hidden?: boolean }) {
  const { measure, width, pane } = useColumnWidth("files", () => RAIL_WIDTH);
  return (
    <nav
      ref={measure}
      aria-label="Workspace files"
      hidden={hidden}
      {...stylex.props(styles.rail, styles.width(width), hidden && styles.hidden)}
    >
      <RepositoryFiles {...files} rail />
      <ColumnHandle kind="files" width={width} pane={pane} label="the files" />
    </nav>
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
});
