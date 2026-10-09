import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { NoteState, ReviewFile, ReviewResponse } from "./protocol";
import { projectReviewDocument } from "./hunk/document";
import { normalizeDiffMetadataPaths } from "./hunk/diffPaths";
import { reviewFileKey } from "./hunk/identity";
import { reviewRangeAnchor } from "./hunk/anchors";
import type { DiffFile } from "./hunk/model";
import type { ReviewDocumentV1 } from "./hunk/types";
import type { ReviewState, ReviewStoredNote } from "./hunk/state";

export { createReviewStore } from "./hunk/store";
export { applyReviewIntent, planReviewIntent } from "./hunk/intents";
export { reduceReviewState } from "./hunk/reducer";
export { createInitialReviewState } from "./hunk/state";
export * from "./hunk/selectors";
export * from "./hunk/geometry";
export * from "./hunk/expansion";
export * from "./hunk/noteValidation";
export type * from "./hunk/types";
export type * from "./hunk/state";
export type * from "./hunk/intents";

export interface ParsedReviewFile {
  id: string;
  path: string;
  info: ReviewFile;
  metadata: FileDiffMetadata | null;
}

/** Small-patch fallback. Large reviews supply the same parser through a worker. */
export function parseReviewPatch(patch: string): FileDiffMetadata[] {
  return parsePatchFiles(patch, undefined, true).flatMap((entry) => entry.files);
}

/** Metadata without hunks, for a file whose changes are not shown. */
export function emptyMetadata(info: ReviewFile): FileDiffMetadata {
  return {
    name: info.path,
    prevName: info.previousPath,
    type:
      info.status === "A" || info.untracked
        ? "new"
        : info.status === "D"
          ? "deleted"
          : info.status.startsWith("R")
            ? "rename-pure"
            : "change",
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    additionLines: [],
    deletionLines: [],
    isPartial: true,
  };
}

/** Keep server order and represent excluded files, even if the parser has no entry. */
export function projectResponse(
  response: ReviewResponse,
  parsed: readonly FileDiffMetadata[],
): { files: ParsedReviewFile[]; document: ReviewDocumentV1 } {
  const byPath = new Map<string, FileDiffMetadata[]>();
  for (const item of parsed) {
    const metadata = normalizeDiffMetadataPaths(item);
    const items = byPath.get(metadata.name) ?? [];
    items.push(metadata);
    byPath.set(metadata.name, items);
  }
  const occurrences = new Map<string, number>();
  const files = response.files.map((info): ParsedReviewFile => {
    const duplicateIndex = occurrences.get(info.path) ?? 0;
    occurrences.set(info.path, duplicateIndex + 1);
    const id = reviewFileKey({
      sourceLabel: response.repo,
      path: info.path,
      previousPath: info.previousPath,
      duplicateIndex,
    });
    const item = byPath.get(info.path)?.shift();
    const metadata =
      info.binary || info.tooLarge || !item ? null : { ...item, cacheKey: `${response.id}:${id}` };
    return { id, path: info.path, info, metadata };
  });
  const inputs: DiffFile[] = files.map(({ id, path, info, metadata }) => ({
    id,
    path,
    previousPath: info.previousPath,
    // Per-file metadata supplies the complete identity; do not repeat the whole patch in each file.
    patch: "",
    stats: { additions: info.additions, deletions: info.deletions },
    metadata: metadata ?? emptyMetadata(info),
    agent: null,
    isUntracked: info.untracked,
    isBinary: info.binary,
    isTooLarge: info.tooLarge,
    ...(response.comparison.kind === "patch"
      ? {}
      : { sourceFetcher: { cacheKey: `${response.id}:${id}` } }),
  }));
  return { files, document: projectReviewDocument(inputs, { sourceLabel: response.repo }) };
}

/** Adopt server-owned notes. A local edit is not persisted until the server returns it. */
export function projectAuthoritativeNotes(state: ReviewState, notes: NoteState): ReviewState {
  const byPath = new Map(state.document.files.map((file) => [file.path, file]));
  const userNotes: ReviewStoredNote[] = notes.notes.flatMap((note) => {
    const file = byPath.get(note.path);
    const range = [note.line, note.endLine ?? note.line] as const;
    const preferred = { side: note.side, line: note.line };
    return [
      {
        note: {
          id: note.id,
          parentId: note.parentId,
          source: "user" as const,
          fileKey: file?.key ?? `orphan:${note.id}`,
          anchor: reviewRangeAnchor(file?.hunks ?? [], {
            hunkIndex: 0,
            preferred,
            ...(note.side === "old" ? { oldRange: range } : { newRange: range }),
          }),
          summary: note.text,
          editable: true,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
        resolution: file ? (note.resolution ?? "active") : "orphaned",
      },
    ];
  });
  return { ...state, userNotes, stateRevision: state.stateRevision + 1 };
}
