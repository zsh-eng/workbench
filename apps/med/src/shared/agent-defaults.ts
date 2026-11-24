// Each agent's defaults in Med's settings file (docs/usage/settings.md), by
// the agent's ID: `<agent>.autoCompact` is the context, in tokens, past which
// the agent compacts its session. Med applies it as each agent takes it
// (owned-sessions.ts): Claude Code's CLAUDE_CODE_AUTO_COMPACT_WINDOW, Codex's
// model_auto_compact_token_limit, and for Pi and Antigravity, which take no
// such setting, `/compact` after a turn that ends past it.

/** The agents whose autocompact Med sets, in the order Settings lists them. */
export const AUTO_COMPACT_AGENTS = ["claude", "codex", "pi", "agy"] as const;

export const autoCompactKey = (agent: string) => `${agent}.autoCompact`;

/** The choices in Settings; the file can hold any number of tokens. */
export const AUTO_COMPACT_CHOICES = [
  100_000, 150_000, 200_000, 300_000, 400_000, 500_000, 750_000,
] as const;

/** What each agent takes: Claude Code a window of 100K to 1M. */
const RANGE: Record<string, [number, number]> = { claude: [100_000, 1_000_000] };

/** The agent's autocompact in the settings, in its range; none for its own default. */
export function autoCompactOf(
  settings: Readonly<Record<string, unknown>>,
  agent: string,
): number | undefined {
  const value = settings[autoCompactKey(agent)];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const [min, max] = RANGE[agent] ?? [10_000, 10_000_000];
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Where a compaction point comes from, for the context's note. */
export const AUTO_COMPACT_FROM = "Med's settings";
