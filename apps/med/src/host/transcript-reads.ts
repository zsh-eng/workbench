import { stat } from "node:fs/promises";

/**
 * How many transcripts' read states Med keeps. A Claude Code session with
 * hundreds of subagents has as many transcripts, and each pass over a
 * session reads all of them: with fewer places than that, each pass evicted
 * the states that the next pass needed, and Med read every file from its
 * start again, a gigabyte for a long session (docs/SESSIONS.md).
 */
export const MAX_TRANSCRIPT_READS = 8192;

/**
 * The read state of each transcript, by path, made on first use. The states
 * used last stay; past `limit`, the one used longest ago goes, and its file
 * is read again from the start if it comes back.
 */
export function transcriptReads<T>(make: () => T, limit = MAX_TRANSCRIPT_READS) {
  const reads = new Map<string, T>();
  return {
    get(path: string) {
      let state = reads.get(path);
      if (state) reads.delete(path);
      else {
        state = make();
        if (reads.size >= limit) reads.delete(reads.keys().next().value!);
      }
      reads.set(path, state);
      return state;
    },
    get size() {
      return reads.size;
    },
  };
}

/** Whether the file has bytes past `offset`, or got shorter: one stat, no open. */
export async function changedSince(path: string, offset: number) {
  return (await stat(path)).size !== offset;
}
