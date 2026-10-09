import { Tooltip } from "@base-ui/react/tooltip";
import * as stylex from "@stylexjs/stylex";
import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { BlameCell } from "../data/blame-gutter";
import { tokens, ui } from "../theme.stylex";

const shortCommit = (commit: string) => (/^0+$/.test(commit) ? "Uncommitted" : commit.slice(0, 8));
const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const compactDate = (entry: BlameCell["entry"]) => {
  const timestamp = Date.parse(entry.date);
  return /^0+$/.test(entry.commit) || !Number.isFinite(timestamp)
    ? null
    : dateFormatter.format(timestamp);
};

/** React portals keep Base UI's trigger and delay-group behavior inside Pierre's
 * shadow root. Only mounted line numbers get a trigger; one popup is shared. */
export function BlameTooltips({ cells }: { cells: BlameCell[] }) {
  const handle = useMemo(() => Tooltip.createHandle<BlameCell["entry"]>(), []);
  return (
    <Tooltip.Provider delay={250} closeDelay={60} timeout={600}>
      {cells.map(({ container, entry }) =>
        createPortal(
          <Tooltip.Trigger
            handle={handle}
            payload={entry}
            render={<span />}
            data-med-blame-trigger=""
            tabIndex={-1}
            aria-label={`Line ${entry.line}: ${shortCommit(entry.commit)} · ${entry.author}${compactDate(entry) ? ` · ${entry.date}` : ""} · ${entry.summary}`}
          >
            <span>{entry.author}</span>
            <span>{shortCommit(entry.commit)}</span>
            {compactDate(entry) && <time dateTime={entry.date}>{compactDate(entry)}</time>}
          </Tooltip.Trigger>,
          container,
          String(entry.line),
        ),
      )}
      <Tooltip.Root handle={handle} disabled={!cells.length}>
        {({ payload }) => (
          <Tooltip.Portal>
            <Tooltip.Positioner
              side="right"
              align="start"
              sideOffset={12}
              {...stylex.props(styles.positioner)}
            >
              <Tooltip.Popup role="tooltip" {...stylex.props(styles.popup, ui.instant)}>
                {payload && (
                  <>
                    <div {...stylex.props(styles.meta)}>
                      <strong>{payload.author}</strong>
                      {compactDate(payload) && <time dateTime={payload.date}>{payload.date}</time>}
                    </div>
                    <div>{payload.summary}</div>
                    <span {...stylex.props(styles.commit)}>
                      {shortCommit(payload.commit)} · Line {payload.line}
                    </span>
                  </>
                )}
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
const styles = stylex.create({
  positioner: { zIndex: 100 },
  popup: {
    backgroundColor: tokens.raised,
    color: tokens.text,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: `calc(6px * ${tokens.round})`,
    boxShadow: tokens.shadow,
    padding: 10,
    maxWidth: 360,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.5,
  },
  meta: { display: "flex", gap: 16, justifyContent: "space-between", color: tokens.muted },
  commit: { fontFamily: tokens.code, fontSize: 10, color: tokens.muted },
});
