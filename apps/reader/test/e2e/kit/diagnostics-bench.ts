import type { BrowserContext, Page } from "@playwright/test";
import { appendFileSync, readFileSync } from "node:fs";
import { epubVariant } from "../helpers/epub-variants";
import { withSyntheticTables } from "../helpers/synthetic-tables";

const CHAPTER_ONE = "OEBPS/4269428405154643194_11-h-1.htm.xhtml";
const TABLES_PER_DENSITY = 11;

/**
 * The EPUB to measure: the file at `KIT_EPUB`, or else the sample book with
 * its first chapter 20 times over and synthetic tables at
 * `KIT_TABLE_DENSITY` times a systems book's average density.
 */
function epubBytes(): Uint8Array {
  // A plain Uint8Array: Playwright passes a typed array, not a Buffer.
  if (process.env.KIT_EPUB)
    return new Uint8Array(readFileSync(process.env.KIT_EPUB));
  const density = Number(process.env.KIT_TABLE_DENSITY ?? "0");
  const variant = epubVariant({
    name: `tables-${density}x`,
    title: `Tables ${density}x`,
    author: "Test Author",
    documents: {
      [CHAPTER_ONE]: (xhtml) =>
        xhtml.replace(
          /(<\/h2>)([\s\S]*)(<\/div><\/body>)/,
          (_, heading: string, text: string, end: string) =>
            heading +
            withSyntheticTables(
              text.repeat(20),
              Math.round(density * TABLES_PER_DENSITY),
            ) +
            end,
        ),
    },
  });
  return new Uint8Array(variant.buffer);
}

let bytes: Uint8Array | null = null;

/**
 * agent-kit `time` steps for `/diagnostics/reader` (add `?profile=ipad` for
 * an iPad, `?tables=grid` for real tables): loads an EPUB in memory, without
 * importing it, through the Reader's real chapter pipeline and pagination
 * worker, and waits for full pagination.
 *
 * Returns the total that `KIT_METRIC` names, over the chapters in
 * `KIT_CHAPTERS` (comma-separated indices; all by default): `decorate`
 * (main-thread parse into blocks, the default), `source` (body-cache
 * rebuild), `prepare` and `layout` (worker stages) or `ready` (load to full
 * pagination). With `KIT_RECORD`, appends one JSON line per run with every
 * chapter's figures and the main thread's JavaScript heap.
 */
export default async function bench({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  bytes ??= epubBytes();
  await page.reload();
  await page.waitForFunction(() => window.__EPUB_READER_DIAGNOSTICS__);
  const startedAt = Date.now();
  await page.evaluate(
    (payload) =>
      window.__EPUB_READER_DIAGNOSTICS__!.loadEpub({
        name: "bench.epub",
        bytes: new Uint8Array(payload),
      }),
    bytes,
  );
  await page.evaluate(() =>
    window.__EPUB_READER_DIAGNOSTICS__!.waitForReady({ timeoutMs: 170_000 }),
  );
  const readyMs = Date.now() - startedAt;
  const diagnostics = await page.evaluate(() =>
    window.__EPUB_READER_DIAGNOSTICS__!.getPaginationDiagnostics(),
  );
  const chapters = process.env.KIT_CHAPTERS?.split(",").map(Number);
  const wanted = (index: number) => !chapters || chapters.includes(index);
  const worker = diagnostics.worker?.chapterTimings ?? [];
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const totals = {
    decorate: sum(
      diagnostics.build
        .filter((c) => wanted(c.chapterIndex))
        .map((c) => c.decorateMs),
    ),
    source: sum(
      diagnostics.build
        .filter((c) => wanted(c.chapterIndex))
        .map((c) => c.sourceMs),
    ),
    prepare: sum(
      worker
        .filter((c) => wanted(c.chapterIndex))
        .map((c) => c.stage2PrepareMs ?? 0),
    ),
    layout: sum(
      worker
        .filter((c) => wanted(c.chapterIndex))
        .map((c) => c.stage3LayoutMs ?? 0),
    ),
    ready: readyMs,
  };
  if (process.env.KIT_RECORD) {
    const heap = await heapUsage(page, context);
    appendFileSync(
      process.env.KIT_RECORD,
      `${JSON.stringify({
        totals,
        heap,
        chapters: worker.map((c) => {
          const build = diagnostics.build.find(
            (b) => b.chapterIndex === c.chapterIndex,
          );
          return [
            c.chapterIndex,
            round(build?.sourceMs),
            round(build?.decorateMs),
            round(c.stage2PrepareMs),
            round(c.stage3LayoutMs),
            c.pageCount,
            c.lineCount,
          ];
        }),
      })}\n`,
    );
  }
  const metric = (process.env.KIT_METRIC ?? "decorate") as keyof typeof totals;
  return totals[metric];
}

/**
 * JavaScript heap in use after a garbage collection, in bytes: the page's
 * main thread and the pagination worker (Chromium only).
 */
async function heapUsage(page: Page, context: BrowserContext) {
  const browser = context.browser();
  if (!browser || browser.browserType().name() !== "chromium") return null;
  const session = await context.newCDPSession(page);
  await session.send("HeapProfiler.collectGarbage");
  const main = (await session.send("Runtime.getHeapUsage")).usedSize;
  await session.detach();
  // A dedicated worker is reachable only from the browser's own session.
  const root = await browser.newBrowserCDPSession();
  const { targetInfos } = await root.send("Target.getTargets");
  const target = targetInfos.find(
    (info) => info.type === "worker" && info.url.includes("pagination"),
  );
  let worker: number | null = null;
  if (target) {
    const { sessionId } = await root.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    let id = 0;
    const call = (method: string) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const callId = ++id;
        const listener = (event: { message: string }) => {
          const reply = JSON.parse(event.message);
          if (reply.id !== callId) return;
          root.off("Target.receivedMessageFromTarget", listener);
          resolve(reply.result ?? {});
        };
        root.on("Target.receivedMessageFromTarget", listener);
        void root.send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id: callId, method }),
        });
      });
    await call("HeapProfiler.collectGarbage");
    worker = Number((await call("Runtime.getHeapUsage")).usedSize);
    await root.send("Target.detachFromTarget", { sessionId });
  }
  await root.detach();
  return { main, worker };
}

function round(value: number | undefined): number | null {
  return value === undefined ? null : Math.round(value * 10) / 10;
}
