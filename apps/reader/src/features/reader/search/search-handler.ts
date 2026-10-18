import type {
  SearchChapterResult,
  SearchStart,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./search-protocol";
import { ChapterSearchText, foldQuery } from "./search-text";

/** A chapter, or the part of it before or after the reader. */
interface SearchPart {
  chapterIndex: number;
  range?: { from?: number; to?: number };
}

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

  /** Chapters, or parts of one, in the order a search from `from` reads them. */
  function searchOrder(from: SearchStart | undefined): SearchPart[] {
    const count = chapters.length;
    if (!from || from.chapterIndex < 0 || from.chapterIndex >= count)
      return Array.from({ length: count }, (_, chapterIndex) => ({
        chapterIndex,
      }));
    const order: SearchPart[] = [
      { chapterIndex: from.chapterIndex, range: { from: from.offset } },
    ];
    for (let step = 1; step < count; step++)
      order.push({ chapterIndex: (from.chapterIndex + step) % count });
    if (from.offset > 0)
      order.push({
        chapterIndex: from.chapterIndex,
        range: { to: from.offset },
      });
    return order;
  }

  async function runSearch(
    searchId: number,
    query: string,
    limit: number,
    from?: SearchStart,
  ) {
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

    for (const { chapterIndex, range } of searchOrder(from)) {
      if (searchId !== activeSearchId) return;
      const chapter = chapters[chapterIndex];
      // The reader's chapter is read in two parts but counts once.
      const firstPart = range?.to === undefined;
      if (firstPart) searchedChapters++;
      if (!chapter) {
        if (firstPart) missingChapters++;
        continue;
      }
      const matches = foldedQuery
        ? chapter.search(foldedQuery, limit - totalMatches, range)
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
        void runSearch(
          request.searchId,
          request.query,
          request.limit,
          request.from,
        );
        return;
      case "cancel":
        if (request.searchId === activeSearchId) activeSearchId = 0;
        return;
    }
  };
}
