import { describe, expect, it } from "vitest";
import {
  ReaderJumpHistoryController,
  READER_HISTORY_LIMIT,
} from "@/features/reader/jump-history";
import {
  QUIET_HISTORY,
  updateHistoryPresentation,
} from "@/features/reader/history-presentation";
import type { SpreadIntent } from "@/lib/pagination-v2";

function setup() {
  const controller = new ReaderJumpHistoryController();
  let presentation = QUIET_HISTORY;
  const visit = (id: string, intent: SpreadIntent) => {
    const before = controller.getSnapshot();
    const after = controller.record(
      { type: "block", chapterIndex: 0, blockId: id },
      intent,
    );
    presentation = updateHistoryPresentation(
      presentation,
      before,
      after,
      intent,
    );
    return presentation;
  };
  visit("A", { kind: "restore" });
  return { controller, visit };
}
describe("history footer presentation", () => {
  it("reveals confirmed jumps, preserves the trail during preview, and hides on reading", () => {
    const { controller, visit } = setup();
    expect(visit("B", { kind: "jump", source: "highlight" })).toMatchObject({
      expanded: true,
      preview: false,
    });
    const committed = controller.getSnapshot();
    expect(visit("C", { kind: "preview", source: "scrubber" })).toMatchObject({
      expanded: true,
      preview: true,
    });
    expect(controller.getSnapshot()).toBe(committed);
    expect(visit("C", { kind: "jump", source: "scrubber" })).toMatchObject({
      expanded: true,
      preview: false,
    });
    expect(visit("D", { kind: "linear", direction: "forward" })).toMatchObject({
      expanded: false,
    });
    expect(visit("B", { kind: "history", targetIndex: 1 })).toMatchObject({
      expanded: true,
    });
  });
  it("keeps the trail showing while it is scrubbed, and records nothing until a visit is taken", () => {
    const { controller, visit } = setup();
    visit("B", { kind: "jump", source: "highlight" });
    const trail = controller.getSnapshot();
    expect(visit("A", { kind: "preview", source: "history" })).toMatchObject({
      expanded: true,
      preview: false,
    });
    expect(visit("B", { kind: "restore" })).toMatchObject({ expanded: true });
    expect(controller.getSnapshot()).toBe(trail);
    expect(visit("A", { kind: "history", targetIndex: 0 })).toMatchObject({
      expanded: true,
    });
    expect(controller.getSnapshot().entries).toBe(trail.entries);
    expect(controller.getSnapshot().cursor).toBe(0);
  });
  it("keeps restored trails quiet and retains the chosen mode across reflow", () => {
    const { controller, visit } = setup();
    visit("B", { kind: "jump", source: "highlight" });
    const trail = controller.getSnapshot();
    expect(
      updateHistoryPresentation(QUIET_HISTORY, trail, trail, {
        kind: "restore",
      }),
    ).toBe(QUIET_HISTORY);
    const shown = { ...QUIET_HISTORY, expanded: true };
    expect(
      updateHistoryPresentation(shown, trail, trail, { kind: "replace" }),
    ).toBe(shown);
  });
  it("advances slots on eviction but keeps grouped replacements still", () => {
    const { visit } = setup();
    for (let i = 1; i < READER_HISTORY_LIMIT; i++)
      visit(String(i), { kind: "jump", source: "internal-link" });
    expect(visit("H1", { kind: "jump", source: "highlight" }).firstSlot).toBe(
      1,
    );
    expect(visit("H2", { kind: "jump", source: "highlight" }).firstSlot).toBe(
      1,
    );
    expect(visit("C", { kind: "jump", source: "toc" }).firstSlot).toBe(2);
  });
});
