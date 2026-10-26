/**
 * Saving a link from the web writes the three records that Arctic on iPhone
 * writes for a new article (ArticleSyncCodec.values), so the phone accepts
 * them: one invalid record stops the phone's whole pull. The web cannot fetch
 * another site, so the title comes from the address; the phone fetches the
 * page's title, image and tags when it next opens, because the article has
 * no image and no preview yet (`needsPreview`). The canonical URL, the id
 * and the records come from @workbench/arctic-links, which `wb arctic save`
 * and the shared API's check of its writes use too.
 */
import {
  articleId,
  canonicalURL,
  localID,
  newLinkRecords,
} from "@workbench/arctic-links";
import { edits, editLibrary, type Article } from "./articles";
import type { Session } from "./sync/session";
import { swiftNow } from "./sync/swift";

export { articleId, canonicalURL, localID };

/**
 * A readable stand-in title from the address, until the phone fetches the
 * page's own: the last path segment as words, or the site's name.
 */
function titleFromURL(canonical: string) {
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

type Saved =
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
  await session.arctic.write(
    newLinkRecords(url, id, { title: titleFromURL(url), savedAt: swiftNow() }),
  );
  session.syncSoon();
  return { kind: "saved", id };
}
