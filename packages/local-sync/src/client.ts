import {
  observeSyncHlcBatch,
  bindSyncScope,
  type SyncClientStateStore,
} from "./client-state.js";
import { SyncRecordError, SyncScopeError } from "./errors.js";
import {
  checkSyncValueSize,
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_SYNC_PUSH_CHANGES,
  MAX_SYNC_PUSH_BODY_BYTES,
  syncPushChangeSchema,
  syncKeyPrefixesSchema,
  syncScopeSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
} from "./protocol.js";
import type {
  SyncApplyResult,
  SyncOptions,
  SyncPassObserver,
  SyncRemote,
  SyncRunResult,
  SyncStorage,
} from "./storage.js";

export interface SyncClientOptions<Prepared> {
  storage: SyncStorage<Prepared>;
  remote: SyncRemote;
  stateStore: SyncClientStateStore;
  signal?: AbortSignal;
  /**
   * Key prefixes of the records the app's first screen needs, such as
   * `syncTablePrefix("books")`. A device that has not yet committed a page
   * of its first pull pulls these first, without moving its cursor, then
   * everything; only when the remote has `pullPrefixed`
   * (docs/PRIORITY_RESTORE.md).
   */
  priority?: readonly string[];
}

/**
 * Runs the v2 protocol. Full sync calls share one pull-then-push operation so
 * lifecycle triggers cannot start duplicate work.
 */
export class SyncClient<Prepared> {
  private readonly storage: SyncStorage<Prepared>;
  private readonly remote: SyncRemote;
  private readonly stateStore: SyncClientStateStore;
  private readonly signal?: AbortSignal;
  private readonly priority: readonly string[];
  private activeSync: Promise<SyncRunResult> | null = null;

  constructor(options: SyncClientOptions<Prepared>) {
    this.signal = options.signal;
    this.storage = options.storage;
    this.remote = options.remote;
    this.stateStore = options.stateStore;
    this.priority = options.priority?.length
      ? syncKeyPrefixesSchema.parse([...options.priority])
      : [];
  }

  /** One pull then push. A call while a pass runs joins it. */
  sync(options: SyncOptions = {}): Promise<SyncRunResult> {
    if (this.activeSync !== null) {
      return this.activeSync;
    }

    const run = this.runSync(options.observer).finally(() => {
      if (this.activeSync === run) {
        this.activeSync = null;
      }
    });
    this.activeSync = run;
    return run;
  }

  async pull(
    options: SyncOptions = {},
  ): Promise<Pick<SyncRunResult, "pulled" | "skipped">> {
    const { observer } = options;
    await this.bindScope();
    if (!this.remote.pullStream) return this.pullPages(observer);
    const primed = new Map<string, number>();
    const state = this.requireState();
    // A full pull commits only after a priority pull ends, so a cursor past
    // 0 means an earlier attempt's priority pull ended: the device has it.
    if (
      this.priority.length === 0 ||
      !this.remote.pullPrefixed ||
      state.bootstrapped ||
      state.pullCursor > 0
    )
      return this.pullStreaming(observer, { primed });
    return this.pullWithPriority(observer, primed);
  }

  /**
   * A device's first pull starts with the priority prefixes. Their records
   * commit without a cursor, and `primed` notes each key's sequence. The
   * full pull's request goes out at the same time, so its round trip
   * overlaps the priority pull, but its commits wait for the priority pull:
   * the two never write at once. It leaves out what the priority pull
   * applied (docs/PRIORITY_RESTORE.md). A full request that has waited
   * longer than `FULL_PULL_PATIENCE_MS` is dropped, having committed
   * nothing, and sent again once the priority pull ends, so that no request
   * waits near the transport's time limit.
   */
  private async pullWithPriority(
    observer: SyncPassObserver | undefined,
    primed: Map<string, number>,
  ): Promise<Pick<SyncRunResult, "pulled" | "skipped">> {
    const together = new AbortController();
    const first = this.pullStreaming(observer, {
      primed,
      prefixes: this.priority,
      abort: together.signal,
    });
    const impatient = new AbortController();
    const timer = setTimeout(
      () => impatient.abort(new DOMException("Waited", "TimeoutError")),
      FULL_PULL_PATIENCE_MS,
    );
    // Registered before the full pull waits on `first`, so no timeout fires
    // once the priority pull has ended.
    const ended = () => clearTimeout(timer);
    first.then(ended, ended);
    const rest = this.pullStreaming(observer, {
      primed,
      after: first,
      abort: AbortSignal.any([together.signal, impatient.signal]),
    }).catch(async (error: unknown) => {
      if (!impatient.signal.aborted || together.signal.aborted) throw error;
      await first;
      return this.pullStreaming(observer, { primed, abort: together.signal });
    });
    try {
      const [priority, full] = await Promise.all([first, rest]);
      return {
        pulled: priority.pulled + full.pulled,
        skipped: priority.skipped + full.skipped,
      };
    } catch (error) {
      together.abort(error);
      await Promise.allSettled([first, rest]);
      throw error;
    }
  }

  /** A remote without a stream: one request per page, no priority pull. */
  private async pullPages(
    observer: SyncPassObserver | undefined,
  ): Promise<Pick<SyncRunResult, "pulled" | "skipped">> {
    let pulled = 0;
    let skipped = 0;
    let head: number | undefined;

    while (true) {
      const state = this.requireState();
      const request: SyncPullBody = {
        cursor: state.pullCursor,
        ...(head === undefined ? {} : { head }),
        limit: DEFAULT_SYNC_PULL_LIMIT,
        excludeOwnDevice: state.bootstrapped,
      };
      const response = await this.remote.pull(state.deviceId, request);
      const validResponse = syncPullResponseSchema.parse(response);
      validatePullResponse(request, validResponse, head);
      const preparedRecords = this.storage.prepareRemoteRecords(
        validResponse.records,
      );

      observeSyncHlcBatch(
        validResponse.records.map((record) => record.hlc),
        this.stateStore,
      );
      const result = await this.storage.applyRemoteRecords(
        preparedRecords,
        state.deviceId,
      );
      pulled += result.applied;
      skipped += result.skipped;

      const currentState = this.requireState();
      this.stateStore.write({
        ...currentState,
        pullCursor: validResponse.cursor,
        bootstrapped: currentState.bootstrapped || !validResponse.hasMore,
      });
      observer?.pulled({
        records: validResponse.records,
        keptLocal: result.keptLocal,
        restoring: !request.excludeOwnDevice,
      });

      if (!validResponse.hasMore) {
        return { pulled, skipped };
      }
      head = validResponse.head;
    }
  }

  /**
   * One page is prefetched while one page commits; never rewrite a growing
   * prefix. A full pull checkpoints its cursor after each commit and skips
   * what `primed` holds. A priority pull (`prefixes`) keeps its cursor in
   * memory, never marks the bootstrap complete, and adds what it applied
   * to `primed`.
   */
  private async pullStreaming(
    observer: SyncPassObserver | undefined,
    pass: PullPass,
  ): Promise<Pick<SyncRunResult, "pulled" | "skipped">> {
    const { primed, prefixes } = pass;
    let after = pass.after;
    const controller = new AbortController();
    const signals = [this.signal, pass.abort].filter(
      (signal) => signal !== undefined,
    );
    const abortWith = (signal: AbortSignal) => () =>
      controller.abort(signal.reason);
    const listeners = signals.map(
      (signal) => [signal, abortWith(signal)] as const,
    );
    for (const [signal, listener] of listeners) {
      signal.addEventListener("abort", listener, { once: true });
      if (signal.aborted) listener();
    }
    let pulled = 0,
      skipped = 0,
      head: number | undefined;
    const initial = this.requireState();
    const deviceId = initial.deviceId;
    let priorityCursor = 0;
    const check = () => {
      controller.signal.throwIfAborted();
      if (this.requireState().deviceId !== deviceId)
        throw new SyncScopeError("Sync account/device changed during pull");
    };
    try {
      while (true) {
        check();
        let request: SyncPullBody = {
          cursor: prefixes ? priorityCursor : this.requireState().pullCursor,
          ...(head === undefined ? {} : { head }),
          limit: DEFAULT_SYNC_PULL_LIMIT,
          excludeOwnDevice: initial.bootstrapped,
        };
        const iterator = (
          prefixes
            ? this.remote.pullPrefixed!(
                deviceId,
                request,
                prefixes,
                controller.signal,
              )
            : this.remote.pullStream!(deviceId, request, controller.signal)
        )[Symbol.asyncIterator]();
        // Attach rejection handlers immediately so prefetched failures never escape unhandled.
        const next = () =>
          iterator.next().then(
            (value) => ({ value }),
            (error) => ({ error }),
          );
        let pending = next();
        let last: SyncPullResponse | undefined;
        try {
          while (true) {
            const item = await pending;
            if ("error" in item) throw item.error;
            check();
            if (item.value.done) break;
            if (last && !last.hasMore)
              throw new Error("Sync stream continued after its final page");
            const page = syncPullResponseSchema.parse(item.value.value);
            validatePullResponse(request, page, head);
            // A server that ignored the filter: leave the rest to the full pull.
            if (
              prefixes &&
              page.records.some(
                (record) =>
                  !prefixes.some((prefix) => record.key.startsWith(prefix)),
              )
            )
              return { pulled, skipped };
            if (after) {
              await after;
              after = undefined;
              check();
            }
            head = page.head;
            const records = prefixes
              ? page.records
              : withoutPrimed(page.records, primed);
            const prepared = this.storage.prepareRemoteRecords(records);
            observeSyncHlcBatch(
              records.map((record) => record.hlc),
              this.stateStore,
            );
            pending = next();
            const result = await this.storage.applyRemoteRecords(
              prepared,
              deviceId,
            );
            check();
            pulled += result.applied;
            skipped += result.skipped;
            if (prefixes) {
              priorityCursor = page.cursor;
              notePrimed(primed, records, result);
            } else {
              this.stateStore.write({
                ...this.requireState(),
                pullCursor: page.cursor,
              });
            }
            observer?.pulled({
              records,
              keptLocal: result.keptLocal,
              restoring: !initial.bootstrapped,
            });
            last = page;
            request = { ...request, cursor: page.cursor, head };
          }
          // No pages for a priority pull: the server cannot filter.
          if (!last && prefixes) return { pulled, skipped };
          if (!last) throw new Error("Sync stream returned no pages");
          if (!last.hasMore) {
            if (!prefixes)
              this.stateStore.write({
                ...this.requireState(),
                bootstrapped: true,
              });
            return { pulled, skipped };
          }
          // A clean partial window resumes at the committed cursor with the same head.
        } catch (error) {
          controller.abort(error);
          throw error;
        } finally {
          await iterator.return?.();
        }
      }
    } finally {
      for (const [signal, listener] of listeners)
        signal.removeEventListener("abort", listener);
      controller.abort();
    }
  }

  async push(options: SyncOptions = {}): Promise<number> {
    await this.bindScope();
    const state = this.requireState();
    const pendingSnapshot = await this.storage.getPendingChanges();
    let pushed = 0;

    for (const changes of createPushBatches(pendingSnapshot)) {
      const response = syncPushResponseSchema.parse(
        await this.remote.push(state.deviceId, changes),
      );
      validatePushResponse(changes, response);
      const preparedWinners = this.storage.prepareRemoteRecords(
        response.results.map((result) => result.winner),
      );
      observeSyncHlcBatch(
        response.results.map((result) => result.winner.hlc),
        this.stateStore,
      );
      pushed += await this.storage.reconcilePushResults(
        changes,
        preparedWinners,
      );
      options.observer?.pushed({ sent: changes, results: response.results });
    }

    return pushed;
  }

  private async bindScope(): Promise<void> {
    if (!this.remote.getScope) return;
    const scope = syncScopeSchema.parse(await this.remote.getScope());
    this.signal?.throwIfAborted();
    bindSyncScope(this.stateStore, scope);
  }

  private async runSync(
    observer: SyncPassObserver | undefined,
  ): Promise<SyncRunResult> {
    const pullResult = await this.pull({ observer });
    const pushed = await this.push({ observer });
    return { ...pullResult, pushed };
  }

  private requireState() {
    const state = this.stateStore.read();
    if (state === null) {
      throw new Error("Sync client state is not initialized");
    }
    return state;
  }
}

/**
 * How long a full pull's request may wait for the priority pull before its
 * first commit; the transport ends a request after 30 s.
 */
const FULL_PULL_PATIENCE_MS = 10_000;

/** One pull of a sync pass: a priority pull, or the full pull after it. */
interface PullPass {
  /** Each key a priority pull applied, with its server sequence. */
  primed: Map<string, number>;
  /** A priority pull of these key prefixes. */
  prefixes?: readonly string[];
  /** A full pull: settles before its first commit; a failure ends it. */
  after?: Promise<unknown>;
  /** Ends this pull when the other pull of its pass fails. */
  abort?: AbortSignal;
}

/**
 * The records a priority pull has not already applied. Each winning write
 * of a key takes a new, higher server sequence, so a record at or below the
 * sequence the priority pull applied is that version or an older one; a
 * newer version or a tombstone is above it. Each key comes once in a pull.
 */
function withoutPrimed(
  records: readonly SyncRecord[],
  primed: Map<string, number>,
): readonly SyncRecord[] {
  if (primed.size === 0) return records;
  return records.filter((record) => {
    const applied = primed.get(record.key);
    if (applied === undefined) return true;
    primed.delete(record.key);
    return record.serverSeq > applied;
  });
}

/** Note what a priority page applied; a kept local edit stays unnoted. */
function notePrimed(
  primed: Map<string, number>,
  records: readonly SyncRecord[],
  result: SyncApplyResult,
): void {
  // A storage that cannot name its kept keys: note none of this page.
  if (result.keptLocal === undefined && result.skipped > 0) return;
  const kept = new Set(result.keptLocal);
  for (const record of records)
    if (!kept.has(record.key)) primed.set(record.key, record.serverSeq);
}

/** Count the actual JSON envelope, escaped values, commas, and UTF-8 bytes. */
function* createPushBatches(changes: readonly SyncPushChange[]) {
  const encoder = new TextEncoder();
  const envelopeBytes = encoder.encode(
    JSON.stringify({ changes: [] }),
  ).byteLength;
  let batch: SyncPushChange[] = [];
  let bodyBytes = envelopeBytes;
  for (const change of changes) {
    // An outbox written before a limit applied can still hold such a value.
    checkSyncValueSize(change.value, change.key);
    const validation = syncPushChangeSchema.safeParse(change);
    if (!validation.success) {
      const issues = validation.error.issues.map((issue) => issue.message);
      throw new SyncRecordError(
        `Cannot synchronize record ${change.key}: ${issues.join("; ")}`,
      );
    }
    const changeBytes = encoder.encode(JSON.stringify(change)).byteLength;
    if (envelopeBytes + changeBytes > MAX_SYNC_PUSH_BODY_BYTES) {
      throw new SyncRecordError(
        `Cannot synchronize record ${change.key}: encoded mutation exceeds the push body limit`,
      );
    }
    const commaBytes = batch.length === 0 ? 0 : 1;
    if (
      batch.length === MAX_SYNC_PUSH_CHANGES ||
      bodyBytes + commaBytes + changeBytes > MAX_SYNC_PUSH_BODY_BYTES
    ) {
      yield batch;
      batch = [];
      bodyBytes = envelopeBytes;
    }
    bodyBytes += (batch.length === 0 ? 0 : 1) + changeBytes;
    batch.push(change);
  }
  if (batch.length > 0) yield batch;
}

function validatePushResponse(
  changes: readonly SyncPushChange[],
  response: SyncPushResponse,
): void {
  if (response.results.length !== changes.length) {
    throw new Error("Sync push response length does not match request");
  }

  response.results.forEach((result, index) => {
    if (result.winner.key !== changes[index]!.key) {
      throw new Error("Sync push response order does not match request");
    }
  });
}

function validatePullResponse(
  request: SyncPullBody,
  response: SyncPullResponse,
  fixedHead: number | undefined,
): void {
  if (fixedHead !== undefined && response.head !== fixedHead) {
    throw new Error("Sync pull changed its fixed pagination head");
  }
  if (response.cursor < request.cursor) {
    throw new Error("Sync pull moved its cursor backwards");
  }
  if (response.records.some((record) => record.serverSeq <= request.cursor)) {
    throw new Error("Sync pull returned a record at or before its cursor");
  }
  if (response.hasMore && response.cursor <= request.cursor) {
    throw new Error("Sync pull did not advance its partial-page cursor");
  }
}
