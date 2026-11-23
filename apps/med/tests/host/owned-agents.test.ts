import { afterEach, expect, test, vi } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
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

test("Med runs Antigravity through its ACP server: it asks before an edit, Stop keeps its process, and its session goes on in a new process after a reboot", async () => {
  const { api, home, thread, start, restart } = await fixture();
  // As any ACP agent, agy tells its models only in a session.
  expect((await api<AgentOptions>("/api/agents/agy/choices")).data).toEqual({});
  const session = await start("agy");
  expect(session.review.session).toMatchObject({
    agent: "acp",
    name: "Antigravity",
    id: session.id,
  });
  const ready = await session.until(
    (state) => state.status === "idle" && state.commands.length > 0,
  );
  expect(ready.capabilities).toMatchObject({
    steer: false,
    approvals: "ask",
    images: true,
    resume: true,
  });
  expect(ready.settings.map((setting) => [setting.id, setting.category, setting.value])).toEqual([
    ["model", "model", "gemini-4-neon"],
    ["thought_level", "effort", "high"],
    ["mode", "mode", "accept-edits"],
  ]);
  expect((await api<AgentOptions>("/api/agents/agy/choices")).data).toMatchObject({
    model: {
      value: "gemini-4-neon",
      options: [{ value: "gemini-4-neon" }, { value: "gemini-4-hydrogen" }],
    },
    effort: { value: "high" },
  });
  const runs = async () =>
    (await readFile(join(home, "agy-runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args?: string[]; method?: string; sessionId?: string });
  const processes = async () => (await runs()).filter((run) => run.args);
  // Med starts agy's ACP server, not its print mode, which runs edits unasked.
  expect((await processes()).map((run) => run.args)).toEqual([["acp"]]);
  const conversation = (await runs()).find((run) => run.method === "session/new")!.sessionId!;
  const replies = await thread(session.id);
  const notices = (events: SessionEvent[]) =>
    events.flatMap((event) =>
      event.update.sessionUpdate === "notice" ? [event.update.title] : [],
    );

  // Med starts agy in its accept-edits mode: an edit goes through, and agy
  // asks before a command.
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Edited summary.ts."));
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Run ls -1, then name the files." });
  const command = await session.until((state) => state.permission !== undefined);
  expect(command.permission).toMatchObject({
    title: "Antigravity wants to run ls -1",
    options: [
      { id: "allow", kind: "allow_once" },
      { id: "deny", kind: "reject_once" },
    ],
  });
  await session.act({ action: "permission", id: command.permission!.id, option: "allow" });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Ran ls -1."));
  await session.until((state) => state.status === "idle");
  // In agy's default mode it asks before an edit too: the card names the
  // file. A refusal fails the call and ends the turn; agy says nothing more.
  await session.act({ action: "setting", id: "mode", value: "default" });
  await session.act({ action: "prompt", text: "Edit summary.ts again." });
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked.permission).toMatchObject({ title: "Antigravity wants to edit summary.ts" });
  await session.act({ action: "permission", id: asked.permission!.id, option: "deny" });
  await session.until((state) => state.status === "idle" && !state.permission);
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) =>
          event.update.sessionUpdate === "tool_call_update" &&
          event.update.toolCallId === "call_3" &&
          event.update.status === "failed",
      ),
    ).toBe(true),
  );
  expect(replies().at(-1)).toBe("Ran ls -1.");

  // It takes images.
  await api(`/api/sessions/${session.thread}/agent/messages`, {
    text: "Look.",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Saw image/png: Look."));
  await session.until((state) => state.status === "idle");

  // Stop interrupts the turn; agy's process stays for the next message.
  await session.act({ action: "prompt", text: "Run sleep 30, then say done." });
  const sleep = await session.until((state) => state.permission !== undefined);
  await session.act({ action: "permission", id: sleep.permission!.id, option: "allow" });
  await session.until((state) => state.status === "working" && !state.permission);
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");
  await vi.waitFor(() => expect(notices(replies.events)).toContain("Interrupted"));
  await session.act({ action: "setting", id: "model", value: "gemini-4-hydrogen" });
  await session.act({ action: "setting", id: "thought_level", value: "low" });
  await session.act({ action: "setting", id: "mode", value: "accept-edits" });
  await session.act({ action: "prompt", text: "Say ok." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("(gemini-4-hydrogen, low, accept-edits) turn 6: Say ok."),
  );
  await session.until((state) => state.status === "idle");
  expect(await processes()).toHaveLength(1);

  // A host restart leaves agy in its holder.
  await restart();
  const after = await thread(session.id);
  await session.act({ action: "prompt", text: "Still here?" });
  await vi.waitFor(() =>
    expect(after().at(-1)).toBe("(gemini-4-hydrogen, low, accept-edits) turn 7: Still here?"),
  );
  await session.until((state) => state.status === "idle");
  expect(await processes()).toHaveLength(1);

  // After a reboot no process runs. The session waits with the choices it
  // had, and takes a new one; the next message goes on with agy's
  // conversation in a new process, which Med tells the choices again.
  await restart({ reboot: true });
  const back = await session.until((state) => state.settings.length > 0);
  expect(back.status).toBe("idle");
  expect(back.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "gemini-4-hydrogen"],
    ["thought_level", "low"],
  ]);
  await session.act({ action: "setting", id: "thought_level", value: "medium" });
  expect(await processes()).toHaveLength(1);
  const resumed = await thread(session.id);
  await session.act({ action: "prompt", text: "And now?" });
  await vi.waitFor(
    () =>
      expect(resumed().at(-1)).toBe("(gemini-4-hydrogen, medium, accept-edits) turn 8: And now?"),
    { timeout: 5000 },
  );
  expect(await processes()).toHaveLength(2);
  expect((await runs()).at(-1)).toEqual({ method: "session/resume", sessionId: conversation });
  // The thread has each turn once: agy replays nothing.
  expect(resumed().filter((reply) => reply.includes("Still here?"))).toHaveLength(1);

  // A turn that a reboot cuts waits as Interrupted; Continue asks agy to go
  // on, in a new process.
  await session.until((state) => state.status === "idle");
  await session.act({ action: "setting", id: "mode", value: "auto" });
  await session.act({ action: "prompt", text: "Run sleep 30, then say done." });
  await session.until((state) => state.status === "working");
  await restart({ reboot: true });
  const cut = await session.until((state) => state.halt !== undefined);
  expect(cut).toMatchObject({ status: "idle", halt: { kind: "interrupted" } });
  const continued = await thread(session.id);
  await session.act({ action: "continue" });
  await vi.waitFor(
    () => expect(continued().at(-1)).toMatch(/^\(gemini-4-hydrogen, medium, auto\) turn 10: /),
    {
      timeout: 5000,
    },
  );
  expect((await session.state()).halt).toBeUndefined();
  expect(await processes()).toHaveLength(3);

  // A conversation that agy no longer has says so, and each message tries again.
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");
  await restart({ reboot: true });
  await rm(join(home, ".gemini", "antigravity-cli", "brain", conversation), { recursive: true });
  const send = () =>
    api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
      text: "Are you there?",
      noteIds: [],
    });
  for (const count of [4, 5]) {
    expect((await send()).data.message).toMatchObject({
      delivery: "failed",
      error: expect.stringContaining("conversation not found"),
    });
    await vi.waitFor(async () => expect(await processes()).toHaveLength(count));
    await session.until((state) => state.status === "idle");
  }
});

test("an agy conversation from elsewhere continues in Med, from its history: at once, or once the process that has it open ends", async () => {
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
    const transcript = async (id: string) => {
      const brain = join(
        home,
        ".gemini",
        "antigravity-cli",
        "brain",
        id,
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
    };
    await transcript(agy);
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
    // Once agy ends there, the next message goes on with the conversation in
    // Med: agy's ACP server resumes it, and the history shows once.
    await agyTerminal.end();
    expect((await send("Say ok.")).data.message).toMatchObject({ delivery: "delivered" });
    await vi.waitFor(
      () =>
        expect(replies()).toEqual([
          "There is one: summary.ts.",
          "(gemini-4-neon, high, accept-edits) turn 2: Say ok.",
        ]),
      { timeout: 5000 },
    );
    const runs = async () =>
      (await readFile(join(home, "agy-runs.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) => JSON.parse(line) as { args?: string[]; method?: string; sessionId?: string },
        );
    expect((await runs()).at(-1)).toEqual({ method: "session/resume", sessionId: agy });

    // A conversation that no process has open starts in Med at once: agy
    // replays it, and the replay is the thread's history.
    const closed = "3b4c5d6e-7f8a-4b9c-8d0e-2f3a4b5c6d7e";
    await transcript(closed);
    const second = await api<{ id: string; created: boolean }>("/api/sessions/adopt", {
      agent: "agy",
      session: closed,
      repo,
      title: "Name the files again",
    });
    expect(second.data).toMatchObject({ created: true });
    const replayed = await thread(second.data.id);
    await vi.waitFor(() => expect(replayed()).toEqual(["There is one: summary.ts."]));
    expect((await runs()).at(-1)).toEqual({ method: "session/load", sessionId: closed });
    await api(`/api/sessions/${second.data.id}/agent/messages`, { text: "Say ok.", noteIds: [] });
    await vi.waitFor(() =>
      expect(replayed()).toEqual([
        "There is one: summary.ts.",
        "(gemini-4-neon, high, accept-edits) turn 2: Say ok.",
      ]),
    );
  } finally {
    for (const end of ends) await end().catch(() => {});
  }
});

test("Med runs Pi through its bridge: its models before a session, tool calls, Stop, an extension's question, and its session goes on after a reboot", async () => {
  const { api, home, thread, start, restart } = await fixture();
  const runs = async () =>
    (await readFile(join(home, "pi-runs.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[] });
  // Pi lists its models without a session and offline: no model answers.
  // Each model keeps its provider, as the picker's sections; a model that
  // does not reason has one level.
  const offered = (await api<AgentOptions>("/api/agents/pi/choices")).data;
  expect(offered.model).toMatchObject({
    value: "openai-codex/gpt-5.4",
    options: [
      { value: "openai-codex/gpt-5.4", name: "GPT-5.4", group: "ChatGPT" },
      { value: "openai-codex/gpt-5.4-mini", name: "GPT-5.4 Mini", group: "ChatGPT" },
      { value: "openrouter/deepseek/deepseek-v4-flash", group: "OpenRouter" },
    ],
  });
  expect(offered.effort).toMatchObject({ value: "medium" });
  expect(offered.efforts?.["openrouter/deepseek/deepseek-v4-flash"]).toEqual(["off"]);
  expect(offered.efforts?.["openai-codex/gpt-5.4"]).toContain("xhigh");
  expect((await runs()).map((run) => run.args)).toEqual([
    ["--mode", "rpc", "--no-session", "--offline"],
  ]);

  const session = await start("pi", { model: "openai-codex/gpt-5.4-mini", effort: "low" });
  expect(session.review.session).toMatchObject({ agent: "acp", name: "Pi", id: session.id });
  const ready = await session.until(
    (state) =>
      state.status === "idle" &&
      state.settings.find((setting) => setting.id === "thought_level")?.value === "low",
  );
  // Pi runs its tools without asking; it takes images and Stop.
  expect(ready.capabilities).toMatchObject({ approvals: "rules", images: true, resume: true });
  expect(ready.settings.map((setting) => [setting.id, setting.category, setting.value])).toEqual([
    ["model", "model", "openai-codex/gpt-5.4-mini"],
    ["thought_level", "effort", "low"],
  ]);
  const replies = await thread(session.id);
  await session.act({ action: "prompt", text: "Format the durations." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("(gpt-5.4-mini, low) turn 1: Format the durations."),
  );
  await session.until((state) => state.status === "idle");

  // A command and an edit are tool calls: the command by its line, the edit
  // with its diff.
  await session.act({ action: "prompt", text: "Run ls -1, then name the files." });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Ran ls -1."));
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Edited summary.ts."));
  const calls = replies.events.flatMap((event) =>
    event.update.sessionUpdate === "tool_call" ? [event.update] : [],
  );
  expect(calls.map((call) => [call.title, call.kind])).toEqual([
    ["ls -1", "execute"],
    ["Edit summary.ts", "edit"],
  ]);
  expect(calls[1]!.content).toEqual([
    expect.objectContaining({
      type: "diff",
      oldText: "export const best = 1;\n",
      newText: "export const best = 2;\n",
    }),
  ]);
  await session.until((state) => state.status === "idle");

  // A model without levels has Off alone; the level comes back with a model
  // that has it.
  await session.act({
    action: "setting",
    id: "model",
    value: "openrouter/deepseek/deepseek-v4-flash",
  });
  const flash = await session.state();
  expect(flash.settings.find((setting) => setting.id === "thought_level")).toMatchObject({
    value: "off",
    options: [{ value: "off" }],
  });
  await session.act({ action: "setting", id: "model", value: "openai-codex/gpt-5.4" });
  await session.act({ action: "setting", id: "thought_level", value: "high" });

  // An extension's question is a card in Med, in the extension's words.
  await session.act({ action: "prompt", text: "Clean the build." });
  const asked = await session.until((state) => state.permission !== undefined);
  expect(asked.permission).toMatchObject({
    title: "Allow bash?",
    detail: "rm -rf build",
    options: [
      { name: "Yes", kind: "allow_once" },
      { name: "No", kind: "reject_once" },
    ],
  });
  await session.act({
    action: "permission",
    id: asked.permission!.id,
    option: asked.permission!.options[0]!.id,
  });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Cleaned."));
  await session.until((state) => state.status === "idle" && !state.permission);

  // It takes images.
  await api(`/api/sessions/${session.thread}/agent/messages`, {
    text: "Look.",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("Saw image/png: Look."));
  await session.until((state) => state.status === "idle");

  // Pi's model failing ends the turn with its error.
  await session.act({ action: "prompt", text: "Fail now." });
  const failed = await session.until((state) => state.status === "idle" && !!state.error);
  expect(failed.error).toContain("429 Rate limited");

  // Stop aborts the turn; Pi's process stays for the next message.
  await session.act({ action: "prompt", text: "Run sleep 30, then say done." });
  await session.until((state) => state.status === "working");
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) => event.update.sessionUpdate === "tool_call" && event.update.title === "sleep 30",
      ),
    ).toBe(true),
  );
  await session.act({ action: "interrupt" });
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Say ok." });
  await vi.waitFor(() => expect(replies().at(-1)).toBe("(gpt-5.4, high) turn 8: Say ok."));
  await session.until((state) => state.status === "idle");
  const before = (await runs()).length;

  // After a reboot no process runs. The session waits with the choices it
  // had; the next message starts Pi again on the session's file, which Med
  // tells the choices again.
  await restart({ reboot: true });
  const back = await session.until((state) => state.settings.length > 0);
  expect(back.status).toBe("idle");
  expect(back.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "openai-codex/gpt-5.4"],
    ["thought_level", "high"],
  ]);
  expect((await runs()).length).toBe(before);
  const resumed = await thread(session.id);
  await session.act({ action: "prompt", text: "And now?" });
  await vi.waitFor(() => expect(resumed().at(-1)).toBe("(gpt-5.4, high) turn 9: And now?"), {
    timeout: 5000,
  });
  const last = (await runs()).at(-1)!.args;
  expect(last.slice(0, 3)).toEqual(["--mode", "rpc", "--session"]);
  expect(last[3]).toMatch(/_[0-9a-f-]{36}\.jsonl$/);
  expect(resumed().filter((reply) => reply.includes("Say ok."))).toHaveLength(1);
});

test("with Antigravity turned off (MED_AGY=0), Med does not offer it or continue its conversations", async () => {
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
