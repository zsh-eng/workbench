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
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentInboxState, AgentMessage } from "../../src/shared/agent-inbox";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { Thread, ThreadList } from "../../src/shared/threads";
import type { AgentOptions, OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { runAgentsCommand } from "../../src/cli/agents";
import { readServerEvents } from "../../src/web/data/sse";
import type { RunningSession } from "../../src/shared/found-sessions";
import { claudeProjectFolder } from "../../src/host/found-sessions";
import { longProcess, processStart, writeProcessRecord } from "../fixtures/terminal-claude";
import { removeFolder } from "./remove-folder";

/** A one-pixel PNG, in base64. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
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

async function fixture({ key, agy = true }: { key?: string; agy?: boolean } = {}) {
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
    agy,
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
      {
        id: "codex",
        name: "Codex",
        kind: "codex",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-codex-app-server.mjs")],
      },
      {
        id: "agy",
        name: "Antigravity",
        kind: "agy",
        available: true,
        command: process.execPath,
        args: [agentScript("fake-agy.mjs")],
      },
      { id: "missing", name: "Missing", kind: "acp", available: false, command: "x", args: [] },
    ],
  };
  let host = await startHost(options);
  hosts.push(host);
  /** Closes the host and starts it again on the same state, as a restart
   * does. With `reboot`, the agents and their holders end too, as when the
   * Mac restarts. `closed` runs while no host runs. */
  const restart = async ({
    reboot = false,
    closed,
  }: { reboot?: boolean; closed?: () => Promise<void> } = {}) => {
    await host.close();
    hosts.splice(hosts.indexOf(host), 1);
    await closed?.();
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
      ...(key && { key }),
      targets: [{ repo, comparison: { kind: "working" } }],
    })
  ).data;
  /** The session's thread, as the browser reads it. */
  const thread = async (sessionId: string, reviewId = review.id) => {
    const response = await fetch(
      `http://127.0.0.1:${host.port}/api/reviews/${reviewId}/sessions/${sessionId}/events`,
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
    // The replies; `events` has every update.
    return Object.assign(
      () =>
        events.flatMap((event) =>
          event.update.sessionUpdate === "agent_message_chunk" &&
          event.update.content.type === "text"
            ? [event.update.content.text]
            : [],
        ),
      { events },
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
  // Each says what Med can do with it, so the page shows only what works.
  expect(agents.data.agents).toEqual([
    {
      id: "claude",
      name: "Claude Code",
      kind: "claude",
      available: true,
      // Claude Code takes a message after its tools, without steering the turn.
      capabilities: expect.objectContaining({ steer: false, approvals: "ask" }),
    },
    {
      id: "fake",
      name: "Fake ACP",
      kind: "acp",
      available: true,
      capabilities: expect.objectContaining({ steer: false, usage: false }),
    },
    {
      id: "codex",
      name: "Codex",
      kind: "codex",
      available: true,
      capabilities: expect.objectContaining({ steer: true, subagents: true }),
    },
    {
      id: "agy",
      name: "Antigravity",
      kind: "agy",
      available: true,
      capabilities: expect.objectContaining({ steer: false, approvals: "rules" }),
    },
    expect.objectContaining({ id: "missing", available: false }),
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
    ["mode", "auto"],
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
    expect(replies()).toEqual(["Model opus, effort medium, mode auto: Format the durations."]),
  );
  const answered = await session.until((state) => state.context !== undefined);
  expect(answered.context).toEqual({ used: 2500, total: 10_000 });

  // An effort change starts Claude Code again with the same session.
  expect((await session.act({ action: "setting", id: "effort", value: "high" })).status).toBe(200);
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Check the summary." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Model opus, effort high, mode auto: Check the summary."),
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

test("Claude Code's questions and plans wait in Med; the answer goes back as Claude Code reads it", async () => {
  const { start, thread } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const replies = await thread(session.id);

  // AskUserQuestion shows its questions and choices.
  await session.act({ action: "prompt", text: "Question the format." });
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked.permission).toMatchObject({
    title: "Claude Code asks",
    options: [{ id: "answer" }, { id: "deny", name: "Skip" }],
    questions: [
      {
        question: "Which format should durations use?",
        header: "Format",
        multiSelect: false,
        options: [
          { label: "Short", description: "1h 5m" },
          { label: "Long", description: "1 hour 5 minutes" },
        ],
      },
      { question: "Which units can show?", multiSelect: true },
    ],
  });
  // An answer needs a choice; the answers go back by question.
  const empty = await session.act({
    action: "permission",
    id: asked.permission!.id,
    option: "answer",
  });
  expect(empty.status).toBe(400);
  await session.act({
    action: "permission",
    id: asked.permission!.id,
    option: "answer",
    answers: {
      "Which format should durations use?": "Short",
      "Which units can show?": "Hours, Minutes",
      "A question it did not ask": "No",
    },
  });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe(
      'Answers: {"Which format should durations use?":"Short","Which units can show?":"Hours, Minutes"}',
    ),
  );
  await session.until((state) => state.status === "idle" && !state.permission);

  // Skip tells the agent that the user chose not to answer.
  await session.act({ action: "prompt", text: "Question it again." });
  const again = await session.until((state) => state.permission !== undefined);
  await session.act({ action: "permission", id: again.permission!.id, option: "deny" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("No answer: The user chose not to answer."));
  await session.until((state) => state.status === "idle");

  // ExitPlanMode shows the plan, and the modes the work can continue in.
  await session.act({ action: "setting", id: "mode", value: "plan" });
  await session.act({ action: "prompt", text: "Propose a plan." });
  const planned = await session.until((state) => state.permission !== undefined);
  expect(planned.permission).toMatchObject({
    title: "Claude Code's plan",
    options: [{ id: "approve" }, { id: "deny", name: "Keep planning" }],
    plan: {
      text: "# Format durations\n\n1. Add `formatDuration`.\n2. Test the hour.\n",
      mode: "acceptEdits",
      modes: [{ value: "acceptEdits" }, { value: "default" }, { value: "auto" }],
    },
  });
  // Keep planning carries what the user said.
  await session.act({
    action: "permission",
    id: planned.permission!.id,
    option: "deny",
    message: "Test minutes too.",
  });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe(
      "Still planning: The user wants to keep planning. They said: Test minutes too.",
    ),
  );
  await session.until((state) => state.status === "idle");
  // Approve sets the chosen mode; the picker shows the mode Claude Code reports.
  await session.act({ action: "prompt", text: "Propose it again." });
  const second = await session.until((state) => state.permission !== undefined);
  await session.act({
    action: "permission",
    id: second.permission!.id,
    option: "approve",
    mode: "auto",
  });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Approved; mode auto."));
  const approved = await session.until(
    (state) => state.settings.find((setting) => setting.id === "mode")?.value === "auto",
  );
  expect(approved.permission).toBeUndefined();
});

test("the mode picker shows the mode Claude Code reports, cycles as ⇧Tab does, and Bypass starts Claude Code again with it allowed", async () => {
  const { start, thread, home } = await fixture();
  const session = await start("claude");
  const ready = await session.until(
    (state) => state.status === "idle" && state.settings.length > 0,
  );
  const mode = (state: OwnedState) => state.settings.find((setting) => setting.id === "mode")!;
  expect(mode(ready).options.map((option) => option.name)).toEqual([
    "Ask",
    "Accept edits",
    "Plan",
    "Auto",
    "Don't ask",
    "Bypass permissions",
  ]);
  expect(mode(ready).cycle).toEqual(["default", "acceptEdits", "plan", "auto"]);
  const replies = await thread(session.id);

  for (const value of ["auto", "dontAsk"]) {
    const set = await session.act({ action: "setting", id: "mode", value });
    expect(mode(set.data).value).toBe(value);
  }
  await session.act({ action: "prompt", text: "Which mode?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/mode dontAsk: Which mode\?$/));
  await session.until((state) => state.status === "idle");

  // Claude Code refuses Bypass to a process that started without it, so
  // Med starts it again, with the same session.
  const bypass = await session.act({ action: "setting", id: "mode", value: "bypassPermissions" });
  expect(bypass.status).toBe(200);
  const restarted = await session.until(
    (state) => state.status === "idle" && mode(state).value === "bypassPermissions",
  );
  expect(mode(restarted).cycle).toEqual([
    "default",
    "acceptEdits",
    "plan",
    "bypassPermissions",
    "auto",
  ]);
  const project = join(home, ".claude", "projects", "-fake-repo");
  await vi.waitFor(async () =>
    expect(JSON.parse(await readFile(join(project, `${session.id}.args.json`), "utf8"))).toEqual(
      expect.arrayContaining([
        "--resume",
        session.id,
        "--permission-mode",
        "bypassPermissions",
        "--allow-dangerously-skip-permissions",
      ]),
    ),
  );
  await session.act({ action: "prompt", text: "Which mode now?" });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toMatch(/mode bypassPermissions: Which mode now\?$/),
  );
  await session.until((state) => state.status === "idle");
  // Once allowed, Bypass switches without a new start.
  await session.act({ action: "setting", id: "mode", value: "default" });
  await session.act({ action: "setting", id: "mode", value: "bypassPermissions" });
  await session.act({ action: "prompt", text: "And now?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/mode bypassPermissions: And now\?$/));
});

test("a new Claude Code session starts in Auto, and a new session of the thread takes the mode that it chose", async () => {
  const { home, start } = await fixture({ key: "format-durations" });
  const mode = (state: OwnedState) =>
    state.settings.find((setting) => setting.id === "mode")?.value;
  const args = async (id: string) =>
    JSON.parse(
      await readFile(join(home, ".claude", "projects", "-fake-repo", `${id}.args.json`), "utf8"),
    ) as string[];
  const first = await start("claude");
  const ready = await first.until((state) => state.status === "idle" && state.settings.length > 0);
  // Med asks for Auto when it starts Claude Code, and shows the mode that it reports.
  expect(mode(ready)).toBe("auto");
  expect(await args(first.id)).toEqual(expect.arrayContaining(["--permission-mode", "auto"]));

  await first.act({ action: "setting", id: "mode", value: "plan" });
  await first.until((state) => mode(state) === "plan");
  const second = await start("claude");
  const next = await second.until((state) => state.status === "idle" && state.settings.length > 0);
  expect(mode(next)).toBe("plan");
  expect(await args(second.id)).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
  // The first session keeps its own mode.
  expect(mode(await first.state())).toBe("plan");
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

test("a message sent while Claude Code works waits for its next step: it comes back until then, outlasts a host restart, and joins the turn when a tool runs", async () => {
  vi.stubEnv("MED_FAKE_TOOL_MS", "1500");
  const { api, review, thread, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/messages`, {
      sessionId: session.id,
      text,
      noteIds: [],
    });
  const messages = async () =>
    (await api<AgentInboxState>(`/api/reviews/${review.id}/agent`)).data.messages;

  // A turn that runs no tool: a message waits for its end.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  const first = await send("Use two spaces.");
  expect(first.data.message).toMatchObject({ delivery: "pending", queued: true });
  // Until the agent has it, the user can take it back, to edit it or drop it.
  const taken = await api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/take`, {
    id: first.data.message.id,
  });
  expect(taken.data.message).toMatchObject({ text: "Use two spaces." });
  expect((await messages()).map((message) => message.text)).toEqual([]);
  const second = await send("Keep the tests.");
  expect(second.data.message.queued).toBe(true);

  // The host restarts: the message waits on disk, and the turn goes on.
  await restart();
  expect(await session.state()).toMatchObject({ status: "working" });
  expect(await messages()).toMatchObject([
    { text: "Keep the tests.", delivery: "pending", queued: true },
  ]);
  // Esc ends the turn; the message goes next, as Claude Code's terminal sends it.
  const replies = await thread(session.id);
  await session.act({ action: "interrupt" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Keep the tests\.$/));
  expect(await messages()).toMatchObject([{ text: "Keep the tests.", delivery: "delivered" }]);
  expect((await messages())[0]!.queued).toBeUndefined();
  // A message that went cannot come back.
  expect(
    (await api(`/api/reviews/${review.id}/agent/take`, { id: second.data.message.id })).status,
  ).toBe(409);

  // A turn that runs a tool: Claude Code reads the message when the tool
  // ends, in the same turn.
  await session.until((state) => state.status === "idle");
  await send("Work on the check.");
  await session.until((state) => state.status === "working");
  const during = await send("Also check the hour.");
  expect(during.data.message).toMatchObject({ delivery: "pending", queued: true });
  await vi.waitFor(
    () => expect(replies().at(-1)).toBe("Checked, and read your note: Also check the hour."),
    { timeout: 5000 },
  );
  expect((await messages()).at(-1)).toMatchObject({
    text: "Also check the hour.",
    delivery: "delivered",
  });
});

test("Queue keeps a message for the turn's end past a tool step and a host restart; Send now gives it to Claude Code at its next step", async () => {
  vi.stubEnv("MED_FAKE_TOOL_MS", "4000");
  const { api, review, thread, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const send = (text: string, afterTurn = false) =>
    api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/messages`, {
      sessionId: session.id,
      text,
      noteIds: [],
      afterTurn,
    });
  const messages = async () =>
    (await api<AgentInboxState>(`/api/reviews/${review.id}/agent`)).data.messages;
  await send("Work on the check.");
  await session.until((state) => state.status === "working");
  const later = await send("Then update the docs.", true);
  expect(later.data.message).toMatchObject({ delivery: "pending", afterTurn: true });

  // A new host keeps the flag; then Send now lets the tool step take it.
  await restart();
  expect((await messages()).at(-1)).toMatchObject({ delivery: "pending", afterTurn: true });
  const replies = await thread(session.id);
  const now = await api(`/api/reviews/${review.id}/agent/send-now`, {
    id: later.data.message.id,
  });
  expect(now.status).toBe(200);
  await vi.waitFor(
    () => expect(replies().at(-1)).toBe("Checked, and read your note: Then update the docs."),
    { timeout: 8000 },
  );
  expect((await messages()).at(-1)).toMatchObject({ delivery: "delivered" });
  // A message that went has nothing to send now.
  expect(
    (await api(`/api/reviews/${review.id}/agent/send-now`, { id: later.data.message.id })).status,
  ).toBe(409);
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
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
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

test("a closed tab's agent stops once its turn ends, and the next message resumes it", async () => {
  vi.stubEnv("MED_AGENT_RELEASE_MS", "0");
  const { api, review, stateDir, thread, start } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const holder = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");

  await api(`/api/threads/${review.id}/close`, {});
  // The turn goes on without its tab.
  await new Promise((done) => setTimeout(done, 300));
  expect(alive(holder.pid)).toBe(true);
  await session.act({ action: "interrupt" });
  await vi.waitFor(() => expect(alive(holder.pid)).toBe(false));
  expect(await session.state()).toMatchObject({ status: "idle" });
  expect((await session.state()).halt).toBeUndefined();

  // The tab opens again, and a message resumes the session in a new holder.
  await api(`/api/threads/${review.id}/open`, { restore: true });
  const replies = await thread(session.id);
  await session.act({ action: "prompt", text: "Are you back?" });
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
  await session.until((state) => state.status === "idle");
  const again = JSON.parse(
    await readFile(join(stateDir, "agents", `${session.id}.json`), "utf8"),
  ) as { pid: number };
  await new Promise((done) => setTimeout(done, 300));
  expect(alive(again.pid)).toBe(true);
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
  await vi.waitFor(() => expect(replies().at(-1)).toMatch(/: Are you back\?$/), {
    timeout: 5000,
  });
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
  await restart({
    async closed() {
      const records = JSON.parse(await readFile(file, "utf8"));
      records["unknown-kind"] = { ...records[session.id], kind: "telepathy" };
      await writeFile(file, JSON.stringify(records));
    },
  });
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

test("Med runs Codex through its app-server: a card asks, Send now steers, a subagent nests, and Stop ends the turn", async () => {
  // The fake replays a recorded Codex 0.160 session (codex-app-server.jsonl).
  const { api, review, thread, start } = await fixture();
  // model/list gives the choices before a thread starts; no turn runs.
  expect((await api<AgentOptions>("/api/agents/codex/choices")).data).toMatchObject({
    model: {
      value: expect.any(String),
      options: [{ value: "gpt-6-luna" }, { value: "gpt-5.6-terra" }, { value: "gpt-5.6-luna" }],
    },
  });
  const session = await start("codex", { model: "gpt-6-luna" });
  // Codex names the thread. The review keeps it as a Codex session, whose
  // rollout the thread reads, as for a session that Med finds.
  expect(session.id).toBe("01a189a8-50ca-72c2-b4ab-e477ea3036c6");
  expect(session.review.sessions).toMatchObject([{ agent: "codex", id: session.id }]);
  const ready = await session.until((state) => state.status === "idle");
  expect(ready.capabilities).toMatchObject({ steer: true, interrupt: true, approvals: "ask" });
  expect(ready.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "gpt-6-luna"],
    ["effort", "default"],
    ["mode", "default"],
  ]);
  const replies = await thread(session.id);
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/messages`, {
      sessionId: session.id,
      text,
      noteIds: [],
    });

  // Codex asks before the command; the card answers it.
  await send("Run ls -1, then name the files.");
  const asked = await session.until((state) => !!state.permission);
  expect(asked.permission).toMatchObject({
    title: "Codex wants to run a command",
    detail: expect.stringContaining("ls -1"),
    options: [{ id: "accept" }, { id: "acceptForSession" }, { id: "decline" }],
  });
  await session.act({ action: "permission", id: asked.permission!.id, option: "accept" });
  // A message queued during the turn waits for its end; Send now steers it
  // into the turn.
  const queued = await api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/messages`, {
    sessionId: session.id,
    text: "Also end your reply with the word steered.",
    noteIds: [],
    afterTurn: true,
  });
  expect(queued.data.message).toMatchObject({ delivery: "pending", queued: true, afterTurn: true });
  expect(
    (await api(`/api/reviews/${review.id}/agent/send-now`, { id: queued.data.message.id })).status,
  ).toBe(200);
  await vi.waitFor(() =>
    expect(replies()).toEqual([
      "`ls -1` lists one file: `README.md`.",
      "`ls -1` lists one file: `README.md`. steered",
    ]),
  );
  const done = await session.until((state) => state.status === "idle");
  expect(done.context).toEqual({ used: 19028, total: 258400 });

  // The subagent's thread nests in its spawn call.
  await send("Ask a subagent for the word pong.");
  await vi.waitFor(() => expect(replies().at(-1)).toBe("pong"), { timeout: 5000 });
  const spawn = replies.events.find(
    (event) =>
      event.update.sessionUpdate === "tool_call" && event.update._meta?.med?.tool === "spawn_agent",
  );
  expect(spawn?.update).toMatchObject({ title: "Pong" });
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) =>
          event.update._meta?.med?.parentToolCallId ===
            (spawn!.update as { toolCallId: string }).toolCallId &&
          event.update.sessionUpdate === "agent_message_chunk",
      ),
    ).toBe(true),
  );
  await session.until((state) => state.status === "idle");

  // Stop interrupts the turn that runs.
  await send("Run sleep 20, then say done.");
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("I\u2019ll run `sleep 20` in the shell and let it finish."),
  );
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) => event.update.sessionUpdate === "notice" && event.update.title === "Interrupted",
      ),
    ).toBe(true),
  );
});

test("Med runs agy in stream-json: refused actions say why, queued messages wait for the turn, a subagent nests, and Stop ends the process until the next message resumes it", async () => {
  // The fake replays a recorded agy 1.4.10 session (agy-stream.jsonl).
  const { api, home, review, thread, start } = await fixture();
  const session = await start("agy");
  expect(session.review.sessions).toMatchObject([
    { agent: "acp", name: "Antigravity", id: session.id },
  ]);
  const ready = await session.until((state) => state.status === "idle");
  expect(ready.capabilities).toMatchObject({ steer: false, approvals: "rules" });
  expect(ready.settings.find((setting) => setting.id === "mode")?.value).toBe("accept-edits");
  const replies = await thread(session.id);
  const notices = () =>
    replies.events.flatMap((event) =>
      event.update.sessionUpdate === "notice" ? [event.update.title] : [],
    );
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/reviews/${review.id}/agent/messages`, {
      sessionId: session.id,
      text,
      noteIds: [],
    });
  const runs = async () =>
    (await readFile(join(home, "agy-runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });

  // agy cannot ask: what it refused shows as a notice that says what to do.
  await send("Run ls -1, then name the files.");
  await vi.waitFor(() =>
    expect(notices()).toEqual(["Antigravity refused RunCommand: it cannot ask in Med"]),
  );
  expect((await runs())[0]!.args).toEqual(
    expect.arrayContaining(["--input-format", "stream-json", "--mode", "accept-edits", "-p="]),
  );
  await session.until((state) => state.status === "idle");

  // A message during the turn waits for it; agy takes no message mid-turn.
  await send("Start a subagent that says pong.");
  await session.until((state) => state.status === "working");
  const queued = await send("After that, also say the word queued.");
  expect(queued.data.message).toMatchObject({ queued: true, delivery: "pending" });
  expect(
    (await api(`/api/reviews/${review.id}/agent/send-now`, { id: queued.data.message.id })).status,
  ).toBe(409);
  await vi.waitFor(() => expect(replies()).toContain("queued"), { timeout: 5000 });
  // The subagent's transcript nests in its call.
  const call = replies.events.find(
    (event) =>
      event.update.sessionUpdate === "tool_call" &&
      event.update._meta?.med?.tool === "invoke_subagent",
  );
  expect(call?.update).toMatchObject({ title: "Echo Responder" });
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) =>
          event.update._meta?.med?.parentToolCallId ===
            (call!.update as { toolCallId: string }).toolCallId &&
          event.update.sessionUpdate === "agent_message_chunk" &&
          event.update.content.type === "text" &&
          event.update.content.text === "pong",
      ),
    ).toBe(true),
  );

  // Stop ends agy's process; the next message resumes the conversation.
  await session.until((state) => state.status === "idle");
  await send("Run sleep 30, then say done.");
  await session.until((state) => state.status === "working");
  await new Promise((resolve) => setTimeout(resolve, 300));
  await session.act({ action: "interrupt" });
  const stopped = await session.until((state) => state.status === "idle");
  expect(stopped.halt).toBeUndefined();
  expect(notices()).toContain("Interrupted");
  await send("Say ok.");
  await vi.waitFor(async () => expect(await runs()).toHaveLength(2), { timeout: 5000 });
  expect((await runs())[1]!.args).toEqual(
    expect.arrayContaining(["--conversation", "1f892c8e-f601-4c2f-b28c-e5f7d7b6e969"]),
  );
});

/** A process in `cwd` that holds `paths` open, as Codex and agy hold their
 * lock files while they run a conversation. */
async function holdOpen(cwd: string, paths: string[]) {
  for (const path of paths) {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "");
  }
  const child = spawn(
    process.execPath,
    [
      "-e",
      "for (const path of process.argv.slice(1)) require('fs').openSync(path, 'r'); setInterval(() => {}, 1000)",
      ...paths,
    ],
    { cwd, stdio: "ignore" },
  );
  const exited = once(child, "exit");
  await once(child, "spawn");
  return {
    async end() {
      child.kill();
      await exited;
    },
  };
}

test("Running now lists the sessions that run in Med and elsewhere; an agy conversation continues in Med once its process ends, from its history", async () => {
  const { api, home, repo, review, start, thread } = await fixture();
  const lines = (entries: object[]) =>
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  const ends: (() => Promise<void>)[] = [];
  try {
    // Claude Code in a terminal.
    const claude = "5d0c4b6a-1e2f-4a3b-9c8d-7e6f5a4b3c2d";
    const project = join(home, ".claude", "projects", claudeProjectFolder(repo));
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, `${claude}.jsonl`),
      lines([
        {
          type: "user",
          cwd: repo,
          sessionId: claude,
          uuid: "u1",
          timestamp: new Date().toISOString(),
          message: { role: "user", content: "Tidy the duration helpers." },
        },
      ]),
    );
    const terminal = await longProcess();
    ends.push(terminal.end);
    await writeProcessRecord(home, terminal.pid, {
      pid: terminal.pid,
      sessionId: claude,
      cwd: repo,
      procStart: processStart(terminal.pid),
      entrypoint: "cli",
    });
    // Codex Desktop with threads open: one with a turn in progress lists. A
    // guardian review does not, nor a thread that it only has loaded: its
    // last turn ended, or nothing has written to it for minutes.
    const day = new Date();
    const sessions = join(
      home,
      ".codex",
      "sessions",
      String(day.getFullYear()),
      String(day.getMonth() + 1).padStart(2, "0"),
      String(day.getDate()).padStart(2, "0"),
    );
    await mkdir(sessions, { recursive: true });
    const codex = "01a189b0-0000-7000-8000-000000000001";
    const guardian = "01a189b0-0000-7000-8000-000000000002";
    const loaded = "01a189b0-0000-7000-8000-000000000003";
    const quiet = "01a189b0-0000-7000-8000-000000000004";
    const event = (type: string) => ({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: { type },
    });
    for (const [id, source, text, turn] of [
      [codex, "vscode", "Port the parser.", [event("task_started")]],
      [guardian, { subagent: { other: "guardian" } }, "Review this command.", []],
      [loaded, "vscode", "Rename the flags.", [event("task_started"), event("task_complete")]],
      [quiet, "vscode", "Sort the imports.", []],
    ] as const) {
      const path = join(sessions, `rollout-2026-10-30T06-00-00-${id}.jsonl`);
      await writeFile(
        path,
        lines([
          {
            timestamp: new Date().toISOString(),
            type: "session_meta",
            payload: { id, cwd: repo, source },
          },
          {
            timestamp: new Date().toISOString(),
            type: "response_item",
            payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
          },
          ...turn,
        ]),
      );
      if (id === quiet) {
        const before = new Date(Date.now() - 10 * 60_000);
        await utimes(path, before, before);
      }
    }
    const locks = join(home, ".codex", "thread-writer-locks");
    const codexApp = await holdOpen(
      repo,
      [codex, guardian, loaded, quiet].map((id) => join(locks, `${id}.lock`)),
    );
    ends.push(codexApp.end);
    // agy in a terminal, in the repository.
    const agy = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
    const brain = join(
      home,
      ".gemini",
      "antigravity-cli",
      "brain",
      agy,
      ".system_generated",
      "logs",
    );
    await mkdir(brain, { recursive: true });
    await writeFile(
      join(brain, "transcript.jsonl"),
      lines([
        {
          step_index: 0,
          source: "USER",
          type: "USER_INPUT",
          status: "DONE",
          content: "<USER_REQUEST>\nName the files.\n</USER_REQUEST>",
        },
        {
          step_index: 1,
          source: "MODEL",
          type: "PLANNER_RESPONSE",
          status: "DONE",
          content: "There is one: summary.ts.",
        },
      ]),
    );
    const agyTerminal = await holdOpen(repo, [
      join(home, ".gemini", "antigravity-cli", "presence", `${agy}.lock`),
    ]);
    ends.push(agyTerminal.end);
    // Codex in Med, at work on a turn: its card waits.
    const owned = await start("codex", { model: "gpt-6-luna" });
    await owned.until((state) => state.status === "idle");
    await api(`/api/reviews/${review.id}/agent/messages`, {
      sessionId: owned.id,
      text: "Run ls -1, then name the files.",
      noteIds: [],
    });
    await owned.until((state) => !!state.permission);

    const running = async () =>
      (await api<{ sessions: RunningSession[] }>("/api/sessions/running")).data.sessions;
    expect(await running()).toEqual([
      {
        agent: "codex",
        id: owned.id,
        title: "Format durations",
        cwd: repo,
        place: "med",
        thread: review.id,
      },
      {
        agent: "claude",
        id: claude,
        title: "Tidy the duration helpers",
        cwd: repo,
        place: "terminal",
      },
      { agent: "codex", id: codex, title: "Port the parser", cwd: repo, place: "other-app" },
      { agent: "agy", id: agy, title: "Name the files.", cwd: repo, place: "terminal" },
    ]);

    // Continue in Med makes the agy conversation a thread at once, with its
    // history. agy has one writer, so a message waits for agy to end there.
    const adopt = () =>
      api<{ id: string; created: boolean }>("/api/sessions/adopt", {
        agent: "agy",
        session: agy,
        repo,
        title: "Name the files",
      });
    const adopted = await adopt();
    expect(adopted.data).toMatchObject({ created: true });
    const saved = await api<{ sessions: { id: string; agent: string; name?: string }[] }>(
      `/api/reviews/${adopted.data.id}`,
    );
    const [session] = saved.data.sessions;
    expect(session).toMatchObject({ agent: "acp", name: "Antigravity" });
    expect((await adopt()).data).toMatchObject({ id: adopted.data.id, created: false });
    const replies = await thread(session!.id, adopted.data.id);
    await vi.waitFor(() => expect(replies()).toEqual(["There is one: summary.ts."]));
    const send = (text: string) =>
      api<{ message: AgentMessage }>(`/api/reviews/${adopted.data.id}/agent/messages`, {
        sessionId: session!.id,
        text,
        noteIds: [],
      });
    expect((await send("Say ok.")).data.message).toMatchObject({
      delivery: "failed",
      error: expect.stringContaining("Close it there"),
    });
    // Once agy ends there, the next message resumes the conversation in Med.
    await agyTerminal.end();
    expect((await send("Say ok.")).data.message).toMatchObject({ delivery: "delivered" });
    await vi.waitFor(async () => {
      const runs = (await readFile(join(home, "agy-runs.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => (JSON.parse(line) as { args: string[] }).args);
      expect(runs.at(-1)).toEqual(expect.arrayContaining(["--conversation", agy]));
    });
  } finally {
    for (const end of ends) await end().catch(() => {});
  }
});

test("Antigravity is off until the user turns it on: Med does not offer it, list it as running, or continue its conversations", async () => {
  const { api, home, repo, review } = await fixture({ agy: false });
  const agy = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
  const terminal = await holdOpen(repo, [
    join(home, ".gemini", "antigravity-cli", "presence", `${agy}.lock`),
  ]);
  try {
    const agents = await api<{ agents: { id: string }[] }>("/api/agents");
    expect(agents.data.agents.map((agent) => agent.id)).not.toContain("agy");
    expect((await api(`/api/reviews/${review.id}/owned`, { preset: "agy" })).status).toBe(404);
    expect((await api("/api/agents/agy/choices")).status).toBe(404);
    const running = await api<{ sessions: RunningSession[] }>("/api/sessions/running");
    expect(running.data.sessions.filter((session) => session.agent === "agy")).toEqual([]);
    const adopt = await api("/api/sessions/adopt", { agent: "agy", session: agy, repo });
    expect(adopt.status).toBe(404);
  } finally {
    await terminal.end();
  }
});
