import { getLabRuntime } from "@/features/sync-lab/runtime";
import { db } from "@/lib/db";
import Dexie from "dexie";
import { computeFileId } from "@/lib/files/file-id";
import {
  FetchFileRemoteApi,
  FileRemoteRequestError,
  type FileRemoteApi,
} from "@/lib/files/file-remote-api";
import type {
  FileDownloadOptions,
  FileId,
  FileMetadata,
  Files,
  FileUploadOperation,
  IdentifiedFile,
  LocalFile,
  RemoteFile,
} from "@/lib/files/types";

const UPLOAD_RETRY_INITIAL_MS = 1_000;
const UPLOAD_RETRY_MAX_MS = 30_000;

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

/**
 * One download, shared by every caller that asks for the file. It stops only
 * when each caller that can stop has stopped; a caller without a signal
 * keeps it going.
 */
interface SharedDownload {
  promise: Promise<Blob>;
  controller: AbortController;
  holders: number;
  progress: { bytes: number; total: number | null } | null;
  listeners: Set<NonNullable<FileDownloadOptions["onProgress"]>>;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

/**
 * Local-first file facade and durable upload worker.
 *
 * `put()` commits the Blob and upload intent in one transaction; `identify()`
 * and `store()` split it, so a caller can commit a file with its own rows.
 * Downloads are
 * shared by FileId; each caller can follow the bytes and stop waiting.
 * Uploads run only while the app has enabled them for an authenticated,
 * online session.
 */
export interface FileTransferState {
  uploading: FileId | null;
  downloading: readonly FileId[];
  authRequired: boolean;
}

export class FilesManager implements Files {
  private sessionId: string | undefined;
  private state: FileTransferState = {
    uploading: null,
    downloading: [],
    authRequired: false,
  };
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private publish(change: Partial<FileTransferState>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private readonly remote: FileRemoteApi;
  private readonly pendingOperations = new Set<Promise<unknown>>();
  private readonly downloads = new Map<FileId, SharedDownload>();
  private uploadsEnabled = false;
  private uploadLifecycleVersion = 0;
  private uploadLoop: Promise<void> | null = null;
  private uploadWakeRequested = false;
  private uploadRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadRetryDelayMs = UPLOAD_RETRY_INITIAL_MS;

  constructor(remote: FileRemoteApi) {
    this.remote = remote;
  }

  put(blob: Blob, metadata: FileMetadata = {}): Promise<FileId> {
    return this.track(this.putFile(blob, metadata));
  }

  private async putFile(blob: Blob, metadata: FileMetadata): Promise<FileId> {
    const file = await this.identify(blob, metadata);
    await this.storeFile(file);
    return file.id;
  }

  /** Calculates a Blob's id and stored form. It writes nothing. */
  async identify(
    blob: Blob,
    metadata: FileMetadata = {},
  ): Promise<IdentifiedFile> {
    const id = await computeFileId(blob);
    const mediaType = metadata.mediaType || blob.type || DEFAULT_MEDIA_TYPE;
    return {
      id,
      mediaType,
      blob:
        blob.type === mediaType ? blob : blob.slice(0, blob.size, mediaType),
    };
  }

  /**
   * Stores identified bytes and their upload intent in one transaction.
   * Inside a caller's transaction, which must include `files` and
   * `fileUploadOperations`, they commit or roll back with the caller's rows,
   * and the upload starts only once that transaction has committed.
   */
  store(file: IdentifiedFile): Promise<void> {
    return this.track(this.storeFile(file));
  }

  private async storeFile({
    id,
    blob,
    mediaType,
  }: IdentifiedFile): Promise<void> {
    await db.transaction(
      "rw",
      [db.files, db.fileUploadOperations],
      async () => {
        const existingFile = await db.files.get(id);
        if (existingFile?.remotePresent) return;

        if (!existingFile) {
          await db.files.add({
            id,
            blob,
            mediaType,
            size: blob.size,
            storedAt: Date.now(),
            remotePresent: false,
          });
        }

        const existingOperation = await db.fileUploadOperations.get(id);
        if (existingOperation) return;

        await db.fileUploadOperations.add({
          id,
          createdAt: Date.now(),
          retryCount: 0,
          lastFailure: { kind: "none" },
        });
      },
    );

    // Inside a caller's transaction the rows exist once that one commits.
    const outer = Dexie.currentTransaction;
    if (!outer) {
      this.startUploadLoop();
      return;
    }
    outer.idbtrans.addEventListener(
      "complete",
      () => Dexie.ignoreTransaction(() => this.startUploadLoop()),
      { once: true },
    );
  }

  get(id: FileId, options: FileDownloadOptions = {}): Promise<Blob> {
    return this.track(this.getFile(id, options));
  }

  private async getFile(
    id: FileId,
    options: FileDownloadOptions,
  ): Promise<Blob> {
    const localFile = await db.files.get(id);
    if (localFile) return localFile.blob;
    options.signal?.throwIfAborted();
    return this.join(this.downloads.get(id) ?? this.startDownload(id), options);
  }

  private startDownload(id: FileId): SharedDownload {
    const controller = new AbortController();
    const download: SharedDownload = {
      promise: Promise.resolve(new Blob()),
      controller,
      holders: 0,
      progress: null,
      listeners: new Set(),
    };
    download.promise = this.downloadAndStore(id, {
      signal: controller.signal,
      onProgress: (bytes, total) => {
        download.progress = { bytes, total };
        for (const listener of download.listeners) listener(bytes, total);
      },
    }).finally(() => {
      if (this.downloads.get(id) !== download) return;
      this.downloads.delete(id);
      this.publish({ downloading: [...this.downloads.keys()] });
    });
    // A caller that stops early must not leave an unhandled rejection.
    download.promise.catch(() => {});
    this.downloads.set(id, download);
    this.publish({ downloading: [...this.downloads.keys()] });
    return download;
  }

  private join(
    download: SharedDownload,
    { signal, onProgress }: FileDownloadOptions,
  ): Promise<Blob> {
    download.holders += signal ? 1 : Number.POSITIVE_INFINITY;
    if (onProgress) {
      download.listeners.add(onProgress);
      if (download.progress)
        onProgress(download.progress.bytes, download.progress.total);
    }
    return new Promise<Blob>((resolve, reject) => {
      const onAbort = () => {
        download.holders -= 1;
        if (download.holders <= 0)
          download.controller.abort(abortError(signal!));
        reject(abortError(signal!));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      download.promise.then(resolve, reject).finally(() => {
        signal?.removeEventListener("abort", onAbort);
        if (onProgress) download.listeners.delete(onProgress);
      });
    });
  }

  async hasLocal(id: FileId): Promise<boolean> {
    return (await db.files.get(id)) !== undefined;
  }

  async ensureLocal(id: FileId): Promise<void> {
    await this.get(id);
  }

  async listLocal(): Promise<LocalFile[]> {
    return db.files.orderBy("storedAt").toArray();
  }

  async listRemote(): Promise<RemoteFile[]> {
    return this.remote.list();
  }

  deleteRemote(id: FileId): Promise<void> {
    return this.track(this.deleteRemoteFile(id));
  }

  private async deleteRemoteFile(id: FileId): Promise<void> {
    const resumeUploads = this.uploadsEnabled;
    this.pauseUploads();
    const lifecycleVersion = this.uploadLifecycleVersion;
    await this.uploadLoop;

    try {
      try {
        await this.remote.delete(id);
      } catch (error) {
        if (
          !(error instanceof FileRemoteRequestError) ||
          error.status !== 404
        ) {
          throw error;
        }
      }

      await db.transaction(
        "rw",
        [db.files, db.fileUploadOperations],
        async () => {
          const localFile = await db.files.get(id);
          if (localFile) {
            await db.files.update(id, { remotePresent: false });
          }
          await db.fileUploadOperations.delete(id);
        },
      );
    } finally {
      if (resumeUploads && lifecycleVersion === this.uploadLifecycleVersion)
        this.resumeUploads();
    }
  }

  /** Remember confirmed sessions across hook remounts without starting offline work. */
  setSessionIdentity(sessionId: string | undefined): void {
    if (sessionId === undefined || sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.resetUploadRetry();
  }

  private resetUploadRetry(): void {
    this.publish({ authRequired: false });
    if (this.uploadRetryTimer !== null) {
      clearTimeout(this.uploadRetryTimer);
      this.uploadRetryTimer = null;
    }
    this.uploadRetryDelayMs = UPLOAD_RETRY_INITIAL_MS;
  }

  /** Explicit retry after user request; reconnect alone cannot loop on 401. */
  retryUploads(): void {
    this.resetUploadRetry();
    this.resumeUploads();
  }

  resumeUploads(): void {
    if (this.state.authRequired) return;
    this.uploadLifecycleVersion++;
    this.uploadsEnabled = true;
    this.startUploadLoop();
  }

  pauseUploads(): void {
    this.uploadLifecycleVersion++;
    this.uploadsEnabled = false;
    this.uploadWakeRequested = false;
    if (this.uploadRetryTimer !== null) {
      clearTimeout(this.uploadRetryTimer);
      this.uploadRetryTimer = null;
    }
  }

  /** Wait for issued file operations after the caller has stopped new work. */
  async drain(): Promise<void> {
    while (this.pendingOperations.size > 0 || this.uploadLoop !== null) {
      await Promise.allSettled([
        ...this.pendingOperations,
        ...(this.uploadLoop ? [this.uploadLoop] : []),
      ]);
    }
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() =>
      this.pendingOperations.delete(tracked),
    );
    this.pendingOperations.add(tracked);
    return tracked;
  }

  private async downloadAndStore(
    id: FileId,
    options: FileDownloadOptions,
  ): Promise<Blob> {
    const blob = await this.remote.get(id, options);
    options.signal?.throwIfAborted();
    const mediaType = blob.type || DEFAULT_MEDIA_TYPE;

    await db.transaction(
      "rw",
      [db.files, db.fileUploadOperations],
      async () => {
        await db.files.put({
          id,
          blob,
          mediaType,
          size: blob.size,
          storedAt: Date.now(),
          remotePresent: true,
        });
        await db.fileUploadOperations.delete(id);
      },
    );

    return blob;
  }

  private startUploadLoop(): void {
    if (!this.uploadsEnabled || this.uploadRetryTimer !== null) return;
    if (this.uploadLoop) {
      this.uploadWakeRequested = true;
      return;
    }

    this.uploadWakeRequested = false;
    this.uploadLoop = this.processUploads()
      .catch((error) => {
        console.error("File upload processing failed:", error);
        this.scheduleUploadRetry();
      })
      .finally(() => {
        this.uploadLoop = null;
        if (this.uploadWakeRequested) this.startUploadLoop();
      });
  }

  /** Keep one bounded retry timer; new puts cannot bypass the backoff. */
  private scheduleUploadRetry(): void {
    if (!this.uploadsEnabled || this.uploadRetryTimer !== null) return;
    this.uploadRetryTimer = setTimeout(() => {
      this.uploadRetryTimer = null;
      this.startUploadLoop();
    }, this.uploadRetryDelayMs);
    this.uploadRetryDelayMs = Math.min(
      this.uploadRetryDelayMs * 2,
      UPLOAD_RETRY_MAX_MS,
    );
  }

  private async processUploads(): Promise<void> {
    while (this.uploadsEnabled) {
      const operation = await db.fileUploadOperations
        .orderBy("createdAt")
        .first();
      if (!operation) return;

      const succeeded = await this.processUpload(operation);
      if (!succeeded) {
        this.scheduleUploadRetry();
        return;
      }
      this.uploadRetryDelayMs = UPLOAD_RETRY_INITIAL_MS;
    }
  }

  private async processUpload(
    operation: FileUploadOperation,
  ): Promise<boolean> {
    const localFile = await db.files.get(operation.id);
    if (!localFile) {
      await db.fileUploadOperations.delete(operation.id);
      return true;
    }

    if (!this.uploadsEnabled) return false;

    this.publish({ uploading: operation.id });
    const sessionId = this.sessionId;
    try {
      await this.remote.put(operation.id, localFile.blob, localFile.mediaType);
      await db.transaction(
        "rw",
        [db.files, db.fileUploadOperations],
        async () => {
          await db.files.update(operation.id, { remotePresent: true });
          await db.fileUploadOperations.delete(operation.id);
        },
      );
      return true;
    } catch (error) {
      if (
        sessionId === this.sessionId &&
        error instanceof FileRemoteRequestError &&
        error.status === 401
      ) {
        this.pauseUploads();
        this.publish({ authRequired: true });
      }
      await db.fileUploadOperations.update(operation.id, {
        retryCount: operation.retryCount + 1,
        lastFailure: {
          kind: "failed",
          message: error instanceof Error ? error.message : String(error),
          failedAt: Date.now(),
        },
      });
      return false;
    } finally {
      this.publish({ uploading: null });
    }
  }
}

export const files = new FilesManager(
  getLabRuntime()?.fileRemote ?? new FetchFileRemoteApi(),
);
