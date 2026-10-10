import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionEvent } from "../../src/shared/agent-session";
import { startHost, type RunningHost } from "../../src/host/server";
import { readServerEvents } from "../../src/web/data/sse";

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

const session = "5f0c2a8e-1111-4222-8333-944455556666";
const at = (second: number) => `2026-10-10T09:00:${String(second).padStart(2, "0")}.000Z`;
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const assistant = (second: number, uuid: string, block: unknown, stop = "tool_use") => ({
  type: "assistant",
  timestamp: at(second),
  uuid,
  message: { id: uuid, role: "assistant", stop_reason: stop, content: [block] },
});

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med session stream ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const home = join(directory, "home");
  const project = join(home, ".claude", "projects", "-work-repo");
  await mkdir(join(project, session, "subagents"), { recursive: true });
  vi.stubEnv("MED_HOME_DIR", home);
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
  });
  hosts.push(host);
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${host.port}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
    });
  const saved = (await (
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        title: "Format durations",
        targets: [{ repo, comparison: { kind: "working" } }],
        sessions: [{ agent: "claude", id: session, cwd: repo }],
      }),
    })
  ).json()) as { id: string };
  return {
    api,
    saved,
    transcript: join(project, `${session}.jsonl`),
    subagents: join(project, session, "subagents"),
  };
}

/** Reads a session stream and waits for the events that a check needs. */
function listen(response: Response) {
  const received: { event: string; events: SessionEvent[]; idle: boolean }[] = [];
  const controller = new AbortController();
  streams.push(controller);
  void readServerEvents(
    response.body!,
    (event) => received.push({ event: event.event, ...JSON.parse(event.data) }),
    controller.signal,
    4 * 1024 * 1024,
  ).catch(() => {});
  return received;
}

test("a review's agent session streams its transcript, then new lines and subagents", async () => {
  const { api, saved, transcript, subagents } = await fixture();
  await writeFile(
    transcript,
    line({
      type: "user",
      timestamp: at(0),
      cwd: "/work/repo",
      message: { role: "user", content: "Format the durations." },
    }) +
      line(
        assistant(2, "a1", {
          type: "tool_use",
          id: "test",
          name: "Bash",
          input: { command: "bun test", description: "Run the tests" },
        }),
      ),
  );
  const response = await api(`/api/reviews/${saved.id}/sessions/${session}/events`);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const received = listen(response);
  await vi.waitFor(() => expect(received[0]?.event).toBe("reset"));
  expect(received[0]!.idle).toBe(false);
  expect(received[0]!.events.map((event) => event.update.sessionUpdate)).toEqual([
    "user_message_chunk",
    "tool_call",
  ]);
  // The command reaches the browser; the rest of the tool's input does not.
  expect(received[0]!.events[1]!.update).toMatchObject({ rawInput: { command: "bun test" } });

  await appendFile(
    transcript,
    line({
      type: "user",
      timestamp: at(3),
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "test", content: "7 pass" }],
      },
    }) +
      line(
        assistant(4, "a2", {
          type: "tool_use",
          id: "agent",
          name: "Agent",
          input: { description: "Check the edge cases", prompt: "…" },
        }),
      ),
  );
  await writeFile(
    join(subagents, "agent-sub1.jsonl"),
    line(assistant(5, "s1", { type: "text", text: "Zero rounds to 0 min." }, "end_turn")),
  );
  await appendFile(
    transcript,
    line({
      type: "user",
      timestamp: at(6),
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "agent", content: "Done" }],
      },
      toolUseResult: { status: "completed", agentId: "sub1" },
    }) +
      line(
        assistant(7, "a3", { type: "text", text: "Durations now read as minutes." }, "end_turn"),
      ),
  );
  await vi.waitFor(
    () => {
      const updates = received.slice(1).flatMap((part) => part.events);
      expect(updates).toContainEqual(
        expect.objectContaining({
          update: expect.objectContaining({ toolCallId: "test", status: "completed" }),
        }),
      );
      expect(updates).toContainEqual(
        expect.objectContaining({
          update: expect.objectContaining({
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Zero rounds to 0 min." },
            _meta: { med: { parentToolCallId: "agent" } },
          }),
        }),
      );
      expect(received.at(-1)!.idle).toBe(true);
    },
    { timeout: 5000 },
  );
});

test("a session the review does not record, or without a transcript, is not found", async () => {
  const { api, saved } = await fixture();
  expect((await api(`/api/reviews/${saved.id}/sessions/other-session/events`)).status).toBe(404);
  const missing = await api(`/api/reviews/${saved.id}/sessions/${session}/events`);
  expect(missing.status).toBe(404);
  expect(await missing.json()).toMatchObject({ error: { code: "transcript-not-found" } });
});

test("a long session pages back from its tail, and its prompts form a turn index", async () => {
  const { api, saved, transcript } = await fixture();
  const user = (second: number, content: unknown) => ({
    type: "user",
    timestamp: at(second),
    uuid: `u${second}`,
    message: { role: "user", content },
  });
  // The early call's result comes after 8.5 MB of replies, in the tail.
  const filler = "x".repeat(10_000);
  await writeFile(
    transcript,
    line(user(0, "First prompt")) +
      line(
        assistant(1, "a1", {
          type: "tool_use",
          id: "early",
          name: "Bash",
          input: { command: "bun run build", description: "Build" },
        }),
      ) +
      Array.from({ length: 850 }, (_, index) =>
        line(assistant(2, `f${index}`, { type: "text", text: filler }, "end_turn")),
      ).join("") +
      line(user(3, [{ type: "tool_result", tool_use_id: "early", content: "built" }])) +
      line(user(4, "Second prompt")) +
      line(assistant(5, "a2", { type: "text", text: "Done." }, "end_turn")),
  );
  const received = listen(await api(`/api/reviews/${saved.id}/sessions/${session}/events`));
  await vi.waitFor(() => expect(received[0]?.event).toBe("reset"));
  const first = received[0] as unknown as { truncated: boolean; start: number };
  expect(first.truncated).toBe(true);
  expect(first.start).toBeGreaterThan(0);
  const tail = () => received.flatMap((part) => part.events.map((event) => event.update));
  // The result goes to the browser, which keeps it until the page with its call.
  await vi.waitFor(() =>
    expect(tail()).toContainEqual(
      expect.objectContaining({ sessionUpdate: "tool_call_update", toolCallId: "early" }),
    ),
  );
  expect(JSON.stringify(tail())).not.toContain("First prompt");

  const page = (await (
    await api(`/api/reviews/${saved.id}/sessions/${session}/page?before=${first.start}`)
  ).json()) as { events: SessionEvent[]; start: number };
  expect(page.start).toBe(0);
  expect(page.events.slice(0, 2).map((event) => event.update)).toMatchObject([
    { sessionUpdate: "user_message_chunk", content: { text: "First prompt" } },
    { sessionUpdate: "tool_call", toolCallId: "early", title: "Build" },
  ]);

  const turns = (await (
    await api(`/api/reviews/${saved.id}/sessions/${session}/turns`)
  ).json()) as { turns: { offset: number; text: string }[] };
  expect(turns.turns.map((turn) => turn.text)).toEqual(["First prompt", "Second prompt"]);
  expect(turns.turns[0]!.offset).toBe(0);
  expect(turns.turns[1]!.offset).toBeGreaterThan(first.start);
  // The index grows with the transcript.
  await appendFile(transcript, line(user(6, "Third prompt")));
  const more = (await (await api(`/api/reviews/${saved.id}/sessions/${session}/turns`)).json()) as {
    turns: { text: string }[];
  };
  expect(more.turns.map((turn) => turn.text)).toEqual([
    "First prompt",
    "Second prompt",
    "Third prompt",
  ]);
});
