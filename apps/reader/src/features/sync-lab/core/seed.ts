import { strToU8, zipSync } from "fflate";
import Dexie from "dexie";
import {
  EPUBReaderSyncV2DB,
  SYNC_V2_SYNCED_TABLES,
  SYNC_V2_DATABASE_NAME,
  SYNC_V2_DATABASE_VERSION,
} from "@/lib/sync-v2/db";
import { computeFileId } from "@/lib/files/file-id";
import type { LocalFile } from "@/lib/files/types";
import { parseEPUB } from "@/lib/epub-parser";
import type { DatabaseSnapshot, DomainRow } from "../types";

export interface LabSeed {
  name: string;
  rows: Record<string, DomainRow[]>;
  files: LocalFile[];
}

export interface SourceBook {
  id: string;
  title: string;
  author: string;
}

/** Read only metadata for the picker; do not load every EPUB into memory. */
export async function listSourceBooks(): Promise<SourceBook[]> {
  if (!(await Dexie.exists(SYNC_V2_DATABASE_NAME))) return [];
  const source = new Dexie(SYNC_V2_DATABASE_NAME);
  try {
    await source.open();
    if (source.verno !== SYNC_V2_DATABASE_VERSION)
      throw new Error(
        "Open Reader to update the local library before capturing it in Sync Lab.",
      );
    return (
      await source.table<SourceBook & { isDeleted: boolean }>("books").toArray()
    )
      .filter((book) => !book.isDeleted)
      .map(({ id, title, author }) => ({ id, title, author }));
  } finally {
    source.close();
  }
}

/** One read transaction captures domain data and available bytes; no network fetches. */
export async function captureLocalSeed(
  bookIds?: readonly string[],
): Promise<LabSeed> {
  if (!(await Dexie.exists(SYNC_V2_DATABASE_NAME)))
    return { name: "Local library", rows: {}, files: [] };
  const source = new Dexie(SYNC_V2_DATABASE_NAME);
  try {
    await source.open();
    if (source.verno !== SYNC_V2_DATABASE_VERSION) {
      throw new Error(
        "Open Reader to update the local library before capturing it in Sync Lab.",
      );
    }
    return await source.transaction("r", source.tables, async () => {
      const books = (
        await source
          .table<
            DomainRow & {
              sourceFileId: string;
              cover: { fileId: string } | null;
            }
          >("books")
          .toArray()
      ).filter(
        (book) => !book.isDeleted && (!bookIds || bookIds.includes(book.id)),
      );
      const ids = new Set(books.map((book) => book.id));
      const rows: Record<string, DomainRow[]> = {};
      for (const name of SYNC_V2_SYNCED_TABLES) {
        rows[name] = (await source.table(name).toArray()).filter((row) =>
          name === "books"
            ? ids.has(row.id)
            : !row.bookId || ids.has(row.bookId),
        );
      }
      const fileIds = new Set(
        books.flatMap((book) => [
          book.sourceFileId,
          ...(book.cover ? [book.cover.fileId] : []),
        ]),
      );
      const files = (
        await source.table<LocalFile>("files").bulkGet([...fileIds])
      ).filter((file): file is LocalFile => file !== undefined);
      return { name: "Local library snapshot", rows, files };
    });
  } finally {
    source.close();
  }
}

/** Small original EPUB makes the lab useful without a signed-in library. */
export async function createDemoSeed(): Promise<LabSeed> {
  const chapters = ["A place to begin", "Two readers", "Finding agreement"];
  const entries: Record<string, Uint8Array> = {
    mimetype: strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    "book.opf": strToU8(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">sync-lab-demo</dc:identifier><dc:title>The Shared Bookmark</dc:title><dc:creator>Sync Lab</dc:creator><dc:language>en</dc:language></metadata><manifest>${chapters.map((_, i) => `<item id="chapter${i}" href="chapter${i}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map((_, i) => `<itemref idref="chapter${i}"/>`).join("")}</spine></package>`,
    ),
  };
  chapters.forEach((title, i) => {
    entries[`chapter${i}.xhtml`] = strToU8(
      `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${Array.from({ length: 15 }, (_, n) => `<p>On page ${n + 1} of their journey, the readers paused to compare their notes. Each carried a copy of the same small book. A mark made on one device would travel when a connection returned. Until then, the words and the reader's place remained close at hand.</p>`).join("")}</body></html>`,
    );
  });
  const bytes = zipSync(entries);
  const blob = new Blob([bytes as BlobPart], { type: "application/epub+zip" });
  const id = await computeFileId(blob);
  const { book } = await parseEPUB(blob, {
    sourceFileId: id,
    bookId: "sync-lab-demo",
  });
  return {
    name: "The Shared Bookmark · demo",
    rows: { books: [{ ...book, isDeleted: false }] },
    files: [
      {
        id,
        blob,
        size: blob.size,
        mediaType: blob.type,
        storedAt: Date.now(),
        remotePresent: true,
      },
    ],
  };
}

export async function writeDatabaseSnapshot(
  name: string,
  snapshot: DatabaseSnapshot,
): Promise<void> {
  if (!name.startsWith("sync-lab-"))
    throw new Error("Only lab databases can be restored.");
  const db = new EPUBReaderSyncV2DB(name);
  try {
    await db.open();
    await db.transaction("rw", db.tables, async () => {
      for (const table of db.tables) {
        await table.clear();
        const rows = snapshot[table.name];
        if (rows?.length) await table.bulkPut(rows);
      }
    });
  } finally {
    db.close();
  }
}
