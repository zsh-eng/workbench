// The React Compiler would add a hook (its memo cache) to each component. Kept
// out, the toast has none, so it renders under another copy of React: Reader's
// React is 19.2 and this package's is 19.3. There is nothing here to memoise.
"use no memo";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/** Seconds that Undo stays on offer. */
export const UNDO_SECONDS = 8;

export type UndoOffer = {
  onUndo: () => void;
  /** The countdown ran out. The change stays; only the offer ends. */
  onDone?: () => void;
  seconds?: number;
  label?: string;
};

export type ToastProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  message: ReactNode;
  /** Offers Undo with a countdown, after Telegram's undo bar. */
  undo?: UndoOffer;
};

/**
 * One line of feedback after an action, and Undo with the seconds left. The
 * toast is the surface only: each app places it, moves it in and out, and
 * colours it with the custom properties in `toast.css`. Import that file once.
 *
 * Pointing at the toast or focusing it holds the countdown, and so does a
 * hidden page. The component uses no hooks, so an app with another copy of
 * React can render it.
 */
export function Toast({ message, undo, className, ...props }: ToastProps) {
  return (
    <div
      {...props}
      className={className ? `wb-toast ${className}` : "wb-toast"}
      data-undo={undo ? "" : undefined}
    >
      {undo && <UndoCountdown seconds={undo.seconds} onDone={undo.onDone} />}
      <span className="wb-toast-message">{message}</span>
      {undo && (
        <button type="button" className="wb-toast-action" onClick={undo.onUndo}>
          <span>{undo.label ?? "Undo"}</span>
        </button>
      )}
    </div>
  );
}

/**
 * The time left to undo: a ring drains once, linearly, and the digit counts
 * down each second, as Telegram's does. CSS animations keep both on one
 * clock, so they hold together and nothing renders while it runs. Mount a
 * new countdown (a new `key`) to start again.
 */
export function UndoCountdown({
  seconds = UNDO_SECONDS,
  paused = false,
  onDone,
}: {
  seconds?: number;
  /** Holds the ring and the digit where they are. */
  paused?: boolean;
  onDone?: () => void;
}) {
  return (
    <span
      ref={holdWhileHidden}
      aria-hidden="true"
      className="wb-countdown"
      data-paused={paused || undefined}
      style={{ "--wb-countdown-seconds": seconds } as CSSProperties}
      onAnimationEnd={(event) => {
        if (event.animationName === "wb-countdown-drain") onDone?.();
      }}
    >
      <svg viewBox="0 0 24 24">
        <circle className="wb-countdown-track" cx="12" cy="12" r="10.5" />
        <circle
          className="wb-countdown-ring"
          cx="12"
          cy="12"
          r="10.5"
          pathLength={1}
        />
      </svg>
      <span className="wb-countdown-digit" />
    </span>
  );
}

/** A page in the background keeps the time it has left. */
function holdWhileHidden(node: HTMLElement | null) {
  if (!node) return;
  const update = () => node.toggleAttribute("data-hidden", document.hidden);
  update();
  document.addEventListener("visibilitychange", update);
  return () => document.removeEventListener("visibilitychange", update);
}
