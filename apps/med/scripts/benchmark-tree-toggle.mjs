import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = process.cwd();
const repo = resolve(process.argv[2] ?? ".benchmarks/bun");
const output = process.argv[3] ?? "/tmp/tree-toggle.json";
const host = spawn(process.execPath, ["dist/cli.js", repo, "--port", "0", "--no-open"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});
const url = await new Promise((resolve, reject) => {
  let out = "";
  const timer = setTimeout(() => {
    host.kill();
    reject(new Error("Host startup timed out"));
  }, 30000);
  host.stdout.on("data", (d) => {
    out += d;
    const m = out.match(/http:\/\/127\.0\.0\.1:\d+[^\s]*/);
    if (m) {
      clearTimeout(timer);
      resolve(m[0]);
    }
  });
  host.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Host exited: ${code}`));
  });
});
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  let listRequests = 0;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/api/browse/list")) listRequests++;
  });
  page.on("requestfinished", (r) => {
    if (r.url().includes("/api/browse/list"))
      requests.push({ duration: r.timing().responseEnd - r.timing().requestStart });
  });
  let entries = 0;
  page.on("response", async (r) => {
    if (r.url().includes("/api/browse/list")) {
      const data = await r.json();
      entries = data.entries?.length;
    }
  });
  await page.goto(url);
  await page.locator('[data-review-status="ready"]').waitFor();

  const samples = [];
  await page.evaluate(() => {
    window.__treeBenchmarkHost = null;
  });
  for (let i = 0; i < 9; i++) {
    samples.push(
      await page.evaluate(async () => {
        const start = performance.now();
        // The files sidebar has only its button; ⌘⇧B toggles the agent session.
        [...document.querySelectorAll('[aria-label="Toggle files sidebar"]')]
          .find((button) => button.checkVisibility())
          .click();
        let frames = 0;
        let rows = 0;
        while (performance.now() - start < 10000) {
          await new Promise(requestAnimationFrame);
          const tree = document.querySelector('[aria-label="Workspace files"] file-tree-container');
          rows = tree?.shadowRoot?.querySelectorAll('[role="treeitem"]').length ?? 0;
          if (rows > 0 && tree.checkVisibility()) {
            if (++frames >= 2) break;
          }
        }
        const host = document.querySelector('[aria-label="Workspace files"] file-tree-container');
        const reused = host === window.__treeBenchmarkHost;
        window.__treeBenchmarkHost = host;
        if (frames < 2) throw new Error("Tree did not render within ten seconds");
        return { ms: performance.now() - start, rows, reused };
      }),
    );
    await page.waitForTimeout(300);
    await page
      .getByRole("button", { name: "Toggle files sidebar", exact: true })
      .filter({ visible: true })
      .click();
    await page.locator('[aria-label="Workspace files"]').waitFor({ state: "hidden" });
    await page.waitForTimeout(100);
  }
  const warm = samples
    .slice(1)
    .map((s) => s.ms)
    .sort((a, b) => a - b);
  const result = {
    repo,
    entries,
    listRequests,
    requests,
    samples,
    firstOpenMs: samples[0].ms,
    warmMedianMs: (warm[3] + warm[4]) / 2,
    warmMaxMs: warm.at(-1),
    errors,
    method:
      "Production headless Chromium, 1440x1000. A click on the files sidebar button to two animation frames with mounted rows; 8 warm opens. No CPU profiler.",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  host.kill();
}
