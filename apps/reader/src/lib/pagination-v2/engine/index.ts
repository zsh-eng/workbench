// Engine orchestrator: owns pagination state, creates stepwise pagination jobs,
// and delegates anchor/spread calculations to the engine helper modules.
import type {
  ChapterUnavailableEvent,
  ErrorEvent,
  GoToTextOffsetCommand,
  LocateTextOffsetsCommand,
  TextOffsetLocation,
  PageContentEvent,
  PageUnavailableEvent,
  PaginationCommand,
  PartialReadyEvent,
  ProgressEvent,
  ReadyEvent,
} from "../protocol";
import { layoutPages } from "../shared/layout-pages";
import { prepareBlocks } from "../shared/prepare-blocks";
import type {
  Block,
  Page,
  PaginationChapterDiagnostics,
  PreparedBlock,
} from "../shared/types";
import { areFontConfigsEqual } from "../shared/types";
import type {
  ContentAnchor,
  PaginationConfig,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpreadConfig,
  SpreadIntent,
} from "../types";
import { DEFAULT_SPREAD_CONFIG } from "../types";
import {
  pickAnchorForPage,
  resolveAnchorToGlobalPage,
  resolveAnchorToPage,
  resolveTargetToAnchor,
  resolveHighlightToAnchor,
} from "./anchors";
import { createCanonicalOffsetLocator } from "./highlight-selection";
import {
  buildResolvedSpreadWindow,
  countTotalSpreads,
  resolveAnchorForSpreadIndex,
  resolveCurrentSpreadIndex,
} from "./spreads";

/** Text offsets placed between yields, so a page turn can run between. */
const LOCATE_OFFSETS_PER_STEP = 32;

export type EnginePaginationEvent =
  | {
      type: "anchorsLocated";
      scope: string;
      requestId: number;
      pages: Record<string, number | null>;
    }
  | {
      type: "textOffsetsLocated";
      scope: string;
      requestId: number;
      locations: Record<string, TextOffsetLocation | null>;
    }
  | Omit<PartialReadyEvent, "epoch">
  | Omit<ReadyEvent, "epoch">
  | Omit<ProgressEvent, "epoch">
  | Omit<PageContentEvent, "epoch">
  | Omit<PageUnavailableEvent, "epoch">
  | Omit<ChapterUnavailableEvent, "epoch">
  | ErrorEvent;

export type PaginationEngineWork = Generator<void, void, void>;

interface RelayoutPlan {
  order: number[];
  relayoutChapter: (
    chapterIndex: number,
  ) => PaginationChapterDiagnostics | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const REPLACE_INTENT: SpreadIntent = { kind: "replace" };

function resolveInitialChapterPageIndex(
  pageCount: number,
  chapterProgress: number | undefined,
): number {
  if (pageCount <= 1 || chapterProgress === undefined) return 0;
  if (!Number.isFinite(chapterProgress)) return 0;

  const clampedProgress = clamp(chapterProgress, 0, 100);
  return Math.round((clampedProgress / 100) * (pageCount - 1));
}

function resolveIntent(command: PaginationCommand): SpreadIntent {
  switch (command.type) {
    case "init":
      return command.intent ?? REPLACE_INTENT;
    case "nextSpread":
    case "prevSpread":
    case "goToPage":
    case "goToAnchor":
    case "goToChapter":
    case "goToTarget":
    case "goToTextOffset":
      return command.intent;
    case "locateAnchors":
    case "locateTextOffsets":
    case "addChapter":
    case "updateChapter":
    case "updatePaginationConfig":
    case "updateSpreadConfig":
      return REPLACE_INTENT;
  }
}

export class PaginationEngine {
  private emit: (event: EnginePaginationEvent) => void;

  private paginationConfig!: PaginationConfig;
  private spreadConfig: SpreadConfig = DEFAULT_SPREAD_CONFIG;

  private totalChapters = 0;
  private initialChapterIndex = 0;

  private blocksByChapter: (Block[] | null)[] = [];
  private preparedByChapter: (PreparedBlock[] | null)[] = [];
  private pagesByChapter: (Page[] | null)[] = [];
  private chapterDiagnosticsByChapter: (PaginationChapterDiagnostics | null)[] =
    [];

  /** Always non-null after init(). Updated only by navigation commands. */
  private anchor!: ContentAnchor;
  /** Keeps the current anchor in the same visible slot across 2-up reprojections. */
  private preferredAnchorSlotIndex: number | null = null;

  constructor(emit: (event: EnginePaginationEvent) => void) {
    this.emit = emit;
  }

  get receivedChapters(): number {
    return this.blocksByChapter.reduce(
      (count, blocks) => count + (blocks === null ? 0 : 1),
      0,
    );
  }

  createWork(cmd: PaginationCommand): PaginationEngineWork {
    const intent = resolveIntent(cmd);

    switch (cmd.type) {
      case "init":
        return this.runOneStepWork(intent, () => {
          this.init(
            intent,
            cmd.totalChapters,
            cmd.paginationConfig,
            cmd.spreadConfig,
            cmd.initialChapterIndex,
            cmd.initialChapterProgress,
            cmd.initialAnchor,
            cmd.firstChapterBlocks,
            cmd.initialHighlightId,
          );
        });
      case "addChapter":
        return this.runOneStepWork(intent, () => {
          this.addChapter(intent, cmd.chapterIndex, cmd.blocks);
        });
      case "updateChapter":
        return this.runUpdateChapterWork(intent, cmd.chapterIndex, cmd.blocks);
      case "updatePaginationConfig":
        return this.runUpdatePaginationConfigWork(intent, cmd.paginationConfig);
      case "updateSpreadConfig":
        return this.runOneStepWork(intent, () => {
          this.updateSpreadConfig(intent, cmd.spreadConfig);
        });
      case "nextSpread":
        return this.runOneStepWork(intent, () => {
          this.nextSpread(intent);
        });
      case "prevSpread":
        return this.runOneStepWork(intent, () => {
          this.prevSpread(intent);
        });
      case "goToPage":
        return this.runOneStepWork(intent, () => {
          this.goToPage(intent, cmd.page);
        });
      case "goToAnchor":
        return this.runOneStepWork(intent, () => {
          this.goToAnchor(intent, cmd.anchor);
        });
      case "goToChapter":
        return this.runOneStepWork(intent, () => {
          this.goToChapter(intent, cmd.chapterIndex);
        });
      case "locateAnchors":
        return this.runOneStepWork(intent, () => {
          const pages = Object.fromEntries(
            cmd.anchors.map(({ id, anchor }) => [
              id,
              resolveAnchorToGlobalPage(
                this.pagesByChapter,
                this.chapterPageOffsets,
                anchor,
              ),
            ]),
          );
          this.emit({
            type: "anchorsLocated",
            scope: cmd.scope,
            requestId: cmd.requestId,
            pages,
          });
        });
      case "locateTextOffsets":
        return this.runLocateTextOffsetsWork(intent, cmd);
      case "goToTextOffset":
        return this.runOneStepWork(intent, () => {
          this.goToTextOffset(intent, cmd);
        });
      case "goToTarget":
        return this.runOneStepWork(intent, () => {
          this.goToTarget(
            intent,
            cmd.chapterIndex,
            cmd.targetId,
            cmd.targetKind,
          );
        });
    }
  }

  /** A few offsets per step, so a page turn never waits on a long chapter. */
  private *runLocateTextOffsetsWork(
    intent: SpreadIntent,
    cmd: LocateTextOffsetsCommand,
  ): PaginationEngineWork {
    const locations: Record<string, TextOffsetLocation | null> = {};
    try {
      for (const chapter of cmd.chapters) {
        const chapterBlocks = this.blocksByChapter[chapter.chapterIndex];
        const preparedChapter = this.preparedByChapter[chapter.chapterIndex];
        const locate =
          chapterBlocks && preparedChapter
            ? createCanonicalOffsetLocator({
                chapterIndex: chapter.chapterIndex,
                chapterBlocks,
                preparedChapter,
                blockStarts: new Map(chapter.blockStarts),
              })
            : null;
        for (const [index, { id, offset }] of chapter.offsets.entries()) {
          if (index > 0 && index % LOCATE_OFFSETS_PER_STEP === 0) yield;
          const anchor = locate?.(offset) ?? null;
          const resolved = anchor
            ? resolveAnchorToPage(this.pagesByChapter, anchor)
            : null;
          locations[id] = anchor
            ? {
                anchor,
                page: resolved
                  ? (this.chapterPageOffsets[resolved.chapterIndex] ?? 0) +
                    resolved.localPageIndex +
                    1
                  : null,
                pageInChapter: resolved ? resolved.localPageIndex + 1 : null,
              }
            : null;
        }
        yield;
      }
    } catch (err) {
      this.emitException(intent, err);
      return;
    }
    this.emit({
      type: "textOffsetsLocated",
      scope: cmd.scope,
      requestId: cmd.requestId,
      locations,
    });
  }

  private *runOneStepWork(
    intent: SpreadIntent,
    run: () => void,
  ): PaginationEngineWork {
    try {
      run();
    } catch (err) {
      this.emitException(intent, err);
    }

    yield* [];
  }

  init(
    intent: SpreadIntent,
    totalChapters: number,
    paginationConfig: PaginationConfig,
    spreadConfig: SpreadConfig,
    initialChapterIndex: number,
    initialChapterProgress: number | undefined,
    initialAnchor: ContentAnchor | undefined,
    firstChapterBlocks: Block[],
    initialHighlightId?: string,
  ): void {
    this.paginationConfig = paginationConfig;
    this.spreadConfig = spreadConfig;

    this.totalChapters = Math.max(1, totalChapters);
    this.initialChapterIndex = clamp(
      initialChapterIndex,
      0,
      this.totalChapters - 1,
    );

    this.blocksByChapter = Array.from<Block[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.preparedByChapter = Array.from<PreparedBlock[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.pagesByChapter = Array.from<Page[] | null>({
      length: this.totalChapters,
    }).fill(null);
    this.chapterDiagnosticsByChapter =
      Array.from<PaginationChapterDiagnostics | null>({
        length: this.totalChapters,
      }).fill(null);

    this.blocksByChapter[this.initialChapterIndex] = firstChapterBlocks;

    const diagnostics = this.prepareAndLayoutChapter(this.initialChapterIndex);

    // Resolve explicit opening targets before the first spread is emitted.
    if (initialHighlightId) {
      initialAnchor =
        resolveHighlightToAnchor(
          this.preparedByChapter[this.initialChapterIndex] ?? [],
          this.initialChapterIndex,
          initialHighlightId,
        ) ?? undefined;
    }
    if (initialAnchor) {
      const resolved = resolveAnchorToPage(this.pagesByChapter, initialAnchor);
      this.anchor = resolved
        ? initialAnchor
        : pickAnchorForPage(this.pagesByChapter, this.initialChapterIndex, 0);
    } else {
      const initialChapterPages =
        this.pagesByChapter[this.initialChapterIndex] ?? [];
      const initialPageIndex = resolveInitialChapterPageIndex(
        initialChapterPages.length,
        initialChapterProgress,
      );
      this.anchor = pickAnchorForPage(
        this.pagesByChapter,
        this.initialChapterIndex,
        initialPageIndex,
      );
    }
    // A restored content location starts the spread; later chapter arrivals
    // retain that slot instead of changing spread parity around the anchor.
    this.preferredAnchorSlotIndex = initialAnchor ? 0 : null;

    const spreadWindow = this.buildResolvedSpreadWindow(intent);
    if (!spreadWindow) {
      this.emit({
        type: "error",
        intent,
        message: "Failed to build initial spread after init",
      });
      return;
    }
    const spread = spreadWindow.current;
    this.capturePreferredAnchorSlot(spread);

    if (this.totalChapters === 1) {
      this.emit({
        type: "ready",
        intent,
        spread,
        anchor: this.anchor,
        previousSpread: spreadWindow.previous,
        nextSpread: spreadWindow.next,
        chapterDiagnostics: diagnostics ? [diagnostics] : [],
      });
    } else {
      this.emit({
        type: "partialReady",
        intent,
        spread,
        anchor: this.anchor,
        previousSpread: spreadWindow.previous,
        nextSpread: spreadWindow.next,
        chapterDiagnostics: diagnostics,
      });
    }
  }

  addChapter(
    intent: SpreadIntent,
    chapterIndex: number,
    blocks: Block[],
  ): void {
    if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
      this.emit({
        type: "error",
        intent,
        message: `addChapter: index ${chapterIndex} out of bounds`,
      });
      return;
    }

    if (this.blocksByChapter[chapterIndex] !== null) return;

    this.blocksByChapter[chapterIndex] = blocks;
    const diagnostics = this.prepareAndLayoutChapter(chapterIndex);
    const spreadWindow = this.buildResolvedSpreadWindow(intent);
    if (spreadWindow) {
      this.capturePreferredAnchorSlot(spreadWindow.current);
    }

    if (this.receivedChapters === this.totalChapters) {
      if (!spreadWindow) return;

      this.emit({
        type: "ready",
        intent,
        spread: spreadWindow.current,
        anchor: this.anchor,
        previousSpread: spreadWindow.previous,
        nextSpread: spreadWindow.next,
        chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
          (diag): diag is PaginationChapterDiagnostics => diag !== null,
        ),
      });
      return;
    }

    if (
      spreadWindow &&
      this.spreadContainsChapter(spreadWindow.current, chapterIndex)
    ) {
      this.emit({
        type: "partialReady",
        intent,
        spread: spreadWindow.current,
        anchor: this.anchor,
        previousSpread: spreadWindow.previous,
        nextSpread: spreadWindow.next,
        chapterDiagnostics: diagnostics,
      });
      return;
    }

    this.emit({
      type: "progress",
      intent,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      currentPage: spreadWindow?.current.currentPage ?? 1,
      totalPages: spreadWindow?.current.totalPages ?? this.totalPages,
      currentSpread: spreadWindow?.current.currentSpread ?? 1,
      totalSpreads: spreadWindow?.current.totalSpreads ?? this.totalSpreads,
      chapterDiagnostics: diagnostics,
    });
  }

  private *runUpdateChapterWork(
    intent: SpreadIntent,
    chapterIndex: number,
    blocks: Block[],
  ): PaginationEngineWork {
    yield* this.runDeferredRelayoutWork(intent, () => {
      if (chapterIndex < 0 || chapterIndex >= this.totalChapters) {
        this.emitErrorMessage(
          intent,
          `updateChapter: index ${chapterIndex} out of bounds`,
        );
        return null;
      }

      if (this.blocksByChapter[chapterIndex] === null) {
        this.emitErrorMessage(
          intent,
          `updateChapter: chapter ${chapterIndex} has not been loaded yet`,
        );
        return null;
      }

      this.blocksByChapter[chapterIndex] = blocks;

      return {
        order: [chapterIndex],
        relayoutChapter: (chapter) => {
          if (!this.blocksByChapter[chapter]) return null;
          return this.prepareAndLayoutChapter(chapter);
        },
      };
    });
  }

  private *runUpdatePaginationConfigWork(
    intent: SpreadIntent,
    nextConfig: PaginationConfig,
  ): PaginationEngineWork {
    yield* this.runDeferredRelayoutWork(intent, () => {
      if (this.totalChapters === 0) {
        this.paginationConfig = nextConfig;
        return null;
      }

      if (
        this.arePaginationConfigsEqual(this.paginationConfig, nextConfig) &&
        this.hasPreparedForLoadedChapters()
      ) {
        this.paginationConfig = nextConfig;
        // The main thread flips into "recalculating" before the worker decides
        // whether this config update is actually a no-op. Emit a ready event so
        // consumers like the footer never get stranded in a visual loading state
        // after a semantically identical config update.
        this.emitReady(intent);
        return null;
      }

      const fontChanged =
        !areFontConfigsEqual(
          this.paginationConfig.fontConfig,
          nextConfig.fontConfig,
        ) ||
        (this.paginationConfig.publisherBookStylingEnabled ?? false) !==
          (nextConfig.publisherBookStylingEnabled ?? false);
      this.paginationConfig = nextConfig;

      if (this.receivedChapters === 0) return null;

      if (fontChanged) {
        for (
          let chapterIndex = 0;
          chapterIndex < this.totalChapters;
          chapterIndex++
        ) {
          if (!this.blocksByChapter[chapterIndex]) continue;
          this.preparedByChapter[chapterIndex] = null;
        }
      }

      return {
        order: this.buildMiddleOutOrder(this.anchor.chapterIndex),
        relayoutChapter: (chapterIndex) => {
          if (!this.blocksByChapter[chapterIndex]) return null;

          const prepared = this.preparedByChapter[chapterIndex];
          if (!prepared) {
            return this.prepareAndLayoutChapter(chapterIndex);
          }

          const stage2PrepareMs =
            this.chapterDiagnosticsByChapter[chapterIndex]?.stage2PrepareMs ??
            0;
          return this.layoutPreparedChapter(
            chapterIndex,
            prepared,
            stage2PrepareMs,
          );
        },
      };
    });
  }

  private *runDeferredRelayoutWork(
    intent: SpreadIntent,
    createPlan: () => RelayoutPlan | null,
  ): PaginationEngineWork {
    // Relayout commands may wait in the worker while higher-priority navigation
    // runs. Defer validation and plan construction until the first step so the
    // plan reflects the engine state at execution time, not enqueue time.
    try {
      const plan = createPlan();
      if (!plan) return;

      yield* this.runRelayoutWork(intent, plan);
    } catch (err) {
      this.emitException(intent, err);
    }
  }

  private *runRelayoutWork(
    intent: SpreadIntent,
    plan: RelayoutPlan,
  ): PaginationEngineWork {
    // Each yield is a scheduler-visible boundary. A single advance still owns
    // one chapter's synchronous prepare/layout work, matching the old step job.
    for (const chapterIndex of plan.order) {
      if (chapterIndex === undefined) continue;

      const diagnostics = plan.relayoutChapter(chapterIndex);
      if (!diagnostics) continue;

      this.emitRelayoutProgress(intent, chapterIndex, diagnostics);
      yield;
    }

    this.emitReady(intent);
  }

  updateSpreadConfig(
    intent: SpreadIntent,
    nextSpreadConfig: SpreadConfig,
  ): void {
    if (this.areSpreadConfigsEqual(this.spreadConfig, nextSpreadConfig)) return;
    this.spreadConfig = nextSpreadConfig;
    this.preferredAnchorSlotIndex = null;
    if (this.receivedChapters === 0) return;

    this.emitPageContent(intent);
  }

  nextSpread(intent: SpreadIntent): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(intent);
      return;
    }

    if (!this.setAnchorFromSpreadIndexForLinearTurn(currentSpreadIndex + 1)) {
      this.emitPageUnavailable(intent);
      return;
    }

    this.emitPageContent(intent);
  }

  prevSpread(intent: SpreadIntent): void {
    const currentSpreadIndex = this.resolveCurrentSpreadIndex();
    if (currentSpreadIndex === null) {
      this.emitPageUnavailable(intent);
      return;
    }

    if (!this.setAnchorFromSpreadIndexForLinearTurn(currentSpreadIndex - 1)) {
      this.emitPageUnavailable(intent);
      return;
    }

    this.emitPageContent(intent);
  }

  goToPage(intent: SpreadIntent, globalPage: number): void {
    const pageIndex = Math.max(1, Math.floor(globalPage)) - 1;

    for (
      let chapterIndex = this.chapterPageOffsets.length - 1;
      chapterIndex >= 0;
      chapterIndex--
    ) {
      const offset = this.chapterPageOffsets[chapterIndex];
      if (offset === undefined || pageIndex < offset) continue;

      const localIndex = pageIndex - offset;
      const pages = this.pagesByChapter[chapterIndex];
      if (!pages || localIndex >= pages.length) continue;

      this.preferredAnchorSlotIndex = null;
      this.anchor = pickAnchorForPage(
        this.pagesByChapter,
        chapterIndex,
        localIndex,
      );
      this.emitPageContent(intent);
      return;
    }

    this.emitPageUnavailable(intent);
  }

  goToAnchor(intent: SpreadIntent, anchor: ContentAnchor): void {
    const pages = this.pagesByChapter[anchor.chapterIndex];
    if (
      !pages?.some((page) =>
        page.slices.some((slice) => slice.blockId === anchor.blockId),
      )
    ) {
      this.emitPageUnavailable(intent);
      return;
    }
    this.preferredAnchorSlotIndex = 0;
    this.anchor = anchor;
    this.emitPageContent(intent);
  }

  goToTextOffset(intent: SpreadIntent, cmd: GoToTextOffsetCommand): void {
    const chapterBlocks = this.blocksByChapter[cmd.chapterIndex];
    const preparedChapter = this.preparedByChapter[cmd.chapterIndex];
    const anchor =
      chapterBlocks && preparedChapter && this.pagesByChapter[cmd.chapterIndex]
        ? createCanonicalOffsetLocator({
            chapterIndex: cmd.chapterIndex,
            chapterBlocks,
            preparedChapter,
            blockStarts: new Map(cmd.blockStarts),
          })(cmd.offset)
        : null;
    if (!anchor) {
      this.emitPageUnavailable(intent);
      return;
    }
    // The page falls where it would when reading, not at the spread's start.
    this.preferredAnchorSlotIndex = null;
    this.anchor = anchor;
    this.emitPageContent(intent);
  }

  goToChapter(intent: SpreadIntent, chapterIndex: number): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    this.preferredAnchorSlotIndex = null;
    this.anchor = pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(intent);
  }

  goToTarget(
    intent: SpreadIntent,
    chapterIndex: number,
    targetId: string,
    targetKind: "element" | "highlight" = "element",
  ): void {
    const chapter = Math.floor(chapterIndex);
    if (chapter < 0 || chapter >= this.totalChapters) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    const pages = this.pagesByChapter[chapter];
    if (!pages || pages.length === 0) {
      this.emitChapterUnavailable(intent, chapter);
      return;
    }

    this.preferredAnchorSlotIndex = null;
    this.anchor =
      (targetKind === "highlight"
        ? resolveHighlightToAnchor(
            this.preparedByChapter[chapter] ?? [],
            chapter,
            targetId,
          )
        : resolveTargetToAnchor(this.preparedByChapter, chapter, targetId)) ??
      pickAnchorForPage(this.pagesByChapter, chapter, 0);
    this.emitPageContent(intent);
  }

  private emitRelayoutProgress(
    intent: SpreadIntent,
    chapterIndex: number,
    diagnostics: PaginationChapterDiagnostics,
  ): void {
    const spreadWindow = this.buildResolvedSpreadWindow(intent);
    if (spreadWindow) {
      this.capturePreferredAnchorSlot(spreadWindow.current);
    }
    const spread = spreadWindow?.current;
    const currentPage = spread?.currentPage ?? 1;
    const totalPages = spread?.totalPages ?? this.totalPages;
    const currentSpread = spread?.currentSpread ?? 1;
    const totalSpreads = spread?.totalSpreads ?? this.totalSpreads;

    if (spread && this.spreadContainsChapter(spread, chapterIndex)) {
      this.emit({
        type: "partialReady",
        intent,
        spread,
        anchor: this.anchor,
        previousSpread: spreadWindow.previous,
        nextSpread: spreadWindow.next,
        chapterDiagnostics: diagnostics,
      });
      return;
    }

    this.emit({
      type: "progress",
      intent,
      chaptersCompleted: this.receivedChapters,
      totalChapters: this.totalChapters,
      currentPage,
      totalPages,
      currentSpread,
      totalSpreads,
      chapterDiagnostics: diagnostics,
    });
  }

  private emitReady(intent: SpreadIntent): void {
    const spreadWindow = this.buildResolvedSpreadWindow(intent);
    if (!spreadWindow) return;
    this.capturePreferredAnchorSlot(spreadWindow.current);

    this.emit({
      type: "ready",
      intent,
      spread: spreadWindow.current,
      anchor: this.anchor,
      previousSpread: spreadWindow.previous,
      nextSpread: spreadWindow.next,
      chapterDiagnostics: this.chapterDiagnosticsByChapter.filter(
        (diag): diag is PaginationChapterDiagnostics => diag !== null,
      ),
    });
  }

  private prepareAndLayoutChapter(
    chapterIndex: number,
  ): PaginationChapterDiagnostics | null {
    const blocks = this.blocksByChapter[chapterIndex];
    if (!blocks) return null;

    const stage2StartedAt = performance.now();
    const prepared = prepareBlocks(blocks, this.paginationConfig.fontConfig, {
      publisherBookStylingEnabled:
        this.paginationConfig.publisherBookStylingEnabled ?? false,
    });
    const stage2PrepareMs = performance.now() - stage2StartedAt;
    this.preparedByChapter[chapterIndex] = prepared;

    return this.layoutPreparedChapter(chapterIndex, prepared, stage2PrepareMs);
  }

  private layoutPreparedChapter(
    chapterIndex: number,
    prepared: PreparedBlock[],
    stage2PrepareMs: number,
  ): PaginationChapterDiagnostics {
    const { viewport, layoutTheme } = this.paginationConfig;
    const result = layoutPages(
      prepared,
      viewport.width,
      viewport.height,
      layoutTheme,
    );
    this.pagesByChapter[chapterIndex] = result.pages;

    const diagnostics: PaginationChapterDiagnostics = {
      chapterIndex,
      blockCount: result.diagnostics.blockCount,
      lineCount: result.diagnostics.lineCount,
      pageCount: result.pages.length,
      stage2PrepareMs,
      stage3LayoutMs: result.diagnostics.computeMs,
      totalMs: stage2PrepareMs + result.diagnostics.computeMs,
    };
    this.chapterDiagnosticsByChapter[chapterIndex] = diagnostics;
    return diagnostics;
  }

  private get chapterPageOffsets(): number[] {
    const offsets: number[] = [];
    let running = 0;
    for (let i = 0; i < this.totalChapters; i++) {
      offsets[i] = running;
      running += this.pagesByChapter[i]?.length ?? 0;
    }
    return offsets;
  }

  private get totalPages(): number {
    let total = 0;
    for (const pages of this.pagesByChapter) {
      total += pages?.length ?? 0;
    }
    return Math.max(1, total);
  }

  private get totalSpreads(): number {
    return countTotalSpreads({
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      leadingGapSlots: this.getLeadingGapSlots(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
  }

  private buildResolvedSpreadWindow(
    intent: SpreadIntent,
  ): ResolvedSpreadWindow | null {
    return buildResolvedSpreadWindow(intent, this.buildResolvedSpreadState());
  }

  private buildResolvedSpreadState() {
    return {
      anchor: this.anchor,
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      leadingGapSlots: this.getLeadingGapSlots(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
      totalPages: this.totalPages,
    };
  }

  private resolveCurrentSpreadIndex(): number | null {
    return resolveCurrentSpreadIndex(this.buildResolvedSpreadState());
  }

  private setAnchorFromSpreadIndex(spreadIndex: number): boolean {
    const anchor = resolveAnchorForSpreadIndex(spreadIndex, {
      chapterPageOffsets: this.chapterPageOffsets,
      isFullyLoaded: this.isFullyLoaded(),
      leadingGapSlots: this.getLeadingGapSlots(),
      pagesByChapter: this.pagesByChapter,
      spreadConfig: this.spreadConfig,
      totalChapters: this.totalChapters,
    });
    if (!anchor) return false;

    this.anchor = anchor;
    return true;
  }

  private setAnchorFromSpreadIndexForLinearTurn(spreadIndex: number): boolean {
    const previousPreferredSlotIndex = this.preferredAnchorSlotIndex;

    // Spread turns should move by the canonical spread width. Slot preservation is
    // reserved for relayout/reprojection so a right-hand anchor does not overlap.
    this.preferredAnchorSlotIndex = null;
    if (this.setAnchorFromSpreadIndex(spreadIndex)) return true;

    this.preferredAnchorSlotIndex = previousPreferredSlotIndex;
    return false;
  }

  private isFullyLoaded(): boolean {
    return this.receivedChapters === this.totalChapters;
  }

  private emitPageContent(intent: SpreadIntent): void {
    const spreadWindow = this.buildResolvedSpreadWindow(intent);
    if (!spreadWindow) {
      this.emitPageUnavailable(intent);
      return;
    }
    const spread = spreadWindow.current;
    this.capturePreferredAnchorSlot(spread);
    this.emit({
      type: "pageContent",
      intent,
      spread,
      anchor: this.anchor,
      previousSpread: spreadWindow.previous,
      nextSpread: spreadWindow.next,
    });
  }

  private emitPageUnavailable(intent: SpreadIntent): void {
    this.emit({ type: "pageUnavailable", intent });
  }

  private emitChapterUnavailable(
    intent: SpreadIntent,
    chapterIndex: number,
  ): void {
    const event: Omit<ChapterUnavailableEvent, "epoch"> = {
      type: "chapterUnavailable",
      intent,
      chapterIndex,
    };
    this.emit(event);
  }

  private buildMiddleOutOrder(centerChapter: number): number[] {
    if (this.totalChapters <= 0) return [];
    const center = clamp(centerChapter, 0, this.totalChapters - 1);
    const order: number[] = [center];

    for (let delta = 1; order.length < this.totalChapters; delta++) {
      const right = center + delta;
      if (right < this.totalChapters) order.push(right);
      const left = center - delta;
      if (left >= 0) order.push(left);
    }

    return order;
  }

  private spreadContainsChapter(
    spread: ResolvedSpread,
    chapterIndex: number,
  ): boolean {
    return spread.slots.some(
      (slot) => slot.kind === "page" && slot.page.chapterIndex === chapterIndex,
    );
  }

  private arePaginationConfigsEqual(
    a: PaginationConfig,
    b: PaginationConfig,
  ): boolean {
    return (
      areFontConfigsEqual(a.fontConfig, b.fontConfig) &&
      a.layoutTheme.lineHeightFactor === b.layoutTheme.lineHeightFactor &&
      a.layoutTheme.paragraphSpacingFactor ===
        b.layoutTheme.paragraphSpacingFactor &&
      a.layoutTheme.textAlign === b.layoutTheme.textAlign &&
      a.layoutTheme.baseFontSizePx === b.layoutTheme.baseFontSizePx &&
      (a.publisherBookStylingEnabled ?? false) ===
        (b.publisherBookStylingEnabled ?? false) &&
      a.viewport.width === b.viewport.width &&
      a.viewport.height === b.viewport.height
    );
  }

  private areSpreadConfigsEqual(a: SpreadConfig, b: SpreadConfig): boolean {
    return a.columns === b.columns && a.chapterFlow === b.chapterFlow;
  }

  private hasPreparedForLoadedChapters(): boolean {
    for (
      let chapterIndex = 0;
      chapterIndex < this.totalChapters;
      chapterIndex++
    ) {
      if (!this.blocksByChapter[chapterIndex]) continue;
      if (!this.preparedByChapter[chapterIndex]) return false;
    }
    return true;
  }

  private capturePreferredAnchorSlot(spread: ResolvedSpread | null): void {
    if (!spread || !this.shouldPreserveAnchorSlot()) {
      this.preferredAnchorSlotIndex = null;
      return;
    }

    const anchorGlobalPage = resolveAnchorToGlobalPage(
      this.pagesByChapter,
      this.chapterPageOffsets,
      this.anchor,
    );
    if (anchorGlobalPage === null) {
      this.preferredAnchorSlotIndex = null;
      return;
    }

    const anchorSlot = spread.slots.find(
      (
        slot,
      ): slot is Extract<(typeof spread.slots)[number], { kind: "page" }> =>
        slot.kind === "page" && slot.page.currentPage === anchorGlobalPage,
    );
    this.preferredAnchorSlotIndex = anchorSlot?.slotIndex ?? null;
  }

  private getLeadingGapSlots(): number {
    if (!this.shouldPreserveAnchorSlot()) return 0;
    if (this.preferredAnchorSlotIndex === null) return 0;

    const anchorGlobalPage = resolveAnchorToGlobalPage(
      this.pagesByChapter,
      this.chapterPageOffsets,
      this.anchor,
    );
    if (anchorGlobalPage === null) return 0;

    const columns = this.spreadConfig.columns;
    const canonicalSlotIndex = (anchorGlobalPage - 1) % columns;
    return (
      (this.preferredAnchorSlotIndex - canonicalSlotIndex + columns) % columns
    );
  }

  private shouldPreserveAnchorSlot(): boolean {
    return (
      this.spreadConfig.columns === 2 &&
      this.spreadConfig.chapterFlow === "continuous"
    );
  }

  private emitErrorMessage(intent: SpreadIntent, message: string): void {
    this.emit({ type: "error", intent, message });
  }

  private emitException(intent: SpreadIntent, err: unknown): void {
    this.emitErrorMessage(
      intent,
      err instanceof Error ? err.message : String(err),
    );
  }
}
