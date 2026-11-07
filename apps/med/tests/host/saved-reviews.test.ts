import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SavedReviewStore } from "../../src/host/saved-reviews";
import type { CapturedReviewTarget, SavedReviewCreate } from "../../src/shared/saved-review";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "med-saved-review-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
const input: SavedReviewCreate = {
  title: "Agent changes",
  targets: [{ repo: "/repo/a", comparison: { kind: "working" } }],
};
function capture(
  repo = "/repo/a",
  contents = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n",
): CapturedReviewTarget {
  return {
    repo,
    repositoryId: `family-${repo}`,
    branch: "main",
    review: {
      id: "live-review",
      repo,
      comparison: { kind: "working" },
      base: "base-oid",
      head: "working",
      label: "Working changes",
      files: [
        {
          path: "new.ts",
          previousPath: "old.ts",
          status: "R",
          additions: 1,
          deletions: 1,
          binary: false,
        },
      ],
      patch: "a frozen patch",
      metrics: { gitMs: 0, totalMs: 0, patchBytes: 14, cacheHit: false },
      warnings: [],
    },
    sources: [{ reviewId: "live-review", path: "new.ts", old: contents, new: contents }],
  };
}
const note = (text = "Please simplify this.") => ({
  type: "add" as const,
  note: { path: "new.ts", side: "new" as const, line: 5, endLine: 6, text },
});

// Filesystem-boundary cases that require corrupt records, competing writers, or
// exact capture/export limits. User workflows run through the built app; these
// tests do not repeat navigation, normal persistence, copy, or clear behavior.
describe("saved review storage boundaries", () => {
  it("isolates identical paths and live review IDs between targets and bundles", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(
      {
        ...input,
        targets: [...input.targets, { repo: "/repo/b", comparison: { kind: "working" } }],
      },
      async (target) => capture(target.repo, `${target.repo}\n2\n3\n4\n5\n6\n`),
    );
    const [a, b] = saved.targets;
    await store.mutate(saved.id, a.id, 0, note("A only"));
    expect((await store.notes(saved.id, b.id)).notes).toEqual([]);
    expect((await store.source(saved.id, b.id, "new.ts")).new).toContain("/repo/b");
    expect((await store.review(saved.id, a.id)).id).not.toBe(
      (await store.review(saved.id, b.id)).id,
    );
    const other = await store.create(input, async () => capture());
    await expect(store.source(other.id, a.id, "new.ts")).rejects.toMatchObject({ status: 404 });
    await expect(store.source(saved.id, a.id, "../../secret")).rejects.toMatchObject({
      status: 422,
    });
  });

  it("exports all targets, old-side rename paths, three context lines, and reply hierarchy", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(
      {
        ...input,
        targets: [...input.targets, { repo: "/repo/b", comparison: { kind: "working" } }],
      },
      async (target) => capture(target.repo),
    );
    const [a, b] = saved.targets;
    const state = await store.mutate(saved.id, a.id, 0, {
      ...note(),
      note: { ...note().note, side: "old" },
    });
    await store.mutate(saved.id, a.id, 1, {
      ...note(),
      note: { ...note("Reply text").note, parentId: state.notes[0].id },
    });
    await store.mutate(saved.id, b.id, 0, note("B feedback"));
    const feedback = await store.feedback(saved.id);
    expect(feedback).toMatchObject({ count: 3, repositoryCount: 2, revision: 3 });
    expect(feedback.text).toMatch(/^# Comments on the review "/);
    // A comment's short ID, then where it is: the side, the rename, and the
    // repository when the review has more than one.
    expect(feedback.text).toMatch(
      /\n## [0-9a-f]{6} · old\.ts:5-6 \(before the change, renamed to new\.ts, in \/repo\/a\)\n/,
    );
    expect(feedback.text).toContain(
      "  2 | two\n  3 | three\n  4 | four\n> 5 | five\n> 6 | six\n  7 | seven\n  8 | eight\n  9 | nine",
    );
    expect(feedback.text).not.toContain("  1 | one");
    expect(feedback.text).toContain("The user replied:\nReply text");
    expect(feedback.text).toMatch(
      /\n## [0-9a-f]{6} · new\.ts:5-6 \(renamed from old\.ts, in \/repo\/b\)\n/,
    );
    expect(feedback.text).not.toContain("Repository ID");
    // It ends with how to answer in a thread, with the first comment's ID.
    const first = /\n## ([0-9a-f]{6}) /.exec(feedback.text)![1];
    expect(feedback.text).toContain(`med reply ${first} <<'END'`);
    expect((await store.get(saved.id)).commentCount).toBe(3);
  });

  it("a reply to the agent's comment keeps its words, on disk and for the agent", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async (target) => capture(target.repo));
    await store.mutate(saved.id, saved.targets[0].id, 0, {
      ...note(),
      note: {
        ...note("The callers moved.").note,
        guideComment: { id: "s1-1", author: "Claude", text: "Check the callers.\nAll of them." },
      },
    });
    const feedback = await new SavedReviewStore(directory).feedback(saved.id);
    expect(feedback.count).toBe(1);
    expect(feedback.text).toContain(
      "In reply to Claude's comment in the guide:\n> Check the callers.\n> All of them.",
    );
  });

  it("exports captured renamed diff hunks with both sides and exact selected ranges", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () => {
      const value = capture();
      value.review.patch =
        "diff --git a/old.ts b/new.ts\nsimilarity index 70%\nrename from old.ts\nrename to new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -2,8 +2,8 @@\n two\n three\n four\n-five\n-six\n+FIVE\n+SIX\n seven\n eight\n nine\n";
      value.sources[0].new = value.sources[0].new.replace("five\nsix", "FIVE\nSIX");
      return value;
    });
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, note());
    await store.mutate(saved.id, target.id, 1, {
      ...note(),
      note: { ...note().note, side: "old" },
    });
    const exported = await store.feedback(saved.id);
    const [newComment, oldComment] = exported.text.split("\n## ").slice(1);
    expect(newComment).toMatch(/^[0-9a-f]{6} · new\.ts:5-6 \(renamed from old\.ts\)\n/);
    expect(oldComment).toMatch(
      /^[0-9a-f]{6} · old\.ts:5-6 \(before the change, renamed to new\.ts\)\n/,
    );
    for (const comment of [newComment, oldComment]) {
      expect(comment).toContain(")\n```diff\n@@");
      expect(comment).toContain("-five\n-six\n+FIVE\n+SIX");
      expect(comment).not.toContain("The source");
    }
  });

  it("clips added hunks to selected context and keeps safe diff fences and newline markers", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () => {
      const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
      lines[4] = "````";
      const value = capture("/repo/a", lines.join("\n"));
      value.review.files[0] = {
        path: "new.ts",
        status: "A",
        additions: 12,
        deletions: 0,
        binary: false,
      };
      value.sources[0].old = "";
      value.review.patch = `diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,12 @@\n${lines.map((line) => `+${line}`).join("\n")}\n\\ No newline at end of file\n`;
      return value;
    });
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, {
      type: "add",
      note: { path: "new.ts", side: "new", line: 5, endLine: 6, text: "Middle range" },
    });
    await store.mutate(saved.id, target.id, 1, {
      type: "add",
      note: { path: "new.ts", side: "new", line: 12, text: "Last line" },
    });
    const exported = await store.feedback(saved.id);
    expect(exported.text).toContain("new.ts:5-6\n`````diff\n@@ -0,0 +2,8 @@\n+line 2");
    expect(exported.text).toContain("+````\n+line 6");
    expect(exported.text).not.toContain("+line 1\n");
    expect(exported.text.split("\n## ")[1]).not.toContain("+line 10\n");
    expect(exported.text).toContain("@@ -0,0 +9,4 @@");
    expect(exported.text).toContain("+line 12\n\\ No newline at end of file");
    expect(exported.text.length).toBeLessThan(2000);
  });

  it("uses captured source for a selection that crosses a gap between patch hunks", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () => {
      const value = capture("/repo/a", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n");
      value.review.patch =
        "diff --git a/new.ts b/new.ts\n--- a/new.ts\n+++ b/new.ts\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n@@ -8,2 +8,2 @@\n-eight\n+EIGHT\n nine\n";
      value.sources[0].new = value.sources[0].new.replace("two", "TWO").replace("eight", "EIGHT");
      return value;
    });
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, {
      type: "add",
      note: {
        path: "new.ts",
        side: "new",
        line: 2,
        endLine: 8,
        text: "Range including expanded unchanged lines",
      },
    });
    const exported = await store.feedback(saved.id);
    expect(exported.text).toContain("The source (the saved diff does not cover these lines):");
    expect(exported.text).toContain("> 2 | TWO\n> 3 | three");
    expect(exported.text).toContain("> 8 | EIGHT\n  9 | nine");
    expect(exported.text).not.toContain("```diff");
  });

  it("serializes separate stores sharing the same directory without losing accepted notes", async () => {
    const first = new SavedReviewStore(directory);
    const second = new SavedReviewStore(directory);
    const saved = await first.create(input, async () => capture());
    const target = saved.targets[0];
    const outcomes = await Promise.allSettled([
      first.mutate(saved.id, target.id, 0, note("First host")),
      second.mutate(saved.id, target.id, 0, note("Second host")),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "stale-notes", status: 409 },
    });
    const accepted = outcomes.find((result) => result.status === "fulfilled");
    expect((await first.notes(saved.id, target.id)).notes).toEqual(
      accepted?.status === "fulfilled" ? accepted.value.notes : [],
    );
    const clearRace = await Promise.allSettled([
      first.mutate(saved.id, target.id, 1, note("Concurrent new feedback")),
      second.clear(saved.id, 1),
    ]);
    expect(clearRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(clearRace.find((result) => result.status === "rejected")).toMatchObject({
      reason: { code: "stale-notes" },
    });
    expect((await readdir(directory)).filter((name) => name.startsWith(".writer"))).toEqual([]);
  });

  it("recovers a dead process lock without treating a living owner as stale", async () => {
    const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
    expect(child.status).toBe(0);
    const lock = join(directory, ".writer-lock");
    await mkdir(lock);
    await writeFile(join(lock, `owner-${child.pid}-00000000-0000-4000-8000-000000000000`), "");
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () => capture());
    expect(saved.targets).toHaveLength(1);
    await mkdir(lock);
    const activeOwner = `owner-${process.pid}-00000000-0000-4000-8000-000000000000`;
    await writeFile(join(lock, activeOwner), "");
    const cancellation = new AbortController();
    const timer = setTimeout(
      () => cancellation.abort(new Error("Request cancelled while waiting")),
      10,
    );
    try {
      await expect(
        store.clear(saved.id, 0, () => cancellation.signal.throwIfAborted()),
      ).rejects.toThrow("Request cancelled while waiting");
    } finally {
      clearTimeout(timer);
    }
    expect(await readdir(lock)).toEqual([activeOwner]);
    expect((await store.get(saved.id)).revision).toBe(0);
  });

  it("does not publish a capture revoked in flight or change comments after revocation", async () => {
    const store = new SavedReviewStore(directory);
    let authorized = true;
    const requireAccess = () => {
      if (!authorized) throw new Error("Repository removed");
    };
    await expect(
      store.create(
        input,
        async () => {
          authorized = false;
          return capture();
        },
        requireAccess,
      ),
    ).rejects.toThrow("Repository removed");
    expect(await readdir(directory)).toEqual([]);
    authorized = true;
    const saved = await store.create(input, async () => capture(), requireAccess);
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, note("Keep this comment"), requireAccess);
    authorized = false;
    await expect(store.mutate(saved.id, target.id, 1, note(), requireAccess)).rejects.toThrow(
      "Repository removed",
    );
    await expect(store.clear(saved.id, 1, requireAccess)).rejects.toThrow("Repository removed");
    expect((await store.notes(saved.id, target.id)).notes.map((entry) => entry.text)).toEqual([
      "Keep this comment",
    ]);
  });

  it("does not invent context when full text is unavailable", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () => ({ ...capture(), sources: [] }));
    const target = saved.targets[0];
    await expect(store.source(saved.id, target.id, "new.ts")).rejects.toMatchObject({
      code: "saved-source-unavailable",
    });
    await expect(store.mutate(saved.id, target.id, 0, note())).rejects.toMatchObject({
      code: "saved-source-unavailable",
    });
    expect((await store.review(saved.id, target.id)).patch).toBe("a frozen patch");
    expect((await store.get(saved.id)).commentCount).toBe(0);
  });

  it("uses safe code fences and does not truncate selected lines or feedback", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(input, async () =>
      capture("/repo/a", "a\n````\nc\nd\ne\nf\n"),
    );
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, {
      type: "add",
      note: { path: "new.ts", side: "new", line: 1, endLine: 6, text: "x".repeat(16000) },
    });
    const exported = await store.feedback(saved.id);
    expect(exported.text).toContain("\n`````\n> 1 | a");
    expect(exported.text).toContain("x".repeat(16000));
    expect(exported.text).toContain("> 6 | f");
  });

  it.each(["source", "diff"])(
    "bounds repeated %s context by UTF-8 bytes without truncating or changing comments",
    async (kind) => {
      const store = new SavedReviewStore(directory);
      const content = "é".repeat(768 * 1024);
      const saved = await store.create(input, async () => {
        const value = capture("/repo/a", `${content}\n`);
        if (kind === "diff") {
          value.sources[0].old = "";
          value.review.patch = `diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+${content}\n`;
        }
        return value;
      });
      const target = saved.targets[0];
      for (let revision = 0; revision < 6; revision++) {
        await store.mutate(saved.id, target.id, revision, {
          type: "add",
          note: { path: "new.ts", side: "new", line: 1, text: `Feedback ${revision}` },
        });
      }
      await expect(store.feedback(saved.id)).rejects.toMatchObject({
        code: "saved-feedback-too-large",
        status: 413,
      });
      const notes = await store.notes(saved.id, target.id);
      expect(notes.notes).toHaveLength(6);
      await store.mutate(saved.id, target.id, 6, { type: "remove", id: notes.notes[5].id });
      await store.mutate(saved.id, target.id, 7, { type: "remove", id: notes.notes[4].id });
      const feedback = await store.feedback(saved.id);
      expect(feedback.count).toBe(4);
      expect(Buffer.byteLength(feedback.text)).toBeLessThan(8 * 1024 * 1024);
      expect(feedback.text.split(content)).toHaveLength(5);
    },
  );

  it("exports source with many backtick runs without exceeding the function argument limit", async () => {
    const store = new SavedReviewStore(directory);
    const content = `${"`x".repeat(150_000)}\n\`\`\`\n`;
    const saved = await store.create(input, async () => capture("/repo/a", content));
    const target = saved.targets[0];
    await store.mutate(saved.id, target.id, 0, {
      type: "add",
      note: { path: "new.ts", side: "new", line: 1, endLine: 2, text: "Check generated content" },
    });
    const feedback = await store.feedback(saved.id);
    expect(feedback.count).toBe(1);
    expect(feedback.text).toContain("\n````\n> 1 | `x");
    expect(feedback.text).toContain("\n> 2 | ```\n````\n");
    expect(feedback.text.match(/`x/g)).toHaveLength(150_000);
  });

  it("rejects path traversal, corrupt records, and invalid note ranges without changing data", async () => {
    const store = new SavedReviewStore(directory);
    await expect(store.get("../../secret")).rejects.toMatchObject({ code: "invalid-saved-review" });
    const saved = await store.create(input, async () => capture());
    await expect(
      store.mutate(saved.id, saved.targets[0].id, 0, {
        type: "add",
        note: { ...note().note, endLine: 50 },
      }),
    ).rejects.toMatchObject({ code: "invalid-note" });
    expect((await store.get(saved.id)).revision).toBe(0);
    const path = join(directory, `${saved.id}.json`);
    await writeFile(path, "broken bytes");
    await expect(store.get(saved.id)).rejects.toMatchObject({
      code: "saved-review-corrupt",
      status: 422,
    });
    expect(await readFile(path, "utf8")).toBe("broken bytes");
  });

  it("keeps reply parents intact and rejects cross-target replies", async () => {
    const store = new SavedReviewStore(directory);
    const saved = await store.create(
      {
        ...input,
        targets: [...input.targets, { repo: "/repo/b", comparison: { kind: "working" } }],
      },
      async (target) => capture(target.repo),
    );
    const [a, b] = saved.targets;
    const parent = (await store.mutate(saved.id, a.id, 0, note())).notes[0];
    await expect(
      store.mutate(saved.id, b.id, 0, {
        type: "add",
        note: { ...note().note, parentId: parent.id },
      }),
    ).rejects.toMatchObject({ code: "invalid-note" });
    await store.mutate(saved.id, a.id, 1, {
      type: "add",
      note: { ...note().note, parentId: parent.id },
    });
    await expect(
      store.mutate(saved.id, a.id, 2, { type: "remove", id: parent.id }),
    ).rejects.toMatchObject({ code: "invalid-note" });
  });
});

it("stops capture when the aggregate record bound is reached", async () => {
  const store = new SavedReviewStore(directory);
  await expect(
    store.create(
      {
        title: "Large multi-target review",
        targets: Array.from({ length: 16 }, () => input.targets[0]!),
      },
      async () => {
        return capture("/repo/a", "a".repeat(5 * 1024 * 1024));
      },
    ),
  ).rejects.toThrow("64 MiB");
  expect((await readdir(directory)).filter((name) => name.endsWith(".json"))).toEqual([]);
});
