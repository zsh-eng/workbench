import {
  test,
  expect,
  openAccountMenu,
  openLocalBook,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

// Debug mode can turn detent sheets off, bringing back one fixed-height
// sheet whose pages slide in place. This test keeps that path working.
test.describe("fixed-height Reader tools sheet", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("reader-detent-sheets-v1", "false"),
    );
  });

  // Motion stays on so the quick reversal below lands mid-slide.
  test("moves between tools pages and keeps a note", async ({
    page,
    localBook,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openLocalBook(page, localBook.id);
    await page.touchscreen.tap(195, 350);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    for (const [button, title] of [
      ["Appearance", "Appearance"],
      ["Notebook", "Notebook"],
      [/Book status/, "Reading status"],
      [/Contents/, "Contents"],
    ] as const) {
      await dialog
        .getByRole("button", {
          name: button,
          exact: typeof button === "string",
        })
        .click();
      // Each page takes the place of the tools in the one sheet.
      await expect(dialog).toHaveCount(1);
      await expect(
        page.getByRole("dialog", { name: title, exact: true }),
      ).toBeVisible();
      if (title === "Notebook") {
        const input = dialog.getByRole("textbox");
        await input.fill("Sheet navigation note");
        await input.press("Control+Enter");
        await expect(
          dialog.getByText("Sheet navigation note", { exact: true }),
        ).toBeVisible();
      }
      await dialog
        .getByRole("button", { name: "Back to reader tools" })
        .click();
      await expect(
        dialog.getByRole("button", { name: "Notebook", exact: true }),
      ).toBeVisible();
    }
    // Reverse before the page slide completes; outgoing pages must not keep focus.
    await dialog.getByRole("button", { name: "Appearance" }).click();
    await dialog.getByRole("button", { name: "Back to reader tools" }).click();
    await dialog.getByRole("button", { name: "Notebook", exact: true }).click();
    await expect(
      dialog.getByText("Sheet navigation note", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (path) => {
          const { syncV2Db: db } = await import(path);
          return (await db.notes.toArray()).filter(
            (note: { isDeleted: boolean; content: string }) =>
              !note.isDeleted && note.content === "Sheet navigation note",
          ).length;
        }, "/src/lib/sync-v2/db.ts"),
      )
      .toBe(1);
    await dialog
      .getByText("Sheet navigation note", { exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit note" }).click();
    await expect(
      dialog.getByRole("textbox", { name: "Edit note" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel editing" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-note-composer]")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Open reader tools", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Notebook", exact: true }),
    ).toBeVisible();
  });
});

test("the phone Library keeps every place and the account menu in its header", async ({
  page,
}) => {
  await page.goto("/");
  const places = page.getByRole("navigation", { name: "Places" });
  for (const name of ["Library", "Highlights", "Sessions"])
    await expect(places.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(
    places.getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const menu = await openAccountMenu(page);
  await expect(
    menu.getByRole("menuitemradio", { name: "Match system" }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Sign in with Google" }),
  ).toBeVisible();
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
