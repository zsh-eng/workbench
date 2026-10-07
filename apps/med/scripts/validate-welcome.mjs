// Walks the first-run welcome against the built CLI: discovery in a fixture
// home, a CLI add that the page picks up, the login item, adding the
// selection, and the hand-off to the app. The login item is
// written inside the fixture home only. Set MED_VALIDATION_SCREENSHOTS to a
// directory to keep a screenshot of each step.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const exec = promisify(execFile);
const dir = await realpath(await mkdtemp(join(tmpdir(), "med-welcome-check-")));
const home = join(dir, "home");
const state = join(dir, "state");
const socket = createServer();
await new Promise((done) => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise((done) => socket.close(done));
const app = resolve(import.meta.dirname, "..");
const binary = process.env.MED_EXECUTABLE;
const env = { ...process.env, MED_HOME_DIR: home };
const run = async (...args) =>
  (
    await exec(
      binary ? resolve(binary) : process.execPath,
      [
        ...(binary ? [] : [join(app, "dist/cli.js")]),
        ...args,
        "--state-dir",
        state,
        "--port",
        String(port),
      ],
      { cwd: dir, env, timeout: 30000 },
    )
  ).stdout.trim();
const shots = process.env.MED_VALIDATION_SCREENSHOTS;
const shoot = async (page, name) => {
  if (shots) await page.screenshot({ path: join(shots, `welcome-${name}.png`) });
};
const git = (cwd, ...args) =>
  exec("git", [
    "-C",
    cwd,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    ...args,
  ]);
const DAY = 86_400_000;
async function repository(path, days, branch = "main") {
  await mkdir(path, { recursive: true });
  await exec("git", ["init", "-q", "-b", branch, path]);
  await writeFile(join(path, "README.md"), "# Fixture\n");
  await git(path, "add", ".");
  await git(path, "commit", "-qm", "initial");
  const when = new Date(Date.now() - days * DAY);
  for (const file of ["index", "HEAD", "logs/HEAD"])
    await utimes(join(path, ".git", file), when, when);
}

let browser;
try {
  await repository(join(home, "code", "med"), 0.01);
  await repository(join(home, "code", "reader"), 0.2, "feature/sync");
  await repository(join(home, "code", "app"), 5);
  await repository(join(home, "Developer", "spaced"), 9);
  await repository(join(home, "Projects", "old-blog"), 400, "master");
  // Left out: a linked worktree, a dependency checkout, and a guarded folder.
  await git(
    join(home, "code", "reader"),
    "worktree",
    "add",
    "-q",
    join(home, "code", "reader-sync"),
  );
  await repository(join(home, "code", "site", "node_modules", "dep"), 0.1);
  await repository(join(home, "Documents", "thesis"), 1);
  const notes = join(home, "Notes");
  await mkdir(join(notes, ".obsidian"), { recursive: true });
  await writeFile(join(notes, "Today.md"), "# Today\n");
  const research = join(
    home,
    "Library",
    "Mobile Documents",
    "iCloud~md~obsidian",
    "Documents",
    "Research",
  );
  await mkdir(join(research, ".obsidian"), { recursive: true });
  await writeFile(join(research, "Ideas.md"), "# Ideas\n");
  const obsidian = join(home, "Library", "Application Support", "obsidian");
  await mkdir(obsidian, { recursive: true });
  await writeFile(
    join(obsidian, "obsidian.json"),
    JSON.stringify({
      vaults: {
        a: { path: research, ts: Date.now() - 5 * DAY },
        b: { path: notes, ts: Date.now() - DAY / 12 },
        gone: { path: join(home, "Missing"), ts: Date.now() },
      },
    }),
  );

  const url = await run("web", "--no-open");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // A server with nothing registered opens the welcome, drawn over the shader.
  await page.goto(url);
  await page.waitForURL("**/welcome");
  await page.getByRole("heading", { name: "Welcome to Med" }).waitFor();
  await page.locator('canvas[data-field="on"]').waitFor();

  // Recent repositories first, with worktrees, dependencies, and Documents left out.
  const rows = (kind) =>
    page.locator(`[data-sources="${kind}"] li label`).evaluateAll((labels) =>
      labels.map((label) => ({
        name: label.querySelector('[data-row="name"]')?.textContent,
        shown: label.querySelector('[data-row="path"]')?.textContent,
        branch: label.querySelector('[data-row="branch"]')?.textContent ?? "",
        checked: label.querySelector("input").checked,
      })),
    );
  await page.locator('[data-sources="repo"] li').first().waitFor();
  const repos = await rows("repo");
  assert.deepEqual(
    repos.map((row) => [row.name, row.checked]),
    [
      ["med", true],
      ["reader", true],
      ["app", true],
      ["spaced", true],
      ["old-blog", false],
    ],
  );
  assert.deepEqual([repos[1].shown, repos[1].branch], ["~/code/reader", "feature/sync"]);
  const vaults = await rows("vault");
  assert.deepEqual(
    vaults.map((row) => [row.name, row.shown, row.checked]),
    [
      ["Notes", "~/Notes", true],
      ["Research", "iCloud › Obsidian › Research", true],
    ],
  );
  await page.getByText("Not searched: Desktop, Documents, and Downloads.").waitFor();
  await page.getByRole("button", { name: "Search them too" }).click();
  await page.locator('[data-sources="repo"] li', { hasText: "thesis" }).waitFor();
  assert.equal((await rows("repo")).find((row) => row.name === "thesis")?.checked, true);
  // A click clears a selection and another sets it again.
  const appRow = page.locator('[data-sources="repo"] label', { hasText: "~/code/app" });
  await appRow.click();
  assert.equal(await appRow.locator("input").isChecked(), false);
  await appRow.click();
  assert.equal(await appRow.locator("input").isChecked(), true);
  await page.waitForTimeout(2800);
  await shoot(page, "1-setup");

  // A source added with the CLI shows as added when the window gets focus again.
  await run("add", join(home, "Projects", "old-blog"));
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-sources="repo"] label[title$="/old-blog"]')?.dataset.state ===
      "added",
  );

  // The login item goes to the fixture home's LaunchAgents and nowhere else.
  const agents = join(home, "Library", "LaunchAgents");
  if (process.platform === "darwin") {
    const toggle = page.getByRole("switch", { name: "Open at login" });
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true",
    );
    const [plist] = await readdir(agents);
    assert.match(plist, /^local\.med\.[0-9a-f]{12}\.plist$/);
    const text = await readFile(join(agents, plist), "utf8");
    assert.ok(
      text.includes(`<string>serve</string><string>--state-dir</string><string>${state}</string>`),
    );
    assert.deepEqual(JSON.parse(await run("service", "login", "status")), {
      available: true,
      enabled: true,
    });
    await toggle.click();
    await page.waitForFunction(
      () => document.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "false",
    );
    assert.deepEqual(await readdir(agents), []);
  }

  // Adding the selection finishes the setup.
  await page.getByRole("button", { name: "Add 7 sources" }).click();
  await page.getByRole("heading", { name: "You're all set" }).waitFor();
  await page.getByText("6 repositories and 2 vaults are ready to review.").waitFor();
  const listed = JSON.parse(await run("list"))
    .map((source) => source.path)
    .sort();
  assert.deepEqual(
    listed,
    [
      join(home, "Developer", "spaced"),
      join(home, "Documents", "thesis"),
      notes,
      join(home, "Projects", "old-blog"),
      join(home, "code", "app"),
      join(home, "code", "med"),
      join(home, "code", "reader"),
      research,
    ].sort(),
  );
  await page.waitForTimeout(1500);
  await shoot(page, "2-done");
  await page.getByRole("button", { name: "Open Med" }).click();
  await page.waitForURL((address) => address.pathname === "/");
  await page.locator('[data-review-status="ready"]:visible').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("med:welcomed")), "1");
  await page.reload();
  await page.locator('[data-review-status="ready"]:visible').waitFor();
  assert.equal(new URL(page.url()).pathname, "/");

  // The welcome stays usable on a phone-sized window.
  const narrow = await context.newPage();
  narrow.on("pageerror", (error) => pageErrors.push(error.message));
  await narrow.setViewportSize({ width: 390, height: 844 });
  await narrow.goto(new URL("/welcome", url).href);
  await narrow.getByRole("heading", { name: "Welcome to Med" }).waitFor();
  await narrow.locator('[data-sources="repo"] li').first().waitFor();
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `The narrow setup must not scroll sideways (${overflow}px)`);
  await narrow.waitForTimeout(800);
  await shoot(narrow, "3-narrow");

  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "first-run-route-and-shader",
        "discovery-order-and-exclusions",
        "icloud-vault-paths",
        "guarded-folders-on-request",
        "cli-add-on-focus",
        "login-item-in-fixture-home",
        "add-selection",
        "hand-off-to-app",
        "narrow-layout",
      ],
      pageErrors,
    }),
  );
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  await run("stop").catch(() => {});
  await rm(dir, { recursive: true, force: true });
}
