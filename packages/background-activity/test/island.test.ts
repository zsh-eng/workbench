import { describe, expect, it } from "bun:test";
import {
  ISLAND_FOLD_MS,
  RESTING_ISLAND,
  islandStep,
  type IslandClock,
  type IslandContent,
} from "../src/index";

const cards: IslandContent = {
  mark: "progress",
  fraction: null,
  label: "Cards",
};
const history: IslandContent = {
  mark: "progress",
  fraction: 0.4,
  label: "History",
  detail: "40%",
};
const done: IslandContent = { mark: "done", label: "Restored" };

/** Steps the island through `[time, content]` and says what showed at each. */
function play(steps: [number, IslandContent | null][]) {
  let clock: IslandClock = RESTING_ISLAND;
  return steps.map(([now, content]) => {
    const step = islandStep(clock, content, now);
    clock = step.clock;
    return [now, step.phase, step.shown?.label ?? null, step.wakeAt];
  });
}

describe("islandStep", () => {
  it("shows a long wait after half a second, changes in place, confirms and folds", () => {
    expect(
      play([
        [0, cards],
        [499, cards],
        [500, cards],
        [9_000, history],
        [20_000, done],
        [21_499, done],
        [21_500, done],
        [21_500 + ISLAND_FOLD_MS, null],
      ]),
    ).toEqual([
      [0, "rest", null, 500],
      [499, "rest", null, 500],
      [500, "open", "Cards", null],
      [9_000, "open", "History", null],
      [20_000, "open", "Restored", 21_500],
      [21_499, "open", "Restored", 21_500],
      [21_500, "folding", "Restored", 21_500 + ISLAND_FOLD_MS],
      [21_500 + ISLAND_FOLD_MS, "rest", null, null],
    ]);
  });

  it("never shows work that ends within half a second, nor its done", () => {
    expect(
      play([
        [0, cards],
        [300, done],
        [2_000, null],
      ]).map(([, phase]) => phase),
    ).toEqual(["rest", "rest", "rest"]);
  });

  it("stays at least 0.6 s once it shows, even when the work just stops", () => {
    expect(
      play([
        [0, cards],
        [500, cards],
        [700, null],
        [1_100, null],
        [1_100 + ISLAND_FOLD_MS, null],
      ]),
    ).toEqual([
      [0, "rest", null, 500],
      [500, "open", "Cards", null],
      [700, "open", "Cards", 1_100],
      [1_100, "folding", "Cards", 1_100 + ISLAND_FOLD_MS],
      [1_100 + ISLAND_FOLD_MS, "rest", null, null],
    ]);
  });
});
