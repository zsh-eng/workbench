import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";
import type { SessionSummary } from "../../src/shared/session-summary";
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

const session = "7a1c2a8e-1111-4222-8333-944455556666";
const at = (second: number) => new Date(Date.now() - 60_000 + second * 1000).toISOString();
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const user = (second: number, content: unknown) => ({
  type: "user",
  timestamp: at(second),
  uuid: `u${second}`,
  message: { role: "user", content },
});
const assistant = (second: number, block: unknown, stop = "tool_use") => ({
  type: "assistant",
  timestamp: at(second),
  uuid: `a${second}`,
  message: { id: `a${second}`, role: "assistant", stop_reason: stop, content: [block] },
});

test("the Sessions stream sends each review's lead session with its current turn", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med session summaries ")));
  directories.push(directory);
  const repo = join(directory, "trail-notes");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const home = join(directory, "home");
  const project = join(home, ".claude", "projects", "-work-trail-notes");
  await mkdir(project, { recursive: true });
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
  const create = async (title: string, sessions: unknown[]) =>
    (
      (await (
        await api("/api/reviews", {
          method: "POST",
          body: JSON.stringify({
            title,
            targets: [{ repo, comparison: { kind: "working" } }],
            sessions,
          }),
        })
      ).json()) as { id: string }
    ).id;
  const agentReview = await create("Format durations", [
    { agent: "claude", id: session, cwd: repo },
  ]);
  const plainReview = await create("No agent", []);

  // One finished turn: a prompt, an edit, a test run, and the reply.
  const transcript = join(project, `${session}.jsonl`);
  await writeFile(
    transcript,
    line(user(0, "Format the **durations** as minutes. <!-- reply 1 -->")) +
      line(
        assistant(1, {
          type: "tool_use",
          id: "edit",
          name: "Edit",
          input: {
            file_path: join(repo, "src/summary.ts"),
            old_string: "const label = ms;\nexport { label };",
            new_string: "const label = formatDuration(ms);\nconst unit = 'min';\nexport { label };",
          },
        }),
      ) +
      line(user(2, [{ type: "tool_result", tool_use_id: "edit", content: "Updated" }])) +
      line(
        assistant(3, {
          type: "tool_use",
          id: "test",
          name: "Bash",
          input: { command: "bun test", description: "Run the tests" },
        }),
      ) +
      line(user(4, [{ type: "tool_result", tool_use_id: "test", content: "7 pass" }])) +
      line(
        assistant(
          5,
          { type: "text", text: "Durations now read as minutes in [summary.ts](src/summary.ts)." },
          "end_turn",
        ),
      ),
  );

  const response = await api(`/api/sessions/events?reviews=${agentReview},${plainReview},missing`);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const received: SessionSummary[][] = [];
  const controller = new AbortController();
  streams.push(controller);
  void readServerEvents(
    response.body!,
    (event) => received.push(JSON.parse(event.data).sessions),
    controller.signal,
    1024 * 1024,
  ).catch(() => {});

  // A review without sessions, or one that does not exist, is left out.
  await vi.waitFor(() => expect(received[0]).toHaveLength(1), { timeout: 5000 });
  expect(received[0]![0]).toMatchObject({
    reviewId: agentReview,
    sessionId: session,
    agent: "claude",
    state: "idle",
    title: "Format durations",
    repository: "trail-notes",
    root: repo,
    sessions: [{ agent: "claude", id: session }],
    prompt: "Format the durations as minutes.",
    steps: [
      { id: "edit", kind: "edit", status: "done", added: 2, removed: 1 },
      { id: "test", kind: "execute", title: "Run the tests", status: "done" },
    ],
    reply: "Durations now read as minutes in summary.ts.",
  });
  expect(received[0]![0]!.ask).toBeUndefined();

  // A new prompt starts the next turn; its open call runs.
  await appendFile(
    transcript,
    line(user(10, "Add hours too.")) +
      line(
        assistant(11, {
          type: "tool_use",
          id: "read",
          name: "Read",
          input: { file_path: join(repo, "src/duration.ts") },
        }),
      ),
  );
  await vi.waitFor(
    () =>
      expect(received.at(-1)![0]).toMatchObject({
        state: "working",
        prompt: "Add hours too.",
        steps: [{ id: "read", kind: "read", status: "running" }],
      }),
    { timeout: 5000 },
  );
  expect(received.at(-1)![0]!.reply).toBeUndefined();
});
