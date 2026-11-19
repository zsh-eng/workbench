import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import {
  sameValues,
  type Dashboard,
  type DashboardHistoryEntry as HistoryEntry,
} from "../../../shared/dashboards";
import { rangeLabel } from "../../../shared/time-range";
import { relativeTime } from "../../data/relative-time";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";

// The History menu at the end of a dashboard's inputs: each set of values the
// dashboard showed in any window, newest first, with what changed from the
// one before it. A row shows those values again, as a step that Back undoes.

type Part = { key: string; text: string; changed: boolean };

/** The values in words, in the inputs' order, then the range. */
function parts(
  dashboard: Dashboard,
  entry: HistoryEntry,
  before: HistoryEntry | undefined,
  now: number,
) {
  const list: Part[] = dashboard.inputs.map((input) => {
    const value = entry.values[input.name] ?? input.default;
    return {
      key: input.name,
      text: input.labels?.[value] ?? value,
      changed: !!before && (before.values[input.name] ?? input.default) !== value,
    };
  });
  const { from, to } = entry.values;
  if (dashboard.range && from !== undefined)
    list.push({
      key: "range",
      text: rangeLabel({ from, to: to ?? "now" }, now),
      changed: !!before && (before.values.from !== from || before.values.to !== to),
    });
  return list;
}

export function InputHistory({
  dashboard,
  entries,
  current,
  onOpen,
  onPick,
}: {
  dashboard: Dashboard;
  entries: readonly HistoryEntry[];
  /** What the page shows now. */
  current: Record<string, string>;
  /** The menu opens: another window may have kept values since. */
  onOpen(): void;
  onPick(values: Record<string, string>): void;
}) {
  const [open, setOpen] = useState(false);
  // The ages count from when the menu opens.
  const [now, setNow] = useState(Date.now);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setNow(Date.now());
          onOpen();
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger
        data-input-history=""
        aria-label="Input history"
        disabled={entries.length < 2}
        {...tooltip(entries.length < 2 ? "Values you change show here" : "Values you looked at")}
        {...stylex.props(ui.button, ui.iconButton, ui.pressable)}
      >
        <Icon name="history" size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} {...stylex.props(styles.positioner)}>
          <Popover.Popup aria-label="Input history" {...stylex.props(styles.popup, ui.pop)}>
            <div {...stylex.props(styles.head)}>Values you looked at</div>
            <div {...stylex.props(styles.list)}>
              {entries.map((entry, index) => {
                const showing = sameValues(entry.values, current);
                return (
                  <button
                    key={entry.at}
                    type="button"
                    data-history-row=""
                    aria-current={showing || undefined}
                    {...stylex.props(styles.row, showing && styles.rowOn)}
                    onClick={() => {
                      setOpen(false);
                      if (!showing) onPick(entry.values);
                    }}
                  >
                    <span {...stylex.props(styles.check)}>
                      {showing && <Icon name="check" size={13} />}
                    </span>
                    <span {...stylex.props(styles.values)}>
                      {parts(dashboard, entry, entries[index + 1], now).map((part, at) => (
                        <span key={part.key}>
                          {at > 0 && <span {...stylex.props(styles.dot)}> · </span>}
                          <span {...stylex.props(part.changed && styles.changed)}>{part.text}</span>
                        </span>
                      ))}
                    </span>
                    <span {...stylex.props(styles.when)}>
                      {entry.by === "agent" && <span {...stylex.props(styles.by)}>Agent</span>}
                      {relativeTime(entry.at, now)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const styles = stylex.create({
  positioner: { zIndex: 100, outline: "none" },
  popup: {
    boxSizing: "border-box",
    width: "min(460px, calc(100vw - 24px))",
    maxHeight: "min(480px, calc(100vh - 80px))",
    overflowY: "auto",
    paddingBlock: 6,
    backgroundColor: tokens.menu,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(12px * ${tokens.round})`,
    boxShadow: tokens.shadow,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    outline: "none",
  },
  head: {
    paddingInline: 14,
    paddingTop: 6,
    paddingBottom: 6,
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 550,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
  },
  list: { display: "flex", flexDirection: "column", paddingInline: 6 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 32,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.muted,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
  },
  rowOn: { color: tokens.text },
  check: { width: 14, flexShrink: 0, display: "flex", color: tokens.accent },
  values: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dot: { color: tokens.faint },
  changed: { color: tokens.text, fontWeight: 550 },
  when: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  by: {
    paddingInline: 5,
    borderRadius: 4,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontSize: 11,
  },
});
