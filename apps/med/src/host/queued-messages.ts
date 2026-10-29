import { readFileSync } from "node:fs";
import type { AgentInbox } from "./agent-inbox";
import type { OwnedRunner } from "./owned-sessions";
import { writeStateFile } from "./runtime/state-file";

/**
 * Messages that the user sent while a session that Med runs worked
 * (docs/AGENT_WORKSPACES.md#queued-messages). Each waits in the inbox, where
 * the user can still take it back, until the agent takes it. The user picks
 * when, for each message:
 *
 * - **Send now** (the default): at the agent's next step. Claude Code runs
 *   the main conversation's tools: Med writes the messages to its input now,
 *   and Claude Code reads them when the tools end, in the same turn.
 *   Otherwise they go when the turn ends, or Esc stops it.
 * - **Queue**: when the turn ends, or Esc stops it, as the next prompt.
 *
 * Messages go in order, as one prompt (`AgentInbox.deliverPending`), so a
 * session waits for its turn's end while any of its messages is queued;
 * Send now, on a queued message or with a new one, sends them all at the
 * next step. An ACP agent has no way to take a prompt during its turn, so
 * its messages always wait for the turn's end. A turn that a restart cut
 * waits for the reader (OwnedState.halt), and so do its messages. The inbox
 * keeps them on disk, and `stateFile` keeps which wait for the turn's end;
 * after a restart of the host, `watch` starts again for each session that
 * has some.
 */
export function createQueuedMessages(options: {
  inbox: AgentInbox;
  runner(sessionId: string): OwnedRunner | undefined;
  /** Where the IDs of the messages that wait for their turn's end stay. */
  stateFile?: string;
}) {
  const watched = new Map<string, { check(): void; unsubscribe(): void }>();
  const key = (reviewId: string, sessionId: string) => `${reviewId}:${sessionId}`;
  const afterTurn = new Set<string>(readIds(options.stateFile));
  // Sessions with a Queue message on its way into the inbox: it waits from
  // the moment it is stored, before `queue` has its ID.
  const arriving = new Map<string, number>();
  // One write at a time, in order. The flags are a convenience: without
  // them, the messages go at the next step.
  let saving = Promise.resolve();
  const save = () => {
    const file = options.stateFile;
    if (!file) return;
    const text = JSON.stringify([...afterTurn].slice(-1000));
    saving = saving.then(() => writeStateFile(file, text)).catch(() => {});
  };

  /** The session's messages that have not gone yet. */
  const waiting = async (reviewId: string, sessionId: string) =>
    (await options.inbox.messages(reviewId)).filter(
      (message) => message.sessionId === sessionId && message.delivery === "pending",
    );

  /** Whether the agent takes the messages now. */
  const ready = (runner: OwnedRunner, queued: boolean) => {
    const { status, halt } = runner.state();
    if (halt) return false;
    return status === "idle" || (status === "working" && !queued && !!runner.runsTools?.());
  };

  const stop = (name: string) => {
    watched.get(name)?.unsubscribe();
    watched.delete(name);
  };

  const release = async (reviewId: string, sessionId: string) => {
    const runner = options.runner(sessionId);
    // A session that the user stopped keeps its messages; they show as queued.
    if (!runner || runner.state().status === "exited") return stop(key(reviewId, sessionId));
    const before = await waiting(reviewId, sessionId);
    const queued =
      arriving.has(key(reviewId, sessionId)) || before.some((message) => afterTurn.has(message.id));
    if (!ready(runner, queued)) return;
    await options.inbox.deliverPending(reviewId, sessionId, (body) => runner.prompt(body));
    const left = await waiting(reviewId, sessionId);
    // The ones that went, or that the user took back, wait for nothing now.
    let changed = false;
    for (const message of before)
      if (afterTurn.has(message.id) && !left.some((entry) => entry.id === message.id))
        changed = afterTurn.delete(message.id) || changed;
    if (changed) save();
    if (!left.length) stop(key(reviewId, sessionId));
  };

  /** Gives the session's queued messages to its agent when it takes them. */
  const watch = (reviewId: string, sessionId: string) => {
    const name = key(reviewId, sessionId);
    const runner = options.runner(sessionId);
    if (!runner) return;
    if (!watched.has(name)) {
      // One delivery at a time; a change during one asks again after it.
      let running: Promise<void> | undefined;
      let again = false;
      const check = () => {
        if (running) {
          again = true;
          return;
        }
        running = release(reviewId, sessionId)
          .catch(() => {})
          .finally(() => {
            running = undefined;
            if (again && watched.has(name)) {
              again = false;
              check();
            }
          });
      };
      watched.set(name, { check, unsubscribe: runner.subscribe(check) });
    }
    watched.get(name)!.check();
  };

  return {
    watch,
    /**
     * Stores a Queue message with `send`. The session's messages wait for the
     * turn's end from the moment the inbox has it, before its ID is known.
     */
    async queueing<T extends { id: string; delivery: string }>(
      reviewId: string,
      sessionId: string,
      send: () => Promise<T>,
    ) {
      const name = key(reviewId, sessionId);
      arriving.set(name, (arriving.get(name) ?? 0) + 1);
      try {
        const message = await send();
        if (message.delivery === "pending") {
          afterTurn.add(message.id);
          save();
        }
        return message;
      } finally {
        const left = arriving.get(name)! - 1;
        if (left) arriving.set(name, left);
        else arriving.delete(name);
      }
    },
    /** The user took the message back. */
    forget(id: string) {
      if (afterTurn.delete(id)) save();
    },
    /** Whether this message waits for its turn's end. */
    queued: (id: string) => afterTurn.has(id),
    /** Lets the last write of the flags end, as before the host closes. */
    settled: () => saving,
    /** Sends the session's waiting messages at the agent's next step. */
    async sendNow(reviewId: string, sessionId: string) {
      let changed = false;
      for (const message of await waiting(reviewId, sessionId))
        changed = afterTurn.delete(message.id) || changed;
      if (changed) save();
      watch(reviewId, sessionId);
    },
    stop() {
      for (const entry of watched.values()) entry.unsubscribe();
      watched.clear();
    },
  };
}

function readIds(file: string | undefined): string[] {
  if (!file) return [];
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
