import type { Page } from "@playwright/test";
import { DATABASE_MODULE } from "../helpers/global-setup";
import activitySheet from "./activity-sheet";

/**
 * agent-kit `--steps`, with `sample-book.ts` and Debug → Offline downloads
 * on (`--storage reader-debug-enabled-v1=true --storage
 * reader-offline-downloads-v1=true`): the book leaves this device, its
 * download starts and holds, and the activity sheet opens.
 */
export default async function heldDownload({ page }: { page: Page }) {
  const sourceFileId = await page.evaluate(async (path) => {
    const { syncV2Db: db } = await import(path);
    const book = await db.table("books").toCollection().first();
    await db.table("files").delete(book.sourceFileId);
    await db.table("bookFiles").where("bookId").equals(book.id).delete();
    await db
      .table("bookMaterializations")
      .where("bookId")
      .equals(book.id)
      .delete();
    return book.sourceFileId as string;
  }, DATABASE_MODULE);
  await page.route(`**/api/files/${sourceFileId}`, () => {});
  await page.reload();
  await page.getByRole("button", { name: "Sort and layout" }).click();
  await page
    .getByRole("menuitem", { name: "Download all for offline" })
    .click();
  await page
    .locator('[data-activity-glyph="progress"]')
    .waitFor({ timeout: 5_000 });
  await activitySheet({ page });
}
