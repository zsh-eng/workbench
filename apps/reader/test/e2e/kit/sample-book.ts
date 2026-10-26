import type { BrowserContext, Page } from "@playwright/test";
import { DATABASE_MODULE } from "../helpers/global-setup";
import { importSampleBook } from "../helpers/fixtures";
import signedOut from "./signed-out";

/**
 * agent-kit `--before`: signed out, with the sample book (public domain)
 * imported through the real importer. Returns `{book}`, its id, for URLs
 * such as `/reader/{book}`.
 */
export default async function sampleBook(kit: {
  page: Page;
  context: BrowserContext;
}) {
  await signedOut(kit);
  await kit.page.goto("/");
  await importSampleBook(kit.page);
  const book = await kit.page.evaluate(async (path) => {
    const { syncV2Db } = await import(path);
    return (await syncV2Db.table("books").toCollection().first()).id;
  }, DATABASE_MODULE);
  return { book: String(book) };
}
