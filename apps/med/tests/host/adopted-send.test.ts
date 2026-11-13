import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState, AgentMessage, SessionPlace } from "../../src/shared/agent-inbox";
import type { OwnedState, SessionForked } from "../../src/shared/owned-session";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { ThreadList } from "../../src/shared/threads";
import { claudeProjectFolder } from "../../src/host/session-index";
import { startHost, type RunningHost } from "../../src/host/server";
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

/** The session that the user ran in a terminal: one prompt and its reply. */
const ONE_TURN = [
  { type: "user", uuid: "u1", message: { role: "user", content: "Format the durations." } },
  {
    type: "assistant",
    uuid: "a1",
    message: {
      id: "msg_1",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The durations read in seconds now." }],
    },
  },
];
/** Two turns, each reply with the model and effort that Claude Code wrote. */
const TWO_TURNS = [
  ONE_TURN[0]!,
  { ...ONE_TURN[1]!, requestedModel: "claude-opus-5-5", effort: "high" },
  { type: "user", uuid: "u2", message: { role: "user", content: "Round them to minutes." } },
  {
    type: "assistant",
    uuid: "a2",
    requestedModel: "claude-haiku-5-5",
    effort: "low",
    message: {
      id: "msg_2",
      role: "assistant",
      model: "claude-haiku-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "They round to minutes." }],
    },
  },
];

async function fixture(history: object[] = ONE_TURN) {
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
  // The session that the user ran in a terminal.
  const project = join(home, ".claude", "projects", claudeProjectFolder(repo));
  await mkdir(project, { recursive: true });
  const base = { cwd: repo, sessionId: session, timestamp: new Date().toISOString() };
  const original = join(project, `${session}.jsonl`);
  await writeFile(
    original,
    history.map((line) => `${JSON.stringify({ ...base, ...line })}\n`).join(""),
  );
  const stateDir = join(directory, "state");
  const options: Parameters<typeof startHost>[0] = {
    repo,
    repos: [repo],
    stateDir,
    port: 0,
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
  // The thread is the session's.
  const id = adopted.data.id;
  expect(id).toBe(`claude-${session}`);
  /** The tabs, by ID. */
  const tabs = async () =>
    new Map((await api<ThreadList>("/api/threads")).data.threads.map((each) => [each.id, each]));
  const inbox = async () => (await api<AgentInboxState>(`/api/sessions/${id}/agent`)).data;
  /** Sends a message to a session's thread: this one's, or a fork's. */
  const send = async (text: string, sessionId = session) => {
    const sent = await api<{ message: AgentMessage; state: AgentInboxState }>(
      `/api/sessions/claude-${sessionId}/agent/messages`,
      { text, noteIds: [] },
    );
    expect(sent.status).toBe(200);
    return sent.data;
  };
  /** A message that Med refuses, with its error. */
  const refused = async (text: string) =>
    api<{ error: { code: string; message: string } }>(`/api/sessions/${id}/agent/messages`, {
      text,
      noteIds: [],
    });
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
    tabs,
    inbox,
    send,
    refused,
    started,
    args,
    prompts,
    terminal,
    where,
    restart,
  };
}

test("Med reads Claude Code's process records: a live process that started then runs the session; a dead or reused pid does not; a record that Med cannot read counts", async () => {
  const { home, terminal, where } = await fixture();
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
  const { home, terminal, where } = await fixture();
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

test("Med does not send to a session that a terminal has open; once it closes, a message resumes the session in Med", async () => {
  const { api, id, send, refused, inbox, args, prompts, started, terminal, restart } =
    await fixture();
  // While the terminal runs the session, Med sends nothing and keeps nothing.
  const open = await terminal();
  const blocked = await refused("Round to minutes.");
  expect(blocked.status).toBe(409);
  expect(blocked.data.error.code).toBe("session-elsewhere");
  expect((await inbox()).messages).toEqual([]);
  expect((await inbox()).elsewhere).toEqual({ [session]: "terminal" });
  expect(started(session)).toBe(false);

  // The terminal closed: the next message resumes the session.
  await open.end();
  const sent = await send("Check the summary.");
  expect(sent.message.delivery).toBe("delivered");
  expect(await args(session)).toEqual(expect.arrayContaining(["--resume", session]));
  await vi.waitFor(async () => expect(await prompts(session)).toEqual(["Check the summary."]));
  // Med runs the session now, as one that it started.
  const owned = await api<OwnedState>(`/api/sessions/${id}/owned`);
  expect(owned.status).toBe(200);
  expect((await inbox()).resumable).toEqual([]);

  // It stays Med's after a restart: it waits for its next prompt.
  await restart();
  const back = await api<OwnedState>(`/api/sessions/${id}/owned`);
  expect(back.status).toBe(200);
  expect(back.data.status).toBe("idle");
});

test("Continue in Med forks the session; the thread follows the fork, which takes the next message", async () => {
  const { api, id, original, send, tabs, args, prompts, started, terminal } = await fixture();
  const open = await terminal();
  const before = await readFile(original, "utf8");
  expect((await api(`/api/threads/${id}/name`, { name: "Durations" })).status).toBe(200);

  const continued = await api<{ thread: string; state: OwnedState }>(
    `/api/sessions/${id}/continue`,
    {},
  );
  expect(continued.status).toBe(200);
  const fork = continued.data.state.sessionId;
  expect(fork).not.toBe(session);
  // The fork's thread takes the session's place, with its name.
  expect(continued.data.thread).toBe(`claude-${fork}`);
  expect((await tabs()).get(`claude-${fork}`)).toMatchObject({
    title: "Durations",
    session: { agent: "claude", id: fork },
  });
  const forkArgs = await args(fork);
  expect(forkArgs).toEqual(
    expect.arrayContaining(["--resume", session, "--fork-session", "--session-id", fork]),
  );
  // The fork starts in Auto, as a new session does, and its settings say so.
  expect(forkArgs[forkArgs.indexOf("--permission-mode") + 1]).toBe("auto");
  await expect
    .poll(
      async () =>
        (await api<OwnedState>(`/api/sessions/claude-${fork}/owned`)).data.settings.find(
          (setting) => setting.category === "mode",
        )?.value,
    )
    .toBe("auto");
  // The fork starts from the session's history and takes the next message.
  expect((await send("Try the other format.", fork)).message.delivery).toBe("delivered");
  await vi.waitFor(async () =>
    expect(await prompts(fork)).toEqual(["Format the durations.", "Try the other format."]),
  );
  // The terminal keeps its session as it was.
  expect(await readFile(original, "utf8")).toBe(before);
  expect(started(session)).toBe(false);
  await open.end();
});

/** The text of a session's first view, from its events stream. */
async function firstView(port: number, token: string, thread: string) {
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${port}/api/sessions/${thread}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const reset = /event: reset\ndata: (.*)\n\n/.exec(text);
      if (!reset) continue;
      const events = (JSON.parse(reset[1]!) as { events: SessionEvent[] }).events;
      return events.flatMap(({ update }) =>
        (update.sessionUpdate === "user_message_chunk" ||
          update.sessionUpdate === "agent_message_chunk") &&
        update.content.type === "text"
          ? [update.content.text]
          : [],
      );
    }
  } finally {
    controller.abort();
  }
  return [];
}

test("Fork from here makes a thread whose session starts from the history up to a reply, with that reply's model and effort, in Auto", async () => {
  const { api, id, original, tabs, args, prompts, started, restart } = await fixture(TWO_TURNS);
  const before = await readFile(original, "utf8");
  const forked = await api<SessionForked>(`/api/sessions/${id}/fork`, { at: "a1" });
  expect(forked.status).toBe(200);
  expect(forked.data.title).toMatch(/ \(fork\)$/);
  // The fork is a thread of its own: its session's.
  const fork = (await tabs()).get(forked.data.id)!.session!.id;
  expect(forked.data.id).toBe(`claude-${fork}`);
  expect(fork).not.toBe(session);
  const forkArgs = await args(fork);
  expect(forkArgs).toEqual(
    expect.arrayContaining(["--resume", session, "--fork-session", "--session-id", fork]),
  );
  // The history ends at the reply, whose model and effort the fork takes.
  expect(forkArgs[forkArgs.indexOf("--resume-session-at") + 1]).toBe("a1");
  expect(forkArgs[forkArgs.indexOf("--model") + 1]).toBe("claude-opus-5-5");
  expect(forkArgs[forkArgs.indexOf("--effort") + 1]).toBe("high");
  // Its mode is Auto, as a new session's.
  expect(forkArgs[forkArgs.indexOf("--permission-mode") + 1]).toBe("auto");
  // The message box shows them, also a model that Claude Code does not list,
  // once the fork's agent has answered.
  const read = async () => (await api<OwnedState>(`/api/sessions/${forked.data.id}/owned`)).data;
  await expect
    .poll(
      async () => (await read()).settings.find((setting) => setting.category === "model")?.value,
    )
    .toBe("claude-opus-5-5");
  const owned = await read();
  const model = owned.settings.find((setting) => setting.category === "model");
  expect(model?.value).toBe("claude-opus-5-5");
  expect(model?.options.map((option) => option.value)).toContain("claude-opus-5-5");
  expect(owned.settings.find((setting) => setting.category === "effort")?.value).toBe("high");
  const modeOf = (state: OwnedState) =>
    state.settings.find((setting) => setting.category === "mode")?.value;
  expect(modeOf(owned)).toBe("auto");

  // Before its first prompt, the thread shows the history it starts from.
  const host = hosts.at(-1)!;
  expect(await firstView(host.port, host.token, forked.data.id)).toEqual([
    "Format the durations.",
    "The durations read in seconds now.",
  ]);

  // Its first message goes on from the reply, not from the turn after it.
  const sent = await api<{ message: AgentMessage }>(
    `/api/sessions/${forked.data.id}/agent/messages`,
    { text: "Show them as a table.", noteIds: [] },
  );
  expect(sent.data.message.delivery).toBe("delivered");
  await vi.waitFor(async () =>
    expect(await prompts(fork)).toEqual(["Format the durations.", "Show them as a table."]),
  );
  // The thread it forks stays as it is.
  expect(await readFile(original, "utf8")).toBe(before);
  expect(started(session)).toBe(false);
  expect((await tabs()).get(id)?.session?.id).toBe(session);
  // A message that the transcript does not have forks nothing.
  const missing = await api<{ error: { code: string } }>(`/api/sessions/${id}/fork`, {
    at: "no-such-message",
  });
  expect(missing.status).toBe(404);
  expect(missing.data.error.code).toBe("message-not-found");
  // Med's record of the fork holds the mode: it is the same after a restart.
  await restart();
  await expect.poll(async () => modeOf(await read())).toBe("auto");
});

test("a kept session resumes with its last reply's model and effort, and Continue in Med forks with them", async () => {
  const { api, id, send, args, terminal } = await fixture(TWO_TURNS);
  const open = await terminal();
  // Continue in Med: the fork reads the session's prompt cache with its model.
  const continued = await api<{ thread: string; state: OwnedState }>(
    `/api/sessions/${id}/continue`,
    {},
  );
  const fork = continued.data.state.sessionId;
  const forkArgs = await args(fork);
  expect(forkArgs).not.toContain("--resume-session-at");
  expect(forkArgs[forkArgs.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
  expect(forkArgs[forkArgs.indexOf("--effort") + 1]).toBe("low");
  await open.end();

  // Once the terminal closes, a message resumes the session itself, as it ran.
  expect((await send("Check the summary.")).message.delivery).toBe("delivered");
  const resumed = await args(session);
  expect(resumed[resumed.indexOf("--model") + 1]).toBe("claude-haiku-5-5");
  expect(resumed[resumed.indexOf("--effort") + 1]).toBe("low");
  const owned = (await api<OwnedState>(`/api/sessions/claude-${session}/owned`)).data;
  expect(owned.settings.find((setting) => setting.category === "model")?.value).toBe(
    "claude-haiku-5-5",
  );
});
