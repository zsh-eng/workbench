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
  // A public site: a dotted name that is not an address literal. The WHATWG
  // parser allows `"`, `` ` ``, `{` and `}` in a host, but Swift's URL
  // decoder refuses them, so a host keeps to letters, digits, `-`, `_`, `.`.
  const host = url.hostname;
  if (
    !/^[a-z0-9_.-]+$/.test(host) ||
    !host.includes(".") ||
    host.endsWith(".") ||
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
  // Swift's URLComponents reads a path whose escapes are not UTF-8, such as
  // Latin-1 "caf%E9", as empty, so the phone would refuse the record.
  try {
    decodeURIComponent(escaped.split("?")[0]!);
  } catch {
    return null;
  }
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

/** The longest title the shared API accepts for a new link, in UTF-16 units. */
export const MAX_TITLE_LENGTH = 1000;

/**
 * A page's title as a new link's title: one line of well-formed text, at
 * most 300 characters, so a cut never splits a character.
 */
export function linkTitle(text: string) {
  return [
    ...text
      .replace(/\p{Surrogate}/gu, "")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, 300)
    .join("")
    .trim();
}
