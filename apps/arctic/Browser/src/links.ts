import { edits, editLibrary, type Article } from "./articles";
import type { Session } from "./sync/session";
import { encodeSorted, swiftNow } from "./sync/swift";

/**
 * Saving a link from the web writes the three records that Arctic on iPhone
 * writes for a new article (ArticleSyncCodec.values), so the phone accepts
 * them: one invalid record stops the phone's whole pull. The web cannot fetch
 * another site, so the title comes from the address; the phone fetches the
 * page's title, image and tags when it next opens, because the article has
 * no image and no preview yet (`needsPreview`).
 */

/** Characters that RFC 3986 allows in a URL; Swift's URL escapes the rest. */
const ALLOWED = /[A-Za-z0-9\-._~:/?@!$&'()*+,;=%]/;

/**
 * The phone's canonical URL (ArticleSyncCodec.canonicalURL), from what a
 * person pastes: http or https, a lowercase host, no default port, no
 * fragment, and "/" for an empty path. The query stays, because it can name
 * a different document. The browser's URL parser normalizes first; then
 * every character that Swift's parser would escape is escaped here, so both
 * apps hash the same string. Null when it is not a public web address.
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

/**
 * A readable stand-in title from the address, until the phone fetches the
 * page's own: the last path segment as words, or the site's name.
 */
export function titleFromURL(canonical: string) {
  const url = new URL(canonical);
  const host = url.hostname.replace(/^www\./, "");
  const segment = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .reverse()
    // A slug, such as "how-sea-ice-keeps-time", not an id or a bare "watch".
    .find(
      (part) =>
        /\p{L}{3}/u.test(part) &&
        !/^[0-9a-f-]{12,}$/i.test(part) &&
        (/[-_+ ]/.test(part) || part.length >= 10),
    );
  if (!segment) return host;
  const words = segment
    .replace(/\.(html?|php|aspx?)$/i, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : host;
}

/** The phone's three records for a new saved article; `savedAt` is in Swift seconds. */
function linkRecords(url: string, id: string, savedAt: number) {
  return [
    {
      key: `article/${id}`,
      value: encodeSorted({ subtitle: "", title: titleFromURL(url), url }),
    },
    {
      key: `library/${id}`,
      value: encodeSorted({
        archived: false,
        read: false,
        saved: true,
        savedAt,
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

export type Saved =
  | { kind: "saved"; id: string }
  | { kind: "already"; id: string }
  | { kind: "invalid" };

/**
 * Saves a link to the top of Saved. A link already in the library is saved
 * again if it was only in History; one already saved is left as it is.
 */
export async function saveLink(
  session: Session,
  input: string,
  known: Article[],
): Promise<Saved> {
  const url = canonicalURL(input);
  if (!url) return { kind: "invalid" };
  const id = await articleId(url);
  const existing = known.find((article) => article.id === id);
  if (existing?.saved) return { kind: "already", id };
  if (existing) {
    await editLibrary(session.arctic, existing, edits.save());
    session.syncSoon();
    return { kind: "saved", id };
  }
  await session.arctic.write(linkRecords(url, id, swiftNow()));
  session.syncSoon();
  return { kind: "saved", id };
}
