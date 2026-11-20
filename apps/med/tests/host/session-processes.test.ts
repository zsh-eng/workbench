import { afterEach, expect, test } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionProcesses, sessionsNamed } from "../../src/host/session-processes";
import {
  longProcess,
  openSession,
  processStart,
  writeProcessRecord,
} from "../fixtures/terminal-claude";
import { removeFolder } from "./remove-folder";

// Where another process has a Claude Code session open, from the records
// that Claude Code keeps in `~/.claude/sessions` and the processes that run.
// A fake HOME holds the records; the processes are real. The host's inbox
// shows these answers (adopted-send.test.ts).

const directories: string[] = [];
const ends: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(ends.splice(0).map((end) => end().catch(() => {})));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
});

const session = "7c1d2e3f-4a5b-4c6d-8e7f-901234567890";

async function fixture() {
  const home = await realpath(await mkdtemp(join(tmpdir(), "med session processes ")));
  directories.push(home);
  const processes = createSessionProcesses({ home: () => home });
  /** Where the session is open, or undefined when no other process has it. */
  const where = async (id = session) => (await processes.elsewhere([id])).get(id);
  /** Claude Code with a session open, in a terminal by default. */
  const terminal = async (entrypoint?: string | null, id = session) => {
    const opened = await openSession(home, id, entrypoint);
    ends.push(opened.end);
    return opened;
  };
  return { home, where, terminal, records: join(home, ".claude", "sessions") };
}

test("a live process that started when its record says runs the session; a dead or reused pid does not; a record that Med cannot read counts", async () => {
  const { home, where, terminal, records } = await fixture();
  expect(await where()).toBeUndefined();

  // Claude Code in a terminal: the process lives and started when its record says.
  const open = await terminal();
  expect(await where()).toBe("terminal");
  await open.end();
  await rm(records, { recursive: true });
  expect(await where()).toBeUndefined();

  // A record whose process ended.
  const ended = await longProcess();
  const startedAt = processStart(ended.pid);
  await ended.end();
  await writeProcessRecord(home, ended.pid, {
    pid: ended.pid,
    sessionId: session,
    procStart: startedAt,
  });
  expect(await where()).toBeUndefined();
  await rm(records, { recursive: true });

  // The system gave the record's pid to a newer process.
  const reused = await longProcess();
  ends.push(reused.end);
  await writeProcessRecord(home, reused.pid, {
    pid: reused.pid,
    sessionId: session,
    procStart: "Thu Jan  1 00:00:00 1970",
  });
  expect(await where()).toBeUndefined();

  // Med cannot read a live process's record: the session may run there.
  await writeProcessRecord(home, reused.pid, "{");
  expect(await where()).toBe("other-app");
});

test("the record's entrypoint says where the session is open: a terminal, the Claude app, or another app", async () => {
  const { where, terminal } = await fixture();
  const kinds: [entrypoint: string | null, place: string][] = [
    ["cli", "terminal"],
    ["claude-desktop", "claude-app"],
    ["claude-desktop-3p", "claude-app"],
    ["claude-vscode", "other-app"],
    ["sdk-ts", "other-app"],
    [null, "other-app"],
  ];
  // One session per entrypoint, open at once.
  const ids = kinds.map((_, index) => session.replace(/0$/, String(index + 1)));
  await Promise.all(kinds.map(([entrypoint], index) => terminal(entrypoint, ids[index])));
  expect(await Promise.all(ids.map((id) => where(id)))).toEqual(kinds.map(([, place]) => place));

  // A process found only by the session ID in its arguments, without a record:
  // one that waits on the session runs no part of it.
  const waits = await longProcess(["med", "thread", "wait", `claude-${session}`]);
  ends.push(waits.end);
  expect(await where()).toBeUndefined();
  const named = await longProcess(["claude", "--resume", session]);
  ends.push(named.end);
  expect(await where()).toBe("other-app");
});

test("a process's arguments start a session by a session flag before its ID or joined to it", () => {
  expect(sessionsNamed(`claude --resume ${session} -p`)).toEqual([session]);
  expect(sessionsNamed(`claude -r ${session}`)).toEqual([session]);
  expect(sessionsNamed(`node cli.js --session-id=${session}`)).toEqual([session]);
  expect(sessionsNamed(`med thread wait claude-${session}`)).toEqual([]);
  expect(sessionsNamed(`claude --resume`)).toEqual([]);
});
