import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { loadPullRequestComments } from "../../src/host/repository/pull-request";

// A gh stand-in on PATH: `gh api` prints FAKE_GH_API's answer for the path it
// asks for, as gh's --jq prints it: one value per line, strings raw.
let directory = "";
const path = process.env.PATH;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "med-pull-comments-"));
  await writeFile(
    join(directory, "gh"),
    `#!/usr/bin/env node
const path = process.argv.slice(2).find((arg) => arg.startsWith("repos/"));
const answer = JSON.parse(process.env.FAKE_GH_API)[path];
if (answer === undefined) process.exit(1);
process.stdout.write(
  answer.map((value) => (typeof value === "string" ? value : JSON.stringify(value)) + "\\n").join(""),
);
`,
  );
  await chmod(join(directory, "gh"), 0o755);
  process.env.PATH = `${directory}${delimiter}${path}`;
});
afterEach(async () => {
  process.env.PATH = path;
  delete process.env.FAKE_GH_API;
  await rm(directory, { recursive: true, force: true });
});

const by = (author: string, id: number) => ({
  id,
  author,
  createdAt: "2026-10-01T00:00:00Z",
  url: `https://github.com/example/repo/pull/7#c${id}`,
});
const inline = (id: number, author: string, body: string, reply: number | null = null) => ({
  ...by(author, id),
  body,
  reply,
  path: "src/a.ts",
  line: 3,
  startLine: null,
  originalLine: 3,
  side: "RIGHT",
});

test("the reader's pending review on GitHub shows as draft comments and a draft summary", async () => {
  const pull = "repos/example/repo/pulls/7";
  process.env.FAKE_GH_API = JSON.stringify({
    [pull]: [
      {
        head: "abc123",
        number: 7,
        title: "Name the package",
        author: "reviewer",
        state: "open",
        draft: true,
        merged: false,
      },
    ],
    [`${pull}/comments?per_page=100`]: [inline(1, "reviewer", "Name this after the package.")],
    "repos/example/repo/issues/7/comments?per_page=100": [],
    [`${pull}/reviews?per_page=100`]: [
      { ...by("reviewer", 10), body: "", state: "COMMENTED" },
      { ...by("me", 11), createdAt: null, body: "Two things before merge.", state: "PENDING" },
    ],
    // GitHub lists a pending review's comments only under the review.
    [`${pull}/reviews/11/comments?per_page=100`]: [
      inline(2, "me", "Agreed, and the test too.", 1),
      { ...inline(3, "me", "This can be null."), line: 9, originalLine: 9 },
    ],
  });
  const comments = await loadPullRequestComments("https://github.com/example/repo/pull/7", true);
  expect(comments.head).toBe("abc123");
  expect(comments.pull).toEqual({
    number: 7,
    title: "Name the package",
    author: "reviewer",
    state: "draft",
  });
  expect(
    comments.threads.map((thread) => ({
      line: thread.line,
      comments: thread.comments.map(({ author, body, draft }) => ({ author, body, draft })),
    })),
  ).toEqual([
    {
      line: 3,
      comments: [
        { author: "reviewer", body: "Name this after the package.", draft: undefined },
        { author: "me", body: "Agreed, and the test too.", draft: true },
      ],
    },
    { line: 9, comments: [{ author: "me", body: "This can be null.", draft: true }] },
  ]);
  // The empty submitted comment review does not show; the draft's text does.
  expect(comments.reviews.map(({ author, state, draft }) => ({ author, state, draft }))).toEqual([
    { author: "me", state: "PENDING", draft: true },
  ]);
});
