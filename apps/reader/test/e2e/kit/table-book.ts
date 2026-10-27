import type { BrowserContext, Page } from "@playwright/test";
import { epubVariant } from "../helpers/epub-variants";
import { importAndOpenEpub, openContentsEntry } from "../helpers/reader-books";
import { withSyntheticTables } from "../helpers/synthetic-tables";
import signedOut from "./signed-out";

const CHAPTER_ONE = "OEBPS/4269428405154643194_11-h-1.htm.xhtml";
const REPEATS = 20;
/** A systems book's average: one table per ~20,000 characters of text. */
const TABLES_PER_DENSITY = 11;

/**
 * agent-kit `--before`: signed out, with a copy of the sample book whose
 * first chapter runs 20 times over (about 227,000 characters) and holds
 * synthetic tables at `KIT_TABLE_DENSITY` times a systems book's average
 * density (0, 1, 5 or 20; 1 is 11 tables), or `KIT_TABLE_COUNT` tables
 * (11 hold 717 cells, 17 hold 1,114, 24 hold 1,511, 38 hold 2,515 and 55
 * hold 3,634). Opens the Reader at that chapter, so `/reader/{book}`
 * reopens there. Returns `{book}`.
 */
export default async function tableBook(kit: {
  page: Page;
  context: BrowserContext;
}) {
  await signedOut(kit);
  const count = process.env.KIT_TABLE_COUNT
    ? Number(process.env.KIT_TABLE_COUNT)
    : Math.round(
        Number(process.env.KIT_TABLE_DENSITY ?? "1") * TABLES_PER_DENSITY,
      );
  const title = `Tables ${count}`;
  const file = epubVariant({
    name: `tables-${count}`,
    title,
    author: "Test Author",
    documents: {
      [CHAPTER_ONE]: (xhtml) =>
        xhtml.replace(
          /(<\/h2>)([\s\S]*)(<\/div><\/body>)/,
          (_, heading: string, text: string, end: string) =>
            heading + withSyntheticTables(text.repeat(REPEATS), count) + end,
        ),
    },
  });
  const book = await importAndOpenEpub(kit.page, file, title);
  await openContentsEntry(kit.page, /CHAPTER I\./);
  return { book };
}
