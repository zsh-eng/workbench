import type { BrowserContext, Page } from "@playwright/test";
import { epubVariant } from "../helpers/epub-variants";
import { expect } from "../helpers/fixtures";
import { DATABASE_MODULE } from "../helpers/global-setup";
import signedOut from "./signed-out";

const CHAPTER_ONE = "OEBPS/4269428405154643194_11-h-1.htm.xhtml";
const REPEATS = 20;

/**
 * agent-kit `--before`: signed out, with a copy of the sample book whose
 * first chapter runs 20 times over (about 220,000 characters), imported
 * through the real importer. Returns `{book}`, its id. For timing work that
 * grows with the length of a chapter.
 */
export default async function longChapterBook(kit: {
  page: Page;
  context: BrowserContext;
}) {
  await signedOut(kit);
  const { page } = kit;
  await page.goto("/");
  const file = epubVariant({
    name: "long-chapter",
    title: "Long Chapter",
    author: "Test Author",
    documents: {
      [CHAPTER_ONE]: (xhtml) =>
        xhtml.replace(
          /(<\/h2>)([\s\S]*)(<\/div><\/body>)/,
          (_, heading: string, text: string, end: string) =>
            heading + text.repeat(REPEATS) + end,
        ),
    },
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles(file);
  await expect(page.getByRole("heading", { name: "Long Chapter" })).toBeVisible(
    { timeout: 30_000 },
  );
  const book = await page.evaluate(async (path) => {
    const { syncV2Db } = await import(path);
    return (await syncV2Db.table("books").toCollection().first()).id;
  }, DATABASE_MODULE);
  return { book: String(book) };
}
