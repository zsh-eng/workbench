import { generatedByPath } from "./generated";
import type { ReviewGuide } from "./review-guide";

// How a guide's paths name changed files, for the Guide tab and for the CLI's
// check after `med review create --guide`. The check follows pulls.review's
// coverage rule (every changed file in exactly one group; see
// upstream/PULLS-REVIEW.md), as advice: Med shows unplaced files in a last
// "Other changes" segment instead of refusing the guide.

const escape = (text: string) => text.replace(/[.+^${}()|[\]\\]/g, "\\$&");

/** A glob with *, **, and ? as a regular expression for whole paths. */
function globPattern(glob: string): RegExp {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      source += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += escape(char);
  }
  // A pattern can start inside the repository, as paths in briefs can.
  return new RegExp(`^(?:.*/)?${source}$`);
}

/** A repository-relative path, from a path that may be absolute in `root`. */
function clean(pattern: string, root?: string) {
  let path = pattern
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.{1,2}\/)+/, "")
    .replace(/\/{2,}/g, "/");
  const base = root?.replace(/\/$/, "");
  if (base && path.startsWith(`${base}/`)) path = path.slice(base.length + 1);
  return path.replace(/^\//, "");
}

/** Whether a pattern names one file rather than a folder or a glob. */
export const namesOneFile = (pattern: string) => !/[*?]/.test(pattern) && !pattern.endsWith("/");

/**
 * The changed files that a path, a folder (ending in "/"), or a glob names, in
 * the files' order. `names` gives a file's path and its path before a rename.
 * One path matches exactly, else by a unique suffix in either direction, else
 * as a folder written without its slash.
 */
export function matchGuidePaths<T>(
  pattern: string,
  files: readonly T[],
  names: (file: T) => readonly string[],
  root?: string,
): T[] {
  const path = clean(pattern, root);
  if (!path) return [];
  if (/[*?]/.test(path)) {
    const expression = globPattern(path);
    return files.filter((file) => names(file).some((name) => expression.test(name)));
  }
  const folder = (prefix: string) =>
    files.filter((file) =>
      names(file).some((name) => name.startsWith(prefix) || name.includes(`/${prefix}`)),
    );
  if (path.endsWith("/")) return folder(path);
  const exact = files.filter((file) => names(file).includes(path));
  if (exact.length) return exact.slice(0, 1);
  const suffix = files.filter((file) =>
    names(file).some((name) => path.endsWith(`/${name}`) || name.endsWith(`/${path}`)),
  );
  if (suffix.length === 1) return suffix;
  return folder(`${path}/`);
}

/** A changed file of one comparison, for the check. */
export interface GuideCheckFile {
  path: string;
  previousPath?: string;
  /** The host's mark (docs/GENERATED.md): a mark, false, or absent for the path rule. */
  generated?: unknown;
}

/** What a guide leaves out or names twice; each list is empty when all is well. */
export interface GuideCheck {
  /** Changed files in no segment. */
  missing: string[];
  /** Changed files in more than one segment. */
  duplicated: string[];
  /** Segment paths that match no changed file, as `segments[i].files: path`. */
  unmatched: string[];
  /** Comments on a file that is not one changed file of their segment. */
  misplaced: string[];
  /** Segments of only lockfiles and generated files that come before other
   * segments, as `"Title" before "Title"`. */
  order: string[];
}

/**
 * Check a guide against the changed files of its comparisons. A file is
 * missing or duplicated within its own comparison; a path is unmatched only if
 * it matches nothing in every comparison.
 */
export function checkGuide(
  guide: ReviewGuide,
  comparisons: readonly { root?: string; files: readonly GuideCheckFile[] }[],
): GuideCheck {
  const names = (file: GuideCheckFile) =>
    file.previousPath ? [file.path, file.previousPath] : [file.path];
  const missing: string[] = [];
  const duplicated: string[] = [];
  const matched = new Set<string>();
  const placed = new Set<string>();
  /** For each segment: whether it has a file that a person wrote, and one that a tool wrote. */
  const kinds = guide.segments.map(() => ({ written: false, generated: false }));
  const generated = (file: GuideCheckFile) =>
    file.generated === undefined ? !!generatedByPath(file.path) : !!file.generated;
  for (const { root, files } of comparisons) {
    const count = new Map<GuideCheckFile, number>();
    guide.segments.forEach((segment, index) => {
      const own = new Set<GuideCheckFile>();
      for (const pattern of segment.files) {
        const found = matchGuidePaths(pattern, files, names, root);
        if (found.length) matched.add(`${index}\0${pattern}`);
        for (const file of found) own.add(file);
      }
      for (const file of own) {
        count.set(file, (count.get(file) ?? 0) + 1);
        kinds[index]![generated(file) ? "generated" : "written"] = true;
      }
      (segment.comments ?? []).forEach((comment, number) => {
        const file = namesOneFile(comment.file)
          ? matchGuidePaths(comment.file, files, names, root).at(0)
          : undefined;
        if (file && own.has(file)) placed.add(`${index}\0${number}`);
      });
    });
    for (const file of files) {
      const times = count.get(file) ?? 0;
      if (!times) missing.push(file.path);
      else if (times > 1) duplicated.push(file.path);
    }
  }
  const unmatched: string[] = [];
  const misplaced: string[] = [];
  guide.segments.forEach((segment, index) => {
    for (const pattern of segment.files)
      if (!matched.has(`${index}\0${pattern}`))
        unmatched.push(`segments[${index}].files: ${pattern}`);
    (segment.comments ?? []).forEach((comment, number) => {
      if (!placed.has(`${index}\0${number}`))
        misplaced.push(`segments[${index}].comments[${number}]: ${comment.file}`);
    });
  });
  // Lockfiles and generated files follow the change that made them.
  const order: string[] = [];
  const later = guide.segments.findLastIndex((_, index) => kinds[index]!.written);
  guide.segments.forEach((segment, index) => {
    if (index < later && kinds[index]!.generated && !kinds[index]!.written)
      order.push(`"${segment.title}" before "${guide.segments[later]!.title}"`);
  });
  return { missing, duplicated, unmatched, misplaced, order };
}

/** The check as advice for the agent that wrote the guide, or nothing when it passes. */
export function guideCheckText(check: GuideCheck, update: string): string | undefined {
  const list = (items: string[], limit = 12) =>
    items.length > limit
      ? `${items.slice(0, limit).join(", ")}, and ${items.length - limit} more`
      : items.join(", ");
  const lines = [
    check.missing.length &&
      `- In no segment (Med shows them under "Other changes"): ${list(check.missing)}`,
    check.duplicated.length && `- In more than one segment: ${list(check.duplicated)}`,
    check.unmatched.length && `- Match no changed file: ${list(check.unmatched)}`,
    check.misplaced.length &&
      `- Comments on a file that is not a changed file of their segment: ${list(check.misplaced)}`,
  ].filter((line): line is string => !!line);
  const coverage = lines.length > 0;
  if (check.order.length)
    lines.push(
      `- Put lockfiles and generated files in the last segments, after the code and tests: ${list(check.order)}`,
    );
  if (!lines.length) return undefined;
  return [
    coverage
      ? "Guide check: put every changed file in exactly one segment."
      : "Guide check: order the segments by review priority.",
    ...lines,
    `Fix the guide, then run: ${update}`,
  ].join("\n");
}
