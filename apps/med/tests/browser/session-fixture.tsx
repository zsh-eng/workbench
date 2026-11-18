import { expect } from "vitest";
import { page } from "vitest/browser";
import { useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionSection } from "../../src/web/components/elements/SessionSection";
import { SessionThread } from "../../src/web/components/session/SessionThread";
import { createSessionStore, type SessionStore } from "../../src/web/data/session-store";
import {
  type Streaming,
  useStreamedReplies,
  withStreamedReplies,
} from "../../src/web/components/session/streamed-replies";
import "../../src/web/pierre-theme";
import { initializeTheme, THEME_STORAGE_KEY } from "../../src/web/themes";

// A session's thread (SessionThread) in the page, for the session-*.test.tsx
// files: threads to render, and how to read where the view is.

export let root: Root | undefined;
export let mount: HTMLDivElement | undefined;
/** Unmounts the thread and forgets the theme. */
export function cleanUp() {
  localStorage.removeItem(THEME_STORAGE_KEY);
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
}
/** A new frame for the thread in the page, with these styles. */
export function frame(style: Partial<CSSStyleDeclaration> = {}) {
  mount = document.createElement("div");
  Object.assign(mount.style, style);
  document.body.append(mount);
  root = createRoot(mount);
  return root;
}
/** Renders again from nothing in the same frame, as when the thread opens again. */
export function remount() {
  root!.unmount();
  root = createRoot(mount!);
}

export async function setup() {
  await page.viewport(1280, 900);
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<SessionSection />);
  const replay = page.getByRole("figure").filter({ hasText: "Replay" });
  await expect.element(replay.getByRole("button", { name: "Play" })).toBeVisible();
  return replay;
}

/** A thread of prompts and replies, in a frame of 600 pixels. */
export function longThread(turns: number, first = 0) {
  const store = createSessionStore();
  store.applyAll(turnEvents(first, turns));
  mount = document.createElement("div");
  mount.style.height = "600px";
  mount.style.width = "520px";
  document.body.append(mount);
  root = createRoot(mount);
  return store;
}
export function turnEvents(first: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const turn = first + index;
    return [
      {
        at: turn * 1000,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: { type: "text" as const, text: `Prompt ${turn}` },
        },
      },
      {
        at: turn * 1000 + 500,
        update: {
          sessionUpdate: "agent_message_chunk" as const,
          messageId: `r${turn}`,
          content: {
            type: "text" as const,
            // Replies of different lengths, so the estimates matter.
            text: `Reply ${turn}. ${"The change keeps the view still. ".repeat(turn % 7)}`,
          },
        },
      },
    ];
  }).flat();
}
export const units = () => [...document.querySelectorAll<HTMLElement>("[data-unit]")];
/** A thread's scroller: its log sits in a track that clips the glide. */
export const scrollerOf = (log: Element) => log.parentElement!.parentElement!;
export const threadScroller = () => scrollerOf(document.querySelector('[aria-label="Session"]')!);
/** The first unit whose bottom is in view, and its top in the frame. */
export function firstInView() {
  const frame = threadScroller().getBoundingClientRect();
  const unit = units().find((element) => element.getBoundingClientRect().bottom > frame.top + 1)!;
  return {
    key: unit.dataset.unit!,
    text: unit.textContent!,
    top: unit.getBoundingClientRect().top - frame.top,
  };
}
export const topOf = (key: string) =>
  document.querySelector(`[data-unit="${key}"]`)!.getBoundingClientRect().top -
  threadScroller().getBoundingClientRect().top;

// The thread's type: Med's own Geist, and Paper Mono with its proseScale.

/** More characters than a line of the thread holds at its widest. */
export const LINE_CHARACTERS = 140;
/**
 * The text on the view's top line: its paragraph, and where in it the line
 * starts. A new width rewraps the line, so the place moves by less than a line.
 */
export function topLine(scroller: HTMLElement) {
  const box = scroller.getBoundingClientRect();
  const paragraphs = [...scroller.querySelectorAll<HTMLElement>("[data-unit] p")];
  const at = paragraphs.find((element) => element.getBoundingClientRect().bottom > box.top + 4)!;
  const text = at.getBoundingClientRect();
  const caret = document.caretRangeFromPoint(text.left + 2, Math.max(box.top, text.top) + 4)!;
  const before = document.createRange();
  before.setStart(at, 0);
  before.setEnd(caret.startContainer, caret.startOffset);
  return { text: at.textContent!.slice(0, 16), offset: before.toString().length };
}

export const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
export async function afterFrames(count: number) {
  for (let at = 0; at < count; at++) await nextFrame();
}
export const gapOf = (scroller: HTMLElement) =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
/** Adds a chunk of a reply each frame until it stops, as an agent streams. */
export function streamReply(add: (count: number) => void) {
  let count = 0;
  let on = true;
  const done = (async () => {
    while (on) {
      add(++count);
      await nextFrame();
    }
  })();
  return {
    count: () => count,
    async stop() {
      on = false;
      await done;
    },
  };
}
/** The view keeps to the end as the reply grows. A reply's Markdown can grow
 * it between frames; the view follows in the next frame's resize callbacks,
 * before it paints. */
export async function follows(scroller: HTMLElement) {
  for (let round = 0; round < 2; round++) {
    await afterFrames(6);
    await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  }
}
/** The view stays where the reader put it while text keeps arriving. */
export async function holds(scroller: HTMLElement, reply: { count(): number }) {
  // A key's scroll can animate: the place is where it stops.
  let top = Number.NaN;
  for (let still = 0, at = 0; still < 4 && at < 60; at++) {
    await nextFrame();
    still = Math.abs(scroller.scrollTop - top) < 0.5 ? still + 1 : 0;
    top = scroller.scrollTop;
  }
  // A view that jumps to the end does so in the frame after new text.
  const from = reply.count();
  await afterFrames(12);
  expect(reply.count()).toBeGreaterThan(from + 8);
  expect(Math.abs(scroller.scrollTop - top)).toBeLessThan(1);
  expect(gapOf(scroller)).toBeGreaterThan(0);
}
/** A word of a streaming reply, and a paragraph's end now and then. */
export const word = (count: number) => (count % 6 ? `word ${count} ` : "word.\n\n");

/** The thread as the Session panel shows it: the transcript's items, then
 * the replies that the host streams. */
export function Streamed({
  store,
  streaming,
  running = true,
}: {
  store: SessionStore;
  streaming?: Streaming;
  running?: boolean;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const replies = useStreamedReplies(snapshot.items, streaming);
  return (
    <SessionThread
      snapshot={{
        ...snapshot,
        running,
        items: withStreamedReplies(snapshot.items, replies),
      }}
    />
  );
}
