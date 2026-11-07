import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { readClaudeTranscript } from "../../src/shared/agent-session-claude";
import { SessionThread } from "../../src/web/components/session/SessionThread";
import { createSessionStore } from "../../src/web/data/session-store";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";
import { RECURRING_PROMPT, scheduleTranscript } from "../fixtures/schedule-transcript";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  localStorage.removeItem("med:sidebar-scheduled");
});

function render(node: React.ReactNode) {
  initializeTheme();
  mount = document.createElement("div");
  mount.style.cssText = "width: 760px; height: 900px; display: flex; flex-direction: column;";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(node);
}

const HOUR = 60 * 60_000;

test("schedule calls are cards, one for each schedule: the schedule in words, the prompt, and what became of it", async () => {
  await page.viewport(1280, 900);
  const startedAt = Date.now() - 2 * HOUR;
  const store = createSessionStore();
  store.applyAll(readClaudeTranscript(scheduleTranscript("s1", startedAt, 1)));
  render(<SessionThread snapshot={store.getSnapshot()} />);

  // The turn's work folds; its schedules stay in view.
  await expect.element(page.getByRole("button", { name: /Worked for/ }).first()).toBeVisible();
  const recurring = page.getByRole("group", { name: /^Every hour at :23/ });
  await expect.element(recurring).toBeVisible();
  await expect.element(recurring.getByText(RECURRING_PROMPT)).toBeVisible();
  // It ran once, expires 7 days after it was made, and dies with its session.
  await expect
    .element(recurring.getByText(/Recurring · expires in 6 days · ran once/))
    .toBeVisible();
  await expect.element(recurring.getByText(/Ends with its session/)).toBeVisible();

  // A CronDelete cancels the one-shot job: its card says so, and the cancel
  // is no card of its own.
  const oneShot = page.getByRole("group", { name: /^Oct 26 at 17:50/ });
  await expect.element(oneShot.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect.element(oneShot.getByText(/Ends with its session/)).not.toBeInTheDocument();
  expect(page.getByRole("group", { name: /^Cancelled/ }).query()).toBeNull();
  const wakeup = page.getByRole("group", { name: /^Wakes up in 20 minutes/ });
  await expect.element(wakeup.getByText(/One-shot · watching CI/)).toBeVisible();

  // The job's fire starts a turn that no one typed.
  const run = document.querySelector("[data-scheduled-run]");
  expect(run?.textContent).toContain("A scheduled prompt ran");
  expect(run?.textContent).toContain(RECURRING_PROMPT);
  expect(document.querySelectorAll("[data-schedule-card]")).toHaveLength(3);
  // The cancel folds with the turn's work; shown, it is a row that names the job.
  expect(document.querySelector("[data-schedule-cancel]")).toBeNull();
  root!.render(<SessionThread snapshot={store.getSnapshot()} showWork />);
  await expect
    .poll(() => document.querySelector("[data-schedule-cancel]")?.textContent)
    .toBe("Cancelled Oct 26 at 17:50");
  expect(document.querySelectorAll("[data-schedule-card]")).toHaveLength(3);
});
