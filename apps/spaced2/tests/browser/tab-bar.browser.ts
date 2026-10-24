// Layering needs real layout, so these tests drive the dev server in Chromium.
// Run with `bun run test:browser`; `bun run test` does not include them.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

const port = Number(process.env.SPACED_BROWSER_PORT ?? 5249);
const origin = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn>;
let browser: Browser;

beforeAll(async () => {
  server = Bun.spawn(
    [
      "./node_modules/.bin/vite",
      "--host",
      "127.0.0.1",
      "--port",
      `${port}`,
      "--strictPort",
    ],
    { cwd: `${import.meta.dir}/../..`, stdout: "ignore", stderr: "inherit" },
  );
  for (let tries = 0; ; tries++) {
    if (
      await fetch(origin).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    if (tries > 100) throw new Error(`No dev server on ${origin}`);
    await Bun.sleep(100);
  }
  browser = await chromium.launch();
}, 30_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

/** An iPhone-sized page, signed out, with the home indicator's inset. */
async function phone(): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const side = { top: 0, left: 0, right: 0, bottom: 34 };
  await cdp
    .send("Emulation.setSafeAreaInsetsOverride", {
      insets: {
        ...side,
        topMax: side.top,
        leftMax: side.left,
        rightMax: side.right,
        bottomMax: side.bottom,
      },
    })
    // Older Chromium has no inset override; env() is then 0.
    .catch(() => {});
  return page;
}

/** Tab centres that a tap would not reach, because something else is on top. */
function coveredTabs(page: Page) {
  // A CSS selector: an open dialog hides the bar from the accessibility tree.
  return page.locator('nav[aria-label="Main"]').evaluate((nav) =>
    [...nav.querySelectorAll("a")].flatMap((tab) => {
      const box = tab.getBoundingClientRect();
      const top = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return tab.contains(top) ? [] : [tab.getAttribute("aria-label")];
    }),
  );
}

test("stats content scrolls under the tab bar, never over it, and clears it at the end", async () => {
  const page = await phone();
  await page.goto(`${origin}/profile`);
  await page.evaluate(async () => {
    const { rawDb } = await import("/src/lib/db/persistence.ts");
    const { toStoredOperation } = await import("/src/lib/sync/records.ts");
    const { reviewLogToReviewLogOperation } = await import(
      "/src/lib/review/review.ts"
    );
    const { sampleReviewLogs } = await import("/src/elements/stats-fixture.ts");
    await rawDb.reviewLogOperations.bulkPut(
      sampleReviewLogs(90).map((log: { duration: number }) =>
        toStoredOperation(
          reviewLogToReviewLogOperation(log, crypto.randomUUID(), log.duration),
        ),
      ),
    );
  });
  await page.goto(`${origin}/stats`);
  await page.getByText("Review Activity", { exact: true }).waitFor();

  const end = await page.evaluate(
    () => document.documentElement.scrollHeight - innerHeight,
  );
  expect(end).toBeGreaterThan(0);
  for (let y = 0; y <= end + 100; y += 100) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    expect({ y, covered: await coveredTabs(page) }).toEqual({ y, covered: [] });
  }

  // Scrolled to the end, the last card ends above the bar.
  const bar = (await page
    .getByRole("navigation", { name: "Main" })
    .boundingBox())!;
  const contentEnd = await page
    .locator("main > *")
    .last()
    .evaluate((route) => {
      const box = route.getBoundingClientRect();
      return box.bottom - parseFloat(getComputedStyle(route).paddingBottom);
    });
  expect(contentEnd).toBeLessThanOrEqual(bar.y);

  await page.getByRole("link", { name: "Profile" }).tap();
  await page.waitForURL(`${origin}/profile`);
  await page.context().close();
}, 60_000);

test("a dialog covers the tab bar", async () => {
  const page = await phone();
  await page.goto(`${origin}/profile`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("dialog").waitFor();
  expect(await coveredTabs(page)).toHaveLength(5);
  await page.context().close();
}, 30_000);
