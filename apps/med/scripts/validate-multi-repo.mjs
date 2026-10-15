import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { removeGitEnvironment } from "./git-environment.mjs";

removeGitEnvironment();

// Exercise the built CLI, host and browser together against isolated Git repositories.
// MED_EXECUTABLE runs a standalone executable instead of dist/cli.js.
const executable = process.env.MED_EXECUTABLE;
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-multi-repo-")));
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
try {
  const repositories = [];
  for (const name of ["frontend", "backend", "shared"]) {
    const path = join(directory, name);
    await mkdir(path);
    git(path, "init", "-b", "main");
    git(path, "config", "commit.gpgsign", "false");
    await writeFile(join(path, "same.ts"), `export const project = "${name}";\n`);
    git(path, "add", "same.ts");
    git(path, "commit", "-m", `${name} initial commit`);
    git(path, "branch", "release");
    await writeFile(join(path, "same.ts"), `export const project = "${name} working";\n`);
    repositories.push(path);
  }
  host = spawn(
    executable ? resolve(executable) : process.execPath,
    [
      ...(executable ? [] : ["dist/cli.js"]),
      ...repositories.slice(0, 2),
      "--no-open",
      "--port",
      "0",
      "--state-dir",
      join(directory, "state"),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_SEARCH_CACHE: join(directory, "search-cache"),
        MED_ZOEKT_BIN:
          process.env.MED_VALIDATION_ZOEKT_BIN ?? join(directory, "no-search-binaries"),
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
    host.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited ${code}: ${errors}`));
    });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  // Quiet chrome, the default, names the checkout in the band above the
  // workspace at once. A workspace that has not shown yet renders out of
  // sight until it is ready, and Med keeps recent workspaces mounted but
  // hidden, so also wait for the review on screen to show the repository.
  const review = (repository, window = page) =>
    window
      .locator('[data-review-status="ready"]:visible')
      .filter({ hasText: `project = "${repository}` });
  const shows = async (repository, branch, window = page) => {
    await window
      .getByRole("banner", { name: "Workspace", exact: true })
      .getByRole("button", { name: `${repository}, ${branch}. Copy path`, exact: true })
      .waitFor();
    await review(repository, window).waitFor();
  };
  const dialog = page.getByRole("dialog", { name: "Open branch" });
  const openBranchPicker = async () => {
    await page.keyboard.press("Meta+Shift+g");
    await dialog.waitFor();
  };
  // A quick ⌃Tab goes back to the workspace shown before.
  const switchWorkspace = async () => {
    await page.keyboard.down("Control");
    await page.keyboard.press("Tab");
    await page.keyboard.up("Control");
  };
  const selectedTab = (name) =>
    page.getByRole("tab", { name, exact: true, selected: true }).filter({ visible: true });
  await page.goto(url);
  await shows("frontend", "main");

  // UI-specific actions below also check request routing through the real host.
  const launch = new URL(url);
  const headers = {
    Authorization: `Bearer ${new URLSearchParams(launch.hash.slice(1)).get("token")}`,
  };
  const catalogue = await fetch(`${launch.origin}/api/repositories`, { headers }).then((r) =>
    r.json(),
  );
  assert.equal(catalogue.repositories.length, 2);
  assert.notEqual(catalogue.repositories[0].id, catalogue.repositories[1].id);
  await openBranchPicker();
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT });
  // ⌘-click opens the branch as a new workspace beside the first one.
  await dialog
    .getByRole("group", { name: "backend", exact: true })
    .getByRole("option")
    .filter({ hasText: "main" })
    .click({ modifiers: ["ControlOrMeta"] });
  await shows("backend", "main");
  assert.equal(await review("frontend").count(), 0);
  // Each workspace keeps its own tab while the other is on screen.
  await page.getByRole("tab", { name: "Commit", exact: true }).filter({ visible: true }).click();
  await selectedTab("Commit").waitFor();
  await switchWorkspace();
  await shows("frontend", "main");
  await selectedTab("Changes").waitFor();
  await switchWorkspace();
  await shows("backend", "main");
  await selectedTab("Commit").waitFor();

  // A click without ⌘ opens a branch of the added repository in the current
  // workspace.
  await openBranchPicker();
  await dialog.getByRole("button", { name: "Add repository…", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Repository path", exact: true }).fill(repositories[2]);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("group", { name: "shared", exact: true }).waitFor();
  await dialog.getByRole("combobox", { name: "Search branches" }).fill("shared release");
  const release = dialog.getByRole("option");
  assert.equal(await release.count(), 1);
  await release.click();
  await shows("shared", "release");

  // Search is scoped to committed content in each repository, even with matching paths.
  for (const path of repositories) {
    const name = path.split("/").at(-1);
    if (process.env.MED_VALIDATION_ZOEKT_BIN) {
      const deadline = Date.now() + 30000;
      while (true) {
        const status = await fetch(
          `${launch.origin}/api/search/status?repo=${encodeURIComponent(path)}`,
          { headers },
        ).then((r) => r.json());
        if (status.state === "ready") break;
        assert.ok(
          Date.now() < deadline,
          `Index did not become ready for ${name}: ${JSON.stringify(status)}`,
        );
        await delay(100);
      }
    }
    const response = await fetch(`${launch.origin}/api/browse/search`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ source: { kind: "worktree", repo: path }, query: name }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source.repo, path);
    assert.equal(result.matches.length, 1);
    if (process.env.MED_VALIDATION_ZOEKT_BIN) assert.equal(result.engine, "zoekt");
  }
  await openBranchPicker();
  await dialog.getByText("Manage repositories", { exact: true }).click();
  await dialog.getByRole("button", { name: "Remove repository shared", exact: true }).click();
  // The workspace on the removed repository moves to another one. The open
  // dialog hides the band from the accessibility tree, not from the screen.
  await page
    .getByRole("banner", { name: "Workspace", exact: true, includeHidden: true })
    .getByRole("button", { name: /^(frontend|backend), main\. Copy path$/, includeHidden: true })
    .waitFor();
  const after = await fetch(`${launch.origin}/api/repositories`, { headers }).then((r) => r.json());
  assert.equal(after.repositories.length, 2);
  assert.equal(git(repositories[2], "branch", "--show-current"), "main");
  for (const name of ["backend", "frontend"])
    await dialog.getByRole("button", { name: `Remove repository ${name}`, exact: true }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Add a repository to start", exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Add a repository to start", exact: true }).waitFor();
  await page.getByRole("button", { name: "Choose repositories", exact: true }).click();
  await dialog.getByRole("button", { name: "Add repository…", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Repository path", exact: true }).fill(repositories[0]);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("group", { name: "frontend", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await shows("frontend", "main");

  // An agent's review reaches both windows. Each lists it as a new tab; with
  // `open`, the window used last shows it.
  const other = await context.newPage();
  other.on("pageerror", (error) => pageErrors.push(error.message));
  await other.goto(url);
  await shows("frontend", "main", other);
  const post = (path, body) =>
    fetch(`${launch.origin}${path}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then((response) => response.json());
  const handoff = await post("/api/reviews", {
    title: "Agent handoff",
    targets: [{ repo: repositories[0], comparison: { kind: "working" } }],
  });
  assert.deepEqual(await post("/api/windows/review", { id: handoff.id }), { windows: 1 });
  for (const window of [page, other])
    await window
      .getByRole("navigation", { name: "Threads" })
      .getByRole("button", { name: /^Agent handoff .*, new$/ })
      .waitFor();
  // A click makes this window the one used last.
  await page.getByRole("tab", { name: "Changes", exact: true }).filter({ visible: true }).click();
  assert.deepEqual(await post("/api/windows/review", { id: handoff.id, open: true }), {
    windows: 1,
  });
  await page.waitForURL(`**/review/${handoff.id}`);
  await page.getByRole("region", { name: "Saved review", exact: true }).waitFor();
  await review("frontend").waitFor();
  assert.ok(!other.url().includes("/review/"));
  await other.close();
  console.log(
    JSON.stringify({
      checks:
        "multi-repo launch, new workspace from the picker, ⌃Tab workspace switching, add/remove, scoped search, empty reload and re-add, agent reviews in two windows",
      repositories: after.repositories.map((repo) => repo.name),
      searchEngine: process.env.MED_VALIDATION_ZOEKT_BIN ? "zoekt" : "git",
      pageErrors,
    }),
  );
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
