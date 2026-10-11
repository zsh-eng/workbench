import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  createDemoPlayer,
  handleDemoKey,
  type DemoPlayer,
  type DemoPlayerOptions,
  type DemoState,
} from "./player";

export interface DemoControls {
  player: DemoPlayer;
  state: DemoState;
  /** Attach to the stage: it starts the demo in view and takes keys. */
  stageRef: (node: HTMLElement | null) => void;
  stageProps: () => {
    tabIndex: number;
    onKeyDown: (event: ReactKeyboardEvent) => void;
    "data-demo-state": "playing" | "paused" | "ended" | "run";
  };
  /** Play, Pause, or Replay at the end. */
  playButtonProps: () => {
    type: "button";
    "aria-label": "Play" | "Pause" | "Replay";
    "data-action": "play" | "pause" | "replay";
    onClick: () => void;
  };
  /** Replay or Reset: a new run from the start. */
  restartButtonProps: (label?: "Replay" | "Reset") => {
    type: "button";
    "aria-label": string;
    onClick: () => void;
  };
  /**
   * A slider over the timeline. Style the fill with the
   * `--demo-progress` custom property (0 to 1).
   */
  scrubberProps: (label?: string) => {
    role: "slider";
    tabIndex: number;
    "aria-label": string;
    "aria-valuemin": number;
    "aria-valuemax": number;
    "aria-valuenow": number;
    "aria-valuetext": string;
    style: CSSProperties;
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
    onKeyDown: (event: ReactKeyboardEvent) => void;
  };
}

/** Formats seconds as "1.2 s" for labels and the scrubber's value text. */
export const formatSeconds = (seconds: number) => `${seconds.toFixed(1)} s`;

/**
 * One player for the life of the component. Options are read once; key the
 * component to start over with new options.
 */
export function useDemoPlayer(options: DemoPlayerOptions = {}): DemoControls {
  const [player] = useState(() => createDemoPlayer(options));
  useEffect(() => () => player.destroy(), [player]);
  const state = useSyncExternalStore(
    player.subscribe,
    player.getState,
    player.getState,
  );

  const unobserve = useRef<(() => void) | undefined>(undefined);
  const stageRef = useCallback(
    (node: HTMLElement | null) => {
      unobserve.current?.();
      unobserve.current = node ? player.observe(node) : undefined;
    },
    [player],
  );

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // Keys typed into a control inside the demo stay there.
    const target = event.target as HTMLElement;
    if (
      target !== event.currentTarget &&
      target.closest("input, textarea, select, button, [contenteditable]")
    )
      return;
    if (handleDemoKey(player, event)) event.preventDefault();
  };

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    const { start, end } = player.getState();
    player.seek(start + Math.min(1, Math.max(0, ratio)) * (end - start));
  };

  const action = state.playing ? "pause" : state.ended ? "replay" : "play";
  return {
    player,
    state,
    stageRef,
    stageProps: () => ({
      tabIndex: 0,
      onKeyDown,
      "data-demo-state":
        state.kind === "run"
          ? "run"
          : state.playing
            ? "playing"
            : state.ended
              ? "ended"
              : "paused",
    }),
    playButtonProps: () => ({
      type: "button",
      "aria-label":
        action === "pause" ? "Pause" : action === "replay" ? "Replay" : "Play",
      "data-action": action,
      onClick: () => player.toggle(),
    }),
    restartButtonProps: (label = "Replay") => ({
      type: "button",
      "aria-label": label,
      onClick: () => player.restart(),
    }),
    scrubberProps: (label = "Timeline") => ({
      role: "slider",
      tabIndex: 0,
      "aria-label": label,
      "aria-valuemin": state.start,
      "aria-valuemax": state.end,
      "aria-valuenow": Number(state.time.toFixed(2)),
      "aria-valuetext": state.beat
        ? `${formatSeconds(state.time)}, ${state.beat.label}`
        : formatSeconds(state.time),
      style: {
        "--demo-progress": state.progress,
        touchAction: "none",
      } as CSSProperties,
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        player.beginScrub();
        seekFromPointer(event);
      },
      onPointerMove: (event) => {
        if (player.getState().scrubbing) seekFromPointer(event);
      },
      onPointerUp: () => player.endScrub(),
      onPointerCancel: () => player.endScrub(),
      onKeyDown: (event) => {
        if (handleDemoKey(player, event)) event.preventDefault();
      },
    }),
  };
}

/** Section ids, in page order, and the one at the top of the view. */
export function useActiveSection(ids: readonly string[], topOffset = 64) {
  const [current, setCurrent] = useState(ids[0]);
  const key = ids.join(" ");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: `-${topOffset}px 0px -70% 0px` },
    );
    for (const id of key.split(" ")) {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [key, topOffset]);
  return current;
}
