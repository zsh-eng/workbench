import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
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
  const host = await startHost({
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
  });
  hosts.push(host);
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
  const start = async (preset: string) => {
    const started = await api<{ review: SavedReview; state: OwnedState }>(
      `/api/reviews/${review.id}/owned`,
      { preset },
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
    return { id, review: started.data.review, state, until, act };
  };
  return { api, review, stateDir, thread, start };
}

test("Med starts Claude Code, sends review messages as prompts, and answers its questions", async () => {
  const { api, review, thread, start } = await fixture();
  const agents = await api<{ agents: unknown[] }>("/api/agents");
  expect(agents.data.agents).toEqual([
    { id: "claude", name: "Claude Code", kind: "claude", available: true },
    { id: "fake", name: "Fake ACP", kind: "acp", available: true },
    { id: "missing", name: "Missing", kind: "acp", available: false },
  ]);
  expect((await api(`/api/reviews/${review.id}/owned`, { preset: "missing" })).status).toBe(404);

  const session = await start("claude");
  expect(session.review.sessions).toMatchObject([{ agent: "claude", id: session.id }]);
  const ready = await session.until(
    (state) => state.status === "idle" && state.settings.length > 0,
  );
  expect(ready.settings.map((setting) => [setting.id, setting.value])).toEqual([
    ["model", "default"],
    ["effort", "default"],
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
    expect(replies()).toEqual([
      "Model default, effort default, mode default: Format the durations.",
    ]),
  );
  const answered = await session.until((state) => state.context !== undefined);
  expect(answered.context).toEqual({ used: 2500, total: 10_000 });

  // An effort change starts Claude Code again with the same session.
  expect((await session.act({ action: "setting", id: "effort", value: "high" })).status).toBe(200);
  await session.until((state) => state.status === "idle");
  await session.act({ action: "prompt", text: "Check the summary." });
  await vi.waitFor(() =>
    expect(replies().at(-1)).toBe("Model default, effort high, mode default: Check the summary."),
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

  await session.act({ action: "stop" });
  expect((await session.act({ action: "prompt", text: "Again." })).status).toBe(409);
});

test("Med runs an ACP agent and keeps its thread", async () => {
  const { api, review, stateDir, thread, start } = await fixture();
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

  // Med keeps the updates, so the thread stays after the agent stops.
  await session.act({ action: "stop" });
  const log = await readFile(join(stateDir, "sessions", `${session.id}.jsonl`), "utf8");
  expect(log).toContain("Outcome: selected allow");
  const again = await thread(session.id);
  await vi.waitFor(() => expect(again()).toEqual(replies()));
});
