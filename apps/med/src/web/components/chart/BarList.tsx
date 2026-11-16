// Values to compare, one bar a row with its label inside, as Plausible lists
// them: the row the chart is about takes the accent. The bars grow in once
// they come into view, by transform.
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { CopyNoteText, copyFailure, useCopyNote } from "../DiagramCopy";
import { Icon } from "../Icon";
import { ActionMenu } from "../Controls";
import { formatValue, type Bar } from "./chart-model";

export function BarList({
  title,
  subtitle,
  unit,
  bars,
  source,
}: {
  title: string;
  subtitle?: string;
  unit?: string;
  bars: readonly Bar[];
  source?: string;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [shown, setShown] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [note, say] = useCopyNote();
  const max = Math.max(...bars.map(({ value }) => value));
  const base = bars.find(({ highlight }) => highlight);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        requestAnimationFrame(() => setShown(true));
      },
      { rootMargin: "-40px" },
    );
    observer.observe(list.current!);
    return () => observer.disconnect();
  }, []);
  const csv = ["label,value", ...bars.map(({ label, value }) => `${label},${value}`)].join("\n");
  return (
    <div {...stylex.props(styles.frame, stylex.defaultMarker())}>
      <h3 {...stylex.props(styles.title)}>{title}</h3>
      {subtitle && <p {...stylex.props(styles.subtitle)}>{subtitle}</p>}
      <ol ref={list} {...stylex.props(styles.list)} onPointerLeave={() => setHover(null)}>
        {bars.map((bar, index) => {
          const delta = base && bar !== base ? (bar.value - base.value) / base.value : null;
          return (
            <li
              key={bar.label}
              onPointerEnter={() => setHover(index)}
              {...stylex.props(styles.row)}
            >
              <span
                aria-hidden="true"
                {...stylex.props(
                  styles.bar,
                  bar.highlight && styles.barOn,
                  styles.grow(shown ? bar.value / max : 0, index * 45),
                )}
              />
              <span {...stylex.props(styles.label, bar.highlight && styles.labelOn)}>
                {bar.label}
              </span>
              <span
                {...stylex.props(
                  styles.delta,
                  hover === index && delta !== null && styles.deltaShown,
                )}
              >
                {delta !== null &&
                  `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(0)}% vs ${base!.label}`}
              </span>
              <span {...stylex.props(styles.value, bar.highlight && styles.labelOn)}>
                {formatValue(bar.value, unit)}
              </span>
            </li>
          );
        })}
      </ol>
      <footer {...stylex.props(styles.footer)}>
        <span>{source ?? "From the agent"}</span>
        <span {...stylex.props(styles.spacer)} />
        <span {...stylex.props(styles.noteSpot)}>
          <CopyNoteText note={note} />
        </span>
        <ActionMenu
          label="Chart options"
          sections={[
            [
              {
                label: "Copy as CSV",
                letter: "c",
                onClick: () =>
                  void navigator.clipboard.writeText(csv).then(
                    () => say("CSV copied"),
                    (cause: unknown) => say(copyFailure(cause), true),
                  ),
              },
            ],
          ]}
          trigger={[ui.button, ui.iconButton, styles.tool, styles.more]}
        >
          <Icon name="more" size={15} />
        </ActionMenu>
      </footer>
    </div>
  );
}

const surface = `var(--med-md-surface, color-mix(in srgb, ${tokens.text} 4%, ${tokens.canvas}))`;

const styles = stylex.create({
  // Its options show while the pointer or the focus is on the chart.
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
  frame: {
    display: "flex",
    flexDirection: "column",
    paddingTop: 16,
    paddingInline: 18,
    paddingBottom: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: surface,
    color: tokens.text,
    fontFamily: tokens.ui,
    // Its own type, also inside a Markdown page's prose.
    fontSize: 13,
    lineHeight: "normal",
    overflowWrap: "normal",
  },
  title: {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 1.35,
    letterSpacing: "-0.005em",
  },
  subtitle: { margin: 0, marginTop: 3, fontSize: 12, color: tokens.muted },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    marginTop: 14,
    padding: 0,
    listStyle: "none",
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 30,
    paddingRight: 2,
    fontSize: 12.5,
  },
  bar: {
    position: "absolute",
    insetBlock: 0,
    left: 0,
    width: "calc(100% - 132px)",
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fillStrong,
    transformOrigin: "left center",
    transitionProperty: "transform",
    transitionDuration: { default: "700ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionTimingFunction: tokens.easeOut,
  },
  barOn: { backgroundColor: `color-mix(in srgb, ${tokens.accent} 26%, transparent)` },
  label: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    paddingLeft: 10,
    color: tokens.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  labelOn: { color: tokens.text, fontWeight: 500 },
  delta: {
    position: "relative",
    color: tokens.faint,
    fontSize: 11.5,
    opacity: 0,
    transitionProperty: "opacity",
    transitionDuration: "120ms",
    whiteSpace: "nowrap",
  },
  deltaShown: { opacity: 1 },
  value: {
    position: "relative",
    width: 64,
    textAlign: "right",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  footer: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 30,
    marginTop: 10,
    color: tokens.faint,
    fontSize: 11.5,
  },
  spacer: { flex: "1" },
  grow: (scale: number, delay: number) => ({
    transform: `scaleX(${scale})`,
    transitionDelay: `${delay}ms`,
  }),
  noteSpot: { position: "absolute", right: 34, top: "50%", transform: "translateY(-50%)" },
  tool: { minHeight: 26, height: 26, color: tokens.faint },
});
