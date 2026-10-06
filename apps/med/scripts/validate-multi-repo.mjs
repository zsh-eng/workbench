import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { chromium } from "playwright";

// Exercise the built CLI, host and browser together against isolated Git repositories.
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
    process.execPath,
    [
      "dist/cli.js",
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url);
  await page.locator('[data-review-status="ready"]').waitFor();
  await page.getByRole("option").filter({ hasText: "frontend initial commit" }).waitFor();

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
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  if (process.env.MED_VALIDATION_SCREENSHOT)
    await page.screenshot({ path: process.env.MED_VALIDATION_SCREENSHOT });
  const dialog = page.getByRole("dialog", { name: "Open branch" });
  await dialog
    .getByRole("group", { name: "backend", exact: true })
    .getByRole("option")
    .filter({ hasText: "main" })
    .click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await page.getByRole("option").filter({ hasText: "backend initial commit" }).waitFor();
  assert.equal(
    await page.getByRole("option").filter({ hasText: "frontend initial commit" }).count(),
    0,
  );
  const backendCommit = page.getByRole("option").filter({ hasText: "backend initial commit" });
  await backendCommit.click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await page.getByRole("tab", { name: /^frontend \/ main/ }).click();
  await page.getByRole("option").filter({ hasText: "frontend initial commit" }).waitFor();
  await page.getByRole("tab", { name: /^backend \/ main/ }).click();
  await backendCommit.waitFor();
  assert.equal(await backendCommit.getAttribute("aria-selected"), "true");

  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await dialog.getByRole("button", { name: "Add repository…", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Repository path", exact: true }).fill(repositories[2]);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await dialog.getByRole("group", { name: "shared", exact: true }).waitFor();
  await dialog.getByRole("combobox", { name: "Search branches" }).fill("shared release");
  const release = dialog.getByRole("option");
  assert.equal(await release.count(), 1);
  await release.click();
  await page.getByRole("option").filter({ hasText: "shared initial commit" }).waitFor();
  await page.locator('[data-review-status="ready"]').waitFor();

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
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await dialog.getByText("Manage repositories", { exact: true }).click();
  await dialog.getByRole("button", { name: "Remove repository shared", exact: true }).click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('[role="tab"]')].some((tab) =>
        tab.textContent.includes("shared /"),
      ),
  );
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
  await page.getByRole("option").filter({ hasText: "frontend initial commit" }).waitFor();
  console.log(
    JSON.stringify({
      checks:
        "multi-repo launch, picker selection, commit restoration, add/remove, scoped search, empty reload and re-add",
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
