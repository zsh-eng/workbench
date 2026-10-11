/**
 * A headless player for demos on Elements pages, the marketing site, and
 * blog figures. It owns time, play and pause, scrubbing, restarts, and when a
 * demo starts by itself. Each app renders the controls in its own style.
 *
 * Two kinds of demo use it:
 * - A timeline has a duration. Its view is a function of time, or real
 *   animations that the player drives (see `driveAnimations`). It can play,
 *   pause, scrub, and replay.
 * - A run has no duration. It mounts a live component again for each run:
 *   use `state.run` as the component key. "Replay" when the component plays
 *   by itself, "Reset" when it waits for the viewer.
 */

/** A named moment on a timeline, in seconds. */
export interface Beat {
  at: number;
  label: string;
}

export interface DemoPlayerOptions {
  /** Seconds. Omit for a run: it restarts, but has no timeline. */
  duration?: number;
  /** Named moments. Shift and an arrow key move between them. */
  beats?: readonly Beat[];
  /** Plays only this slice of the timeline, in seconds. */
  from?: number;
  to?: number;
  /** Starts again at the end instead of stopping. */
  loop?: boolean;
  speed?: number;
  /**
   * "visible" (default) plays once most of the stage is in view, and pauses
   * when it leaves, until the viewer takes control. "manual" waits for Play.
   */
  autoplay?: "visible" | "manual";
  /** Opens at a moment, paused. Use it for deep links such as `?t=2.4`. */
  initialTime?: number;
  /**
   * With reduced motion a demo does not start by itself. It shows its last
   * moment ("end", the default) or its first ("start").
   */
  reducedMotion?: "end" | "start";
}

export interface DemoState {
  kind: "timeline" | "run";
  /** Seconds from the start of the timeline. Always 0 for a run. */
  time: number;
  /** The playable slice. */
  start: number;
  end: number;
  /** 0 to 1 through the slice. */
  progress: number;
  playing: boolean;
  ended: boolean;
  scrubbing: boolean;
  speed: number;
  /** Counts restarts. Key the demo's component with it. */
  run: number;
  /** The last beat at or before the current time. */
  beat: Beat | undefined;
  /** True once the viewer has used a control. Autoplay then stops. */
  controlled: boolean;
}

export interface DemoPlayer {
  getState(): DemoState;
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  /** Play, pause, or replay from the start when ended. */
  toggle(): void;
  seek(time: number): void;
  /** Moves by seconds. */
  step(seconds: number): void;
  /** Moves to the next or previous beat. */
  stepBeat(direction: 1 | -1): void;
  /** Goes back to the start and counts a new run. Plays a timeline again. */
  restart(): void;
  setSpeed(speed: number): void;
  /** Holds playback while a pointer drags the scrubber. */
  beginScrub(): void;
  endScrub(): void;
  /** Starts and pauses the demo as `element` enters and leaves the view. */
  observe(element: Element): () => void;
  destroy(): void;
}

/** Most of a stage, or most of the view for a stage taller than the view. */
const MOSTLY_VISIBLE = 0.6;
/** The longest frame step, so a background tab does not jump to the end. */
const MAX_FRAME_SECONDS = 0.05;
const EPSILON = 1e-3;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function createDemoPlayer(options: DemoPlayerOptions = {}): DemoPlayer {
  const kind = options.duration === undefined ? "run" : "timeline";
  const duration = options.duration ?? 0;
  const start = clamp(options.from ?? 0, 0, duration);
  const end = clamp(options.to ?? duration, start, duration);
  const beats = [...(options.beats ?? [])].sort((a, b) => a.at - b.at);
  const reduced = prefersReducedMotion();
  const autoplay =
    (options.autoplay ?? "visible") === "visible" &&
    options.initialTime === undefined &&
    !reduced;
  const restingTime =
    reduced && (options.reducedMotion ?? "end") === "end" ? end : start;

  let time = clamp(options.initialTime ?? restingTime, start, end);
  let playing = false;
  let scrubbing = false;
  let resumeAfterScrub = false;
  let speed = options.speed ?? 1;
  let run = 0;
  let controlled = !autoplay;
  let visible = false;
  let frame = 0;
  let lastFrame = 0;
  let state = snapshot();
  const listeners = new Set<() => void>();

  function snapshot(): DemoState {
    let beat: Beat | undefined;
    for (const item of beats) if (item.at <= time + EPSILON) beat = item;
    const span = end - start;
    return {
      kind,
      time,
      start,
      end,
      progress: span > 0 ? (time - start) / span : 0,
      playing,
      ended: kind === "timeline" && !playing && time >= end - EPSILON,
      scrubbing,
      speed,
      run,
      beat,
      controlled,
    };
  }

  function emit() {
    state = snapshot();
    for (const listener of listeners) listener();
  }

  function tick(now: number) {
    frame = 0;
    if (!playing || scrubbing) return;
    const seconds = Math.min(MAX_FRAME_SECONDS, (now - lastFrame) / 1000);
    lastFrame = now;
    time += seconds * speed;
    if (time >= end) {
      if (options.loop) time = start + ((time - start) % (end - start || 1));
      else {
        time = end;
        playing = false;
      }
    }
    emit();
    if (playing) schedule();
  }

  function schedule() {
    if (frame || typeof requestAnimationFrame !== "function") return;
    lastFrame = performance.now();
    frame = requestAnimationFrame(tick);
  }

  function stopClock() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function setPlaying(next: boolean) {
    if (kind === "run") return;
    if (next && time >= end - EPSILON) time = start;
    playing = next;
    if (playing && !scrubbing) schedule();
    else stopClock();
    emit();
  }

  function takeControl() {
    controlled = true;
  }

  function seekTo(next: number) {
    if (kind === "run") return;
    time = clamp(next, start, end);
    emit();
  }

  const player: DemoPlayer = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play() {
      takeControl();
      setPlaying(true);
    },
    pause() {
      takeControl();
      setPlaying(false);
    },
    toggle() {
      takeControl();
      setPlaying(!playing);
    },
    seek(next) {
      takeControl();
      seekTo(next);
    },
    step(seconds) {
      takeControl();
      if (playing) setPlaying(false);
      seekTo(time + seconds);
    },
    stepBeat(direction) {
      takeControl();
      if (playing) setPlaying(false);
      const points = [start, ...beats.map((beat) => beat.at), end];
      const target =
        direction > 0
          ? points.find((at) => at > time + EPSILON)
          : [...points].reverse().find((at) => at < time - EPSILON);
      seekTo(target ?? (direction > 0 ? end : start));
    },
    restart() {
      takeControl();
      run += 1;
      time = start;
      if (kind === "timeline") setPlaying(true);
      else emit();
    },
    setSpeed(next) {
      speed = next;
      emit();
    },
    beginScrub() {
      takeControl();
      if (scrubbing) return;
      scrubbing = true;
      resumeAfterScrub = playing;
      playing = false;
      stopClock();
      emit();
    },
    endScrub() {
      if (!scrubbing) return;
      scrubbing = false;
      if (resumeAfterScrub && time < end - EPSILON) setPlaying(true);
      else emit();
    },
    observe(element) {
      if (typeof IntersectionObserver !== "function") return () => {};
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry) return;
          const mostly =
            entry.intersectionRatio >= MOSTLY_VISIBLE ||
            entry.intersectionRect.height >= innerHeight * MOSTLY_VISIBLE;
          visible = entry.isIntersecting;
          if (controlled || kind === "run") return;
          if (mostly && !playing && time < end - EPSILON) setPlaying(true);
          else if (!visible && playing) setPlaying(false);
        },
        { threshold: [0, 0.2, 0.4, MOSTLY_VISIBLE, 0.8, 1] },
      );
      observer.observe(element);
      return () => observer.disconnect();
    },
    destroy() {
      stopClock();
      listeners.clear();
    },
  };
  return player;
}

/** Anything with a clock that a timeline can hold and move. */
export interface Scrubbable {
  pause(): void;
  /** Web Animations: milliseconds. */
  currentTime?: number | null | CSSNumberish;
  /** Motion's animation controls: seconds. */
  time?: number;
}

/**
 * Holds real animations at the player's time, so CSS transitions, the Web
 * Animations API, and Motion's `animate()` can be scrubbed. `collect` runs on
 * every time change, so it also finds animations that start later; for CSS,
 * pass `() => root.getAnimations({ subtree: true })`. `offset` is when the
 * animations start on the timeline, in seconds.
 */
export function driveAnimations(
  player: DemoPlayer,
  collect: () => Iterable<Scrubbable>,
  offset = 0,
): () => void {
  const apply = () => {
    const seconds = Math.max(0, player.getState().time - offset);
    for (const animation of collect()) {
      animation.pause();
      if ("time" in animation && typeof animation.time === "number")
        animation.time = seconds;
      else animation.currentTime = seconds * 1000;
    }
  };
  apply();
  return player.subscribe(apply);
}

/** Keyboard rules for a focused stage or scrubber. Returns true if handled. */
export function handleDemoKey(
  player: DemoPlayer,
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "altKey" | "metaKey" | "ctrlKey"
  >,
): boolean {
  if (event.altKey || event.metaKey || event.ctrlKey) return false;
  const { kind, start, end } = player.getState();
  if (kind === "run") {
    if (event.key.toLowerCase() !== "r") return false;
    player.restart();
    return true;
  }
  const small = Math.max(0.05, (end - start) / 50);
  switch (event.key) {
    case " ":
    case "k":
      player.toggle();
      return true;
    case "ArrowRight":
      if (event.shiftKey) player.stepBeat(1);
      else player.step(small);
      return true;
    case "ArrowLeft":
      if (event.shiftKey) player.stepBeat(-1);
      else player.step(-small);
      return true;
    case "Home":
      player.seek(start);
      return true;
    case "End":
      player.seek(end);
      return true;
    case "r":
    case "R":
      player.restart();
      return true;
    default:
      return false;
  }
}

/** Reads `?t=` (seconds) and `?autoplay=0` from a URL, for deep links. */
export function demoOptionsFromUrl(
  search: string = typeof location === "undefined" ? "" : location.search,
): Pick<DemoPlayerOptions, "initialTime" | "autoplay"> {
  const params = new URLSearchParams(search);
  const t = Number(params.get("t"));
  return {
    initialTime: params.has("t") && Number.isFinite(t) ? t : undefined,
    autoplay: params.get("autoplay") === "0" ? "manual" : undefined,
  };
}
