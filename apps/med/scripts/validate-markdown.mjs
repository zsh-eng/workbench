// Exercise the production CLI, authenticated image routes, worker, and Vim editor.
import { spawn, execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  symlink,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-markdown-")));
const output = resolve(".benchmarks/markdown");
await mkdir(output, { recursive: true });
const doc = join(directory, "reading-queue.md");
await copyFile("docs/examples/reading-queue.md", doc);
await copyFile("docs/examples/reading-queue.svg", join(directory, "reading-queue.svg"));
const source = await readFile(doc, "utf8");
const repo = join(directory, "repo");
await mkdir(repo);
const git = (...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.test",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.test",
    },
  }).trim();
git("init", "-q", "-b", "main");
await writeFile(
  join(repo, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"><text>committed image</text></svg>',
);
git("add", ".");
git("commit", "-qm", "Image fixture");
const oid = git("rev-parse", "HEAD");
await writeFile(
  join(repo, "image.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg"><text>working image</text></svg>',
);

let host, browser, page;
const results = {};
try {
  host = spawn(
    process.execPath,
    [
      resolve("dist/cli.js"),
      repo,
      "--port",
      "0",
      "--state-dir",
      join(directory, "state"),
      "--no-open",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const launch = await new Promise((accept, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Host startup timed out")), 30_000);
    host.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Host exited"));
    });
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timer);
        accept(match[0]);
      }
    });
  });
  const url = new URL(launch),
    origin = url.origin;
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const imageUrl = (href, document = doc) =>
    origin +
    "/api/markdown/image?" +
    new URLSearchParams({
      source: JSON.stringify({ kind: "local", path: document }),
      document,
      href,
    });
  assert.equal((await fetch(imageUrl("reading-queue.svg"))).status, 401);
  assert.equal((await fetch(imageUrl("reading-queue.svg"), { headers })).status, 403);
  await fetch(origin + "/api/local-files/open", {
    method: "POST",
    headers,
    body: JSON.stringify({ path: doc }),
  });
  assert.equal((await fetch(imageUrl("reading-queue.svg"), { headers })).status, 200);
  assert.equal((await fetch(imageUrl("../outside.svg"), { headers })).status, 400);
  assert.equal((await fetch(imageUrl("%2e%2e%2foutside.svg"), { headers })).status, 400);
  await symlink(join(directory, "reading-queue.svg"), join(directory, "link.svg"));
  assert.equal((await fetch(imageUrl("link.svg"), { headers })).status, 400);
  const commitImage =
    origin +
    "/api/markdown/image?" +
    new URLSearchParams({
      source: JSON.stringify({ kind: "commit", repo, oid }),
      document: "docs/note.md",
      href: "../image.svg",
    });
  const committedImage = await fetch(commitImage, { headers });
  assert.equal(committedImage.status, 200);
  assert.match(await committedImage.text(), /committed image/);
  results.commitImages = "relative image reads use the displayed commit, not changed working bytes";
  results.imageAccess =
    "unauthenticated, unopened, traversal and symlink requests rejected; sibling image loads";
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1120 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Browser error:", error.message);
  });
  await page.goto(launch);
  await page.evaluate(() => {
    localStorage.setItem("med:theme:v1", "graphite-light");
  });
  const fileUrl = origin + "/file/" + doc.split("/").map(encodeURIComponent).join("/") + "?edit=1";
  await page.goto(fileUrl);
  await page.getByRole("button", { name: "Toggle Markdown preview" }).click();
  await page.locator(".med-md-prose h1").waitFor();
  assert.equal(
    await page.locator(".med-md-prose h1").textContent(),
    "Designing a calmer reading queue",
  );
  await page.waitForFunction(() => {
    const image = document.querySelector(".med-md-prose img");
    return image?.complete && image.naturalWidth > 0;
  });
  await page.locator(".med-md-prose .katex").first().waitFor({ state: "attached" });
  assert.ok((await page.locator(".med-md-prose table tr").count()) >= 5);
  assert.equal(await page.locator('.med-md-prose input[type="checkbox"]').count(), 4);
  const paragraph = page.locator(".med-md-prose p").filter({ hasText: "These three source lines" });
  assert.match(await paragraph.textContent(), /Only a blank line/);
  assert.equal(await paragraph.locator("br").count(), 0);
  assert.ok(
    (await page.locator('.med-md-prose pre[data-language="typescript"] code span[style]').count()) >
      10,
  );
  await page.getByRole("navigation", { name: "Table of contents" }).waitFor({ state: "visible" });
  await page.screenshot({ path: join(output, "preview-light.png") });
  // Contents moves the source cursor; the preview follows without scrolling ancestors.
  const sourceTop = await page
    .locator(".med-editor")
    .evaluate((node) => node.getBoundingClientRect().top);
  await page.locator(".med-md-toc button").last().click();
  const targetLine = source.split("\n").findIndex((line) => line.startsWith("[^retry]:")) + 1;
  await page.waitForFunction(
    (text) => document.querySelector(".cm-activeLine")?.textContent === text,
    source.split("\n")[targetLine - 1],
  );
  await page.waitForFunction(() => {
    const pane = document.querySelector(".med-md-scroll").getBoundingClientRect();
    const footnote = document.querySelector(".footnotes").getBoundingClientRect();
    return footnote.top >= pane.top && footnote.bottom <= pane.bottom;
  });
  await page.waitForTimeout(350);
  const layout = await page.evaluate(() => ({
    sourceTop: document.querySelector(".med-editor").getBoundingClientRect().top,
    previewBottom: document.querySelector(".med-markdown").getBoundingClientRect().bottom,
    shellScroll: document.querySelector(".med-markdown-shell").scrollTop,
    viewport: innerHeight,
  }));
  assert.equal(layout.sourceTop, sourceTop);
  assert.equal(layout.shellScroll, 0);
  assert.equal(layout.previewBottom, layout.viewport);
  await page.screenshot({ path: join(output, "last-heading.png") });
  results.contentsNavigation =
    "last heading stays inside preview; both columns still fill the window";
  await page.locator(".med-md-toc button").first().click();
  await page.waitForTimeout(450);
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Meta+Shift+v");
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.keyboard.press("Control+Shift+v");
  await page.locator(".med-md-prose h1").waitFor();
  results.previewShortcut = "Cmd+Shift+V and Ctrl+Shift+V toggle the preview from the editor";
  results.rendering = "GFM tables, tasks, soft breaks, syntax colors, KaTeX, local image, headings";
  const content = page.locator(".cm-content");
  const line = (needle) => source.slice(0, source.indexOf(needle)).split("\n").length;
  await content.click();
  await page.keyboard.press("Escape");
  await page.keyboard.type(`:${line("## Follow the data")}`);
  await page.keyboard.press("Enter");
  await page.locator('[data-mermaid][data-rendered="true"]').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, "diagram-light.png") });
  await page.keyboard.type(`:${line("## Put a budget on waiting")}`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
  await page.waitForFunction(() => {
    const pane = document.querySelector(".med-md-scroll").getBoundingClientRect();
    const formula = document.querySelector(".katex-display").getBoundingClientRect();
    return formula.top >= pane.top && formula.bottom <= pane.bottom;
  });
  await page.screenshot({ path: join(output, "math-light.png") });
  const followLine = Number(await page.locator(".med-md-scroll").getAttribute("data-follow-line"));
  assert.ok(followLine > 20);
  await page.keyboard.type("gg0iA live draft: ");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    document.querySelector(".med-md-prose")?.textContent?.includes("A live draft:"),
  );
  assert.equal(await readFile(doc, "utf8"), source, "Preview must not save the draft");
  await page.keyboard.press("u");
  await page.waitForFunction(
    () =>
      document.querySelector(".med-md-prose h1")?.textContent ===
      "Designing a calmer reading queue",
  );
  await page.keyboard.type(`:${line("  A[Reader action]")}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("cc  A[Revised action] --> B[Local store]");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".med-md-diagram")].some((node) =>
      node.textContent.includes("Revised action"),
    ),
  );
  await page.keyboard.press("u");
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".med-md-diagram")].some((node) =>
      node.textContent.includes("Reader action"),
    ),
  );
  results.diagramEditing = "diagram labels update from unsaved text and recover on undo";
  results.liveEditing = "unsaved draft and Vim undo update preview without a disk write";
  await page.keyboard.press("G");
  await page.waitForFunction(
    () =>
      document.querySelector(".med-md-scroll").scrollTop > 1000 &&
      Number(document.querySelector(".med-md-scroll").dataset.followLine) > 100,
  );
  results.cursorFollow = {
    line: Number(await page.locator(".med-md-scroll").getAttribute("data-follow-line")),
  };
  await page.waitForTimeout(400);
  await page.locator(".cm-scroller").evaluate((node) => {
    node.scrollTop = 400;
  });
  await page.waitForTimeout(300);
  assert.ok(
    Number(await page.locator(".med-md-scroll").getAttribute("data-follow-line")) < 40,
    JSON.stringify(
      await page.locator(".cm-scroller").evaluate((node) => ({
        scrollTop: node.scrollTop,
        follow: document.querySelector(".med-md-scroll").dataset.followLine,
      })),
    ),
  );
  const fractionalBefore = Number(
    await page.locator(".med-md-scroll").getAttribute("data-follow-line"),
  );
  await page.locator(".cm-scroller").evaluate((node) => {
    node.scrollTop += 5;
  });
  await page.waitForTimeout(350);
  const fractionalAfter = Number(
    await page.locator(".med-md-scroll").getAttribute("data-follow-line"),
  );
  assert.ok(Math.abs(fractionalAfter - fractionalBefore - 0.25) < 0.01);
  const frames = await page.evaluate(async () => {
    const source = document.querySelector(".cm-scroller"),
      preview = document.querySelector(".med-md-scroll");
    const samples = [preview.scrollTop];
    source.scrollTop += 160;
    for (let i = 0; i < 24; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(preview.scrollTop);
    }
    return samples;
  });
  assert.ok(new Set(frames).size > 4, "Scrolling must pass through intermediate positions");
  assert.ok(frames.at(-1) > frames[0]);
  assert.ok(
    frames.every((value, index) => !index || value >= frames[index - 1] - 1),
    "Following must not reverse or bounce",
  );
  results.scrollMotion = {
    fractionalLineDelta: fractionalAfter - fractionalBefore,
    intermediatePositions: new Set(frames).size,
    frames,
  };
  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedFrames = await page.evaluate(async () => {
    document.querySelector(".cm-scroller").scrollTop += 100;
    const samples = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(requestAnimationFrame);
      samples.push(document.querySelector(".med-md-scroll").scrollTop);
    }
    return samples;
  });
  assert.ok(new Set(reducedFrames.slice(1)).size <= 1, "Reduced motion must settle without easing");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  results.reducedMotion = true;
  results.scrollFollow = true;
  await page.getByRole("button", { name: "Toggle Markdown preview" }).click();
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.reload();
  await page.getByRole("button", { name: "Toggle Markdown preview" }).waitFor();
  assert.equal(await page.locator(".med-markdown").count(), 0);
  await page.getByRole("button", { name: "Toggle Markdown preview" }).click();
  await page.locator(".med-md-prose h1").waitFor();
  await page.evaluate(() => {
    localStorage.setItem("med:theme:v1", "tokyo-night");
  });
  await page.reload();
  await page.locator(".med-md-prose h1").waitFor();
  await page.waitForFunction(() => document.querySelector(".med-md-prose img")?.naturalWidth > 0);
  await page.screenshot({ path: join(output, "preview-dark.png") });
  results.persistedPreference = true;
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("region", { name: "Full file", exact: true }).waitFor();
  await page.locator('[aria-label="File navigation"]').focus();
  await page.keyboard.press("G");
  await page.waitForFunction(
    () => Number(document.querySelector(".med-md-scroll").dataset.followLine) > 100,
  );
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button", { name: "Start with the experience", exact: true })
    .click();
  const headingLine =
    source.split("\n").findIndex((line) => line === "## Start with the experience") + 1;
  await page.waitForFunction(
    (line) =>
      Number(document.querySelector('[aria-label="File navigation"]').dataset.vimLine) === line,
    headingLine,
  );
  await page.waitForFunction(
    (line) => Number(document.querySelector(".med-md-scroll").dataset.followLine) === line,
    headingLine,
  );
  results.readOnlyFollow = true;
  // Narrow panes keep the preview usable and hide the optional contents rail.
  await page.setViewportSize({ width: 650, height: 900 });
  assert.equal(
    await page.getByRole("navigation", { name: "Table of contents" }).isVisible(),
    false,
  );
  await page.setViewportSize({ width: 1800, height: 1120 });
  results.narrowLayout = true;
  // Syntax mistakes and malicious source must stay inert, and a later valid edit must recover.
  await page.goto(origin + "/files");
  const malformed = join(directory, "adversarial.md");
  await writeFile(
    malformed,
    "# Safety\n\n<script>window.markdownExecuted=true</script>\n\n[bad](javascript:alert(1))\n\n![bad](javascript:alert(1))\n\n```mermaid\nthis is not a diagram\n```\n\n$$\n\\notacommand{\n$$\n",
  );
  await page.goto(origin + "/file/" + malformed.split("/").map(encodeURIComponent).join("/"));
  await page.locator(".med-md-prose h1").waitFor();
  await page.locator("[data-diagram-error]").waitFor();
  assert.equal(await page.evaluate(() => window.markdownExecuted), undefined);
  assert.equal(
    await page
      .locator(
        '.med-md-prose [href^="javascript:"], .med-md-prose [src^="javascript:"], .med-md-prose script',
      )
      .count(),
    0,
  );
  results.invalidInput =
    "invalid math and diagrams remain readable; HTML and unsafe URLs stay inert";
  // Larger document: keep the mechanism under test real, report measured worker time.
  const large = join(directory, "large.md");
  await writeFile(
    large,
    Array.from(
      { length: 400 },
      (_, i) =>
        `## Section ${i + 1}\n\nA paragraph about bounded work and stable interfaces.\nThis source line belongs to that same paragraph.\n\n`,
    ).join(""),
  );
  await page.goto(origin + "/file/" + large.split("/").map(encodeURIComponent).join("/"));
  await page.locator(".med-md-prose h2").first().waitFor();
  assert.equal(await page.locator(".med-md-prose h2").count(), 400);
  results.largeDocument = {
    sections: 400,
    workerMs: Number(await page.locator(".med-md-scroll").getAttribute("data-render-ms")),
  };
  assert.deepEqual(errors, []);
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, "failure.png") }).catch(() => {});
    console.error((await page.locator("body").innerText()).slice(0, 2500));
  }
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const exited = new Promise((done) => host.once("exit", done));
    host.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
