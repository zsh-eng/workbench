import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Window } from "happy-dom";
import {
  ActivityTracker,
  type ActivitySession,
  type ActivityTrackerOptions,
} from "../src";
import { connectTracker } from "../src/dom";

/** The page clock, the timers and the session store of one test. */
let clock = 0;
let ids = 0;
let saved: Map<string, ActivitySession>;
const stops: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
  ids = 0;
  saved = new Map();
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
});

/** Moves the page clock and fires the timers that fall due. */
function wait(ms: number) {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

type Page = ReturnType<typeof page>;

/** A tab whose visibility and window focus the test controls. */
function page() {
  const win = new Window() as unknown as globalThis.Window;
  const doc = win.document;
  let visibility: DocumentVisibilityState = "visible";
  let focused = true;
  Object.defineProperty(doc, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(doc, "hasFocus", {
    configurable: true,
    value: () => focused,
  });
  const fire = (target: EventTarget, type: string, fields = {}) =>
    target.dispatchEvent(Object.assign(new win.Event(type), fields));
  return {
    win,
    key: () => fire(win, "keydown"),
    scroll: () => fire(doc, "scroll"),
    hide() {
      visibility = "hidden";
      fire(doc, "visibilitychange");
    },
    show() {
      visibility = "visible";
      fire(doc, "visibilitychange");
    },
    blur() {
      focused = false;
      fire(win, "blur");
    },
    focus() {
      focused = true;
      fire(win, "focus");
    },
    pagehide: (persisted: boolean) => fire(win, "pagehide", { persisted }),
    pageshow: (persisted: boolean) => fire(win, "pageshow", { persisted }),
    fire,
  };
}

function track(
  tab: Page,
  options: Partial<ActivityTrackerOptions<null>> = {},
): ActivityTracker<null> {
  const tracker = new ActivityTracker<null>({
    app: "test",
    now: () => clock,
    createId: () => `session-${++ids}`,
    persist: (session) => {
      saved.set(session.id, session);
    },
    ...options,
  });
  stops.push(connectTracker(tracker, { target: tab.win }));
  return tracker;
}

async function stored(tracker: ActivityTracker<null>) {
  await tracker.whenIdle();
  return [...saved.values()];
}

it("counts time between inputs, pauses while hidden, and saves on the pause", async () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "article", id: "ice" });
  wait(30_000);
  tab.key();
  wait(30_000);
  tab.hide();
  expect(await stored(tracker)).toMatchObject([
    { activeMs: 60_000, lastActiveAt: 60_000, endedAt: null },
  ]);

  // Inputs while hidden are not the reader's; the time away counts nothing.
  wait(30_000);
  tab.key();
  wait(600_000);
  tab.show();
  wait(30_000);
  tab.key();
  expect(tracker.session).toMatchObject({ activeMs: 90_000 });
});

it("counts a quiet stretch of three minutes, and nothing of a longer one", () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "article", id: "ice" });
  wait(50_000);
  tab.key();
  wait(180_000);
  tab.key();
  expect(tracker.session).toMatchObject({ activeMs: 230_000 });
  wait(180_001);
  tab.key();
  wait(20_000);
  tab.key();
  expect(tracker.session).toMatchObject({ activeMs: 250_000 });
});

it("chooses the gap as a session begins, and keeps it to the session's end", () => {
  const tab = page();
  let gapMs = 300_000;
  const tracker = track(tab, { gapMs: () => gapMs });
  tracker.begin({ kind: "book", id: "alice" });
  // The gap the next session would take changes; this session keeps its own.
  gapMs = 180_000;
  wait(240_000);
  tab.key();
  expect(tracker.session).toMatchObject({ gapMs: 300_000, activeMs: 240_000 });
  // The same subject keeps the open session and its gap.
  tracker.begin({ kind: "book", id: "alice" });
  expect(tracker.session).toMatchObject({ gapMs: 300_000 });
  // A new session takes the gap of its start: four quiet minutes count nothing.
  tracker.begin({ kind: "book", id: "tundra" });
  wait(240_000);
  tab.key();
  expect(tracker.session).toMatchObject({ gapMs: 180_000, activeMs: 0 });
});

it("saves on the timer without counting time, at most every five seconds", async () => {
  const tab = page();
  const writes: number[] = [];
  const tracker = track(tab, {
    persist: (session) => {
      writes.push(session.activeMs);
    },
  });
  tracker.begin({ kind: "article", id: "ice" });
  wait(1_000);
  tab.key();
  wait(1_000);
  tab.key();
  // A quiet minute: the timer finds nothing new to save.
  wait(60_000);
  await tracker.whenIdle();
  expect(writes).toEqual([0, 2_000]);
});

it("ends the session when the page unloads, and resumes one restored from the cache", async () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "book", id: "alice" });
  wait(10_000);
  tab.pagehide(true);
  wait(3_600_000);
  tab.pageshow(true);
  wait(10_000);
  tab.key();
  wait(5_000);
  tab.pagehide(false);
  expect(tracker.session).toBeNull();
  expect(await stored(tracker)).toMatchObject([
    { activeMs: 25_000, endedAt: 3_625_000 },
  ]);
});

it("pauses when the window loses focus; input to the unfocused window counts", () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "book", id: "alice" });
  wait(10_000);
  tab.blur();
  // Ninety seconds in another app count nothing.
  wait(90_000);
  tab.key();
  wait(20_000);
  tab.key();
  wait(60_000);
  tab.focus();
  wait(5_000);
  tab.key();
  expect(tracker.session).toMatchObject({ activeMs: 95_000 });
});

it("counts a scroll only just after an input, and ignores synthetic events", () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "article", id: "ice" });
  tracker.pause(0);
  // Restoring the reading position scrolls the page without a person.
  wait(60_000);
  tab.scroll();
  expect(tracker.session).toMatchObject({ activeMs: 0 });
  // A script's events are not trusted.
  const synthetic = new tab.win.Event("keydown");
  Object.defineProperty(synthetic, "isTrusted", { value: false });
  wait(10_000);
  tab.win.dispatchEvent(synthetic);
  wait(10_000);
  tab.scroll();
  expect(tracker.session).toMatchObject({ activeMs: 0 });
  // A flick: the key opens an interval, and the scroll after it counts.
  wait(30_000);
  tab.key();
  wait(800);
  tab.scroll();
  expect(tracker.session).toMatchObject({ activeMs: 800 });
});

it("counts a pen that hovers over the page, as on an iPad with Apple Pencil", () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "article", id: "ice" });
  wait(40_000);
  tab.fire(tab.win, "pointermove", { pointerType: "pen" });
  expect(tracker.session).toMatchObject({ activeMs: 40_000 });
  // A finger's or a mouse's moves count by their own events, once each.
  wait(30_000);
  tab.fire(tab.win, "pointermove", { pointerType: "touch" });
  tab.fire(tab.win, "pointermove", { pointerType: "mouse" });
  expect(tracker.session).toMatchObject({ activeMs: 40_000 });
  tab.fire(tab.win, "mousemove");
  expect(tracker.session).toMatchObject({ activeMs: 70_000 });
});

it("keeps one session per tab, and counts only the tab the person uses", async () => {
  const first = page();
  const second = page();
  const a = track(first);
  const b = track(second);
  a.begin({ kind: "book", id: "alice" });
  b.begin({ kind: "book", id: "alice" });
  first.blur();
  wait(30_000);
  second.key();
  wait(30_000);
  second.hide();
  first.focus();
  wait(30_000);
  first.key();
  a.end();
  b.end();
  await Promise.all([a.whenIdle(), b.whenIdle()]);
  const sessions = [...saved.values()];
  expect(sessions.map((session) => session.id).sort()).toEqual([
    "session-1",
    "session-2",
  ]);
  // The first tab counts once it has focus again; the second until hidden.
  expect(sessions.map((session) => session.activeMs)).toEqual([30_000, 60_000]);
});

it("begins a new session for another subject, and keeps the open one for the same", async () => {
  const tab = page();
  const tracker = track(tab);
  tracker.begin({ kind: "article", id: "ice" });
  wait(20_000);
  tracker.begin({ kind: "article", id: "ice" });
  tab.key();
  tracker.begin({ kind: "article", id: "tundra" });
  wait(10_000);
  tab.key();
  expect(await stored(tracker)).toMatchObject([
    { subject: { id: "ice" }, activeMs: 20_000, endedAt: 20_000 },
    { subject: { id: "tundra" }, startedAt: 20_000, endedAt: null },
  ]);
  expect(tracker.session).toMatchObject({
    subject: { id: "tundra" },
    activeMs: 10_000,
  });
});

it("retries a failed save, and never replaces a newer value with an older one", async () => {
  const tab = page();
  let release = () => {};
  const older = new Promise<void>((resolve) => (release = resolve));
  const attempts: number[] = [];
  let fail = true;
  const errors: unknown[] = [];
  const tracker = track(tab, {
    onError: (error) => errors.push(error),
    persist: async (session) => {
      attempts.push(session.activeMs);
      if (attempts.length === 1) await older;
      if (fail) throw new Error("Storage unavailable");
      saved.set(session.id, session);
    },
  });
  tracker.begin({ kind: "book", id: "alice" });
  wait(10_000);
  tab.key();
  // The newer value is queued behind the first save, which then fails.
  release();
  await tracker.whenIdle();
  expect(errors).toHaveLength(2);
  expect(attempts).toEqual([0, 10_000]);

  // The next checkpoint retries the newest value once.
  fail = false;
  wait(5_000);
  await tracker.whenIdle();
  expect(attempts).toEqual([0, 10_000, 10_000]);
  expect(await stored(tracker)).toMatchObject([{ activeMs: 10_000 }]);
});

it("keeps a session's start position and moves its end", async () => {
  const tab = page();
  const tracker = new ActivityTracker<{ page: number }>({
    app: "test",
    now: () => clock,
    persist: (session) => {
      saved.set(session.id, session);
    },
  });
  stops.push(connectTracker(tracker, { target: tab.win }));
  tracker.begin({ kind: "book", id: "alice" }, { position: { page: 3 } });
  tracker.begin({ kind: "book", id: "alice" }, { position: { page: 4 } });
  tracker.move({ page: 5 });
  tracker.end();
  await tracker.whenIdle();
  expect([...saved.values()]).toMatchObject([
    { position: { start: { page: 3 }, end: { page: 5 } } },
  ]);
});
