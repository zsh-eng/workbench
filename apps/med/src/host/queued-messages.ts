import type { AgentInbox } from "./agent-inbox";
import type { OwnedRunner } from "./owned-sessions";

/**
 * Messages that the user sent while a session that Med runs worked
 * (docs/AGENT_WORKSPACES.md#queued-messages). Each waits in the inbox, where
 * the user can still take it back, until the agent takes it. The user picks
 * when, for each message:
 *
 * - **Send now** (the default): at the agent's next step. Claude Code runs
 *   the main conversation's tools: Med writes the messages to its input now,
 *   and Claude Code reads them when the tools end, in the same turn, as its
 *   terminal does with a queued message. Codex takes them in the turn that
 *   runs (`turn/steer`).
 * - **Queue** (`afterTurn` on the stored message): when the turn ends, or
 *   Esc stops it, as the next prompt.
 *
 * An agent that can do neither, such as one through ACP, takes every message
 * when its turn ends. Between turns, the waiting messages go together, in
 * order. A turn that a restart cut waits for the reader (OwnedState.halt),
 * and so do its messages. The inbox keeps them, with their flags, on disk;
 * after a restart of the host, `watch` starts again for each session that
 * has some.
 */
export function createQueuedMessages(options: {
  inbox: AgentInbox;
  runner(sessionId: string): OwnedRunner | undefined;
}) {
  const watched = new Map<
    string,
    { check(): void; unsubscribe(): void; running(): Promise<void> | undefined }
  >();
  const key = (reviewId: string, sessionId: string) => `${reviewId}:${sessionId}`;

  const stop = (name: string) => {
    watched.get(name)?.unsubscribe();
    watched.delete(name);
  };

  const release = async (reviewId: string, sessionId: string) => {
    const runner = options.runner(sessionId);
    // A session that the user stopped keeps its messages; they show as queued.
    if (!runner || runner.state().status === "exited") return stop(key(reviewId, sessionId));
    const { status, halt } = runner.state();
    if (halt) return;
    if (status === "idle")
      await options.inbox.deliverPending(reviewId, sessionId, (body) => runner.prompt(body));
    else if (status === "working") {
      // During the turn, only the messages sent now, where the agent can take
      // them: Claude Code while its tools run, Codex by steering the turn.
      const tools = runner.runsTools?.() ? () => runner.runsTools!() : undefined;
      const take = tools
        ? (body: string) => runner.prompt(body)
        : runner.steer
          ? (body: string) => runner.steer!(body)
          : undefined;
      if (!take) return;
      // Checked again inside the inbox's lock: a turn that ended meanwhile
      // takes them all, in order, as its next prompt.
      const when = () => {
        const now = runner.state();
        return now.status === "working" && !now.halt && (!tools || tools());
      };
      await options.inbox.deliverPending(reviewId, sessionId, take, undefined, {
        only: (message) => !!message.queued && !message.afterTurn,
        when,
      });
    }
    if (!(await options.inbox.pending(reviewId, sessionId))) stop(key(reviewId, sessionId));
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
      watched.set(name, { check, unsubscribe: runner.subscribe(check), running: () => running });
    }
    watched.get(name)!.check();
  };

  return {
    watch,
    /**
     * Send now on a queued message: it goes at the agent's next step, not
     * its turn's end. False when the agent cannot take a message during its
     * turn, so it waits for the turn's end anyway.
     */
    async sendNow(reviewId: string, sessionId: string, messageId: string) {
      const runner = options.runner(sessionId);
      if (!runner || runner.state().status === "exited") return false;
      if (runner.state().status === "working" && !runner.runsTools && !runner.steer) return false;
      await options.inbox.sendNow(reviewId, messageId);
      watch(reviewId, sessionId);
      return true;
    },
    /** Waits until no delivery to the session runs, as when its runner's
     * last change has had its effect. */
    async settled(reviewId: string, sessionId: string) {
      for (let running; (running = watched.get(key(reviewId, sessionId))?.running());)
        await running;
    },
    stop() {
      for (const entry of watched.values()) entry.unsubscribe();
      watched.clear();
    },
  };
}
