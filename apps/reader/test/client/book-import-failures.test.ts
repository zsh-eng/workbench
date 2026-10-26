import { addBookFromFile } from "@/lib/book-service";
import { db } from "@/lib/db";
import { FetchFileRemoteApi, files } from "@/lib/files";
import { strToU8, zipSync, type Zippable } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// happy-dom cannot draw a cover; the import stores whatever this returns.
vi.mock("@/lib/book-cover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/book-cover")>()),
  createBookCover: async () => ({
    blob: new NodeBlob(["webp cover"], { type: "image/webp" }),
    blurHash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
    width: 1,
    height: 1,
  }),
}));

const FONT_OBFUSCATION = "http://www.idpf.org/2008/embedding";
const ADOBE_DRM = "http://www.w3.org/2001/04/xmlenc#aes128-cbc";

function encryptionXml(algorithm: string) {
  return strToU8(`<?xml version="1.0"?>
    <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"
      xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
      <enc:EncryptedData>
        <enc:EncryptionMethod Algorithm="${algorithm}" />
        <enc:CipherData><enc:CipherReference URI="OEBPS/chapter.xhtml" /></enc:CipherData>
      </enc:EncryptedData>
    </encryption>`);
}

/** A small EPUB with a cover, or one missing a part. */
function epubBytes(
  options: { opf?: boolean; encryption?: string } = {},
): Uint8Array {
  const entries: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
        </rootfiles>
      </container>`),
    "OEBPS/chapter.xhtml": strToU8(
      "<html><body><p>Down the rabbit hole.</p></body></html>",
    ),
    "OEBPS/cover.png": strToU8("cover"),
  };
  if (options.opf !== false)
    entries["OEBPS/content.opf"] = strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:identifier id="id">urn:test:import</dc:identifier>
          <dc:title>Import Book</dc:title>
          <dc:creator>Test Author</dc:creator>
        </metadata>
        <manifest>
          <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" />
          <item id="cover" href="cover.png" media-type="image/png" properties="cover-image" />
        </manifest>
        <spine><itemref idref="chapter" /></spine>
      </package>`);
  if (options.encryption)
    entries["META-INF/encryption.xml"] = encryptionXml(options.encryption);
  return zipSync(entries);
}

/** A chosen file. Node's Blob, as fake-indexeddb stores it. */
function chosen(name: string, bytes: Uint8Array): File {
  const blob = new NodeBlob([bytes], { type: "application/epub+zip" });
  return Object.assign(blob, { name }) as unknown as File;
}

const good = () => chosen("good.epub", epubBytes());

async function stored() {
  return {
    books: await db.books.count(),
    bookFiles: await db.bookFiles.count(),
    materializations: await db.bookMaterializations.count(),
    files: await db.files.count(),
    uploads: await db.fileUploadOperations.count(),
    outbox: await db._sync_outbox.count(),
  };
}

const NOTHING = {
  books: 0,
  bookFiles: 0,
  materializations: 0,
  files: 0,
  uploads: 0,
  outbox: 0,
};

describe("a failed import leaves nothing behind", () => {
  let uploads: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
    uploads = vi
      .spyOn(FetchFileRemoteApi.prototype, "put")
      .mockImplementation(async (id, blob, mediaType) => ({
        id,
        fileSize: blob.size,
        mediaType,
        createdAt: 1,
      }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Signed in and online: anything queued would upload at once.
    files.resumeUploads();
  });

  afterEach(async () => {
    files.pauseUploads();
    await files.drain();
    vi.restoreAllMocks();
  });

  /** Try again with a good copy: it is added, stored and uploaded. */
  async function retryWithGoodFile() {
    const book = await addBookFromFile(good());
    expect(book.title).toBe("Import Book");
    expect(await stored()).toMatchObject({
      books: 1,
      bookFiles: 5,
      materializations: 1,
      files: 2,
      outbox: 1,
    });
    await vi.waitFor(async () =>
      expect(await db.fileUploadOperations.count()).toBe(0),
    );
    expect(uploads.mock.calls.map(([id]) => id).sort()).toEqual(
      [book.sourceFileId, book.cover!.fileId].sort(),
    );
  }

  it.each([
    {
      file: "a damaged EPUB, cut off mid-download",
      chosen: () => {
        const bytes = epubBytes();
        return chosen("cut.epub", bytes.subarray(0, bytes.length / 2));
      },
      failure: { kind: "damaged" },
    },
    {
      file: "a PDF renamed to .epub",
      chosen: () => chosen("paper.epub", strToU8("%PDF-1.7\n%âãÏÓ\n1 0 obj")),
      failure: { kind: "not-epub", format: "pdf" },
    },
    {
      file: "a DRM-protected EPUB",
      chosen: () => chosen("bought.epub", epubBytes({ encryption: ADOBE_DRM })),
      failure: { kind: "drm" },
    },
    {
      file: "an EPUB without its package file",
      chosen: () => chosen("parts.epub", epubBytes({ opf: false })),
      failure: { kind: "incomplete", missing: "package" },
    },
  ])("$file", async ({ chosen, failure }) => {
    await expect(addBookFromFile(chosen())).rejects.toMatchObject({
      name: "BookImportError",
      failure,
    });

    expect(await stored()).toEqual(NOTHING);
    expect(uploads).not.toHaveBeenCalled();
    await retryWithGoodFile();
  });

  it("runs out of storage while writing the book", async () => {
    // The source file and the cover are stored first in the same commit.
    vi.spyOn(db.bookFiles, "bulkPut").mockRejectedValueOnce(
      new DOMException("The quota has been exceeded.", "QuotaExceededError"),
    );

    await expect(addBookFromFile(good())).rejects.toMatchObject({
      kind: "storage",
    });

    expect(await stored()).toEqual(NOTHING);
    expect(uploads).not.toHaveBeenCalled();
    await retryWithGoodFile();
  });

  it("adds a book whose fonts are only obfuscated: that is not DRM", async () => {
    const book = await addBookFromFile(
      chosen("fonts.epub", epubBytes({ encryption: FONT_OBFUSCATION })),
    );
    expect(await db.books.get(book.id)).toMatchObject({ title: "Import Book" });
  });
});
