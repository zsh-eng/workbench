import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalModel, claudeWindow, requestCost } from "../../src/shared/model-usage";
import { claudeCompaction, piCompaction } from "../../src/host/session-usage";
import { turnTokens } from "../../src/host/owned-sessions";
import { requestTokens } from "../../src/host/pi-bridge";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })));
});

const none = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
  webSearches: 0,
};

test("a provider's model ID finds the model's price and window", () => {
  expect(canonicalModel("us.anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("claude-haiku-4-5");
  expect(canonicalModel("claude-opus-4-6[1m]")).toBe("claude-opus-4-6");
  expect(claudeWindow("claude-opus-5-5")).toEqual({ size: 1_000_000, known: true });
  // Opus 4.6 has 200K unless the session asked for [1m], which a transcript does not say.
  expect(claudeWindow("claude-opus-4-6")).toEqual({ size: 200_000, known: true });
  expect(claudeWindow("my-gateway-opus")).toEqual({ size: 200_000, known: false });
  // Fast mode doubles Opus 5.5's input and output, and US-only inference adds a tenth.
  expect(requestCost("claude-opus-5-5", { ...none, input: 1e6, speed: "fast" })).toBeCloseTo(8);
  expect(requestCost("claude-opus-5-5", { ...none, output: 1e6, geo: "us" })).toBeCloseTo(22);
  expect(requestCost("claude-opus-5-5", { ...none, webSearches: 3 })).toBeCloseTo(0.03);
  expect(requestCost("gpt-test", none)).toBeUndefined();
});

test("autocompact comes from the first settings file that sets it, as Claude Code reads them", async () => {
  const home = await mkdtemp(join(tmpdir(), "med-compaction-"));
  directories.push(home);
  const project = join(home, "repo");
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(project, ".claude"), { recursive: true });
  const user = (data: unknown) =>
    writeFile(join(home, ".claude", "settings.json"), JSON.stringify(data));
  const local = (data: unknown) =>
    writeFile(join(project, ".claude", "settings.local.json"), JSON.stringify(data));
  const read = (env?: NodeJS.ProcessEnv, model = "claude-opus-5-5", window = 1_000_000) =>
    claudeCompaction(model, window, project, { home, ...(env ? { env } : {}) });

  // Nothing set: Claude Code's default, which Med knows only about.
  expect(await read()).toEqual({ at: 967_000, from: "Claude Code's default", approximate: true });
  expect(await read(undefined, "claude-sonnet-4-6", 200_000)).toMatchObject({ at: 200_000 });

  // The model's window wins over the top-level key in the same file.
  await user({
    autoCompactWindow: 300000,
    modelSettings: { "claude-opus-5-5": { autoCompactWindow: 500000 } },
  });
  expect(await read()).toEqual({
    at: 500_000,
    from: "modelSettings in ~/.claude/settings.json",
    approximate: false,
  });
  expect(await read(undefined, "claude-sonnet-5-5")).toMatchObject({
    at: 300_000,
    from: "autoCompactWindow in ~/.claude/settings.json",
  });

  // A file with higher precedence decides, also when it says "auto".
  await local({ autoCompactWindow: "auto" });
  expect(await read()).toMatchObject({ at: 967_000, approximate: true });
  await local({ autoCompactWindow: 400000 });
  expect(await read()).toMatchObject({
    at: 400_000,
    from: `autoCompactWindow in ~/repo/.claude/settings.local.json`,
  });

  // The variable wins over every file, and off is off.
  expect(await read({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: "250000" })).toMatchObject({
    at: 250_000,
    from: "CLAUDE_CODE_AUTO_COMPACT_WINDOW",
  });
  expect(await read({ DISABLE_AUTO_COMPACT: "1" })).toEqual({
    from: "DISABLE_AUTO_COMPACT",
    approximate: false,
  });
  await user({ autoCompactEnabled: false });
  await local({});
  expect(await read()).toEqual({
    from: "autoCompactEnabled in ~/.claude/settings.json",
    approximate: false,
  });
});

test("GPT-6.2 and the Gemini models have their list prices, a price that changes by its date, and a turn's sum no long-context price", () => {
  const million = (key: keyof typeof none) => ({ ...none, [key]: 1e6 });
  // Under 272K, a request pays OpenAI's short-context price.
  expect(requestCost("gpt-6.2-sol", { ...none, input: 100_000 })).toBeCloseTo(0.2);
  expect(requestCost("gpt-6.2-astra", million("output"))).toBeCloseTo(40);
  expect(requestCost("gpt-6.2-astra", { ...none, cacheRead: 100_000 })).toBeCloseTo(0.04);
  // Over 272K, a request pays OpenAI's long-context price.
  expect(requestCost("gpt-6.2-sol", { ...none, input: 300_000 })).toBeCloseTo(1.2);
  expect(requestCost("gemini-4-neon", million("input"))).toBeCloseTo(3);
  expect(requestCost("gemini-4-neon", million("cacheRead"))).toBeCloseTo(0.15);
  expect(requestCost("gemini-4-neon", million("output"))).toBeCloseTo(15);
  expect(requestCost("gemini-4-hydrogen", million("output"))).toBeCloseTo(7.5);
  // Carbon's introductory price ends with November.
  const day = (date: string) => ({ at: Date.parse(`${date}T12:00:00Z`) });
  expect(requestCost("gemini-4-carbon", million("input"), day("2026-11-30"))).toBeCloseTo(2);
  expect(requestCost("gemini-4-carbon", million("input"), day("2026-12-02"))).toBeCloseTo(4);
  expect(requestCost("gemini-3.8-flash", million("output"), day("2027-01-02"))).toBeCloseTo(7.5);
  // A turn's sum of its requests is no one request over 200K.
  expect(requestCost("gemini-3.1-pro-preview", { ...none, input: 300_000 })).toBeCloseTo(1.2);
  expect(
    requestCost("gemini-3.1-pro-preview", { ...none, input: 300_000 }, { whole: true }),
  ).toBeCloseTo(0.6);
});

test("Med's autocompact wins over Claude Code's files; Pi compacts at its window less its reserve, or at Med's first", async () => {
  const home = await mkdtemp(join(tmpdir(), "med-compaction-"));
  directories.push(home);
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify({ autoCompactWindow: 500000 }),
  );
  expect(
    await claudeCompaction("claude-opus-5-5", 1_000_000, undefined, { home, setting: 300_000 }),
  ).toEqual({ at: 300_000, from: "Med's settings", approximate: false });

  const env = { PI_CODING_AGENT_DIR: join(home, ".pi", "agent") };
  expect(await piCompaction(272_000, undefined, { home, env })).toEqual({
    at: 272_000 - 16_384,
    from: "Pi's default",
    approximate: true,
  });
  expect(await piCompaction(272_000, undefined, { home, env, setting: 100_000 })).toEqual({
    at: 100_000,
    from: "Med's settings",
    approximate: false,
  });
  // A project's reserve wins over Pi's own, and Pi's own threshold comes first.
  const project = join(home, "repo");
  await mkdir(join(project, ".pi"), { recursive: true });
  await writeFile(
    join(project, ".pi", "settings.json"),
    JSON.stringify({ compaction: { reserveTokens: 200_000 } }),
  );
  expect(await piCompaction(272_000, project, { home, env, setting: 100_000 })).toMatchObject({
    at: 72_000,
    from: "Pi's default",
  });
});

test("an agent's counts as Med's tokens: agy's turn, with its thinking in the output, and Pi's request", () => {
  // agy: the total adds input, cache reads and output; thinking is in the output.
  expect(
    turnTokens(
      {
        inputTokens: 14267,
        outputTokens: 724,
        cachedReadTokens: 15260,
        cachedWriteTokens: 0,
        thoughtTokens: 573,
        totalTokens: 30251,
      },
      "gemini-4-neon",
    ),
  ).toEqual({
    sessionUpdate: "token_usage",
    model: "gemini-4-neon",
    input: 14267,
    output: 724,
    cacheRead: 15260,
    cacheWrite: 0,
    turn: true,
  });
  // An agent whose total counts the thinking apart has it added to the output.
  expect(
    turnTokens({ inputTokens: 10, outputTokens: 5, thoughtTokens: 3, totalTokens: 18 }, undefined),
  ).toMatchObject({ output: 8 });
  expect(turnTokens({ inputTokens: 0, outputTokens: 0 }, "m")).toBeUndefined();

  const message = {
    role: "assistant",
    provider: "anthropic",
    model: "claude-opus-5-5",
    usage: { input: 5, output: 7, cacheRead: 40, cacheWrite: 30, cost: { total: 0.002 } },
  };
  expect(requestTokens(message, {})).toEqual({
    sessionUpdate: "token_usage",
    model: "claude-opus-5-5",
    input: 5,
    output: 7,
    cacheRead: 40,
    cacheWrite: 30,
    cost: 0.002,
  });
  // PI_CACHE_RETENTION=long writes Anthropic's 1-hour cache.
  expect(requestTokens(message, { PI_CACHE_RETENTION: "long" })).toMatchObject({
    cacheWriteHour: true,
  });
  // A request that failed counted nothing.
  expect(requestTokens({ ...message, usage: { input: 0, output: 0 } }, {})).toBeUndefined();
});
