import type { SessionEvent, SessionUpdate } from "../../shared/agent-session";
import type { SessionStore } from "./session-store";

/** A transcript keeps finished blocks; a live agent streams about 4 ms per character. */
const MS_PER_CHARACTER = 4;
/** Waits longer than this play shorter, so a slow tool or an idle user does not stall the replay. */
const LONGEST_WAIT = 4000;

interface Step {
  /** Milliseconds from the start of the replay. */
  time: number;
  event: SessionEvent;
}

/**
 * Splits text into chunks the size of a model's tokens: a few characters,
 * cut after spaces where possible.
 */
function tokens(text: string) {
  return text.match(/\S{1,6}\s*|\s+/g) ?? [];
}

/**
 * Turns the events of a transcript into the stream that a live agent sends.
 * A transcript records each reply when it is complete, so the replay streams
 * it in token-sized chunks that end at the recorded time, and shows each
 * thought from when it started.
 */
export function replaySteps(events: SessionEvent[]): Step[] {
  const steps: Step[] = [];
  const start = events[0]?.at ?? 0;
  let previous = 0;
  let shift = 0;
  for (const event of events) {
    let time = event.at - start - shift;
    if (time - previous > LONGEST_WAIT) {
      shift += time - previous - LONGEST_WAIT;
      time = previous + LONGEST_WAIT;
    }
    const update = event.update;
    if (
      (update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk") &&
      update.content.type === "text"
    ) {
      const thought = update.sessionUpdate === "agent_thought_chunk";
      const duration = update._meta?.med?.durationMs;
      const parts = tokens(update.content.text);
      const length = update.content.text.length * MS_PER_CHARACTER;
      const from = Math.max(
        previous,
        time - (thought && duration ? Math.min(duration, LONGEST_WAIT) : length),
      );
      // A thought without text still shows that the agent is thinking.
      if (thought && parts.length === 0) {
        steps.push({ time: from, event: { ...event, update: withText(update, "", true) } });
        steps.push({ time, event });
      } else
        parts.forEach((part, index) => {
          const last = index === parts.length - 1;
          steps.push({
            time: from + ((time - from) * (index + 1)) / parts.length,
            event: { ...event, update: withText(update, part, !last) },
          });
        });
    } else steps.push({ time, event });
    previous = Math.max(previous, time);
  }
  return steps;
}

/** A chunk with other text; `partial` chunks leave out the final duration. */
function withText(update: SessionUpdate, text: string, partial: boolean): SessionUpdate {
  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk"
  )
    return update;
  const med = update._meta?.med;
  const { durationMs: _duration, ...rest } = med ?? {};
  return {
    ...update,
    content: { type: "text", text },
    ...(med ? { _meta: { med: partial ? rest : med } } : {}),
  };
}

export interface ReplayState {
  playing: boolean;
  /** Milliseconds of the replay that have played. */
  position: number;
  duration: number;
  speed: number;
}

/**
 * Plays session events into a store on a clock that can pause, seek, and
 * change speed. Seeking back starts the store again and applies the events up
 * to that time at once.
 */
export function createSessionReplay(store: SessionStore, events: SessionEvent[]) {
  const steps = replaySteps(events);
  const duration = steps.at(-1)?.time ?? 0;
  let state: ReplayState = { playing: false, position: 0, duration, speed: 1 };
  let next = 0;
  let frame = 0;
  let last = 0;
  const listeners = new Set<() => void>();

  function set(change: Partial<ReplayState>) {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  }
  function advance(position: number) {
    const due: SessionEvent[] = [];
    while (next < steps.length && steps[next]!.time <= position) due.push(steps[next++]!.event);
    if (due.length) store.applyAll(due);
    store.setRunning(next < steps.length);
  }
  function tick(now: number) {
    const position = Math.min(duration, state.position + (now - last) * state.speed);
    last = now;
    advance(position);
    if (position >= duration) {
      set({ position, playing: false });
      return;
    }
    set({ position });
    frame = requestAnimationFrame(tick);
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    play() {
      if (state.playing) return;
      if (state.position >= duration) this.seek(0);
      last = performance.now();
      set({ playing: true });
      frame = requestAnimationFrame(tick);
    },
    pause() {
      cancelAnimationFrame(frame);
      set({ playing: false });
    },
    seek(position: number) {
      const target = Math.max(0, Math.min(duration, position));
      if (target < state.position) {
        store.reset();
        next = 0;
      }
      advance(target);
      last = performance.now();
      set({ position: target });
    },
    setSpeed(speed: number) {
      set({ speed });
    },
    /** The time on the replay's clock, for elapsed-time labels. */
    clock: () => (events[0]?.at ?? 0) + state.position,
    dispose() {
      cancelAnimationFrame(frame);
      listeners.clear();
    },
  };
}

export type SessionReplay = ReturnType<typeof createSessionReplay>;
