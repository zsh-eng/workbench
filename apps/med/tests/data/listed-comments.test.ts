import { expect, test } from "vitest";
import type { Note } from "../../src/shared/protocol";
import type { FileComment } from "../../src/shared/saved-review";
import { listComments } from "../../src/web/data/listed-comments";

const note = (id: string, at: string, extra: Partial<Note> = {}): Note => ({
  id,
  path: "src/trails.ts",
  side: "new",
  line: 4,
  text: `Note ${id}`,
  createdAt: at,
  updatedAt: at,
  ...extra,
});
const file = (id: string, at: string, extra: Partial<FileComment> = {}): FileComment => ({
  id,
  source: { kind: "worktree", repo: "/work/trailhead" },
  path: "docs/guide.md",
  line: 2,
  endLine: 5,
  quote: "Pack water.\n",
  text: `File ${id}`,
  createdAt: at,
  updatedAt: at,
  replies: [],
  ...extra,
});

test("All comments lists the diff's top-level comments and the files', newest first", () => {
  const listed = listComments(
    [
      note("a", "2026-11-08T10:00:00Z"),
      note("a1", "2026-11-08T10:05:00Z", { parentId: "a", author: { agent: "claude" } }),
      note("b", "2026-11-08T12:00:00Z", { endLine: 6 }),
    ],
    [
      file("f", "2026-11-08T11:00:00Z", {
        replies: [
          {
            id: "r",
            text: "Done.",
            author: { agent: "codex" },
            createdAt: "2026-11-08T11:10:00Z",
          },
        ],
        resolved: { at: "2026-11-08T11:10:00Z", by: { agent: "codex" } },
      }),
    ],
    new Set(["b"]),
  );
  // A reply is not an item of its own; it counts under its comment.
  expect(listed.map((comment) => comment.id)).toEqual(["b", "f", "a"]);
  expect(listed[0]).toMatchObject({ kind: "diff", endLine: 6, unsent: true, replies: 0 });
  expect(listed[1]).toMatchObject({
    kind: "file",
    path: "docs/guide.md",
    line: 2,
    endLine: 5,
    resolved: true,
    replies: 1,
    answeredBy: "Codex",
    unsent: false,
  });
  expect(listed[2]).toMatchObject({ replies: 1, answeredBy: "Claude", resolved: false });
});
