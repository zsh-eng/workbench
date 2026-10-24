import {
  PAGINATION_WORKER_FONTS_READY_MARK,
  type PaginationCommand,
  type PaginationEvent,
  type PaginationWorkerEventMessage,
  type PaginationWorkerMessage,
} from "../protocol";

export interface PaginationWorkerSessionHandlers {
  onEvent: (
    event: PaginationEvent,
    mainHandlerEnteredAtEpochMs: number,
  ) => void;
  onError: (event: ErrorEvent) => void;
}

export interface PaginationWorkerSession {
  sessionGeneration: number;
  workerFontsReadyAtAcquire: boolean;
  onWorkerFontsReady: (listener: () => void) => () => void;
  postCommand: (command: PaginationCommand) => void;
  release: () => void;
}

export interface PaginationWorkerTransport {
  onmessage:
    | ((event: MessageEvent<PaginationWorkerEventMessage>) => void)
    | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage: (message: PaginationWorkerMessage) => void;
  terminate: () => void;
}

type PaginationWorkerFactory = () => PaginationWorkerTransport;

function createPaginationWorker(): PaginationWorkerTransport {
  return new Worker(new URL("./pagination.worker.ts", import.meta.url), {
    type: "module",
  }) as unknown as PaginationWorkerTransport;
}

/**
 * Owns one pagination worker for the application lifetime. Reader sessions are
 * generation-scoped, so a late response from a previous book cannot update the
 * active Reader. Releasing a session clears its worker engine but preserves the
 * worker process and the built-in fonts it has loaded.
 */
export class PaginationWorkerService {
  private worker: PaginationWorkerTransport | null = null;
  private activeSession: {
    sessionGeneration: number;
    handlers: PaginationWorkerSessionHandlers;
  } | null = null;
  private nextSessionGeneration = 0;
  private workerFontsReady = false;
  private workerFontsReadyListeners = new Set<() => void>();
  private readonly createWorker: PaginationWorkerFactory;

  constructor(createWorker: PaginationWorkerFactory = createPaginationWorker) {
    this.createWorker = createWorker;
  }

  /** Starts the worker and loads the fonts in these font-family lists. */
  warm(fontFamilies: readonly string[] = []): void {
    const worker = this.ensureWorker();
    if (fontFamilies.length === 0) return;
    worker.postMessage({ type: "loadFonts", fontFamilies: [...fontFamilies] });
  }

  acquireSession(
    handlers: PaginationWorkerSessionHandlers,
  ): PaginationWorkerSession {
    const worker = this.ensureWorker();
    if (this.activeSession) {
      worker.postMessage({
        type: "cancel",
        sessionGeneration: this.activeSession.sessionGeneration,
      });
    }

    const sessionGeneration = ++this.nextSessionGeneration;
    this.activeSession = { sessionGeneration, handlers };
    let released = false;

    return {
      sessionGeneration,
      workerFontsReadyAtAcquire: this.workerFontsReady,
      onWorkerFontsReady: (listener) => this.onWorkerFontsReady(listener),
      postCommand: (command) => {
        if (
          released ||
          this.activeSession?.sessionGeneration !== sessionGeneration
        ) {
          return;
        }
        this.worker?.postMessage({
          type: "command",
          sessionGeneration,
          command,
        });
      },
      release: () => {
        if (released) return;
        released = true;
        if (this.activeSession?.sessionGeneration !== sessionGeneration) {
          return;
        }
        this.activeSession = null;
        this.worker?.postMessage({
          type: "cancel",
          sessionGeneration,
        });
      },
    };
  }

  private ensureWorker(): PaginationWorkerTransport {
    if (this.worker) return this.worker;

    const worker = this.createWorker();
    worker.onmessage = (message) => this.handleMessage(message.data);
    worker.onerror = (event) => this.handleError(event);
    this.worker = worker;
    return worker;
  }

  private onWorkerFontsReady(listener: () => void): () => void {
    if (this.workerFontsReady) {
      let active = true;
      queueMicrotask(() => {
        if (active) listener();
      });
      return () => {
        active = false;
      };
    }

    this.workerFontsReadyListeners.add(listener);
    return () => {
      this.workerFontsReadyListeners.delete(listener);
    };
  }

  private handleMessage(message: PaginationWorkerEventMessage): void {
    if (
      message.sessionGeneration === null &&
      message.event.type === "trace" &&
      message.event.name === "worker-fonts-ready"
    ) {
      this.workerFontsReady = true;
      performance.mark(PAGINATION_WORKER_FONTS_READY_MARK);
      const listeners = [...this.workerFontsReadyListeners];
      this.workerFontsReadyListeners.clear();
      for (const listener of listeners) listener();
      return;
    }

    const activeSession = this.activeSession;
    if (
      !activeSession ||
      message.sessionGeneration !== activeSession.sessionGeneration
    ) {
      return;
    }

    activeSession.handlers.onEvent(
      message.event,
      performance.timeOrigin + performance.now(),
    );
  }

  private handleError(event: ErrorEvent): void {
    const worker = this.worker;
    this.worker = null;
    this.workerFontsReady = false;
    this.workerFontsReadyListeners.clear();
    worker?.terminate();

    const activeSession = this.activeSession;
    this.activeSession = null;
    activeSession?.handlers.onError(event);
  }
}

const paginationWorkerService = new PaginationWorkerService();

export function warmPaginationWorker(fontFamilies?: readonly string[]): void {
  paginationWorkerService.warm(fontFamilies);
}

export function acquirePaginationWorkerSession(
  handlers: PaginationWorkerSessionHandlers,
): PaginationWorkerSession {
  return paginationWorkerService.acquireSession(handlers);
}
