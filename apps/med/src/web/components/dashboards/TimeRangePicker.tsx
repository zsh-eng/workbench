import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useMinuteClock } from "../../data/relative-time";
import {
  endsNow,
  isRelative,
  momentRange,
  momentText,
  parseMoment,
  parseRange,
  QUICK_RANGES,
  rangeLabel,
  rangePreview,
  resolveRange,
  shiftRange,
  zoneLabel,
  zoomOutRange,
  type TimeRange,
} from "../../../shared/time-range";
import { picked, tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";

// A dashboard's time picker, after Grafana's: a button that names the range,
// with Earlier, Later, and Zoom out beside it. Its panel has a field that
// reads what a person types (6h, yesterday 14:00 to 16:30, since 9:00), and
// says the moments that it means before they apply; the ready ranges, which
// the field narrows as it is typed in; the ranges used lately; and a month to
// pick days on, with From and To to set the times. Times are the reader's
// own, and the panel's foot names the zone.

const RECENT_KEY = "med:dashboard-ranges";
const RECENT_MOST = 4;

function readRecent(): TimeRange[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (entry): entry is TimeRange =>
              typeof entry?.from === "string" && typeof entry?.to === "string",
          )
          .slice(0, RECENT_MOST)
      : [];
  } catch {
    return [];
  }
}

/** A range used now goes first among the recent ones; the ready ranges are
 * listed anyway. */
function keepRecent(range: TimeRange) {
  if (QUICK_RANGES.some((entry) => entry.from === range.from && entry.to === range.to)) return;
  const next = [
    range,
    ...readRecent().filter((entry) => entry.from !== range.from || entry.to !== range.to),
  ].slice(0, RECENT_MOST);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* The list lasts as long as the page. */
  }
}

const same = (a: TimeRange, b: TimeRange) => a.from === b.from && a.to === b.to;

export function TimeRangePicker({
  range,
  onChange,
}: {
  range: TimeRange;
  onChange(range: TimeRange): void;
}) {
  const [open, setOpen] = useState(false);
  const apply = (next: TimeRange) => {
    keepRecent(next);
    setOpen(false);
    if (!same(next, range)) onChange(next);
  };
  const now = useMinuteClock(true);
  const atNow = endsNow(range, now);
  const field = useRef<HTMLInputElement>(null);
  return (
    <div role="group" aria-label="Time range" {...stylex.props(styles.group)}>
      <button
        type="button"
        aria-label="Earlier"
        {...tooltip("Earlier: half the range back")}
        onClick={() => onChange(shiftRange(range, -1))}
        {...stylex.props(ui.button, ui.iconButton, styles.step, styles.stepStart)}
      >
        <Icon name="chevron" size={14} style={{ transform: "rotate(90deg)" }} />
      </button>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          data-range-trigger=""
          aria-label={`Time range: ${rangeLabel(range, now)}`}
          {...stylex.props(ui.button, ui.strong, styles.trigger)}
        >
          <Icon name="clock" size={14} />
          <span {...stylex.props(styles.triggerText)}>{rangeLabel(range, now)}</span>
          <span {...stylex.props(styles.chevron)}>
            <Icon name="chevron" size={14} />
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner align="start" sideOffset={6} {...stylex.props(styles.positioner)}>
            <Popover.Popup
              aria-label="Time range"
              initialFocus={field}
              {...stylex.props(styles.popup, ui.pop)}
            >
              <RangePanel range={range} onApply={apply} field={field} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <button
        type="button"
        aria-label="Later"
        disabled={atNow}
        {...tooltip(atNow ? "The range ends now" : "Later: half the range on")}
        onClick={() => onChange(shiftRange(range, 1))}
        {...stylex.props(ui.button, ui.iconButton, styles.step)}
      >
        <Icon name="chevron" size={14} style={{ transform: "rotate(-90deg)" }} />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        {...tooltip("Zoom out: twice the range")}
        onClick={() => onChange(zoomOutRange(range))}
        {...stylex.props(ui.button, ui.iconButton, styles.step, styles.stepEnd)}
      >
        <Icon name="minimize" size={14} />
      </button>
    </div>
  );
}

type Row = TimeRange & { label: string; group: string };

/** What the field reads, for a reader who wonders. */
const EXAMPLES = [
  "6h",
  "yesterday",
  "since 9:00",
  "yesterday 14:00 to 16:30",
  "Nov 14 to Nov 16",
  "last week",
  "now-7d to now-1d",
];

function RangePanel({
  range,
  onApply,
  field,
}: {
  range: TimeRange;
  onApply(range: TimeRange): void;
  field: React.RefObject<HTMLInputElement | null>;
}) {
  // The moment the panel opened: the words count from it.
  const [now] = useState(Date.now);
  const [text, setText] = useState("");
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState("");
  const listId = useId();
  const read = text.trim() ? parseRange(text, now) : null;
  const typed = read && "range" in read ? read.range : null;
  const recent = useMemo(readRecent, []);
  const query = text.trim().toLowerCase();
  const rows: Row[] = useMemo(() => {
    const all: Row[] = [
      ...recent.map((entry) => ({ ...entry, label: rangeLabel(entry, now), group: "Recent" })),
      ...QUICK_RANGES,
    ];
    return query
      ? all.filter(
          (row) =>
            row.label.toLowerCase().includes(query) ||
            row.from.toLowerCase().includes(query.replace(/^last\s+/, "")),
        )
      : all;
    // `now` moves each render; the rows need only the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recent, query]);
  const groups = [...new Set(rows.map((row) => row.group))];

  const choose = (next: TimeRange) => onApply(next);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive(
        (last) => (last + step + rows.length + (last < 0 && step < 0 ? 1 : 0)) % rows.length,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && rows[active]) choose(rows[active]!);
      else if (typed) choose(typed);
      else if (read && "error" in read) setProblem(read.error);
    }
  };

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.fieldBand)}>
        <Icon name="search" size={14} />
        <input
          ref={field}
          type="text"
          value={text}
          spellCheck={false}
          aria-label="Type a range"
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Type a range: 6h, yesterday 14:00 to 16:30, since 9:00, Nov 14 to Nov 16"
          onChange={(event) => {
            setText(event.target.value);
            setActive(-1);
            setProblem("");
          }}
          onKeyDown={onKeyDown}
          {...stylex.props(styles.field)}
        />
      </div>
      <p
        role="status"
        {...stylex.props(styles.preview, (!!problem || !typed) && styles.previewQuiet)}
      >
        {problem ? (
          <span {...stylex.props(styles.problem)}>{problem}</span>
        ) : typed ? (
          <>
            <span {...stylex.props(styles.previewText)}>{rangePreview(typed, now)}</span>
            <span {...stylex.props(styles.previewKey)}>Enter</span>
          </>
        ) : (
          `Showing ${rangePreview(range, now) || rangeLabel(range, now)}`
        )}
      </p>
      <div {...stylex.props(styles.columns)}>
        <div id={listId} role="listbox" aria-label="Ranges" {...stylex.props(styles.list)}>
          {!rows.length && (
            // Words that read as a range need no ready one: say what else reads.
            <div {...stylex.props(styles.empty)}>
              <p {...stylex.props(styles.emptyLead)}>
                {typed ? "Press Enter for the range above." : "No ready range matches."}
              </p>
              <p {...stylex.props(styles.emptyLead)}>Med also reads:</p>
              <ul {...stylex.props(styles.examples)}>
                {EXAMPLES.map((example) => (
                  <li key={example}>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        setText(example);
                        setActive(-1);
                        setProblem("");
                        field.current?.focus();
                      }}
                      {...stylex.props(styles.example)}
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {groups.map((group) => (
            <div key={group} role="group" aria-label={group}>
              <p aria-hidden="true" {...stylex.props(styles.groupLabel)}>
                {group}
              </p>
              {rows.map((row, index) =>
                row.group !== group ? null : (
                  <button
                    type="button"
                    tabIndex={-1}
                    key={`${row.group}:${row.from}:${row.to}`}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={same(row, range)}
                    data-range-row=""
                    onPointerMove={() => setActive(index)}
                    onClick={() => choose(row)}
                    {...stylex.props(
                      ui.menuItem,
                      styles.row,
                      index === active && [ui.menuHighlighted, picked],
                    )}
                  >
                    <span {...stylex.props(styles.rowLabel)}>{row.label}</span>
                    {same(row, range) && (
                      <span {...stylex.props(styles.check)}>
                        <Icon name="check" size={14} />
                      </span>
                    )}
                  </button>
                ),
              )}
            </div>
          ))}
        </div>
        <AbsoluteRange range={typed ?? range} onApply={choose} />
      </div>
      <p {...stylex.props(styles.zone)}>
        <Icon name="globe" size={12} />
        Times in {zoneLabel(now)}
      </p>
    </div>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY = 86_400_000;
const dayStart = (time: number) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};
const nextDay = (day: number) => {
  const date = new Date(day);
  date.setDate(date.getDate() + 1);
  return date.getTime();
};

/** A month of days to pick a range on, and From and To to set its times. */
function AbsoluteRange({ range, onApply }: { range: TimeRange; onApply(range: TimeRange): void }) {
  const [now] = useState(Date.now);
  const resolved = resolveRange(range, now);
  const [from, setFrom] = useState(() => momentText(range.from));
  const [to, setTo] = useState(() => momentText(range.to));
  // A range from elsewhere, as the field's, fills From and To.
  const [shown, setShown] = useState(range);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [month, setMonth] = useState(() => {
    const date = new Date(resolved?.[1] ?? now);
    return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  });
  if (!same(shown, range)) {
    setShown(range);
    setFrom(momentText(range.from));
    setTo(momentText(range.to));
  }
  const fromAt = parseMoment(from, false, now);
  const toAt = parseMoment(to, true, now);
  const draft = fromAt && toAt ? { from: fromAt, to: toAt } : null;
  const span = draft ? resolveRange(draft, now) : null;
  const problem = !fromAt
    ? "From is no time Med reads."
    : !toAt
      ? "To is no time Med reads."
      : !span
        ? "To comes before From."
        : "";

  const first = new Date(month);
  const lead = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), index - lead + 1);
    return date.getTime();
  });
  const today = dayStart(now);
  const pick = (day: number) => {
    if (anchor === null) {
      setAnchor(day);
      setFrom(momentText(String(day)));
      setTo(momentText(String(nextDay(day) - 1)));
      return;
    }
    const [start, end] = day < anchor ? [day, anchor] : [anchor, day];
    setAnchor(null);
    setFrom(momentText(String(start)));
    setTo(momentText(String(nextDay(end) - 1)));
  };
  const step = (by: number) => {
    const date = new Date(month);
    setMonth(new Date(date.getFullYear(), date.getMonth() + by, 1).getTime());
  };
  const inRange = (day: number) => !!span && day + DAY > span[0] && day <= span[1];
  const isEnd = (day: number) => !!span && (dayStart(span[0]) === day || dayStart(span[1]) === day);

  return (
    <div {...stylex.props(styles.absolute)}>
      <div {...stylex.props(styles.monthHead)}>
        <button
          type="button"
          aria-label="The month before"
          onClick={() => step(-1)}
          {...stylex.props(ui.button, ui.iconButton, styles.monthStep)}
        >
          <Icon name="chevron" size={14} style={{ transform: "rotate(90deg)" }} />
        </button>
        <span aria-live="polite" {...stylex.props(styles.monthName)}>
          {MONTHS[first.getMonth()]} {first.getFullYear()}
        </span>
        <button
          type="button"
          aria-label="The month after"
          disabled={month > today}
          onClick={() => step(1)}
          {...stylex.props(ui.button, ui.iconButton, styles.monthStep)}
        >
          <Icon name="chevron" size={14} style={{ transform: "rotate(-90deg)" }} />
        </button>
      </div>
      <div role="grid" aria-label="Days" {...stylex.props(styles.days)}>
        {WEEKDAYS.map((day) => (
          <span key={day} role="columnheader" {...stylex.props(styles.weekday)}>
            {day}
          </span>
        ))}
        {cells.map((day) => {
          const date = new Date(day);
          const outside = date.getMonth() !== first.getMonth();
          const future = day > today;
          return (
            <button
              key={day}
              type="button"
              role="gridcell"
              data-day={momentText(String(day)).slice(0, 10)}
              aria-label={date.toDateString()}
              aria-selected={inRange(day)}
              disabled={future}
              onClick={() => pick(day)}
              {...stylex.props(
                styles.day,
                outside && styles.dayOutside,
                inRange(day) && styles.dayIn,
                isEnd(day) && styles.dayEnd,
                day === anchor && styles.dayEnd,
                day === today && styles.dayToday,
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <form
        {...stylex.props(styles.ends)}
        onSubmit={(event) => {
          event.preventDefault();
          if (draft && span) onApply(isRelative(draft.from) ? draft : momentRange(...span));
        }}
      >
        <label {...stylex.props(styles.end)}>
          <span {...stylex.props(styles.endLabel)}>From</span>
          <input
            type="text"
            value={from}
            spellCheck={false}
            aria-invalid={!fromAt || undefined}
            onChange={(event) => setFrom(event.target.value)}
            {...stylex.props(ui.input, styles.endInput)}
          />
        </label>
        <label {...stylex.props(styles.end)}>
          <span {...stylex.props(styles.endLabel)}>To</span>
          <input
            type="text"
            value={to}
            spellCheck={false}
            aria-invalid={!toAt || undefined}
            onChange={(event) => setTo(event.target.value)}
            {...stylex.props(ui.input, styles.endInput)}
          />
        </label>
        <div {...stylex.props(styles.applyRow)}>
          <span {...stylex.props(styles.endProblem)}>{problem}</span>
          <button
            type="submit"
            disabled={!!problem}
            {...stylex.props(ui.button, ui.primary, styles.apply)}
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}

const styles = stylex.create({
  group: {
    display: "inline-flex",
    alignItems: "stretch",
    height: 32,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
  },
  trigger: {
    height: "100%",
    gap: 8,
    paddingInline: 10,
    borderRadius: 0,
    borderInlineWidth: 1,
    borderInlineStyle: "solid",
    borderInlineColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.text,
    fontSize: 13,
  },
  triggerText: { whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
  chevron: { display: "inline-flex", color: tokens.faint },
  step: {
    height: "100%",
    minHeight: 0,
    width: 30,
    minWidth: 30,
    borderRadius: 0,
    color: { default: tokens.muted, ":disabled": tokens.faint },
    opacity: { default: 1, ":disabled": 0.45 },
  },
  stepStart: {
    borderStartStartRadius: `calc(7px * ${tokens.round})`,
    borderEndStartRadius: `calc(7px * ${tokens.round})`,
  },
  stepEnd: {
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.line,
    borderStartEndRadius: `calc(7px * ${tokens.round})`,
    borderEndEndRadius: `calc(7px * ${tokens.round})`,
  },
  positioner: { zIndex: 100, outline: "none" },
  popup: {
    boxSizing: "border-box",
    width: "min(640px, calc(100vw - 24px))",
    maxHeight: "min(620px, calc(100vh - 80px))",
    overflowY: "auto",
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
  panel: { display: "flex", flexDirection: "column" },
  fieldBand: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 46,
    paddingInline: 14,
    color: tokens.faint,
  },
  field: {
    flex: "1",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    font: "inherit",
    fontSize: 14,
  },
  preview: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 30,
    margin: 0,
    paddingInline: 14,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.text,
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
  },
  previewQuiet: { color: tokens.faint },
  previewText: { flex: "1", minWidth: 0 },
  previewKey: {
    flexShrink: 0,
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: `calc(4px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontSize: 11,
  },
  problem: { color: tokens.warning },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) 272px", "@media (max-width: 640px)": "1fr" },
  },
  list: {
    maxHeight: 380,
    overflowY: "auto",
    paddingBlock: 6,
    paddingInline: 6,
    borderInlineEndWidth: { default: 1, "@media (max-width: 640px)": 0 },
    borderInlineEndStyle: "solid",
    borderInlineEndColor: tokens.line,
  },
  groupLabel: {
    margin: 0,
    paddingInline: 10,
    paddingTop: 8,
    paddingBottom: 4,
    color: tokens.faint,
    fontSize: 11.5,
    fontWeight: 500,
  },
  row: {
    width: "100%",
    minHeight: 30,
    borderWidth: 0,
    color: "inherit",
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
  },
  rowLabel: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  check: { display: "inline-flex", color: tokens.accent },
  empty: { display: "flex", flexDirection: "column", gap: 6, padding: 10, color: tokens.faint },
  emptyLead: { margin: 0, fontSize: 12.5 },
  examples: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    margin: 0,
    marginTop: 2,
    padding: 0,
    listStyle: "none",
  },
  example: {
    paddingBlock: 3,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: { default: tokens.fill, ":hover": tokens.fillStrong },
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
    cursor: "pointer",
  },
  absolute: { display: "flex", flexDirection: "column", gap: 10, padding: 14 },
  monthHead: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  monthStep: { color: tokens.muted },
  monthName: { fontSize: 13, fontWeight: 550 },
  days: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: 2 },
  weekday: {
    paddingBlock: 4,
    color: tokens.faint,
    fontSize: 11,
    textAlign: "center",
  },
  day: {
    height: 30,
    padding: 0,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fillStrong },
    color: { default: tokens.text, ":disabled": tokens.faint },
    font: "inherit",
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
    borderRadius: `calc(6px * ${tokens.round})`,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.4 },
  },
  dayOutside: { color: tokens.faint },
  dayIn: { backgroundColor: tokens.accentSoft, borderRadius: 0 },
  dayEnd: {
    backgroundColor: tokens.accent,
    color: tokens.primaryText,
    borderRadius: `calc(6px * ${tokens.round})`,
  },
  dayToday: { fontWeight: 650, textDecoration: "underline", textUnderlineOffset: 3 },
  ends: { display: "flex", flexDirection: "column", gap: 8 },
  end: { display: "flex", alignItems: "center", gap: 10 },
  endLabel: { width: 36, color: tokens.muted, fontSize: 12 },
  endInput: { height: 30, fontFamily: tokens.code, fontSize: 12.5 },
  applyRow: { display: "flex", alignItems: "center", gap: 10, minHeight: 30 },
  endProblem: { flex: "1", color: tokens.warning, fontSize: 12 },
  apply: { minHeight: 30, paddingInline: 14 },
  zone: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    paddingBlock: 9,
    paddingInline: 14,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11.5,
  },
});
