/** Browser-decoded formats. Keep media bytes out of JSON and syntax workers. */
const formats: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  apng: "image/apng",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  ico: "image/x-icon",
  jfif: "image/jpeg",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};
export function mediaType(path: string) {
  const mime = formats[path.split(".").at(-1)?.toLowerCase() ?? ""];
  return mime
    ? { kind: mime.startsWith("image/") ? ("image" as const) : ("video" as const), mime }
    : undefined;
}
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
