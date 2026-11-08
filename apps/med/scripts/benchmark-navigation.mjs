import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const host = spawn(
  process.execPath,
  ["dist/cli.js", resolve(process.argv[2] ?? ".benchmarks/bun"), "--port", "0", "--no-open"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let hostErrors = "";
host.stderr.on("data", (chunk) => {
  hostErrors += chunk;
});
const url = await new Promise((resolveUrl, reject) => {
  let output = "";
  const timeout = setTimeout(() => {
    host.kill();
    reject(new Error(`Host startup timed out: ${hostErrors}`));
  }, 30000);
  host.stdout.on("data", (chunk) => {
    output += chunk;
    const match = output.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
    if (match) {
      clearTimeout(timeout);
      resolveUrl(match[0]);
    }
  });
  host.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Host exited: ${code}`));
  });
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") errors.push(e.text());
  });
  await page.goto(url);
  await page.locator('[data-review-status="ready"]').waitFor();
  const commits = page.getByRole("listbox", { name: "Commits" }).getByRole("option");
  await commits.first().waitFor();
  const timings = [];
  for (let i = 0; i < 24; i++) {
    const index = i % Math.min(await commits.count(), 10);
    const start = performance.now();
    const previous = await page.locator("[data-review-id]").getAttribute("data-review-id");
    await commits.nth(index).click();
    await page.waitForFunction((previous) => {
      const node = document.querySelector("[data-review-id]");
      return (
        node?.getAttribute("data-review-id") !== previous &&
        node?.getAttribute("data-review-status") === "ready"
      );
    }, previous);
    await page.locator('[data-review-status="ready"]').waitFor();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    timings.push(performance.now() - start);

    await page.getByRole("button", { name: i % 2 ? "Split" : "Unified", exact: true }).click();
    await page.mouse.move(900, 600);
    await page.mouse.wheel(0, 400);
  }
  // Re-select the same review after the switches; this previously replaced metadata
  // objects under an existing Pierre layout.
  const selectedIndex = 23 % Math.min(await commits.count(), 10);
  for (let repeat = 0; repeat < 8; repeat++) {
    await commits.nth(selectedIndex).click();
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  // Start a known multi-file comparison and measure hover-to-open against its full-file links.
  await commits.nth(1).click();
  await page.locator('[data-review-status="ready"]').waitFor();
  await page.getByRole("button", { name: "Split", exact: true }).click();
  const links = page.getByRole("link").filter({ hasText: /\.(rs|ts|cpp|zig)$/ });
  await links.first().waitFor();
  const link = links.first();
  const name = await link.innerText();
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/browse/read")) reads++;
  });
  const readDone = page.waitForResponse((r) => r.url().includes("/api/browse/read"));
  await link.hover();
  await readDone;
  await page.waitForTimeout(250);
  const beforeClick = reads;
  const start = performance.now();
  await link.click();
  await page.getByRole("textbox", { name: "File content", exact: true }).waitFor();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const openedMs = performance.now() - start;
  const initiallyHighlighted =
    (await page.locator("[data-file-pane=main] [data-line] span[style]").count()) > 0;
  await page.locator("[data-file-pane=main] [data-line] span[style]").first().waitFor();
  const highlightedMs = performance.now() - start;
  await page.screenshot({ path: "docs/validation/compact-file-view.png" });
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.screenshot({ path: "docs/validation/compact-diff-view.png" });
  const sorted = [...timings].sort((a, b) => a - b);
  const result = {
    scope:
      "Production Bun viewer, Chromium 1440x1000. Click through two animation frames after ready; includes Playwright input scheduling. Hover preceded click by 250ms; highlighting may finish later. OS caches warm.",
    commitSwitches: timings.length,
    sameCommitReselections: 8,
    p50Ms: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    hover: {
      file: name,
      readsBeforeClick: beforeClick,
      extraReadsOnClick: reads - beforeClick,
      clickThroughTwoFramesMs: openedMs,
      initiallyHighlighted,
      highlightedMs,
    },
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  await writeFile("docs/validation/hover-density.json", JSON.stringify(result, null, 2) + "\n");
  if (errors.length) throw new Error("Browser render errors occurred; see hover-density.json.");
} finally {
  await browser.close();
  host.kill();
}
