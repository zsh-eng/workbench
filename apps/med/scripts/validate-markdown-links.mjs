import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { chromium } from "playwright";
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-markdown-links-")));
const repo = join(directory, "repo");
const app = resolve(import.meta.dirname, "..");
let host, browser, page;
try {
  await mkdir(join(repo, "docs"), { recursive: true });
  const markdown =
    "# Links\n\n[Samples](samples%20data.json?raw=1#L2)\n\n[Parent](../root.txt)\n\n[Missing](missing.json)\n\n[Escape](../../outside.txt)\n\n[External](https://example.com/)\n\n[Unsafe](javascript:alert%281%29)\n";
  await writeFile(join(repo, "docs", "note.md"), markdown);
  await writeFile(join(repo, "docs", "samples data.json"), '{\n  "version": "committed"\n}\n');
  await writeFile(join(repo, "root.txt"), "parent content\n");
  await writeFile(join(directory, "outside.txt"), "outside repository\n");
  const git = (...args) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { cwd: repo, encoding: "utf8" },
    ).trim();
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-qm", "Markdown fixture");
  const oid = git("rev-parse", "HEAD");
  git("branch", "snapshot", oid);
  await writeFile(join(repo, "docs", "samples data.json"), '{\n  "version": "working"\n}\n');
  const binary = process.env.MED_EXECUTABLE;
  host = spawn(
    binary ? resolve(binary) : process.execPath,
    [
      ...(binary ? [] : [join(app, "dist/cli.js")]),
      repo,
      "--port",
      "0",
      "--state-dir",
      join(directory, "state"),
      "--no-open",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const launch = await new Promise((done, fail) => {
    let output = "";
    const timer = setTimeout(() => fail(new Error("Host startup timed out")), 30000);
    host.once("exit", () => {
      clearTimeout(timer);
      fail(new Error("Host exited"));
    });
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        done(match[0]);
      }
    });
  });
  const origin = new URL(launch).origin;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(launch);
  await page.goto(`${origin}/file?${new URLSearchParams({ repo, path: "docs/note.md" })}`);
  const showPreview = async () => {
    const button = page.getByRole("button", { name: "Toggle Markdown preview", exact: true });
    await button.waitFor();
    if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
    await page.getByRole("link", { name: "Samples", exact: true }).waitFor();
  };
  await showPreview();
  await page.keyboard.press("Meta+Shift+b");
  const filesSidebar = page.getByRole("complementary", { name: "Workspace files", exact: true });
  await filesSidebar.waitFor();
  const sidebarBox = await filesSidebar.boundingBox();
  const mainBox = await page
    .getByRole("main", { name: "Continuous review", exact: true })
    .boundingBox();
  assert.ok(
    mainBox.x + mainBox.width <= sidebarBox.x + 1,
    "File sidebar must stay right of the main view",
  );
  await filesSidebar.getByRole("button", { name: "Refresh files", exact: true }).focus();
  await page.keyboard.press("Meta+Shift+v");
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.keyboard.press("Meta+Shift+v");
  await page.getByRole("link", { name: "Samples", exact: true }).waitFor();
  await page.getByRole("tab", { name: "note.md", exact: true }).focus();
  await page.keyboard.press("Meta+Shift+v");
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.keyboard.press("Meta+Shift+v");
  await page.keyboard.press("Meta+k");
  const commandInput = page.getByRole("combobox", { name: "Search commands", exact: true });
  await commandInput.fill("theme");
  await page.keyboard.press("Meta+Shift+v");
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.keyboard.press("Control+Shift+v");
  await page.locator(".med-md-prose h1").waitFor();
  assert.equal(await commandInput.inputValue(), "theme");
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByRole("link", { name: "External", exact: true }).getAttribute("href"),
    "https://example.com/",
  );
  assert.equal(await page.getByRole("link", { name: "Unsafe", exact: true }).count(), 0);
  const readResponse = () =>
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/browse/read" && r.request().method() === "POST",
    );
  let [response] = await Promise.all([
    readResponse(),
    page.getByRole("link", { name: "Samples", exact: true }).click(),
  ]);
  let file = await response.json();
  assert.equal(file.path, "docs/samples data.json");
  assert.equal(file.source.kind, "worktree");
  assert.match(file.text, /working/);
  await page.getByRole("tab", { name: "samples data.json", exact: true }).waitFor();
  await page.getByRole("tab", { name: "note.md", exact: true }).click();
  await showPreview();
  [response] = await Promise.all([
    readResponse(),
    page.getByRole("link", { name: "Parent", exact: true }).click(),
  ]);
  assert.equal((await response.json()).path, "root.txt");
  await page.getByRole("tab", { name: "note.md", exact: true }).click();
  await showPreview();
  await page.getByRole("link", { name: "Escape", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "leaves the current file source" }).waitFor();
  [response] = await Promise.all([
    readResponse(),
    page.getByRole("link", { name: "Missing", exact: true }).click(),
  ]);
  assert.equal((await response.json()).kind, "missing");
  // A branch with no worktree must keep links pinned to its displayed commit.
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill("snapshot");
  await page.getByRole("dialog", { name: "Open branch" }).getByRole("option").click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await page.keyboard.press("Meta+Shift+k");
  await page.getByRole("combobox", { name: "Find file", exact: true }).fill("note.md");
  await page.keyboard.press("Enter");
  await showPreview();
  [response] = await Promise.all([
    readResponse(),
    page.getByRole("link", { name: "Samples", exact: true }).click(),
  ]);
  file = await response.json();
  assert.equal(file.source.kind, "commit");
  assert.equal(file.source.oid, oid);
  assert.match(file.text, /committed/);
  // Explicit standalone files use the local file tabs and resolve from their folder.
  const doc = join(repo, "docs", "note.md");
  await page.goto(`${origin}/file${doc.split("/").map(encodeURIComponent).join("/")}`);
  await showPreview();
  await page.getByRole("tab", { name: "note.md", exact: true }).focus();
  await page.keyboard.press("Meta+Shift+v");
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.keyboard.press("Meta+Shift+v");
  await page.getByRole("link", { name: "Samples", exact: true }).click();
  await page.getByRole("tab", { name: "samples data.json", exact: true }).waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /working/);
  await page.getByRole("tab", { name: "note.md", exact: true }).click();
  await showPreview();
  await page.getByRole("link", { name: "Parent", exact: true }).click();
  await page.getByRole("tab", { name: "root.txt", exact: true }).waitFor();
  assert.match(await page.locator(".cm-content").innerText(), /parent content/);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      standalone: !!binary,
      checks: [
        "right-file-sidebar",
        "preview-shortcut-from-tree-tabs-and-palette",
        "working-file-links",
        "commit-source-preserved",
        "standalone-file-tabs",
        "encoded-names",
        "parent-paths",
        "missing-file",
        "root-boundary",
        "external-and-unsafe-links",
      ],
    }),
  );
} catch (error) {
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 3500));
    await page.screenshot({ path: "/private/tmp/med-markdown-links-failure.png" });
  }
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const stopped = once(host, "exit");
    host.kill();
    await stopped;
  }
  await rm(directory, { recursive: true, force: true });
}
