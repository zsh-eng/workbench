import {
  FORMATS,
  STATES,
  TOPICS,
  type ContentState,
  type Format,
  type LibraryItem,
  type LibraryProjection,
  type Topic,
  type UserState,
} from "../../shared/schema";
import { fold, searchTerms } from "./text";

export const NO_TOPIC = "none";
export const NO_TOPIC_BIT = 1 << TOPICS.length;

export interface Library {
  version: string;
  adoptedAt: string;
  source: LibraryProjection["source"];
  taxonomy: LibraryProjection["taxonomy"];
  items: LibraryItem[];
  byPostId: Map<string, number>;
}

export function toLibrary(projection: LibraryProjection): Library {
  return {
    version: projection.version,
    adoptedAt: projection.adoptedAt,
    source: projection.source,
    taxonomy: projection.taxonomy,
    items: projection.items,
    byPostId: new Map(projection.items.map((item, i) => [item.postId, i])),
  };
}

export type Sort = "saved" | "newest" | "oldest";

/** Per-item arrays for fast filtering. Rebuilt only when the library or tag edits change. */
export interface Index {
  library: Library;
  topics: Uint16Array;
  subtags: string[][];
  effectiveTopics: Topic[][];
  effectiveSubtags: Partial<Record<Topic, string[]>>[];
  edited: Uint8Array;
  hay: string[];
  formats: Uint8Array;
  states: Uint8Array;
  orders: Record<Sort, Int32Array>;
}

const formatBit = (f: Format) => 1 << FORMATS.indexOf(f);
const stateBit = (s: ContentState) => 1 << STATES.indexOf(s);
const topicBit = (t: Topic) => 1 << TOPICS.indexOf(t);

export function buildIndex(library: Library, edits: UserState["edits"]): Index {
  const n = library.items.length;
  const index: Index = {
    library,
    topics: new Uint16Array(n),
    subtags: new Array(n),
    effectiveTopics: new Array(n),
    effectiveSubtags: new Array(n),
    edited: new Uint8Array(n),
    hay: new Array(n),
    formats: new Uint8Array(n),
    states: new Uint8Array(n),
    orders: { saved: new Int32Array(0), newest: new Int32Array(0), oldest: new Int32Array(0) },
  };
  library.items.forEach((item, i) => {
    const edit = edits[item.postId];
    const topics = edit ? edit.topics : item.topics;
    const subtags = edit ? edit.subtags : item.subtags;
    index.effectiveTopics[i] = topics;
    index.effectiveSubtags[i] = subtags;
    index.edited[i] = edit ? 1 : 0;
    let mask = 0;
    for (const t of topics) mask |= topicBit(t);
    index.topics[i] = mask || NO_TOPIC_BIT;
    const subs: string[] = [];
    for (const t of topics) for (const s of subtags[t] ?? []) subs.push(`${t}:${s}`);
    index.subtags[i] = subs;
    let formats = 0;
    for (const f of item.formats) formats |= formatBit(f);
    index.formats[i] = formats;
    let states = 0;
    for (const s of item.states) if (!(s === "topic-review" && edit)) states |= stateBit(s);
    index.states[i] = states;
    index.hay[i] = fold(
      [
        item.text,
        item.articleTitle ?? "",
        item.name ?? "",
        item.handle,
        `@${item.handle}`,
        topics.join(" "),
        Object.values(subtags).flat().join(" "),
        item.quote?.text ?? "",
        item.quote?.handle ? `@${item.quote.handle}` : "",
        item.media.map((m) => ("alt" in m && m.alt) || "").join(" "),
      ].join("\n"),
    );
  });
  const ids = Array.from({ length: n }, (_, i) => i);
  const time = (i: number) => {
    const t = library.items[i].postedAt ? Date.parse(library.items[i].postedAt!) : NaN;
    return Number.isNaN(t) ? null : t;
  };
  index.orders.saved = Int32Array.from([...ids].sort((a, b) => library.items[a].order - library.items[b].order));
  index.orders.newest = Int32Array.from(
    [...ids].sort((a, b) => (time(b) ?? -Infinity) - (time(a) ?? -Infinity) || a - b),
  );
  index.orders.oldest = Int32Array.from(
    [...ids].sort((a, b) => (time(a) ?? Infinity) - (time(b) ?? Infinity) || a - b),
  );
  return index;
}

// ---------------------------------------------------------------- query

export interface Query {
  q: string;
  topics: string[]; // topic names and/or NO_TOPIC
  subtags: string[]; // "Topic:subtag"
  formats: Format[];
  states: ContentState[];
  view: "all" | "favourites";
  sort: Sort;
}

export const EMPTY_QUERY: Query = { q: "", topics: [], subtags: [], formats: [], states: [], view: "all", sort: "saved" };

export function isFiltered(query: Query) {
  return !!(query.q.trim() || query.topics.length || query.subtags.length || query.formats.length || query.states.length || query.view !== "all");
}

export interface Counts {
  all: number;
  favourites: number;
  topics: number[]; // TOPICS order, then "no topic"
  subtags: Map<string, number>;
  formats: number[];
  states: number[];
}

export interface Results {
  ids: Int32Array;
  counts: Counts;
  /** Items in the library before search and filters. */
  total: number;
}

/** Text match per item, cached by query string. */
export function textMatches(index: Index, q: string): Uint8Array | null {
  const terms = searchTerms(q);
  if (!terms.length) return null;
  const out = new Uint8Array(index.hay.length);
  for (let i = 0; i < index.hay.length; i++) {
    const hay = index.hay[i];
    let ok = 1;
    for (const term of terms) {
      if (!hay.includes(term)) {
        ok = 0;
        break;
      }
    }
    out[i] = ok;
  }
  return out;
}

export function runQuery(index: Index, query: Query, text: Uint8Array | null, favourites: Record<string, string>): Results {
  const items = index.library.items;
  const n = items.length;
  let topicSel = 0;
  for (const t of query.topics) topicSel |= t === NO_TOPIC ? NO_TOPIC_BIT : topicBit(t as Topic);
  let formatSel = 0;
  for (const f of query.formats) formatSel |= formatBit(f);
  let stateSel = 0;
  for (const s of query.states) stateSel |= stateBit(s);
  const subSel = new Set(query.subtags);
  const favOnly = query.view === "favourites";

  const counts: Counts = {
    all: 0,
    favourites: 0,
    topics: new Array(TOPICS.length + 1).fill(0),
    subtags: new Map(),
    formats: new Array(FORMATS.length).fill(0),
    states: new Array(STATES.length).fill(0),
  };
  const pass = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (text && !text[i]) continue;
    const fav = favourites[items[i].postId] !== undefined;
    const pView = !favOnly || fav;
    const topics = index.topics[i];
    const pTopic = !topicSel || (topics & topicSel) !== 0;
    const subs = index.subtags[i];
    let pSub = subSel.size === 0;
    if (!pSub) for (const s of subs) if (subSel.has(s)) { pSub = true; break; }
    const formats = index.formats[i];
    const pFormat = !formatSel || (formats & formatSel) !== 0;
    const states = index.states[i];
    const pState = !stateSel || (states & stateSel) !== 0;

    if (pTopic && pSub && pFormat && pState) {
      counts.all++;
      if (fav) counts.favourites++;
    }
    if (pView && pFormat && pState) {
      for (let b = 0; b <= TOPICS.length; b++) if (topics & (1 << b)) counts.topics[b]++;
      if (pTopic) for (const s of subs) counts.subtags.set(s, (counts.subtags.get(s) ?? 0) + 1);
    }
    if (pView && pTopic && pSub && pState) {
      for (let b = 0; b < FORMATS.length; b++) if (formats & (1 << b)) counts.formats[b]++;
    }
    if (pView && pTopic && pSub && pFormat) {
      for (let b = 0; b < STATES.length; b++) if (states & (1 << b)) counts.states[b]++;
    }
    if (pView && pTopic && pSub && pFormat && pState) pass[i] = 1;
  }

  const order = index.orders[query.sort];
  let found = 0;
  for (let k = 0; k < n; k++) if (pass[order[k]]) found++;
  const ids = new Int32Array(found);
  let j = 0;
  for (let k = 0; k < n; k++) if (pass[order[k]]) ids[j++] = order[k];
  return { ids, counts, total: n };
}

// ---------------------------------------------------------------- URL state

export function queryFromSearch(search: string): Query {
  const params = new URLSearchParams(search);
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    topics: params.getAll("topic").filter((t) => t === NO_TOPIC || (TOPICS as readonly string[]).includes(t)),
    subtags: params.getAll("sub").filter((s) => s.includes(":")),
    formats: params.getAll("format").filter((f): f is Format => (FORMATS as readonly string[]).includes(f)),
    states: params.getAll("state").filter((s): s is ContentState => (STATES as readonly string[]).includes(s)),
    view: params.get("view") === "favourites" ? "favourites" : "all",
    sort: sort === "newest" || sort === "oldest" ? sort : "saved",
  };
}

export function searchFromQuery(query: Query): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  for (const t of query.topics) params.append("topic", t);
  for (const s of query.subtags) params.append("sub", s);
  for (const f of query.formats) params.append("format", f);
  for (const s of query.states) params.append("state", s);
  if (query.view !== "all") params.set("view", query.view);
  if (query.sort !== "saved") params.set("sort", query.sort);
  const text = params.toString();
  return text ? `?${text}` : "";
}
