import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useState, type ReactNode } from "react";
import { tokens } from "../../theme.stylex";

export type Surface = "canvas" | "panel" | "raised";

/** Page-wide inspection settings that every specimen follows. */
export const StageContext = createContext({ zoom: 1 });

/** A titled group of specimens with an anchor for the page navigation. */
export function Section({
  id,
  title,
  lede,
  children,
}: {
  id: string;
  title: string;
  lede?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} {...stylex.props(styles.section)}>
      <header {...stylex.props(styles.sectionHeader)}>
        <h2 id={`${id}-title`} {...stylex.props(styles.sectionTitle)}>
          {title}
        </h2>
        {lede && <p {...stylex.props(styles.lede)}>{lede}</p>}
      </header>
      <div {...stylex.props(styles.grid)}>{children}</div>
    </section>
  );
}

/**
 * One element or group on a stage. The stage takes the chosen surface, so a
 * part can be checked on the frame, the review card, and a popover.
 */
export function Specimen({
  title,
  note,
  surface: initialSurface = "canvas",
  span = "full",
  zoomable = true,
  padded = true,
  minHeight,
  children,
}: {
  title: string;
  note?: ReactNode;
  surface?: Surface;
  /** "half" places two specimens side by side on wide screens. */
  span?: "full" | "half";
  /** Code views measure their own lines; they stay at 1× and use browser zoom. */
  zoomable?: boolean;
  padded?: boolean;
  minHeight?: number;
  children: ReactNode;
}) {
  const { zoom } = useContext(StageContext);
  const [surface, setSurface] = useState(initialSurface);
  return (
    <figure {...stylex.props(styles.specimen, span === "half" && styles.half)}>
      <figcaption {...stylex.props(styles.caption)}>
        <span {...stylex.props(styles.captionText)}>
          <span {...stylex.props(styles.title)}>{title}</span>
          {note && <span {...stylex.props(styles.note)}>{note}</span>}
        </span>
        <span role="group" aria-label={`${title} surface`} {...stylex.props(styles.surfaces)}>
          {(["panel", "canvas", "raised"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={surface === value}
              title={`Show on ${value}`}
              onClick={() => setSurface(value)}
              {...stylex.props(styles.surfaceButton, surface === value && styles.surfaceActive)}
            >
              <span {...stylex.props(styles.swatch, swatches[value])} />
            </button>
          ))}
        </span>
      </figcaption>
      <div
        data-specimen-stage=""
        {...stylex.props(
          styles.stage,
          stages[surface],
          padded && styles.padded,
          minHeight !== undefined && styles.minHeight(minHeight),
        )}
      >
        <div
          data-specimen-content=""
          {...stylex.props(styles.content, zoomable && zoom !== 1 && styles.zoom(zoom))}
        >
          {children}
        </div>
      </div>
    </figure>
  );
}

const swatches = stylex.create({
  panel: { backgroundColor: tokens.panel },
  canvas: { backgroundColor: tokens.canvas },
  raised: { backgroundColor: tokens.raised },
});

const stages = stylex.create({
  panel: { backgroundColor: tokens.panel },
  canvas: { backgroundColor: tokens.canvas },
  raised: { backgroundColor: tokens.raised },
});

const styles = stylex.create({
  section: {
    scrollMarginTop: 56,
    paddingBottom: 40,
  },
  sectionHeader: { marginBottom: 14, maxWidth: 640 },
  sectionTitle: {
    margin: 0,
    fontSize: 15,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: tokens.text,
  },
  lede: { marginBlock: 4, color: tokens.muted, fontSize: 12.5, lineHeight: 1.55 },
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 1180px)": "repeat(2, minmax(0, 1fr))",
    },
    gap: 16,
  },
  specimen: {
    gridColumnStart: 1,
    gridColumnEnd: -1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    margin: 0,
  },
  half: {
    gridColumnStart: { default: 1, "@media (min-width: 1180px)": "auto" },
    gridColumnEnd: { default: -1, "@media (min-width: 1180px)": "auto" },
  },
  caption: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
    paddingInline: 2,
    paddingBottom: 8,
  },
  captionText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  title: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  note: { color: tokens.muted, fontSize: 12, lineHeight: 1.5 },
  surfaces: {
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    flexShrink: 0,
  },
  surfaceButton: {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 20,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: "transparent",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  surfaceActive: { backgroundColor: tokens.fillStrong },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: `calc(3px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
  },
  stage: {
    position: "relative",
    minWidth: 0,
    overflow: "auto",
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  padded: { padding: 24 },
  minHeight: (height: number) => ({ minHeight: height }),
  content: { minWidth: 0 },
  zoom: (zoom: number) => ({ zoom }),
});
