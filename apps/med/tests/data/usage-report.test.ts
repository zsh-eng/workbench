import { afterEach, expect, test } from "vitest";
import { appendFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestCost } from "../../src/shared/model-usage";
import { createUsageReport, localDay } from "../../src/host/usage-report";

// The Usage page's numbers: every session's spend on this Mac by day, agent
// and model, from Claude Code's, Codex's and Pi's files and Med's ACP logs.

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

/** Noon in the middle of the day, so the test's time zone keeps the day. */
const at = (day: string) => `${day}T12:00:00.000Z`;

const claude = (id: string, day: string, output: number, model = "claude-opus-5-5") =>
  `${JSON.stringify({
    type: "assistant",
    timestamp: at(day),
    message: {
      id,
      model,
      usage: {
        input_tokens: 10,
        output_tokens: output,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 100,
      },
    },
  })}\n`;

const tokens = (output: number) => ({
  input: 10,
  output,
  cacheRead: 1000,
  cacheWrite5m: 100,
  cacheWrite1h: 0,
  webSearches: 0,
});

async function setUp() {
  const home = await mkdtemp(join(tmpdir(), "med-usage-"));
  folders.push(home);
  const project = join(home, ".claude", "projects", "-work-repo");
  await mkdir(join(project, "first", "subagents"), { recursive: true });
  // A response's blocks repeat its usage; the last has its output.
  await writeFile(
    join(project, "first.jsonl"),
    claude("msg_1", "2026-11-02", 5) +
      claude("msg_1", "2026-11-02", 9) +
      claude("msg_2", "2026-11-03", 4),
  );
  // A resumed session's file starts with its original's requests.
  await writeFile(
    join(project, "second.jsonl"),
    claude("msg_1", "2026-11-02", 9) + claude("msg_3", "2026-11-03", 7, "claude-fable-5-2"),
  );
  await writeFile(
    join(project, "first", "subagents", "agent-a.jsonl"),
    claude("msg_4", "2026-11-03", 3, "claude-haiku-5-5"),
  );
  // A file that last changed before the range is not read.
  const old = join(project, "old.jsonl");
  await writeFile(old, claude("msg_old", "2026-11-02", 1));
  await utimes(old, new Date("2026-10-01"), new Date("2026-10-01"));

  const rollouts = join(home, ".codex", "sessions", "2026", "11", "03");
  await mkdir(rollouts, { recursive: true });
  await writeFile(
    join(rollouts, "rollout-2026-11-03T12-00-00-thread.jsonl"),
    [
      { timestamp: at("2026-11-03"), type: "turn_context", payload: { model: "gpt-6.2-sol" } },
      {
        timestamp: at("2026-11-03"),
        type: "token_usage_record",
        payload: {
          response_id: "resp_1",
          usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 50 },
        },
      },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join(""),
  );

  const logs = join(home, "state", "sessions");
  await mkdir(logs, { recursive: true });
  const update = (day: string, value: object) =>
    `${JSON.stringify({ at: Date.parse(at(day)), update: { sessionUpdate: "token_usage", ...value } })}\n`;
  await writeFile(
    join(logs, "agy-session.jsonl"),
    update("2026-11-03", {
      agent: "agy",
      model: "gemini-4-neon",
      input: 10,
      output: 2,
      cacheRead: 100,
      cacheWrite: 0,
      turn: true,
    }),
  );
  // Pi's own file of a session that Med ran has its requests; Med's has
  // them too, and they count once.
  await writeFile(
    join(logs, "pi-session.jsonl"),
    update("2026-11-03", {
      agent: "pi",
      model: "deepseek/deepseek-v4-flash",
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0.001,
    }),
  );
  const pi = join(home, ".pi", "agent", "sessions", "--work-repo--");
  await mkdir(pi, { recursive: true });
  const message = (id: string, model: string, input: number, cost = 0) =>
    `${JSON.stringify({
      type: "message",
      id,
      parentId: null,
      timestamp: at("2026-11-03"),
      message: {
        role: "assistant",
        provider: "openrouter",
        model,
        usage: {
          input,
          output: input / 5,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: cost },
        },
        timestamp: Date.parse(at("2026-11-03")),
      },
    })}\n`;
  const header = `${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: at("2026-11-03") })}\n`;
  await writeFile(
    join(pi, "2026-11-03T12-00-00-000Z_s1.jsonl"),
    header +
      message("a1", "deepseek/deepseek-v4-flash", 100, 0.001) +
      message("a2", "made-up-model", 5),
  );
  // A session that Pi forked from it copies its entries as they were.
  await writeFile(
    join(pi, "2026-11-03T13-00-00-000Z_s2.jsonl"),
    header + message("a1", "deepseek/deepseek-v4-flash", 100, 0.001),
  );
  const report = createUsageReport({
    home: () => home,
    logs,
    now: () => Date.parse("2026-11-04T12:00:00Z"),
  });
  return { home, project, report };
}

test("a request counts once by its ID across Claude Code's files, on its day, at its model's price", async () => {
  const { report } = await setUp();
  const { rows, files } = await report.report("2026-11-01", "2026-11-30");
  // Three of Claude Code's files, Codex's rollout, two of Pi's, and two of Med's logs.
  expect(files).toBe(8);
  const opus = rows.filter((row) => row.model === "claude-opus-5-5");
  expect(opus).toEqual([
    expect.objectContaining({
      day: localDay(Date.parse(at("2026-11-02"))),
      agent: "claude",
      requests: 1,
      output: 9,
    }),
    expect.objectContaining({
      day: localDay(Date.parse(at("2026-11-03"))),
      agent: "claude",
      requests: 1,
      output: 4,
    }),
  ]);
  expect(opus[0]!.cost).toBeCloseTo(
    requestCost("claude-opus-5-5", tokens(9), { at: Date.parse(at("2026-11-02")) })!,
    12,
  );
  expect(rows.find((row) => row.model === "claude-fable-5-2")).toMatchObject({ requests: 1 });
  expect(rows.find((row) => row.model === "claude-haiku-5-5")).toMatchObject({ requests: 1 });
  expect(rows.some((row) => row.model === "claude-opus-5-5" && row.output === 1)).toBe(false);
});

test("Codex's rollouts, Pi's sessions, and the ACP sessions that Med ran, count by their agent", async () => {
  const { report } = await setUp();
  const { rows } = await report.report("2026-11-03", "2026-11-03");
  expect(rows.find((row) => row.agent === "codex")).toMatchObject({
    model: "gpt-6.2-sol",
    input: 500,
    cacheRead: 1500,
    output: 50,
    unpriced: 0,
  });
  expect(rows.find((row) => row.agent === "agy")).toMatchObject({
    model: "gemini-4-neon",
    requests: 1,
    cost: expect.closeTo((10 * 3 + 2 * 15 + 100 * 0.15) / 1e6, 12),
  });
  // A model without Med's price takes Pi's; one without either counts its tokens only.
  expect(rows.find((row) => row.model === "deepseek/deepseek-v4-flash")).toMatchObject({
    agent: "pi",
    requests: 1,
    cost: 0.001,
    agentPriced: 1,
    unpriced: 0,
  });
  expect(rows.find((row) => row.model === "made-up-model")).toMatchObject({
    agent: "pi",
    cost: 0,
    unpriced: 1,
    input: 5,
  });
  // The other days' requests are not in this one.
  expect(rows.every((row) => row.day === localDay(Date.parse(at("2026-11-03"))))).toBe(true);
});

test("a file that grows is read on from its end", async () => {
  const { project, report } = await setUp();
  const first = await report.report("2026-11-01", "2026-11-30");
  const count = (rows: typeof first.rows) => rows.reduce((sum, row) => sum + row.requests, 0);
  await appendFile(join(project, "second.jsonl"), claude("msg_5", "2026-11-04", 2));
  const next = await report.report("2026-11-01", "2026-11-30");
  expect(count(next.rows)).toBe(count(first.rows) + 1);
});
