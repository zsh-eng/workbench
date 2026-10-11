import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState } from "react";
import { tokens } from "../theme.stylex";
import "./CardTab.css";

/** Space between the tab and the window controls on its right. */
const GAP = 6;
/** The radius of the inward curve where a side of the tab meets the card's top edge. */
const FLARE = 8;

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
}

const arc = (radius: number, x: number, y: number, sweep: 0 | 1) =>
  `A${radius} ${radius} 0 0 ${sweep} ${x} ${y}`;

/**
 * The card's edge, `inset` px inside its outer bounds: rounded corners turn
 * clockwise, and the curves at the foot of the tab turn the other way.
 */
function edge({ width, height, shoulder, start, end, radius }: Shape, inset: number) {
  const [left, top, right, bottom] = [inset, inset, width - inset, height - inset];
  const below = shoulder + inset;
  const round = Math.max(0, radius - inset);
  const flare = FLARE + inset;
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
 * hidden): its first row rises beside the window controls as a tab, and the
 * card steps down under the controls on either side. It renders first in the
 * card; the card draws no background or outline of its own (CardTab.css).
 */
export function CardTab() {
  const svg = useRef<SVGSVGElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [shape, setShape] = useState<Shape | null>(null);
  useLayoutEffect(() => {
    const card = svg.current!.parentElement!;
    const update = () => {
      const box = card.getBoundingClientRect();
      const area = probe.current!.getBoundingClientRect();
      const row = svg.current!.nextElementSibling?.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
      const room = radius + FLARE;
      // The card's edge sits on the first row's bottom rule.
      const shoulder = (row?.bottom ?? box.top) - 1 - box.top;
      // Window controls over the card's corners push the tab's sides in.
      const left = area.left - box.left;
      const right = area.right - GAP - box.left;
      const start = left > 0 ? Math.max(left, room) : 0;
      const end = right < box.width ? Math.min(right, box.width - room) : box.width;
      const next = { width: box.width, height: box.height, shoulder, start, end, radius };
      card.style.setProperty("--med-tab-before", `${start ? start - FLARE - 1 : 0}px`);
      card.style.setProperty(
        "--med-tab-after",
        `${end < box.width ? box.width - 1 - end - FLARE : 0}px`,
      );
      card.style.setProperty("--med-tab-inset-start", `${start ? FLARE + 1 : 0}px`);
      card.style.setProperty("--med-tab-inset-end", `${end < box.width ? FLARE + 1 : 0}px`);
      setShape((last) =>
        last && Object.entries(next).every(([key, value]) => last[key as keyof Shape] === value)
          ? last
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(card);
    observer.observe(probe.current!);
    const row = svg.current!.nextElementSibling;
    if (row) observer.observe(row);
    return () => {
      observer.disconnect();
      for (const name of ["before", "after", "inset-start", "inset-end"])
        card.style.removeProperty(`--med-tab-${name}`);
    };
  }, []);
  const frame = stylex.props(styles.svg);
  return (
    <>
      <span ref={probe} aria-hidden="true" className="med-titlebar-area" />
      <svg ref={svg} aria-hidden="true" className={`med-card-tab ${frame.className ?? ""}`}>
        {shape && (
          <>
            {/* The fill starts inside the 1px outline, so the outline's
                translucent line lies on the frame, as the card's box-shadow did. */}
            <path d={edge(shape, 1)} {...stylex.props(styles.fill)} />
            <path d={edge(shape, 0.5)} {...stylex.props(styles.outline)} />
          </>
        )}
      </svg>
    </>
  );
}

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
