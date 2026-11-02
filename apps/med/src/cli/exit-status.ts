import { HostError } from "../host/runtime/errors";

/** A command that Med cannot run as written: it exits with status 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

/** A review, thread, or source that the command names does not exist: status 3. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The exit status of a failed command: 2 for wrong usage, 3 for something
 * that does not exist, 4 when no Med server runs for the command, else 1.
 */
export function exitStatus(error: unknown) {
  if (error instanceof UsageError) return 2;
  // parseArgs rejects an unknown option or a missing value with these codes.
  const code = (error as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS_")) return 2;
  if (error instanceof NotFoundError) return 3;
  if (error instanceof HostError && error.code === "no-server") return 4;
  return 1;
}

/** Edit distance, with a swap of two neighbours as one edit. */
function distance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  return rows[a.length]![b.length]!;
}

/** The name nearest to a mistyped word, when it is near enough to be a typo. */
export function nearest(word: string, names: readonly string[]) {
  let found: string | undefined;
  let best = Math.min(2, Math.floor(word.length / 2));
  for (const name of names) {
    const edits = distance(word.toLowerCase(), name);
    if (edits <= best && (edits < best || !found)) [found, best] = [name, edits];
  }
  return found;
}
