import { SHARED_STORAGE_SUFFIX } from "../shared-api";
import { getLabRuntime, getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { SyncClientStateStorage } from "@/lib/sync-v2/client-state";
/**
 * Fresh client database for sync v2.
 *
 * This database starts at version 1 and contains no legacy sync metadata.
 */

import type { Book } from "@/data/books";
import type {
  BookChapterSourceCache,
  BookFile,
  BookMaterialization,
  BookTextCache,
} from "@/data/book-content";
import type { ReadingCheckpoint } from "@/data/reading-checkpoints";
import type { ReadingSession } from "@/data/reading-sessions";
import type { ReadingSettings } from "@/data/reading-settings";
import { normalizeBookFileReferences } from "@/lib/book-file-references";
import { fileIdFromContentHash } from "@/lib/files/file-id";
import type { FileId, FileUploadOperation, LocalFile } from "@/lib/files/types";
import { getOrCreateDeviceId } from "@/lib/device";
import {
  getOrCreateSyncClientState,
  nextSyncHlcBatch,
} from "@/lib/sync-v2/client-state";
import { installSync } from "@zsh-eng/local-sync/dexie";
import { READER_SYNC_TABLES } from "./tables";
export { SYNC_V2_SYNCED_TABLES } from "./tables";
import type { SyncPushChange } from "@zsh-eng/local-sync";
import type { Highlight } from "@/types/highlight";
import type { NoteDraft, Note } from "@/types/note";
import type { ReadingState } from "@/types/reading-state";
import Dexie, { type Table, type Transaction } from "dexie";

export const SYNC_V2_DATABASE_NAME =
  "epub-reader-db-v2" + SHARED_STORAGE_SUFFIX;
const LEGACY_DATABASE_NAME = "epub-reader-db";

export interface SyncV2DeletionState {
  isDeleted: boolean;
}

export type SyncV2DomainRow<Row> = Row & SyncV2DeletionState;
export type SyncV2Book = SyncV2DomainRow<Book>;
export type SyncV2ReadingCheckpoint = SyncV2DomainRow<ReadingCheckpoint>;
export type SyncV2ReadingSession = SyncV2DomainRow<ReadingSession>;
export type SyncV2Highlight = SyncV2DomainRow<Highlight>;
export type SyncV2ReadingSettings = SyncV2DomainRow<ReadingSettings>;
export type SyncV2ReadingState = SyncV2DomainRow<ReadingState>;
export type SyncV2Note = SyncV2DomainRow<Note>;

/**
 * Domain indexes only. Sync ordering and delivery state live in the outbox.
 */
const SYNC_V2_STORES_WITHOUT_BOOKS = {
  readingCheckpoints:
    "id, bookId, deviceId, lastRead, [bookId+deviceId], [bookId+lastRead]",
  readingSessions:
    "id, bookId, deviceId, readerInstanceId, startedAt, lastActiveAt, endedAt, [bookId+startedAt], [deviceId+lastActiveAt]",
  highlights:
    "id, bookId, spineItemId, createdAt, [bookId+spineItemId], [bookId+createdAt]",
  readingSettings: "id",
  readingState: "id, bookId, timestamp, [bookId+timestamp]",
  notes:
    "id, annotationId, bookId, createdAt, [annotationId+createdAt], [bookId+spineItemId]",
  bookFiles: "id, bookId, path, [bookId+path]",
  bookTextCache: "bookId",
  bookChapterSourceCache: "bookId, updatedAt",
  _sync_outbox: "key",
} as const;

const SYNC_V2_LEGACY_SHARED_STORES = {
  books: "id, dateAdded, &fileHash",
  ...SYNC_V2_STORES_WITHOUT_BOOKS,
} as const;

const SYNC_V2_CURRENT_SHARED_STORES = {
  books: "id, dateAdded, &sourceFileId",
  ...SYNC_V2_STORES_WITHOUT_BOOKS,
} as const;

export const SYNC_V2_STORES = {
  ...SYNC_V2_CURRENT_SHARED_STORES,
  notes: "id, bookId, highlightId, createdAt",
  noteDrafts: "id, bookId",
  files: "id, remotePresent, storedAt",
  fileUploadOperations: "id, createdAt",
  bookMaterializations: "bookId, sourceFileId, recipeVersion",
} as const;

export const SYNC_V2_VERSION_4_STORES = {
  ...SYNC_V2_CURRENT_SHARED_STORES,
  files: "id, remotePresent, storedAt",
  fileUploadOperations: "id, createdAt",
} as const;

export const SYNC_V2_VERSION_3_STORES = {
  ...SYNC_V2_LEGACY_SHARED_STORES,
  files: "id, remotePresent, storedAt",
  fileUploadOperations: "id, createdAt",
} as const;

export const SYNC_V2_VERSION_2_STORES = {
  ...SYNC_V2_LEGACY_SHARED_STORES,
  files: "id, contentHash, fileType, [fileType+contentHash]",
  transferQueue:
    "id, status, priority, createdAt, [status+priority], [contentHash+fileType+direction]",
} as const;

interface LegacyStoredFile {
  id: string;
  contentHash: string;
  fileType: "epub" | "cover";
  blob: Blob;
  mediaType: string;
  size: number;
  storedAt: number;
}

interface LegacyTransferTask {
  id: string;
  direction: "upload" | "download";
  contentHash: string;
  fileType: "epub" | "cover";
  status: "pending" | "processing" | "completed" | "failed";
  priority: number;
  createdAt: number;
  retryCount: number;
  maxRetries: number;
  lastAttempt?: number;
  error?: string;
}

export const SYNC_V2_VERSION_1_STORES = {
  ...SYNC_V2_VERSION_2_STORES,
  readingProgress: "id, bookId, lastRead, [bookId+lastRead]",
} as const;

function fileIdFromLegacyHash(contentHash: string): FileId {
  return fileIdFromContentHash(contentHash);
}

/** Convert type-specific v2 rows into opaque files and upload operations. */
async function migrateFilesV3(transaction: Transaction): Promise<void> {
  const legacyFiles = await transaction
    .table<LegacyStoredFile, string>("files")
    .toArray();
  const legacyTransfers = await transaction
    .table<LegacyTransferTask, string>("transferQueue")
    .toArray();

  const knownRemoteHashes = new Set(
    legacyTransfers
      .filter((task) => task.status === "completed")
      .map((task) => task.contentHash),
  );
  const pendingUploads = new Map<string, LegacyTransferTask>();

  for (const task of legacyTransfers) {
    if (task.direction !== "upload" || task.status === "completed") continue;

    const existing = pendingUploads.get(task.contentHash);
    if (!existing || task.createdAt > existing.createdAt) {
      pendingUploads.set(task.contentHash, task);
    }
  }

  const filesById = new Map<FileId, LocalFile>();
  for (const legacyFile of legacyFiles) {
    const id = fileIdFromLegacyHash(legacyFile.contentHash);
    const existing = filesById.get(id);
    const remotePresent = knownRemoteHashes.has(legacyFile.contentHash);

    if (existing && existing.storedAt > legacyFile.storedAt) {
      existing.remotePresent ||= remotePresent;
      continue;
    }

    filesById.set(id, {
      id,
      blob: legacyFile.blob,
      mediaType: legacyFile.mediaType,
      size: legacyFile.size,
      storedAt: legacyFile.storedAt,
      remotePresent: remotePresent || existing?.remotePresent === true,
    });
  }

  const uploadOperations: FileUploadOperation[] = [];
  for (const file of filesById.values()) {
    if (file.remotePresent) continue;

    const contentHash = file.id.slice("xxh64:".length);
    const legacyUpload = pendingUploads.get(contentHash);
    uploadOperations.push({
      id: file.id,
      createdAt: legacyUpload?.createdAt ?? file.storedAt,
      retryCount: legacyUpload?.retryCount ?? 0,
      lastFailure:
        legacyUpload?.status === "failed" && legacyUpload.error
          ? {
              kind: "failed",
              message: legacyUpload.error,
              failedAt: legacyUpload.lastAttempt ?? legacyUpload.createdAt,
            }
          : { kind: "none" },
    });
  }

  const filesTable = transaction.table<LocalFile, FileId>("files");
  const uploadsTable = transaction.table<FileUploadOperation, FileId>(
    "fileUploadOperations",
  );
  await filesTable.clear();
  await filesTable.bulkPut([...filesById.values()]);
  await uploadsTable.bulkPut(uploadOperations);
}

/** Replace synchronized hash fields with opaque file references. */
async function migrateBooksV4(transaction: Transaction): Promise<void> {
  await transaction
    .table<Record<string, unknown>, string>("books")
    .toCollection()
    .modify((book) => {
      const normalized = normalizeBookFileReferences(book);
      for (const key of Object.keys(book)) delete book[key];
      Object.assign(book, normalized);
    });

  // This cache is derived local data. The normal preparation flow rebuilds it.
  await transaction.table("bookChapterSourceCache").clear();
}

/** Schema-only connection used by the sync engine for direct remote writes. */
export class EPUBReaderSyncV2DB extends Dexie {
  books!: Table<SyncV2Book, string>;
  readingCheckpoints!: Table<SyncV2ReadingCheckpoint, string>;
  readingSessions!: Table<SyncV2ReadingSession, string>;
  highlights!: Table<SyncV2Highlight, string>;
  readingSettings!: Table<SyncV2ReadingSettings, string>;
  readingState!: Table<SyncV2ReadingState, string>;
  notes!: Table<SyncV2Note, string>;
  noteDrafts!: Table<NoteDraft, string>;

  bookFiles!: Table<BookFile, string>;
  bookMaterializations!: Table<BookMaterialization, string>;
  files!: Table<LocalFile, FileId>;
  fileUploadOperations!: Table<FileUploadOperation, FileId>;
  bookTextCache!: Table<BookTextCache, string>;
  bookChapterSourceCache!: Table<BookChapterSourceCache, string>;

  _sync_outbox!: Table<SyncPushChange, string>;

  constructor(databaseName = SYNC_V2_DATABASE_NAME) {
    super(databaseName);
    this.version(1).stores(SYNC_V2_VERSION_1_STORES);
    this.version(2).stores({ readingProgress: null });
    this.version(3)
      .stores({
        files: SYNC_V2_STORES.files,
        transferQueue: null,
        fileUploadOperations: SYNC_V2_STORES.fileUploadOperations,
      })
      .upgrade(migrateFilesV3);
    this.version(4)
      .stores({ books: SYNC_V2_STORES.books })
      .upgrade(migrateBooksV4);
    this.version(5).stores({
      bookMaterializations: SYNC_V2_STORES.bookMaterializations,
    });
    this.version(6).stores({
      notes: SYNC_V2_STORES.notes,
      noteDrafts: SYNC_V2_STORES.noteDrafts,
    });
  }
}

/** Remove the pre-v2 database after the completed production cutover. */
export async function deleteLegacyClientDatabase(): Promise<void> {
  if (getLabRuntime() || SHARED_STORAGE_SUFFIX) return;
  await Dexie.delete(LEGACY_DATABASE_NAME);
}

/** Create the application-facing connection that captures local mutations. */
export function createSyncV2ApplicationDb(
  databaseName = getLabRuntime()?.databaseName ?? SYNC_V2_DATABASE_NAME,
  state:
    | { deviceId: string; storage: SyncClientStateStorage; now: () => number }
    | undefined = undefined,
): EPUBReaderSyncV2DB {
  const db = new EPUBReaderSyncV2DB(databaseName);
  installSync(db, READER_SYNC_TABLES, (count) => {
    const storage = state?.storage ?? getRuntimeStorage();
    getOrCreateSyncClientState(
      state?.deviceId ?? getOrCreateDeviceId(),
      storage,
    );
    return nextSyncHlcBatch(
      count,
      storage,
      state?.now() ?? getLabRuntime()?.now() ?? Date.now(),
    );
  });
  return db;
}

export const syncV2Db = createSyncV2ApplicationDb();

/** The sync engine uses this raw connection to avoid producing new changes. */
export const syncV2SyncDb = new EPUBReaderSyncV2DB(syncV2Db.name);
