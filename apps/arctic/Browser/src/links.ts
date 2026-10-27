/**
 * Saving a link from the web writes the three records that Arctic on iPhone
 * writes for a new article (ArticleSyncCodec.values), so the phone accepts
 * them: one invalid record stops the phone's whole pull. The web cannot fetch
 * another site, so the link is saved at once with a title from its address,
 * and its preview follows from the shared API (`fillPreview`): the page's
 * title, description, image and icon, read by the phone's rules. The phone
 * still fetches its own preview and tags when it next opens. The canonical
 * URL, the id, the records and the preview's rules come from
 * @workbench/arctic-links, which `wb arctic save` and the shared API's check
 * of its writes use too.
 */
import {
  articleId,
  canonicalURL,
  cleanPreview,
  localID,
  newLinkRecords,
  previewPatch,
  type LinkPreview,
} from "@workbench/arctic-links";
import { useSyncExternalStore } from "react";
import { API_ORIGIN } from "./api";
import { edits, editLibrary, type Article } from "./articles";
import { listMotion } from "./motion";
import type { Fields } from "./sync/storage";
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

/**
 * Links whose preview this tab is fetching. Their cards keep a picture's
 * place until it arrives, as the phone's cards do while metadata is pending
 * (`ArticleCard` in apps/arctic/Sources/LibraryCards.swift), so an arriving
 * picture does not push the cards below.
 */
let reserved: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
function reserve(id: string, on: boolean) {
  if (reserved.has(id) === on) return;
  const next = new Set(reserved);
  if (on) next.add(id);
  else next.delete(id);
  reserved = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useReservedPictures = () =>
  useSyncExternalStore(subscribe, () => reserved);

/** The page's preview from the shared API, or nothing when it has none to give. */
async function fetchPreview(url: string): Promise<LinkPreview | undefined> {
  try {
    const response = await fetch(`${API_ORIGIN}/api/arctic/preview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? cleanPreview(await response.json()) : undefined;
  } catch {
    return undefined;
  }
}

/** Waits, at most `ms`, for an image to load and decode, so its card shows it whole. */
function decoded(src: string, ms: number) {
  const image = new Image();
  image.referrerPolicy = "no-referrer";
  image.src = src;
  return Promise.race([
    image.decode().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/** The fields to set from a page's preview: only where the record has none. */
function previewEdit(session: Session, id: string, url: string, preview: LinkPreview) {
  const view = session.arctic.view(`article/${id}`);
  if (!view || view.isDeleted) return undefined;
  const article = JSON.parse(view.value) as Fields;
  const patch: Fields = { ...previewPatch(article, preview) };
  // The title from the address gives way to the page's own.
  if (
    preview.title &&
    preview.title !== article.title &&
    article.title === titleFromURL(url)
  )
    patch.title = preview.title;
  return Object.keys(patch).length ? patch : undefined;
}

/**
 * Saves a link to the top of Saved (`saveLink`), then fills its preview
 * from its page through the shared API: the description, image and icon
 * where the record has none, and the page's title in place of the one from
 * the address. A field that the phone, or anyone, set stays. While the page
 * loads, a link without a picture keeps a picture's place; then the card
 * changes once, with its picture decoded, and the list moves to fit it.
 * Without an answer only the reserved place goes; the phone fills the
 * preview when it next opens.
 */
export async function saveWithPreview(
  session: Session,
  input: string,
  known: Article[],
): Promise<Saved> {
  const url = canonicalURL(input);
  if (!url) return { kind: "invalid" };
  const id = await articleId(url);
  const existing = known.find((article) => article.id === id);
  // A new link, or one from History: not one already saved.
  const wanted = !existing?.saved;
  // From the first render of its card, so nothing moves when it arrives.
  if (wanted && !existing?.image) reserve(id, true);
  const result = await listMotion(() => saveLink(session, input, known));
  if (result.kind !== "saved" || !wanted) {
    reserve(id, false);
    return result;
  }
  void (async () => {
    let edit: Fields | undefined;
    try {
      const preview = await fetchPreview(url);
      if (preview?.imageURL) await decoded(preview.imageURL, 4000);
      edit = preview && previewEdit(session, id, url, preview);
    } finally {
      // Undo may have removed the link while the page loaded.
      await listMotion(async () => {
        if (edit) await session.arctic.edit(`article/${id}`, edit).catch(() => {});
        reserve(id, false);
      }).catch(() => reserve(id, false));
    }
    if (edit) session.syncSoon();
  })();
  return result;
}
