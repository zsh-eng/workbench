import { API_BASE, SHARED_API_ORIGIN, SHARED_STORAGE_SUFFIX } from "@/lib/api";
import {
  requestSharedFile,
  requestSharedFileBatch,
} from "../files/shared-request";
import { PromiseRateLimiterQueue } from "./promise-limiter";
import { downloadFiles, isFileId } from "@workbench/file-batch";
import { Dexie, type EntityTable, type Table } from "dexie";

export type UncachedImage = { url: string };
export type CachedImage = {
  url: string;
  altText: string;
  cachedAt: number;
  thumbnail: Blob;
  size: number;
};
export type ImageBlob = { url: string; content: Blob };
export type ImageCacheDatabase = Dexie & {
  images: Table<CachedImage | UncachedImage, string>;
  imageBlobs: EntityTable<ImageBlob, "url">;
};

export function createImageDatabase(name: string): ImageCacheDatabase {
  const database = new Dexie(name) as ImageCacheDatabase;
  database.version(1).stores({
    images: "url, altText, cachedAt, thumbnail, size",
    imageBlobs: "url, content",
  });
  return database;
}

// Keep metadata separate so consumers can read it without loading full images.
export const imagePersistedDb = createImageDatabase(
  "ImageCacheV2" + SHARED_STORAGE_SUFFIX,
);

function isCachedImage(
  image: CachedImage | UncachedImage,
): image is CachedImage {
  return (
    "cachedAt" in image &&
    Number.isFinite(image.cachedAt) &&
    typeof image.altText === "string" &&
    Number.isFinite(image.size) &&
    image.size > 0 &&
    image.thumbnail instanceof Blob &&
    image.thumbnail.size > 0
  );
}

async function fetchImage(url: string): Promise<Blob> {
  const backendUrl = API_BASE;
  const response =
    SHARED_API_ORIGIN && url.startsWith(`${API_BASE}/files/`)
      ? await requestSharedFile(url.slice(API_BASE.length))
      : await fetch(
          url,
          backendUrl && url.startsWith(backendUrl)
            ? { credentials: "include", signal: AbortSignal.timeout(15000) }
            : { signal: AbortSignal.timeout(15000) },
        );
  if (!response.ok)
    throw new Error(`Image download failed (${response.status})`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("The downloaded image is empty");
  return blob;
}

/** One shared file, as `fetchImage` asks for it; any status. */
const fetchSharedFile = (id: string, signal: AbortSignal) =>
  requestSharedFile(`/files/${id}`, { signal });

/** The shared file that an image URL names, or undefined for another site. */
function sharedFileId(url: string) {
  if (!SHARED_API_ORIGIN || !url.startsWith(`${API_BASE}/files/`)) return;
  const id = url.slice(API_BASE.length + "/files/".length);
  return isFileId(id) ? id : undefined;
}

/** How one image of a bulk download ended. */
export type ImageOutcome = { newlyDownloaded: boolean } | { error: unknown };

/** Images from other sites that download at once. */
const OTHER_SITES_AT_ONCE = 5;

async function generateThumbnail(original: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to create canvas context");
  const image = new Image();
  const url = URL.createObjectURL(original);
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to load image"));
      image.src = url;
    });
    const size = Math.min(image.width, image.height);
    context.drawImage(
      image,
      (image.width - size) / 2,
      (image.height - size) / 2,
      size,
      size,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Failed to create thumbnail blob")),
        "image/jpeg",
        0.8,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class ImageCacheStore {
  readonly memory = new Map<
    string,
    { objectURL: string; referenceCount: number }
  >();
  private enabled = true;
  private downloads = new Map<
    string,
    Promise<{ blob: Blob; newlyDownloaded: boolean }>
  >();
  private writes = new Set<Promise<unknown>>();
  private clearing?: Promise<void>;

  constructor(
    private database = imagePersistedDb,
    private fetchBlob = fetchImage,
    private thumbnail = generateThumbnail,
  ) {}

  private checkEnabled() {
    if (!this.enabled) throw new Error("Image cache was cleared for sign-out");
  }

  /** `blob`: the image's bytes, when a bulk download already has them. */
  private ensureImage(url: string, altText: string, blob?: Blob) {
    this.checkEnabled();
    const existing = this.downloads.get(url);
    if (existing) return existing;
    const task = this.loadOrRepair(url, altText, blob);
    this.downloads.set(url, task);
    const remove = () => {
      if (this.downloads.get(url) === task) this.downloads.delete(url);
    };
    void task.then(remove, remove);
    return task;
  }

  private async loadOrRepair(url: string, altText: string, fetched?: Blob) {
    const [metadata, stored] = await Promise.all([
      this.database.images.get(url),
      this.database.imageBlobs.get(url),
    ]);
    this.checkEnabled();
    const hasBlob = stored?.content instanceof Blob && stored.content.size > 0;
    if (metadata && isCachedImage(metadata) && hasBlob) {
      return { blob: stored.content, newlyDownloaded: false };
    }
    const blob = hasBlob
      ? stored.content
      : (fetched ?? (await this.fetchBlob(url)));
    this.checkEnabled();
    const thumbnail =
      metadata && isCachedImage(metadata)
        ? metadata.thumbnail
        : await this.thumbnail(blob);
    this.checkEnabled();
    const write = this.database.transaction(
      "rw",
      this.database.images,
      this.database.imageBlobs,
      async () => {
        await this.database.images.put({
          url,
          altText,
          cachedAt: Date.now(),
          thumbnail,
          size: blob.size + thumbnail.size,
        });
        await this.database.imageBlobs.put({ url, content: blob });
      },
    );
    this.writes.add(write);
    try {
      await write;
    } finally {
      this.writes.delete(write);
    }
    this.checkEnabled();
    return { blob, newlyDownloaded: !hasBlob };
  }

  async download(url: string, altText: string) {
    const { newlyDownloaded } = await this.ensureImage(url, altText);
    return { newlyDownloaded };
  }

  /**
   * Downloads many images and keeps each as it arrives. Images in Spaced's
   * shared files come many to a request (packages/file-batch); images from
   * other sites, five at a time. Images already here are not asked for.
   * Rejects on abort, sign-out or a full disk; otherwise reports each image.
   */
  async downloadMany(
    links: readonly (readonly [url: string, altText: string])[],
    {
      signal,
      onSettled,
    }: {
      signal?: AbortSignal;
      onSettled(url: string, outcome: ImageOutcome): void;
    },
  ) {
    this.checkEnabled();
    const urls = links.map(([url]) => url);
    const [metadata, blobs] = await Promise.all([
      this.database.images.bulkGet(urls),
      this.database.imageBlobs.where(":id").anyOf(urls).primaryKeys(),
    ]);
    const stored = new Set(blobs);
    const shared = new Map<string, { url: string; altText: string }>();
    const others: (readonly [string, string])[] = [];
    links.forEach(([url, altText], index) => {
      const known = metadata[index];
      const id = sharedFileId(url);
      if (known && isCachedImage(known) && stored.has(url))
        onSettled(url, { newlyDownloaded: false });
      // A stored picture with damaged metadata repairs without the network.
      else if (id && !stored.has(url) && !this.downloads.has(url))
        shared.set(id, { url, altText });
      else others.push([url, altText]);
    });
    const limiter = new PromiseRateLimiterQueue(OTHER_SITES_AT_ONCE);
    const elsewhere = Promise.all(
      others.map(([url, altText]) =>
        limiter.add(async () => {
          if (signal?.aborted) return;
          try {
            onSettled(url, await this.download(url, altText));
          } catch (error) {
            if (signal?.aborted) return;
            onSettled(url, { error });
          }
        }),
      ),
    );
    const batches = downloadFiles({
      ids: shared.keys(),
      signal,
      fetchBatch: requestSharedFileBatch,
      fetchOne: fetchSharedFile,
      store: async (id, bytes, type) => {
        const { url, altText } = shared.get(id)!;
        const blob = new Blob([bytes], { type });
        try {
          const { newlyDownloaded } = await this.ensureImage(url, altText, blob);
          onSettled(url, { newlyDownloaded });
        } catch (error) {
          // A picture that does not decode: count it, keep going.
          onSettled(url, { error });
          if (error instanceof Error && error.name === "QuotaExceededError")
            throw error;
        }
      },
      onFailed: (id, error) => onSettled(shared.get(id)!.url, { error }),
    });
    // Both end before the job does, so a late image never counts in the
    // next run.
    const [result] = await Promise.allSettled([batches, elsewhere]);
    if (result.status === "rejected") throw result.reason;
  }

  async acquire(url: string, altText: string): Promise<string> {
    this.checkEnabled();
    let entry = this.memory.get(url);
    if (!entry) {
      const { blob } = await this.ensureImage(url, altText);
      this.checkEnabled();
      entry = this.memory.get(url);
      if (!entry) {
        entry = { objectURL: URL.createObjectURL(blob), referenceCount: 0 };
        this.memory.set(url, entry);
      }
    }
    entry.referenceCount++;
    return entry.objectURL;
  }

  release(url: string) {
    const entry = this.memory.get(url);
    if (!entry) return;
    if (--entry.referenceCount <= 0) {
      URL.revokeObjectURL(entry.objectURL);
      this.memory.delete(url);
    }
  }

  clear(): Promise<void> {
    if (this.clearing) return this.clearing;
    this.enabled = false;
    for (const entry of this.memory.values())
      URL.revokeObjectURL(entry.objectURL);
    this.memory.clear();
    this.downloads.clear();
    this.clearing = (async () => {
      await Promise.allSettled([...this.writes]);
      try {
        await this.database.delete();
      } catch (error) {
        this.clearing = undefined;
        throw error;
      }
    })();
    return this.clearing;
  }
}

const cache = new ImageCacheStore();
export const ImageMemoryDB = cache.memory;
export const getCachedImage = (url: string, altText: string) =>
  cache.acquire(url, altText);
export const downloadImageLocally = (url: string, altText: string) =>
  cache.download(url, altText);
export const downloadImagesLocally: ImageCacheStore["downloadMany"] = (
  links,
  options,
) => cache.downloadMany(links, options);
export const revokeImage = (url: string) => cache.release(url);

// This is a terminal operation. Reload after sign-out to start a new cache.
export const clearImageCache = (): Promise<void> => cache.clear();

export async function listUsableCachedImages(
  database = imagePersistedDb,
): Promise<CachedImage[]> {
  const images = (await database.images.toArray()).filter(isCachedImage);
  const blobs = await database.imageBlobs.bulkGet(
    images.map((image) => image.url),
  );
  return images.filter(
    (_image, index) =>
      blobs[index]?.content instanceof Blob && blobs[index]!.content.size > 0,
  );
}
