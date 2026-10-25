import {
  test,
  expect,
  openLocalBook,
  currentPages,
  nextSpread,
  openReaderTools,
  selectPassage,
  waitForReaderReady,
  waitForSheet,
} from "./helpers/fixtures";

test("desktop shows the status prompt in the header and contents open a chapter", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  const accessory = page.locator("[data-reader-header-accessory]");
  await expect(
    accessory.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible();
  await page.locator('[data-reader-header="desktop"]').hover();
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  const chapter = tools.getByRole("button", {
    name: /CHAPTER II\. The Pool of Tears/i,
  });
  const before = await currentPages(page);
  await chapter.click();
  await expect(chapter).toHaveAttribute("aria-current", "location");
  await expect.poll(() => currentPages(page)).not.toEqual(before);
});

test("desktop notebook highlights navigate to the marked passage", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const markedPages = await currentPages(page);
  await selectPassage(page, { length: 40 });
  await page.getByRole("button", { name: "Highlight with yellow" }).click();
  const mark = page
    .locator('[data-reader-spread-layer="current"] [data-highlight-id]')
    .first();
  await expect(mark).toBeVisible();
  const id = await mark.getAttribute("data-highlight-id");
  for (let i = 0; i < 3; i++) await nextSpread(page);
  await page.locator('[data-reader-header="desktop"]').hover();
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  await tools.getByRole("button", { name: /^Go to highlight:/ }).click();
  await expect.poll(() => currentPages(page)).toEqual(markedPages);
  await expect(
    page
      .locator(
        `[data-reader-spread-layer="current"] [data-highlight-id="${id}"]`,
      )
      .first(),
  ).toBeVisible();
});

test.describe("mobile Reader accessories", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("offers the reading status and loads the book cover", async ({
    page,
    localBook,
  }) => {
    await openLocalBook(page, localBook.id);
    await expect(
      page.getByRole("button", { name: "Mark as reading", exact: true }),
    ).toBeVisible();
    await page.touchscreen.tap(195, 350);
    const tools = await openReaderTools(page);
    await tools.getByRole("button", { name: /Book status/ }).click();
    const status = await waitForSheet(page, "Reading status");
    const cover = status.locator("img");
    await expect(cover).toBeVisible();
    await expect
      .poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
  });
});

for (const mobile of [false, true]) {
  test.describe(`Reader handoff accessory (${mobile ? "mobile" : "desktop"})`, () => {
    test.use({
      viewport: mobile
        ? { width: 390, height: 844 }
        : { width: 1280, height: 850 },
      hasTouch: mobile,
      isMobile: mobile,
    });
    test("continue reading jumps to the other device's position", async ({
      page,
      localBook,
    }) => {
      await page.route("**/api/devices", (route) =>
        route.fulfill({
          json: {
            devices: [{ clientId: "test-tablet", deviceName: "Test tablet" }],
          },
        }),
      );
      await openLocalBook(page, localBook.id);
      await page.evaluate(async (bookId) => {
        const path = "/src/lib/db.ts";
        const { upsertReadingCheckpoint } = await import(path);
        await upsertReadingCheckpoint({
          bookId,
          deviceId: "test-tablet",
          currentSpineIndex: 4,
          scrollProgress: 50,
          lastRead: Date.now() + 1000,
        });
      }, localBook.id);
      const accessory = page.locator(
        mobile ? "[data-reader-top-prompt]" : "[data-reader-header-accessory]",
      );
      const action = accessory.getByRole("button", {
        name: /Continue at p\. .* from Test tablet/,
      });
      await expect(action).toBeVisible();
      const before = await currentPages(page);
      if (!mobile) {
        await expect(
          action.locator("[data-reader-jump-direction]"),
        ).toHaveAttribute("data-reader-jump-direction", "forward");
      }
      await action.click();
      await expect.poll(() => currentPages(page)).not.toEqual(before);
      await expect(action).toHaveCount(0);
      if (mobile) return;
      // A newly synced checkpoint can be behind the current reading position.
      await page.evaluate(async (bookId) => {
        const path = "/src/lib/db.ts";
        const { upsertReadingCheckpoint } = await import(path);
        await upsertReadingCheckpoint({
          bookId,
          deviceId: "test-tablet",
          currentSpineIndex: 0,
          scrollProgress: 0,
          lastRead: Date.now() + 2000,
        });
      }, localBook.id);
      await expect(
        action.locator("[data-reader-jump-direction]"),
      ).toHaveAttribute("data-reader-jump-direction", "backward");
      await action.click();
      await expect.poll(async () => (await currentPages(page))[0]).toBe("1");
      await expect(action).toHaveCount(0);
      await expect(
        accessory.getByRole("button", { name: "Mark as reading", exact: true }),
      ).toBeVisible();
    });
  });
}

test("desktop status keeps the top toolbar visible until dismissed or saved", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 960, height: 850 });
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  const accessory = header.locator("[data-reader-header-accessory]");
  const readStatus = () =>
    page.evaluate(async (bookId) => {
      const path = "/src/lib/db.ts";
      const { getReadingStatus } = await import(path);
      return getReadingStatus(bookId);
    }, localBook.id);
  const start = accessory.getByRole("button", {
    name: "Mark as reading",
    exact: true,
  });
  await expect(start).toBeVisible();
  await page.mouse.move(480, 400);
  await page.keyboard.press("Escape");
  await expect(header).toHaveCSS("opacity", "1");
  await expect(page.locator("[data-reader-footer]")).toHaveCount(0);
  await accessory
    .getByRole("button", { name: "Dismiss reading status prompt", exact: true })
    .click();
  await page.mouse.move(480, 400);
  await expect(header).toHaveCSS("opacity", "0");
  expect(await readStatus()).toBeNull();
  await page.reload();
  await waitForReaderReady(page);
  await expect(start).toBeVisible();
  await start.click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Changed status to Reading." });
  await expect(toast).toBeVisible();
  await expect.poll(readStatus).toBe("reading");
  await expect(accessory).toHaveCount(0);
  await page.mouse.move(480, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await page.reload();
  await waitForReaderReady(page);
  await expect(accessory).toHaveCount(0);
});

// Opened on desktop and finished on a phone, so the prompt survives a resize.
test("offers to finish at the last page", async ({ page, localBook }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  await page
    .getByRole("button", {
      name: "Dismiss reading status prompt",
      exact: true,
    })
    .click();
  await page.mouse.move(600, 20);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await page.getByRole("button", { name: /CHAPTER XII\./i }).click();
  await page
    .getByRole("navigation", { name: "Reader tools" })
    .getByRole("button", { name: "Close reader tools", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForReaderReady(page);
  const finish = page.getByRole("button", {
    name: "Mark as finished",
    exact: true,
  });
  await expect(finish).toHaveCount(0);
  for (let turn = 0; turn < 60 && !(await finish.isVisible()); turn++) {
    await nextSpread(page);
  }
  await expect(finish).toBeVisible();
  await expect(page.locator("[data-reader-top-prompt]")).toContainText(
    "Mark as finished",
  );
  const readStatus = () =>
    page.evaluate(async (id) => {
      const path = "/src/lib/db.ts";
      return (await import(path)).getReadingStatus(id);
    }, localBook.id);
  expect(await readStatus()).toBeNull();
  await finish.click();
  await expect.poll(readStatus).toBe("finished");
  await expect(page.locator("[data-sonner-toast]")).toContainText(
    "Changed status to Finished.",
  );
  await expect(finish).toHaveCount(0);
  await page
    .locator("[data-sonner-toast]")
    .getByRole("button", { name: "Back to library", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await openLocalBook(page, localBook.id);
  await waitForReaderReady(page);
  await expect(finish).toHaveCount(0);
  expect(await readStatus()).toBe("finished");
});
