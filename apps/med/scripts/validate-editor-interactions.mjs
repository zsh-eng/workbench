import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { chromium } from "playwright";
const root = await realpath(await mkdtemp(join(tmpdir(), "med-editor-interactions-")));
const repo = join(root, "repo");
let host, browser;
try {
  await mkdir(repo);
  const text =
    "const selectionTarget = 1;\nconst secondWord = selectionTarget;\n\n" +
    Array.from({ length: 30 }, (_, i) => `// row ${i}`).join("\n") +
    "\n";
  await writeFile(join(repo, "sample.ts"), text);
  await writeFile(
    join(repo, "Sample.java"),
    "class Sample {\n  ConcurrentHashmap<> map;\n}\n" +
      Array.from({ length: 200 }, (_, i) => `// row ${i}`).join("\n"),
  );
  execFileSync("git", ["init", "-qb", "main", repo]);
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", [
    "-C",
    repo,
    "-c",
    "user.name=Editor Test",
    "-c",
    "user.email=test@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Fixture",
  ]);
  const executable = process.env.MED_EXECUTABLE;
  host = spawn(
    executable ? resolve(executable) : process.execPath,
    [
      ...(executable ? [] : [resolve("dist/cli.js")]),
      repo,
      "--port",
      "0",
      "--no-open",
      "--state-dir",
      join(root, "state"),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const launch = await new Promise((done, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error("Host timeout")), 30000);
    host.stdout.on("data", (chunk) => {
      out += chunk;
      const match = out.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        done(match[0]);
      }
    });
    host.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    host.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`Host exited: ${code}`));
    });
  });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(launch);
  await page.goto(
    `${new URL(launch).origin}/file?${new URLSearchParams({ repo, path: "sample.ts" })}`,
  );
  const editor = page.locator(".cm-content[contenteditable=true]");
  await editor.waitFor();
  const fileUrl = `${new URL(launch).origin}/file?${new URLSearchParams({ repo, path: "sample.ts" })}`;
  const tabs = page.getByRole("tablist", { name: "Open files" });
  for (const insert of [false, true]) {
    await editor.focus();
    if (insert) await page.keyboard.type("i");
    await page.keyboard.press("Alt+KeyW");
    await tabs.getByRole("tab", { name: /sample.ts/ }).waitFor({ state: "hidden", timeout: 3000 });
    assert.equal(
      await tabs.getByRole("tab", { name: "Changes", exact: true }).getAttribute("aria-selected"),
      "true",
    );
    await page.goto(fileUrl);
    await editor.waitFor();
  }
  // A picker owns its input; Option+W must not close the file behind it.
  await page.keyboard.press("Meta+Shift+k");
  const picker = page.getByRole("combobox", { name: "Find file", exact: true });
  await picker.waitFor();
  await picker.focus();
  await page.keyboard.press("Alt+KeyW");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(await tabs.getByRole("tab", { name: /sample.ts/ }).count(), 1);
  await editor.click();
  await page.keyboard.type("gg0wviw");
  await page.waitForTimeout(250);
  const until = async (fn) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return;
      await page.waitForTimeout(50);
    }
    throw new Error("Expected browser state did not appear");
  };
  assert.equal(await page.evaluate(() => getSelection()?.toString()), "selectionTarget");
  const highlight = page.locator(".cm-selectionBackground").first();
  await highlight.waitFor();
  assert.ok((await highlight.boundingBox()).width > 50);
  assert.notEqual(
    await highlight.evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgba(0, 0, 0, 0)",
  );
  assert.match(
    await page.locator(".cm-activeLine").evaluate((e) => getComputedStyle(e).backgroundColor),
    /0\.08/,
  );
  await page.screenshot({ path: "/private/tmp/med-editor-selection-after.png" });
  await page.keyboard.press("Meta+Shift+f");
  const search = page.getByRole("combobox", { name: "Search file contents", exact: true });
  await search.waitFor();
  assert.equal(await search.inputValue(), "selectionTarget");
  await page.getByRole("option").filter({ hasText: "selectionTarget" }).first().waitFor();
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.type("gg0wviwy");
  await until(
    async () => (await page.evaluate(() => navigator.clipboard.readText())) === "selectionTarget",
  );
  // A second identical yank must overwrite text from another application.
  await page.evaluate(() => navigator.clipboard.writeText("other app"));
  await page.keyboard.type("yiw");
  await until(
    async () => (await page.evaluate(() => navigator.clipboard.readText())) === "selectionTarget",
  );
  await page.keyboard.type("yy");
  await until(
    async () =>
      (await page.evaluate(() => navigator.clipboard.readText())) ===
      "const selectionTarget = 1;\n",
  );
  await page.evaluate(() => navigator.clipboard.writeText("keep named register private"));
  await page.keyboard.type('"ayiw');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "keep named register private",
  );
  await page.keyboard.type('"_yiw');
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "keep named register private",
  );
  // Mouse word selection must paint the same selection layer and seed search.
  const word = editor
    .locator(".cm-line")
    .first()
    .locator("span")
    .filter({ hasText: /^selectionTarget$/ })
    .first();
  await word.dblclick();
  assert.equal(await page.evaluate(() => getSelection()?.toString()), "selectionTarget");
  await highlight.waitFor();
  await page.keyboard.press("Control+Shift+f");
  await search.waitFor();
  assert.equal(await search.inputValue(), "selectionTarget");
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press("Escape");
  const before = await editor.innerText();
  for (const key of ["Meta+Shift+k", "Control+Shift+k"]) {
    await page.keyboard.press(key);
    await page.getByRole("combobox", { name: "Find file", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await editor.focus();
  }
  await page.keyboard.type("i");
  await page.keyboard.press("Meta+Shift+k");
  await page.getByRole("combobox", { name: "Find file", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await editor.focus();
  await page.keyboard.press("Escape");
  assert.equal(await editor.innerText(), before, "App shortcuts must not edit the document");
  const blame = page.getByRole("button", { name: "Toggle Git blame", exact: true });
  await blame.click();
  const labels = page.locator(".med-editor [data-med-blame-trigger]");
  await labels.first().waitFor();
  const gutter = page.locator(".med-editor-attribution");
  const width = (await gutter.boundingBox()).width;
  await editor.focus();
  await page.keyboard.type("ggO");
  await page.keyboard.type("// inserted");
  await page.keyboard.press("Escape");
  await until(async () => (await labels.count()) === 0);
  assert.equal(
    (await gutter.boundingBox()).width,
    width,
    "Dirty drafts keep the blame gutter width",
  );
  assert.equal(await blame.isEnabled(), true);
  await page.keyboard.type("u");
  await labels.first().waitFor();
  await editor.focus();
  await page.keyboard.type("ggO");
  await page.keyboard.type("// saved");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await labels.first().waitFor();
  assert.match(await labels.first().getAttribute("aria-label"), /Uncommitted/);
  await page.waitForTimeout(700); // allow the real file watcher to report this save
  assert.ok((await labels.count()) > 0, "Own-save watcher must not suppress blame");
  assert.equal((await gutter.boundingBox()).width, width);
  await writeFile(join(repo, "unrelated.txt"), "another file");
  await page.waitForTimeout(700);
  assert.ok((await labels.count()) > 0, "Unrelated edits must not suppress blame");
  await writeFile(join(repo, "sample.ts"), "// external edit\n" + text);
  await until(async () => (await labels.count()) === 0);
  assert.equal((await gutter.boundingBox()).width, width);
  // Standalone files use the same shortcut and keep dirty drafts open.
  const localUrl = `${new URL(launch).origin}/file${repo}/sample.ts`;
  for (const insert of [false, true]) {
    await page.goto(localUrl);
    await editor.waitFor();
    await editor.focus();
    if (insert) await page.keyboard.type("i");
    await page.keyboard.press("Alt+KeyW");
    await editor.waitFor({ state: "hidden" });
    assert.equal(
      await page.getByRole("region", { name: "Standalone files" }).getByRole("tab").count(),
      0,
    );
  }
  await page.goto(localUrl);
  await editor.waitFor();
  await editor.focus();
  await page.keyboard.type("iunsaved");
  await page.keyboard.press("Alt+KeyW");
  await page.getByRole("alert").filter({ hasText: "Save or discard" }).waitFor();
  assert.match(await editor.innerText(), /unsaved/);
  await page.keyboard.press("Escape");
  await page.keyboard.type("u");
  await page.keyboard.press("Alt+KeyW");
  await editor.waitFor({ state: "hidden" });
  await page.goto(`${new URL(launch).origin}/file${repo}/Sample.java`);
  await editor.waitFor();
  const diamond = editor.locator(".cm-line span").filter({ hasText: /^<>$/ });
  await diamond.waitFor();
  await page.evaluate(() => document.fonts.ready);
  const widths = await diamond.evaluate((el) => {
    const canvas = document.createElement("canvas").getContext("2d");
    const style = getComputedStyle(el);
    canvas.font = `${style.fontSize} ${style.fontFamily}`;
    return { pair: el.getBoundingClientRect().width, cell: canvas.measureText("p").width };
  });
  assert.ok(
    widths.pair >= widths.cell * 1.9,
    `Angle brackets must occupy two cells: ${JSON.stringify(widths)}`,
  );
  await page.screenshot({
    path: "/private/tmp/med-rendering-after.png",
    clip: { x: 0, y: 0, width: 800, height: 190 },
  });
  await editor.focus();
  await page.keyboard.type("100G");
  for (const [keys, edge] of [
    ["zt", "top"],
    ["zb", "bottom"],
    ["vzt", "top"],
  ]) {
    await page.keyboard.type(keys);
    await until(async () => {
      const gap = await page.locator(".cm-scroller").evaluate((el, edge) => {
        const row = el.querySelector(".cm-activeLine")?.getBoundingClientRect();
        const bounds = el.getBoundingClientRect();
        return row ? (edge === "top" ? row.top - bounds.top : bounds.bottom - row.bottom) : -1;
      }, edge);
      return gap >= 78 && gap <= 82;
    });
  }
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      standalone: !!executable,
      checks: [
        "two-cell-generic-brackets",
        "zt-zb-four-line-margin",
        "viw-visible",
        "mouse-word-selection",
        "selection-content-search",
        "default-yank-clipboard",
        "named-and-black-hole-registers",
        "app-shortcuts-normal-and-insert",
        "option-w-editor-repository-and-standalone",
        "option-w-picker-and-dirty-draft-protection",
        "blame-edit-undo-save-watch",
      ],
    }),
  );
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const exited = once(host, "exit");
    host.kill("SIGTERM");
    await exited;
  }
  await rm(root, { recursive: true, force: true });
}
