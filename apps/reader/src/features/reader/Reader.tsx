import { useDebugEnabled } from "@/lib/debug-preference";
import { HighlightToolbarContainer } from "@/features/reader/shared/HighlightToolbarContainer";
import { useInputBehavior } from "@/features/reader/hooks/use-input-behavior";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { isInteractiveTapTarget } from "./hooks/use-touch-spread-tap-nav";
import { highlightNoteTarget } from "./note-locations";
import type { NoteTarget } from "@/types/note";
import type { AnnotationColor } from "@/lib/highlight-constants";
import { ReaderNotes } from "./ReaderNotes";
import { ReaderController } from "./ReaderController";
import { ReaderHeader } from "./ReaderHeader";
import { ReaderSheetHost } from "./ReaderSheetHost";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage, type PageTurner } from "./SpreadStage";
import { PaperRow } from "./paper/PaperRow";
import { resolvePaper, usePaperPreference } from "./paper/paper-preference";
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
  DisplayReadyCommitProbe,
  useReaderPerformanceTraceLifecycle,
  useReaderPerformanceTraceRoute,
} from "./hooks/use-reader-performance-trace";
import { useReaderSession } from "./hooks/use-reader-session";
import { useReaderStatusPrompt } from "./hooks/use-reader-status-prompt";
import { copyReaderPageDebugDump } from "./debug/copy-page-debug-dump";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";
import { ReaderSearchPanel } from "./search/ReaderSearchPanel";
import { ReaderSearchStepper } from "./search/ReaderSearchStepper";
import { useReaderBookSearch } from "./search/use-reader-book-search";
import type { ReaderLocation } from "./reader-location";
import { ReadingLayoutRow } from "./scroll/ReadingLayoutRow";
import { ScrollStage } from "./scroll/ScrollStage";
import { useSelectAcross } from "./scroll/use-select-across";
import { useDetentSheetsEnabled } from "@/lib/detent-sheets-preference";
import { isReadingFontId } from "@/lib/reading-fonts";
import { useReaderScrollMode } from "./scroll/use-reader-scroll-mode";

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
  // Reading fonts for Design ideas: `?font=` lays the book out in a font
  // without saving it; Debug mode only.
  const fontParam = searchParams.get("font");
  const previewFontFamily =
    debugEnabled && isReadingFontId(fontParam) ? fontParam : null;
  // Paper for Design ideas and Debug: the curl, grain and show-through.
  const paper = resolvePaper(debugEnabled, usePaperPreference(), searchParams);
  // Set while the curl turns pages, so a tap turns the page the same way.
  const pageTurnerRef = useRef<PageTurner | null>(null);
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
  const detentSheets = useDetentSheetsEnabled();
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

  // Scroll mode's place in the book; pages mode leaves it null.
  const [scrollLocation, setScrollLocation] = useState<ReaderLocation | null>(
    null,
  );
  const {
    resources: sessionResources,
    state: sessionState,
    actions: sessionActions,
  } = useReaderSession({
    bookId,
    viewport: stageViewport,
    spreadColumns: resolvedSpreadColumns,
    layoutReady: isReaderStageMeasured,
    scrollLocation,
    previewFontFamily,
  });
  const resumeBackgroundLoad = sessionActions.resumeBackgroundLoad;
  const endHistoryGroup = sessionActions.endHistoryGroup;
  useEffect(() => {
    endHistoryGroup();
  }, [chromeState.activeReaderSheet, endHistoryGroup]);

  const { displayReady, settledPaintReady } = useReaderDisplayReadiness({
    bookId,
    contentReady: isReaderStageMeasured && sessionState.status === "ready",
    stageContentRef,
  });

  // The chapter column: a selection's visit across a page break for every
  // reader, and Scroll as a reading layout in Debug mode.
  const selectionHandedOver = useRef<() => void>(() => {});
  const scrollMode = useReaderScrollMode({
    bookId,
    layoutEnabled: true,
    pullEnabled: debugEnabled,
    touch: chromeInteractionMode === "touch",
    ready: displayReady,
    spread: sessionState.pagination.spread,
    spreadWindow: sessionState.pagination.spreadWindow,
    column: sessionState.pagination.scrollColumn,
    chapterEntries: sessionState.chapters.entries,
    chapterStartPages: sessionState.navigation.chapterStartPages,
    // The engine's count grows while the book paginates; the navigation
    // total would echo scroll mode's own report back.
    totalPages: sessionState.pagination.spread?.totalPages ?? 0,
    chapterAccess: sessionResources.chapterAccess,
    setScrollChapter: sessionActions.setScrollChapter,
    goToAnchor: sessionActions.goToAnchor,
    goToChapter: sessionActions.goToChapter,
    stageContentRef,
    onLocationChange: setScrollLocation,
    onSelectionHandedOver: () => selectionHandedOver.current(),
  });

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
    resolveSelectionRange,
    refreshSelection,
  } = useReaderAnnotations({
    bookId,
    // In scroll mode the column is the selectable surface.
    spread: scrollMode.selectionSpread ?? sessionState.pagination.spread,
    stageContentRef: scrollMode.annotationContainerRef,
    chapterEntries: sessionState.chapters.entries,
    fontConfig: sessionState.pagination.paginationConfig.fontConfig,
    publisherBookStylingEnabled:
      sessionState.pagination.paginationConfig.publisherBookStylingEnabled ??
      false,
    chapterAccess: sessionResources.chapterAccess,
    highlights: sessionState.highlights,
    onCreateHighlight: sessionActions.createHighlight,
  });

  // A page selection that a page break cuts can carry on across it.
  const selectAcross = useSelectAcross({
    enabled: chromeState.activeReaderSheet === null && displayReady,
    isMobile,
    scrollMode,
    stageContentRef,
    spread: sessionState.pagination.spread,
    chapterAccess: sessionResources.chapterAccess,
    fontConfig: sessionState.pagination.paginationConfig.fontConfig,
    publisherBookStylingEnabled:
      sessionState.pagination.paginationConfig.publisherBookStylingEnabled ??
      false,
    annotation: {
      kind: annotationState.kind,
      resolveSelectionRange,
      refreshSelection,
    },
    notesActive: noteViewportHeight !== null || noteComposerPresent,
  });
  selectionHandedOver.current = selectAcross.onSelectionHandedOver;

  const searchOpen = chromeState.activeReaderSheet === "search";
  // Search ideas for Design ideas, Debug mode only: `?search=` steps to the
  // nearest match and `?searchMarks=` picks how matches are marked.
  const searchMarks = debugEnabled ? searchParams.get("searchMarks") : null;
  const { search, focusRequest: searchFocusRequest } = useReaderBookSearch({
    bookId,
    session: {
      resources: sessionResources,
      state: sessionState,
      actions: sessionActions,
    },
    open: searchOpen,
    displayReady,
    settledPaintReady,
    idea: debugEnabled ? searchParams.get("search") : null,
    marks: {
      containerRef: scrollMode.annotationContainerRef,
      contentKey: scrollMode.renderedRows,
    },
    onOpen: () => chromeActions.openReaderSheet("search"),
  });
  const searchActiveIndex = search.state.activeIndex;

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
  // A highlight or note from a selection cut by a page break can also
  // cover the rest of its sentence.
  const highlightSelection = (color: AnnotationColor) => {
    selectAcross.keep();
    return selectColor(color);
  };
  const captureSelectionTarget = () => {
    selectAcross.keep();
    return captureSelectionNote();
  };
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
  const handleCopyDebugDump = () =>
    copyReaderPageDebugDump(
      {
        book,
        settings: sessionState.settings,
        spread: sessionState.pagination.spread,
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
        stageSlotElement: stageSlotRef.current,
        stageContentElement: stageContentRef.current,
        chapterEntries: sessionState.chapters.entries,
        getBlocks: sessionResources.chapterAccess.getBlocks,
      },
      toast,
    );

  return (
    // The Reader never scrolls as a whole: `overflow-clip`, unlike hidden,
    // makes no scroll container, so bringing a sliding header, a hidden
    // footer or a focused control into view can't shift the page.
    <div
      data-search-marks={searchMarks ?? undefined}
      className="relative h-dvh overflow-clip overscroll-none bg-background"
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
          onNextPage={() => {
            if (!pageTurnerRef.current?.("next")) sessionActions.nextSpread();
          }}
          onPrevPage={() => {
            if (!pageTurnerRef.current?.("previous"))
              sessionActions.prevSpread();
          }}
          canGoPrev={sessionState.navigation.canGoPrev}
          canGoNext={sessionState.navigation.canGoNext}
          chromeInteractionMode={chromeInteractionMode}
          isChromeSuppressed={isReaderInteractionSuppressed}
          scrollMode={scrollMode.scrollGestures}
          pull={scrollMode.pull}
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
            showChrome,
            hideChrome,
          }) => (
            <div
              className="relative h-dvh overflow-clip font-sans text-foreground"
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
                  // Scroll mode gives the vertical axis back to the browser.
                  touchAction: scrollMode.scrollGestures
                    ? "pan-y pinch-zoom"
                    : chromeInteractionMode === "touch"
                      ? "pinch-zoom"
                      : "auto",
                }}
              >
                <DeferredEpubImageProvider key={bookId} bookId={bookId}>
                  {scrollMode.showSpreadStage && (
                    <div
                      className="absolute inset-0"
                      style={{
                        // Over the column for a scrubber preview or a jump.
                        zIndex: scrollMode.spreadAboveStage ? 4 : undefined,
                        // Reopening in scroll mode: no page flash first.
                        visibility: scrollMode.hideSpreadStage
                          ? "hidden"
                          : undefined,
                      }}
                    >
                      <SpreadStage
                        spread={sessionState.pagination.spread}
                        previousSpread={
                          sessionState.pagination.spreadWindow?.previous
                        }
                        nextSpread={sessionState.pagination.spreadWindow?.next}
                        spreadConfig={sessionState.pagination.spreadConfig}
                        columnSpacingPx={columnGapPx}
                        paginationConfig={
                          sessionState.pagination.paginationConfig
                        }
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
                        pageTurn={paper.pageTurn}
                        paper={paper.grain}
                        ink={paper.ink}
                        marks={paper.marks}
                        grip={paper.grip}
                        bookBlock={paper.bookBlock}
                        showThrough={paper.showThrough}
                        haptics={paper.haptics}
                        sound={paper.sound}
                        turnRef={pageTurnerRef}
                        paddingTopPx={stagePadding.paddingTop}
                        paddingBottomPx={stagePadding.paddingBottom}
                        paddingLeftPx={stagePadding.paddingX}
                        paddingRightPx={stagePadding.paddingX}
                      />
                    </div>
                  )}
                  {scrollMode.stage && (
                    <ScrollStage
                      key={scrollMode.stageKey}
                      {...scrollMode.stage}
                      baseFontSize={
                        sessionState.pagination.paginationConfig.fontConfig
                          .baseSizePx
                      }
                      bodyLineHeight={Math.round(
                        sessionState.pagination.paginationConfig.layoutTheme
                          .baseFontSizePx *
                          sessionState.pagination.paginationConfig.layoutTheme
                            .lineHeightFactor,
                      )}
                      paddingTopPx={stagePadding.paddingTop}
                      paddingLeftPx={stagePadding.paddingX}
                      paddingRightPx={stagePadding.paddingX}
                      onScrollDirection={(direction) => {
                        if (direction === "down") hideChrome();
                        else showChrome();
                      }}
                      onSnapStart={hideChrome}
                      onLinkActivate={sessionActions.openInternalHref}
                      // A phone's header and footer cover the stage's
                      // soft edges while they show.
                      chromeVisible={
                        isMobile && noteViewportHeight === null && chromeVisible
                      }
                    />
                  )}
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
                    onPreview={sessionActions.previewHistoryVisit}
                    onRestore={sessionActions.restoreHistoryVisit}
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
                progressLabel={
                  scrollMode.progressLabel && (
                    <p
                      data-testid="reader-scroll-progress"
                      className="-mt-0.5 pb-1 text-center text-[9px] font-numeric font-medium uppercase tracking-[0.14em] text-muted-foreground/80 tabular-nums"
                    >
                      {scrollMode.progressLabel}
                    </p>
                  )
                }
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
                        // The same Notebook as Reader tools → Notebook.
                        if (detentSheets) {
                          chromeActions.openReaderSheet("notes");
                          return;
                        }
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
                  {selectAcross.overlay}
                  <ReaderNotes
                    key={bookId}
                    bookId={bookId}
                    mobileAnnotation={
                      isMobile &&
                      ((isCreatingHighlight && !selectAcross.handingOver) ||
                        activeHighlightData)
                        ? {
                            identity: annotationState,
                            dock: selectAcross.islandDock,
                            highlightId: activeHighlightData?.id,
                            copyText: activeHighlightData
                              ? activeHighlightCopyText
                              : creationText,
                            tools: (
                              <HighlightToolbarContainer
                                placement="island"
                                bookId={bookId}
                                highlights={sessionState.highlights}
                                isCreatingHighlight={isCreatingHighlight}
                                creationPosition={creationPosition}
                                creationText={creationText}
                                onCreateColorSelect={(color) => {
                                  const highlight = highlightSelection(color);
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
                                activeHighlightData ?? captureSelectionTarget();
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
                    pagination={
                      // Notes capture and place against what the view shows.
                      scrollMode.viewSpread
                        ? {
                            ...sessionState.pagination,
                            spread: scrollMode.viewSpread,
                          }
                        : sessionState.pagination
                    }
                    locateAnchors={sessionResources.locateAnchors}
                    open={
                      noteViewportHeight !== null ||
                      chromeState.activeReaderSheet === "notes"
                    }
                    currentChapterIndex={
                      sessionState.navigation.currentChapterIndex
                    }
                    location={{
                      page:
                        scrollMode.visiblePages?.first ??
                        sessionState.navigation.currentPage,
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
                      // Scroll mode centres one page-wide column, so a spread
                      // layout leaves it the wider margins.
                      width:
                        scrollMode.mode === "scroll"
                          ? stagePadding.paddingX +
                            ((resolvedSpreadColumns - 1) *
                              (stageViewport.width + columnGapPx)) /
                              2
                          : stagePadding.paddingX,
                      enabled: !isMobile && !isReaderInteractionSuppressed,
                      // In scroll mode notes move with their passages.
                      follow: scrollMode.mode === "scroll",
                      location: {
                        page:
                          scrollMode.visiblePages?.last ??
                          Math.min(
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
                        layoutControl={
                          <>
                            <ReadingLayoutRow
                              value={scrollMode.preferredMode}
                              disabled={scrollMode.switchDisabled}
                              onChange={(next) => {
                                // The sheet closes while the layout changes
                                // behind it.
                                chromeActions.closeReaderSheet();
                                scrollMode.setMode(next);
                              }}
                            />
                            {debugEnabled && <PaperRow />}
                          </>
                        }
                      />
                    )}
                  </ReaderNotes>

                  {!isMobile && (
                    <HighlightToolbarContainer
                      placement="floating"
                      bookId={bookId}
                      highlights={sessionState.highlights}
                      isCreatingHighlight={
                        isCreatingHighlight && !selectAcross.handingOver
                      }
                      creationPosition={creationPosition}
                      creationText={creationText}
                      activeHighlightCopyText={activeHighlightCopyText}
                      onCreateColorSelect={highlightSelection}
                      onCreateClose={closeCreation}
                      activeHighlight={
                        annotationState.kind === "active"
                          ? activeHighlight
                          : null
                      }
                      onEditClose={clearActiveHighlight}
                      onCreateNoteSubmit={undefined}
                      onAddSelectionNote={() => {
                        const note = captureSelectionTarget();
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
