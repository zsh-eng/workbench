import { afterEach, expect, test, vi } from "vitest";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentOptions, OwnedState } from "../../src/shared/owned-session";
import { cleanup, fixture, PNG } from "./owned-fixture";

afterEach(cleanup);

test("Med starts Claude Code, sends review messages as prompts, and answers its questions", async () => {
  // A host that a Claude Code session started has the session's variables,
  // such as its bare mode; Claude Code that Med starts uses the user's login.
  vi.stubEnv("CLAUDE_CODE_SIMPLE", "1");
  const { api, review, thread, start, home } = await fixture();
  const args = async (id: string) =>
    JSON.parse(
      await readFile(join(home, ".claude", "projects", "-fake-repo", `${id}.args.json`), "utf8"),
    ) as string[];
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
      capabilities: expect.objectContaining({ steer: false, approvals: "ask" }),
    },
    {
      id: "pi",
      name: "Pi",
      kind: "pi",
      available: true,
      // Pi asks nothing itself: Med's rules decide its tools.
      capabilities: expect.objectContaining({ steer: false, approvals: "rules" }),
    },
    expect.objectContaining({ id: "missing", available: false }),
  ]);
  expect((await api(`/api/reviews/${review.id}/start`, { preset: "missing" })).status).toBe(404);

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
  expect(session.review.session).toMatchObject({ agent: "claude", id: session.id });
  expect(session.thread).toBe(`claude-${session.id}`);
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
    `/api/sessions/${session.thread}/agent/messages`,
    { text: "Format the durations.", noteIds: [] },
  );
  expect(sent.data.message.delivery).toBe("delivered");
  await vi.waitFor(() =>
    expect(replies()).toEqual(["Model opus, effort medium, mode auto: Format the durations."]),
  );
  const answered = await session.until((state) => state.context !== undefined);
  // What fills the window, as Claude Code's /context shows it.
  expect(answered.context).toEqual({
    used: 2500,
    total: 10_000,
    breakdown: {
      categories: [
        { name: "System prompt", tokens: 400, kind: "used" },
        { name: "MCP tools (deferred)", tokens: 900, kind: "deferred" },
        { name: "Messages", tokens: 2100, kind: "used" },
        { name: "Autocompact buffer", tokens: 1000, kind: "buffer" },
        { name: "Free space", tokens: 6500, kind: "free" },
      ],
      mcpServers: [{ name: "docs", tools: 2, tokens: 900 }],
      memoryFiles: [{ path: "/repo/CLAUDE.md", tokens: 120 }],
      agents: [{ name: "reviewer", tokens: 40 }],
      skills: [{ name: "med", tokens: 80 }],
      at: expect.any(Number),
    },
  });

  // An effort change applies to the running Claude Code, which goes on as it
  // started: no new process, so the turn and its cache go on.
  const launched = await args(session.id);
  expect((await session.act({ action: "setting", id: "effort", value: "high" })).status).toBe(200);
  await session.act({ action: "prompt", text: "Check the summary." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Model opus, effort high, mode auto: Check the summary."),
  );
  expect(await args(session.id)).toEqual(launched);
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
  await api(`/api/sessions/${session.thread}/agent/messages`, {
    text: "Why does this differ?",
    noteIds: [],
    images: [{ mimeType: "image/png", data: PNG }],
  });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Saw base64 image/png: Why does this differ?"),
  );

  await session.act({ action: "stop" });
  expect((await session.act({ action: "prompt", text: "Again." })).status).toBe(409);
  // A session that the user stopped takes no message from the review either.
  const stopped = await api<{ error: { code: string } }>(
    `/api/sessions/${session.thread}/agent/messages`,
    { text: "Compare with this.", noteIds: [] },
  );
  expect(stopped.status).toBe(409);
  expect(stopped.data.error.code).toBe("session-stopped");
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

test("Claude Code that Med runs streams its reply after it thinks; a turn that another process runs on the session works until it ends", async () => {
  vi.stubEnv("MED_FAKE_WORD_MS", "60");
  const { api, home, thread, start, threads } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle");
  const states = await session.follow();
  const replies = await thread(session.id);
  await api(`/api/sessions/${session.thread}/agent/messages`, {
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
  // The text block's end marks the reply whole at once, before the
  // transcript has it, so the thread can show its last paragraph.
  expect(streamed.at(-1)!.streaming).toEqual({ id: expect.any(String), text: reply, ended: true });
  expect(streamed.slice(0, -1).some((state) => state.streaming!.ended)).toBe(false);

  // Another process, such as Claude Code in a terminal, runs a turn on the
  // session while Med's runner waits. The transcript tells the turn's state.
  const latest = await threads();
  const lead = () => latest.value.find((entry) => entry.id === session.thread);
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
