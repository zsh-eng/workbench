import type { ParsedReviewFile } from "../../shared/review";
import { parseBriefHref, type FileTarget } from "./file-refs";

export { parseBriefHref };

function normalize(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/^(?:\.{1,2}\/)+/, "")
    .replace(/\/{2,}/g, "/");
}

/** Match a reference to one changed file: exactly, then by a unique path suffix
 * in either direction. Agents write paths relative to different folders. */
export function matchReviewFile(
  target: FileTarget,
  files: ParsedReviewFile[],
  root?: string,
): ParsedReviewFile | undefined {
  let path = normalize(target.path);
  if (root && path.startsWith(`${root.replace(/\/$/, "")}/`))
    path = path.slice(root.replace(/\/$/, "").length + 1);
  path = path.replace(/^\//, "");
  if (!path) return;
  const names = (file: ParsedReviewFile) =>
    file.info.previousPath ? [file.path, file.info.previousPath] : [file.path];
  const exact = files.filter((file) => names(file).includes(path));
  if (exact.length) return exact[0];
  const suffix = files.filter((file) =>
    names(file).some((name) => path.endsWith(`/${name}`) || name.endsWith(`/${path}`)),
  );
  return suffix.length === 1 ? suffix[0] : undefined;
}
