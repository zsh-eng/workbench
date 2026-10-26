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
const schedules = (missing = false): Schedules => ({
  sessions: [
    {
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
      state: "live",
      fires: 1,
      lastFiredAt: Date.now() - HOUR,
      runs: "med",
    },
    {
      kind: "cron",
      id: "77aa0001",
      threadId,
      threadTitle: "Station search",
      sessionId: "s1",
      schedule: "Weekdays at 09:03",
      cron: "3 9 * * 1-5",
      recurring: true,
      prompt: "Summarize yesterday's CI failures.",
      createdAt: Date.now() - 3 * HOUR,
      state: "stopped",
      fires: 0,
    },
    {
      kind: "cron",
      id: "9d03b7e1",
      threadId,
      threadTitle: "Station search",
      sessionId: "s1",
      schedule: "Oct 26 at 17:50",
      cron: "50 17 26 10 *",
      recurring: false,
      prompt: "Ask Mira to review #101 if nobody has.",
      createdAt: Date.now() - 3 * HOUR,
      state: "cancelled",
      fires: 0,
    },
  ],
  desktop: {
    folder: "/home/me/.claude/scheduled-tasks",
    missing,
    tasks: missing
      ? []
      : [
          {
            name: "morning-triage",
            description: "Triage new issues each weekday morning",
            prompt: "Read the new issues and label each one.",
            path: "/home/me/.claude/scheduled-tasks/morning-triage/SKILL.md",
            updatedAt: Date.now(),
          },
        ],
  },
});

test("the Scheduled list shows each job's thread, schedule, prompt, and whether it fires", async () => {
  await page.viewport(1280, 900);
  const reads: string[] = [];
  let missing = false;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input), "http://localhost");
    reads.push(url.pathname);
    return Response.json(schedules(missing));
  };
  const opened: string[] = [];
  render(<ScheduledSection fetcher={fetcher} onOpenThread={(id) => opened.push(id)} />);
  // Closed, it reads nothing.
  const toggle = page.getByRole("button", { name: "Scheduled" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  expect(reads).toEqual([]);
  await userEvent.click(toggle);

  const live = page.getByRole("button", { name: /^Every hour at :23/ });
  await expect.element(live).toBeVisible();
  await expect.element(live.getByText("Live")).toBeVisible();
  await expect.element(live.getByText(/Station search · recurring · ran /)).toBeVisible();
  await expect.element(live.getByText("Runs in Med · ends with its session")).toBeVisible();
  // A job of a session that ended says plainly that it won't fire.
  const stopped = page.getByRole("button", { name: /^Weekdays at 09:03/ });
  await expect
    .element(stopped.getByText("Won't fire: its session ended · comes back if the session resumes"))
    .toBeVisible();
  const ended = page.getByRole("button", { name: /^Oct 26 at 17:50/ });
  await expect.element(ended.getByText("Cancelled with CronDelete")).toBeVisible();
  // The Claude app's tasks, which the app runs.
  await expect.element(page.getByText("morning-triage")).toBeVisible();
  await expect.element(page.getByText("Triage new issues each weekday morning")).toBeVisible();
  // Two jobs can fire, and one task.
  await expect
    .element(page.getByRole("button", { name: "Scheduled 3", exact: true }))
    .toBeVisible();

  await userEvent.click(live);
  expect(opened).toEqual([threadId]);
  // Nothing in the list runs, edits, or deletes a schedule: it only reads.
  expect(new Set(reads)).toEqual(new Set(["/api/schedules"]));
  expect(
    [...document.querySelectorAll("[data-scheduled] button")].map((button) =>
      button.textContent?.trim(),
    ),
  ).not.toContain("Delete");

  // Without the app's folder, the list says that the app made none.
  root!.unmount();
  mount!.remove();
  missing = true;
  render(<ScheduledSection fetcher={fetcher} onOpenThread={() => {}} />);
  await expect
    .element(page.getByText("No scheduled tasks: the Claude app has made none on this computer."))
    .toBeVisible();
});
