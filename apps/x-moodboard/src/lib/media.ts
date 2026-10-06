import type { ImageAsset, LibraryItem, Media, VideoMedia } from "../../shared/schema";

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export function originalUrl(image: ImageAsset): string {
  return image.derivedFrame ? `/derived/${image.path}` : `/media/${encodePath(image.path)}?v=${image.rev}`;
}

export function thumbUrl(image: ImageAsset, width: number): string {
  return `/derived/${image.rev}-${width}.webp`;
}

/** srcset across the derived widths and the original. */
export function srcSet(image: ImageAsset): string {
  const parts = image.thumbs.map((w) => `${thumbUrl(image, w)} ${w}w`);
  if (image.w) parts.push(`${originalUrl(image)} ${image.w}w`);
  return parts.join(", ");
}

/** Smallest source that covers the requested CSS width at this device's density. */
export function bestSrc(image: ImageAsset, cssWidth: number): string {
  const need = cssWidth * Math.min(window.devicePixelRatio || 1, 2);
  const thumb = image.thumbs.find((w) => w >= need);
  return thumb ? thumbUrl(image, thumb) : originalUrl(image);
}

export function videoUrl(media: VideoMedia): string | null {
  return media.video ? `/media/${encodePath(media.video.path)}?v=${media.video.rev}` : null;
}

export function captionUrl(path: string, rev: string) {
  return `/media/${encodePath(path)}?v=${rev}`;
}

/** The image that shows a media item: a photo, or a video's poster/frame. */
export function mediaImage(media: Media): ImageAsset | null {
  if (media.kind === "photo") return media.image;
  if (media.kind === "video") return media.poster;
  return null;
}

export function mediaAspect(media: Media): number {
  const image = mediaImage(media);
  if (image?.w && image.h) return image.w / image.h;
  if (media.kind === "video" && media.video?.w && media.video.h) return media.video.w / media.video.h;
  return 16 / 9;
}

export interface Cover {
  media: Media;
  index: number;
  image: ImageAsset | null;
  aspect: number;
}

const coverCache = new WeakMap<LibraryItem, Cover | null>();

/** Card cover: the first post media, else quoted media, else a link preview. */
export function coverOf(item: LibraryItem): Cover | null {
  if (coverCache.has(item)) return coverCache.get(item)!;
  let cover: Cover | null = null;
  const index = item.media.findIndex((m) => m.kind !== "missing");
  if (index >= 0) {
    const media = item.media[index];
    cover = { media, index, image: mediaImage(media), aspect: mediaAspect(media) };
  }
  coverCache.set(item, cover);
  return cover;
}

/** Media shown in the detail stage. Missing media keeps its place as an honest gap. */
export function visualMedia(item: LibraryItem): Media[] {
  return item.media;
}

const preloaded = new Set<string>();
/** Warm the browser cache for one image; bounded by the caller. */
export function preloadImage(src: string) {
  if (preloaded.has(src)) return;
  preloaded.add(src);
  if (preloaded.size > 64) preloaded.delete(preloaded.values().next().value!);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}
