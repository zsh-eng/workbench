import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Activity } from "react";
import { SessionThread } from "../../src/web/components/session/SessionThread";
import { withSentMessages, type SentMessage } from "../../src/web/data/agent-inbox";
import { type Streaming } from "../../src/web/components/session/streamed-replies";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";
import {
  afterFrames,
  cleanUp,
  firstInView,
  follows,
  gapOf,
  holds,
  longThread,
  mount,
  nextFrame,
  root,
  scrollerOf,
  Streamed,
  streamReply,
  threadScroller,
  topOf,
  turnEvents,
  units,
  word,
} from "./session-fixture";

afterEach(cleanUp);

test("while a reply streams in, the reader's move up holds the view until the reader is back at the end", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40);
  // As in SessionPanel: the messages that the reader sent, then the reply
  // that streams now, until the transcript has it.
  let sent: SentMessage | undefined;
  let text = "";
  const render = () => {
    const snapshot = store.getSnapshot();
    const items = sent ? withSentMessages(snapshot.items, [sent]) : snapshot.items;
    root!.render(
      <SessionThread
        snapshot={{
          ...snapshot,
          running: true,
          items: text ? [...items, { kind: "agent", id: "streaming-1", at: 50_000, text }] : items,
        }}
      />,
    );
  };
  render();
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r39");
  const scroller = threadScroller();
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  const reply = streamReply((count) => {
    text += word(count);
    render();
  });
  const latest = page.getByRole("button", { name: "Latest" });
  const following = async () => {
    await follows(scroller);
    await expect.element(latest).not.toBeInTheDocument();
  };
  const held = async () => {
    await holds(scroller, reply);
    await expect.element(latest).toBeVisible();
  };
  const back = async () => {
    await userEvent.click(latest);
    await following();
    scroller.focus({ preventScroll: true });
  };
  try {
    await following();

    // A trackpad's small steps up, each less than the end's margin.
    for (let step = 0; step < 3; step++) await userEvent.wheel(scroller, { delta: { y: -8 } });
    await held();
    await back();

    // Keys that scroll the focused thread up.
    scroller.focus({ preventScroll: true });
    for (const key of ["{ArrowUp}", "{PageUp}", "{Shift>} {/Shift}"]) {
      await userEvent.keyboard(key);
      await held();
      await back();
    }

    // A touch that drags the content down.
    const finger = (y: number) => [
      new Touch({ identifier: 1, target: scroller, clientX: 200, clientY: y }),
    ];
    scroller.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: finger(300) }));
    scroller.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, touches: finger(306) }));
    scroller.scrollTop -= 6;
    await held();
    scroller.dispatchEvent(new TouchEvent("touchend", { bubbles: true, touches: [] }));
    await back();

    // A drag of the scroll bar: a press on it, then a few pixels up. Headless
    // Chromium hides scroll bars, so the press and the move are the page's.
    const box = scroller.getBoundingClientRect();
    const at = { bubbles: true, clientX: box.right - 3, clientY: box.bottom - 40 };
    scroller.dispatchEvent(new PointerEvent("pointerdown", at));
    scroller.scrollTop -= 6;
    await held();
    document.dispatchEvent(new PointerEvent("pointerup", at));
    await held();
    await back();

    // A selection that the reader drags in the reply.
    const live = document.querySelector<HTMLElement>('[data-unit="streaming-1"]')!;
    const press = live.getBoundingClientRect();
    live.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: press.left + 4,
        clientY: press.top + 4,
      }),
    );
    getSelection()!.selectAllChildren(live);
    await held();
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    getSelection()!.removeAllRanges();
    await held();

    // Back at the end, by End or by the wheel, the view follows again.
    scroller.focus({ preventScroll: true });
    await userEvent.keyboard("{End}");
    await following();
    await userEvent.wheel(scroller, { delta: { y: -600 } });
    await held();
    await userEvent.wheel(scroller, { delta: { y: 100_000 } });
    await following();

    // A message that the reader sends brings the view to the end, and it
    // follows. The message comes before the reply that streams.
    await userEvent.wheel(scroller, { delta: { y: -600 } });
    await held();
    sent = {
      id: "m1",
      sessionId: "s1",
      agent: "claude",
      text: "Also check the import.",
      noteIds: [],
      attachmentCount: 0,
      createdAt: new Date(60_000).toISOString(),
      delivery: "sending",
    };
    await following();
  } finally {
    await reply.stop();
  }
});

test("a streaming reply shows whole blocks, and all of its text once it ends", async () => {
  const store = longThread(3);
  const show = (streaming: Streaming) =>
    root!.render(<Streamed store={store} streaming={streaming} />);
  show({ id: "m1", text: "I traced the slow search.\n\n```ts\nconst eligible = catalog.fil" });
  const thread = page.getByRole("log");
  await expect.element(thread.getByText("I traced the slow search.")).toBeVisible();
  // The code block waits for its closing fence, so no line shows cut.
  expect(thread.getByText(/catalog\.fil/).elements()).toHaveLength(0);
  show({
    id: "m1",
    text: "I traced the slow search.\n\n```ts\nconst eligible = catalog.filter(matches);\n```\n\nThe filters ru",
  });
  await expect.element(thread.getByText("const eligible = catalog.filter(matches);")).toBeVisible();
  expect(thread.getByText(/The filters ru/).elements()).toHaveLength(0);
  // The text ended, as when a tool call comes next: the last paragraph shows.
  show({
    id: "m1",
    text: "I traced the slow search.\n\n```ts\nconst eligible = catalog.filter(matches);\n```\n\nThe filters run first.",
    ended: true,
  });
  await expect.element(thread.getByText("The filters run first.")).toBeVisible();
});

test("new work glides in only while the view follows the end; a reader elsewhere sees nothing move", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40);
  const paragraph = (index: number) =>
    `Paragraph ${index}. ${"The filters run before ranking. ".repeat(3)}`;
  let count = 6;
  const text = () =>
    `${Array.from({ length: count }, (_, index) => paragraph(index)).join("\n\n")}\n\n`;
  const show = () =>
    root!.render(<Streamed store={store} streaming={{ id: "m1", text: text() }} />);
  show();
  await expect.element(page.getByText(/^Paragraph 5\./)).toBeInTheDocument();
  const scroller = threadScroller();
  const log = page.getByRole("log", { name: "Session" }).element() as HTMLElement;
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  await afterFrames(30);
  const glides = () => log.getAnimations().filter((animation) => animation.playState === "running");

  // At the end, a new block glides in.
  count++;
  show();
  await expect.element(page.getByText(/^Paragraph 6\./)).toBeInTheDocument();
  await expect.poll(() => glides().length).toBe(1);

  // The reader moves up mid-glide: the content stays where it shows, and only
  // the reader's own scroll moves it. (This wheel event scrolls nothing.)
  const unit = units().at(-2)!;
  const before = unit.getBoundingClientRect().top;
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, bubbles: true }));
  expect(Math.abs(unit.getBoundingClientRect().top - before)).toBeLessThan(0.5);
  expect(glides()).toHaveLength(0);
  await expect.element(page.getByRole("button", { name: "Latest" })).toBeVisible();

  // Away from the end, new blocks land below and nothing in view moves.
  const shown = firstInView();
  for (let round = 0; round < 4; round++) {
    count++;
    show();
    for (let frame = 0; frame < 12; frame++) {
      await nextFrame();
      expect(glides()).toHaveLength(0);
      expect(Math.abs(topOf(shown.key) - shown.top)).toBeLessThan(0.5);
    }
  }
  await expect.element(page.getByText(/^Paragraph 10\./)).toBeInTheDocument();
});

test("a change above the view moves nothing, and a glide under way runs on as the turn ends", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40);
  const paragraph = (index: number) =>
    `Paragraph ${index}. ${"The filters run before ranking. ".repeat(3)}`;
  let count = 6;
  const text = () =>
    `${Array.from({ length: count }, (_, index) => paragraph(index)).join("\n\n")}\n\n`;
  const show = (running = true) =>
    root!.render(
      <Streamed
        store={store}
        streaming={{ id: "m1", text: text(), ended: !running }}
        running={running}
      />,
    );
  show();
  await expect.element(page.getByText(/^Paragraph 5\./)).toBeInTheDocument();
  const scroller = threadScroller();
  const log = page.getByRole("log", { name: "Session" }).element() as HTMLElement;
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  await afterFrames(30);
  const glides = () => log.getAnimations().filter((animation) => animation.playState === "running");
  const offset = () => new DOMMatrixReadOnly(getComputedStyle(log).transform).m42;

  // A unit above the view grows. The view keeps the end, so nothing on screen
  // moves, and nothing glides.
  const above = units()[0]!;
  expect(above.getBoundingClientRect().bottom).toBeLessThan(scroller.getBoundingClientRect().top);
  const last = units().at(-1)!;
  const top = last.getBoundingClientRect().top;
  above.style.paddingBottom = "120px";
  for (let frame = 0; frame < 8; frame++) {
    await nextFrame();
    expect(glides()).toHaveLength(0);
    expect(Math.abs(last.getBoundingClientRect().top - top)).toBeLessThan(0.5);
  }
  expect(gapOf(scroller)).toBeLessThan(32);

  // The last block glides in, and the turn ends meanwhile: the glide runs on
  // to its place, and the content does not jump there.
  count++;
  show();
  await expect.poll(() => glides().length).toBe(1);
  await nextFrame();
  show(false);
  await afterFrames(2);
  expect(glides()).toHaveLength(1);
  expect(offset()).toBeGreaterThan(1);
  await expect.poll(() => glides().length).toBe(0);
  expect(offset()).toBe(0);
  expect(gapOf(scroller)).toBeLessThan(32);
});

test("a thread that shows again is still at its end, as after a new width or the message box; only work that comes in view moves", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  // A thread a little taller than its frame, so its end is less than the
  // overscan below its top: a glide could take the move.
  const store = longThread(6);
  let box = 40;
  const show = (mode: "visible" | "hidden") =>
    root!.render(
      <Activity mode={mode}>
        <SessionThread snapshot={store.getSnapshot()} footer={<div style={{ height: box }} />} />
      </Activity>,
    );
  show("visible");
  await expect.element(page.getByText(/^Reply 5\./)).toBeInTheDocument();
  const scroller = threadScroller();
  const log = document.querySelector<HTMLElement>('[aria-label="Session"]')!;
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  await afterFrames(30);
  const range = scroller.scrollHeight - scroller.clientHeight;
  expect(range).toBeGreaterThan(40);
  expect(range).toBeLessThan(1200);
  const glides = () => log.getAnimations().filter((animation) => animation.playState === "running");
  const rises = () => units().filter((unit) => unit.getAnimations().length > 0);
  const last = () => units().at(-1)!.getBoundingClientRect().top;

  // Hidden, as a thread in another workspace, then shown again: it is at its
  // end from the first frame, and nothing glides.
  for (let round = 0; round < 2; round++) {
    show("hidden");
    await afterFrames(3);
    show("visible");
    await nextFrame();
    const top = last();
    expect(gapOf(scroller)).toBeLessThan(32);
    for (let frame = 0; frame < 12; frame++) {
      await nextFrame();
      expect(glides()).toHaveLength(0);
      expect(Math.abs(last() - top)).toBeLessThan(0.5);
    }
  }

  // The message box grows: the end moves up with it at once, without a glide.
  box = 100;
  show("visible");
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    expect(glides()).toHaveLength(0);
  }
  expect(gapOf(scroller)).toBeLessThan(32);

  // A new width, as when a pane opens beside the thread, rewraps it: the end
  // stays in place at once, without a glide.
  mount!.style.width = "380px";
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    expect(glides()).toHaveLength(0);
    expect(gapOf(scroller)).toBeLessThan(32);
  }

  // Out of sight, as a thread that prepares to show, new work lands without
  // a glide or a rise that would end on screen.
  mount!.style.visibility = "hidden";
  store.applyAll(turnEvents(6, 1));
  show("visible");
  await expect.element(page.getByText(/^Reply 6\./)).toBeInTheDocument();
  mount!.style.visibility = "";
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    expect(glides()).toHaveLength(0);
    expect(rises()).toHaveLength(0);
  }
  expect(gapOf(scroller)).toBeLessThan(32);

  // Work that lands while the thread is hidden shows with it, still.
  show("hidden");
  store.applyAll(turnEvents(7, 1));
  show("hidden");
  await afterFrames(3);
  show("visible");
  await expect.element(page.getByText(/^Reply 7\./)).toBeInTheDocument();
  expect(gapOf(scroller)).toBeLessThan(32);
  for (let frame = 0; frame < 12; frame++) {
    await nextFrame();
    expect(glides()).toHaveLength(0);
    expect(rises()).toHaveLength(0);
  }

  // Work that comes in view rises and glides in, as before.
  store.applyAll(turnEvents(8, 1));
  show("visible");
  await expect.element(page.getByText(/^Reply 8\./)).toBeInTheDocument();
  await expect.poll(() => rises().length).toBeGreaterThan(0);
});

test("a reply that stops streaming stays until the transcript has it, so the reader's place holds", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40);
  const text = Array.from(
    { length: 24 },
    (_, index) => `Paragraph ${index}. ${"The filters run before ranking. ".repeat(4)}`,
  ).join("\n\n");
  const show = (streaming?: Streaming) =>
    root!.render(<Streamed store={store} streaming={streaming} />);
  show({ id: "m1", text: `${text}\n\nThe last one is still arr` });
  await expect.element(page.getByText(/^Paragraph 23\./)).toBeInTheDocument();
  const scroller = threadScroller();
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  // The reader moves up a little, less than the reply's height.
  for (let step = 0; step < 3; step++) await userEvent.wheel(scroller, { delta: { y: -80 } });
  await expect.element(page.getByRole("button", { name: "Latest" })).toBeVisible();
  await afterFrames(10);
  const top = scroller.scrollTop;
  const height = scroller.scrollHeight;

  // The turn ends before the transcript has the reply: it stays, with its
  // last paragraph.
  show(undefined);
  await afterFrames(10);
  expect(page.getByText(/^Paragraph 0\./).elements()).toHaveLength(1);
  await expect.element(page.getByText("The last one is still arr")).toBeInTheDocument();
  expect(scroller.scrollHeight).toBeGreaterThanOrEqual(height);
  expect(Math.abs(scroller.scrollTop - top)).toBeLessThan(1);

  // The transcript's copy takes its place, once.
  store.applyAll([
    {
      at: 90_000,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "m1",
        content: { type: "text" as const, text: `${text}\n\nThe last one is still arr` },
      },
    },
  ]);
  await afterFrames(10);
  expect(page.getByText(/^Paragraph 0\./).elements()).toHaveLength(1);
  expect(Math.abs(scroller.scrollTop - top)).toBeLessThan(1);
  await expect.element(page.getByRole("button", { name: "Latest" })).toBeVisible();
});

test("a subagent's view lets go at the reader's move up while its reply streams, and follows again at the end", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  const chunk = (at: number, text: string) => ({
    at,
    update: {
      sessionUpdate: "agent_message_chunk" as const,
      messageId: "sub",
      content: { type: "text" as const, text },
      _meta: { med: { parentToolCallId: "fetches" } },
    },
  });
  store.applyAll([
    {
      at: 0,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "Clear the cache." },
      },
    },
    {
      at: 1000,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fetches",
        title: "Find every place that fetches",
        kind: "other",
        status: "in_progress",
        _meta: { med: { tool: "Agent" } },
      },
    },
    chunk(1100, "A paragraph of the subagent's reply.\n\n".repeat(40)),
  ] as Parameters<typeof store.applyAll>[0]);
  const render = () =>
    root!.render(<SessionThread snapshot={{ ...store.getSnapshot(), running: true }} />);
  render();
  await userEvent.click(page.getByRole("tab", { name: "Find every place that fetches" }));
  const scroller = scrollerOf(
    page.getByRole("log", { name: "Find every place that fetches" }).element(),
  );
  await expect.poll(() => gapOf(scroller)).toBeLessThan(32);
  const reply = streamReply((count) => {
    store.applyAll([chunk(2000 + count, word(count))]);
    render();
  });
  try {
    await follows(scroller);
    for (let step = 0; step < 3; step++) await userEvent.wheel(scroller, { delta: { y: -8 } });
    await holds(scroller, reply);
    await userEvent.wheel(scroller, { delta: { y: 100_000 } });
    await follows(scroller);
  } finally {
    await reply.stop();
  }
});
