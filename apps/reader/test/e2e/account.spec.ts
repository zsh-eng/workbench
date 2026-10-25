import { test, expect, openAccountMenu } from "./helpers/fixtures";

test("signed-out Devices does not request account sessions", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/sessions", async (route) => {
    requests += 1;
    await route.fulfill({ json: { sessions: [] } });
  });
  await page.goto("/devices");
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(requests).toBe(0);
});

test.describe("Account menu", () => {
  test.use({ signedIn: true });
  test("names the account and leads to its devices", async ({ page }) => {
    await page.route("**/api/sessions", (route) =>
      route.fulfill({ json: { sessions: [] } }),
    );
    await page.goto("/");
    const menu = await openAccountMenu(page);
    await expect(menu.getByText("reader@example.test")).toBeVisible();
    await menu.getByRole("menuitem", { name: "Devices", exact: true }).click();
    await expect(page).toHaveURL("/devices");
    await expect(
      page.getByRole("heading", { name: "Devices", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Back to library" }).click();
    await expect(page).toHaveURL("/");
  });
});
