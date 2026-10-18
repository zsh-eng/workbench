import type {
  SearchChapterResult,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./search-protocol";
import { ChapterSearchText, foldQuery } from "./search-text";

/** Work between yields, so a cancel or a newer query lands quickly. */
const SLICE_MS = 8;

/**
 * Searches a book's chapter text a chapter at a time, streaming each
 * chapter's matches through `post`. A newer search or a cancel stops the
 * running one at the next chapter. The search worker runs this; tests call
 * it directly.
 */
export function createSearchHandler(
  post: (response: SearchWorkerResponse) => void,
): (request: SearchWorkerRequest) => void {
  let bookKey = "";
  let chapters: (ChapterSearchText | null)[] = [];
  let activeSearchId = 0;

  const channel = new MessageChannel();
  const pendingYields: (() => void)[] = [];
  channel.port1.onmessage = () => pendingYields.shift()?.();
  /** Yields to the event loop without a timer's minimum delay. */
  function yieldToMessages(): Promise<void> {
    return new Promise((resolve) => {
      pendingYields.push(resolve);
      channel.port2.postMessage(null);
    });
  }

  async function runSearch(searchId: number, query: string, limit: number) {
    const startedAt = performance.now();
    const foldedQuery = foldQuery(query);
    let firstMatchMs: number | null = null;
    let totalMatches = 0;
    let searchedChapters = 0;
    let missingChapters = 0;
    let pending: SearchChapterResult[] = [];
    let sliceStartedAt = performance.now();

    const flush = () => {
      post({
        type: "progress",
        searchId,
        chapters: pending,
        searchedChapters,
        totalChapters: chapters.length,
        firstMatchMs,
      });
      pending = [];
    };

    for (let chapterIndex = 0; chapterIndex < chapters.length; chapterIndex++) {
      if (searchId !== activeSearchId) return;
      const chapter = chapters[chapterIndex];
      searchedChapters++;
      if (!chapter) {
        missingChapters++;
        continue;
      }
      const matches = foldedQuery
        ? chapter.search(foldedQuery, limit - totalMatches)
        : [];
      if (matches.length) {
        firstMatchMs ??= performance.now() - startedAt;
        totalMatches += matches.length;
        pending.push({ chapterIndex, matches });
        // The first match goes out at once.
        if (totalMatches === matches.length) flush();
      }
      if (totalMatches >= limit) break;
      if (performance.now() - sliceStartedAt > SLICE_MS) {
        flush();
        await yieldToMessages();
        sliceStartedAt = performance.now();
      }
    }

    if (searchId !== activeSearchId) return;
    flush();
    post({
      type: "done",
      searchId,
      totalMatches,
      truncated: totalMatches >= limit,
      missingChapters,
      firstMatchMs,
      totalMs: performance.now() - startedAt,
    });
  }

  return (request) => {
    switch (request.type) {
      case "setBook":
        if (request.bookKey !== bookKey) {
          bookKey = request.bookKey;
          activeSearchId = 0;
          chapters = [];
        }
        chapters = Array.from(
          { length: request.chapterCount },
          (_, index) => chapters[index] ?? null,
        );
        return;
      case "addChapters":
        if (request.bookKey !== bookKey) return;
        for (const chapter of request.chapters)
          chapters[chapter.chapterIndex] = new ChapterSearchText(chapter);
        return;
      case "search":
        activeSearchId = request.searchId;
        void runSearch(request.searchId, request.query, request.limit);
        return;
      case "cancel":
        if (request.searchId === activeSearchId) activeSearchId = 0;
        return;
    }
  };
}
