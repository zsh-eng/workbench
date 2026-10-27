import {
  EPUBReaderSyncV2DB,
  SYNC_V2_VERSION_3_STORES,
  SYNC_V2_VERSION_4_STORES,
  SYNC_V2_VERSION_7_STORES,
} from "@/lib/sync-v2/db";
import { computeFileId } from "@/lib/files/file-id";
import type { FileId } from "@/lib/files/types";
import Dexie from "dexie";

/** The historical schemas Sync Lab upgrades from. */
export type MigrationFixtureVersion = 3 | 5 | 7;

export interface MigrationDatabaseSummary {
  version: number;
  counts: Record<string, number>;
  /** Every table's rows; files without their bytes. */
  rows: Record<string, unknown[]>;
}
export interface MigrationCheck {
  label: string;
  passed: boolean;
}
export interface MigrationReport {
  databaseName: string;
  fromVersion: MigrationFixtureVersion;
  toVersion: number;
  before: MigrationDatabaseSummary;
  after: MigrationDatabaseSummary;
  checks: MigrationCheck[];
  passed: boolean;
}

async function summarize(database: Dexie): Promise<MigrationDatabaseSummary> {
  const tables = await Promise.all(
    database.tables.map(async (table): Promise<[string, unknown[]]> => {
      const rows: Record<string, unknown>[] = await table.toArray();
      return [
        table.name,
        table.name === "files"
          ? rows.map(({ blob: _blob, ...file }) => file)
          : rows,
      ];
    }),
  );
  return {
    version: database.verno,
    counts: Object.fromEntries(
      tables.map(([name, rows]) => [name, rows.length]),
    ),
    rows: Object.fromEntries(tables),
  };
}

const sameRows = (
  a: MigrationDatabaseSummary,
  b: MigrationDatabaseSummary,
  table: string,
) => JSON.stringify(a.rows[table]) === JSON.stringify(b.rows[table]);

const BOOK_ID = "migration-book";
const DEVICE_ID = "migration-device";

/**
 * A version 7 library: a book with its structure and materialization, a
 * highlight with its note, a draft, reading progress (a checkpoint, a
 * session and a status), reading settings, a chapter cache, and the
 * highlight still waiting to sync.
 */
function version7Rows(
  sourceFileId: FileId,
  fileSize: number,
): Record<string, unknown[]> {
  const anchor = {
    spineItemId: "chapter-1",
    startOffset: 4,
    endOffset: 23,
    textBefore: "",
    textAfter: "",
  };
  const highlight = {
    id: "migration-highlight",
    bookId: BOOK_ID,
    ...anchor,
    selectedText: "Keep this highlight",
    color: "yellow",
    createdAt: 200,
    isDeleted: false,
  };
  return {
    books: [
      {
        id: BOOK_ID,
        title: "Migration specimen",
        author: "Sync Lab",
        fileSize,
        dateAdded: 100,
        metadata: {},
        sourceFileId,
        cover: null,
        isDeleted: false,
      },
    ],
    bookStructures: [
      {
        bookId: BOOK_ID,
        manifest: [{ id: "chapter-1", href: "chapter-1.xhtml" }],
        spine: [{ idref: "chapter-1" }],
        toc: [{ label: "One", href: "chapter-1.xhtml" }],
      },
    ],
    bookMaterializations: [
      { bookId: BOOK_ID, sourceFileId, recipeVersion: 1, completedAt: 150 },
    ],
    highlights: [highlight],
    notes: [
      {
        id: "migration-note",
        bookId: BOOK_ID,
        anchor,
        kind: "note",
        content: "Keep this note through the upgrade",
        highlightId: highlight.id,
        quote: { text: highlight.selectedText, color: highlight.color },
        createdAt: 210,
        updatedAt: 220,
        isDeleted: false,
      },
    ],
    noteDrafts: [
      {
        id: "migration-draft",
        bookId: BOOK_ID,
        content: "Half a thought",
        updatedAt: 230,
        purpose: "create",
        target: { kind: "page", anchor },
      },
    ],
    readingCheckpoints: [
      {
        id: `resume:${DEVICE_ID}:${BOOK_ID}`,
        bookId: BOOK_ID,
        deviceId: DEVICE_ID,
        currentSpineIndex: 3,
        scrollProgress: 42,
        bookProgress: 0.37,
        lastRead: 300,
        isDeleted: false,
      },
    ],
    readingSessions: [
      {
        id: "migration-session",
        bookId: BOOK_ID,
        deviceId: DEVICE_ID,
        readerInstanceId: "migration-reader",
        startedAt: 240,
        endedAt: 300,
        lastActiveAt: 300,
        activeMs: 60,
        startSpineIndex: 2,
        startScrollProgress: 10,
        endSpineIndex: 3,
        endScrollProgress: 42,
        isDeleted: false,
      },
    ],
    readingState: [
      {
        id: "migration-state",
        bookId: BOOK_ID,
        status: "reading",
        timestamp: 240,
        createdAt: 240,
        isDeleted: false,
      },
    ],
    readingSettings: [
      { id: "default", fontSize: 18, lineHeight: 1.5, isDeleted: false },
    ],
    bookChapterSourceCache: [
      {
        bookId: BOOK_ID,
        fileHash: sourceFileId.slice(6),
        cacheVersion: 1,
        chaptersByPath: {},
        updatedAt: 100,
      },
    ],
    _sync_outbox: [
      {
        key: JSON.stringify(["highlights", highlight.id]),
        value: JSON.stringify(highlight),
        isDeleted: false,
        schemaVersion: 1,
        hlc: { wallTimeMs: 200, counter: 0 },
      },
    ],
  };
}

/**
 * Opens a real historical IndexedDB fixture with the current schema. All data is
 * synthetic and the temporary database is deleted, including on upgrade failure.
 * This checks storage upgrades, not app-version or wire-format compatibility,
 * except that the version 7 schema, the release before, must still open the
 * upgraded database: the case of a rollback.
 */
export async function runMigrationScenario(
  version: MigrationFixtureVersion,
): Promise<MigrationReport> {
  const databaseName = `sync-lab-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(databaseName);
  const current = new EPUBReaderSyncV2DB(databaseName);
  const previous = new Dexie(databaseName);
  try {
    legacy.version(version).stores(
      version === 3
        ? SYNC_V2_VERSION_3_STORES
        : version === 5
          ? {
              ...SYNC_V2_VERSION_4_STORES,
              bookMaterializations: "bookId, sourceFileId, recipeVersion",
            }
          : SYNC_V2_VERSION_7_STORES,
    );
    await legacy.open();
    const content = "Sync Lab migration fixture: preserved binary bytes.";
    const blob = new Blob([content], { type: "application/epub+zip" });
    const sourceFileId = await computeFileId(blob);
    await legacy.table("files").put({
      id: sourceFileId,
      blob,
      mediaType: blob.type,
      size: blob.size,
      storedAt: 100,
      remotePresent: true,
    });
    if (version === 7) {
      for (const [table, rows] of Object.entries(
        version7Rows(sourceFileId, blob.size),
      ))
        await legacy.table(table).bulkPut(rows);
    } else {
      await legacy.table("books").put({
        id: BOOK_ID,
        title: "Migration specimen",
        author: "Sync Lab",
        fileSize: blob.size,
        dateAdded: 100,
        metadata: {},
        manifest: [],
        spine: [],
        toc: [],
        isDeleted: false,
        ...(version === 3
          ? { fileHash: sourceFileId.slice(6), isDownloaded: 1 }
          : { sourceFileId, cover: null }),
      });
      await legacy.table("notes").put({
        id: "migration-note",
        annotationId: "annotation-1",
        bookId: BOOK_ID,
        spineItemId: "chapter-1",
        content: "Keep this note through the upgrade",
        createdAt: 100,
        isDeleted: false,
      });
      await legacy.table("bookChapterSourceCache").put({
        bookId: BOOK_ID,
        fileHash: sourceFileId.slice(6),
        cacheVersion: 1,
        chaptersByPath: {},
        updatedAt: 100,
      });
    }
    const before = await summarize(legacy);
    legacy.close();
    await current.open();
    const after = await summarize(current);
    const migratedFile = await current.files.get(sourceFileId);
    current.close();
    const checks: MigrationCheck[] = [
      {
        label: "Stored file bytes are unchanged",
        passed:
          migratedFile !== undefined &&
          new TextDecoder().decode(await migratedFile.blob.arrayBuffer()) ===
            content,
      },
      {
        label: "Existing note fields are preserved",
        passed: sameRows(after, before, "notes"),
      },
      {
        label: "Raw schema upgrade does not create or drop sync changes",
        passed: sameRows(after, before, "_sync_outbox"),
      },
      {
        label: "Local sync journal table is added empty",
        passed:
          !("_sync_journal" in before.counts) &&
          after.counts._sync_journal === 0,
      },
    ];
    if (version === 7) {
      checks.push(
        {
          label:
            "Books, highlights, notes, reading progress and files are unchanged",
          passed: Object.keys(before.rows).every((table) =>
            sameRows(after, before, table),
          ),
        },
        {
          label: "The version 7 schema still opens the upgraded database",
          passed: await opensAsVersion7(previous, before),
        },
      );
    } else {
      const book = after.rows.books?.[0] as Record<string, unknown> | undefined;
      checks.push(
        {
          label: "Book file reference uses the opaque file ID",
          passed: book?.sourceFileId === sourceFileId && !("fileHash" in book),
        },
        {
          label: "Local note drafts table is added empty",
          passed:
            !("noteDrafts" in before.counts) && after.counts.noteDrafts === 0,
        },
        {
          label: "Materialization table is available",
          passed: after.counts.bookMaterializations === 0,
        },
        {
          label:
            version === 3
              ? "Old derived chapter cache is discarded"
              : "Existing chapter cache is preserved",
          passed:
            after.counts.bookChapterSourceCache === (version === 3 ? 0 : 1),
        },
      );
    }
    return {
      databaseName,
      fromVersion: version,
      toVersion: after.version,
      before,
      after,
      checks,
      passed: checks.every((check) => check.passed),
    };
  } finally {
    legacy.close();
    current.close();
    previous.close();
    await Dexie.delete(databaseName);
  }
}

/**
 * A rollback runs version 7 code on a version 8 database. Dexie 4 opens a
 * database newer than the version it declares as it is, when the newer
 * schema only adds to the declared one, so that code reads its rows.
 */
async function opensAsVersion7(
  previous: Dexie,
  before: MigrationDatabaseSummary,
): Promise<boolean> {
  previous.version(7).stores(SYNC_V2_VERSION_7_STORES);
  try {
    await previous.open();
  } catch {
    return false;
  }
  const reopened = await summarize(previous);
  return Object.keys(before.rows).every((table) =>
    sameRows(reopened, before, table),
  );
}
