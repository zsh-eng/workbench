// A small, invented app for the site's screenshots: "Trailhead", a day-hike
// search. `history` becomes commits; each round is an agent's working changes
// and the brief it hands to Med. No real repository, person, or path is used.

export const author = { name: "Jordan Lee", email: "jordan@example.com" };

type Files = Record<string, string>;

export interface Commit {
  date: string;
  message: string;
  files: Files;
}

export interface Round {
  files: Files;
  brief: string;
}

const trails = `export type Difficulty = "easy" | "moderate" | "hard";

export interface Trail {
  id: string;
  name: string;
  region: string;
  distanceKm: number;
  elevationGainM: number;
  difficulty: Difficulty;
  loop: boolean;
}

export const trails: Trail[] = [
  {
    id: "lost-lake",
    name: "Lost Lake Loop",
    region: "Mount Hood",
    distanceKm: 5.1,
    elevationGainM: 60,
    difficulty: "easy",
    loop: true,
  },
  {
    id: "dog-mountain",
    name: "Dog Mountain",
    region: "Columbia Gorge",
    distanceKm: 11.6,
    elevationGainM: 880,
    difficulty: "hard",
    loop: true,
  },
  {
    id: "angels-rest",
    name: "Angel's Rest",
    region: "Columbia Gorge",
    distanceKm: 7.7,
    elevationGainM: 450,
    difficulty: "moderate",
    loop: false,
  },
  {
    id: "pinnacle",
    name: "Pínnacle Ridge",
    region: "Mount Hood",
    distanceKm: 9.3,
    elevationGainM: 520,
    difficulty: "moderate",
    loop: false,
  },
  {
    id: "trillium",
    name: "Trillium Lake",
    region: "Mount Hood",
    distanceKm: 3.2,
    elevationGainM: 20,
    difficulty: "easy",
    loop: true,
  },
];
`;

const queryV1 = `export interface SearchQuery {
  text: string;
}

/** Lowercases and strips accents, so "pinnacle" matches "Pínnacle". */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function parseQuery(input: string): SearchQuery {
  return { text: normalize(input) };
}
`;

const queryV2 = `import type { Difficulty } from "../trails";

export interface TrailFilters {
  difficulty?: Difficulty;
  maxDistanceKm?: number;
  loopOnly?: boolean;
}

export interface SearchQuery {
  text: string;
  filters: TrailFilters;
}

const difficulties = new Set<string>(["easy", "moderate", "hard"]);

/** Lowercases and strips accents, so "pinnacle" matches "Pínnacle". */
export function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Splits filter tokens such as \`difficulty:moderate\`, \`under:12km\`, and
 * \`is:loop\` from the free text. Unknown tokens stay in the text.
 */
export function parseQuery(input: string): SearchQuery {
  const filters: TrailFilters = {};
  const words: string[] = [];
  for (const token of input.split(/\\s+/).filter(Boolean)) {
    const [key, value = ""] = token.toLowerCase().split(":", 2);
    if (key === "difficulty" && difficulties.has(value)) {
      filters.difficulty = value as Difficulty;
    } else if (key === "under" && /^\\d+(\\.\\d+)?km$/.test(value)) {
      filters.maxDistanceKm = Number.parseFloat(value);
    } else if (key === "is" && value === "loop") {
      filters.loopOnly = true;
    } else {
      words.push(token);
    }
  }
  return { text: normalize(words.join(" ")), filters };
}
`;

const searchV1 = `import { trails, type Trail } from "../trails";
import { normalize, parseQuery } from "./query";

export interface SearchResult {
  trail: Trail;
  score: number;
}

export function searchTrails(
  input: string,
  catalog: Trail[] = trails,
): SearchResult[] {
  const query = parseQuery(input);
  if (!query.text) return catalog.map((trail) => ({ trail, score: 0 }));
  return catalog
    .map((trail) => ({ trail, score: score(trail, query.text) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.trail.name.localeCompare(b.trail.name));
}

function score(trail: Trail, text: string): number {
  const name = normalize(trail.name);
  const region = normalize(trail.region);
  if (name.startsWith(text)) return 3;
  if (name.includes(text)) return 2;
  if (region.includes(text)) return 1;
  return 0;
}
`;

const searchV2 = `import { trails, type Trail } from "../trails";
import { matchesFilters } from "./filters";
import { normalize, parseQuery } from "./query";

export interface SearchResult {
  trail: Trail;
  score: number;
}

export function searchTrails(
  input: string,
  catalog: Trail[] = trails,
): SearchResult[] {
  const query = parseQuery(input);
  // Filters narrow the catalog first, so ranking only sees eligible trails.
  const eligible = catalog.filter((trail) => matchesFilters(trail, query.filters));
  if (!query.text) return eligible.map((trail) => ({ trail, score: 0 }));
  return eligible
    .map((trail) => ({ trail, score: score(trail, query.text) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || a.trail.name.localeCompare(b.trail.name));
}

function score(trail: Trail, text: string): number {
  const name = normalize(trail.name);
  const region = normalize(trail.region);
  if (name.startsWith(text)) return 3;
  if (name.includes(text)) return 2;
  if (region.includes(text)) return 1;
  return 0;
}
`;

export const filtersV1 = `import type { Trail } from "../trails";
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
`;

export const filtersV2 = `${filtersV1}
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

export const searchBarV1 = `import { useId, useState } from "react";
import { searchTrails } from "../search";

export function SearchBar({ onResults }: { onResults: (count: number) => void }) {
  const id = useId();
  const [value, setValue] = useState("");

  function update(next: string) {
    setValue(next);
    onResults(searchTrails(next).length);
  }

  return (
    <label htmlFor={id} className="search">
      <span className="search-label">Search trails</span>
      <input
        id={id}
        type="search"
        value={value}
        placeholder="Name or region"
        onChange={(event) => update(event.target.value)}
      />
    </label>
  );
}
`;

export const searchBarV2 = `import { useId, useState } from "react";
import { searchTrails } from "../search";
import { describeFilters } from "../search/filters";
import { parseQuery } from "../search/query";

export function SearchBar({ onResults }: { onResults: (count: number) => void }) {
  const id = useId();
  const [value, setValue] = useState("");
  const filters = describeFilters(parseQuery(value).filters);

  function update(next: string) {
    setValue(next);
    onResults(searchTrails(next).length);
  }

  return (
    <div className="search">
      <label htmlFor={id} className="search-label">
        Search trails
      </label>
      <input
        id={id}
        type="search"
        value={value}
        placeholder="Name, region, or difficulty:moderate"
        onChange={(event) => update(event.target.value)}
      />
      {filters.length > 0 && (
        <ul className="search-filters" aria-label="Active filters">
          {filters.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
`;

const cssV1 = `.search {
  display: grid;
  gap: 6px;
}

.search-label {
  font-weight: 600;
}

.search input {
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
`;

const cssV2 = `${cssV1}
.search-filters {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.search-filters li {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 13px;
}
`;

const testsV1 = `import { describe, expect, it } from "vitest";
import { searchTrails } from "../src/search";

describe("searchTrails", () => {
  it("ranks name matches above region matches", () => {
    const names = searchTrails("lake").map((result) => result.trail.name);
    expect(names[0]).toBe("Lost Lake Loop");
  });

  it("ignores accents and case", () => {
    expect(searchTrails("PINNACLE")).toHaveLength(1);
  });
});
`;

const testsV2 = `import { describe, expect, it } from "vitest";
import { searchTrails } from "../src/search";
import { parseQuery } from "../src/search/query";

describe("searchTrails", () => {
  it("ranks name matches above region matches", () => {
    const names = searchTrails("lake").map((result) => result.trail.name);
    expect(names[0]).toBe("Lost Lake Loop");
  });

  it("ignores accents and case", () => {
    expect(searchTrails("PINNACLE")).toHaveLength(1);
  });

  it("filters by difficulty and distance before ranking", () => {
    const results = searchTrails("difficulty:moderate under:9km");
    expect(results.map(({ trail }) => trail.id)).toEqual(["angels-rest"]);
  });

  it("keeps unknown tokens as search text", () => {
    expect(parseQuery("color:red lake").text).toBe("color:red lake");
  });
});
`;

export const history: Commit[] = [
  {
    date: "2026-09-28T10:12:00+02:00",
    message: "chore: start Trailhead",
    files: {
      "package.json": `{
  "name": "trailhead",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run"
  }
}
`,
      "README.md": `# Trailhead

Find a day hike near you. Search trails by name or region.
`,
      "src/trails.ts": trails,
    },
  },
  {
    date: "2026-09-30T16:40:00+02:00",
    message: "feat: search trails by name and region",
    files: {
      "src/search/query.ts": queryV1,
      "src/search/index.ts": searchV1,
    },
  },
  {
    date: "2026-10-02T09:05:00+02:00",
    message: "feat: add the search bar",
    files: { "src/ui/SearchBar.tsx": searchBarV1, "src/ui/search.css": cssV1 },
  },
  {
    date: "2026-10-03T14:22:00+02:00",
    message: "test: cover name and region search",
    files: { "tests/search.test.ts": testsV1 },
  },
];

export const rounds: Round[] = [
  {
    files: {
      "src/search/query.ts": queryV2,
      "src/search/filters.ts": filtersV1,
      "src/search/index.ts": searchV2,
      "tests/search.test.ts": testsV2,
    },
    brief: `Search now reads filters from the query text. \`difficulty:moderate\`, \`under:12km\`, and \`is:loop\` narrow the results; other words stay free text ([query.ts:29-45](src/search/query.ts:29-45)).

Filters run before ranking, so scores only compare eligible trails ([index.ts:15-16](src/search/index.ts:15-16)). The checks live in their own module ([filters.ts:4-16](src/search/filters.ts:4-16)).

Two tests cover a combined filter and an unknown token ([search.test.ts:15-22](tests/search.test.ts:15-22)).
`,
  },
  {
    files: {
      "src/search/filters.ts": filtersV2,
      "src/ui/SearchBar.tsx": searchBarV2,
      "src/ui/search.css": cssV2,
    },
    brief: `The search bar now shows the active filters, so it is clear why trails are hidden ([SearchBar.tsx:9](src/ui/SearchBar.tsx:9), [SearchBar.tsx:28-34](src/ui/SearchBar.tsx:28-34)).

\`describeFilters\` turns the parsed filters into labels in a fixed order ([filters.ts:19-27](src/search/filters.ts:19-27)). The chips use the existing surface color ([search.css:16-29](src/ui/search.css:16-29)).
`,
  },
];

/** Reviewer comments on new lines. Round two answers the first one. */
export const comments = [
  {
    round: 0,
    file: "src/search/index.ts",
    line: 16,
    text: "Show the active filters in the search bar. Without them, people cannot see why trails are hidden.",
  },
  {
    round: 1,
    file: "src/ui/SearchBar.tsx",
    line: 29,
    text: 'Add aria-live="polite" to this list, so screen readers hear when the filters change.',
  },
];
