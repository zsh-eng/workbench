import { matchGuidePaths, namesOneFile } from "../../shared/guide-paths";
import type { ParsedReviewFile } from "../../shared/review";
import type { GuideArea, GuideCommentKind, SavedGuide } from "../../shared/review-guide";

/** An agent's comment on lines of a changed file, or on the whole file. */
export interface GuideNote {
  id: string;
  /** The segment that holds it, by key. */
  segment: string;
  fileId: string;
  path: string;
  side: "old" | "new";
  /** None for a comment on the whole file. */
  line?: number;
  endLine?: number;
  kind: GuideCommentKind;
  body: string;
}

export interface GuideSection {
  /** "s1", "s2", …, or "other" for files that no segment names. */
  key: string;
  /** 1-based order. */
  number: number;
  title: string;
  area?: GuideArea;
  /** The agent marked the whole segment for extra care. */
  critical?: boolean;
  summary?: string;
  /** Changed files in reading order. */
  fileIds: string[];
  /** Paths and patterns that match no changed file. */
  unmatched: string[];
  notes: GuideNote[];
  additions: number;
  deletions: number;
  /** Med made this segment; the agent did not write it. */
  automatic?: boolean;
}

export interface ResolvedGuide {
  summary?: string;
  sections: GuideSection[];
  /** Notes by changed file, in line order. */
  notesByFile: Map<string, GuideNote[]>;
  /** Comments on files that are not in this comparison. */
  unplaced: number;
}

/** What the Guide tab shows: the Overview, one segment, or one commit. */
export type GuideScope =
  | { kind: "overview" }
  | { kind: "segment"; key: string }
  | { kind: "commit"; id: string };

/** Area names as the Guide shows them. */
export const AREA_LABELS: Record<GuideArea, string> = {
  ui: "UI",
  api: "API",
  core: "Core",
  data: "Data",
  cli: "CLI",
  security: "Security",
  tests: "Tests",
  docs: "Docs",
  examples: "Examples",
  deps: "Dependencies",
  build: "Build",
  scripts: "Scripts",
  config: "Config",
  i18n: "i18n",
  assets: "Assets",
  other: "Other",
};

const fileNames = (file: ParsedReviewFile) =>
  file.info.previousPath ? [file.path, file.info.previousPath] : [file.path];

/** The changed files that a segment's path, folder, or glob names, in review order. */
export const matchFiles = (pattern: string, files: ParsedReviewFile[], root?: string) =>
  matchGuidePaths(pattern, files, fileNames, root);

/**
 * Place a guide on a comparison's files. Each segment takes the files that its
 * paths name, in the order written; files that no segment names form a last
 * "Other changes" segment, so the guide covers every change. A file can be in
 * more than one segment, though the CLI's check advises against it.
 */
export function resolveGuide(
  guide: SavedGuide,
  files: ParsedReviewFile[],
  root?: string,
): ResolvedGuide {
  const byId = new Map(files.map((file) => [file.id, file]));
  const placed = new Set<string>();
  const notesByFile = new Map<string, GuideNote[]>();
  let unplaced = 0;
  const sections: GuideSection[] = guide.segments.map((segment, index) => {
    const key = `s${index + 1}`;
    const fileIds: string[] = [];
    const unmatched: string[] = [];
    for (const pattern of segment.files) {
      const found = matchFiles(pattern, files, root);
      if (!found.length) unmatched.push(pattern);
      for (const file of found)
        if (!fileIds.includes(file.id)) {
          fileIds.push(file.id);
          placed.add(file.id);
        }
    }
    const notes: GuideNote[] = [];
    (segment.comments ?? []).forEach((comment, number) => {
      const file = namesOneFile(comment.file)
        ? matchFiles(comment.file, files, root).at(0)
        : undefined;
      if (!file) {
        unplaced++;
        return;
      }
      const note: GuideNote = {
        id: `${key}-${number + 1}`,
        segment: key,
        fileId: file.id,
        path: file.path,
        side: comment.side,
        ...(comment.line ? { line: comment.line } : {}),
        ...(comment.line && comment.endLine && comment.endLine > comment.line
          ? { endLine: comment.endLine }
          : {}),
        kind: comment.kind,
        body: comment.body,
      };
      notes.push(note);
      notesByFile.set(file.id, [...(notesByFile.get(file.id) ?? []), note]);
    });
    return {
      key,
      number: index + 1,
      title: segment.title,
      ...(segment.area ? { area: segment.area } : {}),
      ...(segment.critical ? { critical: true } : {}),
      ...(segment.summary ? { summary: segment.summary } : {}),
      fileIds,
      unmatched,
      notes,
      ...totals(fileIds, byId),
    };
  });
  const rest = files.filter((file) => !placed.has(file.id)).map((file) => file.id);
  if (rest.length)
    sections.push({
      key: "other",
      number: sections.length + 1,
      title: "Other changes",
      summary: "Changed files that the guide does not place in a segment.",
      fileIds: rest,
      unmatched: [],
      notes: [],
      automatic: true,
      ...totals(rest, byId),
    });
  for (const list of notesByFile.values())
    list.sort((a, b) =>
      a.side === b.side ? (a.line ?? 0) - (b.line ?? 0) : a.side === "old" ? -1 : 1,
    );
  return {
    ...(guide.summary ? { summary: guide.summary } : {}),
    sections,
    notesByFile,
    unplaced,
  };
}

function totals(fileIds: string[], byId: Map<string, ParsedReviewFile>) {
  let additions = 0;
  let deletions = 0;
  for (const id of fileIds) {
    const info = byId.get(id)?.info;
    additions += info?.additions ?? 0;
    deletions += info?.deletions ?? 0;
  }
  return { additions, deletions };
}

/** The first sentence of a Markdown summary, without its markup, for cards. */
export function firstSentence(markdown: string | undefined, max = 180): string {
  if (!markdown) return "";
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = /[.!?](?:\s|$)/.exec(text);
  const sentence = end ? text.slice(0, end.index + 1) : text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}
