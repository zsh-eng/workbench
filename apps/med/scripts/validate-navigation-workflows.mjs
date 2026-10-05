import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const longPath =
    "src/main/java/com/example/services/platform/integration/network/internal/ConcurrentHashMapSynchronizationController.java";
  const repositories = [];
  for (const name of ["frontend", "backend service", "unregistered"]) {
    const path = join(directory, name);
    await mkdir(path);
    git(path, "init", "-b", "main");
    git(path, "config", "commit.gpgsign", "false");
    await writeFile(join(path, "same.ts"), `export const project = "${name}";\n`);
    await mkdir(join(path, "src", "test", "java"), { recursive: true });
    await mkdir(join(path, "docs"));
    await mkdir(join(path, longPath, ".."), { recursive: true });
    await writeFile(join(path, longPath), "class Controller {}\n");
    for (const [file, contents] of Object.entries({
      "src/test/java/Payment Test.java": "class PaymentTest {}\n",
      "src/Contest.java": "class Contest {}\n",
      "src/testimony.ts": "export const testimony = true;\n",
      "src/main.spec.ts": "export const spec = true;\n",
      "docs/Notes here.md": "# Notes\n",
      "long.ts": Array.from(
        { length: 180 },
        (_, i) => `export const line${i + 1} = ${i + 1};`,
      ).join("\n"),
    }))
      await writeFile(join(path, file), contents);
    git(path, "add", ".");
    git(path, "commit", "-m", `${name} initial commit`);
    git(path, "branch", "release");
    await writeFile(join(path, "same.ts"), `export const project = "${name} working";\n`);
    await writeFile(join(path, longPath), "class Controller { int version = 2; }\n");
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

  const original = await Promise.all(
    repositories.map((repo) => readFile(join(repo, "same.ts"), "utf8")),
  );
  const originalDiffs = repositories.map((repo) => git(repo, "diff", "--binary"));
  const listed = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/api/browse/list")) listed.push(request.postDataJSON().source.repo);
  });
  const picker = page.getByRole("dialog", { name: "Find file" });
  const input = page.getByRole("combobox", { name: "Find file" });
  const openPicker = async () => {
    await page.keyboard.press("Meta+Shift+k");
    await input.waitFor();
  };
  await openPicker();
  await input.fill("bksrv type:tests ext:java");
  await picker.getByRole("option", { name: /Repository backend service/ }).waitFor();
  await page.keyboard.press("Tab");
  await picker.getByRole("button", { name: "Back to current repository" }).waitFor();
  assert.equal(await input.inputValue(), "type:tests ext:java");
  assert.match(
    await picker.getByRole("button", { name: "Back to current repository" }).innerText(),
    /backend service/,
  );
  await picker.getByRole("option", { name: /Payment Test.java/ }).waitFor();
  assert.equal(await picker.getByRole("option").count(), 1);
  assert.equal(await picker.locator('[title="Test file"]').count(), 1);
  await picker.screenshot({ path: "/private/tmp/med-scoped-picker.png" });
  await input.fill("type:tests ext:java Payment Test.java");
  await page.keyboard.press("Enter");
  await page
    .getByRole("textbox", { name: "Edit src/test/java/Payment Test.java", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("tab", { name: /frontend.*main/ }).getAttribute("aria-selected"),
    "true",
  );
  assert.ok(listed.some((repo) => repo === repositories[1]));
  assert.ok(listed.every((repo) => repositories.slice(0, 2).includes(repo)));

  // Reopen from the editor, then back out of a repo scope without losing focus.
  await openPicker();
  await input.fill("backend service");
  await page.keyboard.press("Tab");
  await input.fill("");
  await page.keyboard.press("Backspace");
  await picker.getByRole("button", { name: "Choose repository" }).waitFor();
  assert.equal(await input.evaluate((element) => document.activeElement === element), true);
  await input.fill("unregistered");
  assert.equal(await picker.getByRole("option", { name: /Repository/ }).count(), 0);
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Edit src/test/java/Payment Test.java", exact: true })
    .waitFor();

  assert.equal(
    await page
      .getByRole("textbox", { name: "Edit src/test/java/Payment Test.java", exact: true })
      .evaluate((element) => document.activeElement === element),
    true,
  );

  // Categories are ORed; extensions are ANDed. Ordinary names are not tests.
  await openPicker();
  await input.fill("type:code type:docs ext:java,md");
  await picker.getByRole("option", { name: /Contest.java/ }).waitFor();
  assert.equal(await picker.getByRole("option").count(), 3);
  await picker.getByRole("button", { name: "Docs", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"] [role="option"]').length === 2,
  );
  await picker.getByRole("option", { name: /Contest.java/ }).waitFor();
  await picker.getByRole("button", { name: "Remove .java filter", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelectorAll('[role="dialog"] [role="option"]').length === 0,
  );
  await picker.getByRole("button", { name: "Clear filters", exact: true }).click();
  await input.fill("testimony.ts");
  await picker.getByRole("option", { name: /testimony.ts/ }).waitFor();
  assert.equal(await picker.locator('[title="Test file"]').count(), 0);
  await input.fill("type:docs Notes here.md");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Edit docs/Notes here.md", exact: true }).waitFor();

  // Same filename in separate repos remains separate tabs and retains its bytes.
  await openPicker();
  await input.fill("same.ts");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Edit same.ts", exact: true }).waitFor();
  await page.getByRole("tab", { name: "same.ts", exact: true }).dblclick();
  await openPicker();
  await input.fill("backend service");
  await page.keyboard.press("Tab");
  await input.fill("same.ts");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("backend service working"),
  );
  assert.equal(await page.getByRole("tab", { name: /same.ts$/ }).count(), 2);
  await page.getByRole("tab", { name: /frontend.*same.ts$/ }).click();
  await page.waitForFunction(() =>
    document.querySelector(".cm-content")?.textContent?.includes("frontend working"),
  );

  // Cursor stays on the same glyph while scroll coordinates change.
  await openPicker();
  await input.fill("long.ts");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Edit long.ts", exact: true }).waitFor();
  await page.keyboard.type("40G");
  await page.waitForTimeout(150);
  const motion = await page.evaluate(async () => {
    const scroller = document.querySelector(".cm-scroller");
    const values = [];
    for (let i = 0; i < 8; i++) {
      scroller.scrollTop += 7;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const row = [...document.querySelectorAll(".cm-line")].find(
        (line) => line.textContent === "export const line40 = 40;",
      );
      const caret = document.querySelector(".cm-fat-cursor");
      if (row && caret)
        values.push(caret.getBoundingClientRect().top - row.getBoundingClientRect().top);
    }
    return values;
  });
  assert.equal(motion.length, 8);
  assert.ok(Math.max(...motion) - Math.min(...motion) < 1.5, JSON.stringify(motion));

  // Slash belongs to the diff, and to text inputs while a palette is open.
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.keyboard.press("/");
  const find = page.getByRole("textbox", { name: "Find in diff contents" });
  await find.waitFor();
  await find.fill("working");
  await page.keyboard.press("Escape");
  await openPicker();
  await input.fill("/");
  assert.equal(await input.inputValue(), "/");
  assert.equal(await find.count(), 0);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 900, height: 800 });
  const longLink = page.getByRole("link", { name: longPath, exact: true });
  await longLink.scrollIntoViewIfNeeded();
  const filenameVisible = await longLink.evaluate((link) => {
    const name = link.lastElementChild;
    return (
      name.scrollWidth <= name.clientWidth + 1 &&
      name.getBoundingClientRect().right <= link.getBoundingClientRect().right + 1
    );
  });
  assert.ok(filenameVisible, "Keep the full basename visible before directory components");
  await longLink.screenshot({ path: "/private/tmp/med-long-filename.png" });

  assert.deepEqual(
    await Promise.all(repositories.map((repo) => readFile(join(repo, "same.ts"), "utf8"))),
    original,
  );
  assert.deepEqual(
    repositories.map((repo) => git(repo, "diff", "--binary")),
    originalDiffs,
  );
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: "/private/tmp/med-navigation-workflows.png" });
  console.log(
    JSON.stringify({
      checks:
        "fuzzy repo Tab, spaces, filters, test icons, back/Escape/focus, cross-repo tabs, unchanged files, cursor scroll geometry, diff slash contexts",
      cursorOffsets: motion,
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
