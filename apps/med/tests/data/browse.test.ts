import { expect, test } from "vitest";
import type { BrowseSource } from "../../src/shared/browse";
import { createBrowseApi } from "../../src/web/data/browse";

const worktree: BrowseSource = { kind: "worktree", repo: "/fixture" };
const commit: BrowseSource = { kind: "commit", repo: "/fixture", oid: "a".repeat(40) };

test.each([
  { kind: "commit", repo: "/other", oid: "a".repeat(40) },
  { kind: "worktree", repo: "/other" },
])("rejects search result sources outside the requested repository: %j", async (resultSource) => {
  const api = createBrowseApi(
    async () =>
      Response.json({
        source: worktree,
        query: "needle",
        resultSource,
        matches: [],
        truncated: false,
      }),
    "",
  );
  await expect(api.search(worktree, "needle")).rejects.toThrow("another repository or commit");
});

test("a checkout's search takes its working files; a commit's search does not", async () => {
  const answer = (source: BrowseSource) =>
    createBrowseApi(
      async () =>
        Response.json({
          source,
          query: "needle",
          resultSource: worktree,
          matches: [],
          truncated: false,
        }),
      "",
    );
  expect((await answer(worktree).search(worktree, "needle")).resultSource).toEqual(worktree);
  await expect(answer(commit).search(commit, "needle")).rejects.toThrow(
    "another repository or commit",
  );
});

test("rejects a different commit for a historical search", async () => {
  const api = createBrowseApi(
    async () =>
      Response.json({
        source: commit,
        query: "needle",
        resultSource: { ...commit, oid: "b".repeat(40) },
        matches: [],
        truncated: false,
      }),
    "",
  );
  await expect(api.search(commit, "needle")).rejects.toThrow("another repository or commit");
});

test("accepts the resolved commit for a worktree search and preserves index status", async () => {
  const result = {
    source: worktree,
    query: "needle",
    resultSource: commit,
    engine: "git",
    index: { state: "indexing", message: "Index updating; using Git search." },
    matches: [{ path: "src/main.ts", line: 2, text: "needle" }],
    truncated: false,
  };
  const api = createBrowseApi(async () => Response.json(result), "");
  expect(await api.search(worktree, "needle")).toEqual(result);
});
