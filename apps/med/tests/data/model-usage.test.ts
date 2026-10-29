import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalModel, claudeWindow, requestCost } from "../../src/shared/model-usage";
import { claudeCompaction } from "../../src/host/session-usage";

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
