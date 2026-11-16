import { useEffect, useMemo, useRef, useState } from "react";
import type { GrafanaPanel } from "../../../shared/charts";
import { grafanaTime } from "../../../shared/grafana-time";
import { createDefaultBrowseApi } from "../../data/browse";
import { HttpError } from "../../data/api";
import { grafanaPanel, keptPanel } from "../../data/charts";
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
// has its format). A Grafana panel or a file loads once the chart nears the
// view; a live panel reads Grafana again each minute while it shows.

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

const message = (reason: unknown) =>
  reason instanceof Error ? reason.message : "The data could not load.";

/** The Grafana request for a block, in one key order, so the page's copy matches. */
function panelInput(block: Block, at: number | undefined) {
  if (block.source.kind !== "grafana") return undefined;
  const { link, from, to, live } = block.source;
  return {
    link,
    ...(at !== undefined ? { at } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(live ? { live } : {}),
  };
}

/** The range a Grafana block asks for, to lay out the axis before its data. */
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
  // A Grafana chart reads again when Settings' Grafanas change, so one that
  // waited for its Grafana draws once the reader connects it.
  const sites = JSON.stringify(useSettingsFile()?.settings["grafana.sites"] ?? null);
  const [loaded, setLoaded] = useState<Loaded>(() => {
    if ("error" in block) return { state: "error", error: block.error };
    if (block.source.kind === "rows")
      return { state: "ready", data: rowsData(block.source.text, block), at: Date.now() };
    const kept = input && keptPanel(input);
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
    const work: Promise<Loaded> =
      source.kind === "grafana"
        ? grafanaPanel({ ...input!, ...(round.count ? { refresh: true } : {}) }, abort.signal).then(
            (panel) => ({
              state: "ready",
              data: { kind: "line", series: panel.series },
              panel,
              at: panel.fetched,
            }),
          )
        : !repo
          ? Promise.resolve({
              state: "error",
              error: "Med reads a chart's file from a checkout, and this text has none.",
            })
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
  }, [block, near, round, repo, JSON.stringify(input), input && sites]);

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
          {...(block.source.kind === "file" ? { source: `From ${block.source.path}` } : {})}
        />
      );
    const series = data?.kind === "line" ? data.series : undefined;
    const unit = block.unit ?? panel?.unit;
    const grafana = block.source.kind === "grafana";
    const range =
      panel?.range ?? (grafana ? askedRange(block, at) : series ? dataRange(series) : undefined);
    let host = "";
    if (grafana)
      try {
        host = new URL((block.source as { link: string }).link).host;
      } catch {
        /* The server says why. */
      }
    const source: ChartSource | undefined =
      grafana && range
        ? {
            kind: "grafana",
            label: panel ? [panel.dashboard, panel.title].filter(Boolean).join(" › ") : host,
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
        label: panel.threshold.label || formatValue(panel.threshold.value, unit),
      });
    const title = block.title ?? panel?.title ?? (grafana ? "Grafana panel" : "Chart");
    const subtitle =
      block.subtitle ??
      (block.title && panel ? [panel.title, unit].filter(Boolean).join(", ") : undefined);
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
        {...(block.source.kind !== "rows" ? { onRefresh: refresh } : {})}
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
