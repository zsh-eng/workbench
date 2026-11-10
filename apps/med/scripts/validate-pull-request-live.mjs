// The Pull request page in each state of a pull request: the built Med and a
// real browser on a fake gh (scripts/fake-gh.mjs), with gh's output as real
// GitHub gives it (tests/fixtures/gh/live-pull-requests.mjs). Med writes
// nothing to GitHub here.
// Set MED_LIVE_PR_SHOTS to a folder for screenshots of each state, light and
// dark, narrow and wide.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { removeGitEnvironment } from "./git-environment.mjs";
import { useFakeGh } from "./fake-gh.mjs";
import {
  conflictPull,
  draftPull,
  failingPull,
  liveRules,
  mergedPull,
  sharedRules,
} from "../tests/fixtures/gh/live-pull-requests.mjs";

removeGitEnvironment();
// Med must never reach GitHub here: gh is a stand-in.
const fakeGh = useFakeGh();
for (const name of [
  "CLAUDE_CODE_SESSION_ID",
  "MED_SESSION",
  "MED_THREAD_KEY",
  "MED_THREAD_REPO",
  "MED_PORT",
  "MED_STATE_DIR",
])
  delete process.env[name];
const executable = process.env.MED_EXECUTABLE;
const command = executable ? resolve(executable) : process.execPath;
const cliArgs = executable ? [] : ["dist/cli.js"];
const shots = process.env.MED_LIVE_PR_SHOTS;
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-live-pull-")));
const repo = join(directory, "repo");
const remote = join(directory, "remote.git");
const stateDir = join(directory, "state");
const environment = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Med validation",
  GIT_AUTHOR_EMAIL: "validation@example.invalid",
  GIT_COMMITTER_NAME: "Med validation",
  GIT_COMMITTER_EMAIL: "validation@example.invalid",
};
const git = (...args) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: environment }).trim();

await mkdir(join(repo, "src"), { recursive: true });
execFileSync("git", ["init", "-q", "--bare", remote]);
const lines = (value) =>
  Array.from({ length: 20 }, (_, index) => `export const line${index + 1} = ${value};`).join("\n") +
  "\n";
git("init", "-q", "-b", "main");
git("remote", "add", "origin", remote);
await writeFile(join(repo, "src/queue.ts"), lines(1));
git("add", ".");
git("commit", "-qm", "Start");
const base = git("rev-parse", "HEAD");
git("checkout", "-qb", "feat/retry");
await writeFile(join(repo, "src/queue.ts"), lines(2));
git("add", ".");
git("commit", "-qm", "Retry");
const head = git("rev-parse", "HEAD");
git("push", "-q", "-u", "origin", "feat/retry");

// Thread lines refer to the pull request's head: here, the real commit.
const pulls = [draftPull, failingPull, mergedPull, conflictPull].map((pull) => ({ ...pull, head }));
const answerGh = (...rules) =>
  fakeGh.answer([
    ...rules,
    ...pulls.flatMap((pull) => liveRules(pull)),
    ...sharedRules(),
    { args: ["pr", "list"], stdout: [] },
  ]);
answerGh();

let host;
let browser;
const pageErrors = [];
try {
  host = spawn(command, [...cliArgs, repo, "--no-open", "--port", "0", "--state-dir", stateDir], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MED_SEARCH_CACHE: join(directory, "search-cache"),
      MED_ZOEKT_BIN: join(directory, "no-search-binaries"),
    },
  });
  let errors = "";
  host.stderr.on("data", (chunk) => (errors += chunk));
  const { origin, hash, port } = await new Promise((done, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Med did not start: ${errors}`)), 30000);
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (!match) return;
      clearTimeout(timer);
      const url = new URL(match[0]);
      done({ origin: url.origin, hash: url.hash, port: url.port });
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Med exited ${code}: ${errors}`));
    });
  });
  const med = (...args) =>
    execFileSync(command, [...cliArgs, ...args, "--state-dir", stateDir, "--port", port], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const create = async (title, pullRequestUrl) => {
    const manifest = join(directory, `${title.replace(/\W+/g, "-")}.json`);
    await writeFile(
      manifest,
      JSON.stringify({
        title,
        ...(pullRequestUrl ? { pullRequestUrl } : {}),
        targets: [{ repo, comparison: { kind: "range", base, head } }],
      }),
    );
    return /\/review\/(r_[0-9a-f]+)/.exec(med("review", "create", "--manifest", manifest))[1];
  };
  const reviews = new Map();
  for (const pull of pulls) reviews.set(pull.number, await create(pull.view.title, pull.url));

  browser = await chromium.launch({ headless: true });
  /** A browser window on a review, in a theme, at a width. */
  const open = async (id, { theme = "graphite-dark", width = 1500 } = {}) => {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addInitScript((name) => localStorage.setItem("med:theme:v1", name), theme);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`${origin}/review/${id}${hash}`);
    await page.locator('[data-review-status="ready"]').filter({ visible: true }).waitFor();
    await page.getByRole("radio", { name: "Pull request" }).click();
    return { page, view: page.getByRole("region", { name: "Pull request", exact: true }) };
  };
  const words = (view, text) => view.getByText(text, { exact: true }).first().waitFor();
  const shoot = async (name, page, view) => {
    if (!shots) return;
    await view.getByRole("heading", { level: 1 }).waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(shots, `${name}.png`) });
  };

  // Open, with failing CI, changes requested, and the reader's pending review.
  {
    const { page, view } = await open(reviews.get(52));
    await view.getByRole("heading", { name: "Retry failed calls in the queue worker" }).waitFor();
    // One line on who merges what.
    await words(view, "mira wants to merge feat/retry into main");
    await words(view, "#52");
    await words(view, "Blocked: changes requested.");
    await words(view, "3 commits behind main.");
    const checks = view.getByRole("region", { name: "Checks" });
    const names = () =>
      checks.locator("li").evaluateAll((rows) => rows.map((row) => row.textContent));
    // Failures show, in order; the checks that passed are a count, until asked.
    const failed = await names();
    assert.equal(failed.length, 4);
    assert.match(failed[0], /deploy\/preview/);
    assert.match(failed[1], /build.*Timed out.*1h 00m/s);
    assert.match(failed[2], /e2e.*CI · push.*Failed/s);
    assert.match(failed[3], /test \(ubuntu\).*2m 49s/s);
    await checks.getByRole("button", { name: "Checks: 4 passed, 1 skipped" }).click();
    // A check on two triggers is there twice, each with its trigger.
    const all = await names();
    assert.equal(all.filter((name) => /e2e.*CI · pull_request/s.test(name)).length, 1);
    assert.equal(all.length, 9);
    // A status's link is a web link or none.
    assert.equal(await checks.getByRole("link", { name: "Open security/scan" }).count(), 0);
    assert.equal(
      await checks.getByRole("link", { name: "Open deploy/preview" }).getAttribute("href"),
      "https://ci.example.com/job/1",
    );
    const reviewers = view.getByRole("region", { name: "Reviewers" });
    await words(reviewers, "acme/queue");
    await words(reviewers, "Changes requested");
    await words(view, "The worker gave up after one failed fetch.");
    // The reader's pending comment is theirs alone, and says so.
    const pending = view.getByRole("region", { name: "Your pending review" });
    await words(pending, "1 comment, only you see them");
    await words(pending, "Name this after the budget.");
    await words(view.getByRole("region", { name: "Conversation" }), "Please split the write path.");

    // No log until the reader asks; then its error shows, and not gh's columns.
    const logReads = () => fakeGh.calls().filter(({ args }) => args[0] === "run").length;
    assert.equal(logReads(), 0);
    await checks.getByRole("button", { name: "Show the failed log of test (ubuntu)" }).click();
    const log = checks.getByLabel("Failed log of test (ubuntu)", { exact: true });
    await log.waitFor();
    assert.equal(logReads(), 1);
    await log.getByText("Process completed with exit code 1.").waitFor();
    assert.doesNotMatch(await log.innerText(), /Run tests\t|##\[|2026-11-01T/);
    await shoot("failing-log-dark-wide", page, view);

    // A thread, in the one timeline, links to its line in the Review's diff.
    const conversation = view.getByRole("region", { name: "Conversation" });
    await conversation.getByRole("button", { name: "Show queue.ts:R12 in the diff" }).click();
    await page
      .locator('[data-pull-request-thread="101"]')
      .filter({ visible: true })
      .first()
      .waitFor();
    await page.getByRole("radio", { name: "Pull request" }).click();
    // A thread that GitHub calls outdated is one line, and has no link.
    await words(conversation, "lee on src/gone.ts, outdated");
    assert.equal(
      await conversation.getByRole("button", { name: /gone\.ts.* in the diff$/ }).count(),
      0,
    );
    await page.context().close();
  }

  // A draft, with checks that run and queue.
  {
    const { page, view } = await open(reviews.get(51));
    await words(view, "Draft");
    await words(view, "A draft: it cannot merge until it is ready.");
    // Running checks show; the one that passed is a count.
    const checks = view.getByRole("region", { name: "Checks" });
    assert.equal(await checks.locator("li").count(), 2);
    await checks.getByRole("button", { name: "Checks: 1 passed" }).waitFor();
    await view
      .getByText(/ wants to merge feat\/budget into main$/)
      .first()
      .waitFor();
    // A task list and code from its Markdown.
    await view.getByText("bun test src/queue").waitFor();
    assert.equal(await view.locator('input[type="checkbox"]').count(), 2);
    await page.context().close();
  }

  // Merged: its own state, whatever GitHub says of merging it.
  {
    const { page, view } = await open(reviews.get(53));
    await words(view, "Merged");
    await words(view, "Merged into main by sam.");
    await page.context().close();
    assert.equal(
      fakeGh.calls().filter(({ args }) => args.some((arg) => arg.includes("name-package"))).length,
      0,
    );
  }

  // Conflicts, from a fork, and how far behind it is.
  {
    const { page, view } = await open(reviews.get(54));
    await words(view, "Conflicts with main.");
    await words(view, "12 commits behind main.");
    await view
      .getByText(/ wants to merge rae:drain into main$/)
      .first()
      .waitFor();
    await words(view, "Requested");
    await page.context().close();
  }

  if (shots) {
    await mkdir(shots, { recursive: true });
    for (const [name, number] of [
      ["failing", 52],
      ["draft", 51],
      ["merged", 53],
      ["conflicts", 54],
    ])
      for (const [theme, shade] of [
        ["graphite-dark", "dark"],
        ["graphite-light", "light"],
      ])
        for (const [width, size] of [
          [1500, "wide"],
          [880, "narrow"],
        ]) {
          const { page, view } = await open(reviews.get(number), { theme, width });
          await shoot(`${name}-${shade}-${size}`, page, view);
          await page.context().close();
        }
  }

  assert.deepEqual(pageErrors, []);
  const calls = fakeGh.check();
  // gh api reads unless it is told to write, and Med tells it only for its
  // pending-review mutations, which the reader does not make here.
  const writes = calls.filter(
    ({ args }) =>
      args.some((arg) => /^(?:--method|-X|--input)$|^query=mutation|^mutation/.test(arg)) ||
      (args[0] === "pr" && !["view", "checks", "list"].includes(args[1])) ||
      (args[0] === "run" && args[1] !== "view"),
  );
  assert.deepEqual(writes, []);
  console.log(
    JSON.stringify({
      checks:
        "open with failing CI, draft, merged, and conflicts from a fork, in a real browser on gh's real output shapes; failures first and a check on two triggers twice, with its trigger; a commit status's unsafe link dropped; the pending review marked as the reader's; the failed log only on request, without gh's columns; a thread linking to its line; no write to GitHub",
      ghCalls: calls.length,
      pageErrors,
    }),
  );
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
