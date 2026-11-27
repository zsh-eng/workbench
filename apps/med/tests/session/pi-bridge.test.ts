import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configOptions,
  piBridge,
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

test("piBridge serializes overlapping prompts, passes streamingBehavior, and waits across settle and compaction continuation gaps", async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "med-pi-rpc-")));
  folders.push(dir);
  const fakePi = join(dir, "fake-pi.mjs");
  // Mirrors Pi's real RPC behavior (agent-session.js:704-716, 1566-1599):
  // - Rejects `prompt` while `isStreaming` if `streamingBehavior` is omitted.
  // - Keeps `isStreaming: true` briefly after `agent_end` (awaited listeners).
  // - Supports a `compact-retry` trigger that emits `compaction_end { willRetry: true }`
  //   with a 100ms gap before `agent_start`, and an `external-stream` trigger where
  //   Pi is already streaming before the next `session/prompt` arrives.
  await writeFile(
    fakePi,
    `
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
let isStreaming = false;
let isCompacting = false;
let followUps = [];
let buf = "";

function finishStream(delayMs = 100) {
  emit({ type: "agent_end", messages: [] });
  setTimeout(() => { isStreaming = false; }, delayMs);
}

function runNext(message) {
  isStreaming = true;
  emit({ type: "agent_start" });
  if (message === "compact-retry") {
    setTimeout(() => {
      emit({
        type: "message_end",
        message: { role: "assistant", stopReason: "error", errorMessage: "context overflow", content: [] },
      });
      isCompacting = true;
      emit({ type: "agent_end", messages: [] });
      isStreaming = false;
      setTimeout(() => {
        isCompacting = false;
        emit({ type: "compaction_end", willRetry: true, result: { summary: "compacted" } });
        // 100ms gap where both isStreaming and isCompacting are false before continuation starts.
        setTimeout(() => {
          isStreaming = true;
          emit({ type: "agent_start" });
          setTimeout(() => {
            emit({
              type: "message_update",
              assistantMessageEvent: { type: "text_delta", delta: "reply:compact-retry-ok" },
            });
            emit({
              type: "message_end",
              message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "reply:compact-retry-ok" }] },
            });
            finishStream(60);
          }, 40);
        }, 100);
      }, 60);
    }, 40);
    return;
  }
  setTimeout(() => {
    const stopReason = message === "first" ? "length" : "stop";
    emit({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "reply:" + message },
    });
    emit({
      type: "message_end",
      message: { role: "assistant", stopReason, content: [{ type: "text", text: "reply:" + message }] },
    });
    if (followUps.length > 0) {
      const next = followUps.shift();
      setTimeout(() => runNext(next), 30);
      return;
    }
    finishStream(120);
  }, 70);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const cmd = JSON.parse(line);
    if (cmd.type === "get_available_models") {
      emit({ type: "response", id: cmd.id, command: cmd.type, success: true, data: { models: [] } });
    } else if (cmd.type === "get_commands") {
      emit({ type: "response", id: cmd.id, command: cmd.type, success: true, data: { commands: [] } });
    } else if (cmd.type === "get_state") {
      emit({
        type: "response",
        id: cmd.id,
        command: cmd.type,
        success: true,
        data: {
          sessionId: "pi-test-1",
          isStreaming,
          isCompacting,
          pendingMessageCount: followUps.length,
        },
      });
    } else if (cmd.type === "get_session_stats") {
      emit({ type: "response", id: cmd.id, command: cmd.type, success: true, data: {} });
    } else if (cmd.type === "set_thinking_level") {
      // Used by test to simulate an external/extension stream already running in Pi.
      if (cmd.level === "high") {
        isStreaming = true;
        emit({ type: "agent_start" });
        setTimeout(() => {
          if (followUps.length > 0) {
            const next = followUps.shift();
            runNext(next);
          } else {
            finishStream(20);
          }
        }, 80);
      }
      emit({ type: "response", id: cmd.id, command: cmd.type, success: true });
    } else if (cmd.type === "prompt") {
      if (isStreaming) {
        if (!cmd.streamingBehavior) {
          emit({
            type: "response",
            id: cmd.id,
            command: cmd.type,
            success: false,
            error: "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          });
          continue;
        }
        followUps.push(cmd.message);
        emit({ type: "response", id: cmd.id, command: cmd.type, success: true });
        continue;
      }
      emit({ type: "response", id: cmd.id, command: cmd.type, success: true });
      runNext(cmd.message);
    }
  }
});
`,
  );

  const replies = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
  const chunks: string[] = [];
  const bridge = piBridge({
    pi: [process.execPath, fakePi],
    write(line) {
      const msg = JSON.parse(line) as {
        id?: number;
        result?: any;
        error?: { message: string };
        method?: string;
        params?: any;
      };
      if (msg.method === "session/update") {
        const text = msg.params?.update?.content?.text;
        if (typeof text === "string") chunks.push(text);
        return;
      }
      if (typeof msg.id === "number") {
        const pending = replies.get(msg.id);
        replies.delete(msg.id);
        if (msg.error) pending?.reject(new Error(msg.error.message));
        else pending?.resolve(msg.result);
      }
    },
  });

  let seq = 0;
  const call = (method: string, params: Record<string, unknown>) => {
    const id = ++seq;
    return new Promise<any>((resolve, reject) => {
      replies.set(id, { resolve, reject });
      bridge.receive(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  };

  try {
    await call("initialize", { protocolVersion: 1 });
    const created = await call("session/new", { cwd: dir });
    expect(created.sessionId).toBe("pi-test-1");

    // 1. Overlapping prompts: Turn 2 arrives while Turn 1 is streaming, and Turn 3 arrives
    //    during Turn 1's post-agent_end settling window; each keeps its own stopReason.
    const first = call("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "first" }],
    });
    await new Promise((done) => setTimeout(done, 25));
    const second = call("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "second" }],
    });
    // Arrive right in Turn 1's settle window (~100ms after first started, while isStreaming=true).
    await new Promise((done) => setTimeout(done, 80));
    const third = call("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "third" }],
    });

    const [r1, r2, r3] = await Promise.all([first, second, third]);
    expect(r1).toEqual({ stopReason: "max_tokens" });
    expect(r2).toEqual({ stopReason: "end_turn" });
    expect(r3).toEqual({ stopReason: "end_turn" });
    expect(chunks).toEqual(["reply:first", "reply:second", "reply:third"]);

    // 2. External stream already running in Pi when a prompt arrives: bridge always passes
    //    streamingBehavior: "followUp" so Pi queues it cleanly without error.
    await call("session/set_config_option", { configId: "thought_level", value: "high" });
    const fourth = await call("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "fourth" }],
    });
    expect(fourth).toEqual({ stopReason: "end_turn" });
    expect(chunks).toContain("reply:fourth");

    // 3. Compaction overflow recovery (`willRetry: true`) with a 100ms gap before continuation:
    //    `settle()` must not fail early with the pre-compaction error.
    const fifth = await call("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: "compact-retry" }],
    });
    expect(fifth).toEqual({ stopReason: "end_turn" });
    expect(chunks).toContain("reply:compact-retry-ok");
  } finally {
    bridge.close();
  }
});
