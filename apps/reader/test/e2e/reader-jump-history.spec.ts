import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  currentPages,
  waitForReaderReady,
} from "./helpers/fixtures";
import type { Page } from "@playwright/test";
import type { ReaderJumpHistory } from "../../src/features/reader/jump-history";

async function history(page: Page, bookId: string): Promise<ReaderJumpHistory> {
  return page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("reader-jump-history-v1") ?? "[]").find(
        (record: { bookId: string }) => record.bookId === id,
      )?.history,
    bookId,
  );
}

test("records committed scrub and normal visits across reload and offline reflow", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await nextSpread(page);
  const before = await history(page, localBook.id);
  const beforePages = await currentPages(page);
  expect(before.entries.map((entry) => entry.kind)).toEqual(["normal"]);
  await page.locator('[data-reader-chrome-rail="bottom"]').hover();
  const scrubber = page.locator("canvas.cursor-ew-resize");
  await expect(scrubber).toBeVisible();
  const bounds = await scrubber.boundingBox();
  if (!bounds) throw new Error("Missing scrubber");
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 90, center.y, { steps: 10 });
  await expect.poll(() => currentPages(page)).not.toEqual(beforePages);
  expect(await history(page, localBook.id)).toEqual(before);
  await page.mouse.up();
  await expect
    .poll(async () =>
      (await history(page, localBook.id)).entries.map((entry) => entry.kind),
    )
    .toEqual(["normal", "scrubber"]);
  await page.mouse.move(500, 300);
  await nextSpread(page);
  await nextSpread(page);
  await expect
    .poll(async () =>
      (await history(page, localBook.id)).entries.map((entry) => entry.kind),
    )
    .toEqual(["normal", "scrubber", "normal"]);
  const saved = await history(page, localBook.id);
  const pages = await currentPages(page);
  await page.reload();
  await waitForReaderReady(page);
  await expect.poll(() => currentPages(page)).toEqual(pages);
  expect(await history(page, localBook.id)).toEqual(saved);
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1000, height: 650 });
  await waitForReaderReady(page);
  expect(await history(page, localBook.id)).toEqual(saved);
  const blockId = saved.entries[saved.cursor].anchor.blockId;
  await expect(
    page
      .locator(
        `[data-reader-spread-layer="current"] [data-reader-block-id="${blockId}"]`,
      )
      .first(),
  ).toBeVisible();
});

test("coalesces contents jumps and adds a separate normal navigation visit", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  await page.mouse.move(600, 20);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page
    .getByRole("button", { name: /CHAPTER II\. The Pool of Tears/i })
    .click();
  await expect
    .poll(async () => (await history(page, localBook.id)).entries.length)
    .toBe(2);
  const previousChapter = (await history(page, localBook.id)).entries.at(-1)!
    .anchor.chapterIndex;
  await page
    .getByRole("button", { name: /CHAPTER III\. A Caucus-Race/i })
    .click();
  await expect
    .poll(
      async () =>
        (await history(page, localBook.id)).entries.at(-1)?.anchor.chapterIndex,
    )
    .not.toBe(previousChapter);
  expect((await history(page, localBook.id)).entries).toHaveLength(2);
  await page
    .getByRole("navigation", { name: "Reader tools" })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();
  await nextSpread(page);
  await nextSpread(page);
  expect(
    (await history(page, localBook.id)).entries.map((entry) => entry.kind),
  ).toEqual(["normal", "toc", "normal"]);
});

// The phone is the primary device; on desktop the strip only differs in how
// the footer is revealed.
test.describe("history footer", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("returns to real visits, stays quiet while reading, and restores the trail", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await nextSpread(page);
    const start = (await currentPages(page))[0];
    const reveal = async () => {
      await page.touchscreen.tap(195, 350);
      await expect(page.getByTestId("history-strip")).toBeInViewport();
    };
    await reveal();
    const strip = page.getByTestId("history-strip");
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    await page
      .locator("[data-reader-footer]")
      .getByRole("button", { name: "Next chapter", exact: true })
      .click();
    await expect(strip).toHaveAttribute("data-mode", "history");
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(1);
    const currentVisit = strip.locator('[aria-current="location"]');
    await expect(currentVisit).toBeEnabled();
    const destination = (await currentVisit
      .locator(".history-strip-number")
      .textContent())!;
    expect(await currentPages(page)).toContain(destination);
    const trail = await history(page, localBook.id);
    const earlier = strip.getByRole("button", {
      name: `Earlier visit: page ${start}, Reading`,
      exact: true,
    });
    await expect(earlier).toBeEnabled();
    await earlier.click();
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(0);
    await expect.poll(async () => (await currentPages(page))[0]).toBe(start);
    await strip
      .getByRole("button", {
        name: `Later visit: page ${destination}, Chapter`,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await currentPages(page))[0])
      .toBe(destination);
    expect((await history(page, localBook.id)).entries).toEqual(trail.entries);
    // Arrow keys in the strip traverse history, rather than turning a page.
    await strip
      .getByRole("button", {
        name: `Current page ${destination}, Chapter`,
        exact: true,
      })
      .press("ArrowLeft");
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(0);
    await page.reload();
    await waitForReaderReady(page);
    await reveal();
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    expect((await history(page, localBook.id)).entries).toEqual(trail.entries);
    await strip.getByRole("button", { name: /Show jump history/ }).click();
    await strip
      .getByRole("button", {
        name: `Later visit: page ${destination}, Chapter`,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(1);
    // Move focus out of history before normal reader keyboard navigation.
    await page
      .locator('[data-reader-spread-layer="current"]')
      .first()
      .click({ position: { x: 100, y: 100 } });
    await nextSpread(page);
    await expect
      .poll(
        async () => (await history(page, localBook.id)).entries.at(-1)?.kind,
      )
      .toBe("normal");
    if (!(await strip.count())) await reveal();
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    const peek = page.locator("[data-reader-progress-peek]");
    await expect(peek.getByTestId("history-strip")).toHaveCount(0);
    await expect(peek.getByTestId("reader-peek-page-indicator")).toHaveCount(1);
  });

  test("a drag along the strip scrubs the trail, previewing each visit until it lets go", async ({
    page,
    localBook,
  }) => {
    const readPosition = () =>
      page.evaluate(async (bookId) => {
        const modulePath = "/src/lib/db.ts";
        const checkpoint = await (
          await import(modulePath)
        ).getCurrentDeviceReadingCheckpoint(bookId);
        return (
          checkpoint && [
            checkpoint.currentSpineIndex,
            checkpoint.scrollProgress,
          ]
        );
      }, localBook.id);
    const strip = page.getByTestId("history-strip");
    const reveal = async () => {
      if (!(await strip.isVisible())) await page.touchscreen.tap(195, 350);
      await expect(strip).toBeInViewport();
    };
    await openLocalBook(page, localBook.id);
    await nextSpread(page);
    const start = (await currentPages(page))[0];
    await expect.poll(readPosition).toBeTruthy();
    const startPosition = await readPosition();
    // A trail of three visits: here, the next chapter, and a page on.
    await reveal();
    await page
      .locator("[data-reader-footer]")
      .getByRole("button", { name: "Next chapter", exact: true })
      .click();
    await expect
      .poll(async () => (await currentPages(page))[0])
      .not.toBe(start);
    const chapter = (await currentPages(page))[0];
    await page.touchscreen.tap(195, 350);
    await expect(strip).toHaveCount(0);
    await nextSpread(page);
    const here = (await currentPages(page))[0];
    await expect
      .poll(async () => (await history(page, localBook.id)).entries.length)
      .toBe(3);
    const trail = await history(page, localBook.id);
    await expect.poll(readPosition).not.toEqual(startPosition);
    const herePosition = await readPosition();
    await reveal();
    await expect(strip).toHaveAttribute("data-mode", "quiet");

    // Real touches: a drag to the right brings earlier visits to the centre.
    // Aim once the footer has finished rising.
    await expect
      .poll(() =>
        strip.evaluate(
          (element) =>
            new Promise<boolean>((resolve) => {
              const top = element.getBoundingClientRect().top;
              requestAnimationFrame(() =>
                resolve(element.getBoundingClientRect().top === top),
              );
            }),
        ),
      )
      .toBe(true);
    const cdp = await page.context().newCDPSession(page);
    const box = (await strip.boundingBox())!;
    const y = box.y + box.height / 2;
    const from = box.x + box.width / 2;
    let x = from;
    const touch = (type: "touchStart" | "touchMove") =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: [{ x, y }],
      });
    const dragTo = async (to: number) => {
      while (x !== to) {
        x += Math.sign(to - x) * Math.min(6, Math.abs(to - x));
        await touch("touchMove");
      }
    };
    const lift = (type: "touchEnd" | "touchCancel") =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [] });
    const pitch = 72;

    // Each visit shows while the finger holds it, and nothing is saved.
    await touch("touchStart");
    await dragTo(from + pitch + 20);
    await expect(strip).toHaveAttribute("data-mode", "history");
    await expect.poll(async () => (await currentPages(page))[0]).toBe(chapter);
    await dragTo(from + 2 * pitch + 20);
    await expect.poll(async () => (await currentPages(page))[0]).toBe(start);
    expect(await history(page, localBook.id)).toEqual(trail);
    expect(await readPosition()).toEqual(herePosition);
    // A cancelled touch returns to where the reader was.
    await lift("touchCancel");
    await expect.poll(async () => (await currentPages(page))[0]).toBe(here);
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    expect(await history(page, localBook.id)).toEqual(trail);

    // So does letting go back on the visit the drag began from.
    x = from;
    await touch("touchStart");
    await dragTo(from + pitch + 20);
    await expect.poll(async () => (await currentPages(page))[0]).toBe(chapter);
    await dragTo(from - 10);
    await expect.poll(async () => (await currentPages(page))[0]).toBe(here);
    await lift("touchEnd");
    await expect(strip).toHaveAttribute("data-mode", "quiet");
    expect(await history(page, localBook.id)).toEqual(trail);
    expect(await readPosition()).toEqual(herePosition);

    // Letting go on a visit takes it: history moves there and it is saved.
    x = from;
    await touch("touchStart");
    await dragTo(from + 2 * pitch + 10);
    await lift("touchEnd");
    await expect.poll(async () => (await currentPages(page))[0]).toBe(start);
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(0);
    expect((await history(page, localBook.id)).entries).toEqual(trail.entries);
    await expect.poll(readPosition).toEqual(startPosition);
    await expect(strip.locator("[data-selected]")).toHaveAttribute(
      "aria-current",
      "location",
    );

    // A tap still hops.
    const later = strip.getByRole("button", {
      name: `Later visit: page ${chapter}, Chapter`,
      exact: true,
    });
    const target = (await later.boundingBox())!;
    await page.touchscreen.tap(
      target.x + target.width / 2,
      target.y + target.height / 2,
    );
    await expect.poll(async () => (await currentPages(page))[0]).toBe(chapter);
    await expect
      .poll(async () => (await history(page, localBook.id)).cursor)
      .toBe(1);
  });
});
