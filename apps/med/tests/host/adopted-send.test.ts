import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState, AgentMessage, SessionPlace } from "../../src/shared/agent-inbox";
import type { OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { startHost, type RunningHost } from "../../src/host/server";
import { runReviewCommand } from "../../src/cli/review";
import {
  longProcess,
  openSession,
  processStart,
  writeProcessRecord,
} from "../fixtures/terminal-claude";
import { removeFolder } from "./remove-folder";

// A message to an adopted Claude Code session, through the production host:
// Med resumes a session that no process runs, holds a message for one that
// Claude Code runs in a terminal until that process ends, and forks it with
// Continue in Med. A fake HOME holds Claude Code's process records, and a
// fake `claude` answers.

const directories: string[] = [];
const hosts: RunningHost[] = [];
const ends: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(ends.splice(0).map((end) => end().catch(() => {})));
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const session = "7c1d2e3f-4a5b-4c6d-8e7f-901234567890";
const fakeClaude = fileURLToPath(new URL("../fixtures/agents/fake-claude.mjs", import.meta.url));
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Med",
      GIT_AUTHOR_EMAIL: "med@example.invalid",
      GIT_COMMITTER_NAME: "Med",
      GIT_COMMITTER_EMAIL: "med@example.invalid",
    },
  });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture({ heldCheckMs }: { heldCheckMs: number }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med adopted send ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const home = join(directory, "home");
  vi.stubEnv("MED_HOME_DIR", home);
  // The session that the user ran in a terminal: one prompt and its reply.
  const project = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(project, { recursive: true });
  const base = { cwd: repo, sessionId: session, timestamp: new Date().toISOString() };
  const original = join(project, `${session}.jsonl`);
  await writeFile(
    original,
    [
      {
        ...base,
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "Format the durations." },
      },
      {
        ...base,
        type: "assistant",
        uuid: "a1",
        message: {
          id: "msg_1",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "The durations read in seconds now." }],
        },
      },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join(""),
  );
  const stateDir = join(directory, "state");
  const options: Parameters<typeof startHost>[0] = {
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    heldCheckMs,
    agentAckMs: 300,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [fakeClaude],
      },
    ],
  };
  let host = await startHost(options);
  hosts.push(host);
  const restart = async () => {
    await host.close();
    hosts.splice(hosts.indexOf(host), 1);
    host = await startHost(options);
    hosts.push(host);
  };
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const adopted = await api<{ id: string }>("/api/sessions/adopt", { session });
  expect(adopted.status).toBe(200);
  const id = adopted.data.id;
  const review = async () => (await api<SavedReview>(`/api/reviews/${id}`)).data;
  const inbox = async () => (await api<AgentInboxState>(`/api/reviews/${id}/agent`)).data;
  const send = async (text: string) => {
    const sent = await api<{ message: AgentMessage; state: AgentInboxState }>(
      `/api/reviews/${id}/agent/messages`,
      { sessionId: session, text, noteIds: [] },
    );
    expect(sent.status).toBe(200);
    return sent.data;
  };
  // What the fake Claude Code got, by session: its arguments and its transcript.
  const fakeProject = join(home, ".claude", "projects", "-fake-repo");
  const started = (sessionId: string) => existsSync(join(fakeProject, `${sessionId}.args.json`));
  /** The arguments of the fake Claude Code process for a session, once it starts. */
  const args = (sessionId: string) =>
    vi.waitFor(
      async () =>
        JSON.parse(await readFile(join(fakeProject, `${sessionId}.args.json`), "utf8")) as string[],
      { timeout: 5000 },
    );
  const records = async (sessionId: string) => {
    const path = join(fakeProject, `${sessionId}.jsonl`);
    if (!existsSync(path)) return [];
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { type: string; message: { content: unknown } });
  };
  /** The prompts that a session got, as text. */
  const prompts = async (sessionId: string) =>
    (await records(sessionId))
      .filter((record) => record.type === "user")
      .map((record) => String(record.message.content));
  /** A `med review wait` that the terminal session runs. */
  const wait = async () => {
    const printed: string[] = [];
    const { key } = await review();
    await runReviewCommand(
      ["wait", "--key", key!, "--state-dir", stateDir, "--port", String(host.port)],
      {
        print: (text) => printed.push(text),
        environment: { CLAUDE_CODE_SESSION_ID: session },
        home,
      },
    );
    return printed.join("\n");
  };
  /** Claude Code with the session open, in a terminal by default. */
  const terminal = async (entrypoint?: string | null) => {
    const opened = await openSession(home, session, entrypoint);
    ends.push(opened.end);
    return opened;
  };
  /** What the inbox says of the session: where it is open, or resumable. */
  const where = async (): Promise<SessionPlace | "resumable" | object> => {
    const { elsewhere, resumable } = await inbox();
    const places = Object.keys(elsewhere);
    if (!places.length && resumable.length === 1 && resumable[0] === session) return "resumable";
    if (!resumable.length && places.length === 1 && elsewhere[session]) return elsewhere[session];
    return { elsewhere, resumable };
  };
  return {
    api,
    home,
    id,
    original,
    review,
    inbox,
    send,
    started,
    args,
    prompts,
    wait,
    terminal,
    where,
    restart,
  };
}

test("Med reads Claude Code's process records: a live process that started then runs the session; a dead or reused pid does not; a record that Med cannot read counts", async () => {
  const { home, terminal, where } = await fixture({ heldCheckMs: 60_000 });
  const records = join(home, ".claude", "sessions");
  await expect.poll(where, { timeout: 5000 }).toBe("resumable");

  // Claude Code in a terminal: the process lives and started when its record says.
  const open = await terminal();
  await expect.poll(where, { timeout: 5000 }).toBe("terminal");
  await open.end();
  await rm(records, { recursive: true });
  await expect.poll(where, { timeout: 5000 }).toBe("resumable");

  // A record whose process ended.
  const ended = await longProcess();
  const startedAt = processStart(ended.pid);
  await ended.end();
  await writeProcessRecord(home, ended.pid, {
    pid: ended.pid,
    sessionId: session,
    procStart: startedAt,
  });
  await pause(1200);
  await expect.poll(where, { timeout: 5000 }).toBe("resumable");
  await rm(records, { recursive: true });

  // The system gave the record's pid to a newer process.
  const reused = await longProcess();
  ends.push(reused.end);
  await writeProcessRecord(home, reused.pid, {
    pid: reused.pid,
    sessionId: session,
    procStart: "Thu Jan  1 00:00:00 1970",
  });
  await pause(1200);
  await expect.poll(where, { timeout: 5000 }).toBe("resumable");

  // Med cannot read a live process's record: the session may run there.
  await writeProcessRecord(home, reused.pid, "{");
  await expect.poll(where, { timeout: 5000 }).toBe("other-app");
});

test("the record's entrypoint says where the session is open: a terminal, the Claude app, or another app", async () => {
  const { home, terminal, where } = await fixture({ heldCheckMs: 60_000 });
  const records = join(home, ".claude", "sessions");
  const kinds: [entrypoint: string | null, place: SessionPlace][] = [
    ["cli", "terminal"],
    ["claude-desktop", "claude-app"],
    ["claude-desktop-3p", "claude-app"],
    ["claude-vscode", "other-app"],
    ["sdk-ts", "other-app"],
    [null, "other-app"],
  ];
  for (const [entrypoint, place] of kinds) {
    const open = await terminal(entrypoint);
    await expect.poll(where, { timeout: 5000 }).toBe(place);
    await open.end();
    await rm(records, { recursive: true });
    await expect.poll(where, { timeout: 5000 }).toBe("resumable");
  }

  // A process found only by the session ID in its arguments, without a record.
  const named = await longProcess(["claude", "--resume", session]);
  ends.push(named.end);
  await expect.poll(where, { timeout: 5000 }).toBe("other-app");
});

test("a message to an adopted session that no process runs resumes it in Med, with the messages that waited before it, in order", async () => {
  const { api, id, send, inbox, args, prompts, started, terminal, restart } = await fixture({
    heldCheckMs: 60_000,
  });
  // While the terminal runs the session, two messages wait.
  const open = await terminal();
  expect((await send("First, keep the export.")).message.delivery).toBe("pending");
  const second = await send("Second, round to minutes.");
  expect(second.message.delivery).toBe("pending");
  expect(second.state.elsewhere).toEqual({ [session]: "terminal" });
  expect(started(session)).toBe(false);

  // The terminal closed; the next message resumes the session with all three.
  await open.end();
  const third = await send("Third, check the summary.");
  expect(third.message.delivery).toBe("delivered");
  expect(third.state.messages.map((message) => message.delivery)).toEqual([
    "delivered",
    "delivered",
    "delivered",
  ]);
  expect(await args(session)).toEqual(expect.arrayContaining(["--resume", session]));
  await vi.waitFor(async () => expect(await prompts(session)).toHaveLength(1));
  expect((await prompts(session))[0]).toBe(
    "First, keep the export.\n\n---\n\nSecond, round to minutes.\n\n---\n\nThird, check the summary.",
  );
  // Med runs the session now, as one that it started.
  const owned = await api<OwnedState>(`/api/reviews/${id}/owned/${session}`);
  expect(owned.status).toBe(200);
  expect((await inbox()).resumable).toEqual([]);

  // It stays Med's after a restart: it waits for its next prompt.
  await restart();
  const back = await api<OwnedState>(`/api/reviews/${id}/owned/${session}`);
  expect(back.status).toBe(200);
  expect(back.data.status).toBe("idle");
});

test("a message waits while a terminal runs the session, and Med sends it once when the terminal closes", async () => {
  const { send, inbox, args, prompts, started, terminal } = await fixture({ heldCheckMs: 100 });
  const open = await terminal();
  const sent = await send("Use minutes.");
  expect(sent.message.delivery).toBe("pending");
  expect(sent.state.elsewhere).toEqual({ [session]: "terminal" });
  // Med checks the process while the message waits; it does not start a second one.
  await pause(500);
  expect(started(session)).toBe(false);
  expect((await inbox()).messages.map((message) => message.delivery)).toEqual(["pending"]);

  await open.end();
  await vi.waitFor(
    async () =>
      expect((await inbox()).messages.map((message) => message.delivery)).toEqual(["delivered"]),
    { timeout: 5000 },
  );
  expect(await args(session)).toEqual(expect.arrayContaining(["--resume", session]));
  await vi.waitFor(async () => expect(await prompts(session)).toEqual(["Use minutes."]));
  // Later checks find nothing to send.
  await pause(500);
  expect(await prompts(session)).toEqual(["Use minutes."]);
});

test("med review wait in the terminal takes a waiting message first, and Med does not send it again", async () => {
  const { send, inbox, wait, started, terminal } = await fixture({ heldCheckMs: 100 });
  const open = await terminal();
  expect((await send("Rename it.")).message.delivery).toBe("pending");
  expect(await wait()).toContain("Rename it.");
  expect((await inbox()).messages.map((message) => message.delivery)).toEqual(["delivered"]);
  // This session takes messages with med review wait: the composer does not
  // say that Med cannot type there.
  expect((await inbox()).elsewhere).toEqual({});

  await open.end();
  await pause(600);
  expect(started(session)).toBe(false);
  expect((await inbox()).messages.map((message) => message.delivery)).toEqual(["delivered"]);
});

test("Continue in Med forks the session; the thread follows the fork, and the waiting messages go to it", async () => {
  const { api, id, original, send, inbox, review, args, prompts, started, terminal } =
    await fixture({
      heldCheckMs: 60_000,
    });
  const open = await terminal();
  expect((await send("Try the other format.")).message.delivery).toBe("pending");
  const before = await readFile(original, "utf8");

  const continued = await api<{ review: SavedReview; state: OwnedState }>(
    `/api/reviews/${id}/owned`,
    { preset: "claude", fork: session },
  );
  expect(continued.status).toBe(200);
  const fork = continued.data.state.sessionId;
  expect(fork).not.toBe(session);
  // The thread lists the fork after the original, so the fork leads.
  expect(continued.data.review.sessions?.map((entry) => entry.id)).toEqual([session, fork]);
  expect((await review()).sessions?.at(-1)?.id).toBe(fork);
  expect(await args(fork)).toEqual(
    expect.arrayContaining(["--resume", session, "--fork-session", "--session-id", fork]),
  );
  // The fork starts from the session's history, with the message as its prompt.
  await vi.waitFor(async () =>
    expect(await prompts(fork)).toEqual(["Format the durations.", "Try the other format."]),
  );
  expect((await inbox()).messages).toMatchObject([
    { sessionId: fork, text: "Try the other format.", delivery: "delivered" },
  ]);
  // The terminal keeps its session as it was.
  expect(await readFile(original, "utf8")).toBe(before);
  expect(started(session)).toBe(false);
  expect((await inbox()).elsewhere).toEqual({ [session]: "terminal" });
  await open.end();
});
