import { test, expect } from "./helpers/fixtures";

test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
});

test("Elements shows a specimen on desktop and phone and changes it in place", async ({
  page,
}) => {
  await page.goto("/debug/elements");
  const section = page.locator("#chrome");
  await section.scrollIntoViewIfNeeded();
  const frames = {
    desktop: section.locator('iframe[title$="desktop"]'),
    phone: section.locator('iframe[title$="phone"]'),
  };
  const desktop = frames.desktop.contentFrame();
  const phone = frames.phone.contentFrame();
  await expect(
    desktop.getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  // The phone frame has the phone layout: the prompt floats at the top edge.
  await expect(
    phone
      .locator("[data-reader-top-prompt]")
      .getByRole("button", { name: "Mark as reading", exact: true }),
  ).toBeVisible();

  // A state change reaches both frames without a reload.
  const desktopWindow = (await frames.desktop.elementHandle())!;
  await desktopWindow.evaluate((frame: HTMLIFrameElement) => {
    (frame.contentWindow as Window & { kept?: boolean }).kept = true;
  });
  await section
    .getByRole("button", { name: "Newer position", exact: true })
    .click();
  for (const frame of [desktop, phone])
    await expect(
      frame.getByRole("button", { name: /^Continue at p\. 86 from iPad/ }),
    ).toBeVisible();
  expect(
    await desktopWindow.evaluate(
      (frame: HTMLIFrameElement) =>
        (frame.contentWindow as Window & { kept?: boolean }).kept,
    ),
  ).toBe(true);

  // The frame theme is a preview; the page keeps the saved theme.
  await page.getByLabel("Frame theme").selectOption("night");
  await expect(desktop.locator("html")).toHaveClass(/\bnight\b/);
  await expect(page.locator("html")).not.toHaveClass(/\bnight\b/);
});

test("Elements scrubs the proposal's detent sheet from the page", async ({
  page,
}) => {
  await page.goto("/debug/elements");
  const section = page.locator("#sheets");
  await section.scrollIntoViewIfNeeded();
  await section.getByRole("button", { name: "Contents", exact: true }).click();
  const proposal = section
    .locator('iframe[title$="proposal: detents"]')
    .contentFrame();
  const contents = proposal.getByRole("dialog", { name: "Contents" });
  const share = () =>
    contents.evaluate((element) => {
      const sheet = element.closest(".reader-sheet") as HTMLElement;
      const box = sheet.getBoundingClientRect();
      const height =
        box.height - parseFloat(getComputedStyle(sheet).paddingBottom);
      return (innerHeight - box.top) / height;
    });
  await expect.poll(share, { timeout: 30_000 }).toBeCloseTo(0.6, 2);
  // Once in, the sheet's dialog takes focus inside its frame.
  await expect
    .poll(() =>
      contents.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);

  // The scrubber drives the sheet from a peek to full height. Keys would
  // reach the frame here: its dialog keeps keyboard focus after entering.
  const slider = section.getByRole("slider", { name: "Sheet position" });
  const box = (await slider.boundingBox())!;
  await slider.click({ position: { x: 1, y: box.height / 2 } });
  await expect.poll(share).toBeCloseTo(0.12, 1);
  // A drag past the end holds the sheet at full height. "Let go" now shows,
  // so the scrubber has moved.
  const track = (await slider.boundingBox())!;
  const y = track.y + track.height / 2;
  await page.mouse.move(track.x + track.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width + 40, y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(share).toBeGreaterThan(0.98);
  await expect(slider).toHaveAttribute("aria-valuetext", "3.0 s, Full height");
});

test("Elements shows the Reading shelf as covers on a phone", async ({
  page,
}) => {
  await page.goto("/debug/elements");
  const section = page.locator("#shelf");
  await section.scrollIntoViewIfNeeded();
  await section
    .getByRole("button", { name: "Five books", exact: true })
    .click();
  /** The reading books' widths, and how many are wholly on screen. */
  const shelf = (device: string) =>
    section
      .locator(`iframe[title$="${device}"]`)
      .contentFrame()
      .getByRole("region", { name: "Reading" })
      .getByRole("link")
      .evaluateAll((links) => {
        const boxes = links.map((link) => link.getBoundingClientRect());
        return {
          count: boxes.length,
          width: Math.round(boxes[0]?.width ?? 0),
          inView: boxes.filter(
            (box) =>
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.bottom <= innerHeight,
          ).length,
        };
      });
  // A phone fits three small covers across; the rest scroll into view.
  await expect
    .poll(() => shelf("phone"), { timeout: 30_000 })
    .toEqual({ count: 5, width: 92, inView: 3 });
  // A wider window keeps a card with the title for each book.
  await expect
    .poll(() => shelf("desktop").then((result) => result.width))
    .toBeGreaterThan(250);
  await expect(
    section
      .locator('iframe[title$="desktop"]')
      .contentFrame()
      .getByRole("heading", { name: "Middlemarch" }),
  ).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("Design ideas fit a phone, one live frame at a time", async ({
    page,
  }) => {
    await page.goto("/debug");
    await page.getByRole("link", { name: /Design ideas/ }).click();
    await page.getByRole("link", { name: "Sessions ideas" }).click();
    await expect(
      page.getByRole("heading", { name: "Current Sessions" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);

    await page
      .getByRole("group", { name: "Show" })
      .getByRole("button", { name: "In the Library's frame" })
      .click();
    const frame = page.locator(
      'iframe[title="In the Library\'s frame, phone"]',
    );
    expect((await frame.boundingBox())!.width).toBeGreaterThan(300);

    await page.getByRole("link", { name: "Open full screen" }).click();
    await expect(page).toHaveURL(/\/debug\/ideas\/sessions$/);
  });

  test("Design ideas show the dark mode colour options", async ({ page }) => {
    await page.goto("/debug");
    await page.getByRole("link", { name: /Design ideas/ }).click();
    await page.getByRole("link", { name: "Dark mode ideas" }).click();
    await expect(
      page.getByRole("heading", { name: "Today's dark colours" }),
    ).toBeVisible();

    const show = page.getByRole("group", { name: "Show" });
    const yellowOnNight = async (title: string) => {
      await show.getByRole("button", { name: title }).click();
      const night = page
        .locator(`iframe[title="${title}, phone"]`)
        .contentFrame()
        .getByRole("region", { name: "Night" });
      const mark = night.locator('mark[data-color="yellow"]');
      await expect(mark).toBeVisible();
      return mark.evaluate((node) => getComputedStyle(node).backgroundColor);
    };
    const today = await yellowOnNight("Today's dark colours");
    expect(await yellowOnNight("Light hues on the dark page")).not.toBe(today);

    await page.getByRole("link", { name: "Open full screen" }).click();
    await expect(page).toHaveURL(/\/debug\/ideas\/dark-colours\?palette=mixed/);
    await page.getByRole("link", { name: "Back to Dark mode ideas" }).click();
    await expect(page).toHaveURL(/\/debug\/elements\/dark$/);
  });
});
