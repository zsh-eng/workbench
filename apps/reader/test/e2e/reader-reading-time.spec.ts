import type { Page } from "@playwright/test";
import { expect, nextSpread, openLocalBook, test } from "./helpers/fixtures";

// Reader's longest quiet stretch follows the device, not the window: three
// minutes on a phone, five on a tablet or desktop (READING_TIME.md). Chrome
// on Android: Chromium as a mobile browser with touch, and the screen behind
// the window (packages/elements/docs/SIZE_CLASSES.md).
test.use({ isMobile: true, hasTouch: true });

/** The open session's row for the book, as this device stored it. */
function openSession(page: Page, bookId: string) {
  return page.evaluate(async (id) => {
    const path = "/src/lib/db.ts";
    const { getBookReadingSessions } = await import(path);
    const rows: {
      endedAt: number | null;
      activeMs: number;
      lastActiveAt: number;
      gapMs?: number;
    }[] = await getBookReadingSessions(id);
    const open = rows.find((row) => row.endedAt === null);
    return open && { ...open, gapMs: open.gapMs ?? null };
  }, bookId);
}

/**
 * Turns a page after `quietMs` without input, and returns the open row once
 * it has saved that turn.
 */
async function turnAfter(page: Page, bookId: string, quietMs: number) {
  await page.clock.fastForward(quietMs);
  const at = await page.evaluate(() => Date.now());
  await nextSpread(page);
  await expect
    .poll(async () => (await openSession(page, bookId))?.lastActiveAt ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(at);
  return (await openSession(page, bookId))!;
}

test.describe("A phone on its side", () => {
  test.use({
    viewport: { width: 844, height: 340 },
    contextOptions: { screen: { width: 844, height: 390 } },
  });

  test("counts nothing of a four-minute quiet stretch, and a minute's", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await page.clock.install();
    const first = await turnAfter(page, localBook.id, 1_000);
    expect(first.gapMs).toBe(180_000);

    // A turn is a key and then a new page: only the moment between them counts.
    const late = await turnAfter(page, localBook.id, 240_000);
    expect(late.activeMs - first.activeMs).toBeLessThan(10_000);

    const soon = await turnAfter(page, localBook.id, 60_000);
    expect(soon.activeMs).toBeGreaterThanOrEqual(first.activeMs + 60_000);
    expect(soon.gapMs).toBe(180_000);
  });
});

test.describe("A tablet window beside another app", () => {
  test.use({
    viewport: { width: 500, height: 1100 },
    contextOptions: { screen: { width: 820, height: 1180 } },
  });

  test("counts a four-minute quiet stretch", async ({ page, localBook }) => {
    await openLocalBook(page, localBook.id);
    await page.clock.install();
    const first = await turnAfter(page, localBook.id, 1_000);
    expect(first.gapMs).toBe(300_000);

    const late = await turnAfter(page, localBook.id, 240_000);
    expect(late.activeMs).toBeGreaterThanOrEqual(first.activeMs + 240_000);
    expect(late.gapMs).toBe(300_000);
  });
});
