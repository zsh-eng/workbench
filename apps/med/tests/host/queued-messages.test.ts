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
 * prompts it took. ACP agents have no `runsTools`. With `steers`, as Codex,
 * it takes Send now during a turn. */
function runner(tools: boolean | undefined, steers = false) {
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
    ...(tools === undefined ? {} : { runsTools: () => running }),
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
    set(change: Partial<OwnedState> & { tools?: boolean }) {
      const { tools: next, ...rest } = change;
      if (next !== undefined) running = next;
      state = { ...state, ...rest };
      for (const listener of [...listeners]) listener();
    },
  };
}

const session = (agent: AgentSession["agent"]): AgentSession => ({ agent, id: "s1", cwd: "/work" });

async function setup(agent: AgentSession["agent"], tools: boolean | undefined, steers = false) {
  const directory = await mkdtemp(join(tmpdir(), "med-queued-"));
  directories.push(directory);
  const inbox = new AgentInbox(directory);
  const agentRunner = runner(tools, steers);
  const queue = createQueuedMessages({ inbox, runner: () => agentRunner.fake });
  /** Waits until the queue has acted on the runner's last change. */
  const settled = () => queue.settled("r1", "s1");
  const send = async (text: string, afterTurn = false) => {
    await inbox.send("r1", session(agent), { text, noteIds: [], attachmentCount: 0 }, text, {
      queued: true,
      afterTurn,
    });
    queue.watch("r1", "s1");
    await settled();
    return (await inbox.messages("r1")).find((message) => message.text === text)!;
  };
  const pending = async () =>
    (await inbox.messages("r1")).filter((message) => message.delivery === "pending");
  return { inbox, queue, agent: agentRunner, send, pending, settled };
}

test("an ACP agent takes queued messages only between turns, in order", async () => {
  const { agent, send, pending, queue, settled } = await setup("acp", undefined);
  await send("First.");
  await send("Second.");
  // No runsTools: a turn that works keeps them, whatever it does.
  agent.set({ status: "working" });
  await settled();
  expect(agent.prompts).toEqual([]);
  expect(await pending()).toHaveLength(2);
  agent.set({ status: "idle" });
  await settled();
  expect(agent.prompts).toEqual(["First.\n\n---\n\nSecond."]);
  expect(await pending()).toEqual([]);
  // Nothing waits, so the queue stops listening.
  expect(agent.listeners.size).toBe(0);
  queue.stop();
});

test("a turn that a restart cut keeps its queued messages until the reader acts, and a stopped session keeps them", async () => {
  const { agent, send, pending, queue, settled } = await setup("claude", false);
  agent.set({ status: "idle", halt: { kind: "interrupted" } });
  await send("Keep the tests.");
  expect(agent.prompts).toEqual([]);
  // The reader continues the turn: the message goes at its next step.
  agent.set({ status: "working", halt: undefined });
  await settled();
  expect(agent.prompts).toEqual([]);
  agent.set({ tools: true });
  await settled();
  expect(agent.prompts).toEqual(["Keep the tests."]);

  // A session that the user stopped keeps what came after, as queued.
  agent.set({ tools: false });
  await send("And the docs.");
  agent.set({ status: "exited" });
  await settled();
  expect(agent.prompts).toEqual(["Keep the tests."]);
  expect(await pending()).toMatchObject([{ text: "And the docs.", queued: true }]);
  expect(agent.listeners.size).toBe(0);
  queue.stop();
});

test("Queue keeps a message for Claude Code's turn's end, also from a new host; Send now gives it at the next step", async () => {
  const { inbox, queue, agent, send, pending, settled } = await setup("claude", false);
  const rename = await send("Rename it.", true);
  // Claude Code runs tools, which would take a message sent now: this waits.
  agent.set({ tools: true });
  await settled();
  expect(agent.prompts).toEqual([]);
  // The flag is on the stored message, so a new host keeps it.
  expect((await new AgentInbox(directories.at(-1)!).messages("r1"))[0]).toMatchObject({
    id: rename.id,
    afterTurn: true,
  });
  // A message sent now goes at the next step, before the queued one.
  await send("Check the hour.");
  expect(agent.prompts).toEqual(["Check the hour."]);

  expect(await queue.sendNow("r1", "s1", rename.id)).toBe(true);
  await settled();
  expect(agent.prompts).toEqual(["Check the hour.", "Rename it."]);

  // Queued again, it goes when the turn ends.
  await send("Then the docs.", true);
  expect(agent.prompts).toHaveLength(2);
  agent.set({ status: "idle", tools: false });
  await settled();
  expect(agent.prompts.at(-1)).toBe("Then the docs.");
  expect(await pending()).toEqual([]);
  expect((await inbox.messages("r1")).every((message) => !message.afterTurn)).toBe(true);
  queue.stop();
});

test("Codex takes a message sent now in the turn that runs (steer), and a queued one when the turn ends or on Send now; an ACP agent keeps it", async () => {
  const codex = await setup("codex", undefined, true);
  await codex.send("Check the hour.");
  expect(codex.agent.steered).toEqual(["Check the hour."]);
  const later = await codex.send("And the date.", true);
  const last = await codex.send("And the year.", true);
  expect(codex.agent.steered).toEqual(["Check the hour."]);
  expect(await codex.queue.sendNow("r1", "s1", later.id)).toBe(true);
  await codex.settled();
  expect(codex.agent.steered).toEqual(["Check the hour.", "And the date."]);
  expect(await codex.pending()).toMatchObject([{ id: last.id, afterTurn: true }]);
  codex.agent.set({ status: "idle" });
  await codex.settled();
  expect(codex.agent.prompts).toEqual(["And the year."]);
  codex.queue.stop();

  const acp = await setup("acp", undefined);
  const kept = await acp.send("Wait for me.", true);
  expect(await acp.queue.sendNow("r1", "s1", kept.id)).toBe(false);
  expect(await acp.pending()).toMatchObject([{ id: kept.id, queued: true, afterTurn: true }]);
  acp.queue.stop();
});

/** An inbox whose next reads wait for the test: `pending` holds what it
 * read, and `deliverPending` waits before it takes the inbox's lock. */
class HeldInbox extends AgentInbox {
  holds: { pending?: Promise<void>; deliver?: Promise<void> } = {};
  reached: { pending?: () => void; deliver?: () => void } = {};
  override async pending(reviewId: string, sessionId: string) {
    const found = await super.pending(reviewId, sessionId);
    const hold = this.holds.pending;
    this.holds.pending = undefined;
    this.reached.pending?.();
    await hold;
    return found;
  }
  override async deliverPending(...args: Parameters<AgentInbox["deliverPending"]>) {
    const hold = this.holds.deliver;
    this.holds.deliver = undefined;
    this.reached.deliver?.();
    await hold;
    return super.deliverPending(...args);
  }
}

async function held() {
  const directory = await mkdtemp(join(tmpdir(), "med-queued-"));
  directories.push(directory);
  const inbox = new HeldInbox(directory);
  const agent = runner(false);
  const queue = createQueuedMessages({ inbox, runner: () => agent.fake });
  const store = (text: string, afterTurn: boolean) =>
    inbox.send("r1", session("claude"), { text, noteIds: [], attachmentCount: 0 }, text, {
      queued: true,
      afterTurn,
    });
  /** The next read of `kind` waits; resolves when it gets there, with the
   * function that lets it go on. */
  const hold = (kind: "pending" | "deliver") => {
    let go!: () => void;
    inbox.holds[kind] = new Promise<void>((resolve) => (go = resolve));
    return new Promise<() => void>((resolve) => {
      inbox.reached[kind] = () => {
        inbox.reached[kind] = undefined;
        resolve(go);
      };
    });
  };
  return { inbox, agent, queue, store, hold, settled: () => queue.settled("r1", "s1") };
}

test("a message queued while a delivery ends still goes when the turn ends", async () => {
  const { agent, queue, store, hold, settled } = await held();
  await store("Check the hour.", false);
  queue.watch("r1", "s1");
  await settled();
  // The tools start: the message sent now goes. The release's read of the
  // inbox finds nothing left, and holds that answer.
  const reached = hold("pending");
  agent.set({ tools: true });
  const go = await reached;
  expect(agent.prompts).toEqual(["Check the hour."]);
  // Meanwhile the user queues another for the turn's end.
  await store("Then the docs.", true);
  queue.watch("r1", "s1");
  go();
  await settled();
  agent.set({ status: "idle", tools: false });
  await settled();
  expect(agent.prompts).toEqual(["Check the hour.", "Then the docs."]);
  queue.stop();
});

test("a turn that begins while Med gives the waiting messages keeps the ones queued for its end", async () => {
  const { agent, queue, store, hold, settled, inbox } = await held();
  await store("Rename it.", true);
  queue.watch("r1", "s1");
  await settled();
  // The turn ends; the release reads idle and waits for the inbox's lock.
  const reached = hold("deliver");
  agent.set({ status: "idle" });
  const go = await reached;
  // Meanwhile a new turn begins, and the user queues for its end.
  agent.set({ status: "working" });
  await store("Then the docs.", true);
  queue.watch("r1", "s1");
  go();
  await settled();
  expect(agent.prompts).toEqual([]);
  expect((await inbox.messages("r1")).map((message) => message.delivery)).toEqual([
    "pending",
    "pending",
  ]);
  agent.set({ status: "idle" });
  await settled();
  expect(agent.prompts).toEqual(["Rename it.\n\n---\n\nThen the docs."]);
  queue.stop();
});
