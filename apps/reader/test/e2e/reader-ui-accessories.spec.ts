import {
  test,
  expect,
  openLocalBook,
  currentPages,
  nextSpread,
  waitForReaderReady,
} from "./helpers/fixtures";

test("desktop keeps status at the header and gives contents continuous hover rows", async ({
  page,
  localBook,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  const accessory = page.locator("[data-reader-header-accessory]");
  await expect(
    accessory.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible();
  const promptBounds = (await accessory.boundingBox())!;
  expect(promptBounds.y).toBeLessThan(100);
  expect(promptBounds.x).toBeGreaterThan(640);
  expect(promptBounds.height).toBe(36);
  await page.locator('[data-reader-header="desktop"]').hover();
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  const rows = tools.locator("button[aria-current], button.group");
  const first = rows.nth(0);
  const second = rows.nth(1);
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1);
  await page.mouse.move(b.x + b.width / 2, b.y + 1);
  await expect(second.locator("span.pointer-events-none")).toHaveCSS(
    "opacity",
    "1",
  );
  const chapter = tools.getByRole("button", {
    name: /CHAPTER II\. The Pool of Tears/i,
  });
  const before = await currentPages(page);
  await chapter.hover();
  await page.mouse.down();
  await expect(chapter).toHaveCSS(
    "transform",
    "matrix(0.97, 0, 0, 0.97, 0, 0)",
  );
  await page.mouse.up();
  await expect(chapter).toHaveCSS("transform", "none");
  await expect(chapter).toHaveAttribute("aria-current", "location");
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  expect(
    await chapter.evaluate((element) =>
      element
        .getAnimations({ subtree: true })
        .some((animation) =>
          animation.effect
            ?.getKeyframes()
            .some((frame) => "transform" in frame),
        ),
    ),
  ).toBe(false);
  await tools
    .getByRole("button", { name: "Reading appearance", exact: true })
    .click();
  const viewport = tools.locator('[data-slot="scroll-area-viewport"]');
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(viewport).toHaveCSS("mask-image", "none");
  await page.screenshot({
    path: testInfo.outputPath("desktop-appearance.png"),
  });
  // Highlights live in the notebook; there is no separate tab.
  await expect(
    tools.getByRole("button", { name: "Highlights", exact: true }),
  ).toHaveCount(0);
});

test("desktop notebook highlights navigate to the marked passage and retain the tab", async ({
  page,
  localBook,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  const markedPages = await currentPages(page);
  await page.evaluate(() => {
    const root = document.querySelector(
      '[data-reader-spread-layer="current"]',
    )!;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && (node.textContent?.trim().length ?? 0) < 40)
      node = walker.nextNode();
    if (!node) throw new Error("No passage");
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 40);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString().length))
    .toBe(40);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
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
  await page.screenshot({
    path: testInfo.outputPath("desktop-highlights.png"),
  });
  await page.reload();
  await waitForReaderReady(page);
  await page.locator('[data-reader-header="desktop"]').hover();
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await expect(
    tools.getByRole("button", { name: "Notebook", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    tools.getByRole("button", { name: /^Go to highlight:/ }),
  ).toHaveCount(1);
});

test.describe("mobile Reader accessories", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("keeps status at the footer and loads the book cover", async ({
    page,
    localBook,
  }, testInfo) => {
    await openLocalBook(page, localBook.id);
    await expect(page.locator("[data-reader-header-accessory]")).toHaveCount(0);
    await expect(
      page
        .locator("[data-reader-footer]")
        .getByRole("button", { name: "Start reading", exact: true }),
    ).toBeVisible();
    await page.touchscreen.tap(195, 350);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Highlights", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Book status/ }).click();
    const cover = page
      .getByRole("dialog", { name: "Reading status", exact: true })
      .locator("img");
    await expect(cover).toBeVisible();
    await expect
      .poll(() => cover.evaluate((img) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("mobile-status-cover.png"),
    });
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
    test("pins continue reading to the matching chrome edge", async ({
      page,
      localBook,
    }, testInfo) => {
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
        mobile ? "[data-reader-footer]" : "[data-reader-header-accessory]",
      );
      const action = accessory.getByRole("button", {
        name: mobile
          ? /Continue from Test tablet/
          : /Continue at p\. .* from Test tablet/,
      });
      await expect(action).toBeVisible();
      const bounds = (await action.boundingBox())!;
      expect(mobile ? bounds.y > 500 : bounds.y < 150 && bounds.x > 640).toBe(
        true,
      );
      const before = await currentPages(page);
      if (!mobile) {
        await page.mouse.move(640, 400);
        await expect(page.locator('[data-reader-header="desktop"]')).toHaveCSS(
          "opacity",
          "1",
        );
        await expect(
          action.locator("[data-reader-jump-direction]"),
        ).toHaveAttribute("data-reader-jump-direction", "forward");
      }
      await page.screenshot({
        path: testInfo.outputPath("handoff-prompt.png"),
      });
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
}, testInfo) => {
  await page.setViewportSize({ width: 960, height: 850 });
  await openLocalBook(page, localBook.id);
  const header = page.locator('[data-reader-header="desktop"]');
  const title = header.locator("[data-reader-header-title]");
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
  await expect(title).toHaveCSS("text-align", "left");
  const t = (await title.boundingBox())!;
  const a = (await accessory.boundingBox())!;
  expect(t.x + t.width).toBeLessThanOrEqual(a.x);
  await page.screenshot({
    path: testInfo.outputPath("compact-desktop-status.png"),
  });
  await accessory
    .getByRole("button", { name: "Dismiss reading status prompt", exact: true })
    .click();
  await page.mouse.move(480, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await expect(title).toHaveCSS("text-align", "center");
  expect(await readStatus()).toBeNull();
  await page.reload();
  await waitForReaderReady(page);
  await expect(start).toBeVisible();
  await start.click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Changed status to Reading." });
  await expect(toast).toBeVisible();
  await expect(toast.locator("[data-description]")).toHaveCount(0);
  await expect(toast).toHaveCSS("border-radius", "28px");
  const message = toast.locator("[data-title]");
  expect(
    await message.evaluate(
      (node) =>
        node.getBoundingClientRect().height <=
        parseFloat(getComputedStyle(node).lineHeight) + 1,
    ),
  ).toBe(true);
  await expect.poll(readStatus).toBe("reading");
  await expect(accessory).toHaveCount(0);
  await page.mouse.move(480, 400);
  await expect(header).toHaveCSS("opacity", "0");
  await page.reload();
  await waitForReaderReady(page);
  await expect(accessory).toHaveCount(0);
});

for (const mobile of [false, true]) {
  test(`offers to finish at the last page on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
    localBook,
  }, testInfo) => {
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
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
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
    await expect(
      page.locator(
        mobile ? "[data-reader-footer]" : '[data-reader-header="desktop"]',
      ),
    ).toContainText("Mark as finished");
    const readStatus = () =>
      page.evaluate(async (id) => {
        const path = "/src/lib/db.ts";
        return (await import(path)).getReadingStatus(id);
      }, localBook.id);
    expect(await readStatus()).toBeNull();
    await page.screenshot({ path: testInfo.outputPath("finish-prompt.png") });
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
}
