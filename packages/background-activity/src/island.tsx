import "./island.css";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ISLAND_CLEARANCE,
  islandFold,
  placeIsland,
  type IslandObstacle,
} from "./island-place";
import {
  RESTING_ISLAND,
  islandStep,
  type IslandContent,
} from "./island-timing";

export type { IslandContent } from "./island-timing";

/**
 * Work you are waiting for, as one island at the top centre of the window
 * (docs/MODEL.md, "Restoring on a new device"), as the Dynamic Island is:
 * below the safe area, above the page, and below the app's own controls
 * where they hold the top centre (island-place.ts). It grows from the top
 * centre, says what it does in place, and when it is done folds into the
 * app's mark if the mark is near, or folds and fades where it is. One
 * element for the whole wait: its words and ring change in place, and its
 * width moves on the morph spring. With reduced motion it cross-fades and
 * does not change shape or move.
 *
 * `children` is the app's mark, such as its icon or sync glyph, which stays
 * where the app puts it. `status` is what assistive technology hears, once
 * per stage, not each percent.
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
  const [tick, setTick] = useState(0);
  const step = islandStep(clock.current, content, performance.now());
  clock.current = step.clock;
  const { phase, shown, wakeAt } = step;

  // A timer can fire a little early (it rounds to whole milliseconds): each
  // tick sets the next one until the step moves on.
  useEffect(() => {
    if (wakeAt === null) return;
    const timer = setTimeout(
      () => setTick((tick) => tick + 1),
      Math.max(0, Math.ceil(wakeAt - performance.now()) + 1),
    );
    return () => clearTimeout(timer);
  }, [wakeAt, tick]);

  const slot = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const words = useRef<HTMLSpanElement>(null);
  const resting = phase === "rest";

  // Where it floats, measured as it opens (before it paints), and again
  // when the window or its words change size. In one window it keeps clear
  // for its widest words so far, so a shorter stage never makes it hop.
  const [place, setPlace] = useState<Place | null>(null);
  useLayoutEffect(() => {
    if (resting) return;
    let widest = { window: -1, width: 0 };
    const update = () => {
      const next = measurePlace(layer, pill, words, slot, mark, widest);
      if (!next) return;
      widest = {
        window: window.innerWidth,
        width: Math.max(next.width, widest.width),
      };
      setPlace((place) => (samePlace(place, next) ? place : next));
    };
    update();
    const observer = new ResizeObserver(update);
    if (words.current) observer.observe(words.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [resting]);

  // Where it folds to: the mark, if it is near and in view.
  const [fold, setFold] = useState<Fold | null>(null);
  useLayoutEffect(() => {
    if (phase !== "folding") {
      setFold(null);
      return;
    }
    const box = pill.current?.getBoundingClientRect();
    const rest = mark.current?.getBoundingClientRect();
    if (!box) return;
    const inView =
      rest !== undefined &&
      rest.width > 0 &&
      rest.bottom > 0 &&
      rest.top < window.innerHeight &&
      rest.right > 0 &&
      rest.left < window.innerWidth;
    setFold(
      islandFold({
        island: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        mark: inView
          ? {
              x: rest.left + rest.width / 2,
              y: rest.top + rest.height / 2,
              width: rest.width,
            }
          : null,
      }),
    );
  }, [phase]);

  // One frame at a dot's width first, so the growth has a start.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (phase !== "open") {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const open = phase === "open" && grown;
  // With reduced motion the island keeps its words' width and only fades.
  const still =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dot = place?.height ?? 36;
  const full = place?.width ?? dot;
  const width =
    still || open
      ? full
      : phase === "folding"
        ? fold
          ? Math.max(fold.width ?? dot, dot)
          : full
        : dot;
  const travel = fold && !still ? fold : null;
  // The width the island last came to rest at, for `data-settled`: stills
  // and tests wait for it. A move to another place, or another opening,
  // settles again.
  const [settled, setSettled] = useState<number | null>(null);
  const drop = place?.drop;
  useEffect(() => {
    if (phase !== "open" || !still) setSettled(null);
  }, [phase, drop, still]);
  return (
    <span
      ref={slot}
      className={["ba-island-slot", className].filter(Boolean).join(" ")}
      data-island={phase}
      style={style}
    >
      <span
        ref={mark}
        className="ba-island-rest"
        data-hidden={(open && place?.covers) || undefined}
      >
        {children}
      </span>
      {!resting &&
        shown &&
        createPortal(
          <span ref={layer} className="ba-island-layer">
            <span
              ref={pill}
              aria-hidden="true"
              className="ba-island"
              data-open={open || undefined}
              data-fold={phase === "folding" || undefined}
              data-rise={(place && place.rise > 0) || undefined}
              data-settled={(open && settled === width) || undefined}
              onTransitionEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                // With reduced motion only the opacity moves.
                const moved = ["width", "top"].includes(event.propertyName);
                if (moved || still) setSettled(width);
              }}
              style={
                {
                  width,
                  top: place?.drop ?? 0,
                  "--ba-island-rise": `${place?.rise ?? 0}px`,
                  "--ba-island-dx": `${travel?.dx ?? 0}px`,
                  "--ba-island-dy": `${travel?.dy ?? 0}px`,
                } as CSSProperties
              }
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
          </span>,
          document.body,
        )}
      <span className="ba-island-status" role="status">
        {phase === "rest" ? "" : (status ?? "")}
      </span>
    </span>
  );
}

interface Place {
  /** The island's top below the layer's (the safe area and a gap). */
  drop: number;
  /** In the window at the page's top; it rises by `rise` as the page scrolls. */
  top: number;
  rise: number;
  width: number;
  height: number;
  /** Whether it covers the app's mark, which then steps aside. */
  covers: boolean;
}

type Fold = ReturnType<typeof islandFold>;

const samePlace = (a: Place | null, b: Place) =>
  a !== null &&
  a.drop === b.drop &&
  a.rise === b.rise &&
  a.width === b.width &&
  a.height === b.height &&
  a.covers === b.covers;

/** What the island keeps clear of: whatever a tap or a key reaches. */
const CONTROLS = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
  ...[
    "button",
    "link",
    "tab",
    "menuitem",
    "checkbox",
    "radio",
    "switch",
    "combobox",
    "searchbox",
  ].map((role) => `[role=${role}]`),
].join();

type Ref<T> = { current: T | null };

/**
 * The app's bar controls in the island's column on the first screen, and
 * where that leaves the island. The app's mark and what holds it are not in
 * its way: the island folds into it.
 */
function measurePlace(
  layer: Ref<HTMLElement>,
  pill: Ref<HTMLElement>,
  words: Ref<HTMLElement>,
  slot: Ref<HTMLElement>,
  mark: Ref<HTMLElement>,
  widest: { window: number; width: number },
): Place | null {
  if (!layer.current || !pill.current || !words.current || !slot.current)
    return null;
  const frame = layer.current.getBoundingClientRect();
  const width = words.current.scrollWidth;
  const height = pill.current.offsetHeight;
  const centre = (frame.left + frame.right) / 2;
  const column =
    widest.window === window.innerWidth ? Math.max(width, widest.width) : width;
  const left = centre - column / 2;
  const right = centre + column / 2;
  const scrolled = window.scrollY;
  const obstacles: IslandObstacle[] = [];
  for (const control of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (slot.current.contains(control) || control.contains(slot.current))
      continue;
    const box = control.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || box.top > window.innerHeight)
      continue;
    if (
      box.right <= left - ISLAND_CLEARANCE ||
      box.left >= right + ISLAND_CLEARANCE
    )
      continue;
    if (
      control.checkVisibility &&
      !control.checkVisibility({
        opacityProperty: true,
        visibilityProperty: true,
      })
    )
      continue;
    const { stays, bar, passing } = whereItSits(control);
    // The page's content scrolls under the island, as under a top bar, and
    // toasts and dialogs pass over it.
    if (passing || (!stays && !bar)) continue;
    if (stays) {
      // Below a fixed or sticky bar, not on its edge: the page passes
      // under the bar there.
      const edge = stays.getBoundingClientRect();
      const bottom =
        edge.height <= 160 ? Math.max(edge.bottom, box.bottom) : box.bottom;
      obstacles.push({ ...sides(box), top: box.top, bottom, stays: true });
    } else
      obstacles.push({
        ...sides(box),
        top: box.top + scrolled,
        bottom: box.bottom + scrolled,
        stays: false,
      });
  }
  const { top, rise } = placeIsland({
    obstacles,
    left,
    right,
    top: frame.top,
    height,
  });
  // Where it shows now, for whether it covers the mark.
  const shownTop = top - (risesWithScroll() ? Math.min(scrolled, rise) : 0);
  const rest = mark.current?.getBoundingClientRect();
  const covers =
    rest !== undefined &&
    rest.width > 0 &&
    rest.left < right &&
    rest.right > left &&
    rest.top < shownTop + height &&
    rest.bottom > shownTop;
  return {
    drop: top - frame.top,
    top,
    rise,
    width,
    height,
    covers,
  };
}

/** The landmarks and widgets that hold an app's bars of controls. */
const BARS = new Set(["HEADER", "NAV"]);
const BAR_ROLES = new Set([
  "banner",
  "navigation",
  "search",
  "toolbar",
  "tablist",
  "menubar",
  "group",
  "radiogroup",
]);

/** What passes over the island for a moment: toasts and dialogs. */
const PASSING_ROLES = new Set([
  "alert",
  "status",
  "log",
  "dialog",
  "alertdialog",
]);

/**
 * Whether a control is in one of the app's bars (a header, a navigation, a
 * toolbar, a group of tabs or filters), and the fixed or sticky bar that
 * keeps it where it is as the page scrolls. Controls in neither are the
 * page's content. A control in a toast or a dialog is `passing`.
 */
function whereItSits(control: Element): {
  stays: Element | null;
  bar: boolean;
  passing: boolean;
} {
  let stays: Element | null = null;
  let bar = control.getAttribute("role") === "tab";
  for (
    let node: Element | null = control;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const role = node.getAttribute("role");
    if (
      node.tagName === "DIALOG" ||
      node.hasAttribute("aria-live") ||
      (role !== null && PASSING_ROLES.has(role))
    )
      return { stays: null, bar: false, passing: true };
    if (BARS.has(node.tagName) || (role !== null && BAR_ROLES.has(role)))
      bar = true;
    const { position } = getComputedStyle(node);
    if (!stays && (position === "fixed" || position === "sticky")) stays = node;
  }
  return { stays, bar, passing: false };
}

const sides = (box: DOMRect) => ({ left: box.left, right: box.right });

const risesWithScroll = () =>
  typeof CSS !== "undefined" && CSS.supports("animation-timeline: scroll()");

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
