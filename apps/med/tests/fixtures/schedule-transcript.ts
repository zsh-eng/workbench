// A Claude Code transcript in which the agent scheduled work, as Claude Code
// 2.1 records it (docs/SCHEDULES.md): a recurring CronCreate, a one-shot that
// a CronDelete cancels, a ScheduleWakeup, and one fire of the recurring job.

const MINUTE = 60_000;
export const RECURRING_PROMPT =
  "Check CI on pull requests #101 to #104. If a check fails, fix it on the right layer.";
export const ONE_SHOT_PROMPT = "Ask Mira to review #101 if nobody has.";

/** The transcript's lines, starting `startedAt`; `fires` is how often the recurring job ran. */
export function scheduleTranscript(sessionId: string, startedAt: number, fires = 1) {
  let parent: string | null = null;
  let count = 0;
  const lines: unknown[] = [];
  const push = (at: number, entry: Record<string, unknown>) => {
    const uuid = `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
    lines.push({
      parentUuid: parent,
      uuid,
      sessionId,
      cwd: "/code/tide",
      version: "2.1.295",
      timestamp: new Date(at).toISOString(),
      ...entry,
    });
    parent = uuid;
  };
  const assistant = (at: number, content: unknown[]) =>
    push(at, {
      type: "assistant",
      message: {
        id: `msg_${count}`,
        role: "assistant",
        model: "claude-opus-5-5",
        content,
        stop_reason: content.some((block) => (block as { type: string }).type === "tool_use")
          ? "tool_use"
          : "end_turn",
      },
    });
  const tool = (at: number, name: string, input: unknown, result: string, detail: unknown) => {
    const id = `toolu_${String(count).padStart(6, "0")}`;
    assistant(at, [{ type: "tool_use", id, name, input }]);
    push(at + 200, {
      type: "user",
      message: {
        role: "user",
        content: [{ tool_use_id: id, type: "tool_result", content: result }],
      },
      toolUseResult: detail,
    });
  };
  push(startedAt, {
    type: "user",
    turnOrigin: "sdk",
    message: { role: "user", content: "Hand off the stack and watch its CI every hour." },
  });
  tool(
    startedAt + 30_000,
    "Bash",
    { command: "gh pr checks 104", description: "Read the stack's checks" },
    "All checks pass.",
    { stdout: "All checks pass.", stderr: "", interrupted: false },
  );
  tool(
    startedAt + MINUTE,
    "CronCreate",
    { cron: "23 * * * *", recurring: true, prompt: RECURRING_PROMPT },
    "Scheduled recurring job 4c1e9a20 (Every hour at :23). Session-only (not written to disk, dies when Claude exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.",
    { id: "4c1e9a20", humanSchedule: "Every hour at :23", recurring: true, durable: false },
  );
  tool(
    startedAt + 2 * MINUTE,
    "CronCreate",
    { cron: "50 17 26 10 *", recurring: false, prompt: ONE_SHOT_PROMPT },
    "Scheduled one-shot task 9d03b7e1 (50 17 26 10 *). Session-only (not written to disk, dies when Claude exits). It will fire once then auto-delete.",
    { id: "9d03b7e1", humanSchedule: "50 17 26 10 *", recurring: false, durable: false },
  );
  tool(startedAt + 3 * MINUTE, "CronDelete", { id: "9d03b7e1" }, "Cancelled job 9d03b7e1.", {
    id: "9d03b7e1",
  });
  tool(
    startedAt + 4 * MINUTE,
    "ScheduleWakeup",
    { delaySeconds: 1200, prompt: "/loop watch the stack's CI", reason: "watching CI" },
    "Scheduled wakeup in 20 minutes.",
    { delaySeconds: 1200 },
  );
  assistant(startedAt + 5 * MINUTE, [
    { type: "text", text: "CI is checked every hour at :23 while this session runs." },
  ]);
  for (let fire = 0; fire < fires; fire++) {
    const at = startedAt + (23 + fire * 60) * MINUTE;
    push(at, {
      type: "user",
      isMeta: true,
      turnOrigin: "scheduled",
      message: { role: "user", content: RECURRING_PROMPT },
    });
    assistant(at + 30_000, [{ type: "text", text: "All four pull requests pass CI." }]);
  }
  return lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
}
