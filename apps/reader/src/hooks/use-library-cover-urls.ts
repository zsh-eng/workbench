import { getBookCoverFileId } from "@/lib/book-file-references";
import type { Book } from "@/lib/db";
import { files, type FileId } from "@/lib/files";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INITIAL_COVER_ROWS = 2;

/**
 * Covers that load at once. On a new device each is a download of about
 * 40 KB that waits mostly on the server, so a dozen at a time keep the link
 * busy without decoding a whole library on the main thread at once.
 */
const COVER_LOADS_AT_ONCE = 12;

const decodedCoverUrls = new Map<FileId, string>();
const pendingCoverLoads = new Map<FileId, Promise<string | null>>();

/**
 * A cover waiting for its turn. Covers asked for on screen go before the
 * rest of the library, which goes in the Library's order.
 */
interface QueuedCover {
  fileId: FileId;
  /** How many background loads want it; zero once the screen asks for it. */
  backgroundHolders: number;
  start: () => void;
  skip: () => void;
}

const queuedCovers: QueuedCover[] = [];
let loadingCovers = 0;

function startQueuedCovers(): void {
  while (loadingCovers < COVER_LOADS_AT_ONCE && queuedCovers.length > 0) {
    const index = queuedCovers.findIndex(
      (cover) => cover.backgroundHolders === 0,
    );
    const [next] = queuedCovers.splice(Math.max(index, 0), 1);
    loadingCovers += 1;
    next!.start();
  }
}

async function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  await image.decode();
}

function getInitialCoverLimit(): number {
  if (typeof window === "undefined") return 16;

  const width = window.innerWidth;
  const columns =
    width >= 1536
      ? 8
      : width >= 1280
        ? 6
        : width >= 1024
          ? 5
          : width >= 768
            ? 4
            : width >= 640
              ? 3
              : 2;
  return columns * INITIAL_COVER_ROWS;
}

async function readDecodedCoverUrl(fileId: FileId): Promise<string | null> {
  try {
    const blob = await files.get(fileId);
    const objectUrl = URL.createObjectURL(blob);

    try {
      await decodeImage(objectUrl);
    } catch {
      URL.revokeObjectURL(objectUrl);
      return null;
    }

    const existingUrl = decodedCoverUrls.get(fileId);
    if (existingUrl) {
      URL.revokeObjectURL(objectUrl);
      return existingUrl;
    }

    decodedCoverUrls.set(fileId, objectUrl);
    return objectUrl;
  } catch {
    return null;
  }
}

type CoverLane = "now" | "screen" | "background";

/**
 * Loads and decodes a cover once for the application session. Keeping the
 * object URL across library mounts prevents a second blank-to-cover swap when
 * the user returns from the reader. A cover already on this device loads
 * `now`; downloads wait for a turn, `screen` before `background`.
 */
function loadDecodedCoverUrl(
  fileId: FileId,
  lane: CoverLane,
): Promise<string | null> {
  const cachedUrl = decodedCoverUrls.get(fileId);
  if (cachedUrl) return Promise.resolve(cachedUrl);

  const pendingLoad = pendingCoverLoads.get(fileId);
  if (pendingLoad) {
    const queued = queuedCovers.find((cover) => cover.fileId === fileId);
    if (queued && lane === "background" && queued.backgroundHolders > 0)
      queued.backgroundHolders += 1;
    if (queued && lane !== "background") {
      queued.backgroundHolders = 0;
      if (lane === "now") {
        queuedCovers.splice(queuedCovers.indexOf(queued), 1);
        loadingCovers += 1;
        queued.start();
      }
    }
    return pendingLoad;
  }

  const loadPromise = new Promise<string | null>((resolve) => {
    const cover: QueuedCover = {
      fileId,
      backgroundHolders: lane === "background" ? 1 : 0,
      start: () =>
        void readDecodedCoverUrl(fileId)
          .then(resolve)
          .finally(() => {
            pendingCoverLoads.delete(fileId);
            loadingCovers -= 1;
            startQueuedCovers();
          }),
      skip: () => {
        pendingCoverLoads.delete(fileId);
        resolve(null);
      },
    };
    if (lane === "now") {
      loadingCovers += 1;
      cover.start();
    } else queuedCovers.push(cover);
  });
  pendingCoverLoads.set(fileId, loadPromise);
  startQueuedCovers();
  return loadPromise;
}

/** Background covers that nobody wants any more leave the queue unstarted. */
function releaseBackgroundCovers(fileIds: ReadonlySet<FileId>): void {
  for (let index = queuedCovers.length - 1; index >= 0; index -= 1) {
    const cover = queuedCovers[index]!;
    if (cover.backgroundHolders === 0 || !fileIds.has(cover.fileId)) continue;
    cover.backgroundHolders -= 1;
    if (cover.backgroundHolders > 0) continue;
    queuedCovers.splice(index, 1);
    cover.skip();
  }
}

function getCachedCoverUrls(books: readonly Book[]): Map<string, string> {
  const result = new Map<string, string>();

  for (const book of books) {
    const fileId = getBookCoverFileId(book);
    if (!fileId) continue;

    const url = decodedCoverUrls.get(fileId);
    if (url) result.set(book.id, url);
  }

  return result;
}

export function evictLibraryCoverUrl(fileId: FileId | undefined): void {
  if (!fileId) return;

  const url = decodedCoverUrls.get(fileId);
  if (!url) return;

  URL.revokeObjectURL(url);
  decodedCoverUrls.delete(fileId);
}

interface UseLibraryCoverUrlsResult {
  coverUrls: ReadonlyMap<string, string>;
  initialCoversReady: boolean;
  requestCover: (book: Book) => void;
}

/**
 * Covers that arrived, published once a frame: a new device's covers come
 * in quick succession, and each publication renders the whole page.
 */
function useFrameBatchedCoverUrls(books: readonly Book[]) {
  const [coverUrls, setCoverUrls] = useState<Map<string, string>>(() =>
    getCachedCoverUrls(books),
  );
  const arrived = useRef(new Map<string, string>());
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
  const addCoverUrl = useCallback((bookId: string, url: string) => {
    arrived.current.set(bookId, url);
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const batch = [...arrived.current];
      arrived.current.clear();
      setCoverUrls((current) =>
        batch.every(([id, value]) => current.get(id) === value)
          ? current
          : new Map([...current, ...batch]),
      );
    });
  }, []);
  return { coverUrls, setCoverUrls, addCoverUrl };
}

/**
 * Prepares local covers in the first two rows as one presentation unit. Missing
 * covers download independently and use the existing placeholder until ready;
 * the network must never hold the Library's first paint. Covers near the
 * viewport load first, a few at a time; with background loading on, the
 * rest of the library follows in order.
 */
export function useLibraryCoverUrls(
  books: readonly Book[],
  options: { loadRemainingInBackground?: boolean } = {},
): UseLibraryCoverUrlsResult {
  const loadRemainingInBackground = options.loadRemainingInBackground ?? false;
  const [initialCoverLimit] = useState(getInitialCoverLimit);
  const initialBooks = useMemo(
    () => books.slice(0, initialCoverLimit),
    [books, initialCoverLimit],
  );
  const initialKey = initialBooks
    .map((book) => `${book.id}:${getBookCoverFileId(book) ?? "none"}`)
    .join("|");
  const [preparedKey, setPreparedKey] = useState(() =>
    initialBooks.every((book) => {
      const fileId = getBookCoverFileId(book);
      return !fileId || decodedCoverUrls.has(fileId);
    })
      ? initialKey
      : "",
  );
  const { coverUrls, setCoverUrls, addCoverUrl } =
    useFrameBatchedCoverUrls(books);

  useEffect(() => {
    let cancelled = false;

    void Promise.all(
      initialBooks.map(async (book) => {
        const fileId = getBookCoverFileId(book);
        if (!fileId) return null;

        if (!decodedCoverUrls.has(fileId) && !(await files.hasLocal(fileId))) {
          void loadDecodedCoverUrl(fileId, "screen").then((url) => {
            if (!cancelled && url) addCoverUrl(book.id, url);
          });
          return null;
        }

        const url = await loadDecodedCoverUrl(fileId, "now");
        return url ? ([book.id, url] as const) : null;
      }),
    ).then((entries) => {
      if (cancelled) return;

      setCoverUrls((current) => {
        const next = new Map(current);
        for (const entry of entries) {
          if (entry) next.set(...entry);
        }
        return next;
      });
      setPreparedKey(initialKey);
    });

    return () => {
      cancelled = true;
    };
  }, [addCoverUrl, initialBooks, initialKey, setCoverUrls]);

  useEffect(() => {
    if (!loadRemainingInBackground) return;
    if (preparedKey !== initialKey) return;

    let cancelled = false;
    const wanted = new Set<FileId>();
    for (const book of books.slice(initialCoverLimit)) {
      const fileId = getBookCoverFileId(book);
      if (!fileId) continue;
      wanted.add(fileId);
      void loadDecodedCoverUrl(fileId, "background").then((url) => {
        if (!cancelled && url) addCoverUrl(book.id, url);
      });
    }

    return () => {
      cancelled = true;
      releaseBackgroundCovers(wanted);
    };
  }, [
    addCoverUrl,
    books,
    initialCoverLimit,
    initialKey,
    loadRemainingInBackground,
    preparedKey,
  ]);

  const requestCover = useCallback(
    (book: Book) => {
      const fileId = getBookCoverFileId(book);
      if (!fileId) return;

      void loadDecodedCoverUrl(fileId, "screen").then((url) => {
        if (url) addCoverUrl(book.id, url);
      });
    },
    [addCoverUrl],
  );

  return {
    coverUrls,
    initialCoversReady: preparedKey === initialKey,
    requestCover,
  };
}
