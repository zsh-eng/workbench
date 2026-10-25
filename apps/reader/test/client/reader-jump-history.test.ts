import { describe, expect, it } from "vitest";
import {
  ReaderJumpHistoryController,
  READER_HISTORY_LIMIT,
  type ReaderVisitKind,
} from "@/features/reader/jump-history";
import type { ContentAnchor, SpreadIntent } from "@/lib/pagination-v2";

const anchor = (name: string): ContentAnchor => ({
  type: "block",
  chapterIndex: 0,
  blockId: name,
});
const names = (history: ReaderJumpHistoryController) =>
  history.getSnapshot().entries.map((entry) => entry.anchor.blockId);
function visit(
  history: ReaderJumpHistoryController,
  name: string,
  kind: ReaderVisitKind = "normal",
) {
  history.record(
    anchor(name),
    kind === "normal"
      ? { kind: "linear", direction: "forward" }
      : { kind: "jump", source: kind },
  );
}
function initial() {
  const history = new ReaderJumpHistoryController();
  history.record(anchor("A"), { kind: "restore" });
  return history;
}
function travel(
  history: ReaderJumpHistoryController,
  direction: "back" | "forward",
) {
  const target = history.getReturnTarget(direction);
  if (target) history.record(target.anchor, target.intent);
}

describe("Reader jump history", () => {
  it("updates consecutive normal navigation in one entry", () => {
    const history = initial();
    visit(history, "B");
    visit(history, "C");
    expect(names(history)).toEqual(["C"]);
  });

  it("keeps the highlight arrival and adds one entry for subsequent reading", () => {
    const history = initial();
    visit(history, "H1", "highlight");
    visit(history, "R1");
    visit(history, "R2");
    visit(history, "R3");
    visit(history, "H2", "highlight");
    expect(names(history)).toEqual(["A", "H1", "R3", "H2"]);
    expect(history.getSnapshot().entries.map((entry) => entry.kind)).toEqual([
      "normal",
      "highlight",
      "normal",
      "highlight",
    ]);
    travel(history, "back");
    expect(history.getSnapshot().cursor).toBe(2);
    travel(history, "back");
    expect(history.getSnapshot().cursor).toBe(1);
  });

  it.each(["highlight", "scrubber", "search", "toc", "chapter"] as const)(
    "replaces consecutive %s destinations",
    (kind) => {
      const history = initial();
      visit(history, "B1", kind);
      visit(history, "B2", kind);
      visit(history, "B3", kind);
      expect(names(history)).toEqual(["A", "B3"]);
    },
  );

  it("keeps the final scrub destination before a highlight jump", () => {
    const history = initial();
    visit(history, "B1", "scrubber");
    visit(history, "B2", "scrubber");
    visit(history, "B3", "scrubber");
    visit(history, "C", "highlight");
    expect(names(history)).toEqual(["A", "B3", "C"]);
  });

  it("ignores previews but records a commit to the previewed location", () => {
    const history = initial();
    const before = history.getSnapshot();
    for (const name of ["B1", "B2", "B3"])
      history.record(anchor(name), { kind: "preview", source: "scrubber" });
    expect(history.getSnapshot()).toBe(before);
    visit(history, "B3", "scrubber");
    expect(names(history)).toEqual(["A", "B3"]);
  });

  it("preserves every source in a chain of internal links", () => {
    const history = initial();
    visit(history, "B", "internal-link");
    visit(history, "C", "internal-link");
    expect(names(history)).toEqual(["A", "B", "C"]);
    travel(history, "back");
    travel(history, "back");
    expect(history.getSnapshot().cursor).toBe(0);
    travel(history, "forward");
    travel(history, "forward");
    expect(history.getSnapshot().cursor).toBe(2);
    expect(names(history)).toEqual(["A", "B", "C"]);
  });

  it("discards the Forward branch on a fresh jump, even with the same kind", () => {
    const history = initial();
    visit(history, "B", "highlight");
    visit(history, "C", "scrubber");
    travel(history, "back");
    visit(history, "D", "highlight");
    expect(names(history)).toEqual(["A", "B", "D"]);
    expect(history.getReturnTarget("forward")).toBeNull();
  });

  it("discards the Forward branch when reading starts from a returned place", () => {
    const history = initial();
    visit(history, "B", "highlight");
    travel(history, "back");
    visit(history, "R");
    expect(names(history)).toEqual(["A", "R"]);
    expect(history.getReturnTarget("forward")).toBeNull();
  });

  it("retains explicit revisits without globally deduplicating anchors", () => {
    const history = initial();
    visit(history, "B", "internal-link");
    visit(history, "A", "internal-link");
    visit(history, "C", "highlight");
    expect(names(history)).toEqual(["A", "B", "A", "C"]);
  });

  it("does not change the cursor until a requested return succeeds", () => {
    const history = initial();
    visit(history, "H", "highlight");
    const target = history.getReturnTarget("back")!;
    expect(history.getSnapshot().cursor).toBe(1);
    history.record(anchor("wrong"), target.intent);
    expect(history.getSnapshot().cursor).toBe(1);
    history.record(target.anchor, target.intent);
    history.record(target.anchor, target.intent);
    expect(history.getSnapshot().cursor).toBe(0);
    expect(names(history)).toEqual(["A", "H"]);
  });

  it("preserves the Forward branch on previews, restore, layout and no-op jumps", () => {
    const history = initial();
    visit(history, "H", "highlight");
    travel(history, "back");
    const before = history.getSnapshot();
    const intents: SpreadIntent[] = [
      { kind: "replace" },
      { kind: "restore" },
      { kind: "preview", source: "scrubber" },
    ];
    intents.forEach((intent) =>
      history.record(anchor("different-layout"), intent),
    );
    visit(history, "A", "highlight");
    expect(history.getSnapshot()).toBe(before);
  });

  it("starts a new group after closing a picker", () => {
    const history = initial();
    visit(history, "H1", "highlight");
    history.endGroup();
    visit(history, "H2", "highlight");
    expect(names(history)).toEqual(["A", "H1", "H2"]);
  });

  it("preserves the cursor on reopen and starts a new jump group", () => {
    const history = initial();
    visit(history, "H1", "highlight");
    visit(history, "C", "internal-link");
    travel(history, "back");
    const reopened = new ReaderJumpHistoryController(
      JSON.parse(JSON.stringify(history.getSnapshot())),
    );
    expect(reopened.getSnapshot().cursor).toBe(1);
    travel(reopened, "forward");
    expect(reopened.getSnapshot().cursor).toBe(2);
    travel(reopened, "back");
    visit(reopened, "H2", "highlight");
    expect(names(reopened)).toEqual(["A", "H1", "H2"]);
  });

  it("bounds the trail and clamps Back and Forward at its ends", () => {
    const history = initial();
    for (let i = 0; i < READER_HISTORY_LIMIT + 5; i++)
      visit(history, String(i), "internal-link");
    expect(names(history)).toHaveLength(READER_HISTORY_LIMIT);
    expect(names(history)[0]).toBe("5");
    for (let i = 0; i < 100; i++) travel(history, "back");
    expect(history.getSnapshot().cursor).toBe(0);
    for (let i = 0; i < 100; i++) travel(history, "forward");
    expect(history.getSnapshot().cursor).toBe(READER_HISTORY_LIMIT - 1);
  });

  it("distinguishes text offsets within one block", () => {
    const history = initial();
    const location: ContentAnchor = {
      type: "text",
      chapterIndex: 1,
      blockId: "paragraph",
      offset: { itemIndex: 0, segmentIndex: 0, graphemeIndex: 3 },
    };
    history.record(location, { kind: "jump", source: "internal-link" });
    history.record(
      { ...location, offset: { ...location.offset, graphemeIndex: 12 } },
      { kind: "jump", source: "internal-link" },
    );
    expect(history.getSnapshot().entries).toHaveLength(3);
  });

  it("returns to a line from scroll mode as that line, and to a page as a page", () => {
    const history = initial();
    visit(history, "S", "search");
    history.record(
      anchor("Line"),
      { kind: "linear", direction: "forward" },
      true,
    );
    visit(history, "T", "search");
    expect(history.getReturnTarget("back")?.intent).toEqual({
      kind: "history",
      targetIndex: 2,
      exact: true,
    });
    travel(history, "back");
    expect(history.getReturnTarget("back")?.intent).toEqual({
      kind: "history",
      targetIndex: 1,
    });
  });
});
