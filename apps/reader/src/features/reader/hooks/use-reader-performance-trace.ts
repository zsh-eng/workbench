import type { Book } from "@/lib/db";
import type { PaginationStatus } from "@/lib/pagination-v2";
import {
  completeReaderTrace,
  useReaderTraceRecordingActive,
  endReaderTraceSpan,
  ensureReaderTrace,
  markReaderTrace,
  markReaderTraceOnce,
  recordReaderTraceSpan,
  startReaderTraceSpan,
  updateReaderTraceMetadata,
} from "@/lib/reader-performance-trace";
import type { ReaderSettings } from "@/types/reader.types";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReaderSessionStatus } from "./use-reader-session";

/** Starts a fallback trace for direct reader URLs and browser restores. */
export function useReaderPerformanceTraceRoute(
  bookId: string | undefined,
): void {
  const recordingActive = useReaderTraceRecordingActive();
  const deferredInterruptRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (!bookId || !recordingActive) return;

    ensureReaderTrace({ bookId });
    markReaderTraceOnce("reader-route-dom-committed", "navigation", {
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
  }, [bookId, recordingActive]);

  useEffect(() => {
    if (!bookId || !recordingActive) return;
    if (deferredInterruptRef.current !== null) {
      window.clearTimeout(deferredInterruptRef.current);
      deferredInterruptRef.current = null;
    }

    ensureReaderTrace({ bookId });
    markReaderTraceOnce("reader-route-mounted", "navigation", {
      phase: "passive-effect",
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
    const recordVisibility = () => {
      markReaderTrace("document-visibility-changed", "navigation", {
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      });
    };
    const recordFocus = () => {
      markReaderTrace("window-focus-changed", "navigation", {
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      });
    };
    document.addEventListener("visibilitychange", recordVisibility);
    window.addEventListener("focus", recordFocus);
    window.addEventListener("blur", recordFocus);
    const supportsLongTasks =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask");
    const longTaskObserver = supportsLongTasks
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            recordReaderTraceSpan({
              name: "main-thread-long-task",
              lane: "processing",
              startPerformanceMs: entry.startTime,
              endPerformanceMs: entry.startTime + entry.duration,
              details: { durationMs: Math.round(entry.duration * 10) / 10 },
            });
          }
        })
      : null;
    longTaskObserver?.observe({ type: "longtask", buffered: true });

    return () => {
      document.removeEventListener("visibilitychange", recordVisibility);
      window.removeEventListener("focus", recordFocus);
      window.removeEventListener("blur", recordFocus);
      longTaskObserver?.disconnect();
      // Defer the interrupt so React Strict Mode can remount the same route
      // without producing a false interrupted trace in development.
      deferredInterruptRef.current = window.setTimeout(() => {
        completeReaderTrace("interrupted", {
          reason: "reader-route-unmounted",
        });
        deferredInterruptRef.current = null;
      }, 0);
    };
  }, [bookId, recordingActive]);
}

/**
 * Records separate first-content and fully-settled paint milestones. The first
 * spread stays mounted while its images load, so asset readiness must not be
 * reported as the first time browser content can paint.
 */
export function useReaderPerformanceTraceLifecycle(options: {
  bookId: string | undefined;
  book: Book | null;
  status: ReaderSessionStatus;
  paginationStatus: PaginationStatus;
  displayReady: boolean;
  settledPaintReady: boolean;
  chapterCount: number;
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  settings: ReaderSettings;
}): void {
  const {
    bookId,
    book,
    status,
    paginationStatus,
    displayReady,
    settledPaintReady,
    chapterCount,
    viewport,
    spreadColumns,
    settings,
  } = options;
  useEffect(() => {
    if (!book) return;

    updateReaderTraceMetadata(
      {
        author: book.author,
        fileSizeBytes: book.fileSize,
        chapterCount,
        viewportWidth: Math.round(viewport.width),
        viewportHeight: Math.round(viewport.height),
        spreadColumns,
        publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
        matchPublisherBodyTextSize: settings.matchPublisherBodyTextSize,
        fontFamily: settings.fontFamily,
        fontSize: settings.fontSize,
        visibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      },
      book.title,
    );
    markReaderTraceOnce("book-metadata-ready", "storage");
  }, [
    book,
    chapterCount,
    settings.fontFamily,
    settings.fontSize,
    settings.matchPublisherBodyTextSize,
    settings.publisherBookStylingEnabled,
    spreadColumns,
    viewport.height,
    viewport.width,
  ]);

  useEffect(() => {
    if (status === "ready") {
      markReaderTraceOnce("first-spread-resolved", "pagination");
      return;
    }

    if (status === "not-found" || status === "file-error") {
      completeReaderTrace("error", { reason: status });
    }
  }, [status]);

  useLayoutEffect(() => {
    if (!bookId || status !== "ready") return;

    markReaderTraceOnce("first-spread-dom-committed", "reveal");
    const frameSpan = startReaderTraceSpan(
      "first-spread-commit-to-painted-frame",
      "reveal",
    );
    let secondFrameId: number | null = null;
    const firstFrameId = requestAnimationFrame(() => {
      secondFrameId = requestAnimationFrame(() => {
        endReaderTraceSpan(frameSpan);
        markReaderTraceOnce("first-spread-frame-painted", "reveal");
      });
    });

    return () => {
      cancelAnimationFrame(firstFrameId);
      if (secondFrameId !== null) cancelAnimationFrame(secondFrameId);
    };
  }, [bookId, status]);

  useEffect(() => {
    if (!bookId || !displayReady) return;

    markReaderTraceOnce("reader-display-ready", "reveal");
  }, [bookId, displayReady]);

  useEffect(() => {
    if (!bookId || !settledPaintReady) return;
    markReaderTraceOnce("reader-settled-frame-painted", "reveal", {
      visibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
    });
  }, [bookId, settledPaintReady]);

  useEffect(() => {
    if (!bookId || !settledPaintReady || paginationStatus !== "ready") {
      return;
    }

    markReaderTraceOnce("all-chapters-paginated", "pagination");
    completeReaderTrace("completed");
  }, [bookId, paginationStatus, settledPaintReady]);
}

/**
 * Mounted in the render that makes the Reader display ready: records how
 * long that render took to commit.
 */
export function DisplayReadyCommitProbe({
  paginationStatus,
  readerStatus,
}: {
  paginationStatus: string;
  readerStatus: string;
}): null {
  const renderStartedAtMsRef = useRef(performance.now());
  const statusRef = useRef({ paginationStatus, readerStatus });

  useLayoutEffect(() => {
    const committedAtMs = performance.now();
    const initialStatus = statusRef.current;
    recordReaderTraceSpan({
      name: "display-ready-reader-render-commit",
      lane: "processing",
      startPerformanceMs: renderStartedAtMsRef.current,
      endPerformanceMs: committedAtMs,
      details: {
        durationMs:
          Math.round((committedAtMs - renderStartedAtMsRef.current) * 10) / 10,
        paginationStatus: initialStatus.paginationStatus,
        readerStatus: initialStatus.readerStatus,
      },
    });
  }, []);

  return null;
}
