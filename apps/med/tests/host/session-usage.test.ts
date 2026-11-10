import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost } from "../../src/host/server";
import type { ThreadUsage } from "../../src/shared/model-usage";

// A thread's spend and context, read by the host from transcripts that look
// like Claude Code's and Codex's, through the route that the page calls.

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const claude = "6a1d0c2e-1111-4222-8333-944455556666";
const codex = "019a0000-aaaa-7bbb-8ccc-000000000001";
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
/** One line of a response, as Claude Code writes each of its blocks. */
const response = (
  id: string,
  model: string,
  usage: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) =>
  line({
    type: "assistant",
    timestamp: "2026-10-29T09:00:00.000Z",
    message: { id, model, role: "assistant", content: [{ type: "text", text: "…" }], usage },
    ...extra,
  });

test("counts each response once, subagents included, at list price, and the context of the session", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med usage ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const home = join(directory, "home");
  const project = join(home, ".claude", "projects", "-work-repo");
  await mkdir(join(project, claude, "subagents"), { recursive: true });
  // As /autocompact 500k saves it.
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500000 } } }),
  );
  const transcript = join(project, `${claude}.jsonl`);
  await writeFile(
    transcript,
    // Haiku 5.5 with a prompt over 100,000 tokens costs more.
    response("msg_b", "claude-haiku-5-5", { input_tokens: 200_000, output_tokens: 100 }) +
      // A model without a price counts its tokens only. A call that names
      // compact_boundary is a response, not a compaction.
      line({
        type: "assistant",
        timestamp: "2026-10-29T09:00:00.000Z",
        message: {
          id: "msg_d",
          model: "claude-test-unknown",
          role: "assistant",
          content: [
            { type: "tool_use", id: "t1", name: "Grep", input: { pattern: "compact_boundary" } },
          ],
          usage: { input_tokens: 100, output_tokens: 10 },
        },
      }) +
      // Two blocks of one response; the second has the final output count.
      response("msg_a", "claude-opus-5-5", {
        input_tokens: 10,
        output_tokens: 1,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
      }) +
      response("msg_a", "claude-opus-5-5", {
        input_tokens: 10,
        output_tokens: 40,
        cache_read_input_tokens: 50_000,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 },
      }),
  );
  await writeFile(
    join(project, claude, "subagents", "agent-a1.jsonl"),
    response(
      "msg_c",
      "claude-sonnet-5-5",
      { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 2000 },
      { isSidechain: true },
    ),
  );
  const rollouts = join(home, ".codex", "sessions", "2026", "10", "29");
  await mkdir(rollouts, { recursive: true });
  await writeFile(
    join(rollouts, `rollout-2026-10-29T09-00-00-${codex}.jsonl`),
    line({ type: "turn_context", payload: { model: "gpt-test" } }) +
      line({
        type: "event_msg",
        timestamp: "2026-10-29T09:00:05.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 5000,
              cached_input_tokens: 4000,
              output_tokens: 300,
            },
            last_token_usage: { input_tokens: 3000 },
            model_context_window: 272000,
          },
        },
      }) +
      // Codex 0.160 records each response. Over 272K input tokens, a GPT
      // model's long-context rate applies; the running total that follows
      // the record does not count again.
      line({ type: "turn_context", payload: { model: "gpt-6-astra" } }) +
      line({
        type: "token_usage_record",
        payload: {
          response_id: "resp_1",
          usage: { input_tokens: 300_000, cached_input_tokens: 200_000, output_tokens: 1000 },
          thread_token_usage: { input_tokens: 305_000, output_tokens: 1300, total_tokens: 306_300 },
        },
      }) +
      line({
        type: "event_msg",
        timestamp: "2026-10-29T09:00:09.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 305_000,
              output_tokens: 1300,
              total_tokens: 306_300,
            },
            last_token_usage: { input_tokens: 300_000 },
            model_context_window: 400_000,
          },
        },
      }),
  );
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
  // Each session hands off a review, so each is a thread.
  for (const session of [
    { agent: "claude", id: claude, cwd: repo },
    { agent: "codex", id: codex, cwd: repo },
  ])
    await api("/api/reviews", {
      method: "POST",
      body: JSON.stringify({
        title: "Usage",
        targets: [{ repo, comparison: { kind: "working" } }],
        session,
      }),
    });
  const usageOf = async (thread: string) =>
    (await (await api(`/api/thread-usage?id=${thread}`)).json()) as ThreadUsage;
  const usage = () => usageOf(`claude-${claude}`);

  const first = await usage();
  const cost = (model: string) => first.spend.models.find((entry) => entry.model === model)?.cost;
  // 10 × $4 + 40 × $20 + 1,000 × $8 (1-hour writes) + 50,000 × $0.20, per million.
  expect(cost("claude-opus-5-5")).toBeCloseTo(0.01884, 8);
  expect(cost("claude-haiku-5-5")).toBeCloseTo(0.10025, 8);
  // A write without its lifetime is a 5-minute one.
  expect(cost("claude-sonnet-5-5")).toBeCloseTo(0.012, 8);
  expect(first.spend.models.find((entry) => entry.model === "claude-test-unknown")).toMatchObject({
    input: 100,
    output: 10,
    cost: null,
  });
  expect(first.spend.total).toBeCloseTo(0.13109, 8);
  expect(first.spend.subagents).toEqual({ count: 1, cost: expect.closeTo(0.012, 8) });
  expect(first.context).toMatchObject({
    sessionId: claude,
    model: "claude-opus-5-5",
    used: 51_010,
    window: 1_000_000,
    windowFrom: "model",
    compaction: {
      at: 500_000,
      from: "modelSettings in ~/.claude/settings.json",
      approximate: false,
    },
    compacted: false,
  });

  // A compaction after the last request; the next read takes only it.
  await appendFile(transcript, line({ type: "system", subtype: "compact_boundary", uuid: "c1" }));
  const second = await usage();
  expect(second.context?.compacted).toBe(true);
  expect(second.spend.total).toBeCloseTo(0.13109, 8);

  // Codex's thread: its spend, and the window that Codex reports.
  const latest = await usageOf(`codex-${codex}`);
  expect(latest.spend.models.find((entry) => entry.model === "gpt-test")).toMatchObject({
    input: 1000,
    cacheRead: 4000,
    output: 300,
    cost: null,
  });
  // 100,000 × $20 + 200,000 × $2 (cached) + 1,000 × $75, per million.
  expect(latest.spend.models.find((entry) => entry.model === "gpt-6-astra")?.cost).toBeCloseTo(
    2.475,
    8,
  );
  expect(latest.spend.total).toBeCloseTo(2.475, 8);
  expect(latest.context).toMatchObject({
    agent: "codex",
    model: "gpt-6-astra",
    used: 300_000,
    window: 400_000,
  });
  expect(latest.context?.compaction).toBeUndefined();
});

test("a session with hundreds of subagents reads each transcript once, not on every pass", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med usage many ")));
  directories.push(directory);
  const repo = join(directory, "repo");
  await mkdir(repo);
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  const home = join(directory, "home");
  const project = join(home, ".claude", "projects", "-work-repo");
  const subagents = join(project, claude, "subagents");
  await mkdir(subagents, { recursive: true });
  await writeFile(
    join(project, `${claude}.jsonl`),
    response("msg_main", "claude-sonnet-5-5", { input_tokens: 1000, output_tokens: 100 }),
  );
  // More transcripts than Med once kept reads for (128): each pass evicted
  // the reads that the next pass needed, and read every file again.
  const agent = (n: number, output: number) =>
    response(
      `msg_${n}`,
      "claude-sonnet-5-5",
      { input_tokens: 100, output_tokens: output },
      { isSidechain: true },
    );
  for (let n = 0; n < 300; n++) await writeFile(join(subagents, `agent-${n}.jsonl`), agent(n, 500));
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
  await api("/api/reviews", {
    method: "POST",
    body: JSON.stringify({
      title: "Many subagents",
      targets: [{ repo, comparison: { kind: "working" } }],
      session: { agent: "claude", id: claude, cwd: repo },
    }),
  });
  const usage = async () =>
    (await (await api(`/api/thread-usage?id=claude-${claude}`)).json()) as ThreadUsage;

  const first = await usage();
  expect(first.spend.subagents?.count).toBe(300);
  // The first subagent's file changes, at the same size: Med, which read it
  // to its end already, does not read it again, so the totals stay.
  await writeFile(join(subagents, "agent-0.jsonl"), agent(0, 900));
  const second = await usage();
  expect(second.spend.total).toBe(first.spend.total);
  // A transcript that grows is read from where Med stopped.
  await appendFile(join(subagents, "agent-1.jsonl"), agent(1001, 500));
  expect((await usage()).spend.total).toBeGreaterThan(first.spend.total);
});
