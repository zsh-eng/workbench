import { describe, expect, test } from "vitest";
import {
  createInitialReviewState,
  parseReviewPatch,
  projectAuthoritativeNotes,
  projectResponse,
} from "../../src/shared/review";
import type { ReviewResponse } from "../../src/shared/protocol";
import {
  reviewSourceLineCount,
  validateReviewNoteInput,
  removeReviewNote,
  validateReviewNoteRemoval,
} from "../../src/shared/hunk/noteValidation";

const patch =
  "diff --git a/a.ts b/a.ts\nindex 1111111..2222222 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
const response: ReviewResponse = {
  id: "review1",
  repo: "/repo",
  comparison: { kind: "working" },
  base: "a",
  head: "b",
  label: "Working changes",
  patch,
  files: [
    { path: "image.png", status: "M", binary: true, additions: 0, deletions: 0 },
    { path: "a.ts", status: "M", binary: false, additions: 1, deletions: 1 },
  ],
  warnings: [],
  metrics: { gitMs: 0, totalMs: 0, patchBytes: patch.length, cacheHit: false },
};

describe("Pierre to retained Hunk model", () => {
  test("does not claim full-source authority for a standalone patch", () => {
    const { document } = projectResponse(
      { ...response, comparison: { kind: "patch", path: "/review.patch" } },
      parseReviewPatch(patch),
    );
    expect(document.files.every((file) => file.sourceIdentity === undefined)).toBe(true);
    expect(document.files.every((file) => file.sourceAttested === undefined)).toBe(true);
  });
  test("preserves manifest order and stable file keys across content changes", () => {
    const first = projectResponse(response, parseReviewPatch(patch));
    expect(first.files.map((file) => file.path)).toEqual(["image.png", "a.ts"]);
    expect(first.files[0]?.metadata).toBeNull();
    expect(first.document.files[0]?.flags.binary).toBe(true);
    expect(first.files.map((file) => file.id)).toEqual(
      first.document.files.map((file) => file.key),
    );
    const second = projectResponse(
      { ...response, id: "review2", patch: patch.replace("+new", "+next") },
      parseReviewPatch(patch.replace("+new", "+next")),
    );
    expect(second.files[1]?.id).toBe(first.files[1]?.id);
    expect(second.document.files[1]?.contentIdentity).not.toBe(
      first.document.files[1]?.contentIdentity,
    );
    expect(second.files[1]?.metadata?.cacheKey).not.toBe(first.files[1]?.metadata?.cacheKey);
  });

  test("projects authoritative note ranges and parent identities without changing selection", () => {
    const { document } = projectResponse(response, parseReviewPatch(patch));
    const state = createInitialReviewState(document);
    const result = projectAuthoritativeNotes(state, {
      reviewId: response.id,
      revision: 1,
      notes: [
        {
          id: "reply",
          parentId: "root",
          path: "a.ts",
          side: "new",
          line: 1,
          text: "Check this.",
          createdAt: "now",
          updatedAt: "now",
        },
      ],
    });
    expect(result.selection).toEqual(state.selection);
    expect(result.userNotes[0]?.note.anchor.newRange).toEqual([1, 1]);
    expect(result.userNotes[0]?.note.parentId).toBe("root");
  });
});

describe("authoritative note validation", () => {
  test("accepts a real blank source line and rejects empty-file or reversed ranges", () => {
    expect(reviewSourceLineCount("")).toBe(0);
    expect(reviewSourceLineCount("\n")).toBe(1);
    const note = { path: "a", side: "new" as const, line: 1, text: "Review" };
    expect(() => validateReviewNoteInput(note, { old: "", new: "\n" })).not.toThrow();
    expect(() => validateReviewNoteInput(note, { old: "", new: "" })).toThrow("outside");
    expect(() =>
      validateReviewNoteInput({ ...note, line: 2, endLine: 1 }, { old: "", new: "a\nb" }),
    ).toThrow("outside");
  });

  test("rejects cross-file replies and whitespace-only text; a removal takes the replies", () => {
    const parent = {
      id: "parent",
      path: "other",
      side: "new" as const,
      line: 1,
      text: "Parent",
      createdAt: "now",
      updatedAt: "now",
    };
    expect(() =>
      validateReviewNoteInput(
        { path: "a", side: "new", line: 1, text: "Reply", parentId: "parent" },
        { old: "", new: "a" },
        [parent],
      ),
    ).toThrow("same file");
    expect(() =>
      validateReviewNoteInput(
        { path: "a", side: "new", line: 1, text: "  " },
        { old: "", new: "a" },
      ),
    ).toThrow("contain text");
    expect(() => validateReviewNoteRemoval("gone", [parent])).toThrow("no longer exists");
    const notes = [
      parent,
      { ...parent, id: "reply", parentId: "parent" },
      { ...parent, id: "nested", parentId: "reply" },
      { ...parent, id: "other" },
    ];
    removeReviewNote("parent", notes);
    expect(notes.map((note) => note.id)).toEqual(["other"]);
  });
});

test("retains stale and orphaned notes without claiming current line placement", () => {
  const { document } = projectResponse(response, parseReviewPatch(patch));
  const original = {
    id: "stale",
    path: "a.ts",
    side: "new" as const,
    line: 1,
    text: "Prior review",
    createdAt: "now",
    updatedAt: "now",
    resolution: "stale" as const,
  };
  const state = projectAuthoritativeNotes(createInitialReviewState(document), {
    reviewId: response.id,
    revision: 2,
    notes: [original, { ...original, id: "orphan", path: "gone.ts", resolution: "orphaned" }],
  });
  expect(state.userNotes.map((entry) => entry.resolution)).toEqual(["stale", "orphaned"]);
  expect(state.userNotes[1]?.note.anchor.intersectingHunkIndices).toEqual([]);
  expect(state.userNotes[1]?.note.summary).toBe("Prior review");
});
