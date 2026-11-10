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

/** filters.ts before the change: no labels for the search bar yet. */
export const FILTERS_TS_BEFORE = `import type { Trail } from "./trails";
import type { TrailFilters } from "./query";

export function matchesFilters(trail: Trail, filters: TrailFilters): boolean {
  if (filters.difficulty && trail.difficulty !== filters.difficulty) {
    return false;
  }
  if (filters.maxDistanceKm && trail.distanceKm >= filters.maxDistanceKm) {
    return false;
  }
  return true;
}
`;

const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const repository = { id: "trailhead", name: "trailhead", path: "/work/trailhead" };

/** The sidebar's sessions. */
export function sidebarThreads(): Thread[] {
  return [
    {
      id: "search",
      kind: "session",
      reviews: [],
      title: "Search filters",
      createdAt: at(90),
      updatedAt: NOW - 20_000,
      repository,
      branch: "search-filters",
      agent: "claude",
      state: "working",
      changes: { files: 4, additions: 46, deletions: 3 },
    },
    {
      id: "badges",
      kind: "session",
      reviews: [],
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
      kind: "session",
      reviews: [],
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
