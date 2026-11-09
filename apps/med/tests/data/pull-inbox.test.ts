import { expect, test } from "vitest";
import { inboxRows, searchQueries, type SearchNode } from "../../src/host/pull-inbox";

const pull = (number: number, change: Partial<SearchNode> = {}): SearchNode => ({
  url: `https://github.com/acme/trailhead/pull/${number}`,
  number,
  title: `Change ${number}`,
  isDraft: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: `2026-11-0${(number % 8) + 1}T00:00:00Z`,
  additions: 10,
  deletions: 2,
  headRefName: `topic-${number}`,
  baseRefName: "main",
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  author: { login: "you" },
  repository: { nameWithOwner: "acme/trailhead" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  reviewRequests: { nodes: [] },
  ...change,
});

test("review requests wait on you, then your own pull requests that need you", () => {
  const { waiting, yours } = inboxRows(
    "you",
    [
      pull(418, {
        author: { login: "maya" },
        reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "you" } }] },
      }),
      pull(419, {
        author: { login: "ines" },
        reviewRequests: {
          nodes: [
            {
              requestedReviewer: {
                __typename: "Team",
                slug: "maps",
                organization: { login: "acme" },
              },
            },
          ],
        },
      }),
    ],
    [
      pull(412, {
        reviewDecision: "CHANGES_REQUESTED",
        commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
      }),
      pull(413, { commits: { nodes: [{ commit: { statusCheckRollup: { state: "ERROR" } } }] } }),
      pull(77, {
        reviewDecision: "APPROVED",
        repository: { nameWithOwner: "acme/elevation" },
        url: "https://github.com/acme/elevation/pull/77",
      }),
      pull(80, { isDraft: true, reviewDecision: null, commits: { nodes: [] } }),
    ],
  );
  expect(waiting.map((row) => [row.number, row.why])).toEqual([
    [419, "review requested of acme/maps"],
    [418, "review requested"],
    [413, "checks failing"],
    [412, "changes requested"],
  ]);
  expect(waiting[0]).toMatchObject({ author: "ines", checks: "pass", review: "required" });
  // Newest first.
  expect(yours.map((row) => [row.number, row.review, row.checks, row.draft])).toEqual([
    [77, "approved", "pass", false],
    [80, "none", "none", true],
  ]);
});

test("a stack of yours is one row from its base, and waits on you when a layer does", () => {
  const { waiting, yours } = inboxRows(
    "you",
    [],
    [
      pull(421, { headRefName: "chips-2", baseRefName: "chips-1", title: "Chips: clear all" }),
      pull(420, { headRefName: "chips-1", baseRefName: "main", title: "Chips in the search bar" }),
      pull(422, { headRefName: "chips-3", baseRefName: "chips-2" }),
      // The same branch name in another repository is not part of it.
      pull(9, {
        headRefName: "other",
        baseRefName: "chips-1",
        repository: { nameWithOwner: "acme/elevation" },
        url: "https://github.com/acme/elevation/pull/9",
      }),
    ],
  );
  expect(waiting).toEqual([]);
  const stack = yours.find((row) => row.number === 420)!;
  expect(stack.title).toBe("Chips in the search bar");
  expect(stack.stack?.map((layer) => layer.number)).toEqual([421, 422]);
  expect(yours.map((row) => row.number).sort()).toEqual([420, 9]);

  const failing = inboxRows(
    "you",
    [],
    [
      pull(420, { headRefName: "chips-1" }),
      pull(421, {
        headRefName: "chips-2",
        baseRefName: "chips-1",
        mergeable: "CONFLICTING",
      }),
    ],
  );
  expect(failing.waiting.map((row) => [row.number, row.why])).toEqual([
    [420, "conflicts with its base"],
  ]);
});

test("a pull request of yours that asks for your review shows once, and searches stay short", () => {
  const mine = pull(5, { reviewRequests: { nodes: [] } });
  const { waiting, yours } = inboxRows("You", [mine], [mine]);
  expect(waiting).toEqual([]);
  expect(yours.map((row) => row.number)).toEqual([5]);

  const repositories = Array.from({ length: 30 }, (_, at) => `acme/repository-${at}`);
  const queries = searchQueries("is:pr is:open author:@me", repositories);
  expect(queries.length).toBeGreaterThan(1);
  for (const query of queries) {
    expect(query.length).toBeLessThanOrEqual(256);
    expect(query.startsWith("is:pr is:open author:@me repo:")).toBe(true);
  }
  expect(queries.join(" ").match(/repo:/g)).toHaveLength(30);
  expect(searchQueries("is:pr", [])).toEqual(["is:pr"]);
});
