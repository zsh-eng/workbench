import type { SessionEvent, ToolCallContent } from "../shared/agent-session";
import type { TurnCheck } from "../shared/agent-status";
import type { AttemptCheck } from "../shared/attempts";

// Checks are the shell commands that test, type-check, lint, or build the
// work, such as `bun test` or `cd app && cargo test`. Med finds them in a
// session's tool calls. Attempts (attempts.ts) compare the checks of each
// attempt; the thread list (thread-turns.ts) tells the checks of each
// thread's last turn, which the turn recap and `med thread list --json` show.

/** Programs that check work: tests, type checks, linters, and builds. */
const CHECK_PROGRAM =
  /^(?:bunx\s+|npx\s+|pnpm\s+(?:exec|dlx)\s+|yarn\s+(?:dlx\s+)?)?(?:bun\s+test\b|bun\s+run\s+(?:test|check|lint|typecheck|build)\b|(?:npm|pnpm|yarn)\s+(?:test\b|run\s+(?:test|check|lint|typecheck|build)\b)|vitest\b|jest\b|mocha\b|playwright\s+test\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest)\b|cargo\s+(?:test|check|clippy|build)\b|go\s+(?:test|vet|build)\b|make\s+(?:test|check)\b|tsc\b|oxlint\b|eslint\b|biome\s+(?:check|lint)\b|ruff\b|mypy\b|swift\s+(?:test|build)\b|xcodebuild\b.*\btest\b|deno\s+(?:test|check|lint)\b|\.\/gradlew\s+test\b|mvn\s+test\b)/;

/** A package runner before the program, such as `bunx`. */
const RUNNER = /^(?:bunx|npx|pnpm\s+(?:exec|dlx)|yarn(?:\s+dlx)?)\s+/;

/** The parts of a shell command, without leading variables or `time`. */
const commandParts = (command: string) =>
  command.split(/&&|\|\||;|\||\n/).map((part) =>
    part
      .trim()
      .replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, "")
      .replace(/^(?:time|exec|env)\s+/, ""),
  );

/** Whether a shell command runs a check, such as `TZ=UTC bun test` or `cd app && cargo test`. */
export function isCheckCommand(command: string) {
  return commandParts(command).some((part) => CHECK_PROGRAM.test(part));
}

/** A check's short name: its program and check, without a runner, such as
 * "bun test" or "tsc" for `bunx tsc --noEmit`. */
export function checkName(command: string) {
  for (const part of commandParts(command)) {
    const match = CHECK_PROGRAM.exec(part);
    if (!match) continue;
    const words = match[0].replace(RUNNER, "").trim().split(/\s+/);
    // `xcodebuild -scheme Tide test` is "xcodebuild test".
    return (words.length > 3 ? [words[0], words.at(-1)] : words).join(" ");
  }
  return undefined;
}

/** Test counts from a check's output: bun test, then Vitest, Jest, pytest, and cargo. */
function checkCounts(output: string) {
  const tail = output.slice(-8000);
  const number = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const match = pattern.exec(tail);
      if (match) return Number(match[1]);
    }
    return undefined;
  };
  return {
    pass: number(/^\s*(\d+) pass\b/m, /\b(\d+) passed\b/),
    fail: number(/^\s*(\d+) fail\b/m, /\b(\d+) failed\b/),
    exit: number(/^Exit code:? (\d+)/m),
  };
}

/** Counts from a check's output, such as "5 pass · 1 fail", or its exit code. */
function checkSummary(output: string, failed: boolean) {
  const { pass, fail, exit } = checkCounts(output);
  if (pass !== undefined || fail !== undefined)
    return [pass !== undefined ? `${pass} pass` : "", fail ? `${fail} fail` : ""]
      .filter(Boolean)
      .join(" · ");
  return failed && exit ? `Exit ${exit}` : undefined;
}

const contentText = (content: ToolCallContent[] | undefined) =>
  (content ?? [])
    .map((part) =>
      part.type === "content" && part.content.type === "text" ? part.content.text : "",
    )
    .join("\n");

interface CheckCall {
  command: string;
  at: number;
  status?: string;
  output: string;
}

/** The check commands in a session's updates, in the order they started. */
function checkCalls(events: readonly SessionEvent[]) {
  const calls = new Map<string, CheckCall>();
  for (const { at, update } of events) {
    if (update.sessionUpdate === "tool_call") {
      const input = update.rawInput as { command?: unknown } | undefined;
      const command = typeof input?.command === "string" ? input.command.trim() : "";
      if (!command || !isCheckCommand(command)) continue;
      calls.set(update.toolCallId, {
        command,
        at,
        status: update.status,
        output: contentText(update.content),
      });
    } else if (update.sessionUpdate === "tool_call_update") {
      const call = calls.get(update.toolCallId);
      if (!call) continue;
      if (update.status) call.status = update.status;
      const output = contentText(update.content);
      if (output) call.output = output;
    }
  }
  return [...calls.values()];
}

/** The checks in a session's updates, the latest last; at most `limit`. */
export function sessionChecks(
  events: readonly SessionEvent[],
  working: boolean,
  limit: number,
): AttemptCheck[] {
  return checkCalls(events)
    .slice(-limit)
    .map((call) => {
      const status =
        call.status === "completed"
          ? "passed"
          : call.status === "failed"
            ? "failed"
            : working
              ? "running"
              : "unknown";
      const summary = checkSummary(call.output, status === "failed");
      return { command: call.command, status, ...(summary ? { summary } : {}), at: call.at };
    });
}

/** A turn tells at most this many checks. */
const TURN_CHECKS = 6;

/**
 * The checks that finished in one turn's updates: the last run of each check,
 * by name, in the order of those runs. A check without a result is left out.
 */
export function turnChecks(events: readonly SessionEvent[]): TurnCheck[] {
  const byName = new Map<string, TurnCheck>();
  for (const call of checkCalls(events)) {
    if (call.status !== "completed" && call.status !== "failed") continue;
    const name = checkName(call.command);
    if (!name) continue;
    const { pass, fail } = checkCounts(call.output);
    // A later run of the same check replaces the earlier one, and goes last.
    byName.delete(name);
    byName.set(name, {
      name,
      status: call.status === "failed" ? "failed" : "passed",
      ...(pass !== undefined && { pass }),
      ...(fail !== undefined && { fail }),
    });
  }
  return [...byName.values()].slice(-TURN_CHECKS);
}
