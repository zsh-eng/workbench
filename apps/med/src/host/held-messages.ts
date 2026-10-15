// Messages to a Claude session that another process runs, such as `claude`
// in a terminal. Med cannot type there, so a message waits. While one waits,
// Med checks every few seconds whether the process still runs; when it ends,
// Med resumes the session and gives it the messages (server.ts). Nothing
// polls while no message waits.

/** How often Med checks the process while a message waits for it. */
const CHECK_MS = 3000;

/**
 * What a check found: the messages still wait (`held`), or they went to the
 * agent, or to a `med review wait`, and the watch ends (`done`).
 */
export type HeldCheck = (reviewId: string, sessionId: string) => Promise<"held" | "done">;

export function createHeldMessages({
  check,
  intervalMs = CHECK_MS,
}: {
  check: HeldCheck;
  intervalMs?: number;
}) {
  const watched = new Map<string, { reviewId: string; sessionId: string }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = () => {
    if (timer || stopped || !watched.size) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };
  const tick = async () => {
    for (const [key, entry] of [...watched]) {
      if (stopped) return;
      const result = await check(entry.reviewId, entry.sessionId).catch(() => "held" as const);
      if (result === "done") watched.delete(key);
    }
    timer = undefined;
    schedule();
  };

  return {
    /** Checks the session's process until its messages leave. */
    watch(reviewId: string, sessionId: string) {
      watched.set(`${reviewId}:${sessionId}`, { reviewId, sessionId });
      schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      watched.clear();
    },
  };
}
