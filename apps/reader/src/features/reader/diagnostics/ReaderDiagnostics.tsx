import { parseEPUB } from "@/lib/epub-parser";
import type { Book, BookFile } from "@/lib/db";
import { computeFileId } from "@/lib/files";
import type { ReaderSettings } from "@/types/reader.types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpreadStage } from "../SpreadStage";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  type ReaderPageDebugDump,
} from "../debug/page-debug-dump";
import {
  validateReaderPageDebugDump,
  type ReaderPageDebugValidationResult,
} from "../debug/page-debug-validation";
import {
  buildChapterEntries,
  buildReaderChapterCachedContent,
  decorateChapterContent,
  loadBaseChapterContent,
  type ReaderDecoratedChapterArtifact,
} from "../data/chapter-content-pipeline";
import {
  buildPaginationConfig,
  buildSpreadConfig,
} from "../hooks/use-reader-core";
import { usePagination } from "@/lib/pagination-v2";
import type {
  PaginationDiagnostics,
  PaginationRunTimings,
  SpreadIntent,
} from "@/lib/pagination-v2";
import { DeferredEpubImageProvider } from "../shared/DeferredEpubImageProvider";
import type { ChapterEntry } from "../types";
import {
  resolveReaderDiagnosticLayout,
  resolveReaderDiagnosticProfile,
  type ReaderDiagnosticProfile,
} from "./reader-diagnostic-profile";

type DiagnosticEpubBytes = ArrayBuffer | Uint8Array | number[] | Blob;

interface DiagnosticEpubInput {
  name: string;
  bytes: DiagnosticEpubBytes;
}

interface DiagnosticReaderSource {
  id: string;
  book: Book;
  chapterEntries: ChapterEntry[];
  filesByPath: Map<string, BookFile>;
  artifactsByChapter: Map<number, ReaderDecoratedChapterArtifact>;
  /** Main-thread time to build each chapter, by chapter index. */
  chapterBuildTimings: DiagnosticChapterBuildTiming[];
  loadedAt: string;
}

/**
 * Main-thread work per chapter: `sourceMs` normalizes the file and parses it
 * for canonical text (the body cache's rebuild); `decorateMs` parses it into
 * blocks (each Reader open without a warm artifact).
 */
interface DiagnosticChapterBuildTiming {
  chapterIndex: number;
  sourceMs: number;
  decorateMs: number;
}

type DiagnosticSourceState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; source: DiagnosticReaderSource }
  | { status: "error"; error: string };

interface ReaderDiagnosticScanOptions {
  from?: number;
  to?: number;
  stopOnFirstFailure?: boolean;
  includeDumps?: boolean;
  timeoutMs?: number;
}

interface ReaderDiagnosticScanFailure {
  page: number;
  validation: ReaderPageDebugValidationResult;
  dump?: ReaderPageDebugDump;
}

interface ReaderDiagnosticScanResult {
  ok: boolean;
  pagesScanned: number;
  totalPages: number;
  failures: ReaderDiagnosticScanFailure[];
}

interface ReaderDiagnosticsHarness {
  getState: () => {
    status: DiagnosticSourceState["status"];
    book: { id: string; title: string } | null;
    paginationStatus: string;
    currentPage: number | null;
    totalPages: number;
    profile: ReaderDiagnosticProfile;
  };
  loadEpub: (input: DiagnosticEpubInput) => Promise<{
    book: { id: string; title: string };
    chapterCount: number;
  }>;
  waitForReady: (options?: { timeoutMs?: number }) => Promise<void>;
  goToPage: (
    page: number,
    options?: { timeoutMs?: number },
  ) => Promise<ReaderPageDebugDump>;
  dumpCurrentPage: () => ReaderPageDebugDump;
  validateCurrentPage: () => ReaderPageDebugValidationResult;
  scanPages: (
    options?: ReaderDiagnosticScanOptions,
  ) => Promise<ReaderDiagnosticScanResult>;
  scanChapter: (
    options: { chapterIndex: number } & ReaderDiagnosticScanOptions,
  ) => Promise<ReaderDiagnosticScanResult>;
  /** Timings for benchmarks: main-thread build and worker stages per chapter. */
  getPaginationDiagnostics: () => {
    build: DiagnosticChapterBuildTiming[];
    worker: PaginationDiagnostics | null;
    timings: PaginationRunTimings;
  };
}

declare global {
  interface Window {
    __EPUB_READER_DIAGNOSTICS__?: ReaderDiagnosticsHarness;
  }
}

const DIAGNOSTIC_JUMP_INTENT: SpreadIntent = {
  kind: "jump",
  source: "scrubber",
};

function getReaderDiagnosticProfileSettings(
  profile: ReaderDiagnosticProfile,
): ReaderSettings {
  return profile.settings;
}

async function resolveEpubBytes(
  bytes: DiagnosticEpubBytes,
): Promise<Uint8Array> {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (bytes instanceof Blob) return new Uint8Array(await bytes.arrayBuffer());
  if (Array.isArray(bytes)) return new Uint8Array(bytes);

  throw new Error("Unsupported EPUB bytes payload.");
}

async function buildDiagnosticReaderSource(
  input: DiagnosticEpubInput,
): Promise<DiagnosticReaderSource> {
  const bytes = await resolveEpubBytes(input.bytes);
  const fileBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBuffer).set(bytes);
  const file = new File([fileBuffer], input.name, {
    type: "application/epub+zip",
  });
  const sourceFileId = await computeFileId(file);
  const { book, files } = await parseEPUB(file, { sourceFileId });
  const chapterEntries = buildChapterEntries(book);
  const filesByPath = new Map(
    files.map((bookFile) => [bookFile.path, bookFile]),
  );
  const artifactsByChapter = new Map<number, ReaderDecoratedChapterArtifact>();
  const chapterBuildTimings: DiagnosticChapterBuildTiming[] = [];

  for (const chapter of chapterEntries) {
    const chapterFile = filesByPath.get(chapter.href);
    if (!chapterFile) {
      throw new Error(
        `Missing chapter file for href "${chapter.href}" (chapter ${chapter.index})`,
      );
    }

    const sourceText = await chapterFile.content.text();
    const sourceStartedAt = performance.now();
    const chapterContent = await buildReaderChapterCachedContent({
      source: sourceText,
      mediaType: chapterFile.mediaType,
      chapter,
      loadResource: async (path) => filesByPath.get(path)?.content ?? null,
    });
    const sourceMs = performance.now() - sourceStartedAt;
    const baseContent = loadBaseChapterContent({
      chapterIndex: chapter.index,
      chapterContent,
      chapter,
    });

    const decorateStartedAt = performance.now();
    artifactsByChapter.set(
      chapter.index,
      decorateChapterContent({
        baseContent,
        highlights: [],
      }),
    );
    chapterBuildTimings.push({
      chapterIndex: chapter.index,
      sourceMs,
      decorateMs: performance.now() - decorateStartedAt,
    });
  }

  return {
    id: `${book.id}:${sourceFileId}`,
    book,
    chapterEntries,
    filesByPath,
    artifactsByChapter,
    chapterBuildTimings,
    loadedAt: new Date().toISOString(),
  };
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function getTimeoutMessage(label: string, timeoutMs: number) {
  return `${label} timed out after ${timeoutMs}ms.`;
}

export function ReaderDiagnostics() {
  const [profile] = useState(() =>
    resolveReaderDiagnosticProfile(window.location.search),
  );
  const readerLayout = useMemo(
    () => resolveReaderDiagnosticLayout(profile),
    [profile],
  );
  const settings = getReaderDiagnosticProfileSettings(profile);
  const paginationConfig = useMemo(
    () =>
      buildPaginationConfig(
        settings,
        profile.paragraphSpacingFactor,
        readerLayout.stageViewport,
      ),
    [profile.paragraphSpacingFactor, readerLayout.stageViewport, settings],
  );
  const spreadConfig = useMemo(
    () => buildSpreadConfig(readerLayout.resolvedSpreadColumns),
    [readerLayout.resolvedSpreadColumns],
  );
  const pagination = usePagination({ paginationConfig, spreadConfig });
  const { addChapter: addPaginationChapter, init: initPagination } = pagination;
  const [sourceState, setSourceState] = useState<DiagnosticSourceState>({
    status: "idle",
  });

  const stageSlotRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const sourceStateRef = useRef(sourceState);
  const paginationRef = useRef(pagination);
  const waitListenersRef = useRef<Set<() => void>>(new Set());

  sourceStateRef.current = sourceState;
  paginationRef.current = pagination;

  const notifyWaiters = useCallback(() => {
    for (const listener of waitListenersRef.current) listener();
  }, []);

  useEffect(() => {
    notifyWaiters();
  }, [notifyWaiters, pagination.spread, pagination.status, sourceState]);

  useEffect(() => {
    if (sourceState.status !== "ready") return;

    const { source } = sourceState;
    const firstChapter = source.chapterEntries[0];
    if (!firstChapter) return;

    const firstArtifact = source.artifactsByChapter.get(firstChapter.index);
    if (!firstArtifact) return;

    initPagination({
      totalChapters: source.chapterEntries.length,
      initialChapterIndex: firstChapter.index,
      intent: { kind: "replace" },
      firstChapterBlocks: firstArtifact.blocks,
    });

    for (const chapter of source.chapterEntries.slice(1)) {
      const artifact = source.artifactsByChapter.get(chapter.index);
      if (artifact) addPaginationChapter(chapter.index, artifact.blocks);
    }
  }, [addPaginationChapter, initPagination, sourceState]);

  const waitForCondition = useCallback(
    async (
      label: string,
      condition: () => boolean,
      timeoutMs = 15_000,
    ): Promise<void> => {
      if (condition()) return;

      await new Promise<void>((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          waitListenersRef.current.delete(check);
          reject(new Error(getTimeoutMessage(label, timeoutMs)));
        }, timeoutMs);

        const check = () => {
          if (!condition()) return;
          window.clearTimeout(timeoutId);
          waitListenersRef.current.delete(check);
          resolve();
        };

        waitListenersRef.current.add(check);
      });
    },
    [],
  );

  const captureDump = useCallback((): ReaderPageDebugDump => {
    const currentSourceState = sourceStateRef.current;
    const currentPagination = paginationRef.current;

    if (currentSourceState.status !== "ready") {
      throw new Error("No in-memory diagnostic EPUB has been loaded.");
    }

    if (!currentPagination.spread) {
      throw new Error("Reader diagnostics have not rendered a spread yet.");
    }

    const { source } = currentSourceState;
    return buildReaderPageDebugDump({
      book: source.book,
      settings,
      spread: currentPagination.spread,
      paginationConfig,
      spreadConfig,
      layout: {
        viewport: readerLayout.stageViewport,
        spreadColumns: readerLayout.resolvedSpreadColumns,
        columnGapPx: readerLayout.columnGapPx,
        paddingTopPx: readerLayout.stagePadding.paddingTop,
        paddingBottomPx: readerLayout.stagePadding.paddingBottom,
        paddingLeftPx: readerLayout.stagePadding.paddingX,
        paddingRightPx: readerLayout.stagePadding.paddingX,
      },
      environment: collectReaderPageDebugDumpEnvironment({
        stageSlotElement: stageSlotRef.current,
        stageContentElement: stageContentRef.current,
      }),
      chapterEntries: source.chapterEntries,
      getBlocks: (chapterIndex) =>
        source.artifactsByChapter.get(chapterIndex)?.blocks ?? null,
    });
  }, [paginationConfig, readerLayout, settings, spreadConfig]);

  const waitForReady = useCallback(
    async (options?: { timeoutMs?: number }) => {
      await waitForCondition(
        "Reader diagnostics ready",
        () =>
          sourceStateRef.current.status === "ready" &&
          paginationRef.current.status === "ready" &&
          paginationRef.current.spread !== null,
        options?.timeoutMs,
      );
      await waitForNextPaint();
    },
    [waitForCondition],
  );

  const goToPage = useCallback(
    async (page: number, options?: { timeoutMs?: number }) => {
      paginationRef.current.goToPage(page, { intent: DIAGNOSTIC_JUMP_INTENT });
      await waitForCondition(
        `Reader diagnostics page ${page}`,
        () => paginationRef.current.spread?.currentPage === page,
        options?.timeoutMs,
      );
      await waitForNextPaint();
      return captureDump();
    },
    [captureDump, waitForCondition],
  );

  const loadResource = useCallback(
    async (resourcePath: string): Promise<Blob | null> => {
      const currentSourceState = sourceStateRef.current;
      if (currentSourceState.status !== "ready") return null;
      return (
        currentSourceState.source.filesByPath.get(resourcePath)?.content ?? null
      );
    },
    [],
  );

  useEffect(() => {
    const harness: ReaderDiagnosticsHarness = {
      getState: () => {
        const currentSourceState = sourceStateRef.current;
        const currentPagination = paginationRef.current;
        const source =
          currentSourceState.status === "ready"
            ? currentSourceState.source
            : null;

        return {
          status: currentSourceState.status,
          book: source
            ? {
                id: source.book.id,
                title: source.book.title,
              }
            : null,
          paginationStatus: currentPagination.status,
          currentPage: currentPagination.spread?.currentPage ?? null,
          totalPages: currentPagination.spread?.totalPages ?? 0,
          profile,
        };
      },
      loadEpub: async (input) => {
        setSourceState({ status: "loading" });

        try {
          const source = await buildDiagnosticReaderSource(input);
          setSourceState({ status: "ready", source });
          return {
            book: {
              id: source.book.id,
              title: source.book.title,
            },
            chapterCount: source.chapterEntries.length,
          };
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Failed to load in-memory diagnostic EPUB.";
          setSourceState({ status: "error", error: message });
          throw new Error(message);
        }
      },
      waitForReady,
      goToPage,
      dumpCurrentPage: captureDump,
      validateCurrentPage: () => validateReaderPageDebugDump(captureDump()),
      scanPages: async (options = {}) => {
        await waitForReady({ timeoutMs: options.timeoutMs });
        const totalPages = paginationRef.current.spread?.totalPages ?? 0;
        const from = Math.max(1, Math.floor(options.from ?? 1));
        const to = Math.min(totalPages, Math.floor(options.to ?? totalPages));
        const stopOnFirstFailure = options.stopOnFirstFailure ?? true;
        const failures: ReaderDiagnosticScanFailure[] = [];
        let pagesScanned = 0;

        for (let page = from; page <= to; page++) {
          const dump = await goToPage(page, { timeoutMs: options.timeoutMs });
          const validation = validateReaderPageDebugDump(dump);
          pagesScanned += 1;

          if (validation.ok) continue;

          failures.push({
            page,
            validation,
            ...(options.includeDumps || failures.length === 0 ? { dump } : {}),
          });

          if (stopOnFirstFailure) break;
        }

        return {
          ok: failures.length === 0,
          pagesScanned,
          totalPages,
          failures,
        };
      },
      getPaginationDiagnostics: () => {
        const currentSourceState = sourceStateRef.current;
        const snapshot = paginationRef.current.tracer.getSnapshot();
        return {
          build:
            currentSourceState.status === "ready"
              ? currentSourceState.source.chapterBuildTimings
              : [],
          worker: snapshot.diagnostics,
          timings: snapshot.timings,
        };
      },
      scanChapter: async (options) => {
        await waitForReady({ timeoutMs: options.timeoutMs });
        const currentSourceState = sourceStateRef.current;
        if (currentSourceState.status !== "ready") {
          throw new Error("No in-memory diagnostic EPUB has been loaded.");
        }

        let startPage = 1;
        for (let i = 0; i < options.chapterIndex; i++) {
          startPage += paginationRef.current.chapterPageCounts.get(i) ?? 0;
        }

        const chapterPageCount =
          paginationRef.current.chapterPageCounts.get(options.chapterIndex) ??
          0;
        if (chapterPageCount <= 0) {
          throw new Error(
            `Chapter ${options.chapterIndex} has not been paginated.`,
          );
        }

        return harness.scanPages({
          ...options,
          from: startPage,
          to: startPage + chapterPageCount - 1,
        });
      },
    };

    window.__EPUB_READER_DIAGNOSTICS__ = harness;

    return () => {
      if (window.__EPUB_READER_DIAGNOSTICS__ === harness) {
        delete window.__EPUB_READER_DIAGNOSTICS__;
      }
    };
  }, [captureDump, goToPage, profile, waitForReady]);

  return (
    <div
      className={`${profile.settings.theme} flex h-dvh items-start justify-start overflow-auto bg-background text-foreground`}
      data-reader-diagnostics-status={sourceState.status}
    >
      <div
        ref={stageSlotRef}
        className="overflow-hidden"
        style={{
          width: `${profile.container.width}px`,
          height: `${profile.container.height}px`,
        }}
      >
        <DeferredEpubImageProvider loadResource={loadResource}>
          <SpreadStage
            spread={pagination.spread}
            spreadConfig={spreadConfig}
            columnSpacingPx={readerLayout.columnGapPx}
            paginationConfig={paginationConfig}
            stageContentRef={stageContentRef}
            disableAnimations
            paddingTopPx={readerLayout.stagePadding.paddingTop}
            paddingBottomPx={readerLayout.stagePadding.paddingBottom}
            paddingLeftPx={readerLayout.stagePadding.paddingX}
            paddingRightPx={readerLayout.stagePadding.paddingX}
          />
        </DeferredEpubImageProvider>
      </div>
    </div>
  );
}
