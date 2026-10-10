import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { SessionSection } from "../../src/web/components/elements/SessionSection";
import { SessionThread } from "../../src/web/components/session/SessionThread";
import { createSessionStore } from "../../src/web/data/session-store";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});

async function setup() {
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

test("the replay plays a recorded session into the thread and stops when paused", async () => {
  const replay = await setup();
  // The page opens on the whole session.
  await expect.element(replay.getByText(/Worked for \d+s · 13 tool calls/)).toBeVisible();

  await userEvent.click(replay.getByRole("button", { name: "Play" }));
  await userEvent.click(replay.getByRole("button", { name: "16×" }));
  // From the start, only the prompt is there; the agent's work follows.
  await expect.element(replay.getByText(/^Working|^Thinking/)).toBeVisible();
  await expect
    .element(replay.getByText("Edited", { exact: false }), { timeout: 8000 })
    .toBeVisible();
  await userEvent.click(replay.getByRole("button", { name: "Pause" }));
  const position = replay.getByRole("slider", { name: "Position" });
  const paused = (position.element() as HTMLInputElement).value;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect((position.element() as HTMLInputElement).value).toBe(paused);

  await userEvent.click(replay.getByRole("button", { name: "Play" }));
  await expect.element(replay.getByText(/Worked for \d+s/), { timeout: 10000 }).toBeVisible();
  await expect.element(replay.getByText("summary.ts:5", { exact: true })).toBeVisible();
  // Rows that fold into a group make the thread shorter; the view still followed to the end.
  await expect.element(replay.getByRole("button", { name: "Latest" })).not.toBeInTheDocument();
});

test("a tool call opens to show its command and output", async () => {
  const replay = await setup();
  const row = replay.getByRole("button", { name: /Run the test suite/ });
  await expect.element(row).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(row);
  await expect.element(row).toHaveAttribute("aria-expanded", "true");
  await expect.element(replay.getByText("7 pass", { exact: false })).toBeVisible();
});

test("the sample thread shows a plan, a failed test, and a subagent's own steps", async () => {
  await setup();
  const gallery = page.getByRole("figure").filter({ hasText: "Every part" });
  await expect
    .element(gallery.getByRole("region", { name: "Tasks" }).getByText("1 of 4"))
    .toBeVisible();
  // The dev server runs in the background; its address comes from its output.
  const background = gallery.getByRole("region", { name: "Background tasks" });
  await expect.element(background.getByText("1 running")).toBeVisible();
  await expect
    .element(background.getByRole("link", { name: "localhost:5173" }))
    .toHaveAttribute("href", "http://localhost:5173");
  await expect
    .element(gallery.getByRole("button", { name: /Run the branch tests.*Failed/ }))
    .toBeVisible();
  await userEvent.click(
    gallery.getByRole("log").getByRole("button", { name: /Find every place that fetches/ }),
  );
  await expect.element(gallery.getByText(/Two paths fetch/)).toBeVisible();
});

test("scrolling up stops following, and Latest returns to the newest item", async () => {
  const replay = await setup();
  const scroller = replay.getByRole("log").element().parentElement!;
  await expect
    .poll(() => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight)
    .toBeLessThan(32);
  await userEvent.wheel(scroller, { delta: { y: -100000 } });
  await userEvent.click(replay.getByRole("button", { name: "Latest" }));
  await expect.element(replay.getByRole("button", { name: "Latest" })).not.toBeInTheDocument();
  expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(32);
});

/** A thread of prompts and replies, in a frame of 600 pixels. */
function longThread(turns: number, first = 0) {
  const store = createSessionStore();
  store.applyAll(turnEvents(first, turns));
  mount = document.createElement("div");
  mount.style.height = "600px";
  mount.style.width = "520px";
  document.body.append(mount);
  root = createRoot(mount);
  return store;
}
function turnEvents(first: number, count: number) {
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
const units = () => [...document.querySelectorAll<HTMLElement>("[data-unit]")];
const threadScroller = () => document.querySelector('[aria-label="Session"]')!.parentElement!;
/** The first unit whose bottom is in view, and its top in the frame. */
function firstInView() {
  const frame = threadScroller().getBoundingClientRect();
  const unit = units().find((element) => element.getBoundingClientRect().bottom > frame.top + 1)!;
  return {
    key: unit.dataset.unit!,
    text: unit.textContent!,
    top: unit.getBoundingClientRect().top - frame.top,
  };
}
const topOf = (key: string) =>
  document.querySelector(`[data-unit="${key}"]`)!.getBoundingClientRect().top -
  threadScroller().getBoundingClientRect().top;

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
  render(true, true);
  const before = firstInView();

  // A page of 300 turns arrives above the view.
  store.prepend(turnEvents(0, 300));
  render(false);
  resolve();
  await expect.poll(() => units()[0]?.textContent?.includes("Prompt 300")).toBe(false);
  expect(before.text).toContain("Prompt 300");
  expect(Math.abs(topOf(before.key) - before.top)).toBeLessThan(2);
  // The thread holds the earlier work's space above the view.
  expect(scroller.scrollTop).toBeGreaterThan(2000);
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
  root!.render(<SessionThread snapshot={store.getSnapshot()} />);
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
  await new Promise((resolve) => setTimeout(resolve, 200));
  // It stays there as the units around it take their own heights.
  expect(firstInView().text).toContain("Prompt 120");
  expect(Math.abs(firstInView().top)).toBeLessThan(2);
});

test("an edit shows its file and line counts, and its diff when the reader opens it", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = createSessionStore();
  store.applyAll(
    Array.from({ length: 80 }, (_, turn) => ({
      at: turn * 1000,
      update: {
        sessionUpdate: "tool_call" as const,
        toolCallId: `edit-${turn}`,
        title: `Edit file-${turn}.ts`,
        kind: "edit" as const,
        status: "completed" as const,
        content: [
          {
            type: "diff" as const,
            path: `/repo/file-${turn}.ts`,
            oldText: `export const value = ${turn};\n`,
            newText: `export const value = ${turn + 1};\nexport const next = ${turn + 2};\n`,
          },
        ],
      },
    })),
  );
  mount = document.createElement("div");
  mount.style.height = "600px";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<SessionThread snapshot={store.getSnapshot()} />);
  const row = () => document.querySelector<HTMLButtonElement>('[data-unit="edit-79"] button')!;
  await expect.poll(() => row()?.textContent).toContain("file-79.ts");
  expect(row().textContent).toContain("+2");
  expect(row().textContent).toContain("−1");
  expect(row().getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector("[data-unit] figure")).toBeNull();

  await userEvent.click(row());
  await expect.poll(() => document.querySelector('[data-unit="edit-79"] figure')).not.toBeNull();
  expect(document.querySelectorAll("[data-unit] figure")).toHaveLength(1);
});
