import {
  test,
  expect,
  openAccountMenu,
  openLocalBook,
} from "./helpers/fixtures";

// The phone is the primary device; desktop differs only in how the Reader
// chrome is revealed, which the chrome specs cover.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("persists the switch and gates navigation, Reader tools, and diagnostic routes", async ({
  page,
  localBook,
}) => {
  await page.goto("/settings");
  const toggle = page.getByRole("switch", { name: "Debug mode" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  expect(
    await page.evaluate(() => localStorage.getItem("reader-debug-enabled-v1")),
  ).toBe("false");

  await page.goto("/");
  let menu = await openAccountMenu(page);
  await expect(menu.getByRole("menuitem", { name: "Debug tools" })).toHaveCount(
    0,
  );
  await menu.getByRole("menuitem", { name: "Settings" }).click();
  await expect(toggle).not.toBeChecked();

  for (const path of [
    "/debug",
    "/reader-traces",
    `/debug/reader/${localBook.id}`,
    "/diagnostics/reader",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Debug mode is off" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Open settings" }).click();
    await expect(toggle).not.toBeChecked();
  }

  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /copy debug dump/i }),
  ).toHaveCount(0);

  await page.goto("/settings");
  await toggle.check();
  await page.reload();
  await expect(toggle).toBeChecked();
  await page.goto("/");
  menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "Debug tools" }).click();
  await page.getByRole("link", { name: /^Performance/ }).click();
  await expect(
    page.getByRole("switch", { name: "Record reader traces" }),
  ).toBeVisible();

  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195, 422);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /copy debug dump/i }),
  ).toBeVisible();
});

test("In Debug mode the Library opens Design ideas on the newest topic", async ({
  page,
  // A book in the Library shows the phone's row of Library controls.
  localBook: _book,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Design ideas", exact: true }).click();
  // The tabs run newest first after Elements, and the newest is open.
  const tabs = page
    .getByRole("navigation", { name: "Design pages" })
    .getByRole("link");
  await expect(tabs.first()).toHaveText("Elements");
  const newest = tabs.nth(1);
  await expect(newest).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle(`${await newest.textContent()} · Reader`);
  await expect(page.getByRole("heading", { name: "Compare" })).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("switch", { name: "Debug mode" }).uncheck();
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sort and layout" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Design ideas", exact: true }),
  ).toHaveCount(0);
});
