// The React Compiler would add a hook (its memo cache) to each component. Kept
// out, the toast has none, so it renders under another copy of React: Reader's
// React is 19.2 and this package's is 19.3. There is nothing here to memoise.
// Each component says "use no memo" itself: bundlers drop a module-level
// directive, and Rolldown warns about one.

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/** Seconds that Undo stays on offer. */
export const UNDO_SECONDS = 8;

export type UndoOffer = {
  onUndo: () => void;
  /** The countdown ran out. The change stays; only the offer ends. */
  onDone?: () => void;
  seconds?: number;
  label?: string;
  /**
   * Counts the changes the toast has taken in. A new round starts the
   * countdown again, as when a second deletion joins the first.
   */
  round?: number;
};

export type ToastProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  message: ReactNode;
  /** Offers Undo with a countdown, after Telegram's undo bar. */
  undo?: UndoOffer;
  /**
   * The change was undone. The countdown becomes a check and Undo goes, in
   * the same toast: render the toast that offered Undo again with `done`.
   */
  done?: boolean;
};

/**
 * One line of feedback after an action, and Undo with the seconds left. The
 * toast is the surface only: each app places it, moves it in and out, and
 * colours it with the custom properties in `toast.css`. Import that file once.
 *
 * A toast keeps its identity. One subject is one toast for its whole life:
 * the app renders the same element with a new message (and a new
 * `undo.round`, or `done`) instead of showing another toast, and only the
 * words change.
 *
 * Pointing at the toast or focusing it holds the countdown, and so does a
 * hidden page. The component uses no hooks, so an app with another copy of
 * React can render it.
 */
export function Toast({
  message,
  undo,
  done,
  className,
  ...props
}: ToastProps) {
  "use no memo";
  return (
    <div
      {...props}
      className={className ? `wb-toast ${className}` : "wb-toast"}
      data-undo={undo || done ? "" : undefined}
      data-done={done ? "" : undefined}
      data-again={undo?.round || done ? "" : undefined}
    >
      {done ? (
        <DoneMark />
      ) : (
        undo && (
          <UndoCountdown
            key={undo.round ?? 0}
            seconds={undo.seconds}
            onDone={undo.onDone}
          />
        )
      )}
      {/* New words come in as a new line; the toast around them stays. */}
      <span
        key={typeof message === "string" ? message : undefined}
        className="wb-toast-message"
      >
        {message}
      </span>
      {undo && (
        <button
          type="button"
          className="wb-toast-action"
          // Done, the button keeps its room so the toast keeps its shape.
          disabled={done}
          aria-hidden={done || undefined}
          onClick={done ? undefined : undo.onUndo}
        >
          <span>{undo.label ?? "Undo"}</span>
        </button>
      )}
    </div>
  );
}

/** The check that takes the countdown's place once the change is undone. */
function DoneMark() {
  "use no memo";
  return (
    <span aria-hidden="true" className="wb-toast-done">
      <svg viewBox="0 0 24 24">
        <path d="M6.5 12.5 10.5 16.5 17.5 8" pathLength={1} />
      </svg>
    </span>
  );
}

/**
 * The time left to undo: a ring drains once, linearly, and the digit counts
 * down each second, as Telegram's does. CSS animations keep both on one
 * clock, so they hold together and nothing renders while it runs. Each
 * second of the digit's roll ends with an `animationiteration` event, which
 * writes the seconds left: the number holds when the animations hold. Mount
 * a new countdown (a new `key`) to start again.
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
  "use no memo";
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
      <span
        className="wb-countdown-digit"
        onAnimationIteration={(event) => {
          if (event.animationName !== "wb-countdown-tick") return;
          // One event can stand for several seconds after a stall, so the
          // number comes from the time elapsed, not from a count of events.
          // React wrote the first number, and it leaves the text alone while
          // `seconds` stays the same.
          event.currentTarget.textContent = String(
            seconds - Math.round(event.elapsedTime),
          );
        }}
      >
        {seconds}
      </span>
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
