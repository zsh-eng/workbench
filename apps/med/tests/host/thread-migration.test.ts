import { afterEach, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SavedReview } from "../../src/shared/saved-review";
import type { SavedReviewStore } from "../../src/host/saved-reviews";
import { createThreadStore } from "../../src/host/thread-store";
import { migrateTabs } from "../../src/host/thread-migration";

// The move from an older Med's tabs, on the parts that the host test does not
// reach: the Superagent's review, and reviews that were only a session's place.

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const review = (
  id: string,
  fields: Partial<SavedReview>,
): SavedReview & { modifiedAt: number } => ({
  id,
  title: id,
  createdAt: "2026-11-01T00:00:00.000Z",
  revision: 0,
  commentCount: 0,
  targets: [],
  modifiedAt: 0,
  ...fields,
});

test("the Superagent's review becomes its session, named and pinned on top, and a review without a comparison goes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "med-migration-"));
  directories.push(directory);
  const superagent = { agent: "claude" as const, id: "02aae007", cwd: "/state/superagent" };
  const worker = { agent: "claude" as const, id: "2efb72f1", cwd: "/work" };
  const target = {
    id: "t1",
    repositoryId: "repo-0",
    repo: "/work",
    branch: "main",
    label: "Working",
    comparison: { kind: "working" as const },
    base: "a".repeat(40),
    head: "working",
    captured: true,
  };
  const reviews = [
    review("r_000000000000000000000001", { key: "superagent", session: superagent }),
    review("r_000000000000000000000002", {
      title: "State machine",
      session: worker,
      targets: [target],
    }),
    review("r_000000000000000000000003", { title: "Activity", session: worker, targets: [target] }),
  ];
  const deleted: string[] = [];
  const savedReviews = {
    list: async () => reviews,
    delete: async (id: string) => void deleted.push(id),
  } as unknown as SavedReviewStore;
  const tabsFile = join(directory, "tabs.json");
  await writeFile(
    tabsFile,
    JSON.stringify({
      version: 1,
      order: reviews.map((entry) => entry.id),
      entries: {
        [reviews[1]!.id]: { name: "Reader" },
        [reviews[2]!.id]: { name: "Reader" },
      },
      // Two pins on one session's reviews: one pin.
      pins: [reviews[1]!.id, reviews[2]!.id],
    }),
  );
  const file = join(directory, "threads.json");
  const store = createThreadStore({ file });
  expect(await migrateTabs({ tabsFile, store, savedReviews })).toBe(true);

  const saved = JSON.parse(await readFile(file, "utf8")) as {
    entries: Record<string, { name?: string; superagent?: boolean; closedAt?: number }>;
    pins: string[];
  };
  expect(saved.pins).toEqual(["claude-02aae007", "claude-2efb72f1"]);
  expect(saved.entries["claude-02aae007"]).toMatchObject({ name: "Superagent", superagent: true });
  expect(saved.entries["claude-02aae007"]?.closedAt).toBeUndefined();
  expect(saved.entries["claude-2efb72f1"]).toMatchObject({ name: "Reader" });
  // The Superagent's review had no comparison: it was only its session's place.
  expect(deleted).toEqual([reviews[0]!.id]);
  expect(existsSync(`${tabsFile}.before-sessions`)).toBe(true);
  // Without tabs, nothing moves again.
  expect(await migrateTabs({ tabsFile, store, savedReviews })).toBe(false);
});
