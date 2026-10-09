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
