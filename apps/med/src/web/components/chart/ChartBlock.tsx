import { useEffect, useMemo, useRef, useState } from "react";
import { chartSourceFor, type GrafanaPanel, type LinkChart } from "../../../shared/charts";
import { grafanaTime } from "../../../shared/grafana-time";
import { createDefaultBrowseApi } from "../../data/browse";
import { HttpError } from "../../data/api";
import { grafanaPanel, keptLink, keptPanel, linkChart } from "../../data/charts";
import { useSettingsFile } from "../../data/settings-file";
import { openSettings } from "../settings/settings-commands";
import { useFileRefs } from "../FileRefs";
import { BarList } from "./BarList";
import {
  isRamp,
  markTimes,
  parseChartBlock,
  rowsData,
  thresholdOf,
  type ChartBlock as Block,
  type ChartData,
} from "./chart-block";
import { LineChart, type ChartSource } from "./Chart";
import { formatValue, type Series } from "./chart-model";

// A `chart` block in a reply, a brief, or a Markdown file (chart-block.ts
// has its format). A Grafana panel, a chart source's link, or a file loads
// once the chart nears the view; a live one reads again each minute while
// it shows. A Grafana link that a chart source in Settings covers is that
// source's, as a sign-in that no token passes needs.

type Loaded =
  | { state: "loading" }
  | { state: "error"; error: string; code?: string }
  | { state: "ready"; data: ChartData; panel?: GrafanaPanel; at: number };

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

/** The request for a block's link, in one key order, so the page's copy matches. */
function panelInput(block: Block, at: number | undefined) {
  if (block.source.kind !== "grafana" && block.source.kind !== "link") return undefined;
  const { link, from, to, live } = block.source;
  return {
    link,
    ...(at !== undefined ? { at } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(live ? { live } : {}),
  };
}

/** The range a link's block asks for, to lay out the axis before its data. */
function askedRange(block: Block, at: number | undefined): readonly [number, number] | undefined {
  if (block.source.kind !== "grafana" && block.source.kind !== "link") return undefined;
  if (block.source.kind === "link" && !block.source.from && !block.source.to) return undefined;
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
    range: read.range ?? [...dataRange(series)],
    live: read.live,
    fetched: read.fetched,
    link: chart?.link ?? link,
    notes: chart?.notes ?? [],
  };
  return { state: "ready", data, panel, at: read.fetched };
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
  const input = "error" in block ? undefined : panelInput(block, at);
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
  const [loaded, setLoaded] = useState<Loaded>(() => {
    if ("error" in block) return { state: "error", error: block.error };
    if (block.source.kind === "rows")
      return { state: "ready", data: rowsData(block.source.text, block), at: Date.now() };
    const read = viaSource && input && keptLink(input);
    if (read) return linkLoaded(read, block, input.link);
    const kept = !viaSource && input && keptPanel(input);
    return kept
      ? {
          state: "ready",
          data: { kind: "line", series: kept.series },
          panel: kept,
          at: kept.fetched,
        }
      : { state: "loading" };
  });
  // Each Fetch again, and each minute of a live chart on screen.
  const [round, setRound] = useState<{ count: number; quiet: boolean }>({ count: 0, quiet: false });

  useEffect(() => {
    if ("error" in block || block.source.kind === "rows" || !near) return;
    if (round.count === 0 && loaded.state === "ready") return;
    const abort = new AbortController();
    if (!round.quiet) setLoaded({ state: "loading" });
    const source = block.source;
    const refreshed = round.count ? { refresh: true } : {};
    const work: Promise<Loaded> =
      viaSource && input
        ? linkChart({ ...input, ...refreshed }, abort.signal).then((read) =>
            linkLoaded(read, block, input.link),
          )
        : source.kind === "grafana"
          ? grafanaPanel(
              { ...input!, ...(round.count ? { refresh: true } : {}) },
              abort.signal,
            ).then((panel) => ({
              state: "ready",
              data: { kind: "line", series: panel.series },
              panel,
              at: panel.fetched,
            }))
          : !repo
            ? Promise.resolve({
                state: "error",
                error: "Med reads a chart's file from a checkout, and this text has none.",
              })
            : source.kind !== "file"
              ? Promise.resolve<Loaded>({ state: "error", error: "This chart has no data." })
              : createDefaultBrowseApi()
                  .read({ kind: "worktree", repo }, filePath(source.path), abort.signal)
                  .then((file) =>
                    file.kind === "text" && file.text !== undefined
                      ? { state: "ready", data: rowsData(file.text, block), at: Date.now() }
                      : {
                          state: "error",
                          error:
                            file.kind === "missing"
                              ? `There is no ${source.path} in the checkout.`
                              : (file.reason ?? `Med cannot read ${source.path} as text.`),
                        },
                  );
    work.then(
      (next) => {
        if (!abort.signal.aborted) setLoaded(next);
      },
      (reason: unknown) => {
        if (!abort.signal.aborted && !round.quiet)
          setLoaded({
            state: "error",
            error: message(reason),
            ...(reason instanceof HttpError && reason.code ? { code: reason.code } : {}),
          });
      },
    );
    return () => abort.abort();
    // `loaded` only decides whether a kept panel needs no first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, near, round, repo, JSON.stringify(input), input && sites, input && sourcesKey]);

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
  const content = () => {
    if ("error" in block)
      return <LineChart spec={{ title: "Chart" }} state="error" error={block.error} />;
    const panel = loaded.state === "ready" ? loaded.panel : undefined;
    const data = loaded.state === "ready" ? loaded.data : undefined;
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
    const source: ChartSource | undefined =
      linked && range
        ? {
            kind: grafana ? "grafana" : "link",
            label:
              panel && grafana ? [panel.dashboard, panel.title].filter(Boolean).join(" › ") : host,
            url: panel?.link ?? (block.source as { link: string }).link,
            range,
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
    const subtitle =
      block.subtitle ??
      (block.title && panel?.title ? [panel.title, unit].filter(Boolean).join(", ") : undefined);
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
        {...(loaded.state === "error" && loaded.code === "grafana-not-set"
          ? { fix: { label: "Connect Grafana", run: () => openSettings("grafana") } }
          : {})}
      />
    );
  };
  return (
    <div ref={frame} className="med-md-block" data-chart-block="">
      {content()}
    </div>
  );
}
