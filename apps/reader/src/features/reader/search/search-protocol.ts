import type { ChapterSearchMatch, SearchChapterText } from "./search-text";

export interface SearchWorkerChapter extends SearchChapterText {
  chapterIndex: number;
}

/** Main thread → search worker. */
export type SearchWorkerRequest =
  | { type: "setBook"; bookKey: string; chapterCount: number }
  | { type: "addChapters"; bookKey: string; chapters: SearchWorkerChapter[] }
  | { type: "search"; searchId: number; query: string; limit: number }
  | { type: "cancel"; searchId: number };

export interface SearchChapterResult {
  chapterIndex: number;
  matches: ChapterSearchMatch[];
}

/** Search worker → main thread. Results stream in book order. */
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
    };
