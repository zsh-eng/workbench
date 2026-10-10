import { readBrowserToken } from "./auth";
import { REVIEW_UPDATED } from "./workspaces";
import {
  savedReviewSchema,
  savedFeedbackSchema,
  type PinMutation,
  type SavedReview,
  type SavedFeedback,
  type SavedReviewTarget,
} from "../../shared/saved-review";
import { comparisonKey } from "../../shared/protocol";
import {
  validateReviewNoteRemoval,
  validateReviewNoteText,
} from "../../shared/hunk/noteValidation";
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { FileDiffMetadata } from "@pierre/diffs";
import type {
  Branch,
  Commit,
  CommitDetails,
  Comparison,
  NoteMutation,
  NoteState,
  PullRequestComments,
  RegisteredRepository,
  ReviewResponse,
  Session,
  SourceResponse,
} from "../../shared/protocol";
import {
  createInitialReviewState,
  parseReviewPatch,
  projectAuthoritativeNotes,
  projectResponse,
  reduceReviewState,
  reviewFileMatchesFilter,
  type ParsedReviewFile,
  type ReviewDocumentV1,
  type ReviewState,
} from "../../shared/review";
import { ByteLru, estimateRetainedBytes } from "./cache";
import {
  branchesSchema,
  createApi,
  eventSchema,
  commitDetailsSchema,
  historySchema,
  pullRequestCommentsSchema,
  revealSchema,
  HttpError,
  notesSchema,
  repositoriesSchema,
  reviewSchema,
  sessionSchema,
  sourceSchema,
} from "./api";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";

export type { ParsedReviewFile } from "../../shared/review";
export interface ReviewControllerSnapshot {
  savedReview: SavedReview | null;
  savedTargetId: string | null;
  savedView: boolean;
  session: Session | null;
  repositories: RegisteredRepository[];
  activeRepositoryId: string | null;
  branches: Branch[];
  branchesError: string | null;
  activeBranch: string | null;
  historyRef: string | null;
  sourceRevision: number;
  history: Commit[];
  historyHasMore: boolean;
  historyLoading: boolean;
  historyError: string | null;
  review: ReviewResponse | null;
  files: ParsedReviewFile[];
  visibleFiles: ParsedReviewFile[];
  notes: NoteState | null;
  notesError: string | null;
  comparison: Comparison;
  selectedFileId: string | null;
  filter: string;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  connection: "connecting" | "connected" | "reconnecting" | "closed";
  metrics: { requestMs: number; parseMs: number; cacheHit: boolean } | null;
  semantic: ReviewState | null;
}

export interface ReviewControllerOptions {
  token?: string;
  savedReviewId?: string;
  fetch?: typeof fetch;
  parsePatch?: (patch: string) => Promise<FileDiffMetadata[]>;
  cacheBytes?: number;
  events?: boolean;
  /** A workspace's repository and branch; without it the host's default opens. */
  start?: { path?: string; repositoryId?: string; branch?: string };
}

export interface ReviewController {
  getSnapshot(): ReviewControllerSnapshot;
  subscribe(listener: () => void): () => void;
  initialize(): Promise<void>;
  selectSavedTarget(id: string): Promise<void>;
  returnToSavedReview(): Promise<void>;
  copyFeedback(): Promise<SavedFeedback>;
  /** The saved review's GitHub pull request comments, read-only. `refresh`
   * skips the host's 30-second cache. */
  loadPullRequestComments(refresh?: boolean): Promise<PullRequestComments>;
  clearSavedComments(expectedRevision: number): Promise<void>;
  /** Replace the saved review's brief, or remove it with null. */
  setSavedBrief(text: string | null): Promise<void>;
  /** Pin an agent reply to the saved review's Notes, or remove a pin. */
  pinToReview(mutation: PinMutation): Promise<void>;
  /** Starts an installed agent in the review's repository and returns its session ID. */
  startSession(preset: string): Promise<string>;
  /** Save the current Git comparison as a review and return its ID. */
  saveReview(input: { title: string; brief?: string }): Promise<string>;
  selectComparison(comparison: Comparison): Promise<void>;
  refresh(): Promise<void>;
  /** Stop live updates while the workspace is hidden. */
  suspend(): void;
  /** Restart live updates and reconcile what changed while hidden. */
  resume(): void;
  loadMoreHistory(): Promise<void>;
  loadCommitDetails(id: string, signal?: AbortSignal): Promise<CommitDetails>;
  /** Shows a working-tree file in the system file manager. */
  revealPath(repo: string, path: string): Promise<void>;
  selectWorktree(path: string, repositoryId?: string): Promise<void>;
  selectBranch(name: string, repositoryId?: string): Promise<void>;
  addRepository(path: string): Promise<void>;
  removeRepository(id: string): Promise<void>;
  refreshRepositories(): Promise<void>;
  revealFile(id: string): void;
  setFilter(text: string): void;
  loadSources(path: string): Promise<SourceResponse>;
  mutateNote(mutation: NoteMutation): Promise<void>;
  dispose(): void;
}

interface CachedReview {
  response: ReviewResponse;
  files: ParsedReviewFile[];
  document: ReviewDocumentV1;
}
const savedKey = (reviewId: string, targetId: string) =>
  JSON.stringify(["saved", reviewId, targetId]);
function immutableComparison(comparison: Comparison): boolean {
  const objectId = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
  return comparison.kind === "commit"
    ? objectId.test(comparison.commit)
    : comparison.kind === "range" &&
        objectId.test(comparison.base) &&
        objectId.test(comparison.head);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
function query(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

/** The comparisons of a saved review's current iteration, or all of its own
 * comparisons when it has no iterations. Commented commits are not included. */
export function currentTargets(saved: SavedReview) {
  const ids = saved.iterations?.at(-1)?.targetIds;
  const own = saved.targets.filter((target) => !target.commentReviewId);
  return ids ? own.filter((target) => ids.includes(target.id)) : own;
}

export function createReviewController(options: ReviewControllerOptions = {}): ReviewController {
  const token = options.token ?? readBrowserToken();
  // A workspace names its review or branch; otherwise the page address does.
  const savedReviewId =
    options.savedReviewId ??
    (options.start || typeof location === "undefined"
      ? undefined
      : /^\/review\/([^/]+)\/?$/.exec(location.pathname)?.[1]);
  const api = createApi(options.fetch ?? browserFetch, token);
  const parse =
    options.parsePatch ??
    (async (patch: string) => {
      if (patch.length > 256 * 1024) throw new Error("This patch requires the background parser.");
      return parseReviewPatch(patch);
    });
  const reviewCache = new ByteLru<CachedReview>(options.cacheBytes ?? 24 * 1024 * 1024);
  const sourceCache = new ByteLru<SourceResponse>(8 * 1024 * 1024, 12, (_key, source) => {
    if (snapshot.review?.id !== source.reviewId || !snapshot.semantic) return;
    const file = snapshot.files.find((entry) => entry.path === source.path);
    if (!file) return;
    const sourceStatusByFileKey = { ...snapshot.semantic.sourceStatusByFileKey };
    delete sourceStatusByFileKey[file.id];
    update({ semantic: { ...snapshot.semantic, sourceStatusByFileKey } });
  });
  const listeners = new Set<() => void>();
  let snapshot: ReviewControllerSnapshot = {
    savedReview: null,
    savedTargetId: null,
    savedView: false,
    session: null,
    repositories: [],
    activeRepositoryId: null,
    branches: [],
    branchesError: null,
    activeBranch: null,
    historyRef: null,
    sourceRevision: 0,
    history: [],
    historyHasMore: false,
    historyLoading: false,
    historyError: null,
    review: null,
    files: [],
    visibleFiles: [],
    notes: null,
    notesError: null,
    comparison: { kind: "working" },
    selectedFileId: null,
    filter: "",
    status: "idle",
    error: null,
    connection: "closed",
    metrics: null,
    semantic: null,
  };
  // Keep failed write text available if a pending navigation finishes afterward.
  let noteWriteRecovery: string | null = null;
  let hasRepositoryCatalogue = false;
  let catalogueGeneration = 0;
  let catalogueAbort: AbortController | undefined;
  let activeTarget: string | undefined;
  let restoreFilePath: string | null = null;
  const navigation = new Map<
    string,
    {
      comparison: Comparison;
      filter: string;
      selectedFileId: string | null;
      selectedFilePath: string | null;
    }
  >();
  const targetKey = (repositoryId: string, path: string, branch: string | null) =>
    JSON.stringify([repositoryId, branch ? "branch" : "worktree", branch ?? path]);
  const rememberTarget = () => {
    if (!activeTarget || !snapshot.session) return;
    navigation.delete(activeTarget);
    navigation.set(activeTarget, {
      comparison: snapshot.comparison,
      filter: snapshot.filter,
      selectedFileId: snapshot.selectedFileId,
      selectedFilePath:
        snapshot.files.find((file) => file.id === snapshot.selectedFileId)?.path ?? restoreFilePath,
    });
    while (navigation.size > 32) navigation.delete(navigation.keys().next().value!);
  };
  let branchGeneration = 0;
  let branchAbort: AbortController | undefined;
  let disposed = false;
  let suspended = false;
  let workspaceGeneration = 0;
  let reviewGeneration = 0;
  let historyGeneration = 0;
  let historyCursor: string | null = null;
  let reviewAbort: AbortController | undefined;
  // A saved review's first diff loads and parses while the repository checks run.
  let prefetched: {
    reviewId: string;
    targetId: string;
    abort: AbortController;
    work: ReturnType<typeof fetchSavedTarget>;
  } | null = null;
  let sessionAbort: AbortController | undefined;
  let historyAbort: AbortController | undefined;
  let eventAbort: AbortController | undefined;
  let eventTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectDelay = 500;
  const sourceRequests = new Map<
    string,
    { abort: AbortController; promise: Promise<SourceResponse> }
  >();
  const update = (patch: Partial<ReviewControllerSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    for (const listener of [...listeners]) listener();
  };
  const isCurrent = (generation: number) => !disposed && generation === reviewGeneration;
  const filtered = (files: ParsedReviewFile[], filter: string) =>
    files.filter((file) =>
      reviewFileMatchesFilter({ path: file.path, previousPath: file.info.previousPath }, filter),
    );
  const cancelSources = () => {
    for (const { abort } of sourceRequests.values()) abort.abort();
    sourceRequests.clear();
  };

  function savedTargetUrl() {
    return snapshot.savedView && snapshot.savedReview && snapshot.savedTargetId
      ? `/api/reviews/${encodeURIComponent(snapshot.savedReview.id)}/targets/${encodeURIComponent(snapshot.savedTargetId)}`
      : null;
  }
  function savedNoteUrl(reviewId = snapshot.review?.id) {
    return (
      savedTargetUrl() ??
      (snapshot.savedReview && reviewId
        ? `/api/reviews/${encodeURIComponent(snapshot.savedReview.id)}/browsing/${encodeURIComponent(reviewId)}`
        : null)
    );
  }
  async function refreshSavedMetadata() {
    const id = snapshot.savedReview?.id;
    // The saved review has its own revision and count. Refresh only after local
    // writes settle, and discard a response if another write started meanwhile.
    if (!id || disposed || writingNotes) return;
    const writeEpoch = noteWriteEpoch;
    const savedReview = await api.json(`/api/reviews/${encodeURIComponent(id)}`, savedReviewSchema);
    if (
      !disposed &&
      !writingNotes &&
      writeEpoch === noteWriteEpoch &&
      snapshot.savedReview?.id === id &&
      savedReview.revision >= snapshot.savedReview.revision
    ) {
      const changed = savedReview.revision > snapshot.savedReview.revision;
      // An unchanged review keeps its object, so the views do not render again.
      if (!changed && JSON.stringify(savedReview) === JSON.stringify(snapshot.savedReview)) return;
      update({ savedReview });
      if (changed && snapshot.review) await loadNotes(snapshot.review.id, reviewGeneration);
    }
  }
  let savedRefresh: Promise<void> | undefined;
  const refreshSavedOnFocus = () => {
    if (disposed || suspended || !snapshot.savedReview || savedRefresh) return;
    savedRefresh = refreshSavedMetadata()
      .catch(() => {})
      .finally(() => {
        savedRefresh = undefined;
      });
  };
  const refreshSavedOnVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible")
      refreshSavedOnFocus();
  };

  async function loadNotes(reviewId: string, generation: number): Promise<void> {
    try {
      const notes = await api.json(
        savedNoteUrl(reviewId)
          ? `${savedNoteUrl(reviewId)}/notes`
          : `/api/notes?${query({ reviewId })}`,
        notesSchema,
        {
          signal: reviewAbort?.signal,
        },
      );
      if (!isCurrent(generation) || snapshot.review?.id !== reviewId) return;
      if (notes.reviewId !== reviewId) throw new Error("Notes belong to a different review.");
      const queue = noteQueues.get(noteQueueKey(reviewId));
      if (queue) {
        if (!queue.pending.length && notes.revision >= queue.authoritative.revision)
          queue.authoritative = notes;
        publishNotes(queue);
      } else {
        if (snapshot.notes?.reviewId === notes.reviewId && snapshot.notes.revision > notes.revision)
          return;
        update({
          notes,
          notesError: noteWriteRecovery,
          semantic: snapshot.semantic ? projectAuthoritativeNotes(snapshot.semantic, notes) : null,
        });
      }
    } catch (error) {
      if (isCurrent(generation) && snapshot.review?.id === reviewId)
        update({ notesError: message(error) });
    }
  }

  function publishReview(
    entry: CachedReview,
    generation: number,
    metrics: NonNullable<ReviewControllerSnapshot["metrics"]>,
  ) {
    if (!isCurrent(generation)) return;
    const oldSemantic = snapshot.semantic;
    const semantic = oldSemantic
      ? reduceReviewState(oldSemantic, { type: "document/reconcile", document: entry.document })
      : createInitialReviewState(entry.document, { showAgentNotes: true });
    // Notes are scoped to the authoritative review ID. Never show another commit's notes.
    const sameReview = snapshot.review?.id === entry.response.id;
    let reconciled = sameReview
      ? semantic
      : { ...semantic, userNotes: [], liveNotes: [], draftNote: null };
    // Pierre hydrates partial metadata in place. Keep renderer-owned metadata separate
    // from the canonical entries whose retained size is measured by the review LRU.
    // Re-selecting the same review must retain the exact metadata objects.
    // Pierre compares prepared and rendered layouts by object identity, even
    // when their cache keys match. Replacing these during highlighting races
    // with its existing render cache and can fail finalizeRender.
    const files = sameReview
      ? snapshot.files
      : entry.files.map((file) => ({
          ...file,
          metadata: file.metadata ? structuredClone(file.metadata) : null,
        }));
    const visibleFiles = filtered(files, snapshot.filter);
    const selectedFileId =
      visibleFiles.find((file) => file.path === restoreFilePath)?.id ??
      (visibleFiles.some((file) => file.id === snapshot.selectedFileId)
        ? snapshot.selectedFileId
        : (visibleFiles[0]?.id ?? null));
    restoreFilePath = null;
    if (reconciled.filter !== snapshot.filter)
      reconciled = reduceReviewState(reconciled, { type: "filter/set", filter: snapshot.filter });
    if (selectedFileId && reconciled.selection.fileKey !== selectedFileId)
      reconciled = reduceReviewState(reconciled, {
        type: "selection/select",
        fileKey: selectedFileId,
        hunkIndex: 0,
        reveal: { anchor: "none", scrollToNote: false },
      });
    update({
      review: entry.response,
      files,
      visibleFiles,
      selectedFileId,
      semantic: reconciled,
      notes: sameReview ? snapshot.notes : null,
      notesError: noteWriteRecovery,
      status: "ready",
      error: null,
      metrics,
    });
    void loadNotes(entry.response.id, generation);
  }

  /** `quiet` refreshes the shown comparison in the background: the review stays
   * ready and changes once, when the new one arrives. Live updates use it, so
   * an edit in the worktree does not flash the loading bar or the toolbar. */
  async function selectComparison(
    comparison: Comparison,
    force = false,
    quiet = false,
  ): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (!repo || disposed) return;
    if (
      snapshot.session?.repository.git === false &&
      comparison.kind !== "patch" &&
      comparison.kind !== "files"
    ) {
      update({ error: "Git comparisons are not available for this input." });
      return;
    }
    if (snapshot.historyRef && ["working", "staged", "unstaged"].includes(comparison.kind)) {
      update({
        error: "This branch has no worktree. Choose a worktree tab to review working changes.",
      });
      return;
    }
    const background =
      quiet &&
      !snapshot.savedView &&
      snapshot.status === "ready" &&
      !!snapshot.review &&
      comparisonKey(snapshot.comparison) === comparisonKey(comparison);
    if (snapshot.savedView) update({ savedView: false });
    const generation = ++reviewGeneration;
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    cancelSources();
    if (!background) update({ comparison, status: "loading", error: null });
    const key = JSON.stringify([repo, comparisonKey(comparison)]);
    const cached = !force && immutableComparison(comparison) ? reviewCache.get(key) : undefined;
    if (cached) {
      publishReview(cached, generation, { requestMs: 0, parseMs: 0, cacheHit: true });
      return;
    }
    const start = performance.now();
    try {
      const response = await api.json("/api/review", reviewSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, comparison }),
        signal: reviewAbort.signal,
      });
      if (!isCurrent(generation)) return;
      if (
        response.repo !== repo ||
        comparisonKey(response.comparison) !== comparisonKey(comparison)
      ) {
        console.error("Comparison response mismatch", {
          requested: { repo, comparison },
          received: { repo: response.repo, comparison: response.comparison },
        });
        throw new Error(
          "The server returned a different comparison. Restart the server and reload this page if you have just updated the app.",
        );
      }
      // A review id names its content, so the same id means nothing changed.
      if (background && response.id === snapshot.review?.id) return;
      const parseStart = performance.now();
      const parsed = await parse(response.patch);
      if (!isCurrent(generation)) return;
      const { files, document } = projectResponse(response, parsed);
      const entry = { response, files, document };
      if (immutableComparison(comparison))
        reviewCache.set(key, entry, estimateRetainedBytes(entry));
      publishReview(entry, generation, {
        requestMs: parseStart - start,
        parseMs: performance.now() - parseStart,
        cacheHit: false,
      });
    } catch (error) {
      if (isCurrent(generation)) update({ status: "error", error: message(error) });
    }
  }

  /** `quiet` reloads the first page in the background: no loading state, and
   * no update when the commits are the same. */
  async function loadHistory(reset: boolean, quiet = false): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (snapshot.session?.repository.git === false) return;
    if (!repo || disposed || (!reset && (snapshot.historyLoading || !snapshot.historyHasMore)))
      return;
    const generation = ++historyGeneration;
    historyAbort?.abort();
    historyAbort = new AbortController();
    if (!quiet) update({ historyLoading: true, historyError: null });
    try {
      const args: Record<string, string> = { repo, limit: "50" };
      if (snapshot.historyRef) args.ref = snapshot.historyRef;
      if (!reset && historyCursor) args.cursor = historyCursor;
      const page = await api.json(`/api/history?${query(args)}`, historySchema, {
        signal: historyAbort.signal,
      });
      if (disposed || generation !== historyGeneration) return;
      const existing = reset ? [] : snapshot.history;
      const ids = new Set(existing.map((commit) => commit.id));
      const history = [...existing, ...page.commits.filter((commit) => !ids.has(commit.id))];
      const hasMore = page.hasMore && page.cursor !== null;
      // The loaded pages and their cursor stay when the first page is the same.
      if (
        quiet &&
        !snapshot.historyError &&
        JSON.stringify(history) === JSON.stringify(snapshot.history.slice(0, history.length)) &&
        (snapshot.history.length > history.length || snapshot.historyHasMore === hasMore)
      ) {
        if (snapshot.historyLoading) update({ historyLoading: false });
        return;
      }
      historyCursor = page.cursor;
      update({
        history,
        historyHasMore: hasMore,
        historyLoading: false,
      });
    } catch (error) {
      if (!disposed && generation === historyGeneration)
        update({ historyError: message(error), historyLoading: false });
    }
  }

  async function loadBranches(refreshSession = false): Promise<void> {
    const repo = snapshot.session?.repository.path;
    if (!repo || snapshot.session?.repository.git === false || disposed) return;
    const generation = ++branchGeneration;
    branchAbort?.abort();
    branchAbort = new AbortController();
    try {
      const branches = await api.json(`/api/branches?${query({ repo })}`, branchesSchema, {
        signal: branchAbort.signal,
      });
      const session = refreshSession
        ? await api.json(`/api/session?${query({ repo })}`, sessionSchema, {
            signal: branchAbort.signal,
          })
        : null;
      if (!disposed && generation === branchGeneration) {
        if (
          !snapshot.branchesError &&
          JSON.stringify(branches) === JSON.stringify(snapshot.branches) &&
          (!session || JSON.stringify(session) === JSON.stringify(snapshot.session))
        )
          return;
        update({
          repositories: snapshot.repositories.map((repository) =>
            repository.id === snapshot.activeRepositoryId
              ? { ...repository, branches, worktrees: session?.worktrees ?? repository.worktrees }
              : repository,
          ),
          branches,
          branchesError: null,
          ...(session
            ? {
                session,
                ...(!snapshot.historyRef
                  ? {
                      activeBranch:
                        session.repository.branch === "Detached HEAD"
                          ? null
                          : session.repository.branch,
                    }
                  : {}),
              }
            : {}),
        });
      }
    } catch (error) {
      if (!disposed && generation === branchGeneration) update({ branchesError: message(error) });
    }
  }
  async function publishRepositories(repositories: RegisteredRepository[]) {
    const removedIds = new Set(
      snapshot.repositories
        .filter((previous) => !repositories.some((repository) => repository.id === previous.id))
        .map((repository) => repository.id),
    );
    const removedActive =
      snapshot.activeRepositoryId !== null &&
      !repositories.some((repository) => repository.id === snapshot.activeRepositoryId);
    if (removedIds.size) {
      for (const key of navigation.keys())
        if (removedIds.has(JSON.parse(key)[0])) navigation.delete(key);
      reviewCache.clear();
    }
    if (removedActive) activeTarget = undefined;
    update({
      repositories,
      branches:
        repositories.find((repository) => repository.id === snapshot.activeRepositoryId)
          ?.branches ?? [],
      branchesError: null,
    });
    if (
      (removedActive || snapshot.activeRepositoryId === null) &&
      snapshot.savedView &&
      snapshot.savedReview &&
      snapshot.savedTargetId
    ) {
      await selectSavedTarget(snapshot.savedTargetId);
      return;
    }
    if (removedActive || snapshot.activeRepositoryId === null) {
      const nextRepository = repositories[0];
      if (nextRepository) await openWorkspace(nextRepository.path, undefined, nextRepository.id);
      else clearWorkspace();
    }
  }

  async function refreshRepositories(): Promise<void> {
    if (disposed) return;
    // Older servers and non-Git inputs expose only the original session endpoint.
    if (!hasRepositoryCatalogue) return loadBranches(true);
    const generation = ++catalogueGeneration;
    catalogueAbort?.abort();
    catalogueAbort = new AbortController();
    try {
      const result = await api.json("/api/repositories", repositoriesSchema, {
        signal: catalogueAbort.signal,
      });
      if (!disposed && generation === catalogueGeneration)
        await publishRepositories(result.repositories);
    } catch (error) {
      if (!disposed && generation === catalogueGeneration) {
        update({ branchesError: message(error) });
        throw error;
      }
    }
  }

  // Serialize writes: a delayed registration response must not restore a removed entry.
  let registryWrite = Promise.resolve();
  function mutateRepositories(init: RequestInit, id?: string): Promise<void> {
    const next = registryWrite
      .catch(() => {})
      .then(async () => {
        if (disposed) return;
        ++catalogueGeneration;
        catalogueAbort?.abort();
        const result = await api.json(
          `/api/repositories${id ? `?${query({ id })}` : ""}`,
          repositoriesSchema,
          init,
        );
        if (disposed) return;
        ++catalogueGeneration;
        catalogueAbort?.abort();
        hasRepositoryCatalogue = true;
        await publishRepositories(result.repositories);
      });
    registryWrite = next;
    return next;
  }
  function addRepository(path: string): Promise<void> {
    return mutateRepositories({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
  }
  function removeRepository(id: string): Promise<void> {
    return mutateRepositories({ method: "DELETE" }, id);
  }

  function clearWorkspace() {
    ++workspaceGeneration;
    ++branchGeneration;
    ++reviewGeneration;
    ++historyGeneration;
    sessionAbort?.abort();
    branchAbort?.abort();
    reviewAbort?.abort();
    historyAbort?.abort();
    cancelSources();
    stopEvents();
    sourceCache.clear();
    activeTarget = undefined;
    restoreFilePath = null;
    historyCursor = null;
    update({
      session: null,
      activeRepositoryId: null,
      activeBranch: null,
      historyRef: null,
      branches: [],
      branchesError: null,
      history: [],
      historyHasMore: false,
      historyLoading: false,
      historyError: null,
      review: null,
      files: [],
      visibleFiles: [],
      semantic: null,
      notes: null,
      notesError: noteWriteRecovery,
      comparison: { kind: "working" },
      filter: "",
      selectedFileId: null,
      status: "idle",
      error: null,
      connection: "closed",
      metrics: null,
      sourceRevision: snapshot.sourceRevision + 1,
    });
  }

  async function refresh(): Promise<void> {
    if (snapshot.savedView && snapshot.savedTargetId)
      return selectSavedTarget(snapshot.savedTargetId);
    update({ sourceRevision: snapshot.sourceRevision + 1 });
    await Promise.all([
      selectComparison(snapshot.comparison, true),
      loadHistory(true),
      loadBranches(true),
    ]);
  }

  function stopEvents() {
    eventAbort?.abort();
    eventAbort = undefined;
    clearTimeout(eventTimer);
    clearTimeout(refreshTimer);
  }

  /** Reload what live updates would have changed: sources, history, branches,
   * and a mutable comparison. */
  function reconcile() {
    update({ sourceRevision: snapshot.sourceRevision + 1 });
    void loadHistory(true, true);
    void loadBranches(true);
    if (!snapshot.savedView && !immutableComparison(snapshot.comparison))
      void selectComparison(snapshot.comparison, true, true);
  }

  function startEvents() {
    stopEvents();
    if (options.events === false || disposed || suspended) return;
    const workspace = workspaceGeneration;
    const repo = snapshot.session?.repository.path;
    let lastRevision: number | undefined;
    let connections = 0;
    const connect = async () => {
      if (disposed || workspace !== workspaceGeneration) return;
      const abort = new AbortController();
      eventAbort = abort;
      // A workspace that resumes keeps "Live" while its stream reconnects; a
      // failed reconnect still reports itself below.
      const next = reconnectDelay > 500 ? "reconnecting" : "connecting";
      if (!(next === "connecting" && snapshot.connection === "connected"))
        update({ connection: next });
      try {
        const response = await api.stream(
          `/api/events?${query({ repo: repo ?? "" })}`,
          abort.signal,
        );
        if (!response.ok || !response.body)
          throw new HttpError("Live updates are unavailable.", response.status);
        if (disposed || workspace !== workspaceGeneration || abort.signal.aborted) {
          await response.body.cancel();
          return;
        }
        connections += 1;
        if (snapshot.connection !== "connected") update({ connection: "connected" });
        await readServerEvents(
          response.body,
          (event) => {
            if (workspace !== workspaceGeneration || disposed) return;
            let raw: unknown;
            try {
              raw = JSON.parse(event.data);
            } catch {
              return;
            }
            const result = eventSchema.safeParse(raw);
            if (!result.success || result.data.repo !== repo) return;
            const notice = result.data;
            // Reconnect always reconciles: events may have been missed while disconnected.
            const needsRefresh =
              notice.type === "changed" ||
              connections > 1 ||
              (lastRevision !== undefined && lastRevision !== notice.revision);
            lastRevision = notice.revision;
            reconnectDelay = 500;
            if (needsRefresh) {
              clearTimeout(refreshTimer);
              refreshTimer = setTimeout(reconcile, 150);
            }
          },
          abort.signal,
        );
      } catch (error) {
        if (disposed || workspace !== workspaceGeneration || abort.signal.aborted) return;
        if (error instanceof HttpError && error.status === 403 && hasRepositoryCatalogue) {
          // Another client may have removed this repository while its event stream was open.
          try {
            await refreshRepositories();
          } catch (refreshError) {
            if (disposed || workspace !== workspaceGeneration) return;
            update({ connection: "closed", error: message(refreshError) });
            return;
          }
          if (disposed || workspace !== workspaceGeneration) return;
          update({
            connection: "closed",
            error: "Live updates are unavailable for this repository.",
          });
          return;
        }
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
          update({
            connection: "closed",
            error:
              error.status === 401
                ? "The session token has expired. Open the address shown by the server."
                : "Live updates are unavailable for this repository.",
          });
          return;
        }
      }
      if (disposed || workspace !== workspaceGeneration || abort.signal.aborted) return;
      update({ connection: "reconnecting" });
      eventTimer = setTimeout(() => {
        void connect();
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10_000);
    };
    void connect();
  }

  async function openWorkspace(
    path?: string,
    branch?: Branch,
    repositoryId?: string,
    savedTarget?: SavedReviewTarget,
  ): Promise<void> {
    if (disposed) return;
    rememberTarget();
    const generation = ++workspaceGeneration;
    const catalogueVersion = catalogueGeneration;
    ++branchGeneration;
    branchAbort?.abort();
    ++reviewGeneration;
    ++historyGeneration;
    sessionAbort?.abort();
    sessionAbort = new AbortController();
    reviewAbort?.abort();
    historyAbort?.abort();
    cancelSources();
    stopEvents();
    sourceCache.clear();
    historyCursor = null;
    update({
      session: null,
      savedView: Boolean(savedTarget),
      ...(savedTarget ? { savedTargetId: savedTarget.id } : {}),
      activeRepositoryId: repositoryId ?? snapshot.activeRepositoryId,
      branches: repositoryId
        ? (snapshot.repositories.find((entry) => entry.id === repositoryId)?.branches ?? [])
        : snapshot.branches,
      branchesError: null,
      activeBranch: branch?.name ?? null,
      historyRef: null,
      connection: "closed",
      sourceRevision: snapshot.sourceRevision + 1,
      status: "loading",
      error: null,
      history: [],
      historyHasMore: false,
      historyLoading: false,
      historyError: null,
      review: null,
      files: [],
      visibleFiles: [],
      semantic: null,
      notes: null,
      notesError: noteWriteRecovery,
      selectedFileId: null,
      filter: "",
    });
    try {
      const session = await api.json(
        `/api/session${path ? `?${query({ repo: path })}` : ""}`,
        sessionSchema,
        { signal: sessionAbort.signal },
      );
      if (disposed || generation !== workspaceGeneration) return;
      hasRepositoryCatalogue ||= session.repositories !== undefined;
      const id =
        session.repositoryId ??
        repositoryId ??
        snapshot.activeRepositoryId ??
        session.repository.path;
      const repositories =
        (catalogueVersion === catalogueGeneration ? session.repositories : undefined) ??
        (snapshot.repositories.length
          ? snapshot.repositories
          : [
              {
                id,
                path: session.repository.path,
                name: session.repository.name,
                branches: [],
                worktrees: session.worktrees,
              },
            ]);
      const activeBranch =
        branch?.name ??
        (session.repository.branch === "Detached HEAD" ? null : session.repository.branch || null);
      activeTarget = targetKey(id, session.repository.path, activeBranch);
      const saved = navigation.get(activeTarget);
      restoreFilePath = saved?.selectedFilePath ?? null;
      const branchSnapshot =
        branch && (!branch.worktreePath || session.repository.branch !== branch.name);
      const initialComparison = branchSnapshot
        ? { kind: "commit" as const, commit: branch.head }
        : ((!path && !branch ? session.initialComparison : undefined) ?? {
            kind: "working" as const,
          });
      const comparison =
        savedTarget?.comparison ??
        (saved &&
        !(branchSnapshot && ["working", "staged", "unstaged"].includes(saved.comparison.kind))
          ? saved.comparison
          : initialComparison);
      update({
        session,
        repositories,
        activeRepositoryId: id,
        branches: repositories.find((entry) => entry.id === id)?.branches ?? [],
        comparison,
        filter: saved?.filter ?? "",
        selectedFileId: saved?.selectedFileId ?? null,
        activeBranch,
        historyRef: branchSnapshot ? `refs/heads/${branch.name}` : null,
      });
      startEvents();
      await Promise.all([
        savedTarget ? loadSavedTarget(savedTarget) : selectComparison(comparison),
        loadHistory(true),
        loadBranches(),
      ]);
    } catch (error) {
      if (disposed || generation !== workspaceGeneration) return;
      if (savedTarget && path) {
        // A linked worktree can disappear after discovery. Recheck the family and
        // use its surviving checkout for navigation; the saved diff stays unchanged.
        try {
          const result = await api.json("/api/repositories", repositoriesSchema, {
            signal: sessionAbort.signal,
          });
          if (disposed || generation !== workspaceGeneration) return;
          const surviving = result.repositories.find(
            (entry) => entry.id === savedTarget.repositoryId,
          );
          update({ repositories: result.repositories });
          if (surviving && surviving.path !== path) {
            await openWorkspace(
              surviving.path,
              surviving.branches.find((entry) => entry.name === savedTarget.branch),
              surviving.id,
              savedTarget,
            );
            return;
          }
        } catch {
          if (disposed || generation !== workspaceGeneration) return;
        }
      }
      // An empty registry has no default session. Its catalogue remains available
      // so a fresh browser can show the normal Add repository action.
      if (!path && error instanceof HttpError && error.status === 403) {
        try {
          const result = await api.json("/api/repositories", repositoriesSchema, {
            signal: sessionAbort.signal,
          });
          if (disposed || generation !== workspaceGeneration) return;
          hasRepositoryCatalogue = true;
          await publishRepositories(result.repositories);
          return;
        } catch (catalogueError) {
          if (disposed || generation !== workspaceGeneration) return;
          update({ status: "error", error: message(catalogueError) });
          return;
        }
      }
      update({
        status: "error",
        error:
          savedReviewId && error instanceof HttpError && error.status === 401
            ? "Open the launch link shown by med to authorize this browser, then return to this review link."
            : message(error),
      });
    }
  }

  async function fetchSavedTarget(
    reviewId: string,
    targetId: string,
    signal: AbortSignal,
    /** Background work parses only while it still may. */
    mayParse = () => true,
  ) {
    const start = performance.now();
    const response = await api.json(
      `/api/reviews/${encodeURIComponent(reviewId)}/targets/${encodeURIComponent(targetId)}/review`,
      reviewSchema,
      { signal },
    );
    if (!mayParse()) throw new DOMException("A review load needs the parser.", "AbortError");
    const parseStart = performance.now();
    const parsed = await parse(response.patch);
    return {
      response,
      parsed,
      requestMs: parseStart - start,
      parseMs: performance.now() - parseStart,
    };
  }

  /** A target's diff, checked against the target it was saved as. */
  async function fetchSavedEntry(
    reviewId: string,
    target: SavedReviewTarget,
    work: ReturnType<typeof fetchSavedTarget>,
  ) {
    const { response, parsed, requestMs, parseMs } = await work;
    if (
      response.repo !== target.repo ||
      response.base !== target.base ||
      response.head !== target.head ||
      comparisonKey(response.comparison) !== comparisonKey(target.comparison)
    )
      throw new Error("The saved comparison does not match this review target.");
    const { files, document } = projectResponse(response, parsed);
    const entry: CachedReview = { response, files, document };
    // A saved target never changes, so its diff can show again without a read.
    reviewCache.set(savedKey(reviewId, target.id), entry, estimateRetainedBytes(entry));
    return { entry, requestMs, parseMs };
  }

  // Other iterations load one at a time while the review is idle, so choosing
  // one in the brief shows it at once. A load that the reviewer starts
  // stops this one, because the parser keeps only the latest request.
  let iterationAbort: AbortController | undefined;
  function prefetchIterations() {
    iterationAbort?.abort();
    const saved = snapshot.savedReview;
    if (!saved?.iterations?.length || suspended || disposed) return;
    const abort = new AbortController();
    iterationAbort = abort;
    const targets = saved.iterations
      .toReversed()
      .slice(0, 6)
      .flatMap((iteration) => saved.targets.filter((entry) => entry.id === iteration.targetIds[0]));
    const idle = () =>
      new Promise<void>((resolve) =>
        "requestIdleCallback" in globalThis
          ? requestIdleCallback(() => resolve(), { timeout: 1000 })
          : setTimeout(resolve, 200),
      );
    void (async () => {
      for (const target of targets) {
        await idle();
        const ready = () =>
          !abort.signal.aborted &&
          !suspended &&
          snapshot.status === "ready" &&
          snapshot.savedReview?.id === saved.id;
        if (!ready()) return;
        if (target.id === snapshot.savedTargetId || reviewCache.get(savedKey(saved.id, target.id)))
          continue;
        try {
          await fetchSavedEntry(
            saved.id,
            target,
            fetchSavedTarget(saved.id, target.id, abort.signal, ready),
          );
        } catch {
          return;
        }
      }
    })();
  }

  async function loadSavedTarget(target: SavedReviewTarget): Promise<void> {
    const saved = snapshot.savedReview;
    if (!saved || disposed) return;
    const early =
      prefetched?.reviewId === saved.id && prefetched.targetId === target.id
        ? prefetched.work
        : undefined;
    if (!early) prefetched?.abort.abort();
    prefetched = null;
    const generation = ++reviewGeneration;
    reviewAbort?.abort();
    reviewAbort = new AbortController();
    cancelSources();
    iterationAbort?.abort();
    update({
      savedView: true,
      savedTargetId: target.id,
      comparison: target.comparison,
      status: "loading",
      error: null,
    });
    const cached = reviewCache.get(savedKey(saved.id, target.id));
    if (cached) {
      publishReview(cached, generation, { requestMs: 0, parseMs: 0, cacheHit: true });
      prefetchIterations();
      return;
    }
    try {
      // A prefetch that failed, such as before its repository was added, is retried.
      const signal = reviewAbort.signal;
      const { entry, requestMs, parseMs } = await fetchSavedEntry(
        saved.id,
        target,
        early?.catch(() => fetchSavedTarget(saved.id, target.id, signal)) ??
          fetchSavedTarget(saved.id, target.id, signal),
      );
      if (!isCurrent(generation)) return;
      publishReview(entry, generation, { requestMs, parseMs, cacheHit: false });
      prefetchIterations();
    } catch (error) {
      if (isCurrent(generation)) update({ status: "error", error: message(error) });
    }
  }

  async function selectSavedTarget(id: string): Promise<void> {
    const target = snapshot.savedReview?.targets.find((entry) => entry.id === id);
    if (!target || disposed) return;
    const repository = snapshot.repositories.find((entry) => entry.id === target.repositoryId);
    if (!repository) {
      clearWorkspace();
      update({
        savedTargetId: id,
        savedView: true,
        status: "error",
        error: `Repository unavailable: ${target.repo}. Add this repository in Open branch, then select this review target again.`,
      });
      return;
    }
    const branch = repository.branches.find((entry) => entry.name === target.branch);
    const checkout = repository.worktrees.some((worktree) => worktree.path === target.repo)
      ? target.repo
      : repository.path;
    // Another iteration in the same checkout keeps the session, history, and
    // open files; only the comparison loads, so the view never goes blank.
    const current = snapshot.savedReview?.targets.find(
      (entry) => entry.id === snapshot.savedTargetId,
    );
    if (
      snapshot.savedView &&
      snapshot.session?.repository.path === checkout &&
      current?.repositoryId === target.repositoryId &&
      current.repo === target.repo &&
      current.branch === target.branch
    )
      await loadSavedTarget(target);
    else await openWorkspace(checkout, branch, target.repositoryId, target);
    if (!disposed && snapshot.savedTargetId === id) await refreshSavedMetadata().catch(() => {});
  }

  async function loadSources(path: string): Promise<SourceResponse> {
    const review = snapshot.review;
    if (!review || snapshot.status !== "ready")
      throw new Error("Wait for the current review to load.");
    if (!snapshot.files.some((file) => file.path === path))
      throw new Error("This file is not in the current review.");
    const generation = reviewGeneration;
    const key = JSON.stringify([review.id, path]);
    const file = snapshot.files.find((entry) => entry.path === path)!;
    const setSourceStatus = (
      status: { kind: "loading" } | { kind: "loaded"; text: string } | { kind: "error" },
    ) => {
      if (isCurrent(generation) && snapshot.semantic)
        update({
          semantic: reduceReviewState(snapshot.semantic, {
            type: "expansion/set-source-status",
            fileKey: file.id,
            status,
          }),
        });
    };
    const cached = sourceCache.get(key);
    if (cached) {
      setSourceStatus({ kind: "loaded", text: file.info.status === "D" ? cached.old : cached.new });
      return cached;
    }
    const pending = sourceRequests.get(key);
    if (pending) return pending.promise;
    if (sourceRequests.size >= 4)
      throw new Error("Four files are loading. Wait before expanding another file.");
    const abort = new AbortController();
    setSourceStatus({ kind: "loading" });
    const promise = api
      .json(
        savedTargetUrl()
          ? `${savedTargetUrl()}/source?${query({ path })}`
          : `/api/source?${query({ reviewId: review.id, path })}`,
        sourceSchema,
        {
          signal: abort.signal,
        },
      )
      .then((source) => {
        if (!isCurrent(generation)) throw new DOMException("The review changed.", "AbortError");
        if (source.reviewId !== review.id || source.path !== path)
          throw new Error("The source belongs to a different file version.");
        const bytes = estimateRetainedBytes(source);
        sourceCache.set(key, source, bytes);
        if (bytes <= sourceCache.maxBytes)
          setSourceStatus({
            kind: "loaded",
            text: file.info.status === "D" ? source.old : source.new,
          });
        else setSourceStatus({ kind: "error" });
        return source;
      })
      .catch((error: unknown) => {
        setSourceStatus({ kind: "error" });
        throw error;
      })
      .finally(() => {
        if (sourceRequests.get(key)?.abort === abort) sourceRequests.delete(key);
      });
    sourceRequests.set(key, { abort, promise });
    return promise;
  }

  interface NoteWrite {
    mutation: NoteMutation;
    temporaryId?: string;
    createdAt: string;
    resolve(): void;
    reject(error: unknown): void;
  }
  interface NoteQueue {
    key: string;
    url: string;
    savedId?: string;
    reviewId: string;
    authoritative: NoteState;
    pending: NoteWrite[];
    ids: Map<string, string>;
    failedIds: Set<string>;
  }
  // Keep server revisions separate from the visible projection. Each target owns its
  // revision; one write queue preserves action order and resolves temporary IDs.
  const noteQueues = new Map<string, NoteQueue>();
  const noteWrites: { queue: NoteQueue; write: NoteWrite }[] = [];
  let writingNotes = false;
  let noteWriteEpoch = 0;
  const noteIdleWaiters: (() => void)[] = [];
  const waitForNoteWrites = () =>
    writingNotes
      ? new Promise<void>((resolve) => noteIdleWaiters.push(resolve))
      : Promise.resolve();
  let temporaryNoteId = 0;
  function noteQueueKey(reviewId: string, url = savedNoteUrl() ?? "/api/notes") {
    return `${url}:${reviewId}`;
  }
  function resolvedMutation(queue: NoteQueue, mutation: NoteMutation): NoteMutation {
    const resolve = (id: string) => queue.ids.get(id) ?? id;
    return mutation.type === "add"
      ? {
          ...mutation,
          note: {
            ...mutation.note,
            ...(mutation.note.parentId ? { parentId: resolve(mutation.note.parentId) } : {}),
          },
        }
      : { ...mutation, id: resolve(mutation.id) };
  }
  function projectedNotes(queue: NoteQueue): NoteState {
    let notes = queue.authoritative.notes;
    for (const write of queue.pending) {
      const mutation = resolvedMutation(queue, write.mutation);
      if (mutation.type === "add") {
        if (mutation.note.parentId && !notes.some((note) => note.id === mutation.note.parentId))
          continue;
        notes = [
          ...notes,
          {
            ...mutation.note,
            id: write.temporaryId!,
            createdAt: write.createdAt,
            updatedAt: write.createdAt,
          },
        ];
      } else if (mutation.type === "edit") {
        notes = notes.map((note) =>
          note.id === mutation.id
            ? { ...note, text: mutation.text, updatedAt: write.createdAt }
            : note,
        );
      } else {
        notes = notes.filter((note) => note.id !== mutation.id);
      }
    }
    return {
      ...queue.authoritative,
      notes,
      revision: queue.authoritative.revision + queue.pending.length,
    };
  }
  function publishNotes(queue: NoteQueue, error: string | null = snapshot.notesError) {
    if (
      disposed ||
      snapshot.review?.id !== queue.reviewId ||
      noteQueueKey(queue.reviewId) !== queue.key
    )
      return;
    const notes = projectedNotes(queue);
    update({
      notes,
      notesError: error,
      semantic: snapshot.semantic ? projectAuthoritativeNotes(snapshot.semantic, notes) : null,
    });
  }
  async function drainNoteWrites() {
    if (writingNotes) return;
    writingNotes = true;
    try {
      while (noteWrites.length) {
        const { queue, write } = noteWrites[0];
        try {
          const mutation = resolvedMutation(queue, write.mutation);
          const dependency = mutation.type === "add" ? mutation.note.parentId : mutation.id;
          if (dependency && queue.failedIds.has(dependency))
            throw new Error("The original comment was not saved. Retry that comment first.");
          const beforeIds = new Set(queue.authoritative.notes.map((note) => note.id));
          const notes = await api.json(
            queue.url.endsWith("/notes") ? queue.url : `${queue.url}/notes`,
            notesSchema,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                reviewId: queue.reviewId,
                expectedRevision: queue.authoritative.revision,
                mutation,
              }),
            },
          );
          if (notes.reviewId !== queue.reviewId)
            throw new Error("Notes belong to a different review.");
          if (write.temporaryId && mutation.type === "add") {
            const added = notes.notes.find(
              (note) =>
                !beforeIds.has(note.id) &&
                note.path === mutation.note.path &&
                note.side === mutation.note.side &&
                note.line === mutation.note.line &&
                note.endLine === mutation.note.endLine &&
                note.text === mutation.note.text &&
                note.parentId === mutation.note.parentId,
            );
            if (added) queue.ids.set(write.temporaryId, added.id);
          }
          if (notes.revision >= queue.authoritative.revision) queue.authoritative = notes;
          queue.pending.shift();
          publishNotes(queue);
          write.resolve();
        } catch (error) {
          const previousCount = projectedNotes(queue).notes.length;
          queue.pending.shift();
          if (write.temporaryId) queue.failedIds.add(write.temporaryId);
          const nextCount = projectedNotes(queue).notes.length;
          if (queue.savedId && snapshot.savedReview?.id === queue.savedId)
            update({
              savedReview: {
                ...snapshot.savedReview,
                commentCount: Math.max(
                  0,
                  snapshot.savedReview.commentCount + nextCount - previousCount,
                ),
              },
            });
          if (error instanceof HttpError && error.status === 409) {
            try {
              const notes = await api.json(
                queue.url === "/api/notes"
                  ? `/api/notes?${query({ reviewId: queue.reviewId })}`
                  : `${queue.url}/notes`,
                notesSchema,
              );
              if (
                notes.reviewId === queue.reviewId &&
                notes.revision >= queue.authoritative.revision
              )
                queue.authoritative = notes;
            } catch {
              /* Keep the last confirmed state if reconciliation is unavailable. */
            }
          }
          const unsavedText =
            write.mutation.type === "add"
              ? write.mutation.note.text
              : write.mutation.type === "edit"
                ? write.mutation.text
                : null;
          const failedMutation = resolvedMutation(queue, write.mutation);
          const failedPath =
            failedMutation.type === "add"
              ? failedMutation.note.path
              : queue.authoritative.notes.find((note) => note.id === failedMutation.id)?.path;
          const failure = unsavedText
            ? `Comment was not saved (${failedPath ?? queue.reviewId}). ${message(error)} Unsaved comment: ${unsavedText}`
            : message(error);
          noteWriteRecovery = noteWriteRecovery ? `${noteWriteRecovery}\n${failure}` : failure;
          publishNotes(queue, noteWriteRecovery);
          if (snapshot.review?.id !== queue.reviewId || noteQueueKey(queue.reviewId) !== queue.key)
            update({ notesError: noteWriteRecovery });
          write.reject(error);
        } finally {
          noteWrites.shift();
        }
      }
    } finally {
      writingNotes = false;
      for (const resolve of noteIdleWaiters.splice(0)) resolve();
      if (snapshot.savedReview) void refreshSavedMetadata().catch(() => {});
    }
  }
  async function mutateNote(mutation: NoteMutation): Promise<void> {
    const review = snapshot.review;
    const current = snapshot.notes;
    if (!review || !current || current.reviewId !== review.id || snapshot.status !== "ready")
      throw new Error("Wait for notes to load.");
    if (mutation.type === "remove") validateReviewNoteRemoval(mutation.id, current.notes);
    else validateReviewNoteText(mutation.type === "add" ? mutation.note.text : mutation.text);
    const url = savedNoteUrl() ?? "/api/notes";
    const key = noteQueueKey(review.id, url);
    let queue = noteQueues.get(key);
    if (!queue) {
      queue = {
        key,
        url,
        savedId: snapshot.savedReview?.id,
        reviewId: review.id,
        authoritative: current,
        pending: [],
        ids: new Map(),
        failedIds: new Set(),
      };
      noteQueues.set(key, queue);
    }
    const activeQueue = queue;
    noteWriteEpoch += 1;
    noteWriteRecovery = null;
    return new Promise<void>((resolve, reject) => {
      const write: NoteWrite = {
        mutation,
        temporaryId: mutation.type === "add" ? `optimistic-note-${++temporaryNoteId}` : undefined,
        createdAt: new Date().toISOString(),
        resolve,
        reject,
      };
      const before = projectedNotes(activeQueue).notes.length;
      activeQueue.pending.push(write);
      const delta = projectedNotes(activeQueue).notes.length - before;
      if (activeQueue.savedId && snapshot.savedReview?.id === activeQueue.savedId) {
        update({
          savedReview: {
            ...snapshot.savedReview,
            commentCount: snapshot.savedReview.commentCount + delta,
          },
        });
      }
      publishNotes(activeQueue, null);
      noteWrites.push({ queue: activeQueue, write });
      void drainNoteWrites();
    });
  }

  // An agent added an iteration: show its brief, and its comparison unless
  // the review shows an earlier one on purpose.
  const reloadSaved = async (event: Event) => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    const before = snapshot.savedReview;
    if (disposed || !before || id !== before.id) return;
    const shown = snapshot.savedTargetId;
    const wasCurrent = !shown || currentTargets(before).some((target) => target.id === shown);
    const savedReview = await api
      .json(`/api/reviews/${encodeURIComponent(before.id)}`, savedReviewSchema)
      .catch(() => null);
    if (!savedReview || disposed || snapshot.savedReview?.id !== before.id) return;
    update({ savedReview });
    const next = currentTargets(savedReview)[0];
    if (wasCurrent && snapshot.savedView && next && next.id !== snapshot.savedTargetId)
      await selectSavedTarget(next.id);
  };
  if (savedReviewId && typeof window !== "undefined") {
    window.addEventListener("focus", refreshSavedOnFocus);
    document.addEventListener("visibilitychange", refreshSavedOnVisibility);
    window.addEventListener(REVIEW_UPDATED, reloadSaved);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async initialize() {
      // Until the catalogue answers, a workspace is loading, not empty: the
      // "Add a repository" page shows only when the host has none.
      update({ status: "loading" });
      if (!savedReviewId) {
        const start = options.start;
        // A branch opens once, at its worktree or at its head commit, so the
        // catalogue comes first.
        if (start?.branch)
          try {
            const result = await api.json("/api/repositories", repositoriesSchema);
            if (disposed) return;
            hasRepositoryCatalogue = true;
            update({ repositories: result.repositories });
            const repository =
              result.repositories.find((entry) => entry.id === start.repositoryId) ??
              result.repositories.find((entry) => entry.path === start.path);
            const branch = repository?.branches.find((entry) => entry.name === start.branch);
            if (repository && branch)
              return openWorkspace(branch.worktreePath ?? repository.path, branch, repository.id);
          } catch {
            /* The path alone still opens the repository. */
          }
        return openWorkspace(start?.path, undefined, start?.repositoryId);
      }
      try {
        const savedReview = await api.json(
          `/api/reviews/${encodeURIComponent(savedReviewId)}`,
          savedReviewSchema,
        );
        if (disposed) return;
        update({ savedReview });
        const first = currentTargets(savedReview)[0] ?? savedReview.targets[0];
        if (first) {
          const abort = new AbortController();
          const work = fetchSavedTarget(savedReview.id, first.id, abort.signal);
          work.catch(() => {});
          prefetched = { reviewId: savedReview.id, targetId: first.id, abort, work };
        }
        const result = await api.json("/api/repositories", repositoriesSchema);
        if (disposed) return;
        hasRepositoryCatalogue = true;
        update({ repositories: result.repositories });
        if (!first) throw new Error("This review has no targets.");
        await selectSavedTarget(first.id);
      } catch (error) {
        update({
          status: "error",
          error:
            error instanceof HttpError && error.status === 401
              ? "Open the launch link shown by med to authorize this browser, then return to this review link."
              : message(error),
        });
      }
    },
    selectSavedTarget,
    returnToSavedReview: () =>
      snapshot.savedTargetId ? selectSavedTarget(snapshot.savedTargetId) : Promise.resolve(),
    async copyFeedback() {
      await waitForNoteWrites();
      const saved = snapshot.savedReview;
      if (!saved) throw new Error("Open a saved review first.");
      const writeEpoch = noteWriteEpoch;
      const feedback = await api.json(
        `/api/reviews/${encodeURIComponent(saved.id)}/feedback`,
        savedFeedbackSchema,
      );
      await navigator.clipboard.writeText(feedback.text);
      if (
        !writingNotes &&
        writeEpoch === noteWriteEpoch &&
        snapshot.savedReview?.id === saved.id &&
        feedback.revision >= snapshot.savedReview.revision
      )
        update({
          savedReview: {
            ...snapshot.savedReview,
            revision: feedback.revision,
            commentCount: feedback.count,
          },
        });
      return feedback;
    },
    async clearSavedComments(expectedRevision) {
      await waitForNoteWrites();
      const saved = snapshot.savedReview;
      if (!saved) return;
      try {
        const cleared = await api.json(
          `/api/reviews/${encodeURIComponent(saved.id)}/clear`,
          savedReviewSchema,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ expectedRevision }),
          },
        );
        if (disposed || snapshot.savedReview?.id !== saved.id) return;
        if (cleared.revision >= snapshot.savedReview.revision) update({ savedReview: cleared });
        // Clearing spans all targets, including one selected while the request was pending.
        if (snapshot.review) await loadNotes(snapshot.review.id, reviewGeneration);
      } catch (error) {
        await refreshSavedMetadata();
        throw error;
      }
    },
    async setSavedBrief(text) {
      const saved = snapshot.savedReview;
      if (!saved) throw new Error("Open a saved review to attach a brief.");
      const next = await api.json(
        `/api/reviews/${encodeURIComponent(saved.id)}/brief`,
        savedReviewSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: text }),
        },
      );
      if (disposed || snapshot.savedReview?.id !== saved.id) return;
      // A brief change does not move the comment revision. Keep newer comment counts.
      update({
        savedReview:
          next.revision >= snapshot.savedReview.revision
            ? next
            : { ...snapshot.savedReview, brief: next.brief },
      });
    },
    async pinToReview(mutation) {
      const saved = snapshot.savedReview;
      if (!saved) throw new Error("Open a saved review to pin a reply.");
      const next = await api.json(
        `/api/reviews/${encodeURIComponent(saved.id)}/pins`,
        savedReviewSchema,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(mutation),
        },
      );
      if (disposed || snapshot.savedReview?.id !== saved.id) return;
      // Pins do not move the comment revision. Keep newer comment counts.
      update({
        savedReview:
          next.revision >= snapshot.savedReview.revision
            ? next
            : { ...snapshot.savedReview, pins: next.pins, iterations: next.iterations },
      });
    },
    async startSession(preset) {
      const saved = snapshot.savedReview;
      if (!saved) throw new Error("Open a saved review to start a session.");
      const result = await api.json(
        `/api/reviews/${encodeURIComponent(saved.id)}/owned`,
        z.object({ review: savedReviewSchema, state: z.object({ sessionId: z.string() }) }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preset, targetId: snapshot.savedTargetId ?? undefined }),
        },
      );
      if (!disposed && snapshot.savedReview?.id === saved.id)
        update({
          savedReview:
            result.review.revision >= snapshot.savedReview.revision
              ? result.review
              : { ...snapshot.savedReview, sessions: result.review.sessions },
        });
      return result.state.sessionId;
    },
    async saveReview({ title, brief }) {
      const repo = snapshot.session?.repository.path;
      const comparison = snapshot.comparison;
      if (!repo || snapshot.session?.repository.git === false)
        throw new Error("Open a Git repository to save a review.");
      if (comparison.kind === "files" || comparison.kind === "patch")
        throw new Error("Saved reviews support Git comparisons and working changes.");
      const created = await api.json("/api/reviews", savedReviewSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          ...(brief ? { brief } : {}),
          targets: [{ repo, comparison }],
        }),
      });
      return created.id;
    },
    selectWorktree(path, repositoryId) {
      if (snapshot.session?.repository.git === false) {
        update({ error: "Worktrees are not available for this input." });
        return Promise.resolve();
      }
      const repository = repositoryId
        ? snapshot.repositories.find((entry) => entry.id === repositoryId)
        : snapshot.repositories.find((entry) =>
            entry.worktrees.some((worktree) => worktree.path === path),
          );
      if (
        hasRepositoryCatalogue &&
        (!repository || !repository.worktrees.some((worktree) => worktree.path === path))
      )
        return Promise.resolve();
      return openWorkspace(
        path,
        undefined,
        repository?.id ?? snapshot.activeRepositoryId ?? undefined,
      );
    },
    selectBranch(name, repositoryId) {
      const repository = snapshot.repositories.find(
        (entry) => entry.id === (repositoryId ?? snapshot.activeRepositoryId),
      );
      const branch = repository?.branches.find((entry) => entry.name === name);
      if (!branch || !repository || snapshot.session?.repository.git === false)
        return Promise.resolve();
      return openWorkspace(branch.worktreePath ?? repository.path, branch, repository.id);
    },
    refreshRepositories,
    addRepository,
    removeRepository,
    selectComparison: (comparison) => selectComparison(comparison),
    refresh,
    suspend() {
      if (suspended || disposed) return;
      suspended = true;
      iterationAbort?.abort();
      stopEvents();
    },
    resume() {
      if (!suspended || disposed) return;
      suspended = false;
      if (!snapshot.session) return;
      startEvents();
      if (snapshot.savedReview) refreshSavedOnFocus();
      reconcile();
    },
    loadMoreHistory: () => loadHistory(false),
    async loadCommitDetails(id, signal) {
      const repo = snapshot.session?.repository.path;
      if (!repo) throw new Error("Open a repository first.");
      return api.json(`/api/commit?${query({ repo, id })}`, commitDetailsSchema, { signal });
    },
    async loadPullRequestComments(refresh = false) {
      const saved = snapshot.savedReview;
      if (!saved?.pullRequestUrl) throw new Error("This review has no pull request.");
      return api.json(
        `/api/reviews/${encodeURIComponent(saved.id)}/pull-request${refresh ? "?refresh=1" : ""}`,
        pullRequestCommentsSchema,
      );
    },
    async revealPath(repo, path) {
      await api.json("/api/reveal", revealSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, path }),
      });
    },
    loadSources,
    mutateNote,
    revealFile(id) {
      if (!snapshot.files.some((file) => file.id === id)) return;
      const semantic = snapshot.semantic
        ? reduceReviewState(snapshot.semantic, {
            type: "selection/select",
            fileKey: id,
            hunkIndex: 0,
            reveal: { anchor: "file-top", scrollToNote: false },
          })
        : null;
      update({ selectedFileId: id, semantic });
    },
    setFilter(filter) {
      const visibleFiles = filtered(snapshot.files, filter);
      const selectedFileId = visibleFiles.some((file) => file.id === snapshot.selectedFileId)
        ? snapshot.selectedFileId
        : (visibleFiles[0]?.id ?? null);
      const semantic = snapshot.semantic
        ? reduceReviewState(snapshot.semantic, { type: "filter/set", filter })
        : null;
      update({ filter, visibleFiles, selectedFileId, semantic });
    },
    dispose() {
      disposed = true;
      prefetched?.abort.abort();
      prefetched = null;
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", refreshSavedOnFocus);
        document.removeEventListener("visibilitychange", refreshSavedOnVisibility);
        window.removeEventListener(REVIEW_UPDATED, reloadSaved);
      }
      ++catalogueGeneration;
      catalogueAbort?.abort();
      navigation.clear();
      ++branchGeneration;
      branchAbort?.abort();
      ++workspaceGeneration;
      ++reviewGeneration;
      ++historyGeneration;
      sessionAbort?.abort();
      reviewAbort?.abort();
      historyAbort?.abort();
      iterationAbort?.abort();
      stopEvents();
      cancelSources();
      reviewCache.clear();
      sourceCache.clear();
      listeners.clear();
    },
  };
}

export function useReviewController(controller: ReviewController): ReviewControllerSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
