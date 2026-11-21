import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { tokens } from "../theme.stylex";

/**
 * What a pane or a page shows with nothing in it: one line naming what is
 * missing, a note on what to do, and at most one action. In a pane it sits in
 * the middle; on a page (`page`), under the heading at the column's edge.
 */
export function EmptyState({
  title,
  note,
  action,
  page = false,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  page?: boolean;
}) {
  return (
    <div {...stylex.props(styles.box, page ? styles.page : styles.pane)}>
      <p {...stylex.props(styles.title)}>{title}</p>
      {note && <p {...stylex.props(styles.note)}>{note}</p>}
      {action && <div {...stylex.props(styles.action)}>{action}</div>}
    </div>
  );
}

const styles = stylex.create({
  box: { display: "grid", gap: 4 },
  pane: {
    flex: "1",
    alignContent: "center",
    justifyItems: "center",
    padding: 24,
    textAlign: "center",
  },
  page: { justifyItems: "start", marginTop: 28 },
  title: { margin: 0, color: tokens.text, fontSize: 13.5, fontWeight: 500 },
  note: { margin: 0, maxWidth: 520, color: tokens.muted, fontSize: 13, lineHeight: 1.55 },
  action: { marginTop: 10 },
});
