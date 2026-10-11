import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { tokens } from "../theme.stylex";
import "./TitleRow.css";

/**
 * The window's top row when Med draws the title bar: room for the window
 * controls on the left, then what heads the window. The row moves the
 * window; its controls take clicks (TitleRow.css).
 */
export function TitleRow({ children }: { children?: ReactNode }) {
  const { className, style } = stylex.props(styles.row);
  return (
    <div className={`med-title-row ${className ?? ""}`} style={style}>
      {children}
    </div>
  );
}

const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    minWidth: 0,
    height: "var(--med-titlebar-height)",
    paddingInlineStart: "calc(var(--med-titlebar-left) + 4px)",
    paddingInlineEnd: "calc(var(--med-titlebar-right) + 8px)",
    backgroundColor: tokens.panel,
  },
});
