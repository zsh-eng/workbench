// Walks first-run setup on the Sources page against the built CLI: the first
// run's route, discovery in a fixture home, one Add, a CLI add that the page
// picks up, the guarded folders, a folder by its path, Add the N recent, the
// hand-off to the app, the login item in Settings, ⌘K's Add sources…, and a
// phone-sized window. The login item is written inside the fixture home only.
// Set MED_VALIDATION_SCREENSHOTS to a directory to keep a screenshot of each
// step.
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
import { removeGitEnvironment } from "./git-environment.mjs";
import { useFakeGh } from "./fake-gh.mjs";

removeGitEnvironment();
// Med must never reach GitHub here: gh is a stand-in (scripts/fake-gh.mjs).
const fakeGh = useFakeGh();

const exec = promisify(execFile);
const dir = await realpath(await mkdtemp(join(tmpdir(), "med-setup-check-")));
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
  if (shots) await page.screenshot({ path: join(shots, `setup-${name}.png`) });
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
        a: { path: research, ts: Date.now() - 6 * DAY },
        b: { path: notes, ts: Date.now() - DAY / 12 },
        gone: { path: join(home, "Missing"), ts: Date.now() },
      },
    }),
  );

  const url = await run("web", "--no-open");
  const origin = new URL(url).origin;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // A server with nothing registered opens on Sources, with what Med found.
  await page.goto(`${origin}/${new URL(url).hash}`);
  await page.waitForURL("**/sources");
  await page.getByRole("heading", { name: "Sources", level: 1 }).waitFor();
  const found = page.getByRole("region", { name: "Found on this computer" });
  const registered = page.getByRole("list", { name: "Sources" });
  await found.getByRole("listitem").first().waitFor();
  assert.equal(await registered.count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "Add sources…" }).getAttribute("aria-expanded"),
    "true",
  );

  // Most recent first, repositories and vaults together, with worktrees,
  // dependencies, and Documents left out.
  const rows = (list) =>
    list.getByRole("listitem").evaluateAll((items) =>
      items.map((item) => ({
        name: item.querySelector('[data-row="name"]')?.textContent,
        place: item.querySelector('[data-row="path"]')?.textContent,
        branch: item.querySelector('[data-row="branch"]')?.textContent ?? "",
      })),
    );
  const names = async (list) => (await rows(list)).map((row) => row.name);
  assert.deepEqual(await rows(found), [
    { name: "med", place: "~/code", branch: "main" },
    { name: "Notes", place: "~/Notes", branch: "" },
    { name: "reader", place: "~/code", branch: "feature/sync" },
    { name: "app", place: "~/code", branch: "main" },
    { name: "Research", place: "iCloud › Obsidian", branch: "" },
    { name: "spaced", place: "~/Developer", branch: "main" },
  ]);
  await found.getByRole("button", { name: "Show 1 more" }).click();
  assert.deepEqual((await names(found)).slice(6), ["old-blog"]);
  await found.getByRole("button", { name: "Add the 6 recent" }).waitFor();
  await shoot(page, "1-first-run");

  // The page stays usable on a phone-sized window: nothing scrolls sideways,
  // a row's place is under its name, and Add is a finger's target.
  const narrow = await context.newPage();
  narrow.on("pageerror", (error) => pageErrors.push(error.message));
  await narrow.setViewportSize({ width: 390, height: 844 });
  await narrow.goto(`${origin}/sources`);
  const narrowFound = narrow.getByRole("region", { name: "Found on this computer" });
  await narrowFound.getByRole("listitem").first().waitFor();
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `The narrow page must not scroll sideways (${overflow}px)`);
  const layout = await narrowFound
    .getByRole("listitem")
    .first()
    .evaluate((item) => {
      const box = (selector) => item.querySelector(selector).getBoundingClientRect();
      const name = box('[data-row="name"]');
      const place = box('[data-row="path"]');
      const button = item.querySelector("button");
      const add = button.getBoundingClientRect();
      const x = add.left + add.width / 2;
      const middle = add.top + add.height / 2;
      // The target reaches past the button that shows.
      const hit = (y) => document.elementFromPoint(x, y)?.closest("button") === button;
      return {
        stacked: place.top >= name.bottom - 1,
        right: innerWidth - add.right,
        clear: add.left >= Math.max(name.right, place.right),
        target: hit(middle - 20) && hit(middle + 19),
      };
    });
  assert.deepEqual(layout, { stacked: true, right: 16, clear: true, target: true });
  await shoot(narrow, "2-narrow");
  await narrow.close();

  // Leaving with nothing registered shows the app's own empty page. A source
  // added meanwhile with the CLI is on Sources at the next visit, under the
  // fixture home, and the section stays closed: a visit does not search.
  await page.keyboard.press("Escape");
  await page.waitForURL((address) => address.pathname === "/");
  await page.getByRole("heading", { name: "Add a repository to start" }).waitFor();
  await run("add", join(home, "Projects", "old-blog"));
  await page.goBack();
  await page.waitForURL("**/sources");
  await registered.getByText("old-blog", { exact: true }).waitFor();
  assert.deepEqual(await rows(registered), [{ name: "old-blog", place: "~/Projects", branch: "" }]);
  assert.equal(await found.count(), 0);

  // The app beneath learned of its first repository: it shows the review now.
  await page.keyboard.press("Escape");
  await page.waitForURL((address) => address.pathname === "/");
  await page.locator('[data-review-status="ready"]:visible').waitFor();
  await page.goBack();
  await page.waitForURL("**/sources");

  // Add sources… shows the section and gives it the focus.
  await page.getByRole("button", { name: "Add sources…" }).click();
  await found.getByRole("listitem").first().waitFor();
  assert.equal(await found.evaluate((section) => section === document.activeElement), true);
  assert.ok(!(await names(found)).includes("old-blog"));

  // One click adds one source: its row leaves for the list above.
  await found.getByRole("button", { name: "Add app" }).click();
  await registered.getByText("app", { exact: true }).waitFor();
  assert.deepEqual(await names(registered), ["app", "old-blog"]);
  assert.ok(!(await names(found)).includes("app"));
  const listed = async () =>
    JSON.parse(await run("list", "--json"))
      .map((source) => source.path)
      .sort();
  assert.deepEqual(await listed(), [join(home, "Projects", "old-blog"), join(home, "code", "app")]);

  // A source added with the CLI moves to the list above when the window gets focus.
  await run("add", join(home, "Developer", "spaced"));
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await registered.getByText("spaced", { exact: true }).waitFor();
  assert.ok(!(await names(found)).includes("spaced"));

  // Desktop, Documents, and Downloads are searched on request.
  await found.getByText("Not searched: Desktop, Documents, and Downloads.").waitFor();
  await found.getByRole("button", { name: "Search them too" }).click();
  await found.getByText("thesis", { exact: true }).waitFor();
  assert.equal(await found.getByText("Not searched").count(), 0);

  // A folder by its path: ~/ is the home folder, and a wrong path says why.
  const field = found.getByRole("textbox", { name: "Add a folder by path" });
  await field.fill("~/nowhere");
  await field.press("Enter");
  await found.getByRole("alert").getByText("This folder does not exist.").waitFor();
  await field.fill("~/Documents/thesis");
  await field.press("Enter");
  await registered.getByText("thesis", { exact: true }).waitFor();
  assert.equal(await field.inputValue(), "");
  assert.equal(await found.getByRole("alert").count(), 0);
  assert.ok(!(await names(found)).includes("thesis"));
  await shoot(page, "3-some-added");

  // Add the N recent adds those used lately, in turn, and nothing is left to find.
  await found.getByRole("button", { name: "Add the 4 recent" }).click();
  await found.getByText("No other repositories or vaults found in your home folder.").waitFor();
  assert.deepEqual(await names(registered), [
    "app",
    "med",
    "Notes",
    "old-blog",
    "reader",
    "Research",
    "spaced",
    "thesis",
  ]);
  assert.deepEqual(
    await listed(),
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
  await shoot(page, "4-all-added");

  // A repository's row opens its review, and the browser remembers that Med
  // has sources: the start address stays the app's.
  await registered.getByText("med", { exact: true }).click();
  await page.waitForURL((address) => address.pathname === "/");
  await page.locator('[data-review-status="ready"]:visible').waitFor();
  await page.reload();
  await page.locator('[data-review-status="ready"]:visible').waitFor();
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await page.evaluate(() => localStorage.getItem("med:welcomed")), "1");

  // Open at login is in Settings. The login item goes to the fixture home's
  // LaunchAgents and nowhere else.
  await page.goto(`${origin}/settings/sources`);
  const agents = join(home, "Library", "LaunchAgents");
  if (process.platform === "darwin") {
    const toggle = page.getByRole("switch", { name: "Open at login" });
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[role="switch"][aria-label="Open at login"]')?.ariaChecked ===
        "true",
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
    await shoot(page, "5-settings");
    await toggle.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[role="switch"][aria-label="Open at login"]')?.ariaChecked ===
        "false",
    );
    assert.deepEqual(await readdir(agents), []);
  }

  // ⌘K's Add sources… opens Sources on what Med found, and leaves the address plain.
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Add sources");
  await page.keyboard.press("Enter");
  await page.waitForURL((address) => address.pathname === "/sources");
  await found.waitFor();
  assert.equal(await found.evaluate((section) => section === document.activeElement), true);
  assert.equal(new URL(page.url()).search, "");

  // No gh call went past the stand-in.
  fakeGh.check();
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "first-run-route",
        "discovery-order-and-exclusions",
        "icloud-vault-paths",
        "narrow-layout",
        "cli-add-while-away",
        "first-source-reaches-the-app",
        "add-sources-toggle",
        "add-one",
        "cli-add-on-focus",
        "guarded-folders-on-request",
        "add-by-path",
        "add-the-recent",
        "hand-off-to-app",
        "login-item-in-fixture-home",
        "palette-add-sources",
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
