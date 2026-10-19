import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  endReaderTraceSpan,
  markReaderTrace,
  startReaderTraceSpan,
  type ReaderTraceSpanToken,
} from "@/lib/reader-performance-trace";
import { PaginationTracer } from "./diagnostics/tracer";
import type {
  GoToTextOffsetCommand,
  LocateTextOffsetsCommand,
  PaginationCommand,
  PaginationEvent,
  TextOffsetLocation,
} from "./protocol";
import {
  acquirePaginationWorkerSession,
  type PaginationWorkerSession,
} from "./worker/pagination-worker-service";
import type {
  Block,
  ChapterColumnLayout,
  ContentAnchor,
  PaginationChapterDiagnostics,
  PaginationConfig,
  PaginationStatus,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpreadConfig,
  SpreadIntent,
} from "./types";
import { DEFAULT_SPREAD_CONFIG } from "./types";

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };
const FORWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "forward",
};
const BACKWARD_LINEAR_INTENT: SpreadIntent = {
  kind: "linear",
  direction: "backward",
};

function addPendingChapterPageCount(
  pendingCounts: Map<number, number>,
  diagnostics: PaginationChapterDiagnostics | null | undefined,
): void {
  if (!diagnostics) return;
  pendingCounts.set(diagnostics.chapterIndex, diagnostics.pageCount);
}

function mergeChapterPageCounts(
  previousCounts: Map<number, number>,
  nextChapterCounts: ReadonlyMap<number, number>,
): Map<number, number> {
  if (nextChapterCounts.size === 0) return previousCounts;

  let nextCounts: Map<number, number> | null = null;
  for (const [chapterIndex, pageCount] of nextChapterCounts) {
    if (previousCounts.get(chapterIndex) === pageCount) continue;
    nextCounts ??= new Map(previousCounts);
    nextCounts.set(chapterIndex, pageCount);
  }

  return nextCounts ?? previousCounts;
}

function roundTraceMilliseconds(value: number): number {
  return Math.round(value * 10) / 10;
}

export function isCompletePaginationReadyEvent(
  event: Extract<PaginationEvent, { type: "ready" }>,
  expectedChapterCount: number,
): boolean {
  return event.chapterDiagnostics.length >= expectedChapterCount;
}

function getWorkerTraceDetails(
  event: PaginationEvent,
  roundTripStartedAtMs: number | null,
  mainHandlerEnteredAtEpochMs: number,
): Record<string, number | string> {
  if (
    (event.type !== "partialReady" && event.type !== "ready") ||
    !event.workerTiming
  ) {
    return {};
  }

  const activeMs = roundTraceMilliseconds(event.workerTiming.activeMs);
  const elapsedMs = roundTraceMilliseconds(event.workerTiming.elapsedMs);
  const roundTripMs =
    roundTripStartedAtMs === null
      ? elapsedMs
      : performance.now() - roundTripStartedAtMs;
  const responseDeliveryMs = Math.max(
    0,
    mainHandlerEnteredAtEpochMs - event.workerTiming.postedAtEpochMs,
  );
  const outsideWorkerMs = Math.max(0, roundTripMs - elapsedMs);
  return {
    workerActiveMs: activeMs,
    workerWaitMs: Math.max(0, roundTraceMilliseconds(elapsedMs - activeMs)),
    workerResponseDeliveryMs: roundTraceMilliseconds(responseDeliveryMs),
    workerCommandDeliveryMs: Math.max(
      0,
      roundTraceMilliseconds(outsideWorkerMs - responseDeliveryMs),
    ),
    outsideWorkerMs: roundTraceMilliseconds(outsideWorkerMs),
    workerPostedAt: new Date(event.workerTiming.postedAtEpochMs).toISOString(),
    mainHandlerEnteredAt: new Date(mainHandlerEnteredAtEpochMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const EMPTY_ANCHOR_PAGES: Record<string, number | null> = {};

export interface UsePaginationResult {
  locateAnchors: (
    anchors: { id: string; anchor: ContentAnchor }[],
    scope?: string,
  ) => void;
  anchorPagesByScope: Record<string, Record<string, number | null>>;
  /** Places canonical text offsets; results land in `textOffsetsByScope`. */
  locateTextOffsets: (
    chapters: LocateTextOffsetsCommand["chapters"],
    scope: string,
  ) => void;
  textOffsetsByScope: Record<string, Record<string, TextOffsetLocation | null>>;
  anchorPages: Record<string, number | null>;
  /** Available once this hook owns a worker session; changes on reacquisition. */
  sessionGeneration: number | null;
  spread: ResolvedSpread | null;
  spreadWindow: ResolvedSpreadWindow | null;
  status: PaginationStatus;
  /** Maps chapterIndex → page count, published with visible partials and final ready. */
  chapterPageCounts: Map<number, number>;
  /** The subscribed chapter's scroll column (prototype scroll mode). */
  scrollColumn: ChapterColumnLayout | null;
  /** Subscribes one chapter's scroll column; null stops the updates. */
  setScrollChapter: (chapterIndex: number | null) => void;

  nextSpread: () => void;
  prevSpread: () => void;
  goToPage: (page: number, options: { intent: SpreadIntent }) => void;
  goToAnchor: (
    anchor: ContentAnchor,
    options: { intent: SpreadIntent },
  ) => void;
  goToChapter: (
    chapterIndex: number,
    options: { intent: SpreadIntent },
  ) => void;
  goToTarget: (
    chapterIndex: number,
    targetId: string,
    options: { intent: SpreadIntent; targetKind?: "element" | "highlight" },
  ) => void;
  /** Opens the page holding a canonical text offset in a chapter. */
  goToTextOffset: (
    target: Omit<GoToTextOffsetCommand, "type" | "intent">,
    options: { intent: SpreadIntent },
  ) => void;

  init: (options: {
    totalChapters: number;
    initialChapterIndex: number;
    initialChapterProgress?: number;
    initialAnchor?: ContentAnchor;
    initialHighlightId?: string;
    intent?: SpreadIntent;
    firstChapterBlocks: Block[];
  }) => void;
  /** Called by the shell once per chapter after HTML processing is complete. */
  addChapter: (chapterIndex: number, blocks: Block[]) => void;
  /** Called to relayout a single already-loaded chapter after content updates. */
  updateChapter: (chapterIndex: number, blocks: Block[]) => void;

  tracer: PaginationTracer;
}

export interface UsePaginationOptions {
  /** Reacquire the worker session when its book or source changes. */
  sessionKey?: string;
  onLocationResolved?: (anchor: ContentAnchor, intent: SpreadIntent) => void;
  paginationConfig: PaginationConfig;
  spreadConfig?: SpreadConfig;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePagination(
  options: UsePaginationOptions,
): UsePaginationResult {
  const [anchorPagesByScope, setAnchorPagesByScope] = useState<
    Record<string, Record<string, number | null>>
  >({});
  const [textOffsetsByScope, setTextOffsetsByScope] = useState<
    Record<string, Record<string, TextOffsetLocation | null>>
  >({});
  const anchorRequest = useRef(0);
  const latestAnchorRequests = useRef(new Map<string, number>());
  const {
    paginationConfig,
    spreadConfig = DEFAULT_SPREAD_CONFIG,
    sessionKey,
  } = options;

  const [spreadWindow, setSpreadWindow] = useState<ResolvedSpreadWindow | null>(
    null,
  );
  const spread = spreadWindow?.current ?? null;
  const [status, setStatus] = useState<PaginationStatus>("idle");
  const [chapterPageCounts, setChapterPageCounts] = useState<
    Map<number, number>
  >(new Map());
  const [scrollColumn, setScrollColumn] = useState<ChapterColumnLayout | null>(
    null,
  );

  const workerSessionKeyRef = useRef(sessionKey);
  const workerSessionRef = useRef<PaginationWorkerSession | null>(null);
  const [sessionGeneration, setSessionGeneration] = useState<number | null>(
    null,
  );
  const currentEpochRef = useRef(0);
  const tracerRef = useRef(new PaginationTracer());
  const pendingChapterPageCountsRef = useRef<Map<number, number>>(new Map());
  const workerStartupSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const publisherFontsSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const firstSpreadSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const allChaptersSpanRef = useRef<ReaderTraceSpanToken | null>(null);
  const firstSpreadRoundTripStartedAtRef = useRef<number | null>(null);
  const allChaptersRoundTripStartedAtRef = useRef<number | null>(null);
  const expectedChapterCountRef = useRef(0);

  // Keep config in a ref so init and config update effects can read the
  // latest value without capturing it as a closure dependency.
  const paginationConfigRef = useRef<PaginationConfig>(paginationConfig);
  paginationConfigRef.current = paginationConfig;

  const spreadConfigRef = useRef<SpreadConfig>(spreadConfig);
  spreadConfigRef.current = spreadConfig;

  // Keep config refs so the config update effects can detect changes.
  const prevPaginationConfigRef = useRef<PaginationConfig | null>(null);
  const prevSpreadConfigRef = useRef<SpreadConfig | null>(null);

  const postCommand = useCallback((cmd: PaginationCommand) => {
    workerSessionRef.current?.postCommand(cmd);
  }, []);

  const recordChapterPageCount = useCallback(
    (diagnostics: PaginationChapterDiagnostics | null | undefined) => {
      addPendingChapterPageCount(
        pendingChapterPageCountsRef.current,
        diagnostics,
      );
    },
    [],
  );

  const publishChapterPageCounts = useCallback(
    (diagnostics: readonly PaginationChapterDiagnostics[]) => {
      for (const diagnostic of diagnostics) {
        recordChapterPageCount(diagnostic);
      }

      const pendingCounts = pendingChapterPageCountsRef.current;
      if (pendingCounts.size === 0) return;

      const nextChapterCounts = new Map(pendingCounts);
      pendingCounts.clear();

      setChapterPageCounts((prev) =>
        mergeChapterPageCounts(prev, nextChapterCounts),
      );
    },
    [recordChapterPageCount],
  );

  useEffect(() => {
    const tracer = tracerRef.current;

    return () => {
      tracer.cleanup();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Worker lifecycle
  // -------------------------------------------------------------------------

  const handleEvent = (
    event: PaginationEvent,
    mainHandlerEnteredAtEpochMs: number,
  ) => {
    // A route change can commit before the previous worker session is released.
    if (workerSessionKeyRef.current !== sessionKey) return;
    // Discard events from previous layout epochs.
    if ("epoch" in event && event.epoch < currentEpochRef.current) return;
    if ("epoch" in event) currentEpochRef.current = event.epoch;

    if (
      event.type === "partialReady" ||
      event.type === "ready" ||
      event.type === "pageContent"
    ) {
      options.onLocationResolved?.(event.anchor, event.intent);
    }

    switch (event.type) {
      case "anchorsLocated":
        if (event.requestId === latestAnchorRequests.current.get(event.scope))
          setAnchorPagesByScope((previous) => ({
            ...previous,
            [event.scope]: event.pages,
          }));
        return;
      case "textOffsetsLocated":
        if (
          event.requestId ===
          latestAnchorRequests.current.get(`text:${event.scope}`)
        )
          setTextOffsetsByScope((previous) => ({
            ...previous,
            [event.scope]: event.locations,
          }));
        return;
      case "trace":
        if (event.name === "worker-fonts-ready") {
          endReaderTraceSpan(workerStartupSpanRef.current, {
            blocksPagination: true,
            includes:
              "worker startup, built-in font readiness, and trace delivery",
          });
          workerStartupSpanRef.current = null;
          break;
        }
        endReaderTraceSpan(publisherFontsSpanRef.current, {
          blocksPagination: true,
          includes: "publisher font readiness and trace delivery",
        });
        publisherFontsSpanRef.current = null;
        break;

      case "partialReady": {
        if (firstSpreadSpanRef.current) {
          markReaderTrace(
            "pagination-partial-ready-handler-entered",
            "processing",
            {
              mainHandlerEnteredAt: new Date(
                mainHandlerEnteredAtEpochMs,
              ).toISOString(),
            },
          );
        }
        const partialWorkerDetails = getWorkerTraceDetails(
          event,
          firstSpreadRoundTripStartedAtRef.current,
          mainHandlerEnteredAtEpochMs,
        );
        currentEpochRef.current = event.epoch;
        tracerRef.current.markFirstVisible();
        tracerRef.current.recordChapterDiagnostics(event.chapterDiagnostics);
        recordChapterPageCount(event.chapterDiagnostics);
        setSpreadWindow({
          previous: event.previousSpread,
          current: event.spread,
          next: event.nextSpread,
          anchor: event.anchor,
        });
        setStatus("partial");
        endReaderTraceSpan(firstSpreadSpanRef.current, {
          readiness: "partial",
          totalPagesKnown: event.spread.totalPages,
          ...partialWorkerDetails,
        });
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        publishChapterPageCounts([]);
        break;
      }

      case "ready": {
        const isComplete = isCompletePaginationReadyEvent(
          event,
          expectedChapterCountRef.current,
        );
        if (isComplete && allChaptersSpanRef.current) {
          markReaderTrace("pagination-ready-handler-entered", "processing", {
            mainHandlerEnteredAt: new Date(
              mainHandlerEnteredAtEpochMs,
            ).toISOString(),
          });
        }
        const firstWorkerDetails = getWorkerTraceDetails(
          event,
          firstSpreadRoundTripStartedAtRef.current,
          mainHandlerEnteredAtEpochMs,
        );
        const allWorkerDetails = getWorkerTraceDetails(
          event,
          allChaptersRoundTripStartedAtRef.current,
          mainHandlerEnteredAtEpochMs,
        );
        currentEpochRef.current = event.epoch;
        tracerRef.current.recordChapterDiagnosticsList(
          event.chapterDiagnostics,
        );
        setSpreadWindow({
          previous: event.previousSpread,
          current: event.spread,
          next: event.nextSpread,
          anchor: event.anchor,
        });
        setStatus(isComplete ? "ready" : "partial");
        endReaderTraceSpan(firstSpreadSpanRef.current, {
          readiness: isComplete ? "complete" : "partial",
          totalPagesKnown: event.spread.totalPages,
          ...firstWorkerDetails,
        });
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        publishChapterPageCounts(event.chapterDiagnostics);
        if (!isComplete) break;

        tracerRef.current.markReady();
        endReaderTraceSpan(allChaptersSpanRef.current, {
          totalPages: event.spread.totalPages,
          chapterCount: event.chapterDiagnostics.length,
          ...allWorkerDetails,
        });
        allChaptersSpanRef.current = null;
        allChaptersRoundTripStartedAtRef.current = null;
        break;
      }

      case "progress":
        tracerRef.current.recordChapterDiagnostics(event.chapterDiagnostics);
        recordChapterPageCount(event.chapterDiagnostics);
        break;

      case "pageContent":
        setSpreadWindow({
          previous: event.previousSpread,
          current: event.spread,
          next: event.nextSpread,
          anchor: event.anchor,
        });
        break;

      case "pageUnavailable":
      case "chapterUnavailable":
        // Keep current page as-is.
        break;

      case "chapterColumn":
        setScrollColumn(event.column);
        break;

      case "error":
        endReaderTraceSpan(
          firstSpreadSpanRef.current,
          { error: event.message },
          "error",
        );
        firstSpreadSpanRef.current = null;
        firstSpreadRoundTripStartedAtRef.current = null;
        endReaderTraceSpan(
          allChaptersSpanRef.current,
          { error: event.message },
          "error",
        );
        allChaptersSpanRef.current = null;
        allChaptersRoundTripStartedAtRef.current = null;
        console.error("[pagination worker]", event.message);
        break;
    }
  };

  // Worker events read committed state without reconnecting the worker session.
  const onWorkerEvent = useEffectEvent(handleEvent);

  useEffect(() => {
    setSpreadWindow(null);
    setScrollColumn(null);
    setAnchorPagesByScope({});
    setTextOffsetsByScope({});
    latestAnchorRequests.current.clear();
    setStatus("idle");
    prevPaginationConfigRef.current = null;
    prevSpreadConfigRef.current = null;
    const session = acquirePaginationWorkerSession({
      onEvent: (event, mainHandlerEnteredAtEpochMs) => {
        onWorkerEvent(event, mainHandlerEnteredAtEpochMs);
      },
      onError: (event) => {
        endReaderTraceSpan(
          workerStartupSpanRef.current,
          { error: event.message, workerLifetime: "app" },
          "error",
        );
        workerStartupSpanRef.current = null;
        console.error("[pagination worker error]", event);
      },
    });
    workerSessionKeyRef.current = sessionKey;
    workerSessionRef.current = session;
    setSessionGeneration(session.sessionGeneration);
    workerStartupSpanRef.current = startReaderTraceSpan(
      "pagination-worker-fonts",
      "assets",
      {
        readinessBarrier: !session.workerFontsReadyAtAcquire,
        workerLifetime: "app",
        workerWarmAtAcquire: session.workerFontsReadyAtAcquire,
      },
    );
    const unsubscribeFromWorkerFonts = session.onWorkerFontsReady(() => {
      endReaderTraceSpan(workerStartupSpanRef.current, {
        blocksPagination: !session.workerFontsReadyAtAcquire,
        includes: session.workerFontsReadyAtAcquire
          ? "app-lifetime worker and built-in fonts were already ready"
          : "worker startup, built-in font readiness, and trace delivery",
        workerLifetime: "app",
        workerWarmAtAcquire: session.workerFontsReadyAtAcquire,
      });
      workerStartupSpanRef.current = null;
    });

    return () => {
      unsubscribeFromWorkerFonts();
      endReaderTraceSpan(workerStartupSpanRef.current, {
        sessionReleasedBeforeReady: true,
        workerLifetime: "app",
      });
      workerStartupSpanRef.current = null;
      session.release();
      if (workerSessionRef.current === session) {
        workerSessionRef.current = null;
        setSessionGeneration(null);
      }
    };
  }, [sessionKey]);

  // -------------------------------------------------------------------------
  // Config updates
  // -------------------------------------------------------------------------

  useEffect(() => {
    const prev = prevPaginationConfigRef.current;
    prevPaginationConfigRef.current = paginationConfig;

    if (!prev) return; // init hasn't been called yet — config will be sent with init.

    setStatus((s) => (s === "idle" ? s : "recalculating"));
    postCommand({
      type: "updatePaginationConfig",
      paginationConfig,
    });
  }, [paginationConfig, postCommand]);

  useEffect(() => {
    const prev = prevSpreadConfigRef.current;
    prevSpreadConfigRef.current = spreadConfig;

    if (!prev) return; // init hasn't been called yet — config will be sent with init.

    postCommand({
      type: "updateSpreadConfig",
      spreadConfig,
    });
  }, [spreadConfig, postCommand]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  const init = useCallback(
    (opts: {
      totalChapters: number;
      initialChapterIndex: number;
      initialChapterProgress?: number;
      initialAnchor?: ContentAnchor;
      initialHighlightId?: string;
      intent?: SpreadIntent;
      firstChapterBlocks: Block[];
    }) => {
      const currentPaginationConfig = paginationConfigRef.current;
      const currentSpreadConfig = spreadConfigRef.current;
      currentEpochRef.current = 0;
      setAnchorPagesByScope({});
      setTextOffsetsByScope({});
      latestAnchorRequests.current.clear();
      anchorRequest.current++;
      expectedChapterCountRef.current = opts.totalChapters;
      prevPaginationConfigRef.current = currentPaginationConfig;
      prevSpreadConfigRef.current = currentSpreadConfig;
      tracerRef.current.reset();
      tracerRef.current.startRun();
      const roundTripStartedAtMs = performance.now();
      firstSpreadRoundTripStartedAtRef.current = roundTripStartedAtMs;
      allChaptersRoundTripStartedAtRef.current = roundTripStartedAtMs;
      firstSpreadSpanRef.current ??= startReaderTraceSpan(
        "pagination-first-spread",
        "pagination",
        {
          initialChapterIndex: opts.initialChapterIndex,
          executionContext: "worker-round-trip-wall",
        },
      );
      allChaptersSpanRef.current ??= startReaderTraceSpan(
        "pagination-all-chapters",
        "pagination",
        {
          totalChapters: opts.totalChapters,
          executionContext: "worker-pipeline",
        },
      );
      publisherFontsSpanRef.current ??= startReaderTraceSpan(
        "pagination-publisher-fonts",
        "assets",
        { readinessBarrier: true },
      );

      setSpreadWindow(null);
      setStatus("idle");
      pendingChapterPageCountsRef.current.clear();
      setChapterPageCounts(new Map());

      postCommand({
        type: "init",
        intent: opts.intent ?? REPLACE_INTENT,
        totalChapters: opts.totalChapters,
        paginationConfig: currentPaginationConfig,
        spreadConfig: currentSpreadConfig,
        initialChapterIndex: opts.initialChapterIndex,
        initialChapterProgress: opts.initialChapterProgress,
        initialAnchor: opts.initialAnchor,
        initialHighlightId: opts.initialHighlightId,
        firstChapterBlocks: opts.firstChapterBlocks,
      });
    },
    [postCommand],
  );

  const addChapter = useCallback(
    (chapterIndex: number, blocks: Block[]) => {
      postCommand({ type: "addChapter", chapterIndex, blocks });
    },
    [postCommand],
  );

  const updateChapter = useCallback(
    (chapterIndex: number, blocks: Block[]) => {
      postCommand({ type: "updateChapter", chapterIndex, blocks });
    },
    [postCommand],
  );

  const nextSpread = useCallback(() => {
    postCommand({ type: "nextSpread", intent: FORWARD_LINEAR_INTENT });
  }, [postCommand]);

  const prevSpread = useCallback(() => {
    postCommand({ type: "prevSpread", intent: BACKWARD_LINEAR_INTENT });
  }, [postCommand]);

  const goToAnchor = useCallback(
    (anchor: ContentAnchor, opts: { intent: SpreadIntent }) => {
      postCommand({ type: "goToAnchor", anchor, intent: opts.intent });
    },
    [postCommand],
  );

  const goToPage = useCallback(
    (p: number, options: { intent: SpreadIntent }) => {
      postCommand({
        type: "goToPage",
        page: Math.max(1, Math.floor(p)),
        intent: options.intent,
      });
    },
    [postCommand],
  );

  const goToChapter = useCallback(
    (chapterIndex: number, options: { intent: SpreadIntent }) => {
      postCommand({
        type: "goToChapter",
        chapterIndex: Math.floor(chapterIndex),
        intent: options.intent,
      });
    },
    [postCommand],
  );

  const goToTarget = useCallback(
    (
      chapterIndex: number,
      targetId: string,
      options: { intent: SpreadIntent; targetKind?: "element" | "highlight" },
    ) => {
      postCommand({
        type: "goToTarget",
        chapterIndex: Math.floor(chapterIndex),
        targetId,
        targetKind: options.targetKind,
        intent: options.intent,
      });
    },
    [postCommand],
  );

  const goToTextOffset = useCallback(
    (
      target: Omit<GoToTextOffsetCommand, "type" | "intent">,
      options: { intent: SpreadIntent },
    ) => {
      postCommand({ type: "goToTextOffset", ...target, intent: options.intent });
    },
    [postCommand],
  );

  const setScrollChapter = useCallback(
    (chapterIndex: number | null) => {
      if (chapterIndex === null) setScrollColumn(null);
      postCommand({ type: "setScrollChapter", chapterIndex });
    },
    [postCommand],
  );

  const locateAnchors = useCallback(
    (anchors: { id: string; anchor: ContentAnchor }[], scope = "default") => {
      const requestId = ++anchorRequest.current;
      latestAnchorRequests.current.set(scope, requestId);
      workerSessionRef.current?.postCommand({
        type: "locateAnchors",
        anchors,
        scope,
        requestId,
      });
    },
    [],
  );

  const locateTextOffsets = useCallback(
    (chapters: LocateTextOffsetsCommand["chapters"], scope: string) => {
      const requestId = ++anchorRequest.current;
      latestAnchorRequests.current.set(`text:${scope}`, requestId);
      workerSessionRef.current?.postCommand({
        type: "locateTextOffsets",
        chapters,
        scope,
        requestId,
      });
    },
    [],
  );

  return {
    sessionGeneration:
      workerSessionKeyRef.current === sessionKey ? sessionGeneration : null,
    spread,
    spreadWindow,
    status,
    chapterPageCounts,
    scrollColumn,
    setScrollChapter,
    nextSpread,
    prevSpread,
    goToPage,
    goToAnchor,
    goToChapter,
    goToTarget,
    goToTextOffset,
    locateAnchors,
    anchorPages: anchorPagesByScope.default ?? EMPTY_ANCHOR_PAGES,
    anchorPagesByScope,
    locateTextOffsets,
    textOffsetsByScope,
    init,
    addChapter,
    updateChapter,
    tracer: tracerRef.current,
  };
}
