// Measures the production build against a running server (default: the real library).
//   bun run start            # in another terminal
//   node scripts/perf.mjs    # writes perf.local/summary.json and Chrome traces
// Traces contain post text and media URLs, so they stay in the ignored perf.local folder.

import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg, totalmem, release } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:5296";
const OUT = join(import.meta.dirname, "..", "perf.local");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chromium" });
const viewport = { width: 1440, height: 900 };
const summary = {
  when: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model, cores: cpus().length, memoryGB: Math.round(totalmem() / 2 ** 30), os: release(), load: loadavg().map((n) => n.toFixed(2)) },
  browser: `Chromium ${browser.version()} (Playwright, new headless)`,
  viewport,
  build: "vite production build served by server/index.ts",
};

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const stats = (values) => ({
  n: values.length,
  p50: +percentile(values, 50).toFixed(1),
  p95: +percentile(values, 95).toFixed(1),
  max: +Math.max(...values).toFixed(1),
});

async function freshPage() {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  return { context, page };
}

// ------------------------------------------------------------------ cold load

{
  const { context, page } = await freshPage();
  const images = [];
  page.on("request", (r) => /\/(derived|media)\//.test(r.url()) && images.push(r.url()));
  await page.goto(BASE, { waitUntil: "commit" });
  await page.locator(".card").first().waitFor();
  const usable = await page.evaluate(() => performance.now());
  await page.waitForLoadState("networkidle");
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const lib = performance.getEntriesByType("resource").find((r) => r.name.endsWith("/api/library"));
    return {
      libraryTransferKB: lib ? Math.round(lib.transferSize / 1024) : null,
      libraryFetchMs: lib ? Math.round(lib.responseEnd - lib.startTime) : null,
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      cards: document.querySelectorAll(".card").length,
      items: Number(document.querySelector(".result-count strong")?.textContent?.replace(/,/g, "")),
    };
  });
  summary.coldLoad = { usableMs: Math.round(usable), ...timing, initialImageRequests: images.length, cache: "empty browser context" };
  await context.close();
}

// ------------------------------------------------------------------ search and filters

const { context, page } = await freshPage();
await page.goto(BASE);
await page.locator(".card img.is-shown").first().waitFor();

// Real input events. In the page: each keydown/click records its timestamp; a MutationObserver
// records when the rendered query changes; a frame callback after that records the paint.
await page.evaluate(() => {
  const main = document.querySelector("main");
  window.__inputs = [];
  window.__renders = [];
  const input = document.querySelector(".search-input");
  input.addEventListener("keydown", (e) => {
    const at = e.timeStamp;
    setTimeout(() => window.__inputs.push({ at, kind: "key", expect: input.value }), 0);
  });
  document.querySelector(".rail").addEventListener("click", (e) => window.__inputs.push({ at: e.timeStamp, kind: "facet" }), true);
  new MutationObserver(() => {
    const committed = performance.now();
    const query = main.dataset.renderedQuery;
    requestAnimationFrame(() => setTimeout(() => window.__renders.push({ committed, painted: performance.now(), query }), 0));
  }).observe(main, { attributes: true, attributeFilter: ["data-rendered-query"] });
});

const searchBox = page.locator(".search-input");
await searchBox.click();
const queries = ["agent", "design system", "typography", "react", "claude code", "video", "@karpathy", "figma"];
for (const q of queries) {
  await page.keyboard.type(q, { delay: 110 });
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape"); // clears the search
  await page.waitForTimeout(250);
}
const facetNames = ["Design inspiration", "Engineering", "Career & work", "Photos", "Several media", "Videos", "Text only", "Text cut short"];
for (let round = 0; round < 3; round++) {
  for (const name of facetNames) {
    const box = page.getByRole("checkbox", { name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`) }).first();
    await box.click();
    await page.waitForTimeout(200);
    await box.click();
    await page.waitForTimeout(200);
  }
}
await page.waitForTimeout(400);
const { inputs, renders } = await page.evaluate(() => ({ inputs: window.__inputs, renders: window.__renders }));
const typing = [];
const facets = [];
const qOf = (query) => new URLSearchParams(query).get("q") ?? "";
for (const [i, input] of inputs.entries()) {
  const next = inputs[i + 1]?.at ?? Infinity;
  if (input.kind === "key") {
    // The result for this keystroke, unless the next keystroke superseded it (stale work is skipped).
    const render = renders.find((r) => r.committed >= input.at && qOf(r.query) === input.expect);
    if (render && render.committed < next) typing.push(render.painted - input.at);
  } else {
    const render = renders.find((r) => r.committed >= input.at);
    if (render && render.committed < next) facets.push(render.painted - input.at);
  }
}
summary.search = {
  keystrokes: stats(typing),
  facetToggles: stats(facets),
  method: "real key and mouse events, 110 ms between keys; event timestamp → rendered query committed (MutationObserver) → next frame",
};
await page.goto(BASE);
await page.locator(".card img.is-shown").first().waitFor();

// ------------------------------------------------------------------ rapid scroll

await browser.startTracing(page, { path: join(OUT, "scroll-trace.json"), screenshots: false });
const scroll = await page.evaluate(async () => {
  const longTasks = [];
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(Math.round(e.duration))));
  observer.observe({ type: "longtask", buffered: false });
  const frames = [];
  let maxCards = 0;
  let maxNodes = 0;
  const max = document.documentElement.scrollHeight - innerHeight;
  async function run(direction, step) {
    let last = performance.now();
    for (;;) {
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      window.scrollBy(0, direction * step);
      maxCards = Math.max(maxCards, document.querySelectorAll(".card").length);
      maxNodes = Math.max(maxNodes, document.getElementsByTagName("*").length);
      if ((direction > 0 && scrollY >= max - 1) || (direction < 0 && scrollY <= 0)) break;
    }
  }
  await run(1, 180);
  await run(-1, 260);
  await run(1, 400);
  await new Promise((r) => setTimeout(r, 300));
  observer.disconnect();
  frames.sort((a, b) => a - b);
  return {
    scrolledPx: max,
    frames: frames.length,
    frameP50: +frames[Math.floor(frames.length * 0.5)].toFixed(1),
    frameP95: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
    framesOver50ms: frames.filter((f) => f > 50).length,
    longTasks,
    maxMountedCards: maxCards,
    maxDomNodes: maxNodes,
  };
});
await browser.stopTracing();
summary.scroll = { ...scroll, method: "scrollBy 180/260/400 px per animation frame: down, up, down over the full library" };

// ------------------------------------------------------------------ open/close cycles

const cdp = await context.newCDPSession(page);
await page.evaluate(() => scrollTo(0, 0));
await page.waitForTimeout(300);
async function counters() {
  await cdp.send("HeapProfiler.collectGarbage");
  const dom = await cdp.send("Memory.getDOMCounters");
  const heap = await cdp.send("Runtime.getHeapUsage");
  return { nodes: dom.nodes, listeners: dom.jsEventListeners, heapMB: +(heap.usedSize / 2 ** 20).toFixed(1) };
}
const samples = [{ cycle: 0, ...(await counters()) }];
const openTimes = [];
for (let i = 1; i <= 40; i++) {
  // Locator waits do not return element handles, which would keep closed views alive.
  const t0 = Date.now();
  await page.locator(".card--media .card-link").nth(i % 6).click();
  await page.locator(".detail .stage-img.is-sharp, .detail .page").first().waitFor();
  openTimes.push(Date.now() - t0);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(120);
  await page.keyboard.press("Escape");
  await page.locator(".detail").waitFor({ state: "detached" });
  if (i % 20 === 0) samples.push({ cycle: i, ...(await counters()) });
}
summary.openClose = { cycles: 40, samples, openToSharpImageMs: stats(openTimes), method: "click card → sharp detail image decoded → step → Escape; DOM/listener/heap counters after forced GC at 0, 20 and 40 cycles" };

await context.close();
await browser.close();

writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
