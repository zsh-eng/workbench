// Real host and browser coverage for standalone files, drops, and gutter markers.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const directory = await realpath(await mkdtemp(join(tmpdir(), "med-local-ui-")));
const repo = join(directory, "example"),
  state = join(directory, "state");
const output = resolve(".benchmarks/local-files");
await mkdir(repo);
await mkdir(output, { recursive: true });
const git = (...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Med example",
      GIT_AUTHOR_EMAIL: "med@example.test",
      GIT_COMMITTER_NAME: "Med example",
      GIT_COMMITTER_EMAIL: "med@example.test",
    },
  }).trim();
const before = `package example;

import java.util.List;

/** A small example for reviewing a complete file. */
public final class ReadingQueue {
    private static final int DEFAULT_LIMIT = 10;
    private static final boolean LEGACY_ORDER = true;

    public List<String> nextBooks(List<String> titles) {
        return titles.stream()
            .limit(DEFAULT_LIMIT)
            .toList();
    }

    public String label(String title) {
        return title;
    }

    public boolean isEmpty(List<String> titles) {
        return titles.isEmpty();
    }
}
`;
const committed = before
  .replace("    private static final boolean LEGACY_ORDER = true;\n", "")
  .replace(
    "            .limit(DEFAULT_LIMIT)",
    "            .filter(title -> !title.isBlank())\n            .distinct()\n            .limit(DEFAULT_LIMIT)",
  )
  .replace("        return title;", '        return "Next: " + title.strip();');
const working = committed
  .replace("    private static final int DEFAULT_LIMIT = 10;\n", "")
  .replace("            .limit(DEFAULT_LIMIT)", "            .limit(5)")
  .replace(
    "        return titles.isEmpty();",
    "        // Ignore empty titles while building the queue.\n        return titles.stream().allMatch(String::isBlank);",
  );
git("init", "-q", "-b", "main");
await writeFile(join(repo, "ReadingQueue.java"), before);
git("add", ".");
git("commit", "-qm", "Add reading queue");
const base = git("rev-parse", "HEAD");
await writeFile(join(repo, "ReadingQueue.java"), committed);
git("add", ".");
git("commit", "-qm", "Filter blank and duplicate titles");
const head = git("rev-parse", "HEAD");
await writeFile(join(repo, "ReadingQueue.java"), working);
const loose = join(directory, "Notes # [draft].java");
await writeFile(loose, committed);
let host, browser, page;
try {
  host = spawn(
    process.execPath,
    [resolve("dist/cli.js"), repo, "--port", "0", "--state-dir", state, "--no-open"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MED_ZOEKT_BIN: join(directory, "no-search"),
        MED_SEARCH_CACHE: join(directory, "search"),
      },
    },
  );
  const launch = await new Promise((accept, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Host startup timed out")), 30000);
    host.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Host exited"));
    });
    host.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
      if (match) {
        clearTimeout(timeout);
        accept(match[0]);
      }
    });
  });
  const url = new URL(launch),
    origin = url.origin;
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  const api = async (route, body, status = 200, authenticated = true) => {
    const response = await fetch(origin + route, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };
  await api("/api/local-files/open", { path: loose }, 401, false);
  await api(
    "/api/local-files/write",
    { path: loose, expectedIdentity: "unknown", text: "overwrite" },
    403,
  );
  await api("/api/local-files/open", { path: "relative.java" }, 400);
  const unopened = await api("/api/local-files/open", { path: directory });
  assert.equal(unopened.kind, "unsupported");
  await symlink(loose, join(directory, "link.java"));
  assert.equal(
    (await api("/api/local-files/open", { path: join(directory, "link.java") })).kind,
    "unsupported",
  );
  const opened = await api("/api/local-files/open", { path: loose });
  await writeFile(loose, committed + "// external\n");
  await api(
    "/api/local-files/write",
    { path: loose, expectedIdentity: opened.identity, text: "stale" },
    409,
  );
  assert.equal(await readFile(loose, "utf8"), committed + "// external\n");
  await writeFile(loose, committed);
  const cli = execFileSync(
    process.execPath,
    [
      resolve("dist/cli.js"),
      "open",
      loose,
      "--line",
      "6",
      "--column",
      "3",
      "--port",
      url.port,
      "--state-dir",
      state,
    ],
    { encoding: "utf8" },
  );
  assert.ok(!cli.includes(token));
  const fileLink = /\]\(([^\n]+)\)/.exec(cli)[1];
  assert.equal(decodeURIComponent(new URL(fileLink).pathname.slice(5)), loose);
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1320, height: 850 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(fileLink + url.hash);
  await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
  assert.equal(await page.locator("#review-sidebar").count(), 0);
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="File navigation"]')?.getAttribute("data-vim-line") ===
      "6",
  );
  await page.locator('diffs-container [data-line="1"]').waitFor();
  // Files has its own command surface even before the repository app mounts.
  assert.equal(await page.getByRole("textbox", { name: "Absolute file path" }).count(), 0);
  await page.keyboard.press("Meta+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("absolute path");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Absolute file path" }).waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+o");
  await page.getByRole("textbox", { name: "Absolute file path" }).fill(loose);
  await page.getByRole("dialog").getByRole("button", { name: "Open file", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  await page.getByRole("combobox", { name: "Search themes" }).pressSequentially("night");
  assert.equal(await page.getByRole("combobox", { name: "Search themes" }).inputValue(), "night");
  assert.equal(await page.locator(".med-editor").count(), 0);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelector('[data-line="1"]')
        ?.getBoundingClientRect().height > 0,
  );
  const viewTop = await page
    .locator('diffs-container [data-line="1"]')
    .evaluate((node) => node.getBoundingClientRect().top);
  const viewHeight = await page
    .locator('[aria-label="Full file"] > header')
    .evaluate((node) => node.getBoundingClientRect().height);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editHeight = await page
    .locator(".med-editor-header")
    .evaluate((node) => node.getBoundingClientRect().height);
  assert.equal(viewHeight, editHeight);
  assert.equal(editHeight, 32);
  const editTop = await page
    .locator(".cm-line")
    .first()
    .evaluate((node) => node.getBoundingClientRect().top);
  assert.ok(Math.abs(viewTop - editTop) < 1, `File content shifted: ${viewTop} → ${editTop}`);
  await page.getByRole("button", { name: "Theme", exact: true }).click();
  const themeInput = page.getByRole("combobox", { name: "Search themes" });
  await themeInput.fill("");
  await themeInput.pressSequentially("light");
  assert.equal(await themeInput.inputValue(), "light");
  assert.equal(await themeInput.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  await page.locator(".cm-content").focus();
  await page.keyboard.type("gg0i");
  const insertCaret = page.locator(".cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor").first();
  await insertCaret.waitFor({ state: "attached" });
  assert.equal(await insertCaret.evaluate((node) => getComputedStyle(node).borderLeftWidth), "3px");
  const [caretFrames] = await Promise.all([
    insertCaret.evaluate(
      (node) =>
        new Promise((resolve) => {
          const frames = [];
          const start = performance.now();
          const sample = () => {
            frames.push(node.getBoundingClientRect().left);
            if (performance.now() - start < 180) requestAnimationFrame(sample);
            else resolve(frames);
          };
          requestAnimationFrame(sample);
        }),
    ),
    page.keyboard.type("x"),
  ]);
  assert.ok(
    new Set(caretFrames.map((x) => Math.round(x * 10))).size > 2,
    `Insert caret must animate: ${caretFrames}`,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.type("ugg0i");
  await page.keyboard.type("// Edited in med\n");
  await page.keyboard.press("Escape");
  await page.keyboard.type(":w");
  await page.keyboard.press("Enter");
  await page.getByRole("img", { name: "Saved", exact: true }).waitFor();
  assert.equal(await readFile(loose, "utf8"), "// Edited in med\n" + committed);
  await page.screenshot({ path: join(output, "standalone-editor-dark.png") });
  // A drop opens bytes only. It never creates a host file grant or an edit button.
  await page.evaluate((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "ReadingQueue.java", { type: "text/plain" }));
    document.body.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  }, committed);
  await page.getByText("Dropped file · preview only", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 0);
  await page.waitForFunction(() =>
    document.querySelector("diffs-container")?.shadowRoot?.querySelector('[data-line="6"]'),
  );
  await page.screenshot({ path: join(output, "dropped-file-dark.png") });

  const review = await api("/api/reviews", {
    title: "Filter the reading queue",
    targets: [{ repo, comparison: { kind: "range", base, head } }],
  });
  const target = review.targets[0];
  const commitSource = { kind: "commit", repo, oid: head };
  const read = await api("/api/browse/read", { source: commitSource, path: "ReadingQueue.java" });
  const markers = await api("/api/browse/changes", {
    source: commitSource,
    path: read.path,
    identity: read.identity,
    saved: { id: review.id, target: target.id },
  });
  assert.ok(markers.ranges.some((range) => range.kind === "added"));
  assert.ok(markers.ranges.some((range) => range.kind === "deleted" && range.edge === "after"));
  const live = await api("/api/browse/read", {
    source: { kind: "worktree", repo },
    path: read.path,
  });
  const liveMarkers = await api("/api/browse/changes", {
    source: live.source,
    path: live.path,
    identity: live.identity,
    saved: { id: review.id, target: target.id },
  });
  assert.ok(liveMarkers.ranges.some((range) => range.kind === "working"));
  await api(
    "/api/browse/changes",
    { source: live.source, path: live.path, identity: "stale" },
    409,
  );
  await page.evaluate(() => localStorage.setItem("med:theme:v1", "graphite-light"));
  await page.goto(`${origin}/review/${review.id}`);
  await page.getByTitle("Open full file · ReadingQueue.java", { exact: true }).click();
  await page.getByRole("button", { name: "Open after", exact: true }).click();
  const marker = (kind) =>
    page.locator(`[data-file-pane="main"] diffs-container`).locator(`[data-med-change="${kind}"]`);
  await marker("added").first().waitFor();
  await marker("deleted").first().waitFor();
  await page.screenshot({ path: join(output, "comparison-gutter-light.png") });
  // The markers remain attached to code rows after scrolling and changing sides.
  const afterCount = await marker("added").count();
  await page.getByRole("button", { name: "Open before", exact: true }).click();
  await marker("deleted").first().waitFor();
  await page.evaluate(() => localStorage.setItem("med:theme:v1", "tokyo-night"));
  const workingLink = new URL("/file", origin);
  workingLink.search = new URLSearchParams({ repo, path: "ReadingQueue.java" }).toString();
  await page.goto(workingLink.href);
  await marker("working").first().waitFor();
  await marker("deleted").first().waitFor();
  await page.screenshot({ path: join(output, "working-gutter-dark.png") });
  await page.evaluate(() => localStorage.setItem("med:theme:v1", "graphite-light"));
  await page.reload();
  await marker("working").first().waitFor();
  await page.screenshot({ path: join(output, "working-gutter-light.png") });
  // A drop from the review keeps its file state available when returning.
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["preview only\n"], "scratch.txt"));
    document.body.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
  });
  await page.getByText("Dropped file · preview only", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Repositories", exact: true }).click();
  await marker("working").first().waitFor();
  await page.goBack();
  await page.getByRole("region", { name: "Standalone files" }).waitFor();
  await page.getByText("Dropped file · preview only", { exact: true }).waitFor();
  await page.goForward();
  await marker("working").first().waitFor();
  assert.deepEqual(errors, []);
  const report = {
    toolbarHeight: viewHeight,
    committedMarkers: markers,
    workingMarkers: liveMarkers,
    renderedAddedLines: afterCount,
    checks: [
      "Files commands and on-demand absolute path dialog",
      "theme search retains focus in viewer and editor",
      "3 px insert caret with intermediate animation frames",
      "Files and repositories browser Back/Forward",
      "authenticated exact-file access",
      "no write before open",
      "no directory or symlink editing",
      "standalone stale-write conflict",
      "CLI URL escaping and coordinates",
      "standalone Vim save",
      "equal toolbar heights",
      "read-only drops",
      "saved comparison and before-side markers",
      "working markers",
      "stale marker rejection",
    ],
    errors,
  };
  await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} catch (error) {
  if (page) {
    console.error((await page.locator("body").innerText()).slice(0, 8000));
    await page.screenshot({ path: join(output, "failure.png") });
  }
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode === null) {
    const stopped = new Promise((accept) => host.once("exit", accept));
    host.kill();
    await stopped;
  }
  await rm(directory, { recursive: true, force: true });
}
