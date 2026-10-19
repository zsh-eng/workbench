import {
  test,
  expect,
  SAMPLE_EPUB_PATH,
  waitForReaderReady,
} from "./helpers/fixtures";

test("signed-out Devices does not request account sessions", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/sessions", async (route) => {
    requests += 1;
    await route.fulfill({ json: { sessions: [] } });
  });
  await page.goto("/devices");
  // A test's first page can also load Vite's cold application module graph.
  await expect(
    page.getByRole("button", { name: "Choose EPUB files", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/$/);
  expect(requests).toBe(0);
});

test("mobile import offers Open book after durable preparation without opening automatically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose EPUB files", exact: true }).click();
  await (await chooser).setFiles(SAMPLE_EPUB_PATH);
  const openBook = page.getByRole("button", { name: "Open book", exact: true });
  await expect(openBook).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ has: openBook }),
  ).toContainText("Added 1 book.");
  await expect(page).toHaveURL(/\/$/);
  const prepared = await page.evaluate(async (modulePath) => {
    const { syncV2Db: db } = await import(modulePath);
    const book = await db.books.toCollection().first();
    const marker = await db.bookMaterializations.get(book.id);
    return {
      id: book.id,
      source: book.sourceFileId,
      markerSource: marker?.sourceFileId,
      entries: await db.bookFiles.where("bookId").equals(book.id).count(),
    };
  }, "/src/lib/sync-v2/db.ts");
  expect(prepared.markerSource).toBe(prepared.source);
  expect(prepared.entries).toBeGreaterThan(0);
  await openBook.click();
  await expect(page).toHaveURL(new RegExp(`/reader/${prepared.id}$`));
  await waitForReaderReady(page);
});
