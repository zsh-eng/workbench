import { test, expect } from "./helpers/fixtures";

test("Highlights search with no match offers to show everything again", async ({
  page,
  localBook,
}) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.evaluate(async (bookId) => {
    const path = "/src/lib/db.ts";
    await (
      await import(path)
    ).addHighlight({
      id: "interface-review",
      bookId,
      spineItemId: "chapter",
      startOffset: 0,
      endOffset: 22,
      selectedText: "A thought worth keeping.",
      textBefore: "",
      textAfter: "",
      color: "yellow",
      createdAt: 1720000000000,
    });
  }, localBook.id);
  await page.goto("/highlights");
  const highlight = page.getByText("A thought worth keeping.", {
    exact: false,
  });
  await expect(highlight).toBeVisible();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const search = page.getByRole("searchbox");
  await search.fill("not present in this book");
  await expect(
    page.getByText("Nothing matches", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show everything", exact: true })
    .click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(highlight).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Yellow highlights" }),
  ).toHaveAttribute("aria-pressed", "false");
});

test.describe("account metadata", () => {
  test.use({
    signedIn: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  test("long device names wrap inside the mobile viewport", async ({
    page,
  }) => {
    await page.route("**/api/sessions", (route) =>
      route.fulfill({
        json: {
          sessions: [
            {
              id: "test-session",
              browser: {
                name: "A very long browser identification string",
                version: "123.456.789.123456789",
              },
              os: {
                name: "A long operating system name",
                version: "123.456.789",
              },
              deviceType: "mobile",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              isCurrent: true,
            },
          ],
        },
      }),
    );
    await page.goto("/devices");
    await expect(
      page.getByRole("heading", { name: "Devices", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /A very long browser/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
