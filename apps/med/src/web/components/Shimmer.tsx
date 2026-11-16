// A light that passes over a label while its work runs, on the compositor.
// The label shows as it is, muted. Over it, a copy of the label in the text
// color shows through a soft window: the window slides across the label, and
// the copy slides back inside it by as much, so the copy's text stays on the
// label's and only the light moves. Both moves are transforms, so the light
// costs no layout or paint. (A gradient clipped to the text, with its
// background-position animated, painted the label again on every frame.)
//
// The copy is the label's own elements with their text as generated content
// (`ghost`), so the text is in the document once: for find, selection,
// copying, and assistive technology.
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import {
  Children,
  createElement,
  isValidElement,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { tokens } from "../theme.stylex";

const reduced = "@media (prefers-reduced-motion: reduce)";

// The light comes once a period, a few labels' widths. The window spans the
// period and the label, from a period before the label, and its mask has one
// light a period. It slides by one period while the copy inside slides back,
// so the label is always inside the window, and the loop has no seam.
//
// A label's light: two fifths of the label wide, every two labels.
const slide = stylex.keyframes({
  from: { transform: "none" },
  to: { transform: "translateX(calc(200% / 3))" },
});
const back = stylex.keyframes({
  from: { transform: "none" },
  to: { transform: "translateX(-200%)" },
});
// A quiet label's light: wider, and 3.36 labels apart.
const slideQuiet = stylex.keyframes({
  from: { transform: "none" },
  to: { transform: "translateX(calc(336% / 4.36))" },
});
const backQuiet = stylex.keyframes({
  from: { transform: "none" },
  to: { transform: "translateX(-336%)" },
});

/**
 * `children` with a light that passes over them while `on`; `quiet` for a
 * fainter label, with a wider light that comes less often. `style` is the
 * label's own.
 */
export function Shimmer({
  on,
  quiet,
  style,
  ref,
  children,
}: {
  on: boolean;
  quiet?: boolean;
  style?: StyleXStyles;
  ref?: Ref<HTMLSpanElement>;
  children: ReactNode;
}) {
  return (
    <span
      ref={ref}
      {...stylex.props(styles.root, style, on && (quiet ? styles.faint : styles.muted))}
    >
      {children}
      {on && (
        <span aria-hidden="true" {...stylex.props(styles.light)}>
          <span {...stylex.props(styles.window, quiet && styles.quietWindow)}>
            <span {...stylex.props(styles.copy, quiet && styles.quietCopy)}>{ghost(children)}</span>
          </span>
        </span>
      )}
    </span>
  );
}

/** `node`'s elements with their text as generated content. A component in
 * it has no copy. */
function ghost(node: ReactNode): ReactNode {
  return Children.map(node, (child) => {
    if (typeof child === "string" || typeof child === "number")
      return <span data-shine={child} {...stylex.props(styles.text)} />;
    if (
      !isValidElement<{ className?: string; style?: CSSProperties; children?: ReactNode }>(child) ||
      typeof child.type !== "string"
    )
      return null;
    const { className, style, children } = child.props;
    return createElement(child.type, { className, style }, ghost(children));
  });
}

const styles = stylex.create({
  root: { position: "relative" },
  muted: { color: tokens.muted },
  faint: { color: tokens.faint },
  light: {
    display: { default: "block", [reduced]: "none" },
    position: "absolute",
    inset: 0,
    overflow: "hidden",
    textOverflow: "inherit",
    pointerEvents: "none",
    userSelect: "none",
  },
  window: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "-200%",
    width: "300%",
    textOverflow: "inherit",
    maskImage: "linear-gradient(90deg, transparent 40%, #000 50%, transparent 60%)",
    maskSize: "calc(200% / 3) 100%",
    maskRepeat: "repeat-x",
    animationName: slide,
    animationDuration: "1.8s",
    // The light starts at the label's start, not a rest's length before it.
    animationDelay: "-0.72s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  copy: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: "calc(200% / 3)",
    width: "calc(100% / 3)",
    overflow: "hidden",
    textOverflow: "inherit",
    animationName: back,
    animationDuration: "1.8s",
    animationDelay: "-0.72s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  quietWindow: {
    left: "-336%",
    width: "436%",
    maskImage: "linear-gradient(90deg, transparent 41.43%, #000 50%, transparent 58.57%)",
    maskSize: "calc(336% / 4.36) 100%",
    animationName: slideQuiet,
    animationDuration: "2.6s",
    animationDelay: "-1.077s",
  },
  quietCopy: {
    left: "calc(336% / 4.36)",
    width: "calc(100% / 4.36)",
    animationName: backQuiet,
    animationDuration: "2.6s",
    animationDelay: "-1.077s",
  },
  text: { "::before": { content: "attr(data-shine)", color: tokens.text } },
});
