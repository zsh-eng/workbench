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

/** A runner that the test drives: its state, whether it runs tools, and the
 * prompts it took. ACP agents have no `runsTools`. */
function runner(tools: boolean | undefined) {
  let state: OwnedState = {
    sessionId: "s1",
    preset: "fake",
    name: "Fake",
    status: "working",
    settings: [],
    commands: [],
    turns: 1,
  };
  let running = false;
  const listeners = new Set<() => void>();
  const prompts: string[] = [];
  const fake = {
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async prompt(text: string) {
      prompts.push(text);
    },
    ...(tools === undefined ? {} : { runsTools: () => running }),
  } as unknown as OwnedRunner;
  return {
    fake,
    prompts,
    listeners,
    set(change: Partial<OwnedState> & { tools?: boolean }) {
      const { tools: next, ...rest } = change;
      if (next !== undefined) running = next;
      state = { ...state, ...rest };
      for (const listener of [...listeners]) listener();
    },
  };
}

const session = (agent: AgentSession["agent"]): AgentSession => ({ agent, id: "s1", cwd: "/work" });
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function setup(agent: AgentSession["agent"], tools: boolean | undefined) {
  const directory = await mkdtemp(join(tmpdir(), "med-queued-"));
  directories.push(directory);
  const inbox = new AgentInbox(directory);
  const agentRunner = runner(tools);
  const queue = createQueuedMessages({ inbox, runner: () => agentRunner.fake });
  const send = async (text: string) => {
    await inbox.send("r1", session(agent), { text, noteIds: [], attachmentCount: 0 }, text, {
      queued: true,
    });
    queue.watch("r1", "s1");
    await settle();
  };
  const pending = async () =>
    (await inbox.messages("r1")).filter((message) => message.delivery === "pending");
  return { inbox, queue, agent: agentRunner, send, pending };
}

test("an ACP agent takes queued messages only between turns, in order", async () => {
  const { agent, send, pending, queue } = await setup("acp", undefined);
  await send("First.");
  await send("Second.");
  // No runsTools: a turn that works keeps them, whatever it does.
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
  const { agent, send, pending, queue } = await setup("claude", false);
  agent.set({ status: "idle", halt: { kind: "interrupted" } });
  await send("Keep the tests.");
  await settle();
  expect(agent.prompts).toEqual([]);
  // The reader continues the turn: the message goes at its next step.
  agent.set({ status: "working", halt: undefined });
  await settle();
  expect(agent.prompts).toEqual([]);
  agent.set({ tools: true });
  await settle();
  expect(agent.prompts).toEqual(["Keep the tests."]);

  // A session that the user stopped keeps what came after, as queued.
  agent.set({ tools: false });
  await send("And the docs.");
  agent.set({ status: "exited" });
  await settle();
  expect(agent.prompts).toEqual(["Keep the tests."]);
  expect(await pending()).toMatchObject([{ text: "And the docs.", queued: true }]);
  expect(agent.listeners.size).toBe(0);
  queue.stop();
});

test("Queue holds a session's messages for the turn's end, across a restart; Send now sends them at the next step", async () => {
  const { inbox, queue: first, agent, pending } = await setup("claude", false);
  first.stop();
  const stateFile = join(directories.at(-1)!, "after-turn.json");
  const start = () => createQueuedMessages({ inbox, runner: () => agent.fake, stateFile });
  const queue = start();
  const add = async (text: string) => {
    const message = await queue.queueing("r1", "s1", () =>
      inbox.send(
        "r1",
        session("claude"),
        { text, noteIds: [], attachmentCount: 0 },
        text,
        { queued: true },
      ),
    );
    queue.watch("r1", "s1");
    await settle();
    return message;
  };
  const rename = await add("Rename it.");
  // Claude Code runs tools, which would take a message sent now: this waits.
  agent.set({ tools: true });
  await settle();
  expect(agent.prompts).toEqual([]);
  // A new host reads which messages wait for the turn's end.
  await queue.settled();
  expect(start().queued(rename.id)).toBe(true);

  await queue.sendNow("r1", "s1");
  await settle();
  expect(agent.prompts).toEqual(["Rename it."]);
  expect(queue.queued(rename.id)).toBe(false);

  // Queued again, it goes when the turn ends.
  agent.set({ tools: false });
  await add("Then the docs.");
  agent.set({ tools: true });
  await settle();
  expect(agent.prompts).toEqual(["Rename it."]);
  agent.set({ status: "idle", tools: false });
  await settle();
  expect(agent.prompts).toEqual(["Rename it.", "Then the docs."]);
  expect(await pending()).toEqual([]);
  queue.stop();
});
