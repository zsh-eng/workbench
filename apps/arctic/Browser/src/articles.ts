import type { Fields, RecordStorage } from "./sync/storage";
import { fromSwift, swiftNow } from "./sync/swift";

/**
 * One saved or visited article, projected from the phone's records:
 * `article/<id>` (title, images), `library/<id>` (state), `tags/<id>`, and
 * this app's `content/<id>` (the text copy). `id` is the SHA-256 of the
 * canonical URL. This app writes `library` and `content` records, and all
 * three phone records for a link it saves (src/links.ts).
 */
export type Article = {
  id: string;
  url: string;
  host: string;
  title: string;
  subtitle: string;
  image?: string;
  favicon?: string;
  saved: boolean;
  archived: boolean;
  favourite: boolean;
  read: boolean;
  savedAt?: number;
  lastVisitedAt?: number;
  favouritedAt?: number;
  tags: string[];
  copy?: Copy;
};

export type Copy = {
  file: string;
  words: number;
  bytes: number;
  byline?: string;
  source: string;
  savedAt: number;
};

export type Folder = "saved" | "favourites" | "archive" | "history";

export const folders: {
  id: Folder;
  title: string;
  path: string;
  empty: string;
}[] = [
  { id: "saved", title: "Saved", path: "/", empty: "Your next good read." },
  {
    id: "favourites",
    title: "Favourites",
    path: "/favourites",
    empty: "Worth keeping close.",
  },
  {
    id: "archive",
    title: "Archive",
    path: "/archive",
    empty: "A place for finished stories.",
  },
  {
    id: "history",
    title: "History",
    path: "/history",
    empty: "Every read leaves a trail.",
  },
];

const https = (value: unknown) =>
  typeof value === "string" && /^https?:\/\//i.test(value) ? value : undefined;

/** A record's value, or nothing when it is missing or removed. */
function raw(storage: RecordStorage, key: string) {
  const view = storage.view(key);
  return view && !view.isDeleted ? view.value : undefined;
}

function parse(value: string | undefined): Fields | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

type Values = [
  article?: string,
  library?: string,
  tags?: string,
  copy?: string,
];

/**
 * Projects the records into articles. An article whose four records did not
 * change keeps its object, so a sync does not render its card again.
 */
export function projector() {
  let previous = new Map<
    string,
    { values: Values; article: Article | undefined }
  >();
  return (arctic: RecordStorage, content: RecordStorage): Article[] => {
    const next = new Map<
      string,
      { values: Values; article: Article | undefined }
    >();
    const articles: Article[] = [];
    for (const key of arctic.keys()) {
      if (!key.startsWith("article/")) continue;
      const id = key.slice("article/".length);
      const values: Values = [
        raw(arctic, key),
        raw(arctic, `library/${id}`),
        raw(arctic, `tags/${id}`),
        raw(content, `content/${id}`),
      ];
      const known = previous.get(id);
      const article =
        known && known.values.every((value, index) => value === values[index])
          ? known.article
          : toArticle(id, values);
      next.set(id, { values, article });
      if (article) articles.push(article);
    }
    previous = next;
    return articles;
  };
}

function toArticle(id: string, values: Values): Article | undefined {
  const metadata = parse(values[0]);
  const library = parse(values[1]);
  if (!metadata || !library || typeof metadata.url !== "string") return;
  let host = "";
  try {
    host = new URL(metadata.url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }
  const tags = parse(values[2]);
  const copy = parse(values[3]);
  return {
    id,
    url: metadata.url,
    host,
    title: displayTitle(String(metadata.title || host), host),
    // A description without words, such as Substack's "...", is none.
    subtitle:
      typeof metadata.subtitle === "string" &&
      /\p{L}{3}/u.test(metadata.subtitle)
        ? metadata.subtitle
        : "",
    image: https(metadata.imageURL),
    favicon: https(metadata.faviconURL),
    saved: library.saved === true,
    archived: library.archived === true,
    favourite: library.favourite === true,
    read: library.read === true,
    savedAt: fromSwift(library.savedAt),
    lastVisitedAt: fromSwift(library.lastVisitedAt),
    favouritedAt: fromSwift(library.favouritedAt),
    tags: Array.isArray(tags?.names)
      ? tags.names.filter((name) => typeof name === "string")
      : [],
    copy:
      copy &&
      typeof copy.file === "string" &&
      /^xxh64:[0-9a-f]{16}$/.test(copy.file)
        ? {
            file: copy.file,
            words: Number(copy.words) || 0,
            bytes: Number(copy.bytes) || 0,
            byline: typeof copy.byline === "string" ? copy.byline : undefined,
            source: String(copy.source ?? ""),
            savedAt: Number(copy.savedAt) || 0,
          }
        : undefined,
  };
}

export function inFolder(article: Article, folder: Folder) {
  switch (folder) {
    case "saved":
      return article.saved && !article.archived;
    case "favourites":
      return article.saved && article.favourite;
    case "archive":
      return article.saved && article.archived;
    case "history":
      return article.lastVisitedAt !== undefined;
  }
}

export function sortFolder(articles: Article[], folder: Folder) {
  const time = (article: Article) =>
    folder === "history"
      ? (article.lastVisitedAt ?? 0)
      : folder === "favourites"
        ? (article.favouritedAt ?? article.savedAt ?? 0)
        : (article.savedAt ?? article.lastVisitedAt ?? 0);
  return articles.sort(
    (a, b) => time(b) - time(a) || a.url.localeCompare(b.url),
  );
}

export function matches(article: Article, query: string) {
  const text =
    `${article.title} ${article.subtitle} ${article.host} ${article.tags.join(" ")}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((term) => text.includes(term));
}

export const minutes = (words: number) => Math.max(1, Math.round(words / 230));

/** The phone's library rule: an unsaved article is neither archived nor favourite. */
export function normalizeLibrary(fields: Fields): Fields {
  if (fields.saved !== false) return fields;
  const next: Fields = { ...fields, archived: false };
  if (next.favourite === true) next.favourite = false;
  delete next.savedAt;
  return next;
}

export const edits = {
  archive: (archived: boolean) => ({ archived }),
  favourite: (favourite: boolean) => ({
    favourite,
    favouritedAt: favourite ? swiftNow() : null,
  }),
  visit: () => ({ read: true, lastVisitedAt: swiftNow() }),
  save: () => ({ saved: true, savedAt: swiftNow() }),
};

export function editLibrary(
  arctic: RecordStorage,
  article: Article,
  fields: Fields,
) {
  return arctic.edit(`library/${article.id}`, fields);
}

/** Removal writes tombstones for every family, as the phone's Remove link does. */
export async function removeArticle(
  arctic: RecordStorage,
  content: RecordStorage,
  article: Article,
) {
  const removed = (storage: RecordStorage, keys: string[]) =>
    keys.flatMap((key) => {
      const view = storage.view(key);
      return view && !view.isDeleted ? [{ key, value: view.value }] : [];
    });
  const records = removed(
    arctic,
    ["article", "library", "tags"].map((family) => `${family}/${article.id}`),
  );
  const copies = removed(content, [`content/${article.id}`]);
  await arctic.write(records.map((record) => ({ ...record, isDeleted: true })));
  await content.write(copies.map((record) => ({ ...record, isDeleted: true })));
  return async function undo() {
    await arctic.write(records);
    await content.write(copies);
  };
}

/**
 * The source appears beside every title, so a matching publisher suffix is
 * display noise. Mirrors `ArticleTitle.display` in the phone app.
 */
function displayTitle(title: string, host: string) {
  const site = siteKey(host);
  if (site.length < 3) return title;
  for (const separator of [" | ", " – ", " — ", " · ", " - ", " :: "]) {
    const index = title.lastIndexOf(separator);
    if (index < 0) continue;
    let key = title
      .slice(index + separator.length)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
    if (key.startsWith("the") && !site.startsWith("the")) key = key.slice(3);
    const head = title.slice(0, index).trim();
    if (key.length < 3 || key.length > 40 || head.length < 3) continue;
    if (site.startsWith(key) || key.startsWith(site)) return head;
  }
  return title;
}

function siteKey(host: string) {
  const labels = host.toLowerCase().split(".");
  if (labels.length < 2) return labels[0] ?? "";
  const second = labels[labels.length - 2]!;
  if (labels.length >= 3 && second.length <= 3)
    return labels[labels.length - 3]!;
  return second;
}
