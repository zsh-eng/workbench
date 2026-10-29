import "./island.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  RESTING_ISLAND,
  islandStep,
  type IslandContent,
} from "./island-timing";

export type { IslandContent } from "./island-timing";

/**
 * Work you are waiting for, as one dark island that grows out of the app's
 * own mark, says what it does in place, and folds back into the mark when
 * it is done (docs/MODEL.md, "Restoring on a new device"). One element for
 * the whole wait: its words and ring change in place, and its width moves
 * on the morph spring. With reduced motion it cross-fades and does not
 * change shape.
 *
 * `children` is the mark at rest, such as the app's icon. `status` is what
 * assistive technology hears, once per stage, not each percent.
 */
export function ActivityIsland({
  content,
  status,
  children,
  className,
  style,
}: {
  content: IslandContent | null;
  status?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const clock = useRef(RESTING_ISLAND);
  const [, setTick] = useState(0);
  const step = islandStep(clock.current, content, performance.now());
  clock.current = step.clock;
  const { phase, shown, wakeAt } = step;

  useEffect(() => {
    if (wakeAt === null) return;
    const timer = setTimeout(
      () => setTick((tick) => tick + 1),
      Math.max(0, wakeAt - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [wakeAt]);

  // The island opens from the mark's width and fits its words; it folds
  // back to the mark's width.
  const rest = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  // The words mount when the island opens: measure them then.
  const resting = phase === "rest";
  const [widths, setWidths] = useState({ rest: 0, words: 0 });
  const [grown, setGrown] = useState(false);
  useLayoutEffect(() => {
    const measure = () =>
      setWidths({
        rest: rest.current?.offsetWidth ?? 0,
        words: words.current?.scrollWidth ?? 0,
      });
    measure();
    const observer = new ResizeObserver(measure);
    if (rest.current) observer.observe(rest.current);
    if (words.current) observer.observe(words.current);
    return () => observer.disconnect();
  }, [resting]);
  // One frame at the mark's width first, so the growth has a start.
  useEffect(() => {
    if (phase !== "open") {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const open = phase === "open" && grown;
  const width = open ? widths.words : Math.max(widths.rest, 36);
  // The width the island last came to rest at, for `data-settled`: stills
  // and tests wait for it.
  const [settled, setSettled] = useState<number | null>(null);
  return (
    <span
      className={["ba-island-slot", className].filter(Boolean).join(" ")}
      data-island={phase}
      style={style}
    >
      <span
        ref={rest}
        className="ba-island-rest"
        data-hidden={open || undefined}
      >
        {children}
      </span>
      {phase !== "rest" && shown && (
        <span
          aria-hidden="true"
          className="ba-island"
          data-open={open || undefined}
          data-settled={(open && settled === width) || undefined}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            // With reduced motion only the opacity moves.
            if (
              event.propertyName === "width" ||
              matchMedia("(prefers-reduced-motion: reduce)").matches
            )
              setSettled(width);
          }}
          style={{ width }}
        >
          <span ref={words} className="ba-island-words">
            <IslandMark content={shown} />
            {/* A new stage cross-fades its words in place. */}
            <span key={shown.label} className="ba-island-label">
              {shown.label}
            </span>
            {shown.detail !== undefined && (
              <span className="ba-island-detail">{shown.detail}</span>
            )}
          </span>
        </span>
      )}
      <span className="ba-island-status" role="status">
        {phase === "rest" ? "" : (status ?? "")}
      </span>
    </span>
  );
}

function IslandMark({ content }: { content: IslandContent }) {
  if (content.mark === "progress")
    return (
      <span
        className="ba-island-ring"
        data-unknown={content.fraction === null || undefined}
        style={{ "--ba-fraction": content.fraction ?? 0 } as CSSProperties}
      >
        <svg viewBox="0 0 24 24">
          <circle className="ba-island-ring-track" cx="12" cy="12" r="9" />
          <circle
            className="ba-island-ring-fill"
            cx="12"
            cy="12"
            r="9"
            pathLength={1}
          />
        </svg>
      </span>
    );
  if (content.mark === "done")
    return (
      <span className="ba-island-check">
        <svg viewBox="0 0 24 24">
          <path d="M6.5 12.5 10.5 16.5 17.5 8" pathLength={1} />
        </svg>
      </span>
    );
  if (content.mark === "waiting")
    return (
      <span className="ba-island-icon">
        {/* A cloud with a slash: waiting for a connection. */}
        <svg viewBox="0 0 24 24">
          <path d="m2 2 20 20" />
          <path d="M5.8 5.8A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.2" />
          <path d="M21.5 15.5A4.5 4.5 0 0 0 17.5 9h-1.8A7 7 0 0 0 11 5.1" />
        </svg>
      </span>
    );
  return (
    <span className="ba-island-icon" data-attention="">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4.5M12 16h.01" />
      </svg>
    </span>
  );
}
