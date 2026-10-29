import type { AgentInbox } from "./agent-inbox";
import type { OwnedRunner } from "./owned-sessions";

/**
 * Messages that the user sent while a session that Med runs worked
 * (docs/AGENT_WORKSPACES.md#queued-messages). Each waits in the inbox, where
 * the user can still take it back, until the turn ends, or Esc stops it;
 * then they go as the next prompt, in order. **Send now** (`steer`) gives one
 * to the turn that runs, where the agent can take it: Claude Code reads it
 * after the tools that run, and Codex at its next step (`turn/steer`).
 *
 * A turn that a restart cut waits for the reader (OwnedState.halt), and so
 * do its messages. The inbox keeps them on disk; after a restart of the
 * host, `watch` starts again for each session that has some.
 */
export function createQueuedMessages(options: {
  inbox: AgentInbox;
  runner(sessionId: string): OwnedRunner | undefined;
}) {
  const watched = new Map<string, { check(): void; unsubscribe(): void }>();
  const key = (reviewId: string, sessionId: string) => `${reviewId}:${sessionId}`;

  /** Whether the agent takes a message now. */
  const ready = (runner: OwnedRunner) => {
    const { status, halt } = runner.state();
    if (halt) return false;
    return status === "idle";
  };

  const stop = (name: string) => {
    watched.get(name)?.unsubscribe();
    watched.delete(name);
  };

  const release = async (reviewId: string, sessionId: string) => {
    const runner = options.runner(sessionId);
    // A session that the user stopped keeps its messages; they show as queued.
    if (!runner || runner.state().status === "exited") return stop(key(reviewId, sessionId));
    if (!ready(runner)) return;
    await options.inbox.deliverPending(reviewId, sessionId, (body) => runner.prompt(body));
    if (!(await options.inbox.pending(reviewId, sessionId))) stop(key(reviewId, sessionId));
  };

  return {
    /**
     * Gives one queued message to the turn that runs now (Send now), or as
     * the next prompt between turns. Undefined when the agent cannot take
     * a message during its turn.
     */
    async steer(reviewId: string, sessionId: string, messageId: string) {
      const runner = options.runner(sessionId);
      if (!runner || runner.state().status === "exited") return false;
      const working = runner.state().status === "working";
      if (working && !runner.steer) return false;
      await options.inbox.deliverPending(
        reviewId,
        sessionId,
        (body) => (working ? runner.steer!(body) : runner.prompt(body)),
        undefined,
        [messageId],
      );
      return true;
    },
    /** Gives the session's queued messages to its agent when its turn ends. */
    watch(reviewId: string, sessionId: string) {
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
    },
    stop() {
      for (const entry of watched.values()) entry.unsubscribe();
      watched.clear();
    },
  };
}
