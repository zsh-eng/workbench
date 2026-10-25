import { readerApiFetch } from "../shared-fetch";
import { parseFileId } from "@/lib/files/file-id";
import type {
  FileDownloadOptions,
  FileId,
  RemoteFile,
} from "@/lib/files/types";

export interface FileRemoteApi {
  put(id: FileId, blob: Blob, mediaType: string): Promise<RemoteFile>;
  get(id: FileId, options?: FileDownloadOptions): Promise<Blob>;
  list(): Promise<RemoteFile[]>;
  delete(id: FileId): Promise<void>;
}

export class FileRemoteRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FileRemoteRequestError";
    this.status = status;
  }
}

async function requireSuccessfulResponse(
  response: Response,
  operation: string,
): Promise<void> {
  if (response.ok) return;

  const responseText = await response.text().catch(() => "");
  const detail = responseText ? `: ${responseText}` : "";
  throw new FileRemoteRequestError(
    `${operation} failed with status ${response.status}${detail}`,
    response.status,
  );
}

function parseRemoteFile(value: unknown): RemoteFile {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid remote file response");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.fileSize !== "number" ||
    typeof candidate.mediaType !== "string" ||
    typeof candidate.createdAt !== "number"
  ) {
    throw new Error("Invalid remote file response");
  }

  return {
    id: parseFileId(candidate.id),
    fileSize: candidate.fileSize,
    mediaType: candidate.mediaType,
    createdAt: candidate.createdAt,
  };
}

/** Reads a response body in chunks, reporting the bytes as they arrive. */
async function readWithProgress(
  response: Response,
  onProgress: NonNullable<FileDownloadOptions["onProgress"]>,
): Promise<Blob> {
  const length = Number(response.headers.get("Content-Length"));
  const total = Number.isFinite(length) && length > 0 ? length : null;
  const reader = response.body!.getReader();
  const chunks: BlobPart[] = [];
  let bytes = 0;
  onProgress(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
    onProgress(bytes, total);
  }
  return new Blob(chunks, {
    type: response.headers.get("Content-Type") ?? "",
  });
}

/** Fetch implementation for the authenticated generic server files API. */
export class FetchFileRemoteApi implements FileRemoteApi {
  async put(id: FileId, blob: Blob, mediaType: string): Promise<RemoteFile> {
    const response = await readerApiFetch(`/api/files/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": mediaType,
      },
      body: blob,
      credentials: "include",
    });
    await requireSuccessfulResponse(response, "File upload");
    return parseRemoteFile(await response.json());
  }

  async get(id: FileId, options: FileDownloadOptions = {}): Promise<Blob> {
    const response = await readerApiFetch(`/api/files/${id}`, {
      credentials: "include",
      signal: options.signal,
    });
    await requireSuccessfulResponse(response, "File download");
    if (!options.onProgress || !response.body) return response.blob();
    return readWithProgress(response, options.onProgress);
  }

  async list(): Promise<RemoteFile[]> {
    const response = await readerApiFetch("/api/files", {
      credentials: "include",
    });
    await requireSuccessfulResponse(response, "Remote file inventory");

    const body: unknown = await response.json();
    if (!body || typeof body !== "object") {
      throw new Error("Invalid remote file inventory response");
    }

    const files = (body as Record<string, unknown>).files;
    if (!Array.isArray(files)) {
      throw new Error("Invalid remote file inventory response");
    }

    return files.map(parseRemoteFile);
  }

  async delete(id: FileId): Promise<void> {
    const response = await readerApiFetch(`/api/files/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    await requireSuccessfulResponse(response, "Remote file deletion");
  }
}
