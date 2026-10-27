import { GRID_TABLE_CELL_LIMIT } from "@/features/reader/data/chapter-tables";
import {
  loadReaderBodyCache,
  READER_BODY_CACHE_SCHEMA_VERSION,
} from "@/features/reader/data/reader-cache/cache";
import {
  addBook,
  db,
  deleteBook,
  getBookChapterSourceCache,
  getBookFile,
  putBookChapterSourceCache,
  type Book,
  type BookFile,
} from "@/lib/db";
import { parseFileId } from "@/lib/files/file-id";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";

const chapterEntry = {
  index: 0,
  spineItemId: "chapter-1",
  href: "OPS/chapter-1.xhtml",
  title: "Chapter 1",
};

const SOURCE_FILE_ONE = parseFileId("xxh64:1111111111111111");
const SOURCE_FILE_TWO = parseFileId("xxh64:2222222222222222");
const SOURCE_FILE_DELETE = parseFileId("xxh64:3333333333333333");

function createBook(overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    sourceFileId: SOURCE_FILE_ONE,
    cover: null,
    title: "Cached Book",
    author: "Author",
    fileSize: 123,
    dateAdded: Date.now(),
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    ...overrides,
  };
}

function createChapterFile(bookId: string, body: string): BookFile {
  return createBookFile(
    bookId,
    chapterEntry.href,
    "application/xhtml+xml",
    `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
  );
}

function createBookFile(
  bookId: string,
  path: string,
  mediaType: string,
  content: string | Uint8Array,
): BookFile {
  return {
    id: `${bookId}:${path}`,
    bookId,
    path,
    mediaType,
    content: mediaType.startsWith("font/")
      ? new Blob([content], { type: mediaType })
      : (new NodeBlob([content], { type: mediaType }) as unknown as Blob),
  };
}

describe("reader body cache", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
  });

  it("builds normalized body HTML and canonical text from chapter files", async () => {
    await db.bookFiles.add(
      createChapterFile(
        "book-1",
        '<p>Hello <strong>world</strong>.</p><img src="../images/cover.png" />',
      ),
    );

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });

    const chapterContent = result.baseContentByChapter.get(0);
    expect(chapterContent?.html).toContain("Hello");
    expect(chapterContent?.html).toContain("data-epub-deferred-src");
    expect(chapterContent?.html).not.toContain(" src=");
    expect(chapterContent?.canonicalText.fullText).toContain("Hello world.");

    const cacheRow = await getBookChapterSourceCache("book-1");
    expect(cacheRow).toMatchObject({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      cacheVersion: READER_BODY_CACHE_SCHEMA_VERSION,
    });
    expect(cacheRow?.chaptersByPath[chapterEntry.href]?.bodyHtml).toContain(
      "Hello",
    );
  });

  it("finds chapter and image files named by percent-encoded hrefs", async () => {
    const encodedEntry = {
      ...chapterEntry,
      href: "OPS/Donna%20Tartt%20-%20Chapter.xhtml",
    };
    await db.bookFiles.bulkAdd([
      createBookFile(
        "book-1",
        "OPS/Donna Tartt - Chapter.xhtml",
        "application/xhtml+xml",
        '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Encoded</p><img src="My%20Cover.png" /></body></html>',
      ),
      createBookFile("book-1", "OPS/My Cover.png", "image/png", "png"),
    ]);

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [encodedEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });

    expect(
      result.baseContentByChapter.get(0)?.canonicalText.fullText,
    ).toContain("Encoded");
    expect(await getBookFile("book-1", "OPS/My%20Cover.png")).toMatchObject({
      path: "OPS/My Cover.png",
    });
  });

  it("uses the persisted cache instead of rereading chapter blobs", async () => {
    await db.bookFiles.add(createChapterFile("book-1", "<p>Original</p>"));

    await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });
    await db.bookFiles.put(createChapterFile("book-1", "<p>Changed</p>"));

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });

    expect(
      result.baseContentByChapter.get(0)?.canonicalText.fullText,
    ).toContain("Original");
  });

  it("rebuilds when the source file changes", async () => {
    await db.bookFiles.add(createChapterFile("book-1", "<p>First file</p>"));

    await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });
    await db.bookFiles.put(createChapterFile("book-1", "<p>Second file</p>"));

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_TWO,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });

    expect(
      result.baseContentByChapter.get(0)?.canonicalText.fullText,
    ).toContain("Second file");
    expect((await getBookChapterSourceCache("book-1"))?.sourceFileId).toBe(
      SOURCE_FILE_TWO,
    );
  });

  it("loads structural stylesheets before upgrading the cache with publisher resources", async () => {
    await db.bookFiles.bulkAdd([
      createChapterFile(
        "book-1",
        `
          <style>
          .h1 { font-family: "Oswald-Light"; }
          </style>
          <h1 class="h1">Title</h1>
        `,
      ),
    ]);

    const defaultResult = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });

    expect(
      defaultResult.baseContentByChapter.get(0)?.bookStylesheets,
    ).toHaveLength(1);
    expect(
      (await getBookChapterSourceCache("book-1"))?.publisherResourcesLoaded,
    ).toBe(false);

    const publisherResult = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: true,
      matchPublisherBodyTextSize: false,
    });

    expect(
      publisherResult.baseContentByChapter.get(0)?.bookStylesheets,
    ).toHaveLength(1);
    expect(
      (await getBookChapterSourceCache("book-1"))?.publisherResourcesLoaded,
    ).toBe(true);
  });

  it("persists the inferred publisher body font scale with the body cache", async () => {
    const bodyText =
      "Long enough prose for the reader to infer the publisher's dominant body font scale. ".repeat(
        18,
      );

    await db.bookFiles.bulkAdd([
      createChapterFile(
        "book-1",
        `
          <style>
          .body { font-size: 75%; }
          </style>
          <p class="body">${bodyText}</p>
        `,
      ),
    ]);

    const defaultResult = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: true,
      matchPublisherBodyTextSize: false,
    });

    expect(
      defaultResult.baseContentByChapter.get(0)?.publisherBodyFontScale,
    ).toBeUndefined();
    expect(
      (await getBookChapterSourceCache("book-1"))?.publisherBodyScaleLoaded,
    ).toBe(false);

    const result = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: true,
      matchPublisherBodyTextSize: true,
    });

    expect(
      result.baseContentByChapter.get(0)?.publisherBodyFontScale,
    ).toBeCloseTo(0.75, 5);
    expect(
      (await getBookChapterSourceCache("book-1"))?.publisherBodyFontScale,
    ).toBeCloseTo(0.75, 5);
    expect(
      (await getBookChapterSourceCache("book-1"))?.publisherBodyScaleLoaded,
    ).toBe(true);
  });

  it("rebuilds a cache from before table cells once, then reads it", async () => {
    await db.bookFiles.add(
      createChapterFile(
        "book-1",
        "<table><tr><td>A</td><td>B</td></tr></table>",
      ),
    );
    // A row as an earlier release wrote it.
    await db.bookChapterSourceCache.put({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      cacheVersion: READER_BODY_CACHE_SCHEMA_VERSION - 1,
      publisherResourcesLoaded: false,
      publisherBodyScaleLoaded: false,
      chaptersByPath: {
        [chapterEntry.href]: {
          bodyHtml: "<table><tr><td>A</td><td>B</td></tr></table>",
          canonicalText: {
            fullText: "AB",
            blockStarts: new Map([["text-0", 0]]),
          },
        } as never,
      },
      publisherFontFaces: [],
      updatedAt: 0,
    });
    const load = () =>
      loadReaderBodyCache({
        bookId: "book-1",
        sourceFileId: SOURCE_FILE_ONE,
        chapterEntries: [chapterEntry],
        publisherBookStylingEnabled: false,
        matchPublisherBodyTextSize: false,
      });

    const rebuilt = await load();
    expect(rebuilt.loadKind).toBe("rebuilt");
    expect(rebuilt.baseContentByChapter.get(0)).toMatchObject({ tables: true });
    expect(
      (await getBookChapterSourceCache("book-1"))?.chaptersByPath[
        chapterEntry.href
      ]?.tableCellCount,
    ).toBe(2);
    expect((await load()).loadKind).toBe("cache-hit");
  });

  it("reads tables as grids in a chapter up to the cell limit, and Debug's choice in every chapter", async () => {
    const small = { ...chapterEntry, index: 0, href: "OPS/small.xhtml" };
    const large = {
      ...chapterEntry,
      index: 1,
      spineItemId: "chapter-2",
      href: "OPS/large.xhtml",
    };
    const row = (cells: number) =>
      `<tr>${Array.from({ length: cells }, (_, cell) => `<td>w${cell}</td>`).join("")}</tr>`;
    const chapter = (body: string) =>
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Before</p>${body}</body></html>`;
    await db.bookFiles.bulkAdd([
      createBookFile(
        "book-1",
        small.href,
        "application/xhtml+xml",
        chapter(`<table>${row(2)}${row(2)}</table>`),
      ),
      createBookFile(
        "book-1",
        large.href,
        "application/xhtml+xml",
        chapter(`<table>${row(GRID_TABLE_CELL_LIMIT + 1)}</table>`),
      ),
    ]);
    const load = (tablesMode: "auto" | "grid" | "flat") =>
      loadReaderBodyCache({
        bookId: "book-1",
        sourceFileId: SOURCE_FILE_ONE,
        chapterEntries: [small, large],
        publisherBookStylingEnabled: false,
        matchPublisherBodyTextSize: false,
        tablesMode,
      });
    /** Each chapter: grids or not, and whether cells have canonical starts. */
    const modes = async (tablesMode: "auto" | "grid" | "flat") => {
      const { baseContentByChapter } = await load(tablesMode);
      return [0, 1].map((index) => {
        const content = baseContentByChapter.get(index)!;
        const cellStarts = [...content.canonicalText.blockStarts.keys()].some(
          (id) => /-c\d+$/.test(id),
        );
        return [content.tables, cellStarts];
      });
    };

    expect(await modes("auto")).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(await modes("grid")).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(await modes("flat")).toEqual([
      [false, false],
      [false, false],
    ]);
    // The text is the same in every mode, so highlights do not move.
    const texts = await Promise.all(
      (["auto", "grid", "flat"] as const).map(
        async (mode) =>
          (await load(mode)).baseContentByChapter.get(1)!.canonicalText
            .fullText,
      ),
    );
    expect(new Set(texts).size).toBe(1);
  });

  it("reads a chapter the cell limit has moved as the limit says", async () => {
    const body = "<p>Before</p><table><tr><td>A</td><td>B</td></tr></table>";
    await db.bookFiles.add(createChapterFile("book-1", body));
    // A row cached while a lower limit read this chapter as a paragraph.
    await db.bookChapterSourceCache.put({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      cacheVersion: READER_BODY_CACHE_SCHEMA_VERSION,
      publisherResourcesLoaded: false,
      publisherBodyScaleLoaded: false,
      chaptersByPath: {
        [chapterEntry.href]: {
          bodyHtml: body,
          tableCellCount: 2,
          tables: false,
          canonicalText: {
            fullText: "BeforeAB",
            blockStarts: new Map([
              ["text-1", 0],
              ["text-2", 6],
            ]),
          },
        },
      },
      publisherFontFaces: [],
      updatedAt: 0,
    });
    const { loadKind, baseContentByChapter } = await loadReaderBodyCache({
      bookId: "book-1",
      sourceFileId: SOURCE_FILE_ONE,
      chapterEntries: [chapterEntry],
      publisherBookStylingEnabled: false,
      matchPublisherBodyTextSize: false,
    });
    expect(loadKind).toBe("cache-hit");
    const content = baseContentByChapter.get(0)!;
    expect(content.tables).toBe(true);
    expect(content.canonicalText.blockStarts.get("text-2-c1")).toBe(7);
  });

  it("removes the body cache when a book is deleted", async () => {
    const book = createBook({
      id: "book-delete",
      sourceFileId: SOURCE_FILE_DELETE,
    });
    await addBook(book);
    await db.bookMaterializations.put({
      bookId: book.id,
      sourceFileId: book.sourceFileId,
      recipeVersion: 1,
      completedAt: Date.now(),
    });
    await putBookChapterSourceCache(
      book.id,
      book.sourceFileId,
      {
        [chapterEntry.href]: {
          bodyHtml: "<p>Cached</p>",
          tableCellCount: 0,
          tables: false,
          canonicalText: {
            fullText: "Cached",
            blockStarts: new Map([["block-1", 0]]),
          },
        },
      },
      READER_BODY_CACHE_SCHEMA_VERSION,
      false,
    );

    await deleteBook(book.id);

    expect(await getBookChapterSourceCache(book.id)).toBeUndefined();
    expect(await db.bookMaterializations.get(book.id)).toBeUndefined();
  });
});
