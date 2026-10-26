import { afterEach, expect, test } from "vitest";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedules, readDesktopTasks } from "../../src/host/schedules";
import { describeCron } from "../../src/shared/schedules";
import {
  ONE_SHOT_PROMPT,
  RECURRING_PROMPT,
  scheduleTranscript,
} from "../fixtures/schedule-transcript";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
});

const HOUR = 60 * 60_000;
const session = "11111111-2222-4333-8444-555555555555";

async function world() {
  const home = await mkdtemp(join(tmpdir(), "med-schedules-"));
  directories.push(home);
  const transcript = join(home, ".claude", "projects", "-code-tide", `${session}.jsonl`);
  await mkdir(join(home, ".claude", "projects", "-code-tide"), { recursive: true });
  return { home, transcript };
}

const thread = { id: `r_${"a".repeat(24)}`, title: "Station search" };

test("the Scheduled list reads each tab's jobs from its transcript, with their state", async () => {
  const { home, transcript } = await world();
  const started = Date.now() - 2 * HOUR;
  await writeFile(transcript, scheduleTranscript(session, started, 1));
  let running = new Map<string, "med">();
  const asked: string[][] = [];
  const schedules = createSchedules({
    home: () => home,
    running: async (ids) => {
      asked.push([...ids]);
      return running;
    },
  });
  const threads = [{ ...thread, sessions: [{ agent: "claude", id: session }] }];
  const first = await schedules.list(threads);
  const cron = first.sessions.find((entry) => entry.id === "4c1e9a20")!;
  expect(cron).toMatchObject({
    kind: "cron",
    threadId: thread.id,
    threadTitle: "Station search",
    schedule: "Every hour at :23",
    recurring: true,
    prompt: RECURRING_PROMPT,
    fires: 1,
    // Its session's process does not run: it won't fire until the session resumes.
    state: "stopped",
  });
  expect(cron.endsAt).toBe(cron.createdAt + 7 * 24 * HOUR);
  expect(first.sessions.find((entry) => entry.id === "9d03b7e1")).toMatchObject({
    prompt: ONE_SHOT_PROMPT,
    recurring: false,
    state: "cancelled",
  });
  // The wakeup's time passed and no prompt of its ran.
  expect(first.sessions.find((entry) => entry.kind === "wakeup")).toMatchObject({
    state: "missed",
    prompt: "/loop watch the stack's CI",
  });
  expect(asked).toEqual([[session]]);

  // The process runs in Med now, and the job fires again: the read goes on
  // from where it stopped.
  running = new Map([[session, "med"]]);
  await appendFile(
    transcript,
    scheduleTranscript(session, started, 2).split("\n").slice(-3).join("\n"),
  );
  const second = await schedules.list(threads);
  expect(second.sessions.find((entry) => entry.id === "4c1e9a20")).toMatchObject({
    state: "live",
    runs: "med",
    fires: 2,
  });
  // Only Claude Code sessions of tabs count.
  expect(
    (await schedules.list([{ ...thread, sessions: [{ agent: "codex", id: session }] }])).sessions,
  ).toEqual([]);
});

test("a recurring job past its 7 days is expired", async () => {
  const { home, transcript } = await world();
  await writeFile(transcript, scheduleTranscript(session, Date.now() - 8 * 24 * HOUR, 0));
  const schedules = createSchedules({ home: () => home, running: async () => new Map() });
  const list = await schedules.list([{ ...thread, sessions: [{ agent: "claude", id: session }] }]);
  expect(list.sessions.find((entry) => entry.id === "4c1e9a20")?.state).toBe("expired");
});

test("desktop scheduled tasks come from SKILL.md files, and a missing folder is none", async () => {
  const { home } = await world();
  const folder = join(home, ".claude", "scheduled-tasks");
  expect(await readDesktopTasks(folder)).toEqual({ folder, missing: true, tasks: [] });
  await mkdir(join(folder, "morning-triage"), { recursive: true });
  await writeFile(
    join(folder, "morning-triage", "SKILL.md"),
    "---\nname: morning-triage\ndescription: Triage new issues each weekday morning\n---\n\nRead the new issues and label each one.\n",
  );
  // A folder without a SKILL.md is not a task.
  await mkdir(join(folder, "draft"));
  const schedules = createSchedules({
    home: () => home,
    configDir: () => join(home, ".claude"),
    running: async () => new Map(),
  });
  const list = await schedules.list([]);
  expect(list.desktop).toMatchObject({
    folder,
    missing: false,
    tasks: [
      {
        name: "morning-triage",
        description: "Triage new issues each weekday morning",
        prompt: "Read the new issues and label each one.",
        path: join(folder, "morning-triage", "SKILL.md"),
      },
    ],
  });
});

test("cron expressions read as words", () => {
  expect(describeCron("* * * * *")).toBe("Every minute");
  expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
  expect(describeCron("23 * * * *")).toBe("Every hour at :23");
  expect(describeCron("7 */2 * * *")).toBe("Every 2 hours at :07");
  expect(describeCron("57 8 * * *")).toBe("Every day at 08:57");
  expect(describeCron("3 9 * * 1-5")).toBe("Weekdays at 09:03");
  expect(describeCron("0 10 * * 1")).toBe("Mondays at 10:00");
  expect(describeCron("50 17 26 10 *")).toBe("Oct 26 at 17:50");
  expect(describeCron("0 9 1,15 * *")).toBe("0 9 1,15 * *");
});
