import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";

// Names the theme tokens behind computed colors. Each token is resolved on a
// probe element, then compared with the inspected element as 8-bit RGBA, so
// color-mix() and alpha tokens match as well as plain hex values.
const colorTokens = [
  "canvas",
  "panel",
  "raised",
  "hover",
  "border",
  "text",
  "muted",
  "faint",
  "accent",
  "selected",
  "green",
  "red",
  "warning",
  "line",
  "lineStrong",
  "fill",
  "fillStrong",
  "accentSoft",
  "accentLine",
  "scrim",
] as const;

type Rgba = [number, number, number, number];
let paint: CanvasRenderingContext2D | null = null;
/** Any CSS color, including lab() and color(srgb …), as 8-bit sRGB with alpha. */
function rgba(value: string): Rgba | null {
  if (!value || value === "none") return null;
  paint ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!paint) return null;
  paint.canvas.width = 1;
  paint.canvas.height = 1;
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = "#000";
  paint.fillStyle = value;
  paint.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!, a!];
}
const key = (color: Rgba) => color.join(",");
const hex = ([r, g, b, a]: Rgba) =>
  `#${[r, g, b, ...(a < 255 ? [a] : [])].map((part) => part.toString(16).padStart(2, "0")).join("")}`;

function over(top: Rgba, bottom: Rgba): Rgba {
  const alpha = top[3] / 255;
  const mix = (index: number) => Math.round(top[index]! * alpha + bottom[index]! * (1 - alpha));
  return [mix(0), mix(1), mix(2), Math.round(255 * (alpha + (bottom[3] / 255) * (1 - alpha)))];
}
function luminance([r, g, b]: Rgba) {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
export function contrast(a: Rgba, b: Rgba) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** The parent across shadow roots, so Pierre's lines resolve to their page backdrop. */
function parent(element: Element): Element | null {
  return element.parentElement ?? ((element.getRootNode() as ShadowRoot).host || null);
}
/** The opaque color the element is painted on, from all translucent layers below it. */
function backdrop(element: Element): Rgba {
  const layers: Rgba[] = [];
  for (let node: Element | null = element; node; node = parent(node)) {
    const color = rgba(getComputedStyle(node).backgroundColor);
    if (color && color[3] > 0) {
      layers.push(color);
      if (color[3] === 255) break;
    }
  }
  let result: Rgba = rgba(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 255];
  for (const layer of layers.reverse()) result = over(layer, result);
  return result;
}

function useTokenNames(themeId: string) {
  return useMemo(() => {
    void themeId;
    const probe = document.createElement("div");
    document.body.append(probe);
    const names = new Map<string, string>();
    for (const name of colorTokens) {
      probe.style.color = tokens[name];
      const color = rgba(getComputedStyle(probe).color);
      if (color && !names.has(key(color))) names.set(key(color), name);
    }
    probe.style.fontFamily = tokens.ui;
    const ui = getComputedStyle(probe).fontFamily;
    probe.style.fontFamily = tokens.code;
    const code = getComputedStyle(probe).fontFamily;
    probe.style.boxShadow = tokens.shadow;
    const shadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    return { names, ui, code, shadow };
  }, [themeId]);
}

interface Reading {
  element: Element;
  rect: DOMRect;
}

function describe(element: Element) {
  const role = element.getAttribute("role");
  const label = element.getAttribute("aria-label");
  const tag = element.tagName.toLowerCase();
  const text = (element.textContent ?? "").trim().replace(/\s+/g, " ");
  return {
    name: `${tag}${role ? `[role=${role}]` : ""}`,
    detail: label ?? (text.length > 48 ? `${text.slice(0, 47)}…` : text),
  };
}

/**
 * Inspect mode: hover outlines the element under the pointer inside a specimen;
 * a click pins it and lists its type, box, colors as theme tokens, and contrast.
 */
export function Inspector({ themeId }: { themeId: string }) {
  const [hovered, setHovered] = useState<Reading | null>(null);
  const [pinned, setPinned] = useState<Reading | null>(null);
  const known = useTokenNames(themeId);
  const pinnedRef = useRef(pinned);
  useEffect(() => {
    pinnedRef.current = pinned;
  }, [pinned]);
  useEffect(() => {
    const target = (event: Event) => {
      const element = event.composedPath()[0];
      if (!(element instanceof Element)) return null;
      const inside = event
        .composedPath()
        .some((node) => node instanceof HTMLElement && node.dataset.specimenStage !== undefined);
      return inside ? element : null;
    };
    const move = (event: PointerEvent) => {
      const element = target(event);
      setHovered(element ? { element, rect: element.getBoundingClientRect() } : null);
    };
    // Inspection replaces the element's own click, so menus and buttons hold still.
    const click = (event: MouseEvent) => {
      const element = target(event);
      if (!element) return;
      event.preventDefault();
      event.stopPropagation();
      setPinned({ element, rect: element.getBoundingClientRect() });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pinnedRef.current) {
        event.stopPropagation();
        setPinned(null);
      }
    };
    const refresh = () =>
      setPinned((value) => value && { ...value, rect: value.element.getBoundingClientRect() });
    addEventListener("pointermove", move, true);
    addEventListener("click", click, true);
    addEventListener("keydown", key, true);
    addEventListener("scroll", refresh, true);
    return () => {
      removeEventListener("pointermove", move, true);
      removeEventListener("click", click, true);
      removeEventListener("keydown", key, true);
      removeEventListener("scroll", refresh, true);
    };
  }, []);
  const reading = pinned ? read(pinned.element, known) : null;
  return (
    <>
      {hovered && hovered.element !== pinned?.element && (
        <div aria-hidden="true" {...stylex.props(styles.box, place(hovered.rect))} />
      )}
      {pinned && (
        <div
          aria-hidden="true"
          {...stylex.props(styles.box, styles.pinnedBox, place(pinned.rect))}
        />
      )}
      <aside aria-label="Inspector" aria-live="polite" {...stylex.props(styles.panel)}>
        {reading ? (
          <>
            <header {...stylex.props(styles.panelHeader)}>
              <span {...stylex.props(styles.elementName)}>{reading.name}</span>
              <button
                type="button"
                aria-label="Clear inspection"
                onClick={() => setPinned(null)}
                {...stylex.props(styles.clear)}
              >
                <Icon name="close" size={12} />
              </button>
            </header>
            {reading.detail && <p {...stylex.props(styles.detail)}>{reading.detail}</p>}
            <dl {...stylex.props(styles.rows)}>
              {reading.rows.map(([label, value, color]) => (
                <div key={label} {...stylex.props(styles.row)}>
                  <dt {...stylex.props(styles.label)}>{label}</dt>
                  <dd {...stylex.props(styles.value)}>
                    {color && <span {...stylex.props(styles.chip, styles.swatch(color))} />}
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : (
          <p {...stylex.props(styles.hint)}>
            Click an element in a specimen to read its tokens. Press Escape to clear.
          </p>
        )}
      </aside>
    </>
  );
}

function place(rect: DOMRect) {
  return styles.place(rect.left, rect.top, rect.width, rect.height);
}

function read(element: Element, known: ReturnType<typeof useTokenNames>) {
  const style = getComputedStyle(element);
  const name = (value: string) => {
    const color = rgba(value);
    if (!color || color[3] === 0) return null;
    return { label: known.names.get(key(color)) ?? hex(color), swatch: hex(color) };
  };
  const rows: [string, string, string?][] = [];
  const rect = element.getBoundingClientRect();
  rows.push(["Box", `${Math.round(rect.width)} × ${Math.round(rect.height)}`]);
  const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    .map((value) => parseFloat(value))
    .join(" ");
  if (padding !== "0 0 0 0") rows.push(["Padding", padding]);
  if (style.borderRadius !== "0px") rows.push(["Radius", style.borderRadius]);
  const family =
    style.fontFamily === known.ui
      ? "ui"
      : style.fontFamily === known.code
        ? "code"
        : style.fontFamily.split(",")[0]!.replace(/"/g, "");
  rows.push([
    "Type",
    `${family} ${parseFloat(style.fontSize)}/${style.lineHeight === "normal" ? "normal" : parseFloat(style.lineHeight)} · ${style.fontWeight}`,
  ]);
  if (style.letterSpacing !== "normal") rows.push(["Tracking", style.letterSpacing]);
  const text = name(style.color);
  if (text) rows.push(["Text", text.label, text.swatch]);
  const fill = name(style.backgroundColor);
  if (fill) rows.push(["Fill", fill.label, fill.swatch]);
  if (parseFloat(style.borderTopWidth) > 0) {
    const border = name(style.borderTopColor);
    if (border) rows.push(["Border", `${border.label} · ${style.borderTopWidth}`, border.swatch]);
  }
  if (style.boxShadow !== "none")
    rows.push(["Shadow", style.boxShadow === known.shadow ? "shadow" : "custom"]);
  if (style.opacity !== "1") rows.push(["Opacity", style.opacity]);
  const ground = backdrop(element);
  const ink = rgba(style.color);
  if (ink && (element.textContent ?? "").trim()) {
    const ratio = contrast(over(ink, ground), ground);
    rows.push([
      "Contrast",
      `${ratio.toFixed(2)} : 1 ${ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "below AA"}`,
    ]);
  }
  rows.push(["Backdrop", known.names.get(key(ground)) ?? hex(ground), hex(ground)]);
  return { ...describe(element), rows };
}

const styles = stylex.create({
  box: {
    position: "fixed",
    zIndex: 200,
    pointerEvents: "none",
    boxSizing: "border-box",
    outline: `1px solid ${tokens.accent}`,
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 8%, transparent)`,
  },
  pinnedBox: { outlineWidth: 2, backgroundColor: "transparent" },
  panel: {
    position: "fixed",
    right: 16,
    bottom: 16,
    zIndex: 201,
    boxSizing: "border-box",
    width: 280,
    maxHeight: "60vh",
    overflowY: "auto",
    padding: 12,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, ${tokens.shadow}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  panelHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  elementName: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.accent },
  clear: {
    display: "grid",
    placeItems: "center",
    width: 20,
    height: 20,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.muted,
    cursor: "pointer",
  },
  detail: {
    marginBlock: 4,
    color: tokens.muted,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rows: { display: "grid", gap: 4, marginBlock: 8, marginBottom: 0 },
  row: { display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 8 },
  label: { color: tokens.faint },
  value: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    minWidth: 0,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    overflowWrap: "anywhere",
  },
  chip: {
    width: 10,
    height: 10,
    flexShrink: 0,
    borderRadius: `calc(3px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}`,
  },
  hint: { margin: 0, color: tokens.muted, lineHeight: 1.5 },
  place: (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
  }),
  swatch: (color: string) => ({ backgroundColor: color }),
});
