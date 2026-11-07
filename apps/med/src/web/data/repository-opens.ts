// ⌘O ranks repositories as zoxide does: by how often and how recently you
// opened them. Each open counts; the count weighs more while the last open is
// recent.

const KEY = "med:repository-opens";
const HOUR = 3_600_000;

type Opens = Record<string, { count: number; last: number }>;

export function readOpens(): Opens {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Opens) : {};
  } catch {
    return {};
  }
}

/** Counts an open of the repository. */
export function recordOpen(id: string, now = Date.now()) {
  const opens = readOpens();
  opens[id] = { count: (opens[id]?.count ?? 0) + 1, last: now };
  try {
    localStorage.setItem(KEY, JSON.stringify(opens));
  } catch {
    /* The ranking lasts for this view. */
  }
}

/** zoxide's frecency: the count, ×4 within an hour, ×2 within a day, ÷2 within a week, else ÷4. */
export function frecency(open: { count: number; last: number } | undefined, now = Date.now()) {
  if (!open) return 0;
  const age = now - open.last;
  const weight = age < HOUR ? 4 : age < 24 * HOUR ? 2 : age < 7 * 24 * HOUR ? 0.5 : 0.25;
  return open.count * weight;
}

/** The repositories by frecency, highest first; those never opened keep their order. */
export function rankRepositories<T extends { id: string }>(
  repositories: readonly T[],
  opens: Opens = readOpens(),
  now = Date.now(),
) {
  return repositories
    .map((repository, index) => ({ repository, index, score: frecency(opens[repository.id], now) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.repository);
}
