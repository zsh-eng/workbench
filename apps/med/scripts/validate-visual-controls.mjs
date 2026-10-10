import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";
const phase = process.env.MED_VISUAL_BASELINE ? "before" : "after";
const out = process.env.MED_VISUAL_OUTPUT || "/private/tmp/med-visual-refresh";
await mkdir(out, { recursive: true });
const root = await mkdtemp("/private/tmp/med-design-fixture-");
const repo = root + "/workspace";
await mkdir(repo);
await writeFile(
  repo + "/README.md",
  "# A calmer workspace\n\nOpen a file, review a change, or run a command.\n\n## Small details matter\n\nConsistent spacing makes a dense interface easier to read.\n\n- Keep the important actions close.\n- Make keyboard shortcuts visible.\n- Let the content lead.\n",
);
await writeFile(
  repo + "/navigation.ts",
  "export function openFile(path: string) {\n  return { path, active: true };\n}\n",
);
execFileSync("git", ["init", "-qb", "main", repo]);
execFileSync("git", ["-C", repo, "add", "."]);
execFileSync("git", [
  "-C",
  repo,
  "-c",
  "user.name=Med",
  "-c",
  "user.email=med@example.invalid",
  "-c",
  "commit.gpgsign=false",
  "commit",
  "-qm",
  "Polish file navigation",
]);
await writeFile(
  repo + "/navigation.ts",
  "export function openFile(path: string) {\n  return { path, active: true, preview: false };\n}\n",
);
const host = spawn(
  process.env.MED_EXECUTABLE || process.execPath,
  [
    ...(process.env.MED_EXECUTABLE ? [] : [resolve("dist/cli.js")]),
    repo,
    "--port",
    "0",
    "--no-open",
    "--state-dir",
    root + "/state",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let browser;
try {
  const url = await new Promise((ok, fail) => {
    let text = "";
    const timeout = setTimeout(() => fail(new Error("Host did not start")), 30000);
    host.once("error", (error) => {
      clearTimeout(timeout);
      fail(error);
    });
    host.stdout.on("data", (d) => {
      text += d;
      const m = text.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (m) {
        clearTimeout(timeout);
        ok(m[0]);
      }
    });
    host.once("exit", (c) => {
      clearTimeout(timeout);
      fail(Error("Host " + c));
    });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.getByText("Working changes", { exact: true }).first().waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({
    path: out + "/" + phase + "-review.png",
    clip: { x: 0, y: 0, width: 1280, height: 215 },
  });
  if (phase === "after") {
    await page.getByRole("button", { name: "Push", exact: true }).click();
    const pushDialog = page.getByRole("dialog");
    await pushDialog.waitFor();
    assert.equal(
      await pushDialog
        .getByRole("button", { name: "Cancel", exact: true })
        .evaluate((e) => getComputedStyle(e).fontSize),
      "12px",
      "The global font reset must not override compact control typography",
    );
    await page.keyboard.press("Escape");
    await pushDialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "View options", exact: true }).click();
    await page.getByRole("menuitem", { name: /Find in diffs/ }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("menu").waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "View options",
    );
  }
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Search commands", exact: true }).waitFor();
  await page.waitForTimeout(250);
  await page.getByRole("dialog").screenshot({ path: out + "/" + phase + "-palette.png" });
  if (phase === "after") {
    assert.equal(
      await page.getByRole("option").locator("svg").count(),
      0,
      "Command rows stay text-only",
    );
    const search = page.getByRole("combobox", { name: "Search commands", exact: true });
    assert.equal(await search.evaluate((e) => document.activeElement === e), true);
    await search.fill("Change theme");
    await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Search themes" }).waitFor();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Search themes",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.keyboard.press("Meta+k");
    await search.waitFor();
    await search.fill("");
  }

  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.keyboard.press("Meta+Shift+k");
  await page.getByRole("combobox", { name: "Find file", exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.getByRole("dialog").screenshot({ path: out + "/" + phase + "-files.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.goto(new URL(url).origin + "/file" + repo + "/README.md");
  await page.locator(".cm-content").waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: out + "/" + phase + "-toolbar.png",
    clip: { x: 620, y: 0, width: 660, height: 132 },
  });
  if (phase === "after") {
    const preview = page.getByRole("button", { name: "Toggle Markdown preview", exact: true });
    const height = await page
      .locator(".med-editor-header")
      .evaluate((e) => e.getBoundingClientRect().height);
    assert.equal(await preview.getAttribute("title"), null);
    await preview.hover();
    await page.getByRole("tooltip").waitFor();
    assert.equal(await page.getByRole("tooltip").locator("kbd").count(), 3);
    await page.screenshot({
      path: out + "/after-tooltip.png",
      clip: { x: 930, y: 0, width: 350, height: 155 },
    });
    await preview.click();
    await page.locator(".med-markdown").waitFor();
    assert.equal(
      await page.locator(".med-editor-header").evaluate((e) => e.getBoundingClientRect().height),
      height,
    );
    await page.getByRole("button", { name: "Commands", exact: true }).click();
    await page.getByRole("combobox", { name: "Search commands", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await preview.focus();
    await page.keyboard.press("Meta+Shift+v");
    await page.locator(".med-markdown").waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const themes = page.getByRole("combobox", { name: "Search themes" });
  await themes.waitFor();
  await themes.fill("Graphite Light");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Commands", exact: true }).click();
  await page.getByRole("combobox", { name: "Search commands", exact: true }).waitFor();
  await page.getByRole("dialog").screenshot({ path: out + "/" + phase + "-light-palette.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.screenshot({
    path: out + "/" + phase + "-light-toolbar.png",
    clip: { x: 620, y: 0, width: 660, height: 132 },
  });
  if (phase === "after") {
    await page.goto(
      new URL(url).origin + "/file?" + new URLSearchParams({ repo, path: "README.md" }),
    );
    await page.locator(".cm-content").waitFor();
    const files = page.getByRole("tablist", { name: "Open files" });
    const fileTab = files.getByRole("tab", { name: /README/ });
    assert.equal(await fileTab.getAttribute("aria-selected"), "true");
    const close = files.getByRole("button", { name: "Close README.md", exact: true });
    await close.click();
    await fileTab.waitFor({ state: "hidden" });
    assert.equal(
      await files.getByRole("tab", { name: "Changes", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    assert.deepEqual(errors, []);
  }
  console.log(out + " " + phase + " screenshots captured");
} finally {
  await browser?.close();
  host.kill("SIGTERM");
  await new Promise((r) => (host.exitCode !== null ? r() : host.once("exit", r)));
  await rm(root, { recursive: true, force: true });
}
