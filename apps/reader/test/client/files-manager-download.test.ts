import { db } from "@/lib/db";
import { computeFileId } from "@/lib/files/file-id";
import type { FileRemoteApi } from "@/lib/files/file-remote-api";
import { FilesManager } from "@/lib/files/files-manager";
import type { FileDownloadOptions, FileId } from "@/lib/files/types";
import { beforeEach, expect, it } from "vitest";

/** A remote whose downloads report bytes and wait until released. */
class SlowRemote implements FileRemoteApi {
  readonly blobs = new Map<FileId, Blob>();
  calls = 0;
  aborted = 0;
  private releases: Array<() => void> = [];

  async put(): Promise<never> {
    throw new Error("Not used");
  }
  async list() {
    return [];
  }
  async delete() {}

  async get(id: FileId, options: FileDownloadOptions = {}): Promise<Blob> {
    this.calls += 1;
    const blob = this.blobs.get(id)!;
    options.onProgress?.(0, blob.size);
    options.onProgress?.(blob.size / 2, blob.size);
    await new Promise<void>((resolve, reject) => {
      this.releases.push(resolve);
      options.signal?.addEventListener("abort", () => {
        this.aborted += 1;
        reject(options.signal!.reason);
      });
    });
    options.onProgress?.(blob.size, blob.size);
    return blob;
  }

  release() {
    for (const release of this.releases.splice(0)) release();
  }
}

async function remoteFile(remote: SlowRemote): Promise<FileId> {
  const blob = new Blob(["a".repeat(1000)], { type: "application/epub+zip" });
  const id = await computeFileId(blob);
  remote.blobs.set(id, blob);
  return id;
}

beforeEach(async () => {
  await db.files.clear();
});

it("reports a download's bytes to each caller, from where it is", async () => {
  const remote = new SlowRemote();
  const files = new FilesManager(remote);
  const id = await remoteFile(remote);
  const first: number[] = [];
  const second: number[] = [];
  const a = files.get(id, { onProgress: (bytes) => first.push(bytes) });
  await expect.poll(() => first.length).toBe(1);
  const b = files.get(id, { onProgress: (bytes) => second.push(bytes) });
  await expect.poll(() => second.length).toBe(1);
  remote.release();
  await Promise.all([a, b]);
  expect(remote.calls).toBe(1);
  expect(first).toEqual([500, 1000]);
  expect(second).toEqual([500, 1000]);
  expect(await files.hasLocal(id)).toBe(true);
});

it("stops the download when its only caller stops", async () => {
  const remote = new SlowRemote();
  const files = new FilesManager(remote);
  const id = await remoteFile(remote);
  const controller = new AbortController();
  const download = files.get(id, { signal: controller.signal });
  await expect.poll(() => remote.calls).toBe(1);
  controller.abort();
  await expect(download).rejects.toThrow();
  expect(remote.aborted).toBe(1);
  expect(await files.hasLocal(id)).toBe(false);
  expect(files.getSnapshot().downloading).toEqual([]);
});

it("keeps a shared download for the caller that still waits", async () => {
  const remote = new SlowRemote();
  const files = new FilesManager(remote);
  const id = await remoteFile(remote);
  const controller = new AbortController();
  const background = files.get(id, { signal: controller.signal });
  await expect.poll(() => remote.calls).toBe(1);
  // The Reader opens the same book and waits for it, without a signal.
  const reader = files.get(id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  await expect(background).rejects.toThrow();
  remote.release();
  expect((await reader).size).toBe(1000);
  expect(remote.aborted).toBe(0);
  expect(remote.calls).toBe(1);
});
