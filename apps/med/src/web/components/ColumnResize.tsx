import * as stylex from "@stylexjs/stylex";
import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { tokens } from "../theme.stylex";

// A list beside the diff in one pane, such as the Changes rail, the Guide's
// rail, and the Commit tab's files, is a column with a thin handle at its
// edge. It looks and acts as a pane's gutter: drag it, or focus it and press
// ← or →; a double-click or Enter gives back the first width. Med keeps each
// kind of list's width in localStorage, for every workspace and window.

export type ColumnKind = "changes" | "guide" | "commit";

export const COLUMN_MIN = 180;
/** At most this part of the pane. */
const COLUMN_SHARE = 0.6;
/** A narrow pane keeps this much for the diff before the column gets less
 * than it asks for. */
const DIFF_ROOM = 480;
/** As a pane gutter's key step (PaneTree.tsx). */
const KEY_STEP = 24;

const key = (kind: ColumnKind) => `med:column:v1:${kind}`;
const widths = new Map<ColumnKind, number | null>();
const listeners = new Set<() => void>();

function stored(kind: ColumnKind) {
  if (!widths.has(kind)) {
    let value: number | null = null;
    try {
      const text = localStorage.getItem(key(kind));
      const number = text === null ? NaN : Number(text);
      value = Number.isFinite(number) && number > 0 ? number : null;
    } catch {
      /* Storage can be unavailable; the first width holds. */
    }
    widths.set(kind, value);
  }
  return widths.get(kind)!;
}

function store(kind: ColumnKind, width: number | null) {
  widths.set(kind, width);
  try {
    if (width === null) localStorage.removeItem(key(kind));
    else localStorage.setItem(key(kind), String(width));
  } catch {
    /* The width holds for this page. */
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const other = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith("med:column:v1:")) return;
    widths.clear();
    listener();
  };
  addEventListener("storage", other);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", other);
  };
};

/** The column's width in a pane this wide: at least 180 pixels, at most 60%
 * of the pane, and in a narrow pane less, so the diff keeps its room. */
export function fitColumn(width: number, pane: number) {
  if (!pane) return Math.max(COLUMN_MIN, Math.round(width));
  const max = Math.max(COLUMN_MIN, Math.min(pane * COLUMN_SHARE, pane - DIFF_ROOM));
  return Math.round(Math.min(Math.max(width, COLUMN_MIN), max));
}

/**
 * The width of a column of this kind. `measure` is the column's ref; its parent
 * is the pane's row that it shares with the diff. `first` is the width
 * before the reader chose one, for a pane of that width.
 */
export function useColumnWidth(kind: ColumnKind, first: (pane: number) => number) {
  const chosen = useSyncExternalStore(
    subscribe,
    () => stored(kind),
    () => null,
  );
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [pane, setPane] = useState(0);
  useLayoutEffect(() => {
    const parent = element?.parentElement;
    if (!parent) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its layout for its return.
      const width = parent.clientWidth;
      if (width) setPane(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [element]);
  const width = fitColumn(chosen ?? first(pane), pane);
  return { measure: setElement, width, pane };
}

/**
 * The handle at a column's right edge. The column needs `position: relative`.
 */
export function ColumnHandle({
  kind,
  width,
  pane,
  label,
}: {
  kind: ColumnKind;
  width: number;
  pane: number;
  /** What the handle resizes, such as "the file list". */
  label: string;
}) {
  const drag = useRef<{ x: number; width: number; frame: number } | null>(null);
  const set = useCallback(
    (next: number) => {
      const fitted = fitColumn(next, pane);
      if (fitted !== stored(kind)) store(kind, fitted);
    },
    [kind, pane],
  );
  const stop = () => {
    if (drag.current) cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    delete document.documentElement.dataset.columnResizing;
  };
  return (
    <div
      role="separator"
      aria-label={`Resize ${label}`}
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={COLUMN_MIN}
      aria-valuemax={fitColumn(Infinity, pane)}
      tabIndex={0}
      data-column-handle={kind}
      {...stylex.props(styles.handle, stylex.defaultMarker())}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, frame: 0 };
        document.documentElement.dataset.columnResizing = "";
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const next = active.width + event.clientX - active.x;
        cancelAnimationFrame(active.frame);
        // One layout per frame.
        active.frame = requestAnimationFrame(() => set(next));
      }}
      onPointerUp={stop}
      onLostPointerCapture={stop}
      onDoubleClick={() => store(kind, null)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const step = (event.shiftKey ? 4 : 1) * KEY_STEP;
          set(width + (event.key === "ArrowLeft" ? -step : step));
        } else if (event.key === "Enter") {
          event.preventDefault();
          store(kind, null);
        }
      }}
    >
      <span {...stylex.props(resizeLine.line, resizeLine.row)} />
    </div>
  );
}

/** A gutter's line: it shows after a short hover, and at once while dragged
 * or focused. PaneTree's gutters use it too. */
export const resizeLine = stylex.create({
  line: {
    borderRadius: 2,
    backgroundColor: tokens.accentLine,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
      [stylex.when.ancestor(":active")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
    transitionDelay: {
      default: "0ms",
      [stylex.when.ancestor(":hover")]: "250ms",
      [stylex.when.ancestor(":active")]: "0ms",
    },
  },
  row: { width: 2, height: "min(48px, 40%)" },
  column: { height: 2, width: "min(48px, 40%)" },
});

const styles = stylex.create({
  // Centred on the column's hairline; the hit area reaches into both sides.
  handle: {
    position: "absolute",
    zIndex: 3,
    top: 0,
    bottom: 0,
    right: -5,
    width: 9,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "col-resize",
    outline: "none",
    touchAction: "none",
  },
});
