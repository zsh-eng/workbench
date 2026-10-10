import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
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
  scroller.scrollTop = 0;
  await userEvent.click(replay.getByRole("button", { name: "Latest" }));
  await expect.element(replay.getByRole("button", { name: "Latest" })).not.toBeInTheDocument();
  expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(32);
});

test("a long thread keeps a window of units in the page and moves it as you scroll", async () => {
  await page.viewport(1280, 900);
  initializeTheme();
  const store = createSessionStore();
  store.applyAll(
    Array.from({ length: 700 }, (_, turn) => [
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
          content: { type: "text" as const, text: `Reply ${turn}` },
        },
      },
    ]).flat(),
  );
  mount = document.createElement("div");
  mount.style.height = "600px";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<SessionThread snapshot={store.getSnapshot()} />);
  const units = () => [...document.querySelectorAll<HTMLElement>("[data-unit]")];
  const scroller = () => document.querySelector('[aria-label="Session"]')!.parentElement!;
  await expect.poll(() => units().length).toBe(300);
  expect(units().at(-1)!.dataset.unit).toBe("r699");

  // Toward the top, the window takes earlier units, up to 600, and leaves the newest out.
  for (let step = 0; step < 20 && units().at(-1)!.dataset.unit === "r699"; step++) {
    scroller().scrollTop = 0;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(units().at(-1)!.dataset.unit).not.toBe("r699");
  expect(units()).toHaveLength(600);
  expect(Number(/\d+/.exec(units()[0]!.textContent!)![0])).toBeLessThan(550);
  // The rows in view stay in view: the window grew above them.
  expect(scroller().scrollTop).toBeGreaterThan(0);

  // Latest brings back the newest work.
  await userEvent.click(page.getByRole("button", { name: "Latest" }));
  await expect.poll(() => units().at(-1)?.dataset.unit).toBe("r699");
  expect(units()).toHaveLength(300);
});
