import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  chartSourceFor,
  metaVariable,
  type GrafanaPanel,
  type LinkChart,
} from "../../../shared/charts";
import { grafanaTime } from "../../../shared/grafana-time";
import { createDefaultBrowseApi } from "../../data/browse";
import { HttpError } from "../../data/api";
import { grafanaPanel, keptLink, keptPanel, linkChart } from "../../data/charts";
import { useSettingsFile } from "../../data/settings-file";
import { openSettings } from "../settings/settings-commands";
import { useFileRefs } from "../FileRefs";
import { tokens } from "../../theme.stylex";
import { BarList } from "./BarList";
import { OnBoard } from "./chart-board";
import {
  isRamp,
  markTimes,
  grafanaRequest,
  linkRequest,
  parseChartBlock,
  rowsData,
  thresholdOf,
  type ChartBlock as Block,
  type ChartData,
} from "./chart-block";
import { LineChart, type ChartSource } from "./Chart";
import { statOf, tableFromData, tableOf } from "./chart-summary";
import {
  InspectDialog,
  StatPanel,
  TablePanel,
  type Inspection,
  type PanelFooter,
} from "./StatTable";
import { formatValue, type Series } from "./chart-model";

// A `chart` block in a reply, a brief, or a Markdown file (chart-block.ts
// has its format). A Grafana panel, a chart source's link, or a file loads
// once the chart nears the view; a live one reads again each minute while
// it shows. A Grafana link that a chart source in Settings covers is that
// source's, as a sign-in that no token passes needs.
//
// A chart whose text changes, as a dashboard's panel does when an input
// does, keeps what it drew, dimmed under a thin bar, until the new data
// comes: the page does not go blank, and keeps its place. Until a chart has
// drawn once, it holds its height and says whether it waits its turn (a page
// reads four at a time) or fetches, and for how long.

/** On a dashboard, a drag across a chart's time picks the dashboard's range. */
export const ChartZoom = createContext<((from: number, to: number) => void) | null>(null);

/** What a read gave, before the block draws it: the block's own keys (its
 * columns, its highlight) shape it at each render. */
type Read =
  | { kind: "error"; error: string; code?: string }
  | { kind: "link"; read: LinkChart; link: string }
  | { kind: "grafana"; panel: GrafanaPanel }
  | { kind: "file"; rows: string; at: number };

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: string; code?: string }
  | {
      state: "ready";
      data: ChartData;
      panel?: GrafanaPanel;
      at: number;
      /** The rows as they came, for a table. */
      rows?: string;
      /** What a chart source printed, for Inspect. */
      read?: LinkChart;
    };

const LIVE_EVERY = 60_000;

/** True once `element` comes within a screen of the view. */
function useNear(element: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [element, near]);
  return near;
}

/** Whether `element` is on screen now. */
function useShown(element: React.RefObject<HTMLElement | null>) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setShown(!!entry?.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [element]);
  return shown;
}

/** Where a chart's data comes from, in a word: a link's host, a file's
 * path. A dashboard names its panels' sources once, at its top. */
export function chartSourceName(text: string): string | undefined {
  const block = parseChartBlock(text);
  if ("error" in block) return undefined;
  if (block.source.kind === "grafana" || block.source.kind === "link")
    return hostOf(block.source.link);
  return block.source.kind === "file" ? block.source.path : undefined;
}

/** A link's host, for the chart to name where its data came from. */
function hostOf(link: string) {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "The data could not load.";

/** The range a Grafana link asks for, to lay out the axis before its data. */
function askedRange(block: Block, at: number | undefined): readonly [number, number] | undefined {
  if (block.source.kind !== "grafana") return undefined;
  let url: URL;
  try {
    url = new URL(block.source.link);
  } catch {
    return undefined;
  }
  const base = block.source.live ? Date.now() : Math.min(at ?? Date.now(), Date.now());
  const from = grafanaTime(block.source.from ?? url.searchParams.get("from") ?? "now-6h", base);
  const to = grafanaTime(block.source.to ?? url.searchParams.get("to") ?? "now", base, true);
  return from !== null && to !== null && to > from ? [from, to] : undefined;
}

function dataRange(series: readonly Series[]): readonly [number, number] {
  const times = series.flatMap(({ points }) => points.map(([time]) => time));
  return times.length ? [Math.min(...times), Math.max(...times)] : [0, 1];
}

/** What a chart source read, as the chart draws it: rows as a file's, or the
 * chart it printed, with its title, unit, marks, and threshold as a
 * panel's. */
function linkLoaded(read: LinkChart, block: Block, link: string): Loaded {
  const chart = read.chart;
  const data: ChartData =
    read.rows !== undefined
      ? rowsData(read.rows, block)
      : chart?.bars && !chart.series
        ? {
            kind: "bars",
            bars: chart.bars.map((bar) =>
              bar.label === block.highlight ? { ...bar, highlight: true } : bar,
            ),
          }
        : { kind: "line", series: chart?.series ?? [] };
  const series = data.kind === "line" ? data.series : [];
  const panel: GrafanaPanel = {
    title: chart?.title ?? "",
    dashboard: "",
    ...(chart?.unit ? { unit: chart.unit } : {}),
    ...(chart?.scale ? { scale: chart.scale } : {}),
    ...(chart?.threshold
      ? { threshold: { value: chart.threshold.value, label: chart.threshold.label ?? "" } }
      : {}),
    marks: chart?.marks ?? [],
    series: series.map(({ name, points }) => ({
      name,
      points: points.map(([time, value]): [number, number | null] => [time, value]),
    })),
    range: chart?.range ?? [...dataRange(series)],
    live: read.live,
    fetched: read.fetched,
    link: chart?.link ?? link,
    notes: chart?.notes ?? [],
  };
  return {
    state: "ready",
    data,
    panel,
    at: read.fetched,
    ...(read.rows !== undefined ? { rows: read.rows } : {}),
    read,
  };
}

/** A path inside `folder`, with its `..` and `.` steps taken. */
function within(folder: string, path: string) {
  const parts: string[] = [];
  for (const part of `${folder}/${path}`.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}

export function ChartBlock({
  text,
  at,
  files,
}: {
  text: string;
  /** When the reply was written: a range relative to now counts from here. */
  at?: number;
  /** For a Markdown file: its checkout, and its folder, where a file's path starts. */
  files?: { repo: string; folder: string };
}) {
  const block = useMemo(() => parseChartBlock(text), [text]);
  const frame = useRef<HTMLDivElement>(null);
  const near = useNear(frame);
  const shown = useShown(frame);
  // In a reply, a file's path starts where the agent worked, as its links do.
  const refs = useFileRefs();
  const index = refs?.index;
  const repo = files?.repo ?? index?.root;
  const filePath = (path: string) =>
    files ? within(files.folder, path) : (index?.resolve({ path }, refs?.cwd)?.path ?? path);
  // A Grafana chart reads again when Settings' Grafanas or chart sources
  // change, so one that waited for its Grafana draws once the reader, or an
  // agent, connects it.
  const settings = useSettingsFile()?.settings;
  const sites = JSON.stringify(settings?.["grafana.sites"] ?? null);
  const sourcesSetting = settings?.["charts.sources"];
  const sources =
    sourcesSetting && typeof sourcesSetting === "object" && !Array.isArray(sourcesSetting)
      ? sourcesSetting
      : {};
  const sourcesKey = JSON.stringify(sources);
  const viaSource =
    !("error" in block) &&
    (block.source.kind === "link" ||
      (block.source.kind === "grafana" && !!chartSourceFor(sources, block.source.link)));
  const input =
    "error" in block
      ? undefined
      : viaSource
        ? linkRequest(block.source, at)
        : grafanaRequest(block.source, at);
  // What the chart reads: a new key is new data, read afresh; until it comes,
  // the last read shows.
  const readKey =
    "error" in block || block.source.kind === "rows"
      ? ""
      : JSON.stringify(
          input ??
            (block.source.kind === "file" ? { file: filePath(block.source.path), repo } : {}),
        );
  /** A read that this page made before, without asking the server. */
  const keptRead = (): Read | undefined => {
    if ("error" in block || !input) return undefined;
    if (viaSource) {
      const read = keptLink(input);
      return read && { kind: "link", read, link: input.link };
    }
    const panel = keptPanel(input);
    return panel && { kind: "grafana", panel };
  };
  const [reads, setReads] = useState<{ key: string; read: Read } | null>(() => {
    const kept = keptRead();
    return kept ? { key: readKey, read: kept } : null;
  });
  // A key that this page read before draws at once.
  if (reads?.key !== readKey && readKey) {
    const kept = keptRead();
    if (kept) setReads({ key: readKey, read: kept });
  }
  const current = reads?.key === readKey ? reads.read : undefined;
  // The last chart's data, while the new one comes; never its error.
  const previous =
    reads && reads.key !== readKey && reads.read.kind !== "error" ? reads.read : undefined;
  const loaded = useMemo<Loaded>(() => {
    if ("error" in block) return { state: "error", error: block.error };
    if (block.source.kind === "rows")
      return {
        state: "ready",
        data: rowsData(block.source.text, block),
        at: Date.now(),
        rows: block.source.text,
      };
    const read = current ?? previous;
    if (!read) return { state: "loading" };
    if (read.kind === "error")
      return { state: "error", error: read.error, ...(read.code ? { code: read.code } : {}) };
    if (read.kind === "link") return linkLoaded(read.read, block, read.link);
    if (read.kind === "grafana")
      return {
        state: "ready",
        data: { kind: "line", series: read.panel.series },
        panel: read.panel,
        at: read.panel.fetched,
      };
    return { state: "ready", data: rowsData(read.rows, block), at: read.at, rows: read.rows };
  }, [block, current, previous]);
  // Each Fetch again, and each minute of a live chart on screen.
  const [round, setRound] = useState<{ count: number; quiet: boolean }>({ count: 0, quiet: false });
  // A read on its way: when it asked, and whether its turn has come.
  const [busy, setBusy] = useState<{ since: number; started: boolean } | null>(null);

  useEffect(() => {
    if ("error" in block || block.source.kind === "rows" || !near) return;
    if (round.count === 0 && reads?.key === readKey && reads.read.kind !== "error") return;
    const abort = new AbortController();
    const key = readKey;
    if (!round.quiet) setBusy({ since: Date.now(), started: false });
    const started = () => setBusy((last) => last && { ...last, started: true });
    const source = block.source;
    const refreshed = round.count ? { refresh: true } : {};
    const work: Promise<Read> =
      viaSource && input
        ? linkChart({ ...input, ...refreshed }, abort.signal, started).then((read) => ({
            kind: "link",
            read,
            link: input.link,
          }))
        : source.kind === "grafana"
          ? grafanaPanel({ ...input!, ...refreshed }, abort.signal, started).then((panel) => ({
              kind: "grafana",
              panel,
            }))
          : !repo
            ? Promise.resolve({
                kind: "error",
                error: "Med reads a chart's file from a checkout, and this text has none.",
              })
            : source.kind !== "file"
              ? Promise.resolve<Read>({ kind: "error", error: "This chart has no data." })
              : (started(),
                createDefaultBrowseApi()
                  .read({ kind: "worktree", repo }, filePath(source.path), abort.signal)
                  .then((file): Read =>
                    file.kind === "text" && file.text !== undefined
                      ? { kind: "file", rows: file.text, at: Date.now() }
                      : {
                          kind: "error",
                          error:
                            file.kind === "missing"
                              ? `There is no ${source.path} in the checkout.`
                              : (file.reason ?? `Med cannot read ${source.path} as text.`),
                        },
                  ));
    work.then(
      (read) => {
        if (abort.signal.aborted) return;
        setReads({ key, read });
        setBusy(null);
      },
      (reason: unknown) => {
        if (abort.signal.aborted) return;
        // A live chart's quiet read keeps what it drew.
        if (!round.quiet)
          setReads({
            key,
            read: {
              kind: "error",
              error: message(reason),
              ...(reason instanceof HttpError && reason.code ? { code: reason.code } : {}),
            },
          });
        setBusy(null);
      },
    );
    return () => {
      abort.abort();
      setBusy(null);
    };
    // `reads` only decides whether a kept read needs no first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, near, round, repo, readKey, input && sites, input && sourcesKey]);
  // The seconds a read has taken, once it takes a while.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const status = !busy
    ? near
      ? undefined
      : "Waiting"
    : !busy.started
      ? "Waiting"
      : Date.now() - busy.since < 2000
        ? "Fetching…"
        : `Fetching · ${Math.round((Date.now() - busy.since) / 1000)} s`;
  /** It shows data, and reads new data, or shows the last data while the new
   * data waits for the chart to come into view. */
  const refreshing = (!!busy || (!current && !!previous)) && loaded.state === "ready";
  const zoom = useContext(ChartZoom);
  const board = useContext(OnBoard);

  const live = loaded.state === "ready" && loaded.panel?.live;
  useEffect(() => {
    if (!live || !shown) return;
    const timer = setInterval(
      () => setRound((last) => ({ count: last.count + 1, quiet: true })),
      LIVE_EVERY,
    );
    return () => clearInterval(timer);
  }, [live, shown]);

  const refresh = () => setRound((last) => ({ count: last.count + 1, quiet: false }));
  const [inspecting, setInspecting] = useState(false);
  /** Where the data came from, and what its source printed. */
  const inspection = (): Inspection | undefined => {
    if ("error" in block) return undefined;
    const ready = loaded.state === "ready" ? loaded : undefined;
    const title = `Inspect: ${block.title ?? (ready?.panel?.title || "Chart")}`;
    const source = block.source;
    if (source.kind === "rows")
      return { title, from: "Rows written in the chart", env: [], output: source.text };
    if (source.kind === "file")
      return {
        title,
        from: `The file ${source.path}`,
        env: [],
        ...(ready?.rows !== undefined ? { output: ready.rows } : {}),
      };
    if (viaSource && input) {
      const covered = chartSourceFor(sources, source.link);
      const meta = "meta" in input && input.meta ? input.meta : {};
      const read = ready?.read;
      return {
        title,
        link: source.link,
        from: covered
          ? `The chart source for ${covered.base}, in Settings`
          : "No chart source covers this link yet",
        ...(covered ? { command: covered.command } : {}),
        env: [
          ["MED_CHART_LINK", source.link],
          [
            "MED_CHART_AT",
            String(source.live ? (read?.fetched ?? Date.now()) : (at ?? read?.fetched ?? "")),
          ],
          ["MED_CHART_LIVE", source.live ? "1" : ""],
          ...Object.entries(meta).map(([key, value]): [string, string] => [
            metaVariable(key),
            value,
          ]),
        ],
        ...(read ? { fetched: read.fetched } : {}),
        ...(read ? { output: read.rows ?? JSON.stringify(read.chart, null, 2) } : {}),
      };
    }
    const panel = ready?.panel;
    return {
      title,
      link: source.link,
      from: "Grafana, with the token in Settings",
      env: [],
      ...(panel ? { fetched: panel.fetched, output: JSON.stringify(panel.series, null, 2) } : {}),
    };
  };
  const content = () => {
    if ("error" in block)
      return <LineChart spec={{ title: "Chart" }} state="error" error={block.error} />;
    const panel = loaded.state === "ready" ? loaded.panel : undefined;
    const data = loaded.state === "ready" ? loaded.data : undefined;
    if (block.type === "stat" || block.type === "table") {
      const linkedSource = block.source.kind === "grafana" || block.source.kind === "link";
      const footer: PanelFooter = {
        ...(linkedSource
          ? {
              label: hostOf((block.source as { link: string }).link),
              url: panel?.link ?? (block.source as { link: string }).link,
            }
          : block.source.kind === "file"
            ? { label: block.source.path }
            : {}),
        ...(loaded.state === "ready" && block.source.kind !== "rows"
          ? { fetched: panel?.fetched ?? loaded.at }
          : {}),
        ...(panel?.live ? { live: true } : {}),
      };
      const title = block.title ?? (panel?.title || (block.type === "stat" ? "Value" : "Rows"));
      const refreshes =
        block.source.kind !== "rows" &&
        !(loaded.state === "error" && loaded.code === "chart-source-missing");
      const shared = {
        title,
        footer,
        onInspect: () => setInspecting(true),
        ...(refreshes ? { onRefresh: refresh } : {}),
        ...(status ? { status } : {}),
      };
      if (block.type === "stat") {
        const failed =
          loaded.state === "error" ? loaded.error : data?.kind === "error" ? data.error : undefined;
        const unit = block.unit ?? panel?.unit;
        return (
          <StatPanel
            {...shared}
            {...(unit ? { unit } : {})}
            {...(data && !failed ? { stat: statOf(data, block.reduce ?? "last") } : {})}
            state={failed ? "error" : loaded.state === "loading" ? "loading" : "ready"}
            {...(failed ? { error: failed } : {})}
          />
        );
      }
      const table =
        loaded.state === "ready"
          ? loaded.rows !== undefined
            ? tableOf(loaded.rows)
            : tableFromData(loaded.data)
          : undefined;
      const failed =
        loaded.state === "error"
          ? loaded.error
          : table && "error" in table
            ? table.error
            : undefined;
      return (
        <TablePanel
          {...shared}
          {...(table && !("error" in table) ? { table } : {})}
          state={failed ? "error" : loaded.state === "loading" ? "loading" : "ready"}
          {...(failed ? { error: failed } : {})}
        />
      );
    }
    if (data?.kind === "bars")
      return (
        <BarList
          title={block.title ?? "Values"}
          {...(block.subtitle ? { subtitle: block.subtitle } : {})}
          {...(block.unit ? { unit: block.unit } : {})}
          bars={data.bars}
          {...(block.source.kind === "file"
            ? { source: `From ${block.source.path}` }
            : viaSource && block.source.kind !== "rows"
              ? { source: `From ${hostOf(block.source.link)}` }
              : {})}
        />
      );
    const series = data?.kind === "line" ? data.series : undefined;
    const unit = block.unit ?? panel?.unit;
    const grafana = block.source.kind === "grafana" && !viaSource;
    const linked = block.source.kind === "grafana" || block.source.kind === "link";
    const range =
      panel?.range ??
      (linked
        ? (askedRange(block, at) ?? (series ? dataRange(series) : undefined))
        : series
          ? dataRange(series)
          : undefined);
    const host = linked ? hostOf((block.source as { link: string }).link) : "";
    // A linked chart names its host even before it has read, or when it fails.
    const source: ChartSource | undefined = linked
      ? {
          kind: grafana ? "grafana" : "link",
          label:
            panel && grafana ? [panel.dashboard, panel.title].filter(Boolean).join(" › ") : host,
          url: panel?.link ?? (block.source as { link: string }).link,
          ...(range ? { range } : {}),
          ...(panel?.live ? { live: true } : {}),
          ...(panel ? { fetched: panel.fetched } : {}),
        }
      : block.source.kind === "file" && range
        ? { kind: "file", label: block.source.path, range }
        : undefined;
    const marks = [...markTimes(block.marks, range ?? [0, 1]), ...(panel?.marks ?? [])];
    const threshold =
      thresholdOf(block, unit) ??
      (panel?.threshold && {
        value: panel.threshold.value,
        label: [panel.threshold.label, formatValue(panel.threshold.value, unit)]
          .filter(Boolean)
          .join(" "),
      });
    const title = block.title ?? (panel?.title || (grafana ? "Grafana panel" : "Chart"));
    // The source's own title under the block's, unless it says the same: the
    // axis and the key already give the unit.
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const subtitle =
      block.subtitle ??
      (block.title && panel?.title && !same(block.title, panel.title)
        ? [panel.title, unit].filter(Boolean).join(", ")
        : undefined);
    // A source added to Settings reads the chart again by itself, so a
    // missing one offers no Try again.
    const refreshes =
      block.source.kind !== "rows" &&
      !(loaded.state === "error" && loaded.code === "chart-source-missing");
    const state = loaded.state === "ready" && data?.kind === "error" ? "error" : loaded.state;
    const error =
      loaded.state === "error" ? loaded.error : data?.kind === "error" ? data.error : undefined;
    return (
      <LineChart
        spec={{
          title,
          ...(subtitle ? { subtitle } : {}),
          ...(unit ? { unit } : {}),
          ...(marks.length ? { marks } : {}),
          ...(threshold ? { threshold } : {}),
          ...(series && isRamp(series) ? { ramp: true } : {}),
          ...((block.scale ?? panel?.scale) ? { scale: block.scale ?? panel!.scale } : {}),
        }}
        {...(series ? { series } : {})}
        state={state}
        {...(error ? { error } : {})}
        {...(source ? { source } : {})}
        {...(panel?.notes.length ? { notice: panel.notes.join(" ") } : {})}
        {...(refreshes ? { onRefresh: refresh } : {})}
        onInspect={() => setInspecting(true)}
        {...(status ? { busy: status } : {})}
        {...(zoom && linked ? { onZoom: zoom } : {})}
        {...(loaded.state === "error" && loaded.code === "grafana-not-set"
          ? { fix: { label: "Connect Grafana", run: () => openSettings("grafana") } }
          : {})}
      />
    );
  };
  return (
    <div
      ref={frame}
      className={["med-md-block", stylex.props(board && styles.fill).className]
        .filter(Boolean)
        .join(" ")}
      data-chart-block=""
      aria-busy={!!busy || undefined}
    >
      <div {...stylex.props(styles.block, board && styles.fill)}>
        <div {...stylex.props(styles.content, board && styles.fill, refreshing && styles.stale)}>
          {content()}
        </div>
        {refreshing && <span aria-hidden="true" data-chart-busy="" {...stylex.props(styles.bar)} />}
      </div>
      {inspecting && inspection() && (
        <InspectDialog inspection={inspection()!} onClose={() => setInspecting(false)} />
      )}
    </div>
  );
}

// The bar slides along the panel's top while it reads; it waits a moment
// first, so a quick read does not flash.
const slide = stylex.keyframes({
  from: { transform: "translateX(-100%)" },
  to: { transform: "translateX(260%)" },
});
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });

const styles = stylex.create({
  block: { position: "relative" },
  // On a dashboard, each wrapper is as tall as the panel's row.
  fill: { height: "100%" },
  content: { transitionProperty: "opacity", transitionDuration: "200ms" },
  stale: { opacity: 0.55, transitionDelay: "250ms" },
  bar: {
    position: "absolute",
    top: 0,
    insetInline: 14,
    height: 2,
    overflow: "hidden",
    borderRadius: 2,
    pointerEvents: "none",
    animationName: appear,
    animationDuration: "200ms",
    animationDelay: "250ms",
    animationFillMode: "both",
    "::after": {
      content: '""',
      position: "absolute",
      insetBlock: 0,
      left: 0,
      width: "38%",
      borderRadius: 2,
      backgroundColor: tokens.accent,
      animationName: slide,
      animationDuration: "1.1s",
      animationTimingFunction: "ease-in-out",
      animationIterationCount: "infinite",
    },
  },
});
