import { afterEach, expect, test, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState } from "../../src/shared/agent-inbox";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { Thread, ThreadList } from "../../src/shared/threads";
import type { AgentOptions, OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { runAgentsCommand } from "../../src/cli/agents";
import { readServerEvents } from "../../src/web/data/sse";

/** A one-pixel PNG, in base64. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const agentScript = (name: string) =>
  fileURLToPath(new URL(`../fixtures/agents/${name}`, import.meta.url));

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med owned sessions ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const stateDir = join(directory, "state");
  const options: Parameters<typeof startHost>[0] = {
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    heldCheckMs: 100,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-claude.mjs")],
      },
      {
        id: "fake",
        name: "Fake ACP",
        kind: "acp",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-acp.mjs")],
      },
      { id: "missing", name: "Missing", kind: "acp", available: false, command: "x", args: [] },
    ],
  };
  let host = await startHost(options);
  hosts.push(host);
  /** Closes the host and starts it again on the same state, as a restart
   * does. With `reboot`, the agents and their holders end too, as when the
   * Mac restarts. */
  const restart = async ({ reboot = false } = {}) => {
    await host.close();
    hosts.splice(hosts.indexOf(host), 1);
    if (reboot) {
      const agents = join(stateDir, "agents");
      for (const name of await readdir(agents).catch(() => [] as string[])) {
        if (!name.endsWith(".json")) continue;
        const info = JSON.parse(await readFile(join(agents, name), "utf8")) as {
          pid: number;
          agentPid?: number;
        };
        for (const pid of [info.pid, info.agentPid]) if (pid) process.kill(pid, "SIGKILL");
        await vi.waitFor(() => {
          for (const pid of [info.pid, info.agentPid]) if (pid && alive(pid)) throw new Error();
        });
      }
    }
    host = await startHost(options);
    hosts.push(host);
    return host;
  };
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const review = (
    await api<SavedReview>("/api/reviews", {
      title: "Format durations",
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).data;
  /** The session's thread, as the browser reads it. */
  const thread = async (sessionId: string) => {
    const response = await fetch(
      `http://127.0.0.1:${host.port}/api/reviews/${review.id}/sessions/${sessionId}/events`,
      { headers: { authorization: `Bearer ${host.token}` } },
    );
    expect(response.status).toBe(200);
    const events: SessionEvent[] = [];
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => {
        const payload = JSON.parse(event.data) as { events: SessionEvent[] };
        if (event.event === "reset") events.length = 0;
        events.push(...payload.events);
      },
      controller.signal,
      4 * 1024 * 1024,
    ).catch(() => {});
    return () =>
      events.flatMap((event) =>
        event.update.sessionUpdate === "agent_message_chunk" && event.update.content.type === "text"
          ? [event.update.content.text]
          : [],
      );
  };
  const start = async (preset: string, choices?: { model?: string; effort?: string }) => {
    const started = await api<{ review: SavedReview; state: OwnedState }>(
      `/api/reviews/${review.id}/owned`,
      { preset, choices },
    );
    expect(started.status).toBe(200);
    const id = started.data.state.sessionId;
    const path = `/api/reviews/${review.id}/owned/${id}`;
    const state = async () => (await api<OwnedState>(path)).data;
    const until = (check: (state: OwnedState) => boolean) =>
      vi.waitFor(
        async () => {
          const value = await state();
          if (!check(value)) throw new Error(`Not yet: ${JSON.stringify(value)}`);
          return value;
        },
        { timeout: 5000 },
      );
    const act = (action: unknown) => api<OwnedState>(path, action);
    /** The states that the host streams to the page, from now on. */
    const follow = async () => {
      const seen: OwnedState[] = [];
      const response = await fetch(`http://127.0.0.1:${host.port}${path}/events`, {
        headers: { authorization: `Bearer ${host.token}` },
      });
      const controller = new AbortController();
      streams.push(controller);
      void readServerEvents(
        response.body!,
        (event) => seen.push(JSON.parse(event.data) as OwnedState),
        controller.signal,
      ).catch(() => {});
      return seen;
    };
    return { id, review: started.data.review, state, until, act, follow };
  };
  /** The thread list's stream, with each thread's lead session state. */
  const threads = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const latest: { value: Thread[] } = { value: [] };
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => (latest.value = (JSON.parse(event.data) as ThreadList).threads),
      controller.signal,
    ).catch(() => {});
    return latest;
  };
  return { api, repo, home, review, stateDir, thread, start, threads, restart };
}

test("Med starts Claude Code, sends review messages as prompts, and answers its questions", async () => {
  // A host that a Claude Code session started has the session's variables,
  // such as its bare mode; Claude Code that Med starts uses the user's login.
  vi.stubEnv("CLAUDE_CODE_SIMPLE", "1");
  const { api, review, stateDir, thread, start } = await fixture();
  const agents = await api<{ agents: unknown[] }>("/api/agents");
  expect(agents.data.agents).toEqual([
    { id: "claude", name: "Claude Code", kind: "claude", available: true },
    { id: "fake", name: "Fake ACP", kind: "acp", available: true },
    { id: "missing", name: "Missing", kind: "acp", available: false },
  ]);
  expect((await api(`/api/reviews/${review.id}/owned`, { preset: "missing" })).status).toBe(404);

  // Before a session starts, Claude Code tells its models and efforts; Med
  // chooses Opus at medium effort.
  const choices = await api<AgentOptions>("/api/agents/claude/choices");
  expect(choices.data).toMatchObject({
    model: {
      value: "opus",
      options: [{ value: "default" }, { value: "opus" }, { value: "haiku" }],
    },
    effort: { value: "medium" },
    efforts: { default: ["low", "high"], opus: ["low", "medium", "high"], haiku: [] },
  });

  const session = await start("claude");
  expect(session.review.sessions).toMatchObject([{ agent: "claude", id: session.id }]);
  const ready = await session.until(
    (state) => state.status === "idle" && state.settings.length > 0,
  );
  expect(ready.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "opus"],
    ["effort", "medium"],
    ["mode", "default"],
  ]);
  // Built-in commands have GUI controls; the `/` menu lists the others.
  expect(ready.commands).toEqual([{ name: "review", description: "Review the current changes" }]);
  // Claude Code names the signed-in account; Med keeps none of it.
  expect(JSON.stringify(ready)).not.toContain("example.invalid");

  // The thread waits for the transcript, which the first turn writes.
  const replies = await thread(session.id);
  const sent = await api<{ message: { delivery: string } }>(
    `/api/reviews/${review.id}/agent/messages`,
    { sessionId: session.id, text: "Format the durations.", noteIds: [] },
  );
  expect(sent.data.message.delivery).toBe("delivered");
  await vi.waitFor(() =>
    expect(replies()).toEqual(["Model opus, effort medium, mode default: Format the durations."]),
  );
  const answered = await session.until((state) => state.context !== undefined);
  expect(answered.context).toEqual({ used: 2500, total: 10_000 });

  // An effort change starts Claude Code again with the same session.
  expect((await session.act({ action: "setting", id: "effort", value: "high" })).status).toBe(200);
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Check the summary." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Model opus, effort high, mode default: Check the summary."),
  );
  // A model change applies at once. Haiku has no effort levels, so the picker goes.
  const haiku = await session.act({ action: "setting", id: "model", value: "haiku" });
  expect(haiku.data.settings.map((setting) => setting.id)).toEqual(["model", "mode"]);
  await session.act({ action: "setting", id: "mode", value: "plan" });
  await session.act({ action: "prompt", text: "Plan it." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Model haiku, effort high, mode plan: Plan it."),
  );

  // A tool call waits for the user's answer in the review.
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked.permission).toMatchObject({
    title: "Claude Code wants to use Edit",
    detail: "summary.ts",
    options: [{ id: "allow" }, { id: "always" }, { id: "deny" }],
  });
  await session.act({ action: "permission", id: asked.permission!.id, option: "always" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Edited summary.ts and kept the rule."));

  // Stop ends a turn; the session stays.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");

  // Images go with the message, as image blocks before its text.
  await api(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Why does this differ?",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Saw base64 image/png: Why does this differ?"),
  );

  await session.act({ action: "stop" });
  expect((await session.act({ action: "prompt", text: "Again." })).status).toBe(409);
  // A session that Med does not run reads text: the message names a saved copy.
  const stopped = await api(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Compare with this.",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  expect(stopped.status).toBe(200);
  const waited = await api<{ message: string }>(`/api/reviews/${review.id}/agent/wait`, {
    session: session.id,
    timeout: 1000,
  });
  const path = /^- (\/.+\.png)$/m.exec(waited.data.message)?.[1];
  expect(waited.data.message).toContain("Compare with this.");
  expect(path?.startsWith(join(stateDir, "images"))).toBe(true);
  expect((await readFile(path!)).toString("base64")).toBe(PNG);
});

test("agents keep working through a host restart; after a reboot, Claude Code resumes and others stay stopped", async () => {
  const { api, home, review, thread, start, restart } = await fixture();
  const kept = await start("claude");
  await kept.until((state) => state.status === "idle" && state.settings.length > 0);
  await kept.act({ action: "setting", id: "effort", value: "high" });
  await kept.until((state) => state.status === "idle");
  await kept.act({ action: "setting", id: "mode", value: "plan" });
  await kept.act({ action: "prompt", text: "Format the durations." });
  const replies = await thread(kept.id);
  await vi.waitFor(() =>
    expect(replies()).toEqual(["Model opus, effort high, mode plan: Format the durations."]),
  );
  const ended = await start("claude");
  await ended.until((state) => state.status === "idle");
  await ended.act({ action: "stop" });
  const acp = await start("fake");
  await acp.until((state) => state.status === "idle");

  // A restart leaves the agents in their holders: each goes on where it was.
  await restart();
  const project = join(home, ".claude", "projects", "-fake-repo");
  const started = async () =>
    JSON.parse(await readFile(join(project, `${kept.id}.args.json`), "utf8")) as string[];
  const before = await started();
  expect((await kept.state()).settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "opus"],
    ["effort", "high"],
    ["mode", "plan"],
  ]);
  const after = await thread(kept.id);
  await kept.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() =>
    expect(after().at(-1)).toBe("Model opus, effort high, mode plan: Still here?"),
  );
  expect(await started()).toEqual(before);
  const acpReplies = await thread(acp.id);
  await acp.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() => expect(acpReplies().at(-1)).toBe("(small, build) Still here?"));
  expect((await ended.state()).status).toBe("exited");

  const host = await restart({ reboot: true });
  // Claude Code waits without a process, with the choices it had.
  const back = await kept.until((state) => state.settings.length === 3);
  expect(back.status).toBe("idle");
  expect(back.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "opus"],
    ["effort", "high"],
    ["mode", "plan"],
  ]);
  // The user stopped one, and an ACP agent cannot resume: both stay stopped.
  expect((await ended.state()).status).toBe("exited");
  expect((await acp.state()).status).toBe("exited");

  // While another Claude Code process runs the session, as in a terminal,
  // Med does not start a second one: the message waits for that process to
  // end. A process that names the session in its arguments counts; without
  // its record, Med does not know where it is open.
  const send = (text: string) =>
    api<{ message: { delivery: string; error?: string }; state: AgentInboxState }>(
      `/api/reviews/${review.id}/agent/messages`,
      { sessionId: kept.id, text, noteIds: [] },
    );
  const other = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)", "claude", kept.id]);
  const exited = once(other, "exit");
  await once(other, "spawn");
  const busy = await send("Are you there?");
  expect(busy.data.message).toMatchObject({ delivery: "pending" });
  expect(busy.data.state.elsewhere).toEqual({ [kept.id]: "other-app" });

  // When it ends, Med resumes the session in a new process, on the new port.
  const again = await thread(kept.id);
  other.kill();
  await exited;
  await vi.waitFor(
    () => expect(again().at(-1)).toBe("Model opus, effort high, mode plan: Are you there?"),
    { timeout: 5000 },
  );
  await kept.until((state) => state.status === "idle");
  expect((await send("Check the summary.")).data.message.delivery).toBe("delivered");
  await vi.waitFor(() =>
    expect(again().at(-1)).toBe("Model opus, effort high, mode plan: Check the summary."),
  );
  const args = await started();
  expect(args).toEqual(expect.arrayContaining(["--resume", kept.id, "--effort", "high"]));
  const env = JSON.parse(await readFile(join(project, `${kept.id}.env.json`), "utf8"));
  expect(env.MED_PORT).toBe(String(host.port));
});

test("a turn goes on through a host restart; one that a reboot cuts waits as Interrupted: Continue asks the agent to go on, and Dismiss clears it", async () => {
  const { review, thread, start, threads, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");

  await restart();
  expect(await session.state()).toMatchObject({ status: "working" });
  expect((await session.state()).halt).toBeUndefined();

  await restart({ reboot: true });
  // Nothing runs by itself: the turn waits for the reader.
  const cut = await session.until((state) => state.halt !== undefined);
  expect(cut).toMatchObject({ status: "idle", halt: { kind: "interrupted" } });
  const latest = await threads();
  await vi.waitFor(() =>
    expect(latest.value.find((entry) => entry.id === review.id)).toMatchObject({
      state: "idle",
      halt: { kind: "interrupted" },
    }),
  );

  const replies = await thread(session.id);
  await session.act({ action: "continue" });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toMatch(/: Your last turn stopped before it ended/),
  );
  expect((await session.until((state) => state.status === "idle")).halt).toBeUndefined();

  // A second cut turn, dismissed: it does not come back after a restart.
  await session.act({ action: "prompt", text: "Wait for the deploy." });
  await session.until((state) => state.status === "working");
  await restart({ reboot: true });
  await session.until((state) => state.halt?.kind === "interrupted");
  await session.act({ action: "dismiss" });
  expect((await session.state()).halt).toBeUndefined();
  await restart();
  const back = await session.until((state) => state.settings.length > 0);
  expect(back.halt).toBeUndefined();
});

test("med agents lists the agents that keep working; one that it stops resumes with the next message, and one whose holder dies waits as Interrupted", async () => {
  const { stateDir, thread, start } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const printed: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((text) => void printed.push(String(text)));
  const agents = async (...args: string[]) => {
    printed.length = 0;
    await runAgentsCommand([...args, "--state-dir", stateDir]);
    return [...printed];
  };
  try {
    expect(await agents()).toEqual([
      expect.stringMatching(new RegExp(`^${session.id.slice(0, 8)}  Claude Code  0 min  /`)),
    ]);
    expect(await agents("stop", session.id.slice(0, 8))).toEqual(["Stopped 1 agent."]);
    expect(await agents()).toEqual(["No agents run."]);
  } finally {
    log.mockRestore();
  }
  // Without a mark: the next message resumes the session.
  expect((await session.state()).halt).toBeUndefined();
  const replies = await thread(session.id);
  await session.act({ action: "prompt", text: "Are you back?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/));
  await session.until((state) => state.status === "idle");

  // A holder that dies, as in a crash of the Mac, cuts the turn that ran.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  const info = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  process.kill(info.pid, "SIGKILL");
  expect(await session.until((state) => state.halt !== undefined)).toMatchObject({
    status: "idle",
    halt: { kind: "interrupted" },
  });
});

test("an agent that exits says why; Restart and a message each resume its session", async () => {
  const { api, home, review, thread, start, threads } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  await session.act({ action: "prompt", text: "Crash during the build." });
  const stopped = await session.until((state) => state.halt !== undefined);
  expect(stopped).toMatchObject({
    status: "idle",
    halt: { kind: "stopped", detail: "Exited with code 1" },
  });
  expect(stopped.halt!.lines).toContain("FATAL ERROR: the fake ran out of memory");
  const latest = await threads();
  await vi.waitFor(() =>
    expect(latest.value.find((entry) => entry.id === review.id)?.halt).toEqual({
      kind: "stopped",
      detail: "Exited with code 1",
    }),
  );

  // Restart starts Claude Code again on the session's transcript.
  await session.act({ action: "restart" });
  const restarted = await session.until((state) => state.status === "idle" && !state.halt);
  expect(restarted.halt).toBeUndefined();
  const project = join(home, ".claude", "projects", "-fake-repo");
  const args = JSON.parse(await readFile(join(project, `${session.id}.args.json`), "utf8"));
  expect(args).toEqual(expect.arrayContaining(["--resume", session.id]));

  // A message to an agent that stopped resumes it too, and arrives once.
  await session.act({ action: "prompt", text: "Crash again." });
  await session.until((state) => state.halt?.kind === "stopped");
  const replies = await thread(session.id);
  const sent = await api<{ message: { delivery: string } }>(
    `/api/reviews/${review.id}/agent/messages`,
    { sessionId: session.id, text: "Are you back?", noteIds: [] },
  );
  expect(sent.data.message.delivery).toBe("delivered");
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/));
  expect((await session.until((state) => state.status === "idle")).halt).toBeUndefined();
});

test("a session record that Med cannot read costs only itself, and the file keeps a copy", async () => {
  const { stateDir, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const file = join(stateDir, "owned-sessions.json");
  await vi.waitFor(async () =>
    expect(Object.keys(JSON.parse(await readFile(file, "utf8")))).toEqual([session.id]),
  );
  const records = JSON.parse(await readFile(file, "utf8"));
  records["unknown-kind"] = { ...records[session.id], kind: "telepathy" };
  await writeFile(file, JSON.stringify(records));

  await restart();
  expect((await session.until((state) => state.settings.length > 0)).status).toBe("idle");
  const kept = (await readdir(stateDir)).filter((name) =>
    name.startsWith("owned-sessions.json.unreadable-"),
  );
  expect(kept).toHaveLength(1);
  expect(JSON.parse(await readFile(join(stateDir, kept[0]!), "utf8"))).toHaveProperty(
    "unknown-kind",
  );
});

test("Med runs an ACP agent and keeps its thread", async () => {
  const { api, review, stateDir, thread, start } = await fixture();
  // An ACP agent tells its models only in a session.
  expect((await api<AgentOptions>("/api/agents/fake/choices")).data).toEqual({});
  const session = await start("fake");
  expect(session.review.sessions).toMatchObject([
    { agent: "acp", name: "Fake ACP", id: session.id },
  ]);
  const ready = await session.until(
    (state) => state.status === "idle" && state.commands.length > 0,
  );
  expect(ready.settings.map((setting) => [setting.id, setting.category, setting.value])).toEqual([
    ["model", "model", "small"],
    ["mode", "mode", "build"],
  ]);
  expect(ready.commands).toEqual([{ name: "init", description: "Write AGENTS.md" }]);
  // The next session can choose from them, and starts with the choice.
  expect((await api<AgentOptions>("/api/agents/fake/choices")).data).toMatchObject({
    model: { value: "small", options: [{ value: "small" }, { value: "large" }] },
  });
  const chosen = await start("fake", { model: "large" });
  const large = await chosen.until((state) => state.status === "idle");
  expect(large.settings.find((setting) => setting.id === "model")?.value).toBe("large");
  await chosen.act({ action: "stop" });

  const replies = await thread(session.id);
  await api(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Format the durations.",
    noteIds: [],
  });
  await vi.waitFor(() => expect(replies()).toEqual(["(small, build) Format the durations."]));

  // Config options and the older modes both change through the same action.
  const larger = await session.act({ action: "setting", id: "model", value: "large" });
  expect(larger.data.settings.find((setting) => setting.id === "model")?.value).toBe("large");
  await session.act({ action: "setting", id: "mode", value: "plan" });
  expect((await session.act({ action: "setting", id: "mode", value: "nope" })).status).toBe(400);
  await session.act({ action: "prompt", text: "Check it." });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("(large, plan) Check it."));

  await session.act({ action: "prompt", text: "Edit summary.ts." });
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked.permission).toMatchObject({
    title: "Fake ACP wants to run Edit summary.ts",
    detail: "summary.ts",
    options: [
      { id: "allow", kind: "allow_once" },
      { id: "reject", kind: "reject_once" },
    ],
  });
  await session.act({ action: "permission", id: asked.permission!.id, option: "allow" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Outcome: selected allow"));

  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");

  // A turn without a reply says so; the prompt shows once, though the agent sends it back.
  await session.act({ action: "prompt", text: "Silent please." });
  await session.until((state) => state.status === "idle");
  const log = async () =>
    (await readFile(join(stateDir, "sessions", `${session.id}.jsonl`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as SessionEvent).update);
  await vi.waitFor(async () =>
    expect((await log()).at(-1)).toMatchObject({
      sessionUpdate: "notice",
      title: "Fake ACP ended the turn without a reply",
    }),
  );
  const prompts = (await log()).filter((update) => update.sessionUpdate === "user_message_chunk");
  expect(prompts.map((update) => "content" in update && update.content)).toEqual(
    [
      "Format the durations.",
      "Check it.",
      "Edit summary.ts.",
      "Wait for the build.",
      "Silent please.",
    ].map((text) => ({ type: "text", text })),
  );

  // An agent that takes images gets them before the text, and the thread keeps them.
  expect(ready.images).toBe(true);
  await api(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Look.",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Saw image/png: Look."));
  expect(
    (await log()).filter((update) => update.sessionUpdate === "user_message_chunk").slice(-2),
  ).toMatchObject([
    { content: { type: "image", mimeType: "image/png", data: PNG } },
    { content: { type: "text", text: "Look." } },
  ]);

  // Med keeps the updates, so the thread stays after the agent stops.
  await session.act({ action: "stop" });
  expect(JSON.stringify(await log())).toContain("Outcome: selected allow");
  const again = await thread(session.id);
  await vi.waitFor(() => expect(again()).toEqual(replies()));
});

test("a long holder log starts again at Med's last checkpoint, and a new host reads the same state from it", async () => {
  vi.stubEnv("MED_HOLDER_COMPACT_BYTES", "1");
  const { stateDir, thread, start, restart } = await fixture();
  const claude = await start("claude");
  await claude.until((state) => state.status === "idle" && state.settings.length > 0);
  await claude.act({ action: "setting", id: "mode", value: "plan" });
  const acp = await start("fake");
  await acp.until((state) => state.status === "idle");
  await acp.act({ action: "setting", id: "model", value: "large" });
  for (const text of ["Format the durations.", "Check it."]) {
    await claude.act({ action: "prompt", text });
    await claude.until((state) => state.status === "idle");
    await acp.act({ action: "prompt", text });
    await acp.until((state) => state.status === "idle");
  }
  // Each log keeps its first line, then the last checkpoint and what followed.
  for (const id of [claude.id, acp.id]) {
    const kinds = (await readFile(join(stateDir, "agents", `${id}.log`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => line.split(" ")[1]);
    expect(kinds.slice(0, 2)).toEqual(["h", "m"]);
    expect(kinds.filter((kind) => kind === "m")).toHaveLength(1);
  }
  const before = { claude: await claude.state(), acp: await acp.state() };
  const same = (state: OwnedState) => ({
    status: state.status,
    turns: state.turns,
    settings: state.settings.map((setting) => [setting.id, setting.value]),
    commands: state.commands.map((command) => command.name),
  });

  await restart();
  expect(same(await claude.state())).toEqual(same(before.claude));
  expect(same(await acp.state())).toEqual(same(before.acp));
  const replies = await thread(acp.id);
  await acp.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("(large, build) Still here?"));
  const claudeReplies = await thread(claude.id);
  await claude.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() =>
    expect(claudeReplies().at(-1)).toBe("Model opus, effort medium, mode plan: Still here?"),
  );
});

test("an ACP agent keeps its question and its turn through a host restart, and its thread shows each update once", async () => {
  const { stateDir, thread, start, restart } = await fixture();
  const session = await start("fake");
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  await session.until((state) => state.permission !== undefined);

  // The question waits for the reader on the new host.
  await restart();
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked).toMatchObject({
    status: "working",
    permission: { title: "Fake ACP wants to run Edit summary.ts" },
  });
  const replies = await thread(session.id);
  await session.act({ action: "permission", id: asked.permission!.id, option: "allow" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Outcome: selected allow"));
  await session.until((state) => state.status === "idle");

  // A turn that runs while the host restarts ends on the new host.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  await restart();
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");
  const updates = (await readFile(join(stateDir, "sessions", `${session.id}.jsonl`), "utf8"))
    .trim()
    .split("\n")
    .map((line) => (JSON.parse(line) as SessionEvent).update);
  expect(
    updates
      .filter((update) => update.sessionUpdate === "user_message_chunk")
      .map((update) => "content" in update && update.content),
  ).toEqual(["Edit summary.ts.", "Wait for the build."].map((text) => ({ type: "text", text })));
  expect(updates.filter((update) => update.sessionUpdate === "agent_message_chunk")).toHaveLength(
    1,
  );
  expect(updates.at(-1)).toMatchObject({ sessionUpdate: "notice", title: "Interrupted" });
});

test("the thread list follows each thread's lead session: working, needs you, and idle", async () => {
  const { api, repo, home, review, start, threads } = await fixture();
  // A Claude session that another app runs: Med reads its transcript.
  const attached = "5f0c2a8e-1111-4222-8333-944455556666";
  const project = join(home, ".claude", "projects", "-work-repo");
  await mkdir(project, { recursive: true });
  const transcript = join(project, `${attached}.jsonl`);
  const line = (value: unknown) => `${JSON.stringify(value)}\n`;
  await writeFile(
    transcript,
    line({
      type: "user",
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "Format the durations." },
    }),
  );
  const other = (
    await api<SavedReview>("/api/reviews", {
      title: "Durations in the export",
      targets: [{ repo, comparison: { kind: "working" } }],
      sessions: [{ agent: "claude", id: attached, cwd: repo }],
    })
  ).data;
  const session = await start("fake");
  await session.until((state) => state.status === "idle");

  const latest = await threads();
  const of = (id: string) => latest.value.find((entry) => entry.id === id);
  await vi.waitFor(() => {
    expect(of(other.id)).toMatchObject({ agent: "claude", state: "working" });
    expect(of(review.id)).toMatchObject({ agent: "acp", state: "idle" });
  });
  expect(of(other.id)!.sessions).toEqual([{ agent: "claude", id: attached, cwd: repo }]);

  // A permission request needs the user; the answer lets the turn finish.
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  await vi.waitFor(() => expect(of(review.id)?.state).toBe("waiting"), { timeout: 5000 });
  const asked = await session.until((state) => state.permission !== undefined);
  await session.act({ action: "permission", id: asked.permission!.id, option: "allow" });
  await vi.waitFor(() => expect(of(review.id)?.state).toBe("idle"), { timeout: 5000 });

  // The attached session ends its turn when its transcript says so.
  const before = of(other.id)!.updatedAt;
  await appendFile(
    transcript,
    line({
      type: "assistant",
      timestamp: new Date().toISOString(),
      uuid: "a1",
      message: {
        id: "a1",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    }),
  );
  await vi.waitFor(
    () => {
      expect(of(other.id)?.state).toBe("idle");
      expect(of(other.id)!.updatedAt).toBeGreaterThanOrEqual(before);
    },
    { timeout: 5000 },
  );
});

test("Claude Code that Med runs streams its reply after it thinks; a turn that another process runs on the session works until it ends", async () => {
  vi.stubEnv("MED_FAKE_WORD_MS", "60");
  const { api, home, review, thread, start, threads } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle");
  const states = await session.follow();
  const replies = await thread(session.id);
  await api(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Think it over: should the station keep its own time?",
    noteIds: [],
  });
  // The thought does not end the turn: the reply streams word by word after
  // it, and the transcript gets both when the reply is complete.
  const reply = "Kept the station's own time and wrote a test for the hour.";
  await vi.waitFor(() => expect(replies()).toEqual([reply]), { timeout: 5000 });
  await vi.waitFor(() => expect(states.at(-1)?.status).toBe("idle"));
  const streamed = states.filter((state) => state.streaming?.text);
  const lengths = streamed.map((state) => state.streaming!.text.length);
  expect(lengths.length).toBeGreaterThan(3);
  expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
  for (const state of streamed) {
    expect(state.status).toBe("working");
    expect(reply.startsWith(state.streaming!.text)).toBe(true);
  }

  // Another process, such as Claude Code in a terminal, runs a turn on the
  // session while Med's runner waits. The transcript tells the turn's state.
  const latest = await threads();
  const lead = () => latest.value.find((entry) => entry.id === review.id);
  await vi.waitFor(() => expect(lead()?.state).toBe("idle"));
  const transcript = join(home, ".claude", "projects", "-fake-repo", `${session.id}.jsonl`);
  const line = (entry: object) =>
    appendFile(
      transcript,
      `${JSON.stringify({ ...entry, sessionId: session.id, timestamp: new Date().toISOString() })}\n`,
    );
  await line({ type: "user", uuid: "u1", message: { role: "user", content: "Run the tests." } });
  await vi.waitFor(
    () => expect(lead()).toMatchObject({ state: "working", turn: { activity: "Thinking" } }),
    { timeout: 5000 },
  );
  const message = { id: "msg_1", role: "assistant", stop_reason: "end_turn" };
  const thought = { type: "thinking", thinking: "", signature: "x" };
  await line({ type: "assistant", uuid: "a1", message: { ...message, content: [thought] } });
  const text = { type: "text", text: "The tests pass." };
  await line({ type: "assistant", uuid: "a2", message: { ...message, content: [text] } });
  await vi.waitFor(
    () => expect(lead()).toMatchObject({ state: "idle", turn: { said: "The tests pass." } }),
    { timeout: 5000 },
  );
  expect(lead()!.turn!.endedAt).toBeGreaterThan(lead()!.turn!.startedAt!);
});
