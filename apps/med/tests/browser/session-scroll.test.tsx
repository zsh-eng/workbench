import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { flushSync } from "react-dom";
import { SessionThread } from "../../src/web/components/session/SessionThread";
import { estimateUnit, readMetrics } from "../../src/web/components/session/thread-heights";
import { finalReplies, units as unitsOf } from "../../src/web/components/session/thread-model";
import "../../src/web/pierre-theme";
import { initializeTheme, THEME_STORAGE_KEY } from "../../src/web/themes";
import {
  afterFrames,
  cleanUp,
  firstInView,
  LINE_CHARACTERS,
  longThread,
  mount,
  root,
  scrollerOf,
  setup,
  threadScroller,
  topLine,
  topOf,
  turnEvents,
  units,
} from "./session-fixture";

afterEach(cleanUp);

test("scrolling up stops following, and Latest returns to the newest item", async () => {
  const replay = await setup();
  // The thread shows once its replies have their Markdown.
  await expect.element(replay.getByRole("log")).toBeVisible();
  const scroller = scrollerOf(replay.getByRole("log").element());
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);
  await userEvent.wheel(scroller, { delta: { y: -100000 } });
  await userEvent.click(replay.getByRole("button", { name: "Latest" }));
  await expect.element(replay.getByRole("button", { name: "Latest" })).not.toBeInTheDocument();
  expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(32);
});

test("a long thread renders only the units near the view", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(700);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r699");
  const scroller = threadScroller();
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);
  expect(units().length).toBeLessThan(120);

  // The view goes to the start of the thread, and the newest units leave the page.
  for (let step = 0; step < 40 && !units()[0]?.textContent?.includes("Prompt 0"); step++) {
    await userEvent.wheel(scroller, { delta: { y: -20000 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  expect(units()[0]!.textContent).toContain("Prompt 0");
  expect(units().length).toBeLessThan(120);
  expect(document.querySelector('[data-unit="r699"]')).toBeNull();

  // Latest brings back the newest work.
  await userEvent.click(page.getByRole("button", { name: "Latest" }));
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r699");
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);
});

test("a reply taller than the overscan does not move the range on each scroll", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  const tall = Array.from({ length: 150 }, (_, n) => `Paragraph ${n} of a long reply.`);
  store.applyAll([
    ...turnEvents(0, 20),
    {
      at: 20_500,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "tall",
        content: { type: "text" as const, text: tall.join("\n\n") },
      },
    },
    ...turnEvents(21, 20),
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r40");
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Each commit that adds or removes units is one move of the range.
  let moves = 0;
  const watch = new MutationObserver((records) => {
    const nodes = records.flatMap((record) => [...record.addedNodes, ...record.removedNodes]);
    if (nodes.some((node) => node instanceof HTMLElement && node.dataset.unit)) moves++;
  });
  watch.observe(document.querySelector('[aria-label="Session"]')!, { childList: true });
  const scroller = threadScroller();
  for (let step = 0; step < 80; step++) {
    scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -50 }));
    scroller.scrollTop -= 50;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  watch.disconnect();
  expect(document.querySelector('[data-unit="tall"]')).not.toBeNull();
  // 4,000 px up, past the end of the tall reply: the range moves about every 400 px.
  expect(moves).toBeLessThan(12);
});

test.each(["med-dawn", "paper-light"])(
  "a reply with a heading, a list, code, and a table of long paths has the height that the thread estimates for it (%s)",
  async (theme) => {
    await page.viewport(1280, 900);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    initializeTheme();
    const store = longThread(0);
    const table = [
      "## The checks",
      "",
      "- The thread's text is a step under the documents', with `code` at their ratio.",
      "- Each reply keeps its estimate.",
      "",
      "```ts",
      "export const width = 768;",
      "export const size = 14.5;",
      "```",
      "",
      "| Check | Where | Result |",
      "| --- | --- | --- |",
      "| `./gradlew :telemetry:histogram-core-internal:test` | `src/web/components/session/thread-heights.ts:359` | 18 tests pass across the three JVM targets |",
      "| `bun run test test/metrics.test.ts` | `registry.timer(bucketName())` | 1 passed |",
    ].join("\n");
    store.applyAll([
      {
        at: 0,
        update: {
          sessionUpdate: "user_message_chunk" as const,
          content: { type: "text" as const, text: "Run the checks." },
        },
      },
      {
        at: 500,
        update: {
          sessionUpdate: "agent_message_chunk" as const,
          messageId: "r-table",
          content: { type: "text" as const, text: table },
        },
      },
    ]);
    root!.render(<SessionThread snapshot={store.getSnapshot()} />);
    await expect.poll(() => document.querySelector("[data-unit] table wbr")).not.toBeNull();
    const element = document
      .querySelector("[data-unit] table")!
      .closest<HTMLElement>("[data-unit]")!;
    // A step under the documents' 15 pixels, scaled as Paper scales them.
    const text = Number.parseFloat(getComputedStyle(element.querySelector("p, li")!).fontSize);
    expect(text).toBeCloseTo(theme === "paper-light" ? (14.5 * 14) / 15 : 14.5, 2);
    const probe = document.querySelector('[data-probe="unit"]')!.parentElement!;
    const list = unitsOf(store.getSnapshot().items);
    const unit = list.find((entry) => entry.key === element.dataset.unit)!;
    const final = "item" in unit && finalReplies(list, false).has(unit.item.id);
    // The cells break their long words where the renderer lets them.
    await expect
      .poll(() =>
        Math.abs(
          estimateUnit(unit, readMetrics(probe), { final }) -
            element.getBoundingClientRect().height,
        ),
      )
      .toBeLessThanOrEqual(1);
  },
);

test("a thread that arrives in batches still renders only the units near the view", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  // A frame taller than the newest units that render before the thread has a size.
  mount!.style.height = "1600px";
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  // The stream adds the newest work in parts, as a long tail does.
  for (const [first, count] of [
    [0, 150],
    [150, 150],
    [300, 300],
  ]) {
    store.applyAll(turnEvents(first!, count!));
    root!.render(<SessionThread snapshot={store.getSnapshot()} />);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r599");
  expect(units().length).toBeLessThan(120);
});

test("a diagram turned at the end of a thread stays where the reader turned it", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(8);
  store.applyAll([
    {
      at: 20_000,
      update: {
        sessionUpdate: "user_message_chunk" as const,
        content: { type: "text" as const, text: "Draw it" },
      },
    },
    {
      at: 21_000,
      update: {
        sessionUpdate: "agent_message_chunk" as const,
        messageId: "drawn",
        content: {
          type: "text" as const,
          text: "The flow:\n\n```mermaid\nflowchart LR\n  A --> B --> C\n```\n\nThat is all.",
        },
      },
    },
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  const diagram = page.getByRole("img", { name: "Mermaid diagram" });
  await expect.element(diagram).toBeVisible();
  const scroller = threadScroller();
  // The view follows the end, where the diagram is.
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);
  // Once the reply has settled: it glides up into view as it lands.
  let last = Number.NaN;
  await expect
    .poll(async () => {
      await afterFrames(3);
      const top = diagram.element().getBoundingClientRect().top;
      const still = top === last;
      last = top;
      return still;
    })
    .toBe(true);
  const before = diagram.element().getBoundingClientRect();
  await userEvent.click(page.getByRole("button", { name: "Turn the diagram" }));
  // Taller now, it grows down from where it was, under the reader's pointer.
  await expect
    .poll(() => diagram.element().getBoundingClientRect().height)
    .toBeGreaterThan(before.height * 1.5);
  await afterFrames(2);
  expect(Math.abs(diagram.element().getBoundingClientRect().top - before.top)).toBeLessThan(2);
});

test("the units in view keep their place as earlier work loads above them", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40, 300);
  let loads = 0;
  let resolve = () => {};
  const render = (more: boolean, loading = false) =>
    root!.render(
      <SessionThread
        snapshot={store.getSnapshot()}
        earlier={
          more
            ? {
                loading,
                load: () => {
                  loads++;
                  return new Promise<void>((done) => (resolve = done));
                },
              }
            : undefined
        }
      />,
    );
  render(true);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r339");
  const scroller = threadScroller();
  await userEvent.wheel(scroller, { delta: { y: -100000 } });
  await expect.poll(() => loads).toBe(1);
  // The wheel's scroll ends at the top before the page arrives.
  await expect.poll(() => scroller.scrollTop).toBe(0);
  render(true, true);
  const before = firstInView();

  // A page of 300 turns arrives above the view.
  store.prepend(turnEvents(0, 300));
  render(false);
  resolve();
  await expect.poll(() => units()[0]?.textContent?.includes("Prompt 300")).toBe(false);
  expect(before.text).toContain("Prompt 300");
  // The replies in view show their Markdown, so the thread has settled.
  await expect.poll(() => document.querySelector("[data-unit] .med-session-plain")).toBeNull();
  expect(Math.abs(topOf(before.key) - before.top)).toBeLessThan(2);
  // The thread holds the earlier work's space above the view.
  expect(scroller.scrollTop).toBeGreaterThan(2000);
});

test("a new width keeps the units in view still as heights above them change", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  // Long replies above the view take a new height; the short ones in it do not wrap.
  store.applyAll(
    turnEvents(0, 200).map((event, index) =>
      index >= 300 && event.update.sessionUpdate === "agent_message_chunk"
        ? { ...event, update: { ...event.update, content: { type: "text" as const, text: "Ok." } } }
        : event,
    ),
  );
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r199");
  const scroller = threadScroller();
  await expect
    .poll(() => document.querySelector("[data-unit] .med-session-plain"), { timeout: 5000 })
    .toBeNull();
  scroller.scrollTop -= 900;
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  // Where the frame painted: after its paint, not before its resize callbacks.
  const painted = () =>
    new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      requestAnimationFrame(() => channel.port2.postMessage(0));
    });
  for (let at = 0; at < 30; at++) await frame();
  const key = firstInView().key;
  const link = document.querySelector(`[data-unit="${key}"]`)!;
  const positions = new Set<number>();
  mount!.style.width = "500px";
  for (let at = 0; at < 40; at++) {
    await painted();
    positions.add(Number(topOf(key).toFixed(3)));
  }
  expect(link.isConnected).toBe(true);
  expect([...positions]).toHaveLength(1);
});

test("a new width keeps the text at the view's top in a reply taller than the view", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(0);
  // Every reply runs many paragraphs, so the view sits inside one.
  const paragraphs = (turn: number) =>
    Array.from(
      { length: 30 },
      (_, at) =>
        `Paragraph ${turn}.${at}. ${"The reader is in the middle of this reply and keeps reading it. ".repeat(2 + (at % 4))}`,
    ).join("\n\n");
  store.applyAll(
    turnEvents(0, 12).map((event) =>
      event.update.sessionUpdate === "agent_message_chunk"
        ? {
            ...event,
            update: {
              ...event.update,
              content: { type: "text" as const, text: paragraphs(event.at / 1000 - 0.5) },
            },
          }
        : event,
    ),
  );
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r11");
  const scroller = threadScroller();
  await expect
    .poll(() => document.querySelector("[data-unit] .med-session-plain"), { timeout: 5000 })
    .toBeNull();
  // The view goes 900 pixels into a reply in the middle, and settles there:
  // the replies in view show their Markdown.
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
  scroller.scrollTop = scroller.scrollHeight / 2;
  await afterFrames(10);
  const reply = units().find((element) => element.dataset.unit?.startsWith("r"))!;
  scroller.scrollTop +=
    reply.getBoundingClientRect().top - scroller.getBoundingClientRect().top + 900;
  const paragraph = () => topLine(scroller);
  const settled = async () => {
    await expect
      .poll(() => scroller.querySelector("[data-unit] .med-session-plain"), { timeout: 5000 })
      .toBeNull();
    await afterFrames(20);
  };
  await settled();
  const before = paragraph();
  // The view is well inside the reply, and inside a paragraph.
  expect(reply.isConnected).toBe(true);
  expect(reply.getBoundingClientRect().top).toBeLessThan(
    scroller.getBoundingClientRect().top - 300,
  );
  for (const width of ["900px", "420px", "520px"]) {
    mount!.style.width = width;
    await settled();
    const after = paragraph();
    expect(after.text).toBe(before.text);
    expect(Math.abs(after.offset - before.offset)).toBeLessThan(LINE_CHARACTERS);
  }
});

test("an update that renders during the reader's scroll does not pull the view back", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(200);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r199");
  const scroller = threadScroller();
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);

  // The reader scrolls up, and new work renders before the scroll event comes.
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1000, bubbles: true }));
  scroller.scrollTop = 2000;
  store.applyAll(turnEvents(200, 1));
  flushSync(() => root!.render(<SessionThread snapshot={store.getSnapshot()} />));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(Math.abs(scroller.scrollTop - 2000)).toBeLessThan(100);
  await expect.element(page.getByRole("button", { name: "Latest" })).toBeVisible();
});

test("a row keeps its state when it leaves the view and comes back", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(200);
  store.applyAll([
    {
      at: 300_000,
      update: {
        sessionUpdate: "tool_call" as const,
        toolCallId: "run-tests",
        title: "Run the tests",
        kind: "execute" as const,
        status: "completed" as const,
        rawInput: { command: "bun test" },
        content: [{ type: "content", content: { type: "text", text: "12 pass" } }],
      },
    },
  ]);
  root!.render(<SessionThread snapshot={store.getSnapshot()} showWork />);
  const call = page.getByRole("button", { name: /Run the tests/ });
  await userEvent.click(call);
  await expect.element(page.getByText("12 pass")).toBeVisible();

  const scroller = threadScroller();
  for (let step = 0; step < 40 && document.querySelector('[data-unit="run-tests"]'); step++) {
    await userEvent.wheel(scroller, { delta: { y: -20000 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  expect(document.querySelector('[data-unit="run-tests"]')).toBeNull();
  await userEvent.click(page.getByRole("button", { name: "Latest" }));
  await expect.element(page.getByText("12 pass")).toBeVisible();
});

test("a scroll event that comes before the units report a new height keeps the view's place", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(300);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r299");
  const scroller = threadScroller();
  // The reader scrolls up, at once rather than with the wheel's glide.
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -1500, bubbles: true }));
  scroller.scrollTop -= 1500;
  await expect.poll(() => document.querySelector("[data-unit] .med-session-plain")).toBeNull();
  // The view stands still before it is read.
  for (let last = Number.NaN; scroller.scrollTop !== last; ) {
    last = scroller.scrollTop;
    await afterFrames(3);
  }
  const before = firstInView();
  // A unit above the view grows, as when its reply's Markdown renders, and a
  // scroll event comes before the units report it, as the event for a scroll
  // that the view wrote itself can.
  const top = scroller.getBoundingClientRect().top;
  const above = units().findLast((unit) => unit.getBoundingClientRect().bottom < top)!;
  (above.firstElementChild as HTMLElement).style.paddingTop = "40px";
  scroller.dispatchEvent(new Event("scroll"));
  await afterFrames(4);
  expect(Math.abs(topOf(before.key) - before.top)).toBeLessThan(2);
});

test("a turn from the index goes to the top of the view", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(300);
  const prompt = store
    .getSnapshot()
    .items.find(
      (item) =>
        item.kind === "user" &&
        item.content.some((block) => block.type === "text" && block.text === "Prompt 120"),
    )!;
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r299");
  root!.render(
    <SessionThread snapshot={store.getSnapshot()} reveal={{ id: prompt.id, nonce: 1 }} />,
  );
  await expect.poll(() => firstInView().text).toContain("Prompt 120");
  // It stays there as the units around it take their own heights, which
  // they have once their replies show Markdown.
  await expect.poll(() => document.querySelector("[data-unit] .med-session-plain")).toBeNull();
  await afterFrames(4);
  expect(firstInView().text).toContain("Prompt 120");
  expect(Math.abs(firstInView().top)).toBeLessThan(2);
});

test("selecting or double-clicking text at the bottom does not flicker the Latest button", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = longThread(40);
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r39");
  const scroller = threadScroller();
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);

  const lastReply = page.getByText("Reply 39.", { exact: false }).element();
  scroller.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true }));
  const range = document.createRange();
  range.selectNodeContents(lastReply);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  document.dispatchEvent(new PointerEvent("pointerup", { button: 0, bubbles: true }));
  await afterFrames(4);
  expect(page.getByRole("button", { name: "Latest" }).query()).toBeNull();
  selection.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
});
