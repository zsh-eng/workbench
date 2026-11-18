import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "../../src/shared/agent-inbox";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { ThreadList } from "../../src/shared/threads";
import type { AgentOptions } from "../../src/shared/owned-session";
import { claudeProjectFolder } from "../../src/host/session-index";
import { longProcess, processStart, writeProcessRecord } from "../fixtures/terminal-claude";
import { cleanup, fixture, PNG } from "./owned-fixture";

afterEach(cleanup);

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

test("Med runs an ACP agent and keeps its thread", async () => {
  const { api, stateDir, thread, start } = await fixture();
  // An ACP agent tells its models only in a session.
  expect((await api<AgentOptions>("/api/agents/fake/choices")).data).toEqual({});
  const session = await start("fake");
  expect(session.review.session).toMatchObject({ agent: "acp", name: "Fake ACP", id: session.id });
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
  await api(`/api/sessions/${session.thread}/agent/messages`, {
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
  await api(`/api/sessions/${session.thread}/agent/messages`, {
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

test("Med runs Codex through its app-server: a card asks, Send now steers, a subagent nests, and Stop ends the turn", async () => {
  // The fake replays a recorded Codex 0.160 session (codex-app-server.jsonl).
  const { api, thread, start } = await fixture();
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
  expect(session.review.session).toMatchObject({ agent: "codex", id: session.id });
  const ready = await session.until((state) => state.status === "idle");
  expect(ready.capabilities).toMatchObject({ steer: true, interrupt: true, approvals: "ask" });
  expect(ready.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "gpt-6-luna"],
    ["effort", "default"],
    ["mode", "default"],
  ]);
  const replies = await thread(session.id);
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
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
  const queued = await api<{ message: AgentMessage }>(
    `/api/sessions/${session.thread}/agent/messages`,
    {
      text: "Also end your reply with the word steered.",
      noteIds: [],
      afterTurn: true,
    },
  );
  expect(queued.data.message).toMatchObject({ delivery: "pending", queued: true, afterTurn: true });
  expect(
    (await api(`/api/sessions/${session.thread}/agent/send-now`, { id: queued.data.message.id }))
      .status,
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
  const { api, home, thread, start } = await fixture();
  const session = await start("agy");
  expect(session.review.session).toMatchObject({
    agent: "acp",
    name: "Antigravity",
    id: session.id,
  });
  const ready = await session.until((state) => state.status === "idle");
  expect(ready.capabilities).toMatchObject({ steer: false, approvals: "rules" });
  expect(ready.settings.find((setting) => setting.id === "mode")?.value).toBe("accept-edits");
  const replies = await thread(session.id);
  const notices = () =>
    replies.events.flatMap((event) =>
      event.update.sessionUpdate === "notice" ? [event.update.title] : [],
    );
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
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
    (await api(`/api/sessions/${session.thread}/agent/send-now`, { id: queued.data.message.id }))
      .status,
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

test("an agy conversation continues in Med once its process ends, from its history", async () => {
  const { api, home, repo, start, thread } = await fixture();
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
    await api(`/api/sessions/${owned.thread}/agent/messages`, {
      text: "Run ls -1, then name the files.",
      noteIds: [],
    });
    await owned.until((state) => !!state.permission);

    // Fork in Med makes the agy conversation a thread at once, with its
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
    const listed = await api<ThreadList>("/api/threads");
    const row = listed.data.threads.find((each) => each.id === adopted.data.id);
    expect(row?.session).toMatchObject({ agent: "acp", name: "Antigravity" });
    const session = { thread: adopted.data.id };
    expect((await adopt()).data).toMatchObject({ id: adopted.data.id, created: false });
    const replies = await thread(adopted.data.id);
    await vi.waitFor(() => expect(replies()).toEqual(["There is one: summary.ts."]));
    const send = (text: string) =>
      api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
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

test("Antigravity is off until the user turns it on: Med does not offer it or continue its conversations", async () => {
  const { api, home, repo, review } = await fixture({ agy: false });
  const agy = "2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d";
  const terminal = await holdOpen(repo, [
    join(home, ".gemini", "antigravity-cli", "presence", `${agy}.lock`),
  ]);
  try {
    const agents = await api<{ agents: { id: string }[] }>("/api/agents");
    expect(agents.data.agents.map((agent) => agent.id)).not.toContain("agy");
    expect((await api(`/api/reviews/${review.id}/start`, { preset: "agy" })).status).toBe(404);
    expect((await api("/api/agents/agy/choices")).status).toBe(404);
    const adopt = await api("/api/sessions/adopt", { agent: "agy", session: agy, repo });
    expect(adopt.status).toBe(404);
  } finally {
    await terminal.end();
  }
});
