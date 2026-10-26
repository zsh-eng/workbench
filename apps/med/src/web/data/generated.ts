import { useEffect, useMemo, useState } from "react";
import {
  generatedByPath,
  generatedRoutes,
  type Provenance,
  generatedSource,
  isLockfile,
  lockfileEcosystem,
  manifestEcosystem,
  type GeneratedMark,
} from "../../shared/generated";
import type { EditSession, ReviewFile } from "../../shared/protocol";
import type { ParsedReviewFile } from "../../shared/review";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// The browser's side of generated files (docs/GENERATED.md): which files of a
// comparison a tool wrote, the file that each one follows from, and how the
// stream and the file list split them.

/** A file's mark: the host's, or the path rule's for a capture without one. */
export function generatedMark(info: Pick<ReviewFile, "path" | "generated">): GeneratedMark | null {
  return info.generated === false ? null : (info.generated ?? generatedByPath(info.path));
}

export interface GeneratedIndex {
  /** Each generated file's mark, by file ID. */
  marks: ReadonlyMap<string, GeneratedMark>;
  /** The file whose change made a generated file, by file ID, when the
   * comparison has it. */
  sources: ReadonlyMap<string, string>;
  /** A lockfile that changed with no manifest of its ecosystem. */
  lonelyLockfiles: ReadonlySet<string>;
}

const EMPTY: GeneratedIndex = { marks: new Map(), sources: new Map(), lonelyLockfiles: new Set() };
const indexes = new WeakMap<readonly ParsedReviewFile[], GeneratedIndex>();

/** The generated files of a comparison; the same list gives the same index. */
export function generatedIndex(files: readonly ParsedReviewFile[]): GeneratedIndex {
  if (!files.length) return EMPTY;
  const known = indexes.get(files);
  if (known) return known;
  const marks = new Map<string, GeneratedMark>();
  for (const file of files) {
    const mark = generatedMark(file.info);
    if (mark) marks.set(file.id, mark);
  }
  const sources = new Map<string, string>();
  const lonelyLockfiles = new Set<string>();
  if (marks.size) {
    const paths = new Set(files.map((file) => file.path));
    const ids = new Map(files.map((file) => [file.path, file.id]));
    const ecosystems = new Set(files.flatMap((file) => manifestEcosystem(file.path) ?? []));
    for (const file of files) {
      const mark = marks.get(file.id);
      if (!mark) continue;
      const source = generatedSource(file.path, mark, paths);
      if (source && source !== file.path) sources.set(file.id, ids.get(source)!);
      if (isLockfile(file.path)) {
        const ecosystem = lockfileEcosystem(file.path);
        if (ecosystem !== "other" && !ecosystems.has(ecosystem)) lonelyLockfiles.add(file.id);
      }
    }
  }
  const index = { marks, sources, lonelyLockfiles };
  indexes.set(files, index);
  return index;
}

/** A list's files that a tool did not write, and those that it did, in order. */
export function splitGenerated(
  files: readonly ParsedReviewFile[],
  index: GeneratedIndex,
): { primary: ParsedReviewFile[]; generated: ParsedReviewFile[] } {
  if (!index.marks.size) return { primary: files as ParsedReviewFile[], generated: [] };
  const primary: ParsedReviewFile[] = [];
  const generated: ParsedReviewFile[] = [];
  for (const file of files) (index.marks.has(file.id) ? generated : primary).push(file);
  return { primary, generated };
}

/** What the thread's agent sessions did to its generated files: hand edits,
 * and the commands that wrote them. Read once the diff shows, and again when
 * the comparison or the sessions change. */
export function useProvenance(
  fetcher: typeof fetch | undefined,
  repo: string | null,
  sessions: readonly EditSession[],
  files: readonly ParsedReviewFile[],
  index: GeneratedIndex,
): ReadonlyMap<string, Provenance> {
  const [result, setResult] = useState<{ key: string; files: ReadonlyMap<string, Provenance> }>();
  const generated = useMemo(
    () =>
      files.flatMap((file) => {
        const mark = index.marks.get(file.id);
        return mark
          ? [{ path: file.path, kind: mark.kind, ...(mark.source && { source: mark.source }) }]
          : [];
      }),
    [files, index],
  );
  const key = JSON.stringify([repo, sessions, generated]);
  useEffect(() => {
    if (!repo || !sessions.length || !generated.length) return;
    const abort = new AbortController();
    void createApi(fetcher ?? browserFetch, readBrowserToken())
      .call(
        generatedRoutes.provenance,
        {
          repo,
          sessions: sessions.slice(-8).map(({ agent, id }) => ({ agent, id })),
          files: generated.slice(0, 2000),
        },
        abort.signal,
      )
      .then((answer) => setResult({ key, files: new Map(Object.entries(answer.files)) }))
      .catch(() => {});
    return () => abort.abort();
    // The key names everything that the request sends.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetcher]);
  return result?.key === key ? result.files : NO_PROVENANCE;
}
const NO_PROVENANCE: ReadonlyMap<string, Provenance> = new Map();
