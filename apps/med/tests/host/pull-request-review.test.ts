import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startHost, type RunningHost } from "../../src/host/server";
import type { PullRequestComments } from "../../src/shared/protocol";

// A GitHub stand-in on PATH that keeps one pull request in a JSON file: `gh
// api` reads it as Med's --jq expressions print it, and `gh api graphql`
// changes the reader's pending review, as GitHub does. Nothing reaches GitHub.
const FAKE_GITHUB = `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require("node:fs");
const file = process.env.FAKE_GITHUB;
const state = JSON.parse(readFileSync(file, "utf8"));
const args = process.argv.slice(2);
appendFileSync(file + ".calls", JSON.stringify(args) + "\\n");
const lines = (values) => process.stdout.write(values.map((value) => JSON.stringify(value) + "\\n").join(""));
const pull = "repos/example/repo/pulls/7";
const pending = () => state.reviews.find((review) => review.state === "PENDING");
const inline = (comment) => ({
  id: comment.id, author: comment.author, body: comment.body, createdAt: "2026-10-01T00:00:00Z",
  url: "https://github.com/example/repo/pull/7#c" + comment.id, reply: comment.reply ?? null,
  path: comment.path, line: comment.line, startLine: comment.startLine ?? null,
  originalLine: comment.line, side: comment.side,
});
const path = args.find((arg) => arg.startsWith("repos/"));
if (path === pull) lines([{ head: state.head, number: 7, title: "Name the package", author: "author", state: "open", draft: false, merged: false }]);
else if (path === pull + "/comments?per_page=100")
  lines(state.comments.filter((comment) => state.reviews.find((review) => review.id === comment.review).state !== "PENDING").map(inline));
else if (path === "repos/example/repo/issues/7/comments?per_page=100") lines([]);
else if (path === pull + "/reviews?per_page=100")
  lines(state.reviews.map((review) => ({ id: review.id, author: "me", body: review.body, createdAt: null, url: "https://github.com/example/repo/pull/7#r" + review.id, state: review.state })));
else if (path && path.startsWith(pull + "/reviews/")) {
  const id = Number(path.split("/")[6]);
  lines(state.comments.filter((comment) => comment.review === id).map(inline));
} else if (args.includes("graphql")) {
  const vars = {};
  for (let index = 0; index < args.length; index++)
    if (args[index] === "-f" || args[index] === "-F") {
      const [name, ...value] = args[++index].split("=");
      vars[name] = args[index - 1] === "-F" ? Number(value.join("=")) : value.join("=");
    }
  const query = vars.query;
  const data = (value) => process.stdout.write(JSON.stringify({ data: value }));
  const review = pending();
  if (query.startsWith("query") && query.includes("reviewThreads")) {
    // One thread a page, newest first, so that a lookup pages.
    const roots = state.comments.filter((comment) => !comment.reply).reverse();
    const at = vars.after ? Number(vars.after) : 0;
    data({ repository: { pullRequest: { reviewThreads: {
      pageInfo: { hasNextPage: at + 1 < roots.length, endCursor: String(at + 1) },
      nodes: roots.slice(at, at + 1).map((comment) => ({ id: "T_" + comment.id, comments: { nodes: [{ databaseId: comment.id }] } })) } } } });
  } else if (query.startsWith("query")) {
    data({ repository: { pullRequest: { id: "PR_7", headRefOid: state.head,
      reviews: { nodes: review ? [{ id: "R_" + review.id, viewerDidAuthor: true }] : [] } } } });
  } else if (query.includes("addPullRequestReview(")) {
    if (review) { process.stderr.write("gh: User can only have one pending review per pull request\\n"); process.exit(1); }
    state.reviews.push({ id: ++state.next, state: "PENDING", body: "", commit: vars.commit });
    data({ addPullRequestReview: { pullRequestReview: { id: "R_" + state.next } } });
  } else if (query.includes("addPullRequestReviewThread(")) {
    if (vars.body === "GitHub refuses this.") { process.stderr.write("gh: Line could not be resolved\\n"); process.exit(1); }
    state.comments.push({ id: ++state.next, review: review.id, author: "me", body: vars.body, path: vars.path, line: vars.line, startLine: vars.startLine, side: vars.side });
    data({ addPullRequestReviewThread: { thread: { id: "T_" + state.next } } });
  } else if (query.includes("addPullRequestReviewThreadReply(")) {
    const root = state.comments.find((comment) => "T_" + comment.id === vars.thread);
    state.comments.push({ ...root, id: ++state.next, review: review.id, author: "me", body: vars.body, reply: root.id });
    data({ addPullRequestReviewThreadReply: { comment: { id: "C_" + state.next } } });
  } else if (query.includes("submitPullRequestReview(")) {
    Object.assign(review, { state: vars.event === "APPROVE" ? "APPROVED" : vars.event === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "COMMENTED", body: vars.body ?? "" });
    data({ submitPullRequestReview: { pullRequestReview: { id: "R_" + review.id } } });
  } else if (query.includes("deletePullRequestReview(")) {
    state.reviews = state.reviews.filter((entry) => entry !== review);
    state.comments = state.comments.filter((comment) => comment.review !== review.id);
    data({ deletePullRequestReview: { pullRequestReview: { id: "R_" + review.id } } });
  } else process.exit(1);
  writeFileSync(file, JSON.stringify(state));
} else process.exit(1);
`;

const directories: string[] = [];
const hosts: RunningHost[] = [];
const path = process.env.PATH;
afterEach(async () => {
  process.env.PATH = path;
  delete process.env.FAKE_GITHUB;
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((entry) => rm(entry, { recursive: true, force: true })),
  );
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pending review ")));
  directories.push(directory);
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "gh"), FAKE_GITHUB);
  await chmod(join(bin, "gh"), 0o755);
  process.env.PATH = `${bin}${delimiter}${path}`;
  const repo = join(directory, "repo");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "a.ts"), "export const a = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "Start");
  const base = git(repo, "rev-parse", "HEAD");
  await writeFile(
    join(repo, "a.ts"),
    "export const a = 2;\nexport const b = 3;\nexport const c = 4;\n",
  );
  git(repo, "commit", "-qam", "Change");
  const head = git(repo, "rev-parse", "HEAD");
  // GitHub has one submitted thread, by someone else, and no pending review.
  const github = join(directory, "github.json");
  process.env.FAKE_GITHUB = github;
  await writeFile(
    github,
    JSON.stringify({
      head,
      next: 100,
      reviews: [{ id: 1, state: "COMMENTED", body: "" }],
      comments: [
        {
          id: 2,
          review: 1,
          author: "author",
          body: "Why 2?",
          path: "a.ts",
          line: 1,
          side: "RIGHT",
        },
      ],
    }),
  );
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
  });
  hosts.push(host);
  const api = async (route: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${route}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as never };
  };
  const created = (
    await api("/api/reviews", {
      title: "Package name",
      pullRequestUrl: "https://github.com/example/repo/pull/7",
      targets: [{ repo, comparison: { kind: "range", base, head, includeBase: false } }],
    })
  ).data as { id: string; targets: { id: string }[] };
  const target = created.targets[0]!.id;
  const addNote = async (note: object) => {
    const notes = (await api(`/api/reviews/${created.id}/targets/${target}/notes`)).data as {
      revision: number;
    };
    const state = (
      await api(`/api/reviews/${created.id}/targets/${target}/notes`, {
        expectedRevision: notes.revision,
        mutation: { type: "add", note },
      })
    ).data as { notes: { id: string }[] };
    return state.notes.at(-1)!.id;
  };
  const pending = (body: object) => api(`/api/reviews/${created.id}/pull-request`, body);
  const calls = async () =>
    (await readFile(`${github}.calls`, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
  return { review: created.id, target, addNote, pending, calls, api };
}

const shown = (comments: PullRequestComments) =>
  comments.threads.map((thread) => ({
    line: thread.line,
    startLine: thread.startLine,
    comments: thread.comments.map(({ author, body, draft }) => ({ author, body, draft })),
  }));

test("Med comments and replies go into the reader's pending review on GitHub, which the reader then submits", async () => {
  const { target, addNote, pending, calls } = await fixture();
  // Two lines of the pull request's head: a pending review starts with it.
  const noteId = await addNote({
    path: "a.ts",
    side: "new",
    line: 2,
    endLine: 3,
    text: "Name b and c.",
  });
  const first = await pending({ action: "note", targetId: target, noteId });
  expect(first.status).toBe(200);
  // A reply to the other reviewer's thread joins the same pending review.
  const second = await pending({
    action: "reply",
    thread: 2,
    body: "Because the package says so.",
  });
  expect(shown(second.data as PullRequestComments)).toEqual([
    {
      line: 1,
      startLine: null,
      comments: [
        { author: "author", body: "Why 2?", draft: undefined },
        { author: "me", body: "Because the package says so.", draft: true },
      ],
    },
    {
      line: 3,
      startLine: 2,
      comments: [{ author: "me", body: "Name b and c.", draft: true }],
    },
  ]);
  // One pending review, on the head; lines on the new side are GitHub's RIGHT.
  const mutations = (await calls()).filter((args) =>
    args.some((arg) => arg.startsWith("query=mutation")),
  );
  expect(mutations.map((args) => /mutation\([^)]*\) \{ (\w+)/.exec(args.join(" "))![1])).toEqual([
    "addPullRequestReview",
    "addPullRequestReviewThread",
    "addPullRequestReviewThreadReply",
  ]);
  expect(mutations[1]).toEqual(
    expect.arrayContaining(["line=3", "startLine=2", "side=RIGHT", "startSide=RIGHT"]),
  );

  const submitted = await pending({
    action: "submit",
    event: "REQUEST_CHANGES",
    body: "Two names.",
  });
  const after = submitted.data as PullRequestComments;
  expect(after.reviews).toMatchObject([{ state: "CHANGES_REQUESTED", body: "Two names." }]);
  expect(after.threads.flatMap((thread) => thread.comments).some((comment) => comment.draft)).toBe(
    false,
  );
});

test("a discard removes the pending review; a comment twice, off the head or a removed line, a comment that GitHub refuses, or a submit without a pending review, is refused", async () => {
  const { target, addNote, pending, api, review, calls } = await fixture();
  const noteId = await addNote({ path: "a.ts", side: "new", line: 1, text: "One." });
  await pending({ action: "note", targetId: target, noteId });
  const again = await pending({ action: "note", targetId: target, noteId });
  expect(again.status).toBe(409);
  expect(again.data).toMatchObject({ error: { message: "GitHub has this comment already." } });
  const removed = await addNote({ path: "a.ts", side: "old", line: 1, text: "Was 1." });
  expect((await pending({ action: "note", targetId: target, noteId: removed })).data).toMatchObject(
    { error: { message: "Only a comment on the new side can go to GitHub." } },
  );
  const discarded = (await pending({ action: "discard" })).data as PullRequestComments;
  expect(discarded.reviews).toEqual([]);
  expect(shown(discarded)).toEqual([
    {
      line: 1,
      startLine: null,
      comments: [{ author: "author", body: "Why 2?", draft: undefined }],
    },
  ]);
  const submit = await pending({ action: "submit", event: "APPROVE" });
  expect(submit.status).toBe(409);
  expect(submit.data).toMatchObject({
    error: { message: "You have no pending review on GitHub." },
  });
  // GitHub refuses the first comment of a pending review that Med started:
  // the empty pending review goes too.
  const refused = await addNote({
    path: "a.ts",
    side: "new",
    line: 2,
    text: "GitHub refuses this.",
  });
  const failed = await pending({ action: "note", targetId: target, noteId: refused });
  expect(failed.status).toBe(502);
  expect(failed.data).toMatchObject({ error: { message: "Line could not be resolved" } });
  expect((await calls()).at(-1)!.join(" ")).toContain("deletePullRequestReview");
  expect(
    ((await api(`/api/reviews/${review}/pull-request?refresh=1`)).data as PullRequestComments)
      .reviews,
  ).toEqual([]);

  // The pull request moved on: its lines no longer match the review's.
  const github = process.env.FAKE_GITHUB!;
  const state = JSON.parse(await readFile(github, "utf8")) as { head: string };
  await writeFile(github, JSON.stringify({ ...state, head: "f".repeat(40) }));
  const moved = await pending({ action: "note", targetId: target, noteId });
  expect(moved.status).toBe(409);
  expect(moved.data).toMatchObject({
    error: {
      message: expect.stringMatching(/^GitHub comments go on the pull request head, fffffff/),
    },
  });
  expect((await api(`/api/reviews/${review}/pull-request?refresh=1`)).data).toMatchObject({
    reviews: [],
  });
});
