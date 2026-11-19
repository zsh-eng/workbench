// A time chart in a thread: the lines an agent's block names, from Grafana,
// a file, or its own rows. The plot is SVG on the theme's colors, so it copies
// as a picture the way a diagram does. Motion runs only while something
// changes (data arriving, the scale, a zoom) and stops; hover moves a line.
import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { siteIcon } from "../../markdown/site-icons";
import { tokens, ui } from "../../theme.stylex";
import { ActionMenu } from "../Controls";
import { tooltip } from "../ToolButton";
import { CopyNoteText, copyFailure, useCopyNote } from "../DiagramCopy";
import { Icon } from "../Icon";
import { copyChart } from "./chart-copy";
import { OnBoard } from "./chart-board";
import { ChartCursor } from "./chart-cursor";
import {
  areaPath,
  extent,
  formatMoment,
  formatRange,
  formatSpan,
  formatTick,
  formatValue,
  linearDomain,
  linePath,
  logDomain,
  nearestIndex,
  placeLabels,
  seriesCsv,
  timeTicks,
  type LineChartSpec,
  type Series,
} from "./chart-model";

/** Where the data came from, for the footer, Refresh, and Open in Grafana. */
export interface ChartSource {
  kind: "grafana" | "link" | "file" | "agent";
  /** Grafana's host and panel, a chart source's link's host, a file's name,
   * or what the agent ran. */
  label: string;
  url?: string;
  /** None while a file loads. */
  range?: readonly [number, number];
  /** The range ends now: the newest point breathes. */
  live?: boolean;
  /** When Med last fetched it. */
  fetched?: number;
}

export type ChartState = "loading" | "ready" | "error";

const GUTTER = 50;
const TOP = 20;
const BOTTOM = 26;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 4;

/**
 * Numbers that ease to their target over `duration` when it changes, from
 * where they are; nothing runs once they arrive. `jump` sets them at once,
 * and with `settle`, the first target after a jump lands at once too: data
 * that arrives sets the scales, and only its reveal moves.
 */
function useTween<T extends Record<string, number>>(
  target: T,
  duration: number,
  ease: (t: number) => number,
  jump = false,
  settle = false,
): T {
  const [value, setValue] = useState(target);
  const state = useRef({ from: target, to: target, current: target, frame: 0, jumped: jump });
  const key = Object.values(target).join(" ");
  useEffect(() => {
    const tween = state.current;
    const land = jump || (settle && tween.jumped) || reduced();
    tween.jumped = jump;
    if (!jump && Object.keys(target).every((name) => tween.to[name] === target[name])) return;
    cancelAnimationFrame(tween.frame);
    if (land) {
      tween.from = tween.to = tween.current = target;
      setValue(target);
      return;
    }
    tween.from = tween.current;
    tween.to = target;
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = ease(progress);
      const next = { ...tween.to };
      for (const name in next) {
        const from = tween.from[name] ?? tween.to[name]!;
        (next as Record<string, number>)[name] = from + (tween.to[name]! - from) * eased;
      }
      tween.current = next;
      setValue(next);
      if (progress < 1) tween.frame = requestAnimationFrame(step);
    };
    tween.frame = requestAnimationFrame(step);
    // The key holds the target's numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jump]);
  useEffect(() => () => cancelAnimationFrame(state.current.frame), []);
  return value;
}

/** A key's value, its unit fainter than its number: a word repeated on
 * every line reads as noise. */
function Reading({ text }: { text: string }) {
  const space = text.indexOf(" ");
  if (space < 0) return text;
  return (
    <>
      {text.slice(0, space)}
      <span {...stylex.props(styles.keyUnit)}>{text.slice(space + 1)}</span>
    </>
  );
}

/** A series' color: one hue in steps for a ramp, else the theme's own colors. */
function seriesColor(index: number, count: number, ramp?: boolean) {
  if (ramp) {
    // The first is the strongest: a source lists the measure that matters first (p99 before p50).
    const strength = count === 1 ? 100 : Math.round(100 - (55 * index) / (count - 1));
    return `color-mix(in srgb, ${tokens.accent} ${strength}%, transparent)`;
  }
  return [tokens.accent, tokens.warning, tokens.green, tokens.red, tokens.muted][index % 5]!;
}

/** The chart's width, as it lays out. */
function useWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width] as const;
}

export function LineChart({
  spec,
  series,
  state = "ready",
  error,
  source,
  onRefresh,
  height = 240,
  large,
  onClose,
  notice,
  fix,
  onInspect,
  busy,
  onZoom,
}: {
  spec: LineChartSpec;
  series?: readonly Series[];
  state?: ChartState;
  error?: string;
  source?: ChartSource;
  onRefresh?(): void;
  /** Shows where the data came from: the link, the command, what it printed. */
  onInspect?(): void;
  /** The plot's height. */
  height?: number;
  /** In the full-screen dialog: a Close button in place of Full screen. */
  large?: boolean;
  onClose?(): void;
  /** What the chart leaves out of its source, such as a panel's transformations. */
  notice?: string;
  /** In place of Try again, for an error that a step elsewhere fixes. */
  fix?: { label: string; run(): void };
  /** What its read does now, as "Waiting" or "Fetching · 4 s". */
  busy?: string;
  /** A drag across the time picks this range, as a dashboard's: in place of
   * the chart's own zoom. */
  onZoom?(from: number, to: number): void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const clip = `chart-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [measure, width] = useWidth();
  const [scale, setScale] = useState<"linear" | "log">(spec.scale ?? "linear");
  // A scale that arrives with the data, as a Grafana panel's, takes over.
  const [specScale, setSpecScale] = useState(spec.scale);
  if (spec.scale !== specScale) {
    setSpecScale(spec.scale);
    setScale(spec.scale ?? "linear");
  }
  // The lines picked in the key. With none picked, every line shows; a
  // click picks one more line, or drops a picked one.
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [focus, setFocus] = useState<string | null>(null);
  const [zoom, setZoom] = useState<readonly [number, number] | null>(null);
  // On a dashboard the moment under the pointer is the page's, which every
  // chart marks (chart-cursor.tsx); alone, a chart keeps its own.
  const cursor = useContext(ChartCursor);
  const cursorId = useId();
  const [ownHover, setOwnHover] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ from: number; to: number } | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [note, say] = useCopyNote();
  // On a dashboard: outlined on the page, its tools in its header.
  const board = useContext(OnBoard) && !large;
  const data = useMemo(() => (state === "ready" ? (series ?? []) : []), [state, series]);
  const empty = state === "ready" && data.every(({ points }) => points.length === 0);
  const drawn = state === "ready" && !empty;
  const hidden = useMemo(() => {
    const names = data.map(({ name }) => name);
    return new Set(
      names.some((name) => picked.has(name)) ? names.filter((name) => !picked.has(name)) : [],
    );
  }, [data, picked]);
  // The key under the pointer dims the other lines, unless it is hidden itself.
  const lit = focus !== null && !hidden.has(focus) ? focus : null;

  const full = useMemo<readonly [number, number]>(() => {
    if (source?.range) return source.range;
    const times = data.flatMap(({ points }) => [points[0]?.[0], points.at(-1)?.[0]]);
    const known = times.filter((time): time is number => time !== undefined);
    return known.length ? [Math.min(...known), Math.max(...known)] : [0, 1];
  }, [source, data]);
  const [from, to] = zoom ?? full;
  const shared = cursor?.time ?? null;
  // Another chart's moment shows here only within this chart's time.
  const hover = cursor
    ? shared !== null && shared >= from && shared <= to
      ? shared
      : null
    : ownHover;
  const setHover = (time: number | null) =>
    cursor ? cursor.set(time, cursorId) : setOwnHover(time);
  /** The pointer is on this chart, not on another of the page's. */
  const leading = !cursor || cursor.owner === cursorId;
  const visible = data.filter(({ name }) => !hidden.has(name));
  const values = extent(visible.length ? visible : data, from, to);
  const ceiling = Math.max(values.max, spec.threshold?.value ?? -Infinity);
  const linear = linearDomain(values.min, ceiling);
  const log = logDomain(Math.min(values.positive, spec.threshold?.value ?? Infinity), ceiling);

  const view = useTween(
    {
      blend: scale === "log" ? 1 : 0,
      from,
      to,
      linMin: linear.min,
      linMax: linear.max,
      logMin: log.min,
      logMax: log.max,
    },
    480,
    easeInOut,
    !drawn,
    true,
  );
  const reveal = useTween({ shown: drawn ? 1 : 0 }, 900, easeOut, !drawn).shown;

  const right = Math.max(0, width - GUTTER);
  const bottom = height - BOTTOM;
  const plotHeight = bottom - TOP;
  const x = useCallback(
    (time: number) => ((time - view.from) / (view.to - view.from || 1)) * right,
    [view.from, view.to, right],
  );
  const timeAt = (px: number) => view.from + (px / (right || 1)) * (view.to - view.from);
  const flat = TOP + plotHeight * 0.62;
  const y = useCallback(
    (value: number) => {
      const lin = TOP + (1 - (value - view.linMin) / (view.linMax - view.linMin || 1)) * plotHeight;
      const exponent = Math.log10(Math.max(value, 10 ** view.logMin));
      const log =
        TOP + (1 - (exponent - view.logMin) / (view.logMax - view.logMin || 1)) * plotHeight;
      return flat + (lin + (log - lin) * view.blend - flat) * reveal;
    },
    [view, plotHeight, flat, reveal],
  );

  const paths = useMemo(
    () =>
      width > 0 && drawn
        ? data.map(({ points }) => {
            const line = linePath(points, x, y);
            return { line, area: data.length === 1 ? areaPath(line, bottom) : "" };
          })
        : [],
    [data, x, y, width, drawn, bottom],
  );

  // The marks in view, each label where it fits (11 px type, about 6 px a letter).
  const shownMarks = (spec.marks ?? [])
    .map((mark) => ({ mark, mx: x(mark.at) }))
    .filter(({ mx }) => mx >= 0 && mx <= right)
    .sort((a, b) => a.mx - b.mx);
  const sides = placeLabels(
    shownMarks.map(({ mark, mx }) => ({ x: mx, width: mark.label.length * 6 })),
    // The plot clips at its right edge.
    right,
  );
  const marks = shownMarks.map((entry, index) => ({ ...entry, side: sides[index] ?? null }));
  const ticks = width > 0 ? timeTicks(view.from, view.to, right) : { ticks: [], step: 1 };
  const spacing = data[0]?.points[1] ? data[0].points[1][0] - data[0].points[0]![0] : 60_000;
  // The point under the pointer, on the first line that shows.
  const anchor = visible[0] ?? data[0];
  const hoverIndex = hover !== null && anchor ? nearestIndex(anchor.points, hover) : -1;
  const near = hoverIndex >= 0 ? anchor!.points[hoverIndex]![0] : null;
  // Another chart's moment that this one has no point near draws nothing here.
  const hoverTime =
    near !== null && (leading || Math.abs(near - hover!) <= spacing * 2) ? near : null;
  const readout = (points: Series["points"]) => {
    if (!points.length) return null;
    const index =
      hoverTime !== null
        ? nearestIndex(points, hoverTime)
        : nearestIndex(points, Math.min(to, full[1]));
    for (let at = index; at >= 0; at--) if (points[at]![1] !== null) return points[at]![1];
    return null;
  };

  const down = useRef<number | null>(null);
  const plotX = (event: PointerEvent<SVGRectElement>) =>
    Math.min(right, Math.max(0, event.clientX - event.currentTarget.getBoundingClientRect().left));
  const onPointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (!drawn || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    down.current = plotX(event);
  };
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    if (!drawn) return;
    const px = plotX(event);
    setHover(timeAt(px));
    if (down.current !== null && Math.abs(px - down.current) > 3)
      setBrush({ from: Math.min(down.current, px), to: Math.max(down.current, px) });
  };
  const onPointerUp = () => {
    if (brush && brush.to - brush.from > 8) {
      const span = Math.max(timeAt(brush.to) - timeAt(brush.from), spacing * 6);
      if (onZoom) onZoom(timeAt(brush.from), timeAt(brush.from) + span);
      else setZoom([timeAt(brush.from), timeAt(brush.from) + span]);
    }
    down.current = null;
    setBrush(null);
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!drawn || !anchor) return;
    if (event.key === "Escape") {
      if (hover !== null) setHover(null);
      else if (zoom) setZoom(null);
      else return;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const step = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1);
      const start = hoverIndex >= 0 ? hoverIndex : nearestIndex(anchor.points, to);
      const next = Math.min(anchor.points.length - 1, Math.max(0, start + step));
      setHover(anchor.points[next]![0]);
    } else return;
    event.preventDefault();
  };

  const toggle = (name: string) =>
    setPicked((current) => {
      // Only lines the chart still has: a refresh can drop one.
      const next = new Set(
        [...current].filter((line) => data.some((entry) => entry.name === line)),
      );
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const copies = [
    {
      label: "Copy as image",
      letter: "i",
      disabled: !drawn,
      onClick: () =>
        void copyChart(frame.current!).then(
          () => say("Chart copied"),
          (cause: unknown) => say(copyFailure(cause), true),
        ),
    },
    {
      label: "Copy as CSV",
      letter: "c",
      disabled: !drawn,
      onClick: () =>
        void navigator.clipboard.writeText(seriesCsv(visible)).then(
          () => say("CSV copied"),
          (cause: unknown) => say(copyFailure(cause), true),
        ),
    },
    ...(source?.url
      ? [
          {
            label: "Copy link",
            letter: "k",
            disabled: !drawn,
            onClick: () =>
              void navigator.clipboard.writeText(source.url!).then(
                () => say("Link copied"),
                (cause: unknown) => say(copyFailure(cause), true),
              ),
          },
        ]
      : []),
  ];
  // Everything but the data and Full screen waits in one menu.
  const options = [
    [
      {
        label: "Log scale",
        letter: "l",
        checked: scale === "log",
        disabled: !drawn,
        onClick: () => setScale((last) => (last === "log" ? "linear" : "log")),
      },
    ],
    [
      ...(onRefresh
        ? [{ label: "Refresh", letter: "r", disabled: state === "loading", onClick: onRefresh }]
        : []),
      ...(onInspect ? [{ label: "Inspect data", letter: "i", onClick: onInspect }] : []),
      ...(source?.url && (source.kind === "grafana" || source.kind === "link")
        ? [
            {
              label: source.kind === "grafana" ? "Open in Grafana" : "Open link",
              letter: "o",
              onClick: () => void window.open(source.url, "_blank", "noreferrer"),
            },
          ]
        : []),
    ],
    copies,
  ];
  const read =
    source?.fetched !== undefined && state === "ready"
      ? `Read ${source.kind === "grafana" ? "from Grafana " : ""}at ${formatMoment(source.fetched, 60_000)}`
      : undefined;

  // What a screen reader says as the arrows move along the chart.
  const spoken =
    hoverTime === null
      ? "Use the arrow keys to read the values"
      : [
          formatMoment(hoverTime, spacing),
          ...visible.map(({ name, points }) => {
            const value = points[nearestIndex(points, hoverTime)]?.[1];
            return `${name} ${value === null || value === undefined ? "no value" : formatValue(value, spec.unit)}`;
          }),
        ].join(", ");

  const single = data.length === 1 && drawn;
  const single0 = single ? readout(data[0]!.points) : null;
  const first = single
    ? data[0]!.points.find(([time, value]) => time >= from && value !== null)
    : undefined;
  const change = single0 !== null && first?.[1] ? (single0 - first[1]) / first[1] : null;
  const icon =
    source?.kind === "grafana"
      ? siteIcon("https://grafana.com/")
      : source?.kind === "link" && source.url
        ? siteIcon(source.url)
        : undefined;
  const linearOpacity = 1 - view.blend;
  const status = busy ?? (state === "loading" ? "Fetching…" : undefined);
  const tools = (
    <div {...stylex.props(styles.tools, board && styles.toolsBoard)}>
      <span {...stylex.props(styles.noteSpot)}>
        <CopyNoteText note={note} />
      </span>
      {/* On a dashboard the page names the range; a chart zoomed on its own says its own. */}
      {board && status && (
        <span data-chart-status="" {...stylex.props(styles.fetching, styles.headStatus)}>
          {status}
        </span>
      )}
      {board && zoom && <span {...stylex.props(styles.headStatus)}>{formatRange(...zoom)}</span>}
      {zoom && (
        <button
          type="button"
          onClick={() => setZoom(null)}
          {...stylex.props(ui.button, styles.tool, styles.textTool)}
        >
          Reset zoom
        </button>
      )}
      {!large && (
        // As on a Mermaid diagram: Full screen sits beside the menu.
        <button
          type="button"
          aria-label="Show the chart full screen"
          {...tooltip("Full screen")}
          onClick={() => setFullScreen(true)}
          {...stylex.props(ui.button, ui.iconButton, styles.tool, styles.more)}
        >
          <Icon name="focus" size={14} />
        </button>
      )}
      <ActionMenu
        label="Chart options"
        sections={options}
        {...(read ? { note: read } : {})}
        trigger={[ui.button, ui.iconButton, styles.tool, styles.more]}
        layer={large ? "dialog" : undefined}
      >
        <Icon name="more" size={15} />
      </ActionMenu>
      {large && (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          {...stylex.props(ui.button, ui.iconButton, styles.tool)}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );

  return (
    <div
      ref={frame}
      data-chart=""
      {...stylex.props(
        styles.frame,
        large && styles.frameLarge,
        board && styles.frameBoard,
        stylex.defaultMarker(),
      )}
    >
      <header {...stylex.props(styles.header)}>
        <div {...stylex.props(styles.heading)}>
          <h3 data-chart-title="" {...stylex.props(styles.title)}>
            {spec.title}
          </h3>
          {spec.subtitle && (
            <p data-chart-subtitle="" {...stylex.props(styles.subtitle)}>
              {spec.subtitle}
            </p>
          )}
        </div>
        {single && (
          <div {...stylex.props(styles.big)}>
            <span {...stylex.props(styles.bigValue)}>
              {single0 === null ? "–" : formatValue(single0, spec.unit)}
            </span>
            {/* Neutral: whether up is good depends on what is measured. */}
            {change !== null && source?.live && hoverTime === null && (
              <span {...stylex.props(styles.change)}>
                {change >= 0 ? "↗" : "↘"}{" "}
                {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
              </span>
            )}
          </div>
        )}
        {board && tools}
      </header>

      <div {...stylex.props(styles.keys, board && styles.keysBoard)}>
        {(state === "loading" || state === "error"
          ? (series ?? []).map(({ name }) => ({ name, points: [] as Series["points"] }))
          : data
        ).map((entry, index, all) => {
          const value = readout(entry.points);
          const off = hidden.has(entry.name);
          return (
            <button
              key={entry.name}
              type="button"
              data-chart-key=""
              data-hidden={off ? "" : undefined}
              aria-pressed={picked.has(entry.name)}
              aria-label={`${entry.name}${off ? ", hidden" : ""}`}
              disabled={!drawn}
              onClick={() => toggle(entry.name)}
              onPointerEnter={() => setFocus(entry.name)}
              onPointerLeave={() => setFocus(null)}
              {...stylex.props(
                styles.key,
                styles.paint(seriesColor(index, all.length, spec.ramp)),
                off && styles.keyOff,
                lit !== null && lit !== entry.name && styles.keyDim,
              )}
            >
              <span {...stylex.props(styles.swatch)} />
              <span data-key-name="" {...stylex.props(styles.keyName)}>
                {entry.name}
              </span>
              {!single && (
                <span
                  data-key-value=""
                  {...stylex.props(styles.keyValue, !drawn && styles.pending)}
                >
                  {value === null ? "–" : <Reading text={formatValue(value, spec.unit)} />}
                </span>
              )}
            </button>
          );
        })}
        {drawn && hoverTime === null && (
          <span {...stylex.props(styles.moment)}>
            {source?.live && !zoom ? "Now" : formatMoment(Math.min(to, full[1]), 60_000)}
          </span>
        )}
      </div>

      <div ref={measure} {...stylex.props(styles.plot, styles.height(height))}>
        {width > 0 && (
          <svg
            data-chart-plot=""
            width={width}
            height={height}
            role="slider"
            aria-roledescription="chart"
            aria-label={[spec.title, spec.subtitle].filter(Boolean).join(". ")}
            aria-valuemin={0}
            aria-valuemax={Math.max(0, (anchor?.points.length ?? 1) - 1)}
            aria-valuenow={Math.max(0, hoverIndex)}
            aria-valuetext={spoken}
            aria-disabled={!drawn}
            tabIndex={drawn ? 0 : -1}
            onKeyDown={onKeyDown}
            onBlur={() => setHover(null)}
            {...stylex.props(styles.svg)}
          >
            <defs>
              <clipPath id={clip}>
                <rect x={-2} y={0} width={right + 4} height={bottom + 1} />
              </clipPath>
            </defs>
            {/* Value grid and labels: the linear set fades as the log set comes. */}
            {drawn &&
              [
                { domain: linear, opacity: linearOpacity * reveal },
                { domain: log, opacity: view.blend * reveal },
              ].map(({ domain, opacity }, set) =>
                opacity < 0.01
                  ? null
                  : domain.ticks.map((tick) => {
                      const ty = y(tick);
                      if (ty < TOP - 6 || ty > bottom + 0.5) return null;
                      const major = set === 0 || Number.isInteger(Math.log10(tick));
                      return (
                        <g key={`${set}-${tick}`} opacity={opacity}>
                          {ty < bottom - 0.5 && (
                            <line
                              x1={0}
                              x2={right}
                              y1={ty}
                              y2={ty}
                              {...stylex.props(styles.grid, !major && styles.gridMinor)}
                            />
                          )}
                          <text
                            x={width}
                            y={ty}
                            textAnchor="end"
                            dominantBaseline="middle"
                            {...stylex.props(styles.axis, !major && styles.axisMinor)}
                          >
                            {formatValue(tick, spec.unit, true)}
                          </text>
                        </g>
                      );
                    }),
              )}
            <line x1={0} x2={right} y1={bottom} y2={bottom} {...stylex.props(styles.base)} />
            {ticks.ticks.map((tick) => {
              const tx = x(tick);
              if (tx < 18 || tx > right - 18) return null;
              return (
                <text
                  key={tick}
                  x={tx}
                  y={height - 6}
                  textAnchor="middle"
                  opacity={hoverTime !== null && Math.abs(x(hoverTime) - tx) < 44 ? 0 : 1}
                  {...stylex.props(styles.axis, styles.timeLabel)}
                >
                  {formatTick(tick, ticks.step)}
                </text>
              );
            })}

            <g clipPath={`url(#${clip})`}>
              {spec.threshold && drawn && (
                <g opacity={reveal}>
                  <line
                    x1={0}
                    x2={right}
                    y1={y(spec.threshold.value)}
                    y2={y(spec.threshold.value)}
                    {...stylex.props(styles.threshold)}
                  />
                  <text
                    x={right - 4}
                    y={y(spec.threshold.value) - 5}
                    textAnchor="end"
                    {...stylex.props(styles.thresholdLabel)}
                  >
                    {spec.threshold.label}
                  </text>
                </g>
              )}
              {marks.map(({ mark, mx, side }) => (
                <g key={mark.at}>
                  <line x1={mx} x2={mx} y1={TOP - 6} y2={bottom} {...stylex.props(styles.mark)}>
                    {!side && <title>{mark.label}</title>}
                  </line>
                  {side && (
                    <text
                      x={side === "start" ? mx + 5 : mx - 5}
                      y={TOP - 8}
                      textAnchor={side}
                      {...stylex.props(styles.markLabel)}
                    >
                      {mark.label}
                    </text>
                  )}
                </g>
              ))}

              {state === "loading" && (
                <path d={breath(right, flat)} {...stylex.props(styles.breath)} />
              )}

              {paths.map(({ line, area }, index) => {
                const name = data[index]!.name;
                const color = seriesColor(index, data.length, spec.ramp);
                const opacity = hidden.has(name) ? 0 : lit !== null && lit !== name ? 0.18 : 1;
                return (
                  <g
                    key={name}
                    {...stylex.props(styles.series, styles.paint(color), styles.fade(opacity))}
                  >
                    {area && <path d={area} {...stylex.props(styles.area)} />}
                    <path d={line} {...stylex.props(styles.line)} />
                  </g>
                );
              })}
              {drawn &&
                hoverTime === null &&
                data.map(({ name, points }, index) => {
                  const end = lastPoint(points, Math.min(to, full[1]));
                  if (!end || hidden.has(name)) return null;
                  const ex = x(end[0]);
                  if (ex < 0 || ex > right + 1) return null;
                  return (
                    <g
                      key={name}
                      {...stylex.props(
                        styles.series,
                        styles.paint(seriesColor(index, data.length, spec.ramp)),
                        styles.fade(lit !== null && lit !== name ? 0.18 : reveal),
                      )}
                    >
                      {source?.live && !zoom && (
                        <circle cx={ex} cy={y(end[1])} r={7} {...stylex.props(styles.halo)} />
                      )}
                      <circle cx={ex} cy={y(end[1])} r={3} {...stylex.props(styles.dot)} />
                    </g>
                  );
                })}
            </g>

            {brush && (
              <rect
                x={brush.from}
                y={TOP - 6}
                width={brush.to - brush.from}
                height={bottom - TOP + 6}
                {...stylex.props(styles.brush)}
              />
            )}
            {hoverTime !== null && (
              <g>
                <line
                  x1={x(hoverTime)}
                  x2={x(hoverTime)}
                  y1={TOP - 6}
                  y2={bottom}
                  data-chart-crosshair={leading ? "lead" : "follow"}
                  {...stylex.props(styles.crosshair, !leading && styles.crosshairFollow)}
                />
                {visible.map(({ name, points }) => {
                  const index = nearestIndex(points, hoverTime);
                  const value = points[index]?.[1];
                  if (value === null || value === undefined) return null;
                  return (
                    <circle
                      key={name}
                      cx={x(points[index]![0])}
                      cy={y(value)}
                      r={3.5}
                      {...stylex.props(
                        styles.hoverDot,
                        styles.paint(
                          seriesColor(
                            data.findIndex((entry) => entry.name === name),
                            data.length,
                            spec.ramp,
                          ),
                        ),
                      )}
                    />
                  );
                })}
                <TimePill x={x(hoverTime)} y={height - 6} right={right}>
                  {formatMoment(hoverTime, spacing)}
                </TimePill>
              </g>
            )}
            <rect
              x={0}
              y={0}
              width={right}
              height={bottom}
              fill="transparent"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => {
                if (!brush) setHover(null);
              }}
              onDoubleClick={() => setZoom(null)}
              {...stylex.props(drawn && styles.surface)}
            />
          </svg>
        )}
        {empty && <p {...stylex.props(styles.message)}>No data in this range</p>}
        {state === "error" && (
          <div role="alert" {...stylex.props(styles.message)}>
            <span {...stylex.props(styles.failure)}>
              <Icon name="alert" size={14} />
              {error ?? "The data could not load."}
            </span>
            {(fix ?? onRefresh) && (
              <button
                type="button"
                onClick={fix ? fix.run : onRefresh}
                {...stylex.props(ui.button, ui.outlined, styles.retry)}
              >
                {fix ? fix.label : "Try again"}
              </button>
            )}
          </div>
        )}
      </div>

      {notice && state === "ready" && (
        <p role="note" {...stylex.props(styles.notice)}>
          {notice}
        </p>
      )}
      {!board && (
        <footer {...stylex.props(styles.footer)}>
          <span data-chart-source="" {...stylex.props(styles.source)}>
            {icon && (
              <img src={icon.src} alt="" width={12} height={12} {...stylex.props(styles.icon)} />
            )}
            {source ? (
              <>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.props(styles.sourceLink)}
                  >
                    {source.label}
                  </a>
                ) : (
                  <span {...stylex.props(styles.sourceName)}>{source.label}</span>
                )}
                {source.range && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span {...stylex.props(styles.range)}>
                      {source.live && !zoom
                        ? formatSpan(source.range[1] - source.range[0])
                        : formatRange(...(zoom ?? source.range))}
                    </span>
                  </>
                )}
                {status && (
                  <span data-chart-status="" {...stylex.props(styles.fetching)}>
                    · {status}
                  </span>
                )}
              </>
            ) : (
              <span>From the agent</span>
            )}
          </span>
          <span {...stylex.props(styles.grow)} />
          {tools}
        </footer>
      )}
      {fullScreen && (
        <ChartDialog
          spec={{ ...spec, scale }}
          series={series}
          state={state}
          error={error}
          source={source}
          onRefresh={onRefresh}
          notice={notice}
          onClose={() => setFullScreen(false)}
        />
      )}
    </div>
  );
}

/** The newest point at or before `time`. */
function lastPoint(points: Series["points"], time: number) {
  for (let index = nearestIndex(points, time); index >= 0; index--) {
    const point = points[index]!;
    if (point[0] <= time + 1 && point[1] !== null) return point as readonly [number, number];
  }
  return undefined;
}

/** The waiting line: a slow, low swell across the plot. */
function breath(width: number, level: number) {
  let path = "";
  for (let px = 0; px <= width; px += 6)
    path += `${px ? "L" : "M"}${px},${(level + Math.sin(px / 46) * 3 + Math.sin(px / 17) * 1.2).toFixed(1)}`;
  return path;
}

function TimePill({
  x,
  y,
  right,
  children,
}: {
  x: number;
  y: number;
  right: number;
  children: string;
}) {
  const width = children.length * 6.6 + 14;
  const left = Math.min(Math.max(0, x - width / 2), right - width);
  return (
    <g>
      <rect x={left} y={y - 13} width={width} height={18} rx={5} {...stylex.props(styles.pill)} />
      <text
        x={left + width / 2}
        y={y}
        textAnchor="middle"
        {...stylex.props(styles.axis, styles.pillText)}
      >
        {children}
      </text>
    </g>
  );
}

/** The chart over the page, as tall as the window lets it be. */
function ChartDialog({
  onClose,
  ...chart
}: {
  spec: LineChartSpec;
  series?: readonly Series[];
  state: ChartState;
  error?: string;
  source?: ChartSource;
  onRefresh?(): void;
  notice?: string;
  onClose(): void;
}) {
  const [room, setRoom] = useState(0);
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop)} />
        <Dialog.Popup
          ref={(element: HTMLDivElement | null) => {
            if (element) setRoom(element.clientHeight);
          }}
          {...stylex.props(styles.popup)}
        >
          <Dialog.Title {...stylex.props(styles.hiddenTitle)}>{chart.spec.title}</Dialog.Title>
          {room > 0 && (
            <LineChart {...chart} large onClose={onClose} height={Math.max(240, room - 190)} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const surface = `var(--med-md-surface, color-mix(in srgb, ${tokens.text} 4%, ${tokens.canvas}))`;
const breathe = stylex.keyframes({
  "0%, 100%": { opacity: 0.25 },
  "50%": { opacity: 0.7 },
});
const ripple = stylex.keyframes({
  "0%": { transform: "scale(0.45)", opacity: 0.55 },
  "70%, 100%": { transform: "scale(1.35)", opacity: 0 },
});
const motion = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  frame: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 0,
    paddingTop: 20,
    paddingInline: 20,
    paddingBottom: 12,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: surface,
    color: tokens.text,
    fontFamily: tokens.ui,
    // Its own type, also inside a Markdown page's prose.
    fontSize: 13,
    lineHeight: "normal",
    overflowWrap: "normal",
    // What a dot's ring and a pill cut out of: the frame's own fill.
    "--chart-surface": surface,
  },
  // On a dashboard: a hairline on the page, as tall as its row, no fill.
  frameBoard: {
    height: "100%",
    boxSizing: "border-box",
    paddingTop: 14,
    paddingInline: 16,
    paddingBottom: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: "transparent",
    "--chart-surface": tokens.canvas,
  },
  frameLarge: {
    height: "100%",
    boxSizing: "border-box",
    borderRadius: 0,
    backgroundColor: tokens.canvas,
  },
  header: { display: "flex", alignItems: "flex-start", gap: 16 },
  heading: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "1" },
  title: {
    margin: 0,
    fontSize: 13,
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "-0.005em",
    color: tokens.text,
    textWrap: "balance",
  },
  subtitle: { margin: 0, fontSize: 12, lineHeight: 1.4, color: tokens.muted },
  big: { display: "flex", alignItems: "baseline", gap: 8, flexShrink: 0 },
  bigValue: {
    fontSize: 22,
    fontWeight: 600,
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
    color: tokens.text,
  },
  change: {
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  },
  keys: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 14,
    rowGap: 2,
    marginTop: 14,
    marginInline: -6,
    minHeight: 24,
  },
  key: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 24,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fill },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: { default: "pointer", ":disabled": "default" },
    transitionProperty: "opacity",
    transitionDuration: "160ms",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  keyOff: { opacity: 0.4 },
  keyDim: { opacity: 0.55 },
  swatch: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "var(--series)",
    flexShrink: 0,
  },
  keyName: { color: tokens.muted },
  keyValue: {
    minWidth: 40,
    color: tokens.text,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    textAlign: "left",
  },
  keyUnit: { marginLeft: 3, color: tokens.faint, fontWeight: 400 },
  pending: { color: tokens.faint },
  // At the row's end; when the key wraps, at the end of its last row.
  moment: {
    marginLeft: "auto",
    paddingInline: 6,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  grow: { flex: "1" },
  plot: { position: "relative", marginTop: 10, marginInline: -2 },
  svg: { display: "block", overflow: "visible", outline: "none", touchAction: "pan-y" },
  surface: { cursor: "crosshair" },
  grid: {
    stroke: tokens.lineStrong,
    strokeWidth: 1,
    strokeDasharray: "1 4",
    strokeLinecap: "round",
  },
  gridMinor: { stroke: tokens.line },
  base: { stroke: tokens.lineStrong, strokeWidth: 1 },
  // Small tabular figures in the page's face, as Linear's axes have.
  axis: {
    fill: tokens.faint,
    fontFamily: tokens.ui,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  axisMinor: { opacity: 0.6 },
  timeLabel: { transitionProperty: "opacity", transitionDuration: "120ms" },
  series: { transitionProperty: "opacity", transitionDuration: "200ms" },
  line: {
    fill: "none",
    stroke: "var(--series)",
    strokeWidth: 1.6,
    strokeLinejoin: "round",
    strokeLinecap: "round",
    vectorEffect: "non-scaling-stroke",
  },
  area: { fill: "var(--series)", fillOpacity: 0.09, stroke: "none" },
  dot: { fill: "var(--series)", stroke: "var(--chart-surface)", strokeWidth: 2 },
  halo: {
    fill: "var(--series)",
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: ripple, [motion]: "none" },
    animationDuration: "2.4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
    opacity: { default: 0, [motion]: 0 },
  },
  hoverDot: { fill: "var(--series)", stroke: "var(--chart-surface)", strokeWidth: 2 },
  crosshair: { stroke: tokens.muted, strokeWidth: 1, opacity: 0.55 },
  // The moment of the chart under the pointer, on the page's other charts.
  crosshairFollow: { strokeDasharray: "3 3", opacity: 0.7 },
  brush: { fill: tokens.accentSoft, stroke: tokens.accentLine, strokeWidth: 1 },
  breath: {
    fill: "none",
    stroke: tokens.faint,
    strokeWidth: 1.6,
    strokeLinecap: "round",
    animationName: { default: breathe, [motion]: "none" },
    animationDuration: "1.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
    opacity: 0.4,
  },
  threshold: {
    stroke: tokens.warning,
    strokeWidth: 1,
    strokeDasharray: "4 4",
    opacity: 0.7,
  },
  thresholdLabel: { fill: tokens.warning, fontFamily: tokens.ui, fontSize: 11, fontWeight: 500 },
  mark: { stroke: tokens.muted, strokeWidth: 1, strokeDasharray: "2 3", opacity: 0.6 },
  markLabel: { fill: tokens.muted, fontFamily: tokens.ui, fontSize: 11 },
  pill: { fill: tokens.raised, stroke: tokens.lineStrong, strokeWidth: 1 },
  pillText: { fill: tokens.text },
  message: {
    position: "absolute",
    inset: 0,
    bottom: BOTTOM,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    margin: 0,
    color: tokens.faint,
    fontSize: 12.5,
    textAlign: "center",
  },
  failure: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    maxWidth: 420,
    color: tokens.muted,
    lineHeight: 1.45,
  },
  retry: { minHeight: 26, height: 26, fontSize: 12 },
  notice: { margin: 0, marginTop: 6, color: tokens.faint, fontSize: 11.5 },
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    marginTop: 10,
    color: tokens.faint,
    fontSize: 11.5,
  },
  source: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
  range: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  icon: { flexShrink: 0, opacity: 0.85 },
  sourceLink: {
    flexShrink: 0,
    color: { default: tokens.muted, ":hover": tokens.text },
    textDecoration: "none",
  },
  sourceName: { color: tokens.muted },
  fetching: { color: tokens.muted },
  // The options show while the pointer or the focus is on the chart, and
  // while their menu is open; on a touch screen, always.
  more: {
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
      ":is([data-popup-open])": 1,
      "@media (hover: none)": 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  // The tools keep their size; the source's range gives way first.
  tools: { position: "relative", display: "flex", alignItems: "center", gap: 2, flexShrink: 0 },
  // In the header, beside the title: they take no height of their own.
  toolsBoard: { marginBlock: -5, marginInlineEnd: -8 },
  headStatus: {
    paddingInline: 4,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  keysBoard: { marginTop: 8 },
  noteSpot: {
    position: "absolute",
    right: "100%",
    top: "50%",
    marginRight: 6,
    transform: "translateY(-50%)",
    pointerEvents: "none",
  },
  tool: { minHeight: 26, height: 26, color: tokens.faint },
  textTool: { paddingInline: 8, fontSize: 11.5 },
  paint: (color: string) => ({ "--series": color }),
  fade: (opacity: number) => ({ opacity }),
  height: (height: number) => ({ height }),
  backdrop: { zIndex: 110 },
  popup: {
    position: "fixed",
    inset: 24,
    zIndex: 111,
    display: "flex",
    flexDirection: "column",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: tokens.shadow,
    outline: "none",
    overflow: "hidden",
  },
  hiddenTitle: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
  },
});
