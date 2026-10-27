import { PaginationEngine, type EnginePaginationEvent } from "../engine";
import type {
  PaginationCommand,
  PaginationEvent,
  PaginationWorkerEventMessage,
  PaginationWorkerMessage,
} from "../protocol";
import { ensurePublisherFontsReadyFromBlocks } from "../shared/publisher-fonts";
import type { FontConfig } from "../shared/types";
import { ensureBundledFontsReady } from "./fonts";
import {
  PaginationJobScheduler,
  type ScheduledPaginationJob,
} from "./scheduler";
import { PAGINATION_TASK_YIELD_BUDGET_MS } from "./scheduler-policy";

// Built-in fonts load with the reading font that uses them, before each
// layout (see `waitForCommandFonts`), so the worker is ready once it runs.
let commandFontsReady: Promise<void> = Promise.resolve();

postMessage({
  sessionGeneration: null,
  event: {
    type: "trace",
    name: "worker-fonts-ready",
  },
} satisfies PaginationWorkerEventMessage);

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

let layoutEpoch = 0;
let activeEventEpoch = 0;
let activeSessionGeneration: number | null = null;
let pumpScheduled = false;
let isPumping = false;
let workerRunStartedAtMs: number | null = null;
let workerActiveMs = 0;
let currentWorkStepStartedAtMs: number | null = null;

const TASK_YIELD_BUDGET_MS = PAGINATION_TASK_YIELD_BUDGET_MS;

function postSessionEvent(event: PaginationEvent): void {
  if (activeSessionGeneration === null) return;
  postMessage({
    sessionGeneration: activeSessionGeneration,
    event,
  } satisfies PaginationWorkerEventMessage);
}

function emitEvent(event: EnginePaginationEvent): void {
  if (event.type === "error") {
    postSessionEvent(event);
    return;
  }

  if (event.type === "partialReady" || event.type === "ready") {
    const now = performance.now();
    const activeMs =
      workerActiveMs +
      (currentWorkStepStartedAtMs === null
        ? 0
        : now - currentWorkStepStartedAtMs);
    postSessionEvent({
      ...event,
      epoch: activeEventEpoch,
      workerTiming: {
        activeMs,
        elapsedMs:
          workerRunStartedAtMs === null ? 0 : now - workerRunStartedAtMs,
        postedAtEpochMs: performance.timeOrigin + now,
      },
    });
    return;
  }

  postSessionEvent({ ...event, epoch: activeEventEpoch } as PaginationEvent);
}

let engine = new PaginationEngine(emitEvent);
const scheduler = new PaginationJobScheduler(
  (command) => engine.createWork(command),
  () => engine.pendingJumpChapter,
);

// ---------------------------------------------------------------------------
// Event loop helpers
// ---------------------------------------------------------------------------

async function yieldToEventLoop(): Promise<void> {
  const browserScheduler = (
    globalThis as {
      scheduler?: {
        postTask?: (
          callback: () => void,
          options?: {
            priority?: "user-blocking" | "user-visible" | "background";
          },
        ) => Promise<void>;
        yield?: () => Promise<void>;
      };
    }
  ).scheduler;
  if (typeof browserScheduler?.postTask === "function") {
    await browserScheduler.postTask(() => undefined, {
      priority: "background",
    });
    return;
  }
  if (typeof browserScheduler?.yield === "function") {
    await browserScheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Job epoch stamping
// ---------------------------------------------------------------------------

function prepareJobStep(job: ScheduledPaginationJob): void {
  if (job.startsLayout && job.eventEpoch === null) {
    layoutEpoch++;
    job.eventEpoch = layoutEpoch;
  }

  activeEventEpoch = job.eventEpoch ?? layoutEpoch;
}

// ---------------------------------------------------------------------------
// Task pump
// ---------------------------------------------------------------------------

function schedulePump(): void {
  if (pumpScheduled || isPumping) return;
  pumpScheduled = true;
  setTimeout(() => {
    pumpScheduled = false;
    void pump();
  }, 0);
}

async function pump(): Promise<void> {
  if (isPumping) return;
  isPumping = true;
  let sliceStartedAt = performance.now();

  try {
    while (scheduler.hasWork()) {
      const fontsReadyForWork = commandFontsReady;
      await fontsReadyForWork;
      if (fontsReadyForWork !== commandFontsReady) continue;
      scheduler.expandIncomingCommands();

      const job = scheduler.peek();
      if (!job) continue;

      prepareJobStep(job);
      currentWorkStepStartedAtMs = performance.now();
      const result = job.work.next();
      workerActiveMs += performance.now() - currentWorkStepStartedAtMs;
      currentWorkStepStartedAtMs = null;
      if (result.done) scheduler.remove(job);

      if (performance.now() - sliceStartedAt >= TASK_YIELD_BUDGET_MS) {
        await yieldToEventLoop();
        sliceStartedAt = performance.now();
      }
    }
  } finally {
    isPumping = false;
    if (scheduler.hasWork()) schedulePump();
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

function resetWorkerSession(sessionGeneration: number | null): void {
  scheduler.cancelAll();
  engine = new PaginationEngine(emitEvent);
  layoutEpoch = 0;
  activeEventEpoch = 0;
  activeSessionGeneration = sessionGeneration;
  commandFontsReady = Promise.resolve();
  workerRunStartedAtMs = null;
  workerActiveMs = 0;
  currentWorkStepStartedAtMs = null;
}

function readingFontFamilies(fontConfig: FontConfig): string[] {
  return [
    fontConfig.bodyFamily,
    fontConfig.headingFamily,
    fontConfig.codeFamily,
  ];
}

/**
 * The fonts a command lays text out in: the reading font for a new layout and
 * embedded publisher fonts for new chapters. Layout waits for them, so no
 * text is measured in a fallback face.
 */
function waitForCommandFonts(command: PaginationCommand): Promise<void> {
  const loadCommandFonts = async (): Promise<void> => {
    switch (command.type) {
      case "init":
        await Promise.all([
          ensureBundledFontsReady(
            readingFontFamilies(command.paginationConfig.fontConfig),
          ),
          ensurePublisherFontsReadyFromBlocks(command.firstChapterBlocks),
        ]);
        return;
      case "updatePaginationConfig":
        await ensureBundledFontsReady(
          readingFontFamilies(command.paginationConfig.fontConfig),
        );
        return;
      case "addChapter":
      case "updateChapter":
        await ensurePublisherFontsReadyFromBlocks(command.blocks);
        return;
    }
  };

  const fontsReady =
    command.type === "init"
      ? loadCommandFonts()
      : commandFontsReady.then(loadCommandFonts);
  return fontsReady.catch((error) => {
    console.warn("[pagination worker] Failed to load fonts", error);
  });
}

self.onmessage = (e: MessageEvent<PaginationWorkerMessage>) => {
  const message = e.data;
  if (message.type === "loadFonts") {
    void ensureBundledFontsReady(message.fontFamilies);
    return;
  }
  if (message.type === "cancel") {
    if (message.sessionGeneration !== activeSessionGeneration) return;
    resetWorkerSession(null);
    return;
  }

  const { command, sessionGeneration } = message;
  if (command.type === "init") {
    if (sessionGeneration !== activeSessionGeneration) {
      resetWorkerSession(sessionGeneration);
    }
    workerRunStartedAtMs = performance.now();
    workerActiveMs = 0;
    currentWorkStepStartedAtMs = null;
  } else if (sessionGeneration !== activeSessionGeneration) {
    return;
  }

  commandFontsReady = waitForCommandFonts(command);

  if (command.type === "init") {
    void commandFontsReady.then(() => {
      if (activeSessionGeneration !== sessionGeneration) return;
      postSessionEvent({
        type: "trace",
        name: "publisher-fonts-ready",
      });
    });
  }

  scheduler.pushCommand(command);
  schedulePump();
};
