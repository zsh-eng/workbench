/**
 * Arctic's records for a saved link, as Arctic on iPhone writes them
 * (`ArticleSyncCodec` in apps/arctic/Sources/ArticleSyncRepository.swift):
 * `article/<id>`, `library/<id>` and `tags/<id>` in the `arctic` namespace,
 * where `<id>` is the SHA-256 of the canonical URL. Arctic for the web,
 * `wb arctic save` and the shared API's check of that command's writes use
 * this one copy. The phone validates every record and stops a pull at one
 * it cannot read, so these values must stay byte for byte the phone's.
 */

const SWIFT_EPOCH_MS = 978_307_200_000;

/** A time in Swift reference seconds (since 1 January 2001), as the phone encodes dates. */
export const toSwift = (ms: number) => (ms - SWIFT_EPOCH_MS) / 1000;

/** JSON with sorted keys, as the phone's JSONEncoder (`.sortedKeys`) writes records. */
export function encodeSorted(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

/** Characters that RFC 3986 allows in a URL; Swift's URL escapes the rest. */
const ALLOWED = /[A-Za-z0-9\-._~:/?@!$&'()*+,;=%]/;

/**
 * The phone's canonical URL (ArticleSyncCodec.canonicalURL), from what a
 * person pastes: http or https, a lowercase host, no default port, no
 * fragment, and "/" for an empty path. The query stays, because it can name
 * a different document. The WHATWG URL parser normalizes first; then every
 * character that Swift's parser would escape is escaped here, so both apps
 * hash the same string. Null when it is not a public web address.
 */
export function canonicalURL(input: string): string | null {
  let text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  // A public site: a dotted name that is not an address literal.
  const host = url.hostname;
  if (
    !host.includes(".") ||
    host.endsWith(".") ||
    host.startsWith("[") ||
    /^[\d.]+$/.test(host)
  )
    return null;
  url.hash = "";
  const origin = `${url.protocol}//${url.host}`;
  const rest = url.href.slice(origin.length).replace(/#$/, "");
  let escaped = "";
  for (const character of rest) {
    if (character === "%") escaped += character;
    else if (ALLOWED.test(character)) escaped += character;
    else
      for (const byte of new TextEncoder().encode(character))
        escaped += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  // A "%" that does not start an escape is itself escaped.
  escaped = escaped.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  return origin + (escaped || "/");
}

/** The article's record id: SHA-256 of the canonical URL, in lowercase hex. */
export async function articleId(canonical: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The phone's ArticleSyncCodec.localID: a UUID from the id's first 32
 * digits. The phone also names its offline copies by it.
 */
export function localID(id: string) {
  const hex = id.toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export type LinkRecord = { key: string; value: string };

/**
 * The phone's three records for a new saved link (ArticleSyncCodec.values):
 * no description, image or tags yet, so the phone fetches them when it next
 * opens. `savedAt` is in Swift seconds.
 */
export function newLinkRecords(
  url: string,
  id: string,
  fields: { title: string; savedAt: number },
): LinkRecord[] {
  return [
    {
      key: `article/${id}`,
      value: encodeSorted({ subtitle: "", title: fields.title, url }),
    },
    {
      key: `library/${id}`,
      value: encodeSorted({
        archived: false,
        read: false,
        saved: true,
        savedAt: fields.savedAt,
        url,
      }),
    },
    {
      key: `tags/${id}`,
      value: encodeSorted({
        automatic: [],
        generation: localID(id),
        manual: [],
        names: [],
        rejected: [],
        url,
      }),
    },
  ];
}

/**
 * A known link saved again, as the phone's `ArticleStore.add` does it: a
 * field edit of the current library record that sets saved, not archived,
 * and a new saved date. Every other field keeps its value.
 */
export function savedLibrary(current: string, savedAt: number) {
  return encodeSorted({
    ...JSON.parse(current),
    archived: false,
    saved: true,
    savedAt,
  });
}

/** Longer than any title the extractor keeps. */
export const MAX_TITLE_LENGTH = 1000;
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

/**
 * Why a push to `arctic` does more than save links, or undefined when it
 * only saves them. The Workbench Backup credential may write these two
 * shapes and nothing else:
 *
 * - **New link**: the three records of `newLinkRecords`, byte for byte, for
 *   a canonical URL whose SHA-256 is the key's id, when the article is not
 *   in the library (its `article/` or `library/` record is missing or
 *   removed). The title is a well-formed string of at most 1,000 characters.
 * - **Restore**: only the `library/` record of an article in the library
 *   that is not saved, equal to `savedLibrary` of the current value.
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
        return `library/${id}: a restore changes only saved, archived and savedAt`;
    } else
      return `${id}: a new link writes its article, library and tags records; a restore writes its library record`;
  }
  return undefined;
}
