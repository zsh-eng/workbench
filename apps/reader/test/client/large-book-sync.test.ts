import { MemorySyncServer } from "@/features/sync-lab/core/memory-server";
import { buildChapterEntries } from "@/features/reader/data/chapter-content-pipeline";
import { prepareBook } from "@/lib/book-preparation";
import { addBookFromFile } from "@/lib/book-service";
import { db, getBook, type Book, type TOCItem } from "@/lib/db";
import { getOrCreateDeviceId } from "@/lib/device";
import { parseEPUB } from "@/lib/epub-parser";
import { FetchFileRemoteApi, files } from "@/lib/files";
import { getOrCreateSyncClientState } from "@/lib/sync-v2/client-state";
import { EPUBReaderSyncV2DB } from "@/lib/sync-v2/db";
import { SyncV2Client } from "@/lib/sync-v2/sync";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import {
  decodeSyncValue,
  MAX_SYNC_VALUE_BYTES,
  syncPushBodySchema,
} from "@zsh-eng/local-sync";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LARGE_TECHNICAL_BOOK,
  largeEpub,
  type LargeEpubShape,
} from "../fixtures/large-epub";

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

/** A chosen file. Node's Blob, as fake-indexeddb stores it. */
function chosen(bytes: Uint8Array, name = "handbook.epub"): File {
  const blob = new NodeBlob([bytes], { type: "application/epub+zip" });
  return Object.assign(blob, { name }) as unknown as File;
}

function tocEntries(items: TOCItem[]): number {
  return items.reduce(
    (count, item) => count + 1 + tocEntries(item.children ?? []),
    0,
  );
}

function tocLabels(items: TOCItem[]): string[] {
  return items.flatMap((item) => [
    item.label,
    ...tocLabels(item.children ?? []),
  ]);
}

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;

describe("a book whose table of contents is larger than a synced record", () => {
  let server: MemorySyncServer;
  let syncDb: EPUBReaderSyncV2DB;

  /** A device with an empty library on the same account. */
  async function startDevice() {
    syncDb?.close();
    await db.delete();
    await db.open();
    localStorage.clear();
    getOrCreateSyncClientState(getOrCreateDeviceId());
    syncDb = new EPUBReaderSyncV2DB(db.name);
    await syncDb.open();
  }

  const sync = () => new SyncV2Client({ syncDb, remote: server }).sync();

  beforeEach(async () => {
    server = new MemorySyncServer();
    vi.spyOn(FetchFileRemoteApi.prototype, "put").mockImplementation(
      (id, blob, mediaType) => server.files.put(id, blob, mediaType),
    );
    vi.spyOn(FetchFileRemoteApi.prototype, "get").mockImplementation((id) =>
      server.files.get(id),
    );
    await startDevice();
    files.resumeUploads();
  });

  afterEach(async () => {
    files.pauseUploads();
    await files.drain();
    syncDb.close();
    vi.restoreAllMocks();
  });

  it("imports, syncs within the protocol's limits, and opens with its whole contents on another device", async () => {
    const epub = largeEpub();
    const book = await addBookFromFile(chosen(epub.bytes));

    // The importing device reads the contents from its EPUB.
    const imported = (await getBook(book.id))!;
    expect(tocEntries(imported.toc)).toBe(epub.tocEntries);
    expect(tocLabels(imported.toc).at(-1)).toBe(epub.lastTopic);

    // Every change it sends passes the server's own validation.
    const outbox = await db._sync_outbox.toArray();
    expect(() => syncPushBodySchema.parse({ changes: outbox })).not.toThrow();
    const change = outbox.find((entry) => entry.key.includes(book.id))!;
    expect(bytes(change.value)).toBeLessThanOrEqual(MAX_SYNC_VALUE_BYTES);
    await vi.waitFor(async () =>
      expect(await db.fileUploadOperations.count()).toBe(0),
    );
    await sync();
    expect(await db._sync_outbox.count()).toBe(0);

    await startDevice();
    await sync();
    const arrived = (await getBook(book.id))!;
    expect(arrived.title).toBe(LARGE_TECHNICAL_BOOK.title);
    // Before its EPUB is here, the row lists every chapter.
    expect(arrived.spine).toHaveLength(epub.spineItems);

    const prepared = await prepareBook(arrived);
    expect(prepared).toMatchObject({ bookChanged: true, materialized: true });
    expect(tocEntries(prepared.book.toc)).toBe(epub.tocEntries);
    const opened = (await getBook(book.id))!;
    expect(tocEntries(opened.toc)).toBe(epub.tocEntries);
    expect(opened.manifest).toEqual(imported.manifest);
    expect(buildChapterEntries(opened)).toHaveLength(epub.spineItems);
    // Reading it here sends nothing back: the structure stays on the device.
    expect(await db._sync_outbox.count()).toBe(0);
  });

  it("leaves app versions that read the structure from the row a book they can open", async () => {
    const epub = largeEpub();
    const book = await addBookFromFile(chosen(epub.bytes));
    const [change] = await db._sync_outbox.toArray();
    // What an older version stores and reads: the synced value as it is.
    const row = decodeSyncValue<Book>(change!.value);

    expect(row.spine).toHaveLength(epub.spineItems);
    const chapters = buildChapterEntries(row);
    expect(chapters).toHaveLength(epub.spineItems);
    // Each chapter keeps its title from the contents, not from its file name.
    const full = (await getBook(book.id))!;
    chapters.forEach((chapter) =>
      expect(getChapterTitleFromSpine(row, chapter.index)).toBe(
        getChapterTitleFromSpine(full, chapter.index),
      ),
    );
    expect(tocEntries(row.toc)).toBeGreaterThan(0);
    expect(tocEntries(row.toc)).toBeLessThan(epub.tocEntries);
  });

  it("opens a book synced before, with the whole structure in its row", async () => {
    const shape: LargeEpubShape = {
      ...LARGE_TECHNICAL_BOOK,
      identifier: "urn:test:older-row",
      chapters: 3,
      sectionsPerChapter: 4,
      subsectionsPerSection: 3,
      figures: 10,
    };
    const epub = largeEpub(shape);
    const parsed = await parseEPUB(chosen(epub.bytes), {
      sourceFileId: await files.put(chosen(epub.bytes)),
    });
    // Rows as an older version left them: no structure of this device's own.
    await syncDb.books.put({ ...parsed.book, isDeleted: false });
    await syncDb.bookFiles.bulkPut(parsed.files);
    await syncDb.bookMaterializations.put({
      bookId: parsed.book.id,
      sourceFileId: parsed.book.sourceFileId,
      recipeVersion: 1,
      completedAt: 1,
    });

    const stored = (await getBook(parsed.book.id))!;
    expect(tocEntries(stored.toc)).toBe(epub.tocEntries);

    // Its expanded files give this device the structure; nothing re-expands.
    const prepared = await prepareBook(stored);
    expect(prepared).toMatchObject({
      bookChanged: false,
      materialized: false,
    });
    expect(await db.bookStructures.get(parsed.book.id)).toMatchObject({
      sourceFileId: parsed.book.sourceFileId,
      toc: parsed.book.toc,
      spine: parsed.book.spine,
    });
    expect(tocEntries((await getBook(parsed.book.id))!.toc)).toBe(
      epub.tocEntries,
    );
    expect(await db._sync_outbox.count()).toBe(0);
  });
});
