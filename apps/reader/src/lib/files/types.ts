declare const fileIdBrand: unique symbol;

/** Opaque, content-derived identity owned by the files implementation. */
export type FileId = string & { readonly [fileIdBrand]: true };

export interface FileMetadata {
  mediaType?: string;
}

export interface LocalFile {
  id: FileId;
  blob: Blob;
  mediaType: string;
  size: number;
  storedAt: number;
  remotePresent: boolean;
}

export interface RemoteFile {
  id: FileId;
  fileSize: number;
  mediaType: string;
  createdAt: number;
}

export type FileUploadFailure =
  | { kind: "none" }
  | { kind: "failed"; message: string; failedAt: number };

export interface FileUploadOperation {
  id: FileId;
  createdAt: number;
  retryCount: number;
  lastFailure: FileUploadFailure;
}

/** For a download that shows its progress, and that its caller can stop. */
export interface FileDownloadOptions {
  /**
   * Stops waiting. A download shared with another caller continues until
   * every caller has stopped.
   */
  signal?: AbortSignal;
  /** Bytes received, and the total when the server sends one. */
  onProgress?: (bytes: number, totalBytes: number | null) => void;
}

export interface Files {
  put(blob: Blob, metadata?: FileMetadata): Promise<FileId>;
  get(id: FileId, options?: FileDownloadOptions): Promise<Blob>;
  hasLocal(id: FileId): Promise<boolean>;
  ensureLocal(id: FileId): Promise<void>;
  listLocal(): Promise<LocalFile[]>;
  listRemote(): Promise<RemoteFile[]>;
  deleteRemote(id: FileId): Promise<void>;
}
