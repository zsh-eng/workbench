import { useDebugEnabled } from "@/lib/debug-preference";
import { HighlightToolbarContainer } from "@/features/reader/shared/HighlightToolbarContainer";
import { useInputBehavior } from "@/features/reader/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { recordReaderTraceSpan } from "@/lib/reader-performance-trace";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isInteractiveTapTarget } from "./hooks/use-touch-spread-tap-nav";
import { highlightNoteTarget } from "./note-locations";
import type { NoteTarget } from "@/types/note";
import type { TOCItem } from "@/lib/db";
import type {
  ChapterCanonicalText,
  ResolvedLeafPage,
  ResolvedSpread,
} from "@/lib/pagination-v2";
import { ReaderNotesPrototype } from "./ReaderNotesPrototype";
import { ReaderController } from "./ReaderController";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderSheetHost } from "./ReaderSheetHost";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { ReaderProgressPeek } from "./footer/ReaderProgressPeek";
import { ReaderFooter } from "./footer";
import { ReaderHistoryPageIndicator } from "./footer/ReaderHistoryPageIndicator";
import { ReaderChromeAccessory } from "./ReaderChromeAccessory";
import { NotesCapsule } from "./NotesIsland";
import { usePaginatedReaderLayout } from "./hooks/use-paginated-reader-layout";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderChromeState } from "./hooks/use-reader-chrome-state";
import { useReaderDisplayReadiness } from "./hooks/use-reader-display-readiness";
import { useReaderHandoffPrompt } from "./hooks/use-reader-handoff-prompt";
import {
  useReaderPerformanceTraceLifecycle,
  useReaderPerformanceTraceRoute,
} from "./hooks/use-reader-performance-trace";
import { useReaderSession } from "./hooks/use-reader-session";
import { useReaderStatusPrompt } from "./hooks/use-reader-status-prompt";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  serializeReaderPageDebugDump,
} from "./debug/page-debug-dump";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";
import { ReaderSearchPanel } from "./search/ReaderSearchPanel";
import { ReaderSearchStepper } from "./search/ReaderSearchStepper";
import { useReaderSearch } from "./search/use-reader-search";
import { useSearchMarks } from "./search/use-search-marks";
import { useHotkey } from "@tanstack/react-hotkeys";

function DisplayReadyCommitProbe({
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

const EMPTY_TOC: TOCItem[] = [];

/** The first page a spread shows. */
function leadingPage(spread: ResolvedSpread | null): ResolvedLeafPage | null {
  for (const slot of spread?.slots ?? [])
    if (slot.kind === "page") return slot.page;
  return null;
}

/** The canonical offset of the first text block a page shows, if loaded. */
function pageTextOffset(
  page: ResolvedLeafPage | null,
  getCanonicalText: (chapterIndex: number) => ChapterCanonicalText | null,
): number | null {
  if (!page) return null;
  const text = getCanonicalText(page.chapterIndex);
  for (const slice of page.content) {
    const start = text?.blockStarts.get(slice.blockId);
    if (start !== undefined) return start;
  }
  return null;
}

export function Reader() {
  const debugEnabled = useDebugEnabled();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // A header idea for Design ideas; Debug mode only.
  const headerVariant =
    debugEnabled && searchParams.get("header") === "split"
      ? "split"
      : "current";
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [noteComposerPresent, setNoteComposerPresent] = useState(false);
  const [noteDraftPresent, setNoteDraftPresent] = useState(false);
  const [commentPosition, setCommentPosition] = useState({ top: 112, page: 1 });
  const [noteQuote, setNoteQuote] = useState<NoteTarget | null>(null);
  const [noteViewportHeight, setNoteViewportHeight] = useState<number | null>(
    null,
  );
  const handleNotesActive = useCallback((active: boolean) => {
    setNoteViewportHeight(active ? window.innerHeight : null);
  }, []);

  const closeNotes = useCallback(
    () => handleNotesActive(false),
    [handleNotesActive],
  );

  const { state: chromeState, actions: chromeActions } =
    useReaderChromeState(isMobile);
  const { chromeInteractionMode } = useInputBehavior();
  useReaderPerformanceTraceRoute(bookId);

  const stageSlotRef = useRef<HTMLDivElement>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const [stageSlotElement, setStageSlotElement] =
    useState<HTMLDivElement | null>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);

  const handleStageSlotRef = useCallback((node: HTMLDivElement | null) => {
    stageSlotRef.current = node;
    setStageSlotElement(node);
  }, []);

  const {
    resolvedSpreadColumns,
    stageViewport,
    stagePadding,
    topRailHeight,
    bottomRailHeight,
    columnGapPx,
    isMeasured: isStageMeasured,
  } = usePaginatedReaderLayout({
    stageSlotElement,
    isMobile,
  });
  const isReaderStageMeasured =
    isStageMeasured && stageSlotElement?.dataset.readerStageSlot === "content";

  const {
    resources: sessionResources,
    state: sessionState,
    actions: sessionActions,
  } = useReaderSession({
    bookId,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
    layoutReady: isReaderStageMeasured,
  });
  const resumeBackgroundLoad = sessionActions.resumeBackgroundLoad;
  const endHistoryGroup = sessionActions.endHistoryGroup;
  useEffect(() => {
    endHistoryGroup();
  }, [chromeState.activeReaderSheet, endHistoryGroup]);

  const {
    state: annotationState,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight,
    creationPosition,
    creationText,
    activeHighlightCopyText,
    selectColor,
    closeCreation,
    clearActiveHighlight,
    captureSelectionNote,
  } = useReaderAnnotations({
    bookId,
    spread: sessionState.pagination.spread,
    stageContentRef,
    chapterEntries: sessionState.chapters.entries,
    fontConfig: sessionState.pagination.paginationConfig.fontConfig,
    publisherBookStylingEnabled:
      sessionState.pagination.paginationConfig.publisherBookStylingEnabled ??
      false,
    chapterAccess: sessionResources.chapterAccess,
    highlights: sessionState.highlights,
    onCreateHighlight: sessionActions.createHighlight,
  });

  // Search starts its worker the first time it opens.
  const searchOpen = chromeState.activeReaderSheet === "search";
  // Search ideas for Design ideas, Debug mode only: `?search=` steps to the
  // nearest match and `?searchMarks=` picks how matches are marked.
  const searchIdea = debugEnabled ? searchParams.get("search") : null;
  const searchMarks = debugEnabled ? searchParams.get("searchMarks") : null;
  const [searchStarted, setSearchStarted] = useState(false);
  const readerPage = leadingPage(sessionState.pagination.spread);
  if ((searchOpen || searchIdea) && !searchStarted) setSearchStarted(true);
  const search = useReaderSearch({
    bookId: bookId ?? "",
    enabled: searchStarted,
    chapters: sessionState.chapters.entries,
    toc: sessionState.book?.toc ?? EMPTY_TOC,
    chapterAccess: sessionResources.chapterAccess,
    highlights: sessionState.highlights,
    locations: sessionState.pagination.searchLocations,
    locateTextOffsets: sessionResources.locateTextOffsets,
    layoutKey: `${sessionState.pagination.status}:${sessionState.navigation.totalPages}`,
    currentChapterIndex: sessionState.navigation.currentChapterIndex,
    currentPageInChapter: readerPage?.currentPageInChapter ?? null,
    readerOffset:
      readerPage?.chapterIndex === sessionState.navigation.currentChapterIndex
        ? pageTextOffset(
            readerPage,
            sessionResources.chapterAccess.getCanonicalText,
          )
        : null,
    goToTextOffset: sessionActions.goToTextOffset,
    // A Design ideas preview leaves the book where its reader left it.
    previewOnly: Boolean(searchIdea),
  });
  const searchActiveIndex = search.state.activeIndex;
  useSearchMarks({
    enabled: searchOpen || searchActiveIndex !== null,
    containerRef: stageContentRef,
    spread: sessionState.pagination.spread,
    spreadWindow: sessionState.pagination.spreadWindow,
    results: search.state.results,
    activeId:
      searchActiveIndex === null
        ? null
        : (search.state.results[searchActiveIndex]?.id ?? null),
    getCanonicalText: sessionResources.chapterAccess.getCanonicalText,
  });
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);

  const { displayReady, settledPaintReady } = useReaderDisplayReadiness({
    bookId,
    contentReady: isReaderStageMeasured && sessionState.status === "ready",
    stageContentRef,
  });
  const { prompt: handoffPrompt } = useReaderHandoffPrompt({
    bookId,
    // The handoff target needs the complete chapter-to-page map. Starting this
    // optional storage query earlier only makes it compete with startup work.
    enabled: settledPaintReady && sessionState.pagination.status === "ready",
    chapterStartPages: sessionState.navigation.chapterStartPages,
    totalPages: sessionState.navigation.totalPages,
    onJumpToPage: sessionActions.jumpToHandoffPage,
  });
  useReaderPerformanceTraceLifecycle({
    bookId,
    book: sessionState.book,
    status: sessionState.status,
    paginationStatus: sessionState.pagination.status,
    displayReady,
    settledPaintReady,
    chapterCount: sessionState.chapters.entries.length,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
    settings: sessionState.settings,
  });
  useEffect(() => {
    if (!settledPaintReady) return;
    resumeBackgroundLoad();
  }, [resumeBackgroundLoad, settledPaintReady]);
  const searchIdeaStep = useRef<"query" | "open" | "done">("query");
  const { setQuery: setSearchQuery, next: nextSearchResult } = search;
  useEffect(() => {
    if (!searchIdea || !displayReady) return;
    if (searchIdeaStep.current === "query") {
      searchIdeaStep.current = "open";
      setSearchQuery(searchIdea, { remember: false });
    } else if (
      searchIdeaStep.current === "open" &&
      search.state.status === "done" &&
      search.state.results.length
    ) {
      searchIdeaStep.current = "done";
      nextSearchResult();
    }
  }, [
    displayReady,
    nextSearchResult,
    search.state.results.length,
    search.state.status,
    searchIdea,
    setSearchQuery,
  ]);

  // Find next and previous, as in a browser.
  const stepEnabled = displayReady && search.state.results.length > 0;
  useHotkey(
    "Mod+G",
    (event) => {
      event.preventDefault();
      search.next();
    },
    {
      target: window,
      enabled: stepEnabled,
      ignoreInputs: false,
      stopPropagation: false,
      meta: { name: "Next search result", description: "Go to the next match" },
    },
  );
  useHotkey(
    "Mod+Shift+G",
    (event) => {
      event.preventDefault();
      search.previous();
    },
    {
      target: window,
      enabled: stepEnabled,
      ignoreInputs: false,
      stopPropagation: false,
      meta: {
        name: "Previous search result",
        description: "Go to the previous match",
      },
    },
  );

  useHotkey(
    "Mod+F",
    (event) => {
      event.preventDefault();
      if (!displayReady) return;
      chromeActions.openReaderSheet("search");
      setSearchFocusRequest((request) => request + 1);
    },
    {
      target: window,
      ignoreInputs: false,
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: "Search book",
        description: "Find words in this book",
      },
    },
  );
  const statusPrompt = useReaderStatusPrompt({
    bookId,
    isReady: displayReady,
    // Only the complete page map can identify the actual end of the book.
    isLastPage:
      sessionState.pagination.status === "ready" &&
      sessionState.navigation.totalPages > 0 &&
      sessionState.navigation.currentPage + resolvedSpreadColumns - 1 >=
        sessionState.navigation.totalPages,
  });

  if (sessionState.status === "not-found" || !bookId) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  if (sessionState.status === "file-error") {
    return (
      <ReaderStateScreen
        title="Book file unavailable"
        message="The EPUB file is not available on this device. Reconnect to download it, or return to the Library and try again."
        titleTone="destructive"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  if (!sessionState.book) {
    return (
      <div className="relative h-dvh overflow-hidden overscroll-none bg-background">
        <div
          ref={handleStageSlotRef}
          data-reader-stage-slot="measurement"
          aria-hidden="true"
          className="invisible absolute inset-x-0"
          style={{
            top: "env(safe-area-inset-top)",
            bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
          }}
        />
      </div>
    );
  }

  const book = sessionState.book;
  const currentChapterEntry =
    sessionState.chapters.entries[
      sessionState.navigation.displayChapterIndex ??
        sessionState.navigation.currentChapterIndex
    ] ??
    sessionState.chapters.entries[sessionState.navigation.currentChapterIndex];
  const isReaderInteractionSuppressed =
    chromeState.activeReaderSheet !== null || !displayReady;
  // The annotation panel owns the mobile bottom edge, including before focus
  // and while its notebook is open. Reading controls must not compete with it.
  const mobileAnnotationVisible =
    isMobile &&
    Boolean(
      isCreatingHighlight ||
      activeHighlightData ||
      noteViewportHeight !== null ||
      notebookOpen ||
      noteComposerPresent ||
      chromeState.activeReaderSheet === "notes",
    );
  const shouldPrepareSwipePages =
    chromeInteractionMode === "touch" && displayReady;
  const swipeNavigationEnabled =
    shouldPrepareSwipePages && !isReaderInteractionSuppressed;
  const handleCopyDebugDump = async () => {
    const spread = sessionState.pagination.spread;

    if (!spread) {
      toast({
        message: "Page is not ready to copy.",
        variant: "destructive",
      });
      return;
    }

    const dump = buildReaderPageDebugDump({
      book,
      settings: sessionState.settings,
      spread,
      paginationConfig: sessionState.pagination.paginationConfig,
      spreadConfig: sessionState.pagination.spreadConfig,
      layout: {
        viewport: stageViewport,
        spreadColumns: resolvedSpreadColumns,
        columnGapPx,
        paddingTopPx: stagePadding.paddingTop,
        paddingBottomPx: stagePadding.paddingBottom,
        paddingLeftPx: stagePadding.paddingX,
        paddingRightPx: stagePadding.paddingX,
      },
      environment: collectReaderPageDebugDumpEnvironment({
        stageSlotElement: stageSlotRef.current,
        stageContentElement: stageContentRef.current,
      }),
      chapterEntries: sessionState.chapters.entries,
      getBlocks: sessionResources.chapterAccess.getBlocks,
    });

    try {
      await navigator.clipboard.writeText(serializeReaderPageDebugDump(dump));

      toast({
        message: "Copied debug dump.",
      });
    } catch {
      toast({
        message: "Could not copy debug dump.",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      data-search-marks={searchMarks ?? undefined}
      className="relative h-dvh overflow-hidden overscroll-none bg-background"
    >
      {displayReady && (
        <DisplayReadyCommitProbe
          key={bookId}
          paginationStatus={sessionState.pagination.status}
          readerStatus={sessionState.status}
        />
      )}
      <div className="h-full">
        <ReaderController
          onNextPage={sessionActions.nextSpread}
          onPrevPage={sessionActions.prevSpread}
          canGoPrev={sessionState.navigation.canGoPrev}
          canGoNext={sessionState.navigation.canGoNext}
          chromeInteractionMode={chromeInteractionMode}
          isChromeSuppressed={isReaderInteractionSuppressed}
          onDismissContentTap={
            noteViewportHeight === null &&
            !(isMobile && (isCreatingHighlight || activeHighlightData))
              ? undefined
              : () => {
                  closeNotes();
                  closeCreation();
                  clearActiveHighlight();
                }
          }
          containerRef={stageSlotRef}
          topRailHeight={topRailHeight}
          bottomRailHeight={bottomRailHeight}
        >
          {({
            chromeVisible,
            progressPeek,
            showHoverRails,
            topRailProps,
            bottomRailProps,
            chromeSurfaceProps,
            hideChrome,
          }) => (
            <div
              className="relative h-dvh overflow-hidden font-sans text-foreground"
              style={
                noteViewportHeight === null
                  ? undefined
                  : { height: noteViewportHeight }
              }
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-40" />
                <div className="absolute inset-x-6 bottom-0 h-56 rounded-t-[3rem]" />
              </div>
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 bg-background"
                style={{ height: "env(safe-area-inset-bottom)" }}
                aria-hidden="true"
              />

              {displayReady && showHoverRails && (
                <>
                  {/* Hover rails live in the existing top/bottom non-reading bands. */}
                  <div
                    {...topRailProps}
                    className="absolute inset-x-0 z-[15]"
                    style={{
                      ...topRailProps.style,
                      top: "env(safe-area-inset-top)",
                    }}
                  />
                  <div
                    {...bottomRailProps}
                    className="absolute inset-x-0 z-[15]"
                    style={{
                      ...bottomRailProps.style,
                      bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
                    }}
                  />
                </>
              )}

              {/* Reading container — offset by safe-area insets so clientHeight is safe-area-adjusted */}
              <div
                onClickCapture={(event) => {
                  if (
                    noteViewportHeight === null ||
                    event.defaultPrevented ||
                    isInteractiveTapTarget(event.target)
                  )
                    return;
                  if (
                    "pointerType" in event.nativeEvent &&
                    event.nativeEvent.pointerType === "touch"
                  )
                    return;
                  if (window.getSelection()?.toString()) return;
                  event.preventDefault();
                  closeNotes();
                }}
                ref={handleStageSlotRef}
                data-reader-stage-slot="content"
                className="absolute inset-x-0 z-10"
                style={{
                  top: "env(safe-area-inset-top)",
                  bottom: "max(env(safe-area-inset-bottom), 0.625rem)",
                  // Both drag axes belong to the Reader; preserve native pinch zoom.
                  touchAction:
                    chromeInteractionMode === "touch" ? "pinch-zoom" : "auto",
                }}
              >
                <DeferredEpubImageProvider key={bookId} bookId={bookId}>
                  <SpreadStage
                    spread={sessionState.pagination.spread}
                    previousSpread={
                      sessionState.pagination.spreadWindow?.previous
                    }
                    nextSpread={sessionState.pagination.spreadWindow?.next}
                    spreadConfig={sessionState.pagination.spreadConfig}
                    columnSpacingPx={columnGapPx}
                    paginationConfig={sessionState.pagination.paginationConfig}
                    stageContentRef={stageContentRef}
                    onLinkActivate={sessionActions.openInternalHref}
                    disableAnimations={
                      !sessionState.settings.pageAnimationsEnabled
                    }
                    renderAdjacentSpreads={shouldPrepareSwipePages}
                    swipeEnabled={swipeNavigationEnabled}
                    onSwipeStart={hideChrome}
                    onSwipeNext={sessionActions.nextSpread}
                    onSwipePrevious={sessionActions.prevSpread}
                    paddingTopPx={stagePadding.paddingTop}
                    paddingBottomPx={stagePadding.paddingBottom}
                    paddingLeftPx={stagePadding.paddingX}
                    paddingRightPx={stagePadding.paddingX}
                  />
                </DeferredEpubImageProvider>
              </div>

              <ReaderHeader
                accessory={
                  !isReaderInteractionSuppressed &&
                  !mobileAnnotationVisible &&
                  !(isMobile && annotationState.kind === "active") &&
                  (searchActiveIndex !== null ? (
                    <ReaderSearchStepper
                      floating={isMobile}
                      index={searchActiveIndex}
                      total={search.state.results.length}
                      truncated={search.state.truncated}
                      onPrevious={() => {
                        search.previous();
                        if (chromeInteractionMode === "touch") hideChrome();
                      }}
                      onNext={() => {
                        search.next();
                        if (chromeInteractionMode === "touch") hideChrome();
                      }}
                      onShowResults={() =>
                        chromeActions.openReaderSheet("search")
                      }
                      onClose={search.exit}
                    />
                  ) : handoffPrompt ? (
                    <ReaderChromeAccessory
                      kind="handoff"
                      floating={isMobile}
                      prompt={handoffPrompt}
                      currentPage={sessionState.navigation.currentPage}
                    />
                  ) : (
                    statusPrompt && (
                      <ReaderChromeAccessory
                        kind="reading"
                        floating={isMobile}
                        prompt={statusPrompt}
                      />
                    )
                  ))
                }
                chromeVisible={
                  noteViewportHeight === null &&
                  (!displayReady || chromeVisible)
                }
                chromeSurfaceProps={chromeSurfaceProps}
                bookTitle={book.title}
                isMobile={isMobile}
                onBackToLibrary={() => navigate("/")}
                isMenuOpen={chromeState.activeReaderSheet !== null}
                onOpenMenu={() => {
                  if (displayReady) chromeActions.openReaderSheet("tools");
                }}
                toolsTriggerRef={toolsTriggerRef}
                variant={headerVariant}
                chapterTitle={currentChapterEntry?.title}
                activeSheet={chromeState.activeReaderSheet}
                onToggleSheet={(sheet) => {
                  if (!displayReady) return;
                  const active = chromeState.activeReaderSheet;
                  // Contents opens the tools sidebar; any of its tools counts as open.
                  const open =
                    sheet === "settings"
                      ? active === "settings"
                      : active !== null && active !== "settings";
                  if (open) chromeActions.closeReaderSheet();
                  else chromeActions.openReaderSheet(sheet);
                }}
              />

              <ReaderProgressPeek
                {...progressPeek}
                bookId={book.id}
                currentPage={sessionState.navigation.currentPage}
                totalPages={sessionState.navigation.totalPages}
                currentChapterIndex={
                  sessionState.navigation.currentChapterIndex
                }
                currentChapterEndIndex={
                  sessionState.pagination.spread?.chapterIndexEnd ??
                  sessionState.navigation.currentChapterIndex
                }
                displayChapterIndex={
                  sessionState.navigation.displayChapterIndex
                }
                chapterEntries={sessionState.chapters.entries}
                chapterStartPages={sessionState.navigation.chapterStartPages}
                available={
                  displayReady &&
                  sessionState.pagination.status === "ready" &&
                  sessionState.settings.showPageNumbers &&
                  !chromeVisible &&
                  !mobileAnnotationVisible &&
                  !isReaderInteractionSuppressed &&
                  noteViewportHeight === null
                }
              />

              {/* Keep both chrome edges visible while pagination prepares. */}
              <ReaderFooter
                suppressed={mobileAnnotationVisible}
                pageStep={resolvedSpreadColumns}
                pageIndicator={
                  <ReaderHistoryPageIndicator
                    key={book.id}
                    state={sessionState}
                    locateAnchors={sessionResources.locateAnchors}
                    onSelect={sessionActions.selectHistoryVisit}
                    onExpandedChange={sessionActions.setHistoryExpanded}
                  />
                }
                isMobile={isMobile}
                chromeVisible={
                  noteViewportHeight === null &&
                  (!displayReady || chromeVisible)
                }
                chromeSurfaceProps={chromeSurfaceProps}
                isContentsOpen={chromeState.activeReaderSheet === "contents"}
                currentPage={sessionState.navigation.currentPage}
                totalPages={sessionState.navigation.totalPages}
                currentChapterIndex={
                  sessionState.navigation.currentChapterIndex
                }
                currentChapterEndIndex={
                  sessionState.pagination.spread?.chapterIndexEnd ??
                  sessionState.navigation.currentChapterIndex
                }
                displayChapterIndex={
                  sessionState.navigation.displayChapterIndex
                }
                chapterEntries={sessionState.chapters.entries}
                chapterStartPages={sessionState.navigation.chapterStartPages}
                onScrubPreview={sessionActions.previewPage}
                onScrubCommit={sessionActions.commitPage}
                onGoToChapter={sessionActions.goToChapter}
                onPrevChapter={sessionActions.goToPreviousChapter}
                onOpenContents={() => {
                  if (displayReady) chromeActions.openReaderSheet("contents");
                }}
                isLoading={
                  !displayReady || sessionState.pagination.status !== "ready"
                }
                noteAccessory={
                  isMobile && (
                    <NotesCapsule
                      bookId={book.id}
                      highlights={sessionState.highlights}
                      draft={noteDraftPresent}
                      disabled={
                        !displayReady ||
                        sessionState.pagination.status !== "ready"
                      }
                      onJot={() => handleNotesActive(true)}
                      onOpenNotebook={() => {
                        handleNotesActive(true);
                        setNotebookOpen(true);
                      }}
                    />
                  )
                }
                showPageNumbers={sessionState.settings.showPageNumbers}
              />

              {displayReady && (
                <>
                  <ReaderNotesPrototype
                    key={bookId}
                    bookId={bookId}
                    mobileAnnotation={
                      isMobile && (isCreatingHighlight || activeHighlightData)
                        ? {
                            identity: annotationState,
                            highlightId: activeHighlightData?.id,
                            tools: (
                              <HighlightToolbarContainer
                                bookId={bookId}
                                spineItemId={activeHighlightData?.spineItemId}
                                highlights={sessionState.highlights}
                                isCreatingHighlight={isCreatingHighlight}
                                creationPosition={creationPosition}
                                creationText={creationText}
                                onCreateColorSelect={(color) => {
                                  const highlight = selectColor(color);
                                  if (highlight && noteViewportHeight !== null)
                                    setNoteQuote(
                                      highlightNoteTarget(highlight, true),
                                    );
                                }}
                                onHighlightChange={(highlight) => {
                                  if (noteViewportHeight !== null)
                                    setNoteQuote(
                                      highlightNoteTarget(highlight, true),
                                    );
                                }}
                                onCreateClose={closeCreation}
                                activeHighlight={activeHighlight}
                                onEditClose={clearActiveHighlight}
                              />
                            ),
                            captureTarget: () => {
                              const highlight =
                                activeHighlightData ?? captureSelectionNote();
                              return highlight
                                ? highlightNoteTarget(
                                    highlight,
                                    Boolean(activeHighlightData),
                                  )
                                : null;
                            },
                            close: () => {
                              closeCreation();
                              clearActiveHighlight();
                            },
                          }
                        : undefined
                    }
                    highlights={sessionState.highlights}
                    onVisitHighlight={sessionActions.goToHighlight}
                    chapters={sessionState.chapters.entries}
                    chapterAccess={sessionResources.chapterAccess}
                    pagination={sessionState.pagination}
                    locateAnchors={sessionResources.locateAnchors}
                    open={
                      noteViewportHeight !== null ||
                      chromeState.activeReaderSheet === "notes"
                    }
                    currentChapterIndex={
                      sessionState.navigation.currentChapterIndex
                    }
                    location={{
                      page: sessionState.navigation.currentPage,
                      chapter: currentChapterEntry?.title ?? "Current chapter",
                    }}
                    notebook={
                      isMobile
                        ? notebookOpen ||
                          chromeState.activeReaderSheet === "notes"
                        : chromeState.activeReaderSheet === "notes"
                    }
                    setNotebook={(nextOpen) => {
                      if (isMobile) {
                        setNotebookOpen(nextOpen);
                        if (
                          !nextOpen &&
                          chromeState.activeReaderSheet === "notes"
                        )
                          chromeActions.closeReaderSheet();
                      } else if (nextOpen)
                        chromeActions.openReaderSheet("notes");
                      else if (chromeState.activeReaderSheet === "notes")
                        chromeActions.closeReaderSheet();
                    }}
                    embeddedNotebook={
                      isMobile && chromeState.activeReaderSheet === "notes"
                    }
                    desktop={!isMobile}
                    commentPosition={commentPosition}
                    quote={noteQuote}
                    onClearQuote={() => setNoteQuote(null)}
                    onActiveChange={handleNotesActive}
                    onMobileComposerPresenceChange={setNoteComposerPresent}
                    onDraftPresenceChange={setNoteDraftPresent}
                    onReturnToReading={hideChrome}
                    margin={{
                      width: stagePadding.paddingX,
                      enabled: !isMobile && !isReaderInteractionSuppressed,
                      location: {
                        page: Math.min(
                          sessionState.navigation.totalPages,
                          sessionState.navigation.currentPage +
                            resolvedSpreadColumns -
                            1,
                        ),
                        chapter:
                          sessionState.chapters.entries[
                            sessionState.pagination.spread?.chapterIndexEnd ??
                              sessionState.navigation.currentChapterIndex
                          ]?.title ?? "Current chapter",
                      },
                    }}
                    onVisit={sessionActions.goToNotePage}
                  >
                    {(notesPanel) => (
                      <ReaderSheetHost
                        isMobile={isMobile}
                        activeSheet={chromeState.activeReaderSheet}
                        onOpenSheet={chromeActions.openReaderSheet}
                        onCloseSheet={chromeActions.closeReaderSheet}
                        toolsTriggerRef={toolsTriggerRef}
                        book={book}
                        settings={sessionState.settings}
                        onUpdateSettings={sessionActions.updateSettings}
                        toc={book.toc}
                        chapterEntries={sessionState.chapters.entries}
                        chapterStartPages={
                          sessionState.navigation.chapterStartPages
                        }
                        currentChapterHref={currentChapterEntry?.href ?? ""}
                        onNavigateToHref={sessionActions.openTocHref}
                        notesPanel={notesPanel}
                        searchPanel={
                          <ReaderSearchPanel
                            search={search}
                            isOpen={searchOpen}
                            autoFocus={isMobile ? "when-empty" : "always"}
                            focusRequest={searchFocusRequest}
                            // The tools and, on a touch screen, the
                            // header and footer can cover the match.
                            onResultOpened={() => {
                              chromeActions.closeReaderSheet();
                              if (chromeInteractionMode === "touch")
                                hideChrome();
                            }}
                            className={isMobile ? undefined : "h-full"}
                          />
                        }
                        onCopyDebugDump={
                          debugEnabled
                            ? () => void handleCopyDebugDump()
                            : undefined
                        }
                      />
                    )}
                  </ReaderNotesPrototype>

                  {!isMobile && (
                    <HighlightToolbarContainer
                      bookId={bookId}
                      spineItemId={
                        activeHighlightData?.spineItemId ?? undefined
                      }
                      highlights={sessionState.highlights}
                      isCreatingHighlight={isCreatingHighlight}
                      creationPosition={creationPosition}
                      creationText={creationText}
                      activeHighlightCopyText={activeHighlightCopyText}
                      onCreateColorSelect={selectColor}
                      onCreateClose={closeCreation}
                      activeHighlight={
                        annotationState.kind === "active"
                          ? activeHighlight
                          : null
                      }
                      onEditClose={clearActiveHighlight}
                      onCreateNoteSubmit={undefined}
                      onAddSelectionNote={() => {
                        const note = captureSelectionNote();
                        if (!note) return;
                        setNoteQuote(highlightNoteTarget(note, false));
                        setCommentPosition({
                          top: creationPosition.y,
                          page: sessionState.navigation.currentPage,
                        });
                        closeCreation();
                        handleNotesActive(true);
                      }}
                      onAddHighlightNote={(highlight) => {
                        setCommentPosition({
                          top: activeHighlight?.position.y ?? 112,
                          page: sessionState.navigation.currentPage,
                        });
                        setNoteQuote(highlightNoteTarget(highlight, true));
                        clearActiveHighlight();
                        handleNotesActive(true);
                      }}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </ReaderController>
      </div>
    </div>
  );
}
