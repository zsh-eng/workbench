/**
 * Arctic's records for a saved link, as Arctic on iPhone writes them
 * (`links.ts`), a link's preview read from its page (`preview.ts`), and the
 * shared API's check of what the Workbench Backup credential pushes.
 */
import {
  articleId,
  canonicalURL,
  MAX_TITLE_LENGTH,
  newLinkRecords,
  savedLibrary,
  toSwift,
} from "./links";
import {
  PREVIEW_FIELDS,
  previewFieldProblem,
  withPreview,
  type LinkPreview,
} from "./preview";

export * from "./links";
export * from "./preview";

const LINK_KEY = /^(article|library|tags)\/([0-9a-f]{64})$/;

type Change = {
  key: string;
  value: string;
  isDeleted: boolean;
  schemaVersion: number;
};
type Stored = { value: string; isDeleted: boolean };

function object(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A Swift date that the phone decodes: after 2001, and not more than a day ahead. */
const savedDate = (value: unknown, nowMs: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value > 0 &&
  value <= toSwift(nowMs) + 86_400;

const blank = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

/**
 * Why a push to `arctic` does more than save links and fill their previews,
 * or undefined when it does only that. The Workbench Backup credential may
 * write these three shapes and nothing else:
 *
 * - **New link**: the three records of `newLinkRecords`, byte for byte, for
 *   a canonical URL whose SHA-256 is the key's id, when the article is not
 *   in the library (its `article/` or `library/` record is missing or
 *   removed). The title is a well-formed string of at most 1,000 characters.
 * - **Restore**: only the `library/` record of an article in the library
 *   that is not saved, equal to `savedLibrary` of the current value.
 * - **Preview**: only the `article/` record of an article in the library,
 *   equal to `withPreview` of the current value: `imageURL`, `faviconURL`
 *   or `subtitle` set where the stored record has none (absent, null or
 *   blank), each in the form `readPreview` writes. A field the phone wrote
 *   is never replaced, and every other field keeps its stored value.
 *
 * `current` holds the stored records of every family for the ids in
 * `changes`. Removals, other families and other fields are refused.
 */
export async function linkChangesProblem(
  changes: readonly Change[],
  current: ReadonlyMap<string, Stored>,
  nowMs = Date.now(),
): Promise<string | undefined> {
  const links = new Map<string, Map<string, Change>>();
  for (const change of changes) {
    const match = LINK_KEY.exec(change.key);
    if (!match) return `${change.key} is not a link record`;
    if (change.isDeleted) return `${change.key}: removing is not allowed`;
    if (change.schemaVersion !== 1)
      return `${change.key}: the schema version must be 1`;
    const [, family, id] = match as unknown as [string, string, string];
    if (!links.has(id)) links.set(id, new Map());
    links.get(id)!.set(family, change);
  }
  for (const [id, families] of links) {
    const live = (family: string) => {
      const stored = current.get(`${family}/${id}`);
      return stored && !stored.isDeleted ? stored : undefined;
    };
    const library = live("library");
    const inLibrary = !!live("article") && !!library;
    const shape = [...families.keys()].sort().join(",");
    if (shape === "article,library,tags") {
      if (inLibrary) return `${id} is already in the library`;
      const article = object(families.get("article")!.value);
      const url = article?.url;
      if (
        typeof url !== "string" ||
        canonicalURL(url) !== url ||
        (await articleId(url)) !== id
      )
        return `article/${id}: the URL must be the canonical URL of this id`;
      const title = article!.title;
      if (
        typeof title !== "string" ||
        title.length > MAX_TITLE_LENGTH ||
        /\p{Surrogate}/u.test(title)
      )
        return `article/${id}: the title must be well-formed text of at most ${MAX_TITLE_LENGTH} characters`;
      const savedAt = object(families.get("library")!.value)?.savedAt;
      if (!savedDate(savedAt, nowMs))
        return `library/${id}: savedAt must be a Swift date`;
      for (const record of newLinkRecords(url, id, { title, savedAt }))
        if (families.get(record.key.split("/")[0]!)!.value !== record.value)
          return `${record.key} is not a new link in the phone's format`;
    } else if (shape === "library") {
      if (!inLibrary)
        return `library/${id}: this article is not in the library`;
      if (object(library!.value)?.saved !== false)
        return `library/${id} is already saved`;
      const value = families.get("library")!.value;
      const savedAt = object(value)?.savedAt;
      if (!savedDate(savedAt, nowMs))
        return `library/${id}: savedAt must be a Swift date`;
      if (value !== savedLibrary(library!.value, savedAt))
        return `library/${id}: a restore changes only saved, archived and savedAt of the stored record, which may have changed since it was read`;
    } else if (shape === "article") {
      if (!inLibrary)
        return `article/${id}: this article is not in the library`;
      const stored = live("article")!.value;
      const before = object(stored);
      const after = object(families.get("article")!.value);
      if (!before || !after)
        return `article/${id}: the record must be a JSON object`;
      // The fields this change fills: empty in the stored record, set here.
      const filled: LinkPreview = {};
      for (const field of PREVIEW_FIELDS) {
        if (!blank(before[field]) || blank(after[field])) continue;
        const problem = previewFieldProblem(field, after[field]);
        if (problem) return `article/${id}: ${problem}`;
        filled[field] = after[field] as string;
      }
      if (families.get("article")!.value !== withPreview(stored, filled))
        return `article/${id}: a preview sets only imageURL, faviconURL and subtitle where the stored record has none, and keeps every other field of the stored record, which may have changed since it was read`;
    } else
      return `${id}: a new link writes its article, library and tags records; a restore writes its library record; a preview writes its article record`;
  }
  return undefined;
}
