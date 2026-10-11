import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { tokens } from "../theme.stylex";
import "./CardTab.css";

interface Shape {
  width: number;
  height: number;
  /** The top of the card's edge beside the tab. */
  shoulder: number;
  /** The left side of the tab, or 0 when the tab starts at the card's edge. */
  start: number;
  /** The right side of the tab; the card's width when the tab ends at the card's edge. */
  end: number;
  radius: number;
  /** The inward curve at the foot of the tab. */
  flare: number;
}

const arc = (radius: number, x: number, y: number, sweep: 0 | 1) =>
  `A${radius} ${radius} 0 0 ${sweep} ${x} ${y}`;

/**
 * The card's edge, `inset` px inside its outer bounds: rounded corners turn
 * clockwise, and the curves at the foot of the tab turn the other way.
 */
function edge({ width, height, shoulder, start, end, radius, flare: foot }: Shape, inset: number) {
  const [left, top, right, bottom] = [inset, inset, width - inset, height - inset];
  const below = shoulder + inset;
  const round = Math.max(0, radius - inset);
  const flare = foot + inset;
  const path: string[] = [];
  if (start) {
    const side = start + inset;
    path.push(
      `M${left} ${below + round}`,
      arc(round, left + round, below, 1),
      `H${side - flare}`,
      arc(flare, side, below - flare, 0),
      `V${top + round}`,
      arc(round, side + round, top, 1),
    );
  } else path.push(`M${left} ${top + round}`, arc(round, left + round, top, 1));
  if (end < width) {
    const side = end - inset;
    path.push(
      `H${side - round}`,
      arc(round, side, top + round, 1),
      `V${below - flare}`,
      arc(flare, side + flare, below, 0),
      `H${right - round}`,
      arc(round, right, below + round, 1),
    );
  } else path.push(`H${right - round}`, arc(round, right, top + round, 1));
  path.push(
    `V${bottom - round}`,
    arc(round, right - round, bottom, 1),
    `H${left + round}`,
    arc(round, left, bottom - round, 1),
    "Z",
  );
  return path.join("");
}

/**
 * The review card's outline when the card heads the window (the title bar
 * hidden): its first row rises between the window controls as a tab, and the
 * card steps down under the controls on either side. It renders first in the
 * card; the card draws no background or outline of its own (CardTab.css).
 *
 * Chrome paints a box in the theme colour behind its buttons, over the
 * page: from the free area's edge to the window's, as tall as the free area.
 * The space the card leaves for the controls is a rounded box of its own,
 * with the card's corner radius, and the curve at its foot ends on the corner
 * of Chrome's box. So every curve of the card has one radius, and no part of
 * the outline is under Chrome's box.
 */
export function CardTab() {
  const svg = useRef<SVGSVGElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const frame = svg.current!;
    const card = frame.parentElement!;
    const [fill, outline] = frame.querySelectorAll("path");
    // The outline is drawn here, not through React state, so it changes in
    // the frame that the card does.
    const update = () => {
      const box = card.getBoundingClientRect();
      const area = probe.current!.getBoundingClientRect();
      const row = frame.nextElementSibling?.getBoundingClientRect();
      // The outline is 1px outside the card's own corner.
      const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
      const flare = Math.max(0, radius - 1);
      const room = radius + flare;
      // The card's edge sits on the first row's bottom rule, below the free area.
      const shoulder = (row?.bottom ?? box.top) - 1 - box.top;
      const start =
        area.left > box.left ? Math.max(Math.ceil(area.left + flare - box.left), room) : 0;
      const end =
        area.right < box.right
          ? Math.min(Math.floor(area.right - flare - box.left), box.width - room)
          : box.width;
      const shape = { width: box.width, height: box.height, shoulder, start, end, radius, flare };
      card.style.setProperty("--med-tab-before", `${start ? start - flare - 1 : 0}px`);
      card.style.setProperty(
        "--med-tab-after",
        `${end < box.width ? box.width - 1 - end - flare : 0}px`,
      );
      card.style.setProperty("--med-tab-inset-start", `${start ? flare + 1 : 0}px`);
      card.style.setProperty("--med-tab-inset-end", `${end < box.width ? flare + 1 : 0}px`);
      card.style.setProperty("--med-card-body", `${shoulder + 1}px`);
      fill.setAttribute("d", edge(shape, 1));
      outline.setAttribute("d", edge(shape, 0.5));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    observer.observe(probe.current!);
    const row = frame.nextElementSibling;
    if (row) observer.observe(row);
    return () => {
      observer.disconnect();
      for (const name of [
        "tab-before",
        "tab-after",
        "tab-inset-start",
        "tab-inset-end",
        "card-body",
      ])
        card.style.removeProperty(`--med-${name}`);
    };
  }, []);
  const frame = stylex.props(styles.svg);
  return (
    <>
      <span ref={probe} aria-hidden="true" className="med-titlebar-area" />
      <svg ref={svg} aria-hidden="true" className={`med-card-tab ${frame.className ?? ""}`}>
        {/* The fill starts inside the 1px outline, so the outline's
            translucent line lies on the frame, as the card's box-shadow did. */}
        <path {...stylex.props(styles.fill)} />
        <path {...stylex.props(styles.outline)} />
      </svg>
    </>
  );
}

/** The card that holds a CardTab: the tab's outline replaces its own. */
export const tabbedCard = stylex.create({
  // The 1px outline is inside the box, where the box-shadow outline was outside it.
  card: {
    margin: -1,
    padding: 1,
    borderRadius: `calc(${tokens.frame} + 1px)`,
    backgroundColor: "transparent",
    boxShadow: "none",
    isolation: "isolate",
  },
});

const styles = stylex.create({
  svg: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    width: "100%",
    height: "100%",
    overflow: "visible",
    pointerEvents: "none",
  },
  fill: { fill: tokens.canvas },
  outline: { fill: "none", stroke: tokens.line, strokeWidth: 1 },
});
