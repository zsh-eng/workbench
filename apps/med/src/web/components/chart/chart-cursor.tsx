import { createContext, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

// A dashboard's shared cursor, as Grafana's shared crosshair: the moment under
// the pointer on any chart of the page, which every chart and stat marks, so
// the latency at 14:10 reads beside the errors and the CPU at 14:10. The
// chart under the pointer leads: it is the one that owns the cursor.

export interface Cursor {
  /** The moment under the pointer, or null while it is on no chart. */
  time: number | null;
  /** The chart that the pointer is on. */
  owner: string | null;
  /** The pointer at `time` on chart `owner`; null when it leaves that chart. */
  set(time: number | null, owner: string): void;
}

export const ChartCursor = createContext<Cursor | null>(null);

/** Charts inside share one cursor. A pointer's moves land once a frame. */
export function SharedCursor({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ time: number | null; owner: string | null }>({
    time: null,
    owner: null,
  });
  const pending = useRef<{ time: number | null; owner: string } | null>(null);
  const frame = useRef(0);
  const set = useCallback((time: number | null, owner: string) => {
    pending.current = { time, owner };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = pending.current!;
      pending.current = null;
      setState((last) =>
        next.time === null
          ? // Leaving a chart clears the cursor only if that chart had it.
            last.owner === next.owner
            ? { time: null, owner: null }
            : last
          : { time: next.time, owner: next.owner },
      );
    });
  }, []);
  const value = useMemo(() => ({ ...state, set }), [state, set]);
  return <ChartCursor value={value}>{children}</ChartCursor>;
}
