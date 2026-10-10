import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/** Seconds that Undo stays available, on the island and in toasts. */
export const UNDO_SECONDS = 8;

/**
 * Remaining Undo time, after Telegram's undo overlay: a ring drains once,
 * linearly, and the digit changes once per second. Nothing renders per frame.
 * A paused countdown holds both the ring and the digit.
 */
export function UndoCountdown({
  seconds = UNDO_SECONDS,
  paused = false,
  onDone,
}: {
  seconds?: number;
  paused?: boolean;
  onDone?: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const remaining = useRef(seconds * 1000);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (paused) return;
    const started = performance.now();
    const base = remaining.current;
    const measure = () => base - (performance.now() - started);
    const tick = setInterval(
      () => setLeft(Math.max(1, Math.ceil(measure() / 1000))),
      250,
    );
    const end = setTimeout(() => done.current?.(), Math.max(0, base));
    return () => {
      remaining.current = Math.max(0, measure());
      clearInterval(tick);
      clearTimeout(end);
    };
  }, [paused]);
  return (
    <span
      aria-hidden="true"
      className="relative flex size-6 shrink-0 items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="absolute inset-0 -rotate-90">
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          strokeWidth="1.5"
          className="stroke-foreground/15"
        />
        <circle
          cx="12"
          cy="12"
          r="10.5"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          className="stroke-foreground"
          style={{
            animation: `undo-drain ${seconds}s linear forwards`,
            animationPlayState: paused ? "paused" : "running",
          }}
        />
      </svg>
      <span className="font-numeric text-[11px] font-semibold tabular-nums">
        {left}
      </span>
    </span>
  );
}

function UndoToastBody({
  id,
  message,
  seconds,
  onUndo,
}: {
  id: string | number;
  message: string;
  seconds: number;
  onUndo: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return (
    <div
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
      className="flex w-(--width) items-center gap-3 rounded-(--sidebar-panel-radius) border border-border bg-popover py-2 pr-2 pl-3 text-[13px] font-medium text-popover-foreground shadow-lg"
    >
      {/* Reading or reaching for Undo holds the time it has left. */}
      <UndoCountdown
        seconds={seconds}
        paused={hovered || focused || hidden}
        onDone={() => toast.dismiss(id)}
      />
      <span className="min-w-0 flex-1 truncate">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="relative h-8 shrink-0 rounded-full bg-secondary px-3.5 font-medium before:absolute before:-inset-y-1.5 before:content-[''] hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Undo
      </button>
    </div>
  );
}

/** Shows a toast with Undo and its countdown; returns its dismissal. The
 * action is already saved: the timeout dismisses the offer, not the change. */
export function showUndoToast({
  message,
  onUndo,
  seconds = UNDO_SECONDS,
}: {
  message: string;
  onUndo: () => void;
  seconds?: number;
}): () => void {
  const id = toast.custom(
    (id) => (
      <UndoToastBody
        id={id}
        message={message}
        seconds={seconds}
        onUndo={onUndo}
      />
    ),
    { duration: Infinity },
  );
  return () => toast.dismiss(id);
}
