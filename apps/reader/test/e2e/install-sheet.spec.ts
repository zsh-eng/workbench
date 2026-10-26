import type { Page } from "@playwright/test";
import {
  test,
  expect,
  openAccountMenu,
  openLocalBook,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

/** iOS 27 Safari on an iPhone. */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1";

/** Longer than the Library's calm moment (CALM_MS) and the sheet's rise. */
const PAST_CALM_MS = 6500;

/**
 * A browser that has seen Reader once before, an hour ago, so this load is
 * its second visit and the offer is due. Seeded once per tab, so a reload
 * keeps what the page itself remembers.
 */
async function secondVisit(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("install-offer-seeded")) return;
    sessionStorage.setItem("install-offer-seeded", "1");
    localStorage.setItem(
      "reader-install-offer-v1",
      JSON.stringify({
        visits: 1,
        lastSeenAt: Date.now() - 60 * 60_000,
        firstBookAt: null,
        closedAt: null,
      }),
    );
  });
}

test.describe("on iPhone Safari", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_SAFARI,
  });

  test("offers itself in the Library on a second visit, never in a book, and remembers Not now", async ({
    page,
    localBook,
  }) => {
    await secondVisit(page);
    await openLocalBook(page, localBook.id);
    await page.waitForTimeout(PAST_CALM_MS);
    await expect(page.locator("[data-install-sheet]")).toHaveCount(0);

    await page.goto("/");
    const sheet = await waitForSheet(page, "Install", { timeout: 15_000 });
    await expect(
      sheet.getByText("Tap Page Menu in the address bar"),
    ).toBeVisible();
    await waitForSheetToRest(sheet);
    await sheet.getByRole("button", { name: "Not now" }).click();
    await expect(sheet).toBeHidden();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: /Alice/ }).first(),
    ).toBeVisible();
    await page.waitForTimeout(PAST_CALM_MS);
    await expect(page.locator("[data-install-sheet]")).toHaveCount(0);

    // The account menu still offers it.
    const menu = await openAccountMenu(page);
    await menu.getByRole("menuitem", { name: "Install Reader" }).click();
    await waitForSheet(page, "Install");
  });

  test("never offers itself once installed", async ({ page, localBook }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "standalone", { value: true }),
    );
    await secondVisit(page);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Alice/ }).first(),
    ).toBeVisible();
    expect(localBook.id).toBeTruthy();
    await page.waitForTimeout(PAST_CALM_MS);
    await expect(page.locator("[data-install-sheet]")).toHaveCount(0);
    const menu = await openAccountMenu(page);
    await expect(
      menu.getByRole("menuitem", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: "Install Reader" }),
    ).toHaveCount(0);
  });
});

test("Chromium installs through its own prompt", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible();
  // Chrome holds back its install event until a site qualifies; send one
  // as Chrome would, with a prompt that records being shown.
  const heldBack = await page.evaluate(() => {
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt: async () => {
          (window as { prompted?: number }).prompted =
            ((window as { prompted?: number }).prompted ?? 0) + 1;
        },
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
      },
    );
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(heldBack).toBe(true);

  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Install Reader" }).click();
  const sheet = await waitForSheet(page, "Install");
  await waitForSheetToRest(sheet);
  await sheet.getByRole("button", { name: "Install", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Installed" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as { prompted?: number }).prompted),
  ).toBe(1);
  await expect(sheet).toBeHidden();

  const after = await openAccountMenu(page);
  await expect(after.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(
    after.getByRole("menuitem", { name: "Install Reader" }),
  ).toHaveCount(0);
});

test("launch screens follow the appearance chosen in Reader", async ({
  page,
}) => {
  // The schemes of the launch screens iOS can pick when Add to Home Screen
  // is tapped, and whether they still ask for the system's scheme.
  const launchScreens = () =>
    page.evaluate(() => {
      const links = [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel="apple-touch-startup-image"]',
        ),
      ].filter((link) => link.media !== "not all");
      return {
        schemes: [...new Set(links.map((link) => link.dataset.scheme))],
        count: links.length,
        followSystem: links.every((link) =>
          link.media.includes("prefers-color-scheme"),
        ),
      };
    });
  // Light by default, whatever the system says.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect.poll(launchScreens).toMatchObject({
    schemes: ["light"],
    followSystem: false,
  });
  const { count } = await launchScreens();

  // Choosing Dark changes them at once: iOS reads them when Add to Home
  // Screen is tapped, not when the page loads.
  let menu = await openAccountMenu(page);
  await menu.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect.poll(launchScreens).toEqual({
    schemes: ["dark"],
    count,
    followSystem: false,
  });

  // Match system keeps both, each for its scheme.
  await page.keyboard.press("Escape");
  menu = await openAccountMenu(page);
  await menu.getByRole("menuitemradio", { name: "Match system" }).click();
  await expect.poll(launchScreens).toEqual({
    schemes: ["light", "dark"],
    count: count * 2,
    followSystem: true,
  });
});
