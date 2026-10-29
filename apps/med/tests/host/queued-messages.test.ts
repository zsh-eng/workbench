import { afterEach, expect, test } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentInbox } from "../../src/host/agent-inbox";
import type { OwnedRunner } from "../../src/host/owned-sessions";
import { createQueuedMessages } from "../../src/host/queued-messages";
import type { OwnedState } from "../../src/shared/owned-session";
import type { AgentSession } from "../../src/shared/saved-review";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
});

/** A runner that the test drives: its state, and the prompts it took, and
 * with `steer`, the messages that it took during a turn. */
function runner(steers: boolean) {
  let state: OwnedState = {
    sessionId: "s1",
    preset: "fake",
    name: "Fake",
    status: "working",
    settings: [],
    commands: [],
    turns: 1,
  };
  const listeners = new Set<() => void>();
  const prompts: string[] = [];
  const steered: string[] = [];
  const fake = {
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(text: string) {
      prompts.push(text);
    },
    ...(steers
      ? {
          async steer(text: string) {
            steered.push(text);
          },
        }
      : {}),
  } as unknown as OwnedRunner;
  return {
    fake,
    prompts,
    steered,
    listeners,
    set(change: Partial<OwnedState>) {
      state = { ...state, ...change };
      for (const listener of [...listeners]) listener();
    },
  };
}

const session = (agent: AgentSession["agent"]): AgentSession => ({ agent, id: "s1", cwd: "/work" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function setup(agent: AgentSession["agent"], steers: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "med-queued-"));
  directories.push(directory);
  const inbox = new AgentInbox(directory);
  const agentRunner = runner(steers);
  const queue = createQueuedMessages({ inbox, runner: () => agentRunner.fake });
  const send = async (text: string) => {
    await inbox.send("r1", session(agent), { text, noteIds: [], attachmentCount: 0 }, text, {
      queued: true,
    });
    queue.watch("r1", "s1");
    await settle();
    return (await inbox.messages("r1")).at(-1)!;
  };
  const pending = async () =>
    (await inbox.messages("r1")).filter((message) => message.delivery === "pending");
  return { inbox, queue, agent: agentRunner, send, pending };
}

test("an ACP agent takes queued messages only between turns, in order", async () => {
  const { agent, send, pending, queue } = await setup("acp", false);
  await send("First.");
  await send("Second.");
  agent.set({ status: "working" });
  await settle();
  expect(agent.prompts).toEqual([]);
  expect(await pending()).toHaveLength(2);
  agent.set({ status: "idle" });
  await settle();
  expect(agent.prompts).toEqual(["First.\n\n---\n\nSecond."]);
  expect(await pending()).toEqual([]);
  // Nothing waits, so the queue stops listening.
  expect(agent.listeners.size).toBe(0);
  queue.stop();
});

test("a turn that a restart cut keeps its queued messages until the reader acts, and a stopped session keeps them", async () => {
  const { agent, send, pending, queue } = await setup("claude", true);
  agent.set({ status: "idle", halt: { kind: "interrupted" } });
  await send("Keep the tests.");
  await settle();
  expect(agent.prompts).toEqual([]);
  // The reader continues the turn: the message waits for its end.
  agent.set({ status: "working", halt: undefined });
  await settle();
  expect(agent.prompts).toEqual([]);
  agent.set({ status: "idle" });
  await settle();
  expect(agent.prompts).toEqual(["Keep the tests."]);

  // A session that the user stopped keeps what came after, as queued.
  agent.set({ status: "working" });
  await send("And the docs.");
  agent.set({ status: "exited" });
  await settle();
  expect(agent.prompts).toEqual(["Keep the tests."]);
  expect(await pending()).toMatchObject([{ text: "And the docs.", queued: true }]);
  expect(agent.listeners.size).toBe(0);
  queue.stop();
});

test("Send now gives one queued message to the turn that runs, where the agent can take it", async () => {
  const claude = await setup("claude", true);
  const first = await claude.send("Check the hour.");
  const second = await claude.send("And the date.");
  expect(await claude.queue.steer("r1", "s1", second.id)).toBe(true);
  expect(claude.agent.steered).toEqual(["And the date."]);
  expect(await claude.pending()).toMatchObject([{ id: first.id }]);
  // Between turns, Send now sends it as the next prompt. (Stop the watch,
  // which would send it as the turn ends.)
  claude.queue.stop();
  claude.agent.set({ status: "idle" });
  expect(await claude.queue.steer("r1", "s1", first.id)).toBe(true);
  expect(claude.agent.prompts).toEqual(["Check the hour."]);

  // An agent that takes no message during a turn keeps it queued.
  const acp = await setup("acp", false);
  const kept = await acp.send("Wait for me.");
  expect(await acp.queue.steer("r1", "s1", kept.id)).toBe(false);
  expect(await acp.pending()).toMatchObject([{ id: kept.id, queued: true }]);
  acp.queue.stop();
});
