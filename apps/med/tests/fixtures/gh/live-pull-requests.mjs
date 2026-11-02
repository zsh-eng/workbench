// Pull requests in each state, as gh prints them. The names are invented; the
// shapes come from read-only calls to real pull requests on 2 Nov 2026, with
// what those calls showed that a tidy fixture hides:
//
// - gh prints an empty time as Go's zero time, and a running check's
//   conclusion as "".
// - A commit status has `context`, `state`, `targetUrl` and no end time, and
//   its link can be anything.
// - A check that a trigger starts again is in the list again for the commit,
//   and a workflow's push and pull_request runs are both there at once.
// - A skipped check can end a second before it starts.
// - GitHub says CLEAN for a draft, and a pull request on main can read CLEAN
//   while it is commits behind: only compare says so.
// - A merged pull request reads mergeable UNKNOWN.
// - `gh run view --log-failed` starts its first line with a byte order mark,
//   and lines after the failure follow the error.

const ZERO_TIME = "0001-01-01T00:00:00Z";
const user = (login, id = "U_kgDOAAAAAA") => ({ id, is_bot: false, login, name: "" });
const label = (name, color) => ({ id: "LA_kwDOAAAAAA", name, description: "", color });
const run = (name, workflowName, conclusion, startedAt, completedAt, job) => ({
  __typename: "CheckRun",
  completedAt,
  conclusion,
  detailsUrl: `https://github.com/acme/queue/actions/runs/9100/job/${job}`,
  name,
  startedAt,
  status: "COMPLETED",
  workflowName,
});
const running = (name, workflowName, status, startedAt, job) => ({
  __typename: "CheckRun",
  completedAt: ZERO_TIME,
  conclusion: "",
  detailsUrl: `https://github.com/acme/queue/actions/runs/9101/job/${job}`,
  name,
  startedAt,
  status,
  workflowName,
});
const status = (context, state, targetUrl) => ({
  __typename: "StatusContext",
  context,
  startedAt: "2026-11-01T09:40:00Z",
  state,
  targetUrl,
});
const latestReview = (login, state) => ({
  id: "",
  author: { login },
  authorAssociation: "MEMBER",
  body: "",
  submittedAt: "2026-11-01T10:00:00Z",
  includesCreatedEdit: false,
  reactionGroups: [],
  state,
  commit: { oid: "" },
});

/** What every view has unless a pull request says otherwise. */
const view = (fields) => ({
  number: 0,
  title: "",
  url: "",
  state: "OPEN",
  isDraft: false,
  body: "",
  author: user("mira"),
  baseRefName: "main",
  headRefName: "feat/retry",
  headRepositoryOwner: { id: "O_kgDOAAAAAA", login: "acme" },
  isCrossRepository: false,
  labels: [],
  statusCheckRollup: [],
  latestReviews: [],
  reviewRequests: [],
  reviewDecision: "",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  mergedBy: null,
  mergedAt: null,
  closedAt: null,
  ...fields,
});
const url = (number) => `https://github.com/acme/queue/pull/${number}`;
const by = (id, author, number) => ({
  id,
  author,
  createdAt: `2026-11-01T0${id % 9}:00:00Z`,
  url: `${url(number)}#c${id}`,
});
const inline = (id, author, body, number, path, line, reply = null) => ({
  ...by(id, author, number),
  body,
  reply,
  path,
  line,
  startLine: null,
  originalLine: line,
  side: "RIGHT",
});

export const FAILED_JOB = 7001;

/** A failed job's log as `gh run view --log-failed` prints it. */
export const FAILED_LOG = [
  "test (ubuntu)\tRun tests\t﻿2026-11-01T09:41:00.1000000Z ##[group]Run bun test",
  "test (ubuntu)\tRun tests\t2026-11-01T09:41:00.1100000Z bun test src/queue",
  "test (ubuntu)\tRun tests\t2026-11-01T09:41:00.1200000Z ##[endgroup]",
  "test (ubuntu)\tRun tests\t2026-11-01T09:41:03.2000000Z \u001b[31mexpected 3 attempts, got 1\u001b[0m",
  "test (ubuntu)\tRun tests\t2026-11-01T09:41:03.3000000Z ##[error]Process completed with exit code 1.",
  "test (ubuntu)\tRun tests\tnpm warn deprecated a package that has no time stamp",
  "test (ubuntu)\tRun tests\t2026-11-01T09:41:04.0000000Z Cleaning up orphan processes",
  "",
].join("\n");

export const draftPull = {
  url: url(51),
  number: 51,
  head: "a".repeat(40),
  view: view({
    number: 51,
    title: "Add a retry budget to the queue worker",
    url: url(51),
    headRefName: "feat/budget",
    isDraft: true,
    body: "## Why\n\nA short network blip dropped jobs.\n\n- [x] `bun test src/queue`\n- [ ] Run against a flaky server for an hour",
    labels: [label("enhancement", "a2eeef")],
    mergeStateStatus: "CLEAN",
    statusCheckRollup: [
      run("lint", "CI", "SUCCESS", "2026-11-02T01:00:00Z", "2026-11-02T01:00:42Z", 6001),
      running("test (ubuntu)", "CI", "IN_PROGRESS", "2026-11-02T01:00:10Z", 6002),
      running("test (macos)", "CI", "QUEUED", ZERO_TIME, 6003),
    ],
  }),
  behindBy: 0,
  inline: [],
  conversation: [],
  reviews: [],
};

export const failingPull = {
  url: url(52),
  number: 52,
  head: "b".repeat(40),
  view: view({
    number: 52,
    title: "Retry failed calls in the queue worker",
    url: url(52),
    body: "## Why\n\nThe worker gave up after one failed fetch.\n\n## What\n\n`retry()` now tries a failed call up to three times.",
    labels: [label("bug", "d73a4a"), label("queue", "0e8a16")],
    mergeStateStatus: "BLOCKED",
    reviewDecision: "CHANGES_REQUESTED",
    statusCheckRollup: [
      run("lint", "CI", "SUCCESS", "2026-11-01T09:40:00Z", "2026-11-01T09:40:42Z", 7000),
      // The first run of this check failed; the run after it passed.
      run("types", "CI", "FAILURE", "2026-11-01T09:30:00Z", "2026-11-01T09:31:00Z", 6990),
      run("types", "CI", "SUCCESS", "2026-11-01T09:40:00Z", "2026-11-01T09:41:00Z", 6991),
      run(
        "test (ubuntu)",
        "CI",
        "FAILURE",
        "2026-11-01T09:40:00Z",
        "2026-11-01T09:42:49Z",
        FAILED_JOB,
      ),
      run("build", "CI", "TIMED_OUT", "2026-11-01T09:40:00Z", "2026-11-01T10:40:00Z", 7002),
      run("label", "Triage", "SKIPPED", "2026-11-01T09:40:02Z", "2026-11-01T09:40:01Z", 7003),
      // A workflow on push and pull_request: both runs count, also the failed one.
      run("e2e", "CI", "FAILURE", "2026-11-01T09:40:00Z", "2026-11-01T09:44:00Z", 7004),
      run("e2e", "CI", "SUCCESS", "2026-11-01T09:40:05Z", "2026-11-01T09:44:05Z", 7005),
      // Cancelled before it started, so GitHub has no times, then run again.
      run("flaky", "CI", "CANCELLED", ZERO_TIME, ZERO_TIME, 6980),
      run("flaky", "CI", "SUCCESS", "2026-11-01T09:40:00Z", "2026-11-01T09:41:00Z", 6981),
      status("deploy/preview", "FAILURE", "https://ci.example.com/job/1"),
      status("security/scan", "SUCCESS", "javascript:alert(1)"),
    ],
    latestReviews: [latestReview("sam", "CHANGES_REQUESTED"), latestReview("lee", "COMMENTED")],
    reviewRequests: [
      { __typename: "User", login: "jordan" },
      { __typename: "Team", name: "Queue", slug: "acme/queue" },
    ],
  }),
  behindBy: 3,
  inline: [
    inline(101, "sam", "This retries a call that already wrote.", 52, "src/queue.ts", 12),
    inline(102, "mira", "It does not: a write has its own key.", 52, "src/queue.ts", 12, 101),
    inline(103, "lee", "Was this off by one?", 52, "src/gone.ts", null),
  ],
  conversation: [{ ...by(201, "lee", 52), body: "The flaky test failed again on main." }],
  reviews: [
    { ...by(301, "sam", 52), body: "Please split the write path.", state: "CHANGES_REQUESTED" },
    { ...by(302, "reader", 52), createdAt: null, body: "", state: "PENDING" },
  ],
  // The reader's pending review, which only GraphQL gives lines for.
  pending: [
    {
      databaseId: 401,
      author: { login: "reader" },
      body: "Name this after the budget.",
      createdAt: "2026-11-01T11:00:00Z",
      url: `${url(52)}#discussion_r401`,
      replyTo: null,
      path: "src/worker.ts",
      line: 7,
      startLine: null,
      originalLine: 7,
    },
  ],
};

export const mergedPull = {
  url: url(53),
  number: 53,
  head: "c".repeat(40),
  view: view({
    number: 53,
    title: "Name the queue package",
    url: url(53),
    headRefName: "name-package",
    state: "MERGED",
    body: "Renames the package.",
    mergeable: "UNKNOWN",
    mergeStateStatus: "UNKNOWN",
    reviewDecision: "APPROVED",
    mergedBy: user("sam"),
    mergedAt: "2026-10-30T08:00:00Z",
    closedAt: "2026-10-30T08:00:00Z",
    latestReviews: [latestReview("sam", "APPROVED")],
    statusCheckRollup: [
      run("test", "CI", "SUCCESS", "2026-10-30T07:00:00Z", "2026-10-30T07:04:05Z", 8001),
    ],
  }),
  inline: [],
  conversation: [],
  reviews: [{ ...by(501, "sam", 53), body: "", state: "APPROVED" }],
};

export const conflictPull = {
  url: url(54),
  number: 54,
  head: "d".repeat(40),
  view: view({
    number: 54,
    title: "Drain the queue on shutdown",
    url: url(54),
    body: "Drains the queue before the worker exits.",
    author: user("rae"),
    headRefName: "drain",
    headRepositoryOwner: { id: "U_kgDOBBBBBB", name: "Rae", login: "rae" },
    isCrossRepository: true,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequests: [{ __typename: "User", login: "sam" }],
    statusCheckRollup: [
      run("test", "CI", "SUCCESS", "2026-10-29T07:00:00Z", "2026-10-29T07:04:05Z", 9001),
    ],
  }),
  behindBy: 12,
  inline: [],
  conversation: [],
  reviews: [],
};

export const livePulls = [draftPull, failingPull, mergedPull, conflictPull];

const lines = (entries) => entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
const owner = ({ view }) => view.headRepositoryOwner.login;

/** The answers that a pull request gets from gh (scripts/fake-gh.mjs). */
export function liveRules(pull) {
  const base = `repos/acme/queue`;
  const place = `${base}/pulls/${pull.number}`;
  const { view } = pull;
  return [
    { args: ["pr", "view", pull.url], stdout: view },
    {
      args: ["api", place],
      stdout: `${JSON.stringify({
        head: pull.head,
        number: pull.number,
        title: view.title,
        author: view.author.login,
        state: view.state === "OPEN" ? "open" : "closed",
        draft: view.isDraft,
        merged: view.state === "MERGED",
      })}\n`,
    },
    { args: ["api", `${place}/comments?per_page=100`], stdout: lines(pull.inline) },
    {
      args: ["api", `${base}/issues/${pull.number}/comments?per_page=100`],
      stdout: lines(pull.conversation),
    },
    { args: ["api", `${place}/reviews?per_page=100`], stdout: lines(pull.reviews) },
    ...(view.state === "OPEN"
      ? [
          {
            args: [
              "api",
              `${base}/compare/${view.baseRefName}...${owner(pull)}:${view.headRefName}?per_page=1`,
            ],
            stdout: `${pull.behindBy}\n`,
          },
        ]
      : []),
  ];
}

/** Answers that do not depend on the pull request. */
export function sharedRules(pending = failingPull) {
  const comments = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: pending.pending };
  return [
    {
      contains: ["reviews(states: PENDING"],
      stdout: { data: { repository: { pullRequest: { reviews: { nodes: [{ comments }] } } } } },
    },
    {
      contains: ["reviewThreads("],
      stdout: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: pending.pending.map((comment) => ({
                  id: `T_${comment.databaseId}`,
                  diffSide: "RIGHT",
                  comments: { nodes: [{ databaseId: comment.databaseId }] },
                })),
              },
            },
          },
        },
      },
    },
    {
      args: ["run", "view", "--job", String(FAILED_JOB), "--log-failed"],
      stdout: FAILED_LOG,
    },
    {
      args: ["api", "rate_limit"],
      stdout: {
        core: { limit: 5000, remaining: 4800, reset: 1793590000 },
        graphql: { limit: 5000, remaining: 4900, reset: 1793590000 },
      },
    },
  ];
}
