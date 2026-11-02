import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { startHost, type RunningHost } from "../../src/host/server";
import type { LivePullRequest } from "../../src/shared/protocol";
// @ts-expect-error A plain script, shared with the validations, has no types.
import * as fixtures from "../fixtures/gh/live-pull-requests.mjs";
// @ts-expect-error A plain script, shared with the validations, has no types.
import { useFakeGh } from "../../scripts/fake-gh.mjs";
import { removeFolder } from "./remove-folder";

const { conflictPull, draftPull, FAILED_JOB, failingPull, liveRules, mergedPull, sharedRules } =
  fixtures;

// Through the host's routes, with gh's output as real GitHub gives it
// (tests/fixtures/gh/live-pull-requests.mjs). Nothing here reaches GitHub.

const saved = { path: process.env.PATH, config: process.env.GH_CONFIG_DIR };
let fakeGh: { answer(rules: unknown[]): void; calls(): { args: string[] }[] };
let directory = "";
let host: RunningHost;
/** A saved review for each pull request, by its URL. */
const reviews = new Map<string, string>();

const calls = () => fakeGh.calls();
const api = (path: string) =>
  fetch(`http://127.0.0.1:${host.port}${path}`, {
    headers: { authorization: `Bearer ${host.token}` },
  });
const live = async (pull: { url: string }, query = "?refresh=1") => {
  const response = await api(`/api/reviews/${reviews.get(pull.url)}/pull-request-live${query}`);
  expect(response.status).toBe(200);
  return (await response.json()) as LivePullRequest;
};

beforeAll(async () => {
  fakeGh = useFakeGh();
  fakeGh.answer([
    ...[draftPull, failingPull, mergedPull, conflictPull].flatMap((pull) => liveRules(pull)),
    ...sharedRules(),
  ]);
  directory = await realpath(await mkdtemp(join(tmpdir(), "med-live-pull-")));
  const repo = join(directory, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  await writeFile(join(repo, "a.txt"), "one\n");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Start");
  await writeFile(join(repo, "a.txt"), "two\n");
  git("add", ".");
  git("-c", "user.name=Med", "-c", "user.email=med@example.invalid", "commit", "-qm", "Next");
  host = await startHost({ repo, repos: [repo], stateDir: join(directory, "state"), port: 0 });
  for (const pull of [draftPull, failingPull, mergedPull, conflictPull]) {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/reviews`, {
      method: "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: pull.view.title,
        pullRequestUrl: pull.url,
        targets: [
          { repo, comparison: { kind: "range", base: git("rev-parse", "HEAD~1"), head: "HEAD" } },
        ],
      }),
    });
    reviews.set(pull.url, ((await response.json()) as { id: string }).id);
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await host?.close();
  await removeFolder(directory);
  process.env.PATH = saved.path;
  if (saved.config === undefined) delete process.env.GH_CONFIG_DIR;
  else process.env.GH_CONFIG_DIR = saved.config;
});

test("checks read as GitHub means them: failures first, with only web links", async () => {
  const pull = await live(failingPull);
  expect(pull).toMatchObject({
    number: 52,
    state: "open",
    base: "main",
    head: "feat/retry",
    author: "mira",
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "queue", color: "0e8a16" },
    ],
  });
  expect(pull.checks.map(({ name, event, outcome }) => [name, event, outcome])).toEqual([
    ["deploy/preview", undefined, "failed"],
    ["build", undefined, "failed"],
    // Two triggers are two checks, and the row says which: a pass hides no failure.
    ["e2e", "push", "failed"],
    ["test (ubuntu)", undefined, "failed"],
    ["security/scan", undefined, "passed"],
    ["e2e", "pull_request", "passed"],
    ["lint", undefined, "passed"],
    ["types", undefined, "passed"],
    ["label", undefined, "skipped"],
  ]);
  expect(new Set(pull.checks.map((check) => check.id)).size).toBe(pull.checks.length);
  const byName = new Map(pull.checks.map((check) => [check.name, check]));
  // Only a failed GitHub Actions job has a log to read.
  expect(pull.checks.filter((check) => check.job).map((check) => check.job)).toEqual([
    7002,
    7004,
    FAILED_JOB,
  ]);
  expect(byName.get("build")).toMatchObject({ state: "TIMED_OUT", workflow: "CI" });
  // A commit status has no end, and its link is whatever a service set.
  expect(byName.get("deploy/preview")).toMatchObject({
    completedAt: null,
    url: "https://ci.example.com/job/1",
  });
  expect(byName.get("security/scan")?.url).toBeUndefined();
});

test("a draft keeps its draft state and a running check has no made-up end", async () => {
  const pull = await live(draftPull);
  expect(pull.state).toBe("draft");
  expect(pull.merge).toMatchObject({ mergeable: "MERGEABLE", status: "CLEAN", behindBy: 0 });
  const [first, second] = pull.checks;
  // Neither has an end, and the queued one has not started: gh prints year 1.
  expect(first).toMatchObject({
    name: "test (macos)",
    outcome: "pending",
    state: "QUEUED",
    startedAt: null,
    completedAt: null,
  });
  expect(second).toMatchObject({ name: "test (ubuntu)", state: "IN_PROGRESS", completedAt: null });
});

test("a merged pull request reads as merged, without a comparison that it no longer needs", async () => {
  const pull = await live(mergedPull);
  expect(pull).toMatchObject({ state: "merged" });
  expect(pull.merge).toEqual({
    mergeable: "UNKNOWN",
    status: "UNKNOWN",
    decision: "APPROVED",
    mergedBy: "sam",
    endedAt: "2026-10-30T08:00:00Z",
  });
  expect(pull.reviewers).toEqual([{ name: "sam", state: "APPROVED" }]);
  expect(calls().filter(({ args }) => args.some((arg) => arg.includes("name-package")))).toEqual(
    [],
  );
  // The others compare, so the line above can fail.
  expect(calls().some(({ args }) => args.some((arg) => arg.includes("/compare/")))).toBe(true);
});

test("conflicts, how far behind, and a fork's branch come from GitHub", async () => {
  const pull = await live(conflictPull);
  expect(pull).toMatchObject({ state: "open", head: "rae:drain" });
  expect(pull.merge).toMatchObject({
    mergeable: "CONFLICTING",
    status: "DIRTY",
    decision: "REVIEW_REQUIRED",
    behindBy: 12,
  });
  expect(pull.reviewers).toEqual([{ name: "sam", state: "REQUESTED" }]);
});

test("reviewers: those asked, also teams, then who reviewed; the limit reads the lower share", async () => {
  const pull = await live(failingPull);
  expect(pull.reviewers).toEqual([
    { name: "jordan", state: "REQUESTED" },
    { name: "acme/queue", state: "REQUESTED", team: true },
    { name: "sam", state: "CHANGES_REQUESTED" },
    { name: "lee", state: "COMMENTED" },
  ]);
  expect(pull.budget).toEqual({ remaining: 4800, limit: 5000, resetAt: 1793590000 * 1000 });
});

test("reads share a short cache that Refresh skips, and only reads reach gh", async () => {
  const views = () =>
    fakeGh
      .calls()
      .filter(({ args }) => args[0] === "pr" && args[1] === "view" && args.includes(draftPull.url))
      .length;
  await live(draftPull);
  const before = views();
  await live(draftPull, "");
  expect(views()).toBe(before);
  await live(draftPull);
  expect(views()).toBe(before + 1);
  // gh api reads with GET unless it is told otherwise; nothing here tells it.
  const writes = fakeGh
    .calls()
    .filter(({ args }) =>
      args.some((arg) =>
        /^(?:merge|ready|close|reopen|edit|comment|review|rerun|--method|-X|POST|PATCH|PUT)$/.test(
          arg,
        ),
      ),
    );
  expect(writes).toEqual([]);
});

test("a failed job's log comes only on request: its end, without gh's columns", async () => {
  const review = reviews.get(failingPull.url);
  const logReads = () => calls().filter(({ args }) => args[0] === "run").length;
  await live(failingPull);
  expect(logReads()).toBe(0);
  const response = await api(`/api/reviews/${review}/pull-request-log?job=${FAILED_JOB}`);
  expect(await response.json()).toEqual({
    skipped: 0,
    text: [
      "##[group]Run bun test",
      "bun test src/queue",
      "##[endgroup]",
      "expected 3 attempts, got 1",
      "##[error]Process completed with exit code 1.",
      "npm warn deprecated a package that has no time stamp",
      "Cleaning up orphan processes",
    ].join("\n"),
  });
  expect(
    fakeGh
      .calls()
      .filter(({ args }) => args[0] === "run")
      .at(-1)?.args,
  ).toEqual([
    "run",
    "view",
    "--job",
    String(FAILED_JOB),
    "--log-failed",
    "-R",
    "github.com/acme/queue",
  ]);
  expect((await api(`/api/reviews/${review}/pull-request-log?job=1;rm`)).status).toBe(400);
});

test.each([
  [
    "job 7 is still in progress; logs will be available when it is complete",
    409,
    "when the job ends",
  ],
  [
    "failed to get run log: HTTP 410: Server Error (https://api.github.com/x)",
    410,
    "no longer has",
  ],
])("a log that GitHub cannot give says why: %s", async (stderr, status, words) => {
  fakeGh.answer([
    { args: ["run", "view"], stderr, exitCode: 1 },
    ...liveRules(failingPull),
    ...sharedRules(),
  ]);
  const response = await api(
    `/api/reviews/${reviews.get(failingPull.url)}/pull-request-log?job=${FAILED_JOB}`,
  );
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: { message: string } }).error.message).toContain(
    words,
  );
  fakeGh.answer([...liveRules(failingPull), ...sharedRules()]);
});

test("an answer about the API limit that Med cannot read costs only the limit", async () => {
  fakeGh.answer([
    { args: ["api", "rate_limit"], stdout: "not json\n" },
    ...liveRules(mergedPull),
    ...sharedRules(),
  ]);
  const pull = await live(mergedPull);
  expect(pull.state).toBe("merged");
  expect(pull.budget).toBeUndefined();
  fakeGh.answer([...liveRules(mergedPull), ...sharedRules()]);
});

test("a branch with no checks has none, but a failed read of them is a failed read", async () => {
  const review = reviews.get(mergedPull.url);
  fakeGh.answer([
    {
      args: ["pr", "checks"],
      stderr: "no checks reported on the 'name-package' branch\n",
      exitCode: 1,
    },
    ...liveRules(mergedPull),
    ...sharedRules(),
  ]);
  expect((await live(mergedPull)).checks).toEqual([]);
  // A service can post a status and a check of one name; each row is its own.
  const posted = { name: "Vercel", workflow: "", event: "", state: "SUCCESS", link: "" };
  fakeGh.answer([
    { args: ["pr", "checks"], stdout: [posted, posted] },
    ...liveRules(mergedPull),
    ...sharedRules(),
  ]);
  const [first, second] = (await live(mergedPull)).checks;
  expect(first!.id).not.toBe(second!.id);
  fakeGh.answer([
    { args: ["pr", "checks"], stderr: "HTTP 502: 502 Bad Gateway\n", exitCode: 1 },
    ...liveRules(mergedPull),
    ...sharedRules(),
  ]);
  expect((await api(`/api/reviews/${review}/pull-request-live?refresh=1`)).status).toBe(502);
  fakeGh.answer([...liveRules(mergedPull), ...sharedRules()]);
});

test("a failed read says why, and a later one reads again", async () => {
  fakeGh.answer([
    {
      args: ["pr", "view"],
      stderr: "HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)\n",
      exitCode: 1,
    },
    ...liveRules(mergedPull),
    ...sharedRules(),
  ]);
  const review = reviews.get(mergedPull.url);
  const failed = await api(`/api/reviews/${review}/pull-request-live?refresh=1`);
  expect(failed.status).toBe(502);
  expect(((await failed.json()) as { error: { message: string } }).error.message).toContain("502");
  fakeGh.answer([...liveRules(mergedPull), ...sharedRules()]);
  expect((await live(mergedPull)).state).toBe("merged");
});

test("images come from GitHub's rendered description, and from nowhere else", async () => {
  const attachment =
    "https://github.com/user-attachments/assets/36b555b6-b4ac-46c3-8cb8-56fb574b7c89";
  const signed =
    "https://private-user-images.githubusercontent.com/1/2-36b555b6-b4ac-46c3-8cb8-56fb574b7c89.png?jwt=a.b&amp;c=d";
  const elsewhere = "https://example.com/chart.png";
  const proxied = "https://camo.githubusercontent.com/abc/def";
  const offsite = "https://evil.example/stolen.png";
  const raw = "https://github.com/acme/queue/raw/main/shot.png";
  const stray = "https://github.com/acme/queue/raw/main/stray.png";
  fakeGh.answer([
    {
      contains: ["bodyHTML"],
      stdout: {
        data: {
          repository: {
            pullRequest: {
              bodyHTML: `<p><a href="${signed}"><img src="${signed}" alt="Before" style="max-width: 100%;"></a><img src="${proxied}" data-canonical-src="${elsewhere}"><img src="${offsite}"><img src="${raw}"><img src="${stray}"></p>`,
            },
          },
        },
      },
    },
    ...sharedRules(),
  ]);
  const fetched: string[] = [];
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: URL | string, init?: RequestInit) => {
    const target = String(input);
    if (target.startsWith("http://127.0.0.1")) return real(target, init);
    fetched.push(target);
    // A raw file on github.com redirects, to GitHub or, here, off it.
    if (target === raw)
      return new Response(null, {
        status: 302,
        headers: { location: "https://raw.githubusercontent.com/acme/queue/main/shot.png" },
      });
    if (target === stray)
      return new Response(null, { status: 302, headers: { location: offsite } });
    return /^https:\/\/(?:private-user-images|raw)\./.test(target)
      ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })
      : new Response("<html></html>", { headers: { "content-type": "text/html" } });
  });
  const image = (src: string) =>
    api(
      `/api/reviews/${reviews.get(draftPull.url)}/pull-request-image?src=${encodeURIComponent(src)}`,
    );
  const shown = await image(attachment);
  expect(shown.status).toBe(200);
  expect(shown.headers.get("content-type")).toBe("image/png");
  expect(shown.headers.get("content-security-policy")).toContain("sandbox");
  expect([...new Uint8Array(await shown.arrayBuffer())]).toEqual([1, 2, 3]);
  // The signed link went out as GitHub means it, with its entities read.
  expect(fetched).toEqual([signed.replace("&amp;", "&")]);
  // What GitHub proxies is reachable by its own URL, but it must be an image.
  expect((await image(elsewhere)).status).toBe(502);
  expect(fetched.at(-1)).toBe(proxied);
  // An address that the description does not have is never fetched.
  const calls = fetched.length;
  expect((await image("http://169.254.169.254/latest/meta-data")).status).toBe(404);
  // Nor is one that the description has, on a host that is not GitHub's.
  expect((await image(offsite)).status).toBe(404);
  expect(fetched.length).toBe(calls);
  // A redirect stays on GitHub's hosts, or Med stops.
  expect((await image(raw)).status).toBe(200);
  expect(fetched.at(-1)).toBe("https://raw.githubusercontent.com/acme/queue/main/shot.png");
  expect((await image(stray)).status).toBe(502);
  expect(fetched).not.toContain(offsite);
  fakeGh.answer([...liveRules(failingPull), ...sharedRules()]);
});
