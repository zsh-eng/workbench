import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configOptions,
  piLevels,
  providerName,
  sessionFile,
  toolCall,
} from "../../src/host/pi-bridge";

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

test("a model's thinking levels: Off alone without reasoning, Extra high where Pi gives it, and a newer Pi's map", () => {
  expect(piLevels({ provider: "google", id: "gemini-2.0-flash", reasoning: false })).toEqual([
    "off",
  ]);
  expect(piLevels({ provider: "google", id: "gemini-3-pro", reasoning: true })).toEqual([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  expect(piLevels({ provider: "openai-codex", id: "gpt-5.4-mini", reasoning: true })).toContain(
    "xhigh",
  );
  // A newer Pi maps each level; Extra high and Max only where it names them.
  expect(
    piLevels({
      provider: "anthropic",
      id: "claude-opus-5-5",
      reasoning: true,
      thinkingLevelMap: { minimal: null, low: "low", max: "max" },
    }),
  ).toEqual(["off", "low", "medium", "high", "max"]);
});

test("Pi's models are one setting in sections by provider, and the level is the model's", () => {
  const models = [
    { provider: "openai-codex", id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
    { provider: "openrouter", id: "deepseek/deepseek-v4-flash", reasoning: false },
    { provider: "some-new_provider", id: "x", name: "X", reasoning: false },
  ];
  const [model, level] = configOptions(models, {
    model: models[1],
    thinkingLevel: "off",
  });
  expect(model).toMatchObject({
    category: "model",
    currentValue: "openrouter/deepseek/deepseek-v4-flash",
    options: [
      { group: "openai-codex", name: "ChatGPT", options: [{ value: "openai-codex/gpt-5.4" }] },
      {
        name: "OpenRouter",
        options: [
          {
            value: "openrouter/deepseek/deepseek-v4-flash",
            name: "deepseek/deepseek-v4-flash",
          },
        ],
      },
      { name: "Some New Provider" },
    ],
  });
  expect(level).toMatchObject({
    category: "thought_level",
    currentValue: "off",
    options: [{ value: "off", name: "Off" }],
  });
  expect(providerName("google")).toBe("Google");
});

test("Pi's tools read as Med shows tool calls: a command by its line, a file by its path in the checkout", () => {
  const cwd = "/work/repo";
  expect(toolCall("bash", { command: "bun test" }, cwd)).toMatchObject({
    title: "bun test",
    kind: "execute",
  });
  expect(toolCall("read", { path: "/work/repo/src/a.ts" }, cwd)).toEqual({
    title: "Read src/a.ts",
    kind: "read",
    locations: [{ path: "/work/repo/src/a.ts" }],
  });
  expect(toolCall("edit", { path: "src/a.ts" }, cwd)).toMatchObject({
    title: "Edit src/a.ts",
    kind: "edit",
    locations: [{ path: "/work/repo/src/a.ts" }],
  });
  expect(toolCall("grep", { pattern: "TODO" }, cwd)).toMatchObject({
    title: "Search TODO",
    kind: "search",
  });
  expect(toolCall("subagent", {}, cwd)).toMatchObject({ title: "subagent", kind: "other" });
});

test("a session's file by its ID: in its folder's sessions or another's, or a new name with the ID", async () => {
  const agent = await realpath(await mkdtemp(join(tmpdir(), "med pi ")));
  folders.push(agent);
  const env = { PI_CODING_AGENT_DIR: agent };
  const id = "01a208fa-747d-7273-9c49-ef90e1830550";
  // None yet: Pi's name, in the folder's sessions, so that the next start finds it.
  const fresh = sessionFile(env, "/work/repo", id);
  expect(fresh).toMatch(
    new RegExp(`^${agent}/sessions/--work-repo--/\\d{4}-\\d\\d-\\d\\dT[\\d-]+Z_${id}\\.jsonl$`),
  );
  // A worktree that moved: its file is found in another folder.
  const other = join(agent, "sessions", "--elsewhere--");
  await mkdir(other, { recursive: true });
  await writeFile(join(other, `2026-11-23T15-00-00-000Z_${id}.jsonl`), "{}\n");
  expect(sessionFile(env, "/work/repo", id)).toBe(
    join(other, `2026-11-23T15-00-00-000Z_${id}.jsonl`),
  );
});
