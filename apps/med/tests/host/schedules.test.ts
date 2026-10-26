import { afterEach, expect, test } from "vitest";
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSchedules } from "../../src/host/schedules";
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

test("the Scheduled list has only the jobs that will fire: a running session's live ones", async () => {
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
  // No process runs the session: none of its jobs can fire.
  expect((await schedules.list(threads)).sessions).toEqual([]);
  expect(asked).toEqual([[session]]);

  // The process runs in Med now, and the job fires again: the read goes on
  // from where it stopped.
  running = new Map([[session, "med"]]);
  await appendFile(
    transcript,
    scheduleTranscript(session, started, 2).split("\n").slice(-3).join("\n"),
  );
  const list = await schedules.list(threads);
  // The cancelled one-shot and the wakeup whose time passed are left out.
  expect(list.sessions).toHaveLength(1);
  const cron = list.sessions[0]!;
  expect(cron).toMatchObject({
    kind: "cron",
    id: "4c1e9a20",
    threadId: thread.id,
    threadTitle: "Station search",
    schedule: "Every hour at :23",
    recurring: true,
    prompt: RECURRING_PROMPT,
    fires: 2,
    runs: "med",
  });
  expect(cron.endsAt).toBe(cron.createdAt + 7 * 24 * HOUR);
  expect(list.sessions.map((entry) => entry.prompt)).not.toContain(ONE_SHOT_PROMPT);
  // Only Claude Code sessions of tabs count.
  expect(
    (await schedules.list([{ ...thread, sessions: [{ agent: "codex", id: session }] }])).sessions,
  ).toEqual([]);
});

test("a wakeup that is still to come is listed; a recurring job past its 7 days is not", async () => {
  const { home, transcript } = await world();
  const schedules = createSchedules({
    home: () => home,
    running: async () => new Map([[session, "terminal" as const]]),
  });
  const threads = [{ ...thread, sessions: [{ agent: "claude", id: session }] }];
  // The wakeup was set 4 minutes after the start, for 20 minutes.
  await writeFile(transcript, scheduleTranscript(session, Date.now() - 10 * 60_000, 0));
  expect((await schedules.list(threads)).sessions.map((entry) => entry.schedule)).toEqual([
    "In 14 minutes",
    "Every hour at :23",
  ]);

  await writeFile(transcript, scheduleTranscript(session, Date.now() - 8 * 24 * HOUR, 0));
  const fresh = createSchedules({
    home: () => home,
    running: async () => new Map([[session, "terminal" as const]]),
  });
  expect((await fresh.list(threads)).sessions).toEqual([]);
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
