import type { Note } from "../../../../shared/protocol";
import type { Thread } from "../../../../shared/threads";

// Synthetic data for the prototypes: Trailhead, the invented project of the
// Screens page.

export const FILTERS_PATH = "src/search/filters.ts";

export const FILTERS_TS = `import type { Trail } from "./trails";
import type { TrailFilters } from "./query";

export function matchesFilters(trail: Trail, filters: TrailFilters): boolean {
  if (filters.difficulty && trail.difficulty !== filters.difficulty) {
    return false;
  }
  if (
    filters.maxDistanceKm !== undefined &&
    trail.distanceKm > filters.maxDistanceKm
  ) {
    return false;
  }
  if (filters.loopOnly && !trail.loop) return false;
  return true;
}

/** Labels for the active filters, in the order the search bar shows them. */
export function describeFilters(filters: TrailFilters): string[] {
  const labels: string[] = [];
  if (filters.difficulty) labels.push(capitalize(filters.difficulty));
  if (filters.maxDistanceKm !== undefined) {
    labels.push(\`Under \${filters.maxDistanceKm} km\`);
  }
  if (filters.loopOnly) labels.push("Loop");
  return labels;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
`;

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const repository = { id: "trailhead", name: "trailhead", path: "/work/trailhead" };

/** The sidebar's sessions; `questions` adds the repository's Questions session. */
export function sidebarThreads(questions: boolean): Thread[] {
  return [
    ...(questions
      ? [
          {
            id: "questions",
            title: "Questions",
            createdAt: at(300),
            updatedAt: NOW - 30_000,
            repository,
            branch: "main",
            agent: "claude" as const,
            state: "working" as const,
            pinned: 1,
          },
        ]
      : []),
    {
      id: "search",
      title: "Search filters",
      createdAt: at(90),
      updatedAt: NOW - 20_000,
      repository,
      branch: "search-filters",
      agent: "claude",
      state: questions ? "idle" : "working",
      changes: { files: 4, additions: 46, deletions: 3 },
    },
    {
      id: "badges",
      title: "Difficulty badges",
      createdAt: at(200),
      updatedAt: NOW - 18 * 60_000,
      repository,
      branch: "difficulty-badges",
      agent: "codex",
      state: "idle",
      changes: { files: 2, additions: 21, deletions: 6 },
    },
    {
      id: "offline",
      title: "Offline map tiles",
      createdAt: at(1500),
      updatedAt: NOW - 26 * 3600_000,
      repository,
      branch: "offline-tiles",
      agent: "claude",
      state: "idle",
    },
  ];
}

const note = (
  id: string,
  line: number,
  endLine: number,
  text: string,
  minutesAgo: number,
  extra: Partial<Note> = {},
): Note => ({
  id,
  path: FILTERS_PATH,
  side: "new",
  line,
  ...(endLine !== line ? { endLine } : {}),
  text,
  createdAt: at(minutesAgo),
  updatedAt: at(minutesAgo),
  ...extra,
});

/** A question and the agent's answer, which streams in. */
export interface Question {
  note: Note;
  answer: string;
  /** Earlier turns of the thread, done. */
  earlier?: Note[];
  /** Whether the answer is still coming when the screen opens. */
  streaming: boolean;
}

export const sessionQuestion: Question = {
  note: note(
    "q1",
    22,
    24,
    'Is the limit inclusive? "Under 5 km" reads as if a 5 km trail is left out.',
    0.2,
  ),
  answer:
    "It is inclusive: `matchesFilters` drops a trail only when `trail.distanceKm > filters.maxDistanceKm` ([filters.ts:10](src/search/filters.ts:10)), so a 5 km trail stays. The label says less than the filter does.\n\n" +
    '"Up to 5 km" would match it. The test in [search.test.ts:22](tests/search.test.ts:22) only checks a 4.2 km trail, so a 5 km case would pin the edge down.',
  streaming: true,
};

export const workspaceQuestions: Question[] = [
  {
    note: note("q0", 5, 5, "Where does `filters.difficulty` come from?", 6),
    answer:
      "From the query string: `parseFilters` reads `?difficulty=` in [query.ts:12](src/search/query.ts:12), and leaves it undefined for “any”.",
    streaming: false,
  },
  {
    note: note("q2", 19, 27, "Is `describeFilters` used anywhere besides the search bar?", 0.2),
    answer:
      "Only in [SearchBar.tsx:9](src/search/SearchBar.tsx:9), which shows each label as a chip. Nothing else imports it, and no test calls it.\n\n" +
      "From your last question: the labels come in the order `parseFilters` fills `TrailFilters` ([query.ts:12–18](src/search/query.ts:12)), so difficulty always leads.",
    streaming: true,
  },
];
