import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { tokens } from "../theme.stylex";

/** How far past half a screen text may run before it folds, so a fold hides more than a line. */
const SLACK = 96;

/**
 * Text taller than half a screen folds there. Its button names the sections
 * that the fold hides, by their headings: Show more: Testing, Rollout.
 */
export function Fold({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState<{ folds: boolean; left: string[] }>({ folds: false, left: [] });
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const content = inner.current;
    if (!content) return;
    const measure = () => {
      const half = window.innerHeight / 2;
      const folds = content.scrollHeight > half + SLACK;
      const top = content.getBoundingClientRect().top;
      const left = folds
        ? [...content.querySelectorAll("h1, h2, h3, h4")]
            .filter((heading) => heading.getBoundingClientRect().top - top >= half)
            .map((heading) => heading.textContent?.trim() ?? "")
            .filter(Boolean)
        : [];
      setFold((last) =>
        last.folds === folds && last.left.join("\n") === left.join("\n") ? last : { folds, left },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  const folded = fold.folds && !open;
  return (
    <>
      <div data-folded={folded || undefined} {...stylex.props(folded && styles.folded)}>
        <div ref={inner}>{children}</div>
      </div>
      {fold.folds && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          {...stylex.props(styles.more)}
        >
          {open
            ? "Show less"
            : fold.left.length
              ? `Show more: ${fold.left.join(", ")}`
              : "Show more"}
        </button>
      )}
    </>
  );
}

const styles = stylex.create({
  folded: {
    maxHeight: "50vh",
    overflow: "hidden",
    maskImage: "linear-gradient(to bottom, black calc(100% - 72px), transparent)",
  },
  more: {
    display: "block",
    maxWidth: "100%",
    marginBlock: 6,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "start",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
});
