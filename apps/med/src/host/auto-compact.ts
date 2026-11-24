// Med's autocompact for Claude Code and Codex (agent-defaults.ts). Each takes
// Med's setting when its process or thread starts, so a session that started
// before the setting changed, or before Med set it, runs with what it had.
// After a turn that ends past the setting, Med sends the agent's own
// compaction. One that frees nothing, or that does not run, is the last until
// the context is under the setting again.

import type { OwnedCommand } from "../shared/owned-session";

/** The agent's own compaction, in the slash menu of an agent whose list
 * leaves it out: Claude Code's built-in /compact, and Codex's. */
export const COMPACT_COMMAND: OwnedCommand = {
  name: "compact",
  description: "Summarize the conversation to free its context",
};

/** A message that asks for the agent's compaction. */
export const isCompact = (text: string) => /^\/compact(\s|$)/.test(text.trim());

/** A turn's end, as the agent's runner saw it. */
export interface TurnEnd {
  /** The setting now, and the context at the turn's end. */
  at: number | undefined;
  used: number | undefined;
  /** The turn compacted, with the context before: Med's compaction, the
   * user's `/compact`, or the agent's own. */
  compacted?: number;
  /** Med sent the turn to compact. */
  asked?: boolean;
}

export function compactsPast() {
  /** The context before the last compaction, until a turn tells the size after. */
  let before: number | undefined;
  let stopped = false;
  return {
    /** Whether Med compacts after this turn. */
    ended({ at, used, compacted, asked }: TurnEnd) {
      // A context of 0 is one that the runner did not know.
      if (compacted !== undefined) {
        before = compacted || undefined;
        return false;
      }
      if (asked) {
        stopped = true;
        return false;
      }
      const from = before;
      before = undefined;
      if (!at || used === undefined) return false;
      if (used < at) {
        stopped = false;
        return false;
      }
      if (from !== undefined && used >= from * 0.9) stopped = true;
      return !stopped;
    },
  };
}
