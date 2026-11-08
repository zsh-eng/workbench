import { expect, test } from "vitest";
import { frecency, rankRepositories } from "../../src/web/data/repository-opens";

const HOUR = 3_600_000;
const now = Date.UTC(2026, 10, 7, 12);

test("frecency weighs the count by how recent the last open is, as zoxide does", () => {
  expect(frecency(undefined, now)).toBe(0);
  expect(frecency({ count: 3, last: now - 10 * 60_000 }, now)).toBe(12);
  expect(frecency({ count: 3, last: now - 5 * HOUR }, now)).toBe(6);
  expect(frecency({ count: 3, last: now - 3 * 24 * HOUR }, now)).toBe(1.5);
  expect(frecency({ count: 3, last: now - 30 * 24 * HOUR }, now)).toBe(0.75);
});

test("repositories rank by frecency, and those never opened keep their order", () => {
  const repositories = ["tide", "harbour", "almanac", "charts"].map((id) => ({ id }));
  const opens = {
    // Opened often, but a month ago.
    harbour: { count: 20, last: now - 30 * 24 * HOUR },
    // Opened twice, just now.
    charts: { count: 2, last: now - 60_000 },
  };
  expect(rankRepositories(repositories, opens, now).map((entry) => entry.id)).toEqual([
    "charts",
    "harbour",
    "tide",
    "almanac",
  ]);
});
