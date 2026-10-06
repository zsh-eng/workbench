// Library projection shared by the importer, the loopback server and the UI.
// The importer writes it; the UI never reads the private source dataset.

export const SCHEMA_VERSION = 1;

export const TOPICS = [
  "AI practice",
  "Design inspiration",
  "Engineering",
  "Career & work",
  "Life & thinking",
  "Ideas & culture",
  "Tools & products",
] as const;
export type Topic = (typeof TOPICS)[number];

/** Content format attributes. They are never topics. */
export const FORMATS = [
  "photo",
  "carousel",
  "video",
  "video-preview",
  "link",
  "text",
] as const;
export type Format = (typeof FORMATS)[number];

/** Content and evidence states that a reader may want to find. */
export const STATES = [
  "truncated",
  "unverified",
  "article",
  "missing-media",
  "topic-review",
] as const;
export type ContentState = (typeof STATES)[number];

/**
 * How much of the post text the archive holds.
 * - verified: checked complete in a signed-in post view.
 * - captured: text as captured; not flagged, not certified complete.
 * - unverified: long post; the extractor may have shortened it.
 * - truncated: the bookmarks timeline visibly cut the text.
 * - article: a native X article; only its preview is saved.
 */
export type TextState = "verified" | "captured" | "unverified" | "truncated" | "article";

export interface ImageAsset {
  /** Manifest-relative path of the original, for example `assets/ab12.jpg`. */
  path: string;
  /** Asset revision (sha256 prefix). Changes when the bytes change. */
  rev: string;
  w: number;
  h: number;
  /** Widths of derived WebP copies available under /derived. */
  thumbs: number[];
  /** Average colour of the image, used as a calm placeholder. */
  tone: string | null;
  /** True when the image is a frame taken locally from a video, not an X poster. */
  derivedFrame?: boolean;
}

export type MediaRole = "post" | "quoted" | "link-preview";

export interface PhotoMedia {
  kind: "photo";
  role: MediaRole;
  image: ImageAsset;
  alt: string | null;
  /** X URL of the quoted post that owns this media, when known. */
  sourcePost: string | null;
}

export interface VideoMedia {
  kind: "video";
  role: MediaRole;
  /** Null when only a poster exists. The UI must then say "Video preview — open original". */
  video: {
    path: string;
    rev: string;
    w: number;
    h: number;
    duration: number;
    audio: boolean;
    gif: boolean;
    bytes: number;
    captions: { lang: string; path: string; rev: string }[];
  } | null;
  poster: ImageAsset | null;
  sourcePost: string | null;
}

export interface MissingMedia {
  kind: "missing";
  role: MediaRole;
  expected: "photo" | "video";
  reason: string;
}

export type Media = PhotoMedia | VideoMedia | MissingMedia;

export interface LibraryItem {
  /** Stable catalogue id from the source dataset. */
  id: string;
  /** Stable X post id. Routes use it. */
  postId: string;
  /** Original X post URL. */
  url: string;
  /** Author handle without `@`. */
  handle: string;
  name: string | null;
  /** ISO post date from X; null when absent. */
  postedAt: string | null;
  /** Position in the X bookmarks export (1 = first retrieved, most recent). */
  order: number;
  text: string;
  textState: TextState;
  /** Native X article title when the post is an article preview. */
  articleTitle: string | null;
  topics: Topic[];
  subtags: Partial<Record<Topic, string[]>>;
  topicConfidence: string;
  topicReview: boolean;
  formats: Format[];
  states: ContentState[];
  media: Media[];
  /** Quoted post context, kept separate from the author's own text. */
  quote: { url: string | null; handle: string | null; text: string | null } | null;
  /** Hash of this record's projection. Lets the UI update changed rows in place. */
  rev: string;
}

export interface LibraryProjection {
  schema: number;
  version: string;
  adoptedAt: string;
  source: {
    generatedAt: string | null;
    label: string;
    posts: number;
    excludedNonBookmarks: number;
  };
  taxonomy: Record<Topic, string[]>;
  items: LibraryItem[];
}

/** Per-item evidence served on demand for the detail view. */
export interface ItemDetail {
  id: string;
  bookmarkOrder: number;
  textSource: string;
  textNote: string | null;
  articleNote: string | null;
  extraction: { status: string; extractor: string | null } | null;
  signedInReview: { retrievedAt: string | null; textComplete: boolean | null } | null;
  snippetSummary: { text: string; label: string; basis: string } | null;
  articleSummary: { text: string; reason: string } | null;
  topicBasis: string | null;
  topicConfidence: string;
  reviewReasons: string[];
  mediaNotes: string[];
}

export interface UserEdit {
  topics: Topic[];
  subtags: Partial<Record<Topic, string[]>>;
  editedAt: string;
}

export interface UserState {
  revision: number;
  favourites: Record<string, string>;
  edits: Record<string, UserEdit>;
}

export interface VersionInfo {
  version: string;
  adoptedAt: string;
}
