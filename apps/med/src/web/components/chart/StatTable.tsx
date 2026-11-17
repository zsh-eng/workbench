import { Dialog } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
import { useId, useMemo, useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";
import { formatValue } from "./chart-model";
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
  loading,
  extra,
  onRefresh,
  onInspect,
}: {
  footer?: PanelFooter;
  loading: boolean;
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
        {[extra, loading ? "Fetching…" : when].filter(Boolean).map((part, index) => (
          <span key={part}>
            {(footer?.label || index > 0) && <span aria-hidden="true"> · </span>}
            {part}
          </span>
        ))}
      </span>
      <span {...stylex.props(styles.grow)} />
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
    </footer>
  );
}

/** A small line under the number: its shape over the range, no axes. */
function Sparkline({ points }: { points: readonly (number | null)[] }) {
  const values = points.filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 200;
  const height = 40;
  let path = "";
  let pen = false;
  points.forEach((value, index) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = (index / (points.length - 1)) * width;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    path += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  const area = `${path}L${width},${height}L0,${height}Z`;
  const id = `spark-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      {...stylex.props(styles.spark)}
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
    </svg>
  );
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
}: {
  title: string;
  unit?: string;
  stat?: Stat;
  state: "loading" | "ready" | "error";
  error?: string;
  footer?: PanelFooter;
  onRefresh?(): void;
  onInspect?(): void;
}) {
  return (
    <figure data-stat-panel="" {...stylex.props(styles.frame)}>
      <figcaption {...stylex.props(styles.title)}>{title}</figcaption>
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
            {stat && stat.value !== null ? formatValue(stat.value, unit) : "–"}
          </span>
          {stat?.change !== null && stat?.change !== undefined && (
            <span {...stylex.props(styles.change)}>
              {stat.change >= 0 ? "↗" : "↘"}{" "}
              {Math.abs(stat.change * 100).toFixed(Math.abs(stat.change) < 0.1 ? 1 : 0)}%
            </span>
          )}
        </div>
      )}
      {stat && state === "ready" && <Sparkline points={stat.points} />}
      <Footer
        footer={footer}
        loading={state === "loading"}
        {...(stat?.label &&
        stat.label !== unit &&
        !title.toLowerCase().includes(stat.label.toLowerCase())
          ? { extra: stat.label }
          : {})}
        {...(onRefresh ? { onRefresh } : {})}
        {...(onInspect ? { onInspect } : {})}
      />
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
}: {
  title: string;
  table?: Table;
  state: "loading" | "ready" | "error";
  error?: string;
  footer?: PanelFooter;
  onRefresh?(): void;
  onInspect?(): void;
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
  return (
    <figure data-table-panel="" {...stylex.props(styles.frame)}>
      <figcaption {...stylex.props(styles.title)}>{title}</figcaption>
      {state === "error" ? (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      ) : !table ? (
        <p {...stylex.props(styles.waitingNote)}>Fetching…</p>
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
                    {...stylex.props(styles.th, table.numeric[index] && styles.numeric)}
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
                        {...stylex.props(styles.td, table.numeric[index] && styles.numeric)}
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
      <Footer
        footer={footer}
        loading={state === "loading"}
        {...(table
          ? { extra: `${table.rows.length} row${table.rows.length === 1 ? "" : "s"}` }
          : {})}
        {...(onRefresh ? { onRefresh } : {})}
        {...(onInspect ? { onInspect } : {})}
      />
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
  },
  title: {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "-0.005em",
    color: tokens.text,
  },
  statRow: { display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 },
  statValue: {
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1.1,
  },
  waiting: { color: tokens.faint },
  change: { color: tokens.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" },
  spark: {
    display: "block",
    width: "100%",
    height: 40,
    marginTop: 10,
    color: tokens.accent,
    overflow: "visible",
  },
  error: { margin: 0, marginTop: 10, color: tokens.muted, lineHeight: 1.45 },
  waitingNote: { margin: 0, marginTop: 10, color: tokens.faint },
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
    backgroundColor: surface,
    color: tokens.muted,
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
  },
  numeric: { textAlign: "end" },
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
