import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useContext, useId, useMemo, useState, type PointerEvent } from "react";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";
import { formatMoment, formatValue } from "./chart-model";
import { OnBoard } from "./chart-board";
import { ChartCursor } from "./chart-cursor";
import { cellTime } from "./chart-block";
import { timeCell, type Stat, type Table } from "./chart-summary";

// A dashboard's two other kinds of panel, in a chart's frame: a stat, one
// number with its trend as a small line, and a table, the rows as a source
// printed them, sortable by any column. And the Inspect dialog that any
// chart opens: where its data came from, and what the source printed.

const surface = `var(--med-md-surface, color-mix(in srgb, ${tokens.text} 4%, ${tokens.canvas}))`;

export interface PanelFooter {
  /** Where the data came from: a host, a file. */
  label?: string;
  url?: string;
  /** When it was read. */
  fetched?: number;
  live?: boolean;
}

function Footer({
  footer,
  status,
  extra,
  onRefresh,
  onInspect,
}: {
  footer?: PanelFooter;
  /** What its read does now, in place of when it read: "Fetching · 4 s". */
  status?: string;
  extra?: string;
  onRefresh?(): void;
  onInspect?(): void;
}) {
  const when =
    footer?.fetched !== undefined
      ? footer.live
        ? "Live"
        : `Read ${new Date(footer.fetched).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : undefined;
  return (
    <footer {...stylex.props(styles.footer)}>
      <span {...stylex.props(styles.source)}>
        {/* While it reads, what it does comes first: a narrow panel cuts the host. */}
        {status && (
          <span data-panel-status="">
            {status}
            {(footer?.label || extra) && <span aria-hidden="true"> · </span>}
          </span>
        )}
        {footer?.label &&
          (footer.url ? (
            <a
              href={footer.url}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(styles.sourceLink)}
            >
              {footer.label}
            </a>
          ) : (
            <span {...stylex.props(styles.sourceName)}>{footer.label}</span>
          ))}
        {[extra, status ? undefined : when].filter(Boolean).map((part, index) => (
          <span key={part}>
            {(footer?.label || index > 0) && <span aria-hidden="true"> · </span>}
            {part}
          </span>
        ))}
      </span>
      <span {...stylex.props(styles.grow)} />
      <Tools {...(onRefresh ? { onRefresh } : {})} {...(onInspect ? { onInspect } : {})} />
    </footer>
  );
}

/** Refresh and Inspect: below the panel in a reply, beside its title on a
 * dashboard; either way they show while the pointer is on the panel. */
function Tools({ onRefresh, onInspect }: { onRefresh?(): void; onInspect?(): void }) {
  return (
    <>
      {onRefresh && (
        <button
          type="button"
          aria-label="Refresh"
          {...tooltip("Refresh")}
          onClick={onRefresh}
          {...stylex.props(ui.button, ui.iconButton, styles.tool, styles.more)}
        >
          <Icon name="refresh" size={13} />
        </button>
      )}
      {onInspect && (
        <button
          type="button"
          aria-label="Inspect data"
          {...tooltip("Inspect data")}
          onClick={onInspect}
          {...stylex.props(ui.button, ui.iconButton, styles.tool, styles.more)}
        >
          <Icon name="search" size={13} />
        </button>
      )}
    </>
  );
}

/** A dashboard panel's title row: its title, a fainter word of context (a
 * table's rows, a stat's series), what its read does now, and its tools. */
function BoardHead({
  title,
  extra,
  status,
  onRefresh,
  onInspect,
  quiet,
}: {
  title: string;
  extra?: string;
  status?: string;
  onRefresh?(): void;
  onInspect?(): void;
  /** A stat's title, quieter than its number. */
  quiet?: boolean;
}) {
  return (
    <div {...stylex.props(styles.boardHead)}>
      <figcaption {...stylex.props(styles.title, quiet && styles.titleQuiet, styles.boardTitle)}>
        {title}
        {extra && <span {...stylex.props(styles.extra)}>{extra}</span>}
      </figcaption>
      {status && (
        <span data-panel-status="" {...stylex.props(styles.headStatus)}>
          {status}
        </span>
      )}
      <span {...stylex.props(styles.headTools)}>
        <Tools {...(onRefresh ? { onRefresh } : {})} {...(onInspect ? { onInspect } : {})} />
      </span>
    </div>
  );
}

/** A small line under the number: its shape over the range, no axes. */
function Sparkline({
  points,
  mark,
  onPoint,
  bleed,
}: {
  points: readonly (number | null)[];
  /** The point of the page's shared cursor, by its index. */
  mark?: number;
  /** The point under the pointer, by its index; null as it leaves. */
  onPoint?(index: number | null): void;
  /** On a dashboard: along the panel's foot, edge to edge. */
  bleed?: boolean;
}) {
  const values = points.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 200;
  const height = 40;
  // Along a panel's foot, the lowest point keeps clear of its edge.
  const floor = bleed ? 9 : 2;
  let path = "";
  let pen = false;
  points.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = (index / (points.length - 1)) * width;
    const y = height - floor - ((value - min) / span) * (height - floor - 2);
    path += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  const area = `${path}L${width},${height}L0,${height}Z`;
  const id = `spark-${useId().replace(/[^\w-]/g, "")}`;
  const pointAt = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / (box.width || 1)));
    return Math.round(fraction * (points.length - 1));
  };
  const markX = mark !== undefined ? (mark / (points.length - 1)) * width : null;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      {...(onPoint
        ? {
            onPointerMove: (event: PointerEvent<SVGSVGElement>) => onPoint(pointAt(event)),
            onPointerLeave: () => onPoint(null),
          }
        : {})}
      {...stylex.props(styles.spark, bleed && styles.sparkBleed, onPoint && styles.sparkPointer)}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} stroke="none" />
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      {markX !== null && (
        <line
          x1={markX}
          x2={markX}
          y1={0}
          y2={height}
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
          opacity={0.8}
        />
      )}
    </svg>
  );
}

/** The point of `times` at the page's shared cursor, or -1 off its span. */
function cursorIndex(times: readonly number[] | undefined, time: number | null) {
  if (time === null || !times?.length || time < times[0]! || time > times.at(-1)!) return -1;
  let best = 0;
  for (let index = 1; index < times.length; index++)
    if (Math.abs(times[index]! - time) < Math.abs(times[best]! - time)) best = index;
  return best;
}

export function StatPanel({
  title,
  unit,
  stat,
  state,
  error,
  footer,
  onRefresh,
  onInspect,
  status,
}: {
  title: string;
  unit?: string;
  stat?: Stat;
  state: "loading" | "ready" | "error";
  error?: string;
  footer?: PanelFooter;
  onRefresh?(): void;
  onInspect?(): void;
  status?: string;
}) {
  // On a dashboard, the number reads the moment that the pointer is at on
  // any chart, and the pointer on its line moves that moment.
  const cursor = useContext(ChartCursor);
  const owner = useId();
  const times = stat?.times;
  const index = cursorIndex(times, cursor?.time ?? null);
  let atCursor: number | null = null;
  for (let at = index; at >= 0; at--)
    if (stat!.points[at] !== null && stat!.points[at] !== undefined) {
      atCursor = stat!.points[at]!;
      break;
    }
  const spacing = times && times.length > 1 ? times[1]! - times[0]! : 60_000;
  const value = index >= 0 ? atCursor : (stat?.value ?? null);
  const board = useContext(OnBoard);
  // The series, when the title does not name it already: "mean of nodes".
  const extra =
    stat?.label && stat.label !== unit && !title.toLowerCase().includes(stat.label.toLowerCase())
      ? stat.label
      : undefined;
  const shownStatus = status || state === "loading" ? (status ?? "Fetching…") : undefined;
  return (
    <figure data-stat-panel="" {...stylex.props(styles.frame, board && styles.frameBoard)}>
      {board ? (
        <BoardHead
          title={title}
          quiet
          {...(extra ? { extra } : {})}
          {...(shownStatus ? { status: shownStatus } : {})}
          {...(onRefresh ? { onRefresh } : {})}
          {...(onInspect ? { onInspect } : {})}
        />
      ) : (
        <figcaption {...stylex.props(styles.title)}>{title}</figcaption>
      )}
      {state === "error" ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : (
        <div {...stylex.props(styles.statRow)}>
          <span
            data-stat-value=""
            {...stylex.props(styles.statValue, state === "loading" && styles.waiting)}
          >
            {stat && value !== null ? formatValue(value, unit) : "–"}
          </span>
          {index >= 0 && times ? (
            <span data-stat-moment="" {...stylex.props(styles.change)}>
              at {formatMoment(times[index]!, spacing)}
            </span>
          ) : (
            stat?.change !== null &&
            stat?.change !== undefined && (
              // Neutral: whether up is good depends on what is measured. Its
              // start says what it changed from.
              <span data-stat-change="" {...stylex.props(styles.change)}>
                <span {...stylex.props(styles.changeAmount)}>
                  {stat.change >= 0 ? "↗" : "↘"}{" "}
                  {Math.abs(stat.change * 100).toFixed(Math.abs(stat.change) < 0.1 ? 1 : 0)}%
                </span>
                {times?.[0] !== undefined && (
                  <span {...stylex.props(styles.since)}>
                    since {formatMoment(times[0], spacing)}
                  </span>
                )}
              </span>
            )
          )}
        </div>
      )}
      {stat && state === "ready" ? (
        <Sparkline
          points={stat.points}
          bleed={board}
          {...(index >= 0 ? { mark: index } : {})}
          {...(cursor && times?.length
            ? {
                onPoint: (point: number | null) =>
                  cursor.set(point === null ? null : times[point]!, owner),
              }
            : {})}
        />
      ) : (
        // Its line's room, so the panel keeps its height when the data comes.
        state === "loading" && (
          <span
            aria-hidden="true"
            {...stylex.props(styles.spark, styles.sparkWaiting, board && styles.sparkLater)}
          />
        )
      )}
      {!board && (
        <Footer
          footer={footer}
          {...(shownStatus ? { status: shownStatus } : {})}
          {...(extra ? { extra } : {})}
          {...(onRefresh ? { onRefresh } : {})}
          {...(onInspect ? { onInspect } : {})}
        />
      )}
    </figure>
  );
}

const number = (cell: string) => Number(cell.replace(/[,_\s%]/g, ""));

export function TablePanel({
  title,
  table,
  state,
  error,
  footer,
  onRefresh,
  onInspect,
  status,
}: {
  title: string;
  table?: Table;
  state: "loading" | "ready" | "error";
  error?: string;
  footer?: PanelFooter;
  onRefresh?(): void;
  onInspect?(): void;
  status?: string;
}) {
  const [sort, setSort] = useState<{ column: number; down: boolean } | null>(null);
  const rows = useMemo(() => {
    if (!table || !sort) return table?.rows ?? [];
    const numeric = table.numeric[sort.column];
    const time = table.times?.[sort.column];
    return [...table.rows].sort((a, b) => {
      const left = a[sort.column] ?? "";
      const right = b[sort.column] ?? "";
      const order = time
        ? (cellTime(left) ?? 0) - (cellTime(right) ?? 0)
        : numeric
          ? number(left) - number(right)
          : left.localeCompare(right);
      return sort.down ? -order : order;
    });
  }, [table, sort]);
  const board = useContext(OnBoard);
  const count = table ? `${table.rows.length} row${table.rows.length === 1 ? "" : "s"}` : undefined;
  const shownStatus = status || state === "loading" ? (status ?? "Fetching…") : undefined;
  // The last column of words takes the room the others leave, and cuts its
  // text short with an ellipsis; the full text shows on hover.
  const wide = table
    ? table.columns.findLastIndex((_, index) => !table.numeric[index] && !table.times?.[index])
    : -1;
  return (
    <figure
      data-table-panel=""
      {...stylex.props(styles.frame, board && styles.frameBoard, board && styles.tableBoard)}
    >
      {board ? (
        <BoardHead
          title={title}
          {...(count ? { extra: count } : {})}
          {...(shownStatus ? { status: shownStatus } : {})}
          {...(onRefresh ? { onRefresh } : {})}
          {...(onInspect ? { onInspect } : {})}
        />
      ) : (
        <figcaption {...stylex.props(styles.title)}>{title}</figcaption>
      )}
      {state === "error" ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : !table ? (
        // Rows to come, as tall as a short table's, so the page keeps its place.
        <div aria-hidden="true" data-table-waiting="" {...stylex.props(styles.tableScroll)}>
          {Array.from({ length: 7 }, (_, index) => (
            <span
              key={index}
              {...stylex.props(styles.skeletonRow, index === 0 && styles.skeletonHead)}
            >
              <span
                {...stylex.props(styles.skeletonCell(index === 0 ? 34 : 46 + ((index * 17) % 30)))}
              />
              <span
                {...stylex.props(styles.skeletonCell(index === 0 ? 14 : 10 + ((index * 7) % 12)))}
              />
            </span>
          ))}
        </div>
      ) : (
        <div {...stylex.props(styles.tableScroll)}>
          <table {...stylex.props(styles.table)}>
            <thead>
              <tr>
                {table.columns.map((column, index) => (
                  <th
                    key={`${column}\0${index}`}
                    scope="col"
                    aria-sort={
                      sort?.column === index ? (sort.down ? "descending" : "ascending") : undefined
                    }
                    {...stylex.props(
                      styles.th,
                      table.numeric[index] && styles.numeric,
                      index === wide && styles.wide,
                    )}
                  >
                    <button
                      type="button"
                      {...stylex.props(styles.sortButton, table.numeric[index] && styles.sortEnd)}
                      onClick={() =>
                        setSort((last) =>
                          last?.column === index
                            ? last.down === !!table.numeric[index]
                              ? { column: index, down: !last.down }
                              : null
                            : { column: index, down: !!table.numeric[index] },
                        )
                      }
                    >
                      {column}
                      {sort?.column === index && (
                        <Icon name={sort.down ? "arrowDown" : "arrowUp"} size={11} />
                      )}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} {...stylex.props(styles.tr)}>
                  {table.columns.map((_, index) => {
                    const cell = row[index] ?? "";
                    return (
                      <td
                        key={index}
                        {...(cell.length > 24 ? { title: cell } : {})}
                        {...stylex.props(
                          styles.td,
                          table.numeric[index] && styles.numeric,
                          index === wide && styles.wide,
                        )}
                      >
                        {table.times?.[index] && cell ? timeCell(cell) : cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!board && (
        <Footer
          footer={footer}
          {...(shownStatus ? { status: shownStatus } : {})}
          {...(count ? { extra: count } : {})}
          {...(onRefresh ? { onRefresh } : {})}
          {...(onInspect ? { onInspect } : {})}
        />
      )}
    </figure>
  );
}

/** Where a chart's data came from, for the Inspect dialog. */
export interface Inspection {
  title: string;
  link?: string;
  /** The chart source's base and command, or Grafana, or a file. */
  from: string;
  command?: string;
  /** What the command read, as its environment held it. */
  env: [string, string][];
  fetched?: number;
  /** What the source printed, as it printed it. */
  output?: string;
}

const MOST = 40_000;

export function InspectDialog({
  inspection,
  onClose,
}: {
  inspection: Inspection;
  onClose(): void;
}) {
  const output =
    inspection.output && inspection.output.length > MOST
      ? `${inspection.output.slice(0, MOST)}\n… ${inspection.output.length - MOST} more characters`
      : inspection.output;
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
        <Dialog.Popup {...stylex.props(styles.popup, ui.instant)}>
          <div {...stylex.props(styles.dialogHeader)}>
            <Dialog.Title {...stylex.props(styles.dialogTitle)}>{inspection.title}</Dialog.Title>
            <Dialog.Close aria-label="Close" {...stylex.props(ui.button, ui.iconButton)}>
              <Icon name="close" size={15} />
            </Dialog.Close>
          </div>
          <div {...stylex.props(styles.dialogBody)}>
            <dl {...stylex.props(styles.facts)}>
              {inspection.link && (
                <>
                  <dt {...stylex.props(styles.fact)}>Link</dt>
                  <dd {...stylex.props(styles.factValue, styles.mono)}>
                    <a
                      href={inspection.link}
                      target="_blank"
                      rel="noreferrer"
                      {...stylex.props(styles.link)}
                    >
                      {inspection.link}
                    </a>
                  </dd>
                </>
              )}
              <dt {...stylex.props(styles.fact)}>From</dt>
              <dd {...stylex.props(styles.factValue)}>{inspection.from}</dd>
              {inspection.command && (
                <>
                  <dt {...stylex.props(styles.fact)}>Command</dt>
                  <dd {...stylex.props(styles.factValue, styles.mono)}>{inspection.command}</dd>
                </>
              )}
              {inspection.fetched !== undefined && (
                <>
                  <dt {...stylex.props(styles.fact)}>Read</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {new Date(inspection.fetched).toLocaleString()}
                  </dd>
                </>
              )}
            </dl>
            {inspection.env.length > 0 && (
              <section aria-label="What the command read">
                <h3 {...stylex.props(styles.heading)}>What the command read</h3>
                <pre {...stylex.props(styles.pre)}>
                  {inspection.env.map(([name, value]) => `${name}=${value}`).join("\n")}
                </pre>
              </section>
            )}
            <section aria-label="What it printed">
              <h3 {...stylex.props(styles.heading)}>What it printed</h3>
              <pre {...stylex.props(styles.pre, styles.output)}>
                {output ?? "Nothing yet: the chart has not read its data."}
              </pre>
            </section>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles = stylex.create({
  frame: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingTop: 18,
    paddingInline: 20,
    paddingBottom: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: surface,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "normal",
    // What a table's sticky head covers the rows with: the frame's own fill.
    "--chart-surface": surface,
  },
  // On a dashboard: a hairline on the page, as tall as its row, no fill.
  frameBoard: {
    height: "100%",
    boxSizing: "border-box",
    overflow: "hidden",
    paddingTop: 14,
    paddingInline: 16,
    paddingBottom: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: "transparent",
    "--chart-surface": tokens.canvas,
  },
  tableBoard: { paddingBottom: 6 },
  title: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "-0.005em",
    color: tokens.text,
  },
  titleQuiet: { color: tokens.muted, fontWeight: 500 },
  boardHead: { display: "flex", alignItems: "center", gap: 8, minHeight: 18 },
  boardTitle: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  extra: { marginInlineStart: 8, color: tokens.faint, fontWeight: 400, fontSize: 12 },
  headStatus: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  // They take no height of their own, so the title row stays as tall as its text.
  headTools: { display: "inline-flex", gap: 2, marginBlock: -5, marginInlineEnd: -6 },
  statRow: { display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 },
  statValue: {
    fontSize: 26,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },
  waiting: { color: tokens.faint },
  change: {
    display: "inline-flex",
    alignItems: "baseline",
    gap: 6,
    minWidth: 0,
    color: tokens.muted,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  changeAmount: { color: tokens.muted, fontWeight: 500 },
  since: { color: tokens.faint },
  spark: {
    display: "block",
    width: "100%",
    height: 40,
    marginTop: 10,
    color: tokens.accent,
    overflow: "visible",
  },
  // Along the panel's foot, edge to edge; a taller row leaves its room above.
  sparkBleed: {
    flexShrink: 0,
    width: "calc(100% + 32px)",
    height: 36,
    marginTop: "auto",
    marginInline: -16,
    marginBottom: -12,
    paddingTop: 12,
    boxSizing: "content-box",
  },
  error: { margin: 0, marginTop: 10, color: tokens.muted, lineHeight: 1.45 },
  sparkPointer: { cursor: "crosshair" },
  sparkLater: { height: 36, marginTop: "auto", paddingTop: 12, boxSizing: "content-box" },
  sparkWaiting: {
    borderBottomWidth: 1,
    borderBottomStyle: "dashed",
    borderBottomColor: tokens.line,
    boxSizing: "border-box",
  },
  skeletonRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    height: 30,
    alignItems: "center",
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in srgb, ${tokens.text} 6%, transparent)`,
  },
  skeletonHead: { borderBottomColor: tokens.line },
  skeletonCell: (percent: number) => ({
    width: `${percent}%`,
    height: 8,
    borderRadius: 4,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 7%, transparent)`,
  }),
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
    marginTop: 8,
    color: tokens.faint,
    fontSize: 11.5,
  },
  source: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  sourceLink: {
    color: { default: tokens.muted, ":hover": tokens.text },
    textDecoration: "none",
  },
  sourceName: { color: tokens.muted },
  grow: { flex: "1" },
  tool: { width: 24, minWidth: 24, height: 24, minHeight: 24, color: tokens.faint },
  more: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
      "@media (hover: none)": 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  tableScroll: {
    maxHeight: 380,
    overflow: "auto",
    marginTop: 10,
    marginInline: -8,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12.5,
    fontVariantNumeric: "tabular-nums",
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    paddingBlock: 0,
    paddingInline: 0,
    backgroundColor: "var(--chart-surface)",
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 500,
    textAlign: "start",
    whiteSpace: "nowrap",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  sortButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    width: "100%",
    paddingBlock: 7,
    paddingInline: 8,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: "inherit", ":hover": tokens.text },
    font: "inherit",
    cursor: "pointer",
  },
  sortEnd: { justifyContent: "flex-end" },
  tr: {
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  td: {
    paddingBlock: 7,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in srgb, ${tokens.text} 6%, transparent)`,
    whiteSpace: "nowrap",
    maxWidth: 240,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  numeric: { textAlign: "end" },
  wide: { width: "100%", maxWidth: 0 },
  backdrop: { zIndex: 110 },
  popup: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    zIndex: 111,
    display: "flex",
    flexDirection: "column",
    width: "min(760px, calc(100vw - 32px))",
    maxHeight: "calc(100vh - 64px)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: tokens.shadow,
    outline: "none",
    overflow: "hidden",
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  dialogHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBlock: 8,
    paddingLeft: 18,
    paddingRight: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  dialogTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
  dialogBody: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
    padding: 18,
    overflowY: "auto",
    fontSize: 13,
  },
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    columnGap: 18,
    rowGap: 8,
    margin: 0,
  },
  fact: { color: tokens.muted },
  factValue: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  mono: { fontFamily: tokens.code, fontSize: 12 },
  link: { color: tokens.text, textDecorationColor: tokens.line },
  heading: { margin: 0, marginBottom: 8, color: tokens.muted, fontSize: 12, fontWeight: 500 },
  pre: {
    margin: 0,
    padding: 12,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.text} 4%, transparent)`,
    fontFamily: tokens.code,
    fontSize: 12,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  output: { maxHeight: 320, overflowY: "auto" },
});
