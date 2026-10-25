import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { HighlightToolbarContainer } from "@/features/reader/shared/HighlightToolbarContainer";
import { PAGE_PADDING_X, PAGE_PADDING_Y } from "./AnimatedSpread";
import { ReaderStateScreen } from "./ReaderStateScreen";
import { SpreadStage } from "./SpreadStage";
import { useReaderAnnotations } from "./hooks/use-reader-annotations";
import { useReaderHighlightActions } from "./hooks/use-reader-highlight-actions";
import { useReaderNavigationActions } from "./hooks/use-reader-navigation-actions";
import { useReaderCore } from "./hooks/use-reader-core";
import { useReaderViewport } from "./hooks/use-reader-viewport";
import { DebugSection } from "./shared/DebugSection";
import { DeferredEpubImageProvider } from "./shared/DeferredEpubImageProvider";
import { InspectorDrawer } from "./shared/InspectorDrawer";
import { InspectorPanel } from "./shared/InspectorPanel";
import { DEFAULT_PARAGRAPH_SPACING } from "@/lib/pagination-v2";
import { useToast } from "@/hooks/use-toast";
import {
  buildReaderPageDebugDump,
  collectReaderPageDebugDumpEnvironment,
  serializeReaderPageDebugDump,
  type ReaderPageDebugDump,
  type ReaderPageDebugDumpEnvironment,
} from "./debug/page-debug-dump";

export function ReaderDebug() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [paragraphSpacingFactor, setParagraphSpacingFactor] = useState(
    DEFAULT_PARAGRAPH_SPACING,
  );
  const [spreadColumns, setSpreadColumns] = useState<1 | 2 | 3>(1);
  const [columnSpacingPx, setColumnSpacingPx] = useState(16);
  const [loadedDump, setLoadedDump] = useState<ReaderPageDebugDump | null>(
    null,
  );
  const [measuredPreviewEnvironment, setMeasuredPreviewEnvironment] = useState<{
    key: string;
    environment: ReaderPageDebugDumpEnvironment;
  } | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const stageContentRef = useRef<HTMLDivElement>(null);
  const { createHighlight } = useReaderHighlightActions(bookId);

  const { viewport, setViewport, viewportAutoMode, setViewportAutoMode } =
    useReaderViewport({ isMobile, isPanelOpen });

  const {
    book,
    isBookLoading,
    settings,
    onUpdateSettings,
    chapterEntries,
    spreadConfig,
    paginationConfig,
    pagination,
    bookHighlights,
    sourceLoadWallClockMs,
    sourceLoadKind,
    currentPage,
    totalPages,
    currentChapterIndex,
    getChapterBlocks,
    getChapterCanonicalText,
  } = useReaderCore({
    bookId,
    viewport,
    spreadColumns,
    paragraphSpacingFactor,
  });

  const previewMeasureKey = loadedDump
    ? `dump-${loadedDump.capturedAt}`
    : [
        viewport.width,
        viewport.height,
        spreadConfig.columns,
        columnSpacingPx,
        settings.fontFamily,
        settings.fontSize,
        settings.lineHeight,
        settings.textAlign,
        settings.publisherBookStylingEnabled,
        paragraphSpacingFactor,
        pagination.spread?.currentPage ?? "none",
      ].join("-");
  const activeMeasuredEnvironment =
    measuredPreviewEnvironment?.key === previewMeasureKey
      ? measuredPreviewEnvironment.environment
      : undefined;

  const currentDump = useMemo(() => {
    if (!book || !pagination.spread) return null;

    return buildReaderPageDebugDump({
      book,
      settings,
      spread: pagination.spread,
      paginationConfig,
      spreadConfig,
      layout: {
        viewport,
        spreadColumns,
        columnGapPx: columnSpacingPx,
        paddingTopPx: PAGE_PADDING_Y,
        paddingBottomPx: PAGE_PADDING_Y,
        paddingLeftPx: PAGE_PADDING_X,
        paddingRightPx: PAGE_PADDING_X,
      },
      environment:
        !loadedDump && activeMeasuredEnvironment
          ? activeMeasuredEnvironment
          : collectReaderPageDebugDumpEnvironment({
              stageSlotElement: previewContainerRef.current,
              stageContentElement: stageContentRef.current,
            }),
      chapterEntries,
      getBlocks: getChapterBlocks,
    });
  }, [
    activeMeasuredEnvironment,
    book,
    chapterEntries,
    columnSpacingPx,
    getChapterBlocks,
    loadedDump,
    pagination.spread,
    paginationConfig,
    settings,
    spreadColumns,
    spreadConfig,
    viewport,
  ]);

  useLayoutEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const environment = collectReaderPageDebugDumpEnvironment({
        stageSlotElement: previewContainerRef.current,
        stageContentElement: stageContentRef.current,
      });

      if (environment) {
        setMeasuredPreviewEnvironment({
          key: previewMeasureKey,
          environment,
        });
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [previewMeasureKey]);

  const chapterAccess = useMemo(
    () => ({
      getBlocks: getChapterBlocks,
      getCanonicalText: getChapterCanonicalText,
    }),
    [getChapterBlocks, getChapterCanonicalText],
  );

  const navigationActions = useReaderNavigationActions({
    pagination,
    currentChapterIndex,
    chapterEntries,
  });

  const {
    state: annotationState,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight,
    creationPosition,
    creationText,
    selectColor,
    closeCreation,
    clearActiveHighlight,
  } = useReaderAnnotations({
    bookId,
    spread: pagination.spread,
    stageContentRef,
    chapterEntries,
    chapterAccess,
    fontConfig: paginationConfig.fontConfig,
    publisherBookStylingEnabled:
      paginationConfig.publisherBookStylingEnabled ?? false,
    highlights: bookHighlights,
    onCreateHighlight: createHighlight,
  });

  if (isBookLoading) {
    return <ReaderStateScreen showSpinner />;
  }

  if (!bookId || !book) {
    return (
      <ReaderStateScreen
        title="Book not found"
        action={{ label: "Back to Library", onClick: () => navigate("/") }}
      />
    );
  }

  const panelProps = {
    currentPage,
    totalPages,
    paginationStatus: pagination.status,
    onGoToPage: navigationActions.commitPage,
    onGoToChapterIndex: navigationActions.goToChapter,
    onNextSpread: navigationActions.nextSpread,
    onPrevSpread: navigationActions.prevSpread,
    chapterEntries,
    currentChapterIndex,
    settings,
    onUpdateSettings,
    viewport,
    onViewportChange: setViewport,
    viewportAutoMode,
    onViewportAutoModeChange: setViewportAutoMode,
    paragraphSpacingFactor,
    onParagraphSpacingFactorChange: setParagraphSpacingFactor,
    spreadColumns,
    onSpreadColumnsChange: setSpreadColumns,
    columnSpacingPx,
    onColumnSpacingPxChange: setColumnSpacingPx,
  };

  const previewKey = previewMeasureKey;
  const loadedDebugDump =
    loadedDump && activeMeasuredEnvironment
      ? { ...loadedDump, environment: activeMeasuredEnvironment }
      : loadedDump;
  const activeDebugDump = loadedDebugDump ?? currentDump;

  const debugSectionProps = {
    tracer: pagination.tracer,
    paginationStatus: pagination.status,
    totalPages,
    viewport,
    sourceLoadWallClockMs,
    sourceLoadKind,
    currentDump: activeDebugDump,
    loadedDump: loadedDebugDump,
    onCopyCurrentDump: async () => {
      if (!activeDebugDump) {
        toast({
          message: "Page is not ready to copy.",
          variant: "destructive" as const,
        });
        return;
      }

      try {
        await navigator.clipboard.writeText(
          serializeReaderPageDebugDump(activeDebugDump),
        );

        toast({
          message: "Copied debug dump.",
        });
      } catch {
        toast({
          message: "Could not copy debug dump.",
          variant: "destructive",
        });
      }
    },
    onLoadDump: (dump: ReaderPageDebugDump) => {
      setLoadedDump(dump);
      toast({
        message: "Loaded debug dump.",
      });
    },
    onClearLoadedDump: () => setLoadedDump(null),
  };
  const previewSpread = loadedDump?.renderedSpread ?? pagination.spread;
  const previewSpreadConfig = loadedDump?.spreadConfig ?? spreadConfig;
  const previewPaginationConfig =
    loadedDump?.paginationConfig ?? paginationConfig;
  const previewLayout = loadedDump?.layout ?? {
    viewport,
    spreadColumns,
    columnGapPx: columnSpacingPx,
    paddingTopPx: PAGE_PADDING_Y,
    paddingBottomPx: PAGE_PADDING_Y,
    paddingLeftPx: PAGE_PADDING_X,
    paddingRightPx: PAGE_PADDING_X,
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            onClick={() => navigate("/")}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </button>
          <p className="flex-1 truncate text-center text-sm font-medium italic">
            {book.title}
          </p>
          <button
            onClick={() => setIsPanelOpen((open) => !open)}
            className={cn(
              "rounded-lg p-2 text-muted-foreground transition-all duration-500 hover:bg-muted hover:text-foreground",
              isPanelOpen && "bg-muted text-foreground",
            )}
          >
            <SlidersHorizontal className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-r px-3">
            <div className="space-y-1 py-2">
              <DebugSection {...debugSectionProps} />
            </div>
          </aside>
        )}

        <main className="flex-1 overflow-auto">
          <div className="w-full overflow-x-auto px-4 pb-6 pt-6">
            <div
              key={previewKey}
              ref={previewContainerRef}
              className="reader-container-outline mx-auto overflow-hidden"
              style={{
                width: `${
                  previewLayout.viewport.width * previewSpreadConfig.columns +
                  previewLayout.columnGapPx *
                    (previewSpreadConfig.columns - 1) +
                  previewLayout.paddingLeftPx +
                  previewLayout.paddingRightPx
                }px`,
                height: `${
                  previewLayout.viewport.height +
                  previewLayout.paddingTopPx +
                  previewLayout.paddingBottomPx
                }px`,
              }}
            >
              <DeferredEpubImageProvider
                key={loadedDump?.book.id ?? bookId}
                bookId={loadedDump?.book.id ?? bookId}
              >
                <SpreadStage
                  spread={previewSpread}
                  spreadConfig={previewSpreadConfig}
                  columnSpacingPx={previewLayout.columnGapPx}
                  paginationConfig={previewPaginationConfig}
                  stageContentRef={stageContentRef}
                  showDebugOutlines
                  paddingTopPx={previewLayout.paddingTopPx}
                  paddingBottomPx={previewLayout.paddingBottomPx}
                  paddingLeftPx={previewLayout.paddingLeftPx}
                  paddingRightPx={previewLayout.paddingRightPx}
                />
              </DeferredEpubImageProvider>
            </div>
          </div>
        </main>

        {!isMobile && isPanelOpen && (
          <aside className="w-[320px] shrink-0 overflow-y-auto border-l px-3">
            <InspectorPanel {...panelProps} />
          </aside>
        )}
      </div>

      {isMobile && (
        <InspectorDrawer open={isPanelOpen} onOpenChange={setIsPanelOpen}>
          <InspectorPanel {...panelProps} />
          <div className="space-y-1 py-2">
            <DebugSection {...debugSectionProps} />
          </div>
        </InspectorDrawer>
      )}

      <div className={isMobile ? "fixed inset-x-0 bottom-4 z-50" : undefined}>
        <HighlightToolbarContainer
          placement={isMobile ? "island" : "floating"}
          bookId={bookId}
          spineItemId={activeHighlightData?.spineItemId ?? undefined}
          highlights={bookHighlights}
          isCreatingHighlight={isCreatingHighlight}
          creationPosition={creationPosition}
          creationText={creationText}
          onCreateColorSelect={selectColor}
          onCreateClose={closeCreation}
          activeHighlight={
            annotationState.kind === "active" ? activeHighlight : null
          }
          onEditClose={clearActiveHighlight}
          onCreateNoteSubmit={undefined}
        />
      </div>
    </div>
  );
}
