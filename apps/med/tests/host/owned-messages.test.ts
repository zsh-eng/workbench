import { afterEach, expect, test, vi } from "vitest";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentInboxState, AgentMessage } from "../../src/shared/agent-inbox";
import type { SavedReview } from "../../src/shared/saved-review";
import { cleanup, fixture } from "./owned-fixture";

afterEach(cleanup);

test("a message sent while Claude Code works waits for its next step: it comes back until then, outlasts a host restart, and joins the turn when a tool runs", async () => {
  vi.stubEnv("MED_FAKE_TOOL_MS", "1500");
  const { api, thread, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const send = (text: string) =>
    api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
      text,
      noteIds: [],
    });
  const messages = async () =>
    (await api<AgentInboxState>(`/api/sessions/${session.thread}/agent`)).data.messages;

  // A turn that runs no tool: a message waits for its end.
  await session.act({ action: "prompt", text: "Wait for the build." });
  await session.until((state) => state.status === "working");
  const first = await send("Use two spaces.");
  expect(first.data.message).toMatchObject({ delivery: "pending", queued: true });
  // Until the agent has it, the user can take it back, to edit it or drop it.
  const taken = await api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/take`, {
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
    (await api(`/api/sessions/${session.thread}/agent/take`, { id: second.data.message.id }))
      .status,
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
  const { api, thread, start, restart } = await fixture();
  const session = await start("claude");
  await session.until((state) => state.status === "idle" && state.settings.length > 0);
  const send = (text: string, afterTurn = false) =>
    api<{ message: AgentMessage }>(`/api/sessions/${session.thread}/agent/messages`, {
      text,
      noteIds: [],
      afterTurn,
    });
  const messages = async () =>
    (await api<AgentInboxState>(`/api/sessions/${session.thread}/agent`)).data.messages;
  await send("Work on the check.");
  await session.until((state) => state.status === "working");
  const later = await send("Then update the docs.", true);
  expect(later.data.message).toMatchObject({ delivery: "pending", afterTurn: true });

  // A new host keeps the flag; then Send now lets the tool step take it.
  await restart();
  expect((await messages()).at(-1)).toMatchObject({ delivery: "pending", afterTurn: true });
  const replies = await thread(session.id);
  const now = await api(`/api/sessions/${session.thread}/agent/send-now`, {
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
    (await api(`/api/sessions/${session.thread}/agent/send-now`, { id: later.data.message.id }))
      .status,
  ).toBe(409);
});

test("the thread list follows each thread's lead session: working, needs you, and idle", async () => {
  const { api, repo, home, start, threads } = await fixture();
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
  await api<SavedReview>("/api/reviews", {
    title: "Durations in the export",
    targets: [{ repo, comparison: { kind: "working" } }],
    session: { agent: "claude", id: attached, cwd: repo },
  });
  const session = await start("fake");
  await session.until((state) => state.status === "idle");

  const latest = await threads();
  const of = (id: string) => latest.value.find((entry) => entry.id === id);
  await vi.waitFor(() => {
    expect(of(`claude-${attached}`)).toMatchObject({ agent: "claude", state: "working" });
    expect(of(session.thread)).toMatchObject({ agent: "acp", state: "idle" });
  });
  expect(of(`claude-${attached}`)!.session).toEqual({ agent: "claude", id: attached, cwd: repo });

  // A permission request needs the user; the answer lets the turn finish.
  await session.act({ action: "prompt", text: "Edit summary.ts." });
  await vi.waitFor(() => expect(of(session.thread)?.state).toBe("waiting"), { timeout: 5000 });
  const asked = await session.until((state) => state.permission !== undefined);
  await session.act({ action: "permission", id: asked.permission!.id, option: "allow" });
  await vi.waitFor(() => expect(of(session.thread)?.state).toBe("idle"), { timeout: 5000 });

  // The attached session ends its turn when its transcript says so.
  const before = of(`claude-${attached}`)!.updatedAt;
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
      expect(of(`claude-${attached}`)?.state).toBe("idle");
      expect(of(`claude-${attached}`)!.updatedAt).toBeGreaterThanOrEqual(before);
    },
    { timeout: 5000 },
  );
});
