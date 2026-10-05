import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

// Use the built CLI or standalone executable with isolated repositories and state.
const executable = process.env.MED_EXECUTABLE;
const command = executable ? resolve(executable) : process.execPath;
const cliArgs = executable ? [] : ["dist/cli.js"];
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-review-links-")));
const stateDir = join(directory, "state");
const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Med validation",
      GIT_AUTHOR_EMAIL: "validation@example.invalid",
      GIT_COMMITTER_NAME: "Med validation",
      GIT_COMMITTER_EMAIL: "validation@example.invalid",
    },
  }).trim();
let host;
let browser;
const repositories = [];
async function stopHost() {
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
}
async function launch(port = 0) {
  host = spawn(
    command,
    [...cliArgs, ...repositories, "--no-open", "--port", String(port), "--state-dir", stateDir],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_SEARCH_CACHE: join(directory, "search-cache"),
        MED_ZOEKT_BIN: join(directory, "no-search-binaries"),
      },
    },
  );
  let errors = "";
  host.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${errors}`)), 30000);
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    host.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${errors}`));
    });
  });
  const parsed = new URL(url);
  return {
    url,
    origin: parsed.origin,
    port: Number(parsed.port),
    token: new URLSearchParams(parsed.hash.slice(1)).get("token"),
  };
}
let connection;
async function api(path, body) {
  const response = await fetch(`${connection.origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
}
try {
  for (const name of ["frontend", "backend"]) {
    const repo = join(directory, name);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(
      join(repo, "same.ts"),
      `export const scope = "${name}";\nexport const ${name}Before = 1;\nexport const adjacent = 3;\n`,
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "baseline");
    await writeFile(
      join(repo, "same.ts"),
      `export const scope = "${name}";\nexport const ${name}After = 2;\nexport const adjacent = 3;\n`,
    );
    repositories.push(repo);
  }
  const bareRemote = join(directory, "review-remote.git");
  git(directory, "init", "--bare", bareRemote);
  git(repositories[0], "remote", "add", "origin", bareRemote);
  connection = await launch();
  const manifestPath = join(directory, "review.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      title: "Agent handoff validation",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      targets: repositories.map((repo) => ({ repo, comparison: { kind: "working" } })),
    }),
  );
  const bin = join(directory, "bin");
  await mkdir(bin);
  await writeFile(
    join(bin, "gh"),
    `#!/usr/bin/env node
if (process.argv[2] !== "pr" || process.argv[3] !== "view" || !process.argv[4]) process.exit(1);
process.stdout.write(process.env.MED_TEST_PR);
`,
  );
  await chmod(join(bin, "gh"), 0o755);
  let prResult = {
    title: "Faster lookups",
    url: "https://github.com/example/repo/pull/42",
    headRefOid: git(repositories[0], "rev-parse", "HEAD"),
  };
  const runCli = (...args) =>
    execFileSync(
      command,
      [...cliArgs, "review", ...args, "--state-dir", stateDir, "--port", String(connection.port)],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MED_TEST_PR: JSON.stringify(prResult),
        },
      },
    ).trim();
  const catalogue = JSON.parse(runCli("repos"));
  assert.equal(catalogue.repositories.length, 2);
  const fromLink = async (link) =>
    api(new URL(/\((http[^)]+)\)/.exec(link)[1]).pathname.replace("/review/", "/api/reviews/"));
  git(repositories[0], "remote", "set-url", "origin", "git@github.com:example/repo.git");
  const inferred = await fromLink(
    runCli("create", "--repo", repositories[0], "--base", "HEAD", "--head", "HEAD"),
  );
  assert.equal(inferred.title, "Faster lookups");
  assert.equal(inferred.pullRequestUrl, prResult.url);
  const exact = await fromLink(
    runCli("create", "--repo", repositories[0], "--base", "HEAD", "--head", prResult.headRefOid),
  );
  assert.equal(exact.title, "Faster lookups");
  assert.equal(exact.targets[0].comparison.head, prResult.headRefOid);
  const custom = await fromLink(
    runCli(
      "create",
      "--repo",
      repositories[0],
      "--working",
      "--title",
      "My review",
      "--pr",
      prResult.url,
    ),
  );
  assert.equal(custom.title, "My review");
  assert.equal(custom.pullRequestUrl, prResult.url);
  const linked = await fromLink(
    runCli("create", "--repo", repositories[0], "--working", "--pr", prResult.url),
  );
  assert.equal(linked.title, "Faster lookups");
  const skipped = await fromLink(
    runCli("create", "--repo", repositories[0], "--base", "HEAD", "--head", "HEAD", "--no-pr"),
  );
  assert.equal(skipped.pullRequestUrl, undefined);
  assert.throws(() =>
    runCli("create", "--repo", repositories[0], "--working", "--pr", "javascript:alert(1)"),
  );
  prResult = { ...prResult, headRefOid: "0".repeat(40) };
  const mismatch = await fromLink(
    runCli("create", "--repo", repositories[0], "--base", "HEAD", "--head", "HEAD"),
  );
  assert.equal(mismatch.pullRequestUrl, undefined);
  assert.notEqual(mismatch.title, "Faster lookups");
  git(repositories[0], "remote", "set-url", "origin", bareRemote);
  const markdown = runCli("create", "--manifest", manifestPath);
  // Clearing one review must leave another review's comments intact.
  const other = await api("/api/reviews", {
    title: "Separate review",
    targets: [{ repo: repositories[0], comparison: { kind: "working" } }],
  });
  await api(`/api/reviews/${other.id}/targets/${other.targets[0].id}/notes`, {
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "same.ts", side: "new", line: 2, text: "Keep other review" },
    },
  });
  assert.ok(!markdown.includes(connection.token));
  const reviewUrl = /^\[Review changes here\]\((http:\/\/127\.0\.0\.1:\d+\/review\/[^)]+)\)$/.exec(
    markdown,
  )?.[1];
  assert.ok(reviewUrl, "CLI must print a clickable Markdown link");
  const id = new URL(reviewUrl).pathname.split("/").at(-1);
  let saved = await api(`/api/reviews/${id}`);
  assert.equal(saved.targets.length, 2);
  assert.equal(saved.pullRequestUrl, "https://github.com/example/repo/pull/42");
  assert.ok(saved.targets.every((target) => target.captured));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const pageErrors = [];
  context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
  const launchPage = await context.newPage();
  const invalidLaunch = new URL(connection.url);
  invalidLaunch.hash = "token=invalid-launch-token";
  await launchPage.goto(invalidLaunch.href);
  await launchPage.getByRole("alert").waitFor();
  assert.equal(
    await launchPage.evaluate(async () => (await fetch("/api/repositories")).status),
    401,
  );
  assert.equal((await context.cookies()).length, 0);
  const validLaunch = new URL(connection.url);
  validLaunch.searchParams.set("example", "preserved");
  validLaunch.hash += "&anchor=preserved";
  await launchPage.goto(validLaunch.href);
  await launchPage.locator('[data-review-status="ready"]').waitFor();
  await launchPage.waitForFunction(() => !location.hash.includes("token="));
  assert.equal(new URL(launchPage.url()).searchParams.get("example"), "preserved");
  assert.equal(
    new URLSearchParams(new URL(launchPage.url()).hash.slice(1)).get("anchor"),
    "preserved",
  );
  const cookies = await context.cookies();
  assert.ok(cookies.some((cookie) => cookie.httpOnly && cookie.sameSite === "Strict"));
  const page = await context.newPage();
  await page.goto(reviewUrl);
  await page.waitForFunction(() => document.title === "Agent handoff validation");
  assert.equal(
    await page
      .getByRole("link", { name: "Open pull request: Agent handoff validation", exact: true })
      .getAttribute("href"),
    "https://github.com/example/repo/pull/42",
  );
  await page.getByRole("region", { name: "Saved review" }).waitFor();
  await page.locator('[data-review-status="ready"]').waitFor();
  assert.equal(new URL(page.url()).hash, "");
  const header = page.getByRole("region", { name: "Saved review" });
  await header.getByText("Agent handoff validation", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Push", exact: true }).isEnabled(), false);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  // Select the changed line itself. A hover-only gutter button can disappear
  // when the renderer updates after browser focus or source loading.
  await page
    .locator('[data-additions] [data-column-number="2"] [data-line-number-content]')
    .click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Review note text" })
    .fill("Frontend feedback from the browser");
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT + ".draft.png" });
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page
    .getByRole("article")
    .getByText("Frontend feedback from the browser", { exact: true })
    .waitFor();
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT + ".saved.png" });
  const second = saved.targets[1];
  await api(`/api/reviews/${id}/targets/${second.id}/notes`, {
    expectedRevision: 0,
    mutation: {
      type: "add",
      note: { path: "same.ts", side: "new", line: 2, text: "Backend feedback across repositories" },
    },
  });
  await page.reload();
  await page.waitForFunction(() => document.title === "Agent handoff validation");
  assert.equal(
    await page
      .getByRole("link", { name: "Open pull request: Agent handoff validation", exact: true })
      .getAttribute("href"),
    "https://github.com/example/repo/pull/42",
  );
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Copy comments"]')?.textContent?.trim().endsWith("2"),
  );
  const copyButton = header.getByRole("button", { name: "Copy comments", exact: true });
  await copyButton.hover();
  const restingCopyWidth = (await copyButton.boundingBox()).width;
  await page.mouse.down();
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="Copy comments"]');
    return button && new DOMMatrix(getComputedStyle(button).transform).a < 0.99;
  });
  assert.ok((await copyButton.boundingBox()).width < restingCopyWidth * 0.99);
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-label="Copy comments"]')?.getAttribute("data-copied") ===
      "true",
  );
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  for (const expected of [
    "# Diff comments:",
    "## User Comment 1",
    "## User Comment 2",
    "File: same.ts",
    "Side: R",
    "Lines: 2",
    "Diff hunk:",
    "Comment:",
    "Frontend feedback from the browser",
    "Backend feedback across repositories",
    "frontendAfter",
    "backendAfter",
    "adjacent",
    "same.ts",
    ...repositories,
  ])
    assert.ok(clipboard.includes(expected), `Feedback must include ${expected}`);

  // Copy state must remain in place, including when the external clipboard is slow.
  const clearButton = header.getByRole("button", { name: "Clear all comments", exact: true });
  assert.ok((await header.boundingBox()).height <= 36);
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="Copy comments"]');
    return button && new DOMMatrix(getComputedStyle(button).transform).isIdentity;
  });
  const copyBounds = await copyButton.boundingBox();
  const clearBounds = await clearButton.boundingBox();
  assert.ok(clearBounds.x > copyBounds.x + copyBounds.width);
  assert.equal(clearBounds.y, copyBounds.y);
  assert.equal(await copyButton.getAttribute("title"), null);
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Copy comments"]')?.dataset.copied === "false",
  );
  assert.equal((await copyButton.boundingBox()).width, copyBounds.width);
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    window.restoreClipboard = () => {
      navigator.clipboard.writeText = original;
    };
    navigator.clipboard.writeText = async (text) => {
      await new Promise((resolve) => {
        window.releaseClipboard = resolve;
      });
      await original(text);
    };
  });
  await copyButton.hover();
  const appearance = () =>
    header.evaluate((element) =>
      [
        ...element.querySelectorAll(
          '[aria-label="Copy comments"], [aria-label="Clear all comments"]',
        ),
      ].map((button) => {
        const style = getComputedStyle(button);
        return {
          color: style.color,
          background: style.backgroundColor,
          opacity: style.opacity,
          x: button.offsetLeft,
          y: button.offsetTop,
          width: button.offsetWidth,
          height: button.offsetHeight,
        };
      }),
    );
  const beforeCopy = await appearance();
  await copyButton.click();
  await page.waitForFunction(() => typeof window.releaseClipboard === "function");
  assert.deepEqual(await appearance(), beforeCopy);
  assert.equal(await clearButton.evaluate((button) => button.disabled), false);
  await page.evaluate(() => window.releaseClipboard());
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Copy comments"]')?.dataset.copied === "true",
  );
  assert.deepEqual(await appearance(), beforeCopy);
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Clipboard unavailable");
    };
  });
  await copyButton.click();
  await header.getByRole("alert").filter({ hasText: "Clipboard unavailable" }).waitFor();
  assert.equal(await copyButton.getAttribute("data-copied"), "false");
  await page.evaluate(() => window.restoreClipboard());

  // Browse a commit outside the initial snapshot, then return and copy all scopes.
  await page.getByRole("option").filter({ hasText: "baseline" }).first().click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await page
    .locator('[data-additions] [data-column-number="1"] [data-line-number-content]')
    .click();
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Review note text" })
    .fill("Comment on an individual commit");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page
    .getByRole("article")
    .getByText("Comment on an individual commit", { exact: true })
    .waitFor();
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Copy comments"]')?.textContent?.trim().endsWith("3"),
  );
  await page.getByRole("button", { name: "Push", exact: true }).click();
  assert.equal(
    await page.getByRole("combobox", { name: "Destination branch" }).inputValue(),
    "main",
  );
  await page
    .getByRole("combobox", { name: "Destination branch" })
    .fill("review/browser-validation");
  await page.getByRole("button", { name: "Push to origin", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Pushed" }).waitFor();
  assert.equal(
    git(bareRemote, "rev-parse", "refs/heads/review/browser-validation"),
    git(repositories[0], "rev-parse", "HEAD"),
  );
  await page.getByRole("button", { name: "Compare against base branch" }).click();
  await page.getByRole("textbox", { name: "Filter comparison branches" }).fill("no-such-branch");
  await page.getByText("No matching branches.", { exact: true }).waitFor();
  await page.getByRole("textbox", { name: "Filter comparison branches" }).fill("main");
  await page.getByRole("menuitem", { name: "main", exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[data-review-status="ready"]')?.getAttribute("data-file-count") ===
      "0",
  );
  await header.getByRole("button", { name: "Return to review", exact: true }).click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await copyButton.click();
  await page.waitForFunction(async () =>
    (await navigator.clipboard.readText()).includes("Comment on an individual commit"),
  );
  const allComments = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(allComments.includes("Frontend feedback from the browser"));
  assert.ok(allComments.includes("Backend feedback across repositories"));
  assert.ok(allComments.includes("frontendBefore"));

  const previousToken = connection.token;
  const previousPort = connection.port;
  await stopHost();
  await writeFile(join(repositories[0], "same.ts"), "export const changedAfterCapture = true;\n");
  connection = await launch(previousPort);
  assert.equal(connection.token, previousToken);
  saved = await api(`/api/reviews/${id}`);
  assert.equal(saved.commentCount, 3);
  const source = await api(`/api/reviews/${id}/targets/${saved.targets[0].id}/source?path=same.ts`);
  assert.ok(source.new.includes("frontendAfter"));
  assert.ok(!source.new.includes("changedAfterCapture"));
  await page.reload();
  await page.waitForFunction(() => document.title === "Agent handoff validation");
  assert.equal(
    await page
      .getByRole("link", { name: "Open pull request: Agent handoff validation", exact: true })
      .getAttribute("href"),
    "https://github.com/example/repo/pull/42",
  );
  await page.waitForFunction(() =>
    document.querySelector('button[aria-label="Copy comments"]')?.textContent?.trim().endsWith("3"),
  );
  await page
    .getByRole("article")
    .getByText("Frontend feedback from the browser", { exact: true })
    .waitFor();
  await header.getByRole("combobox", { name: "Review target" }).selectOption(second.id);
  await page.getByText("Backend feedback across repositories", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear all comments", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal((await api(`/api/reviews/${id}/feedback`)).count, 3);
  await page.getByRole("button", { name: "Clear all comments", exact: true }).click();
  await page.getByRole("button", { name: "Confirm clear", exact: true }).click();
  await header.getByText("Comments cleared", { exact: true }).waitFor();
  assert.equal(
    await header.getByRole("button", { name: "Copy comments", exact: true }).isEnabled(),
    false,
  );
  assert.equal((await api(`/api/reviews/${id}/feedback`)).count, 0);
  const otherComments = await api(`/api/reviews/${other.id}/feedback`);
  assert.equal(otherComments.count, 1);
  assert.ok(otherComments.text.includes("Keep other review"));
  assert.deepEqual(pageErrors, []);
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT });
  console.log(
    JSON.stringify({
      checks:
        "PR metadata inference and exact-head guard; custom browser title and clickable PR; built CLI discovery and multi-repo snapshot manifest; token-free link and new-tab cookie auth; UI comments on saved and browsed commits; stable copy controls through delayed and rejected clipboard writes; UI push to temporary bare remote and merge-base dropdown; copied cross-repo and cross-tab source context; same-port restart and frozen snapshots; persistent comments; cancel and confirm clear",
      repositories: 2,
      commentsCopied: 3,
      pageErrors,
    }),
  );
} finally {
  await browser?.close();
  await stopHost();
  await rm(directory, { recursive: true, force: true });
}
