import type { BrowserContext, Page } from "@playwright/test";
import { basename } from "node:path";
import { importAndOpenEpub, openContentsEntry } from "../helpers/reader-books";
import signedOut from "./signed-out";

/**
 * agent-kit `--before`: signed out, with the EPUB at `KIT_EPUB` imported
 * through the real importer, for timings on a book that is not in the
 * repository. `KIT_TITLE` matches its Library heading. With `KIT_CHAPTER`, a
 * pattern for a Contents entry, the Reader opens at that entry, so
 * `/reader/{book}` reopens there. Returns `{book}`.
 *
 * The book stays in the kit's own browser profile.
 */
export default async function epubFileBook(kit: {
  page: Page;
  context: BrowserContext;
}) {
  const file = process.env.KIT_EPUB;
  if (!file) throw new Error("Set KIT_EPUB to an EPUB's path");
  await signedOut(kit);
  const title = new RegExp(
    process.env.KIT_TITLE ?? basename(file, ".epub"),
    "i",
  );
  const book = await importAndOpenEpub(kit.page, file, title);
  if (process.env.KIT_CHAPTER)
    await openContentsEntry(kit.page, new RegExp(process.env.KIT_CHAPTER));
  return { book };
}
