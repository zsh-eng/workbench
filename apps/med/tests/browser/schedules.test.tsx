import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { readClaudeTranscript } from "../../src/shared/agent-session-claude";
import type { Schedules } from "../../src/shared/schedules";
import { ScheduledSection } from "../../src/web/components/shell/ScheduledSection";
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

test("schedule calls are cards: the schedule in words, the prompt, and what became of each", async () => {
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

  // A CronDelete cancels the one-shot job, whose card says so.
  const oneShot = page.getByRole("group", { name: /^Oct 26 at 17:50/ });
  await expect.element(oneShot.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect.element(oneShot.getByText(/Ends with its session/)).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("group", { name: /^Cancelled: Oct 26 at 17:50/ }))
    .toBeVisible();
  const wakeup = page.getByRole("group", { name: /^Wakes up in 20 minutes/ });
  await expect.element(wakeup.getByText(/One-shot · watching CI/)).toBeVisible();

  // The job's fire starts a turn that no one typed.
  const run = document.querySelector("[data-scheduled-run]");
  expect(run?.textContent).toContain("A scheduled prompt ran");
  expect(run?.textContent).toContain(RECURRING_PROMPT);
  expect(document.querySelectorAll("[data-schedule-card]")).toHaveLength(4);
});

const threadId = `r_${"a".repeat(24)}`;
const live: Schedules["sessions"][number] = {
  kind: "cron",
  id: "4c1e9a20",
  threadId,
  threadTitle: "Station search",
  sessionId: "s1",
  schedule: "Every hour at :23",
  cron: "23 * * * *",
  recurring: true,
  prompt: RECURRING_PROMPT,
  createdAt: Date.now() - 2 * HOUR,
  endsAt: Date.now() + 6 * 24 * HOUR,
  fires: 1,
  lastFiredAt: Date.now() - HOUR,
  runs: "med",
};

test("the Scheduled list shows only the jobs that will fire, and no section when none will", async () => {
  await page.viewport(1280, 900);
  const reads: string[] = [];
  let sessions: Schedules["sessions"] = [live];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    reads.push(url.pathname);
    return Response.json({ sessions } satisfies Schedules);
  };
  const opened: string[] = [];
  render(<ScheduledSection fetcher={fetcher} onOpenThread={(id) => opened.push(id)} />);
  // Closed, it still reads, to show whether a job will fire.
  const toggle = page.getByRole("button", { name: "Scheduled 1", exact: true });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);

  const job = page.getByRole("button", { name: /^Every hour at :23/ });
  await expect.element(job).toBeVisible();
  await expect.element(job.getByText(/Station search · recurring · ran /)).toBeVisible();
  await expect.element(job.getByText("Runs in Med · ends with its session")).toBeVisible();
  // What will not fire stays in its thread's cards.
  const section = page.getByRole("region", { name: "Scheduled" });
  for (const gone of ["Ended", "Claude app", "Live", "Stopped"])
    await expect.element(section.getByText(gone, { exact: true })).not.toBeInTheDocument();
  await userEvent.click(job);
  expect(opened).toEqual([threadId]);
  // Nothing in the list runs, edits, or deletes a schedule: it only reads.
  expect(new Set(reads)).toEqual(new Set(["/api/schedules"]));
  expect(
    [...document.querySelectorAll("[data-scheduled] button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).not.toContain("Delete");

  // When nothing will fire, there is no section at all.
  root!.unmount();
  mount!.remove();
  sessions = [];
  const before = reads.length;
  render(<ScheduledSection fetcher={fetcher} onOpenThread={() => {}} />);
  await expect.poll(() => reads.length).toBeGreaterThan(before);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(document.querySelector("[data-scheduled]")).toBeNull();
  expect(document.body.textContent).not.toContain("Scheduled");
});
