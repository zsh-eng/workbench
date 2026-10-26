import {
  BOOK_MATERIALIZATION_RECIPE_VERSION,
  prepareBook,
} from "@/lib/book-preparation";
import { db, type Book, type BookFile } from "@/lib/db";
import { files, parseFileId, type FileId } from "@/lib/files";
import { strToU8, zipSync } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMPLETE_COVER_FILE_ID = parseFileId("xxh64:2222222222222222");
const BLUR_HASH = "LEHV6nWB2yk8pyo0adR*.7kCMdnj";

describe("prepareBook integration", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
  });

  it("rejects missing offline bytes without a transfer and recovers from local bytes", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const get = vi.spyOn(files, "get");
    const source = createTestEpub();
    const id = await files.put(source);
    const book = createBook(id);
    await db.files.delete(id);
    await expect(prepareBook(book)).rejects.toThrow("Connect to the internet");
    expect(get).not.toHaveBeenCalled();
    await files.put(source);
    await expect(prepareBook(book)).resolves.toMatchObject({
      materialized: true,
    });
    await db.files.delete(id);
    await expect(prepareBook(book)).resolves.toMatchObject({
      materialized: false,
    });
  });

  it("parses a local EPUB, replaces partial rows, and trusts its marker", async () => {
    const epub = createTestEpub();
    const expectedBytes = new Uint8Array(await epub.arrayBuffer());
    const sourceFileId = await files.put(epub);
    const storedSource = await db.files.get(sourceFileId);
    expect(storedSource?.size).toBeGreaterThan(0);
    expect(storedSource?.blob.size).toBe(storedSource?.size);
    expect(new Uint8Array(await storedSource!.blob.arrayBuffer())).toEqual(
      expectedBytes,
    );
    const book = createBook(sourceFileId);
    await db.books.put({ ...book, isDeleted: false });
    await db.bookFiles.put(createChapterFile(book.id, "partial chapter"));

    const first = await prepareBook(book);
    const second = await prepareBook(first.book);

    expect(first).toMatchObject({
      bookChanged: false,
      materialized: true,
      book: { id: book.id, cover: null },
    });
    expect(second).toMatchObject({
      bookChanged: false,
      materialized: false,
    });
    expect(await db.bookStructures.get(book.id)).toMatchObject({
      sourceFileId,
      spine: book.spine,
      manifest: book.manifest,
    });

    const storedFiles = await db.bookFiles
      .where("bookId")
      .equals(book.id)
      .toArray();
    expect(storedFiles.map((file) => file.path).sort()).toEqual([
      "META-INF/container.xml",
      "OEBPS/chapter.xhtml",
      "OEBPS/content.opf",
      "mimetype",
    ]);
    const chapter = storedFiles.find(
      (file) => file.path === "OEBPS/chapter.xhtml",
    );
    expect(await chapter?.content.text()).toContain("Complete chapter");
    expect(await db.bookMaterializations.get(book.id)).toMatchObject({
      bookId: book.id,
      sourceFileId,
      recipeVersion: BOOK_MATERIALIZATION_RECIPE_VERSION,
    });
  });

  it("keeps a synchronized cover while expanding the source on a new client", async () => {
    const sourceFileId = await files.put(
      createTestEpub({ invalidCover: true }),
    );
    const book = createBook(sourceFileId, {
      cover: { fileId: COMPLETE_COVER_FILE_ID, blurHash: BLUR_HASH },
      manifest: [
        ...CHAPTER_MANIFEST,
        { id: "cover-image", href: "OEBPS/cover.jpg", mediaType: "image/jpeg" },
      ],
    });
    await db.books.put({ ...book, isDeleted: false });

    const result = await prepareBook(book);

    expect(result.bookChanged).toBe(false);
    expect(result.book.cover).toEqual(book.cover);
    expect(await db.bookMaterializations.get(book.id)).toMatchObject({
      sourceFileId,
      recipeVersion: BOOK_MATERIALIZATION_RECIPE_VERSION,
    });
  });

  it("does not replace existing artifacts when EPUB parsing fails", async () => {
    const invalidEpub = new NodeBlob(["not a ZIP archive"], {
      type: "application/epub+zip",
    }) as unknown as Blob;
    const sourceFileId = await files.put(invalidEpub);
    const book = createBook(sourceFileId);
    const existingFile = createChapterFile(book.id, "existing chapter");
    await db.books.put({ ...book, isDeleted: false });
    await db.bookFiles.put(existingFile);

    await expect(prepareBook(book)).rejects.toThrow();

    expect(await db.bookMaterializations.get(book.id)).toBeUndefined();
    const storedFiles = await db.bookFiles
      .where("bookId")
      .equals(book.id)
      .toArray();
    expect(storedFiles).toHaveLength(1);
    expect(await storedFiles[0]!.content.text()).toBe("existing chapter");
  });
});

const CHAPTER_MANIFEST = [
  {
    id: "chapter",
    href: "OEBPS/chapter.xhtml",
    mediaType: "application/xhtml+xml",
  },
];

/** A synced Book row with the structure its test EPUB declares. */
function createBook(sourceFileId: FileId, overrides: Partial<Book> = {}): Book {
  return {
    id: "book-1",
    sourceFileId,
    cover: null,
    title: "Integration Book",
    author: "Integration Author",
    fileSize: 100,
    dateAdded: 1,
    metadata: {},
    manifest: CHAPTER_MANIFEST,
    spine: [{ idref: "chapter", linear: true }],
    toc: [],
    ...overrides,
  };
}

function createChapterFile(bookId: string, content: string): BookFile {
  return {
    id: `${bookId}:OEBPS/chapter.xhtml`,
    bookId,
    path: "OEBPS/chapter.xhtml",
    mediaType: "application/xhtml+xml",
    content: new NodeBlob([content], {
      type: "application/xhtml+xml",
    }) as unknown as Blob,
  };
}

function createTestEpub(options: { invalidCover?: boolean } = {}): Blob {
  const coverMetadata = options.invalidCover
    ? '<meta name="cover" content="cover-image" />'
    : "";
  const coverManifest = options.invalidCover
    ? '<item id="cover-image" href="cover.jpg" media-type="image/jpeg" />'
    : "";
  const archive = zipSync({
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
        </rootfiles>
      </container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="book-id">integration-book</dc:identifier>
          <dc:title>Integration Book</dc:title>
          <dc:creator>Integration Author</dc:creator>
          ${coverMetadata}
        </metadata>
        <manifest>
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
          ${coverManifest}
        </manifest>
        <spine><itemref idref="chapter" /></spine>
      </package>`),
    "OEBPS/chapter.xhtml": strToU8(
      "<html><body><p>Complete chapter</p></body></html>",
    ),
    ...(options.invalidCover
      ? { "OEBPS/cover.jpg": strToU8("not an image") }
      : {}),
  });

  return new NodeBlob([archive], {
    type: "application/epub+zip",
  }) as unknown as Blob;
}
