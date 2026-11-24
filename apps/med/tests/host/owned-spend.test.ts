import { afterEach, expect, test, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionEvent } from "../../src/shared/agent-session";
import type { ThreadUsage } from "../../src/shared/model-usage";
import { cleanup, fixture } from "./owned-fixture";

// What the agents that Med runs spend, and where each compacts by Med's
// settings (agent-defaults.ts): Claude Code and Codex take the setting as
// they start, and Med sends Antigravity's and Pi's /compact after a turn
// past it. Fake agents answer (fixtures/agents).

afterEach(cleanup);

const notices = (events: SessionEvent[]) =>
  events.flatMap((event) =>
    event.update.sessionUpdate === "notice"
      ? [`${event.update.title}: ${event.update.description ?? ""}`]
      : [],
  );
const compactions = (events: SessionEvent[]) =>
  events.filter(
    (event) =>
      event.update.sessionUpdate === "compaction_update" && event.update.status === "completed",
  ).length;
const prompts = (events: SessionEvent[]) =>
  events.flatMap((event) =>
    event.update.sessionUpdate === "user_message_chunk" && event.update.content.type === "text"
      ? [event.update.content.text]
      : [],
  );

test("Antigravity's turns count at Google's prices, and past its autocompact Med sends its /compact", async () => {
  const { api, start, thread } = await fixture();
  expect(
    (await api("/api/settings", { key: "agy.autoCompact", value: 200_000 }, "PUT")).status,
  ).toBe(200);
  const session = await start("agy");
  await session.until((state) => state.status === "idle" && state.commands.length > 0);
  const replies = await thread(session.id);
  const usage = async () => (await api<ThreadUsage>(`/api/thread-usage?id=${session.thread}`)).data;

  await session.act({ action: "prompt", text: "Say hi." });
  await session.until((state) => state.status === "idle" && state.turns === 1);
  // A turn's tokens as agy counts them: its input without the cache reads,
  // its output with the thinking, at Gemini 4 Neon's price.
  await vi.waitFor(async () =>
    expect((await usage()).spend.models).toEqual([
      expect.objectContaining({
        model: "gemini-4-neon",
        requests: 1,
        input: 10,
        output: 2,
        cacheRead: 100,
        cost: expect.closeTo((10 * 3 + 2 * 15 + 100 * 0.15) / 1e6, 12),
      }),
    ]),
  );
  expect((await usage()).spend.missing).toEqual([]);

  // A turn that ends past 200k: Med sends /compact, which the thread shows
  // as Med's note, not as a message of the reader's. agy says nothing as it
  // compacts, so Med marks the compaction.
  await session.act({ action: "prompt", text: "Fill the context." });
  const done = await session.until((state) => state.status === "idle" && state.turns === 3);
  expect(done.autoCompact).toBe(200_000);
  expect(compactions(replies.events)).toBe(1);
  expect(notices(replies.events)).toEqual([
    "Compacting the context: 250k tokens, past the 200k autocompact in Settings.",
  ]);
  expect(prompts(replies.events)).toEqual(["Say hi.", "Fill the context."]);
  // The context after agy's /compact is the compaction's request: it waits
  // for the next, with Med's autocompact.
  expect((await usage()).context).toMatchObject({
    agent: "acp",
    compacted: true,
    window: 1_048_576,
    compaction: { at: 200_000, from: "Med's settings", approximate: false },
  });
  await session.act({ action: "prompt", text: "Say more." });
  await session.until((state) => state.status === "idle" && state.turns === 4);
  const after = (await usage()).context;
  expect(after).toMatchObject({ compacted: false });
  expect(after?.used).toBeLessThan(200_000);
  expect(notices(replies.events)).toHaveLength(1);
  expect((await usage()).spend.models[0]).toMatchObject({ requests: 4 });
});

test("After a compaction that frees nothing, Med sends no other until the context is under its autocompact", async () => {
  const { api, start, thread } = await fixture();
  await api("/api/settings", { key: "agy.autoCompact", value: 200_000 }, "PUT");
  const session = await start("agy");
  await session.until((state) => state.status === "idle" && state.commands.length > 0);
  const replies = await thread(session.id);

  await session.act({ action: "prompt", text: "Fill and hold the context." });
  await session.until((state) => state.status === "idle" && state.turns === 2);
  // The next turn is as full as the compaction found it.
  for (const turns of [3, 4]) {
    await session.act({ action: "prompt", text: "Say more." });
    await session.until((state) => state.status === "idle" && state.turns === turns);
  }
  expect(compactions(replies.events)).toBe(1);
  expect(notices(replies.events)).toEqual([
    "Compacting the context: 250k tokens, past the 200k autocompact in Settings.",
    "Antigravity did not compact: Med sends no other /compact until the context is under 200k.",
  ]);
});

test("Pi's requests count at Med's prices, or at Pi's own; past its autocompact Med has Pi compact", async () => {
  const { api, start, thread } = await fixture();
  await api("/api/settings", { key: "pi.autoCompact", value: 100_000 }, "PUT");
  const session = await start("pi");
  // Med's bridge offers Pi's compaction as a command.
  const ready = await session.until(
    (state) =>
      state.status === "idle" && state.commands.some((command) => command.name === "compact"),
  );
  expect(ready.settings.find((setting) => setting.id === "model")?.value).toBe(
    "openai-codex/gpt-5.4",
  );
  const replies = await thread(session.id);
  const usage = async () => (await api<ThreadUsage>(`/api/thread-usage?id=${session.thread}`)).data;

  await session.act({ action: "prompt", text: "Say hi." });
  await session.until((state) => state.status === "idle" && state.turns === 1);
  // A model without Med's price (OpenRouter's) takes Pi's.
  await session.act({
    action: "setting",
    id: "model",
    value: "openrouter/deepseek/deepseek-v4-flash",
  });
  await session.act({ action: "prompt", text: "Say more." });
  await session.until((state) => state.status === "idle" && state.turns === 2);
  await vi.waitFor(async () => {
    const { spend } = await usage();
    expect(spend.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          model: "gpt-5.4",
          input: 10,
          output: 2,
          cacheRead: 100,
          cost: expect.closeTo((10 * 2.5 + 2 * 15 + 100 * 0.25) / 1e6, 12),
        }),
        expect.objectContaining({
          model: "deepseek/deepseek-v4-flash",
          cost: 0.001,
          pricedBy: "Pi",
        }),
      ]),
    );
    expect(spend.missing).toEqual([]);
  });

  // Past 100k, Pi compacts: its summary is the thread's compaction.
  await session.act({ action: "prompt", text: "Fill the context." });
  await vi.waitFor(() =>
    expect(
      replies.events.some(
        (event) =>
          event.update.sessionUpdate === "compaction_update" && event.update.status === "completed",
      ),
    ).toBe(true),
  );
  await session.until((state) => state.status === "idle" && state.turns === 4);
  expect(notices(replies.events)).toEqual([
    "Compacting the context: 250k tokens, past the 100k autocompact in Settings.",
  ]);
  // The context waits for the next request to tell its size.
  expect((await usage()).context).toMatchObject({
    agent: "acp",
    compacted: true,
    compaction: { at: 100_000, from: "Med's settings" },
  });
});

test("Claude Code and Codex start with Med's autocompact, and without it with their own", async () => {
  const { api, home, start } = await fixture();
  const claude = await start("claude");
  await claude.until((state) => state.status === "idle");
  const env = async (id: string) =>
    JSON.parse(
      await readFile(join(home, ".claude", "projects", "-fake-repo", `${id}.env.json`), "utf8"),
    ) as Record<string, string>;
  expect((await env(claude.id)).CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();

  await api("/api/settings", { key: "claude.autoCompact", value: 300_000 }, "PUT");
  await api("/api/settings", { key: "codex.autoCompact", value: 150_000 }, "PUT");
  const next = await start("claude");
  await next.until((state) => state.status === "idle");
  expect((await env(next.id)).CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe("300000");
  expect((await next.state()).autoCompact).toBe(300_000);

  const codex = await start("codex", { model: "gpt-6-luna" });
  await codex.until((state) => state.status === "idle");
  const threads = (await readFile(join(home, "codex-threads.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { method: string; config: unknown });
  expect(threads.at(-1)).toEqual({
    method: "thread/start",
    config: { model_auto_compact_token_limit: 150_000 },
  });

  // Default takes the key out of the file: the next session has the agent's own.
  await api("/api/settings", { key: "claude.autoCompact", value: null }, "PUT");
  const settings = (await api<{ settings: Record<string, unknown> }>("/api/settings")).data;
  expect(settings.settings).toEqual({ "codex.autoCompact": 150_000 });
  const last = await start("claude");
  await last.until((state) => state.status === "idle");
  expect((await env(last.id)).CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
});

test("A Claude Code session that started before Med's autocompact compacts past it with Claude Code's /compact", async () => {
  const { api, home, start } = await fixture();
  const claude = await start("claude");
  const ready = await claude.until((state) => state.status === "idle" && state.commands.length > 0);
  // Claude Code's list leaves out its built-in commands; Med offers /compact.
  expect(ready.commands.map((command) => command.name)).toEqual(["review", "compact"]);
  const boundaries = async () =>
    (
      await readFile(join(home, ".claude", "projects", "-fake-repo", `${claude.id}.jsonl`), "utf8")
    ).split('"compact_boundary"').length - 1;

  // The setting comes after the process started, without a window.
  await api("/api/settings", { key: "claude.autoCompact", value: 200_000 }, "PUT");
  await claude.act({ action: "prompt", text: "Fill the context." });
  await claude.until((state) => state.status === "idle" && state.turns === 2);
  await vi.waitFor(async () => expect((await claude.state()).context?.used).toBe(8000));
  expect(await boundaries()).toBe(1);
  expect((await claude.state()).autoCompact).toBe(200_000);

  // Under the setting, a turn is a turn; the user's /compact is Claude Code's.
  await claude.act({ action: "prompt", text: "Say hi." });
  await claude.until((state) => state.status === "idle" && state.turns === 3);
  expect(await boundaries()).toBe(1);
  await claude.act({ action: "prompt", text: "/compact" });
  await claude.until((state) => state.status === "idle" && state.turns === 4);
  expect(await boundaries()).toBe(2);
});

test("Codex's /compact is its thread/compact/start, which Med also sends after a turn past its autocompact", async () => {
  const { api, home, start } = await fixture();
  await api("/api/settings", { key: "codex.autoCompact", value: 10_000 }, "PUT");
  const codex = await start("codex", { model: "gpt-6-luna" });
  const ready = await codex.until((state) => state.status === "idle");
  expect(ready.commands.map((command) => command.name)).toEqual(["compact"]);
  const compactions = async () =>
    (await readFile(join(home, "codex-threads.jsonl"), "utf8"))
      .split("\n")
      .filter((line) => line.includes("thread/compact/start")).length;
  const send = (text: string, afterTurn = false) =>
    api<{ message: { id: string } }>(`/api/sessions/${codex.thread}/agent/messages`, {
      text,
      noteIds: [],
      ...(afterTurn ? { afterTurn } : {}),
    });

  await send("/compact");
  await codex.until((state) => state.status === "idle" && state.turns === 1);
  expect(await compactions()).toBe(1);

  // The recorded turn ends at 19,028 tokens, past 10k: Med compacts after it.
  await send("Run ls -1, then name the files.");
  const asked = await codex.until((state) => !!state.permission);
  await codex.act({ action: "permission", id: asked.permission!.id, option: "accept" });
  const queued = await send("Also end your reply with the word steered.", true);
  await api(`/api/sessions/${codex.thread}/agent/send-now`, { id: queued.data.message.id });
  await vi.waitFor(async () => expect(await compactions()).toBe(2));
  await codex.until((state) => state.status === "idle" && state.turns === 3);
  expect(await compactions()).toBe(2);
});
