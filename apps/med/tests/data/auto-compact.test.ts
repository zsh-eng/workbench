import { expect, test } from "vitest";
import { compactsPast, isCompact } from "../../src/host/auto-compact";

// Med's autocompact for Claude Code and Codex: after a turn past the setting,
// the agent's own compaction, until one frees nothing.

test("A turn past the setting compacts; one under it, or without the setting, does not", () => {
  const compacts = compactsPast();
  expect(compacts.ended({ at: 200_000, used: 150_000 })).toBe(false);
  expect(compacts.ended({ at: undefined, used: 900_000 })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: undefined })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 250_000 })).toBe(true);
  // The compaction's own turn, then a turn well under the setting.
  expect(compacts.ended({ at: 200_000, used: 250_000, compacted: 250_000, asked: true })).toBe(
    false,
  );
  expect(compacts.ended({ at: 200_000, used: 30_000 })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 210_000 })).toBe(true);
});

test("A compaction that frees nothing, or that does not run, is the last until the context is under the setting", () => {
  const compacts = compactsPast();
  expect(compacts.ended({ at: 200_000, used: 300_000 })).toBe(true);
  expect(compacts.ended({ at: 200_000, used: 300_000, compacted: 300_000, asked: true })).toBe(
    false,
  );
  expect(compacts.ended({ at: 200_000, used: 295_000 })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 310_000 })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 120_000 })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 220_000 })).toBe(true);
  // Med asked, and no compaction came.
  expect(compacts.ended({ at: 200_000, used: 220_000, asked: true })).toBe(false);
  expect(compacts.ended({ at: 200_000, used: 230_000 })).toBe(false);
  // A compaction whose context before it the runner did not know.
  const other = compactsPast();
  expect(other.ended({ at: 10_000, used: 5000, compacted: 0, asked: true })).toBe(false);
  expect(other.ended({ at: 10_000, used: 19_000 })).toBe(true);
});

test("/compact, with or without instructions, asks for the compaction", () => {
  expect(isCompact("/compact")).toBe(true);
  expect(isCompact("  /compact keep the plan  ")).toBe(true);
  expect(isCompact("/compactly")).toBe(false);
  expect(isCompact("Run /compact")).toBe(false);
});
