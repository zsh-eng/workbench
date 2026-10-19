import type { ChapterSearchMatch, SearchChapterText } from "./search-text";

export interface SearchWorkerChapter extends SearchChapterText {
  chapterIndex: number;
}

/** Main thread → search worker. */
export type SearchWorkerRequest =
  | { type: "setBook"; bookKey: string; chapterCount: number }
  | { type: "addChapters"; bookKey: string; chapters: SearchWorkerChapter[] }
  | {
      type: "search";
      searchId: number;
      query: string;
      limit: number;
      /**
       * Where the reader is. The search starts there and wraps around the
       * book, so the limit keeps the matches nearest the reader.
       */
      from?: SearchStart;
    }
  | { type: "cancel"; searchId: number };

export interface SearchStart {
  chapterIndex: number;
  /** Canonical offset in the chapter. */
  offset: number;
}

export interface SearchChapterResult {
  chapterIndex: number;
  matches: ChapterSearchMatch[];
}

/**
 * Search worker → main thread. Results stream in book order from the
 * search's start, then from the start of the book up to it.
 */
export type SearchWorkerResponse =
  | {
      type: "progress";
      searchId: number;
      /** Chapters with matches since the last message. */
      chapters: SearchChapterResult[];
      searchedChapters: number;
      totalChapters: number;
      /** Worker time from the request to its first match. */
      firstMatchMs: number | null;
    }
  | {
      type: "done";
      searchId: number;
      totalMatches: number;
      /** The search stopped at its limit. */
      truncated: boolean;
      /** Chapters whose text had not arrived yet. */
      missingChapters: number;
      firstMatchMs: number | null;
      totalMs: number;
    }
  | {
      /** Every chapter of the book is folded, ready to search. */
      type: "folded";
      bookKey: string;
      /** Chapters folded in the background, and how long that took. */
      chapters: number;
      ms: number;
    };
