import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { UsageReport, UsageRow } from "../../shared/usage-report";
import { useDocumentTitle } from "../data/document-title";
import { useAgentPresets } from "../data/owned-session";
import { USAGE_PATH, useUsageReport } from "../data/usage-report";
import { tokens, ui } from "../theme.stylex";
import { PageHeading, page } from "./PageHeading";
import { modelName, PriceNote } from "./session/ThreadUsage";

// What every session on this Mac spent in a range of days (docs/usage/usage.md):
// the total, each day's spend by agent, the tokens by kind, and the spend by
// agent and by model.

type Preset = "today" | "week" | "month" | "last-month";
type RangeKey = Preset | "custom";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "custom", label: "Custom" },
];

const pad = (value: number) => String(value).padStart(2, "0");
const dayOf = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateOf = (day: string) => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date);
};
const isDay = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && dayOf(dateOf(value)) === value;

function presetRange(key: Preset, now = new Date()) {
  const [year, month, date] = [now.getFullYear(), now.getMonth(), now.getDate()];
  const today = dayOf(now);
  if (key === "today") return { from: today, to: today };
  if (key === "week") return { from: dayOf(new Date(year, month, date - 6)), to: today };
  if (key === "month") return { from: dayOf(new Date(year, month, 1)), to: today };
  return { from: dayOf(new Date(year, month - 1, 1)), to: dayOf(new Date(year, month, 0)) };
}

/** The range that the address names: ?range=…, or ?from=…&to=… for one of the reader's. */
function readRange(): { key: RangeKey; from: string; to: string } {
  const params = new URLSearchParams(location.search);
  const from = params.get("from");
  const to = params.get("to");
  if (isDay(from) && isDay(to))
    return from <= to ? { key: "custom", from, to } : { key: "custom", from: to, to: from };
  const named = RANGES.find((range) => range.key !== "custom" && range.key === params.get("range"));
  const key = (named?.key ?? "month") as Preset;
  return { key, ...presetRange(key) };
}

function writeRange({ key, from, to }: { key: RangeKey; from: string; to: string }) {
  const search =
    key === "custom" ? `?from=${from}&to=${to}` : key === "month" ? "" : `?range=${key}`;
  history.replaceState(null, "", `${USAGE_PATH}${search}`);
}

/** Each agent keeps its color wherever it shows (validated for both appearances). */
const AGENTS: Record<string, { name: string; color: string }> = {
  claude: { name: "Claude Code", color: "light-dark(#eb6834, #d95926)" },
  codex: { name: "Codex", color: "light-dark(#2a78d6, #3987e5)" },
  agy: { name: "Antigravity", color: "light-dark(#1baf7a, #199e70)" },
  pi: { name: "Pi", color: "light-dark(#6250d6, #9085e9)" },
};
/** Any other ACP agent that Med ran. */
const OTHER_COLOR = "light-dark(#e87ba4, #d55181)";
const ORDER = Object.keys(AGENTS);
const colorOf = (agent: string) => AGENTS[agent]?.color ?? OTHER_COLOR;
const rank = (agent: string) => (ORDER.includes(agent) ? ORDER.indexOf(agent) : ORDER.length);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
});
const whole = new Intl.NumberFormat("en-US");
const money = (value: number) => (value > 0 && value < 0.01 ? "<$0.01" : usd.format(value));

interface Sum {
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  unpriced: number;
  agentPriced: number;
}
const zero = (): Sum => ({
  requests: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  unpriced: 0,
  agentPriced: 0,
});
function add(sum: Sum, row: Sum) {
  sum.requests += row.requests;
  sum.input += row.input;
  sum.output += row.output;
  sum.cacheRead += row.cacheRead;
  sum.cacheWrite += row.cacheWrite;
  sum.cost += row.cost;
  sum.unpriced += row.unpriced;
  sum.agentPriced += row.agentPriced;
}
const tokensIn = (sum: Sum) => sum.input + sum.output + sum.cacheRead + sum.cacheWrite;
/** The share of prompt tokens that a cache served. */
const fromCache = (sum: Sum) => {
  const prompt = sum.input + sum.cacheRead + sum.cacheWrite;
  return prompt ? sum.cacheRead / prompt : 0;
};

interface Bucket {
  label: string;
  /** The day or month in full, for the tooltip. */
  title: string;
  total: number;
  agents: Map<string, number>;
}

/** The range's days, or its months past three months of days. */
function bucketsOf(report: UsageReport): Bucket[] {
  const start = dateOf(report.from);
  const end = dateOf(report.to);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const byMonth = days > 92;
  const keyOf = (day: string) => (byMonth ? day.slice(0, 7) : day);
  const buckets = new Map<string, Bucket>();
  const short = new Intl.DateTimeFormat(
    undefined,
    byMonth ? { month: "short" } : { day: "numeric", month: "short" },
  );
  const long = new Intl.DateTimeFormat(
    undefined,
    byMonth
      ? { month: "long", year: "numeric" }
      : { weekday: "short", day: "numeric", month: "long" },
  );
  for (
    let date = new Date(start);
    date <= end;
    date = byMonth
      ? new Date(date.getFullYear(), date.getMonth() + 1, 1)
      : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
  ) {
    const key = keyOf(dayOf(date));
    if (!buckets.has(key))
      buckets.set(key, {
        label: short.format(date),
        title: long.format(date),
        total: 0,
        agents: new Map(),
      });
  }
  for (const row of report.rows) {
    const bucket = buckets.get(keyOf(row.day));
    if (!bucket) continue;
    bucket.total += row.cost;
    bucket.agents.set(row.agent, (bucket.agents.get(row.agent) ?? 0) + row.cost);
  }
  return [...buckets.values()];
}

/** A round step for up to four gridlines over `max`. */
function stepOf(max: number) {
  if (max <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(max / 4));
  return ([1, 2, 2.5, 5, 10].map((factor) => factor * power).find((step) => max / step <= 4) ??
    10 * power) as number;
}

/** Every session's spend on this Mac, over a range of days. */
export function UsagePage({ fetcher }: { fetcher?: typeof fetch }) {
  useDocumentTitle("Usage", 3);
  const [range, setRange] = useState(readRange);
  const { report, stale, error } = useUsageReport(range.from, range.to, fetcher);
  const presets = useAgentPresets(true, fetcher);
  const nameOf = (agent: string) =>
    AGENTS[agent]?.name ?? presets?.find((preset) => preset.id === agent)?.name ?? agent;
  const choose = (next: { key: RangeKey; from: string; to: string }) => {
    setRange(next);
    writeRange(next);
  };

  const shown = useMemo(() => {
    if (!report) return null;
    const total = zero();
    const agents = new Map<string, Sum>();
    const models = new Map<string, Sum & { agents: Set<string> }>();
    for (const row of report.rows) {
      add(total, row);
      const agent = agents.get(row.agent) ?? zero();
      add(agent, row);
      agents.set(row.agent, agent);
      const model = models.get(row.model) ?? { ...zero(), agents: new Set<string>() };
      add(model, row);
      model.agents.add(row.agent);
      models.set(row.model, model);
    }
    return {
      total,
      agents: [...agents].sort(([a, x], [b, y]) => y.cost - x.cost || rank(a) - rank(b)),
      models: [...models].sort(([, x], [, y]) => y.cost - x.cost || y.requests - x.requests),
      buckets: bucketsOf(report),
      unpriced: report.rows.filter((row: UsageRow) => row.unpriced > 0),
      theirs: report.rows.filter((row: UsageRow) => row.agentPriced > 0),
    };
  }, [report]);

  const period = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatRange(dateOf(range.from), dateOf(range.to));

  return (
    <div {...stylex.props(styles.page)}>
      <main aria-label="Usage" {...stylex.props(styles.scroller)}>
        <div {...stylex.props(page.column)}>
          <PageHeading title="Usage" />
          <div {...stylex.props(styles.controls)}>
            <div role="group" aria-label="Range" {...stylex.props(styles.ranges)}>
              {RANGES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={option.key === range.key}
                  onClick={() =>
                    choose(
                      option.key === "custom"
                        ? { key: "custom", from: range.from, to: range.to }
                        : { key: option.key, ...presetRange(option.key) },
                    )
                  }
                  {...stylex.props(
                    ui.button,
                    styles.range,
                    option.key === range.key && styles.rangeOn,
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {range.key === "custom" && (
              <div {...stylex.props(styles.dates)}>
                <input
                  type="date"
                  aria-label="From"
                  value={range.from}
                  max={range.to}
                  onChange={(event) =>
                    isDay(event.target.value) &&
                    choose({ key: "custom", from: event.target.value, to: range.to })
                  }
                  {...stylex.props(ui.input, styles.date)}
                />
                <span {...stylex.props(styles.to)}>to</span>
                <input
                  type="date"
                  aria-label="To"
                  value={range.to}
                  min={range.from}
                  onChange={(event) =>
                    isDay(event.target.value) &&
                    choose({ key: "custom", from: range.from, to: event.target.value })
                  }
                  {...stylex.props(ui.input, styles.date)}
                />
              </div>
            )}
          </div>

          {error && (
            <p role="alert" {...stylex.props(styles.error)}>
              {error}
            </p>
          )}

          <section
            aria-label="Spend"
            aria-busy={stale || undefined}
            {...stylex.props(styles.body, stale && styles.stale)}
          >
            <p {...stylex.props(styles.period)}>{period}</p>
            {!shown ? (
              <p {...stylex.props(styles.reading, ui.delayed)}>Reading the transcripts…</p>
            ) : (
              <>
                <p {...stylex.props(styles.hero)}>{money(shown.total.cost)}</p>
                <p {...stylex.props(styles.summary)}>
                  <span>
                    {whole.format(shown.total.requests)}{" "}
                    {shown.total.requests === 1 ? "request" : "requests"}
                  </span>
                  <span>{compact.format(tokensIn(shown.total))} tokens</span>
                  {shown.total.requests > 0 && (
                    <span>{Math.round(fromCache(shown.total) * 100)}% of prompts from cache</span>
                  )}
                </p>

                {shown.buckets.length > 1 && shown.total.requests > 0 && (
                  <SpendChart buckets={shown.buckets} nameOf={nameOf} />
                )}

                {shown.total.requests === 0 ? (
                  <p {...stylex.props(styles.empty)}>No sessions in this range.</p>
                ) : (
                  <>
                    <div {...stylex.props(styles.tiles)}>
                      {(
                        [
                          ["Input", shown.total.input],
                          ["Cache write", shown.total.cacheWrite],
                          ["Cache read", shown.total.cacheRead],
                          ["Output", shown.total.output],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} {...stylex.props(styles.tile)}>
                          <span {...stylex.props(styles.tileLabel)}>{label}</span>
                          <span title={whole.format(value)} {...stylex.props(styles.tileValue)}>
                            {compact.format(value)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <section aria-labelledby="usage-agents" {...stylex.props(page.section)}>
                      <h2 id="usage-agents" {...stylex.props(page.sectionTitle)}>
                        Agents
                      </h2>
                      <SpendTable
                        label="Agent"
                        total={shown.total.cost}
                        rows={shown.agents.map(([agent, sum]) => ({
                          key: agent,
                          name: nameOf(agent),
                          colors: [colorOf(agent)],
                          sum,
                        }))}
                      />
                    </section>

                    <section aria-labelledby="usage-models" {...stylex.props(page.section)}>
                      <h2 id="usage-models" {...stylex.props(page.sectionTitle)}>
                        Models
                      </h2>
                      <SpendTable
                        label="Model"
                        total={shown.total.cost}
                        rows={shown.models.map(([model, sum]) => {
                          const agents = [...sum.agents].sort((a, b) => rank(a) - rank(b));
                          return {
                            key: model,
                            name: modelName(model),
                            // Which agents ran it, where more than one ran.
                            ...(shown.agents.length > 1
                              ? { detail: agents.map(nameOf).join(", ") }
                              : {}),
                            colors: agents.map(colorOf),
                            sum,
                          };
                        })}
                      />
                    </section>
                  </>
                )}

                <footer {...stylex.props(styles.notes)}>
                  {shown.theirs.length > 0 && (
                    <p {...stylex.props(styles.note)}>
                      {[
                        ...new Set(
                          shown.theirs.map(
                            (row) => `${nameOf(row.agent)}'s own price for ${modelName(row.model)}`,
                          ),
                        ),
                      ].join("; ")}
                      .
                    </p>
                  )}
                  {shown.unpriced.length > 0 && (
                    <p {...stylex.props(styles.note)}>
                      No price for{" "}
                      {[...new Set(shown.unpriced.map((row) => modelName(row.model)))].join(", ")}:
                      its tokens count, its cost does not.
                    </p>
                  )}
                  {report && <PriceNote prices={report.prices} />}
                  <p {...stylex.props(styles.note)}>
                    Claude Code, Codex, and Pi sessions on this Mac, and the Antigravity sessions
                    that Med ran.
                  </p>
                </footer>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

/** Each day's spend, stacked by agent, with each day's split on hover or focus. */
function SpendChart({ buckets, nameOf }: { buckets: Bucket[]; nameOf(agent: string): string }) {
  const [active, setActive] = useState<number | null>(null);
  const agents = [...new Set(buckets.flatMap((bucket) => [...bucket.agents.keys()]))].sort(
    (a, b) => rank(a) - rank(b),
  );
  const step = stepOf(Math.max(...buckets.map((bucket) => bucket.total)));
  const top =
    step * Math.max(1, Math.ceil(Math.max(...buckets.map((bucket) => bucket.total)) / step));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
  // About six labels along the axis.
  const every = buckets.length <= 14 ? 1 : Math.ceil(buckets.length / 6);
  const shown = active === null ? null : buckets[active];
  const share = (value: number) => `${(value / top) * 100}%`;
  return (
    <figure aria-label="Spend by day and agent" {...stylex.props(styles.chart)}>
      <div {...stylex.props(styles.plot)}>
        <div aria-hidden="true" {...stylex.props(styles.grid)}>
          {ticks.map((tick) => (
            <div key={tick} {...stylex.props(styles.gridLine, set.bottom(share(tick)))}>
              <span {...stylex.props(styles.tick)}>
                {tick === 0 ? "$0" : usdWhole.format(tick)}
              </span>
            </div>
          ))}
        </div>
        <div
          {...stylex.props(styles.columns, set.columns(buckets.length))}
          onPointerLeave={() => setActive(null)}
        >
          {buckets.map((bucket, index) => (
            <button
              key={bucket.title}
              type="button"
              aria-label={`${bucket.title}: ${money(bucket.total)}`}
              onPointerEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              {...stylex.props(styles.column)}
            >
              <span
                {...stylex.props(
                  styles.stack,
                  set.height(share(bucket.total)),
                  active === index && styles.stackOn,
                )}
              >
                {agents
                  // A part under a pixel tall draws nothing; the tooltip has it.
                  .filter((agent) => ((bucket.agents.get(agent) ?? 0) / top) * PLOT > 1)
                  .reverse()
                  .map((agent) => (
                    <span
                      key={agent}
                      {...stylex.props(
                        styles.segment,
                        set.part(bucket.agents.get(agent) ?? 0, agentColor(agent)),
                      )}
                    />
                  ))}
              </span>
            </button>
          ))}
        </div>
        {shown && active !== null && (
          <div
            role="status"
            {...stylex.props(
              styles.tooltip,
              // Beside the column, on the side with room, at the plot's top.
              active < buckets.length / 2
                ? set.left(`calc(${((active + 1) / buckets.length) * 100}% + 6px)`)
                : set.right(`calc(${((buckets.length - active) / buckets.length) * 100}% + 6px)`),
            )}
          >
            <span {...stylex.props(styles.tooltipTitle)}>{shown.title}</span>
            <span {...stylex.props(styles.tooltipTotal)}>{money(shown.total)}</span>
            {agents.length > 1 &&
              agents
                .filter((agent) => (shown.agents.get(agent) ?? 0) > 0)
                .map((agent) => (
                  <span key={agent} {...stylex.props(styles.tooltipRow)}>
                    <span
                      aria-hidden="true"
                      {...stylex.props(styles.lineKey, set.fill(agentColor(agent)))}
                    />
                    <span {...stylex.props(styles.tooltipValue)}>
                      {money(shown.agents.get(agent) ?? 0)}
                    </span>
                    <span {...stylex.props(styles.tooltipName)}>{nameOf(agent)}</span>
                  </span>
                ))}
          </div>
        )}
      </div>
      <div aria-hidden="true" {...stylex.props(styles.labels)}>
        {buckets.map((bucket, index) => (
          <span key={bucket.title} {...stylex.props(styles.label)}>
            {index % every === 0 ? bucket.label : ""}
          </span>
        ))}
      </div>
      {agents.length > 1 && (
        <figcaption {...stylex.props(styles.legend)}>
          {agents.map((agent) => (
            <span key={agent} {...stylex.props(styles.legendItem)}>
              <span
                aria-hidden="true"
                {...stylex.props(styles.swatch, set.fill(agentColor(agent)))}
              />
              {nameOf(agent)}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

const agentColor = colorOf;
/** The plot's height in pixels. */
const PLOT = 172;

/** Spend and tokens by agent or by model, largest first. */
function SpendTable({
  label,
  total,
  rows,
}: {
  label: string;
  total: number;
  rows: { key: string; name: string; detail?: string; colors: string[]; sum: Sum }[];
}) {
  return (
    <div {...stylex.props(styles.tableScroll)}>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(styles.th, styles.nameCell)}>
              {label}
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number, styles.wide)}>
              Requests
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number, styles.wide)}>
              Input
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number, styles.wide)}>
              Output
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number, styles.wide)}>
              Cache read
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number, styles.wide)}>
              Cache write
            </th>
            <th scope="col" {...stylex.props(styles.th, styles.number)}>
              Spend
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, name, detail, colors, sum }) => (
            <tr key={key} {...stylex.props(styles.row)}>
              <th scope="row" {...stylex.props(styles.td, styles.nameCell)}>
                <span {...stylex.props(styles.name)}>
                  <span aria-hidden="true" {...stylex.props(styles.dots)}>
                    {colors.map((color, index) => (
                      <span key={index} {...stylex.props(styles.dot, set.fill(color))} />
                    ))}
                  </span>
                  <span {...stylex.props(styles.nameText)}>{name}</span>
                  {detail && <span {...stylex.props(styles.detail)}>{detail}</span>}
                </span>
                <span aria-hidden="true" {...stylex.props(styles.shareTrack)}>
                  <span
                    {...stylex.props(
                      styles.share,
                      set.share(`${total > 0 ? (sum.cost / total) * 100 : 0}%`, colors[0] ?? ""),
                    )}
                  />
                </span>
              </th>
              <td {...stylex.props(styles.td, styles.number, styles.wide)}>
                {whole.format(sum.requests)}
              </td>
              <td
                title={whole.format(sum.input)}
                {...stylex.props(styles.td, styles.number, styles.wide)}
              >
                {compact.format(sum.input)}
              </td>
              <td
                title={whole.format(sum.output)}
                {...stylex.props(styles.td, styles.number, styles.wide)}
              >
                {compact.format(sum.output)}
              </td>
              <td
                title={whole.format(sum.cacheRead)}
                {...stylex.props(styles.td, styles.number, styles.wide)}
              >
                {compact.format(sum.cacheRead)}
              </td>
              <td
                title={whole.format(sum.cacheWrite)}
                {...stylex.props(styles.td, styles.number, styles.wide)}
              >
                {compact.format(sum.cacheWrite)}
              </td>
              <td {...stylex.props(styles.td, styles.number, styles.spend)}>
                {sum.unpriced === sum.requests ? "—" : money(sum.cost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NARROW = "@media (max-width: 640px)";

/** The chart's and the tables' sizes and colors from the numbers. */
const set = stylex.create({
  bottom: (at: string) => ({ bottom: at }),
  height: (height: string) => ({ height }),
  columns: (count: number) => ({ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }),
  part: (grow: number, color: string) => ({ flexGrow: grow, backgroundColor: color }),
  left: (at: string) => ({ left: at }),
  right: (at: string) => ({ right: at }),
  fill: (color: string) => ({ backgroundColor: color }),
  share: (width: string, color: string) => ({ width, backgroundColor: color }),
});

const styles = stylex.create({
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    WebkitFontSmoothing: "antialiased",
  },
  scroller: { flex: "1", minWidth: 0, overflowY: "auto" },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 18,
  },
  ranges: {
    display: "flex",
    padding: 2,
    gap: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    maxWidth: "100%",
    overflowX: "auto",
  },
  range: {
    height: 26,
    minHeight: 26,
    paddingInline: { default: 11, [NARROW]: 8 },
    borderRadius: `calc(6px * ${tokens.round})`,
    fontSize: 13,
    whiteSpace: "nowrap",
    color: { default: tokens.muted, ":hover": tokens.text },
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  rangeOn: {
    color: { default: tokens.selectedText, ":hover": tokens.selectedText },
    backgroundColor: { default: tokens.segment, ":hover": tokens.segment },
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001f`,
  },
  dates: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 },
  tableScroll: { overflowX: "auto", maxWidth: "100%" },
  date: { height: 30, width: 150, fontVariantNumeric: "tabular-nums" },
  to: { color: tokens.faint, fontSize: 13 },
  error: { margin: 0, marginTop: 16, color: tokens.red, fontSize: 13, lineHeight: 1.5 },
  body: {
    marginTop: 36,
    transitionProperty: "opacity",
    transitionDuration: { default: "160ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionDelay: "0ms",
  },
  stale: { opacity: 0.55, transitionDelay: "250ms" },
  period: { margin: 0, color: tokens.muted, fontSize: 13 },
  reading: { margin: 0, marginTop: 10, color: tokens.faint, fontSize: 15 },
  hero: {
    margin: 0,
    marginTop: 6,
    fontSize: { default: 52, [NARROW]: 42 },
    lineHeight: 1.05,
    fontWeight: 550,
    letterSpacing: "-0.035em",
  },
  summary: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: 18,
    rowGap: 4,
    margin: 0,
    marginTop: 12,
    color: tokens.muted,
    fontSize: 13.5,
    fontVariantNumeric: "tabular-nums",
  },
  empty: { margin: 0, marginTop: 40, color: tokens.faint, fontSize: 14 },

  chart: { margin: 0, marginTop: 36 },
  plot: { position: "relative", height: PLOT, marginLeft: 44 },
  grid: { position: "absolute", inset: 0, pointerEvents: "none" },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 0,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  tick: {
    position: "absolute",
    right: "100%",
    marginRight: 10,
    transform: "translateY(-50%)",
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  columns: { position: "absolute", inset: 0, display: "grid", columnGap: 2 },
  column: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    cursor: "default",
    outline: "none",
    borderRadius: 4,
    boxShadow: { default: "none", ":focus-visible": `0 0 0 2px ${tokens.accentLine}` },
  },
  stack: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "min(24px, 100%)",
    minHeight: 0,
    overflow: "hidden",
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    transitionProperty: "filter",
    transitionDuration: "120ms",
  },
  stackOn: { filter: "brightness(1.12) saturate(1.05)" },
  segment: { flexBasis: 0, minHeight: 0 },
  tooltip: {
    position: "absolute",
    top: 0,
    zIndex: 2,
    display: "grid",
    gap: 3,
    minWidth: 150,
    paddingBlock: 9,
    paddingInline: 11,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.menu,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, ${tokens.shadow}`,
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  tooltipTitle: { color: tokens.muted, fontSize: 12 },
  tooltipTotal: { fontSize: 15, fontWeight: 550, fontVariantNumeric: "tabular-nums" },
  tooltipRow: { display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 },
  lineKey: { width: 10, height: 2, borderRadius: 1, flexShrink: 0 },
  tooltipValue: { fontWeight: 500, fontVariantNumeric: "tabular-nums" },
  tooltipName: { color: tokens.muted },
  labels: { display: "flex", gap: 2, marginLeft: 44, marginTop: 8 },
  label: {
    display: "flex",
    justifyContent: "center",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    overflow: "visible",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: 16,
    rowGap: 6,
    marginLeft: 44,
    marginTop: 14,
    color: tokens.muted,
    fontSize: 12.5,
  },
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 2 },

  tiles: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      [NARROW]: "repeat(2, minmax(0, 1fr))",
    },
    gap: 10,
    marginTop: 40,
  },
  tile: {
    display: "grid",
    gap: 4,
    paddingBlock: 12,
    paddingInline: 14,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  tileLabel: { color: tokens.muted, fontSize: 12.5 },
  tileValue: { fontSize: 20, fontWeight: 550, letterSpacing: "-0.015em" },

  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    paddingBottom: 8,
    color: tokens.faint,
    fontSize: 12,
    fontWeight: 400,
    textAlign: "left",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  row: {},
  td: {
    paddingBlock: 10,
    verticalAlign: "top",
    fontWeight: 400,
    textAlign: "left",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  nameCell: { width: "34%", paddingRight: 12 },
  number: {
    paddingLeft: 10,
    textAlign: "right",
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  wide: { display: { default: "table-cell", [NARROW]: "none" } },
  spend: { color: tokens.text, fontWeight: 500 },
  name: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  dots: { display: "inline-flex", flexShrink: 0 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    marginLeft: { default: -2, ":first-child": 0 },
    boxShadow: `0 0 0 2px ${tokens.canvas}`,
  },
  nameText: { color: tokens.text, fontWeight: 500, whiteSpace: "nowrap" },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
  },
  shareTrack: {
    display: "block",
    height: 2,
    marginTop: 7,
    marginLeft: 16,
    borderRadius: 1,
    backgroundColor: tokens.fill,
    overflow: "hidden",
  },
  share: { display: "block", height: "100%", borderRadius: 1, opacity: 0.85 },

  notes: { display: "grid", gap: 6, marginTop: 40 },
  note: { margin: 0, color: tokens.faint, fontSize: 12.5, lineHeight: 1.55 },
});
