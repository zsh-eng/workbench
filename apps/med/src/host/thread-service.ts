import type { AgentStatus } from "../shared/agent-status";
import type { AgentMessage } from "../shared/agent-inbox";
import type { FoundUpdate } from "../shared/found-sessions";
import { baseOf, changesBase, type RegisteredRepository } from "../shared/protocol";
import {
  handoffTargets,
  reviewCheckout,
  type AgentSession,
  type SavedReview,
} from "../shared/saved-review";
import {
  parseSessionKey,
  REVIEW_ID,
  sessionKey,
  threadOfReview,
  type Thread,
  type ThreadList,
  type ThreadReview,
} from "../shared/threads";
import { findTranscript, transcriptPrompt } from "./agent-transcripts";
import { HostError } from "./runtime/errors";
import type { SavedReviewStore } from "./saved-reviews";
import type { Checkout, IndexedSession, SessionIndex } from "./session-index";
import type { ThreadPlace, ThreadStore } from "./thread-store";
import type { createThreadSubagents } from "./thread-subagents";
import type { createCheckoutWork } from "./checkout-work";
import type { createPullRequestLinks } from "./pull-request-links";
import type { createCheckoutChanges } from "./checkout-changes";

// The threads of the host: the tabs, which the thread list polls, and the
// archive, which a picker reads when it opens. A thread is an agent session,
// whatever folder it works in, with the reviews that it handed off; or a
// review that no session handed off. See thread-store.ts for the store, and
// docs/usage/threads.md for the rules.

const DAY = 24 * 60 * 60 * 1000;
/** A tab lists subagents while its session changed within this time. */
const SUBAGENTS_MS = DAY;
/** The list of saved reviews is read again after this time, or after a write. */
const INDEX_MS = 30_000;
/** An archived thread is forgotten this long after it was archived; a
 * review's captures go with it. */
export const ARCHIVE_KEPT_MS = 180 * DAY;

type IndexedReview = SavedReview & { modifiedAt: number };

export interface ThreadServiceOptions {
  savedReviews: SavedReviewStore;
  store: ThreadStore;
  sessions: Pick<SessionIndex, "found" | "session" | "known" | "place" | "update" | "settings">;
  repositories(): RegisteredRepository[];
  /** The state of a thread's session: Med's runner, else its transcript. */
  status(threadId: string, sessions: AgentSession[]): Promise<AgentStatus | undefined>;
  lastMessage(threadId: string): Promise<AgentMessage | undefined>;
  /** The sessions that Med runs, with the agent's own ID of one that runs
   * through ACP, such as a Codex rollout's: that transcript is the same
   * session, not a thread of its own. */
  owned(): { session: AgentSession; agentId?: string }[];
  checkoutWork: ReturnType<typeof createCheckoutWork>;
  /** Finds the pull request that a tab's branch opened later. */
  pullRequestLinks?: Pick<ReturnType<typeof createPullRequestLinks>, "check">;
  /** The counts of a checkout's live Changes. */
  checkoutChanges?: Pick<ReturnType<typeof createCheckoutChanges>, "get">;
  subagents: ReturnType<typeof createThreadSubagents>;
  /** Removes a linked worktree that Med made, as `git worktree remove` does. */
  removeWorktree(path: string, signal: AbortSignal): Promise<void>;
  now?: () => number;
  home?: () => string;
}

/** A review's thread: its session's key, or the review's own ID. */

/** What a thread lists of one of its reviews. */
function reviewSummary(review: IndexedReview): ThreadReview {
  const checkout = reviewCheckout(review);
  return {
    id: review.id,
    title: review.pullRequestTitle ?? review.title,
    createdAt: review.createdAt,
    updatedAt: review.modifiedAt,
    ...(checkout && { repo: checkout.repo }),
    ...(checkout?.branch && { branch: checkout.branch }),
    ...(review.pullRequestUrl && { pullRequestUrl: review.pullRequestUrl }),
    ...(review.totals &&
      handoffTargets(review).length && {
        changes: {
          files: review.totals.files,
          additions: review.totals.additions,
          deletions: review.totals.deletions,
        },
      }),
  };
}

/** The place of a registered checkout, as a thread shows it. */
function placeOf(checkout: Checkout): ThreadPlace {
  return {
    repository: checkout.repository,
    checkout: checkout.path,
    ...(checkout.branch && checkout.branch !== "Detached HEAD" && { branch: checkout.branch }),
    ...(checkout.linked && { linked: true }),
  };
}

/**
 * Marks the tabs whose checkout is shared: a repository's main checkout, or
 * a worktree where more than one session works. Their Changes offer "Only
 * this session's files".
 */
function markShared(threads: Thread[]) {
  const transcript = (thread: Thread) =>
    !!thread.checkout && !!thread.session && thread.session.agent !== "acp";
  const counts = new Map<string, number>();
  for (const thread of threads)
    if (transcript(thread)) counts.set(thread.checkout!, (counts.get(thread.checkout!) ?? 0) + 1);
  for (const thread of threads)
    if (transcript(thread) && (!thread.linked || counts.get(thread.checkout!)! > 1))
      thread.shared = true;
}

export function createThreadService(options: ThreadServiceOptions) {
  const { savedReviews, store } = options;
  const now = options.now ?? Date.now;
  let index: { at: number; changes: number; reviews: IndexedReview[] } | undefined;
  let indexing: Promise<IndexedReview[]> | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  /** Archived sessions whose first prompt was looked for. */
  const prompted = new Set<string>();
  let prompting: Promise<void> | undefined;

  /**
   * Every saved review's description, read again after a write or after
   * INDEX_MS. A review that the store does not know, such as a hand-off from
   * a terminal, opens its thread as a tab.
   */
  const reviewIndex = async (): Promise<IndexedReview[]> => {
    if (index && index.changes === savedReviews.changes && now() - index.at < INDEX_MS)
      return index.reviews;
    indexing ??= (async () => {
      const changes = savedReviews.changes;
      const reviews = await savedReviews.list();
      const known = new Set(index?.reviews.map((review) => review.id));
      for (const review of reviews) {
        if (index && known.has(review.id)) continue;
        const id = threadOfReview(review);
        if (!store.known(id))
          store.open(id, review.session ? { session: review.session, kept: true } : {});
        // A session that hands off a review is kept, wherever it works.
        else if (review.session && !store.entry(id)?.kept)
          store.remember(id, { kept: true, session: store.entry(id)?.session ?? review.session });
      }
      index = { at: now(), changes, reviews };
      return reviews;
    })().finally(() => {
      indexing = undefined;
    });
    return indexing;
  };

  /** The reviews of each thread, newest first. */
  const reviewsByThread = (reviews: readonly IndexedReview[]) => {
    const byThread = new Map<string, IndexedReview[]>();
    for (const review of reviews) {
      const id = threadOfReview(review);
      byThread.set(id, [...(byThread.get(id) ?? []), review]);
    }
    for (const list of byThread.values()) list.sort((a, b) => b.modifiedAt - a.modifiedAt);
    return byThread;
  };

  /** The repository of a checkout's path. */
  const familyOf = (repositories: readonly RegisteredRepository[], path?: string) =>
    path
      ? repositories.find(
          (entry) => entry.path === path || entry.worktrees.some((tree) => tree.path === path),
        )
      : undefined;

  /** The place of a review: its checkout, with the branch as it is now. */
  const reviewPlace = (
    review: IndexedReview,
    repositories: readonly RegisteredRepository[],
  ): ThreadPlace => {
    const checkout = reviewCheckout(review);
    if (!checkout) return {};
    const family =
      repositories.find((entry) => entry.id === checkout.repositoryId) ??
      familyOf(repositories, checkout.repo);
    // The checkout's branch as it is now: an agent can switch it.
    const tree = family?.worktrees.find((entry) => entry.path === checkout.repo);
    const branch = tree
      ? tree.branch && tree.branch !== "Detached HEAD"
        ? tree.branch
        : undefined
      : (checkout.branch ?? undefined);
    return {
      ...(family && { repository: { id: family.id, name: family.name, path: family.path } }),
      checkout: checkout.repo,
      ...(branch && { branch }),
      ...(tree?.linked && { linked: true }),
    };
  };

  /** A thread with the reader's name, pin, and marks. */
  const named = (thread: Thread): Thread => {
    const entry = store.entry(thread.id);
    const place = store.pins().indexOf(thread.id);
    return {
      ...thread,
      ...(entry?.name && { title: entry.name, agentTitle: thread.title }),
      ...(place >= 0 && { pinned: place + 1 }),
      ...(entry?.closedAt !== undefined && { closedAt: entry.closedAt }),
      ...(entry?.prompt && !thread.prompt && { prompt: entry.prompt }),
    };
  };

  /** The session of a session thread: the store's, else its newest review's,
   * else its key's, without a folder yet. */
  const sessionOf = (id: string, reviews: readonly IndexedReview[]): AgentSession | undefined => {
    const entry = store.entry(id);
    if (entry?.session) return entry.session;
    const handed = reviews.find((review) => review.session)?.session;
    if (handed) return handed;
    const parsed = parseSessionKey(id);
    return parsed && { ...parsed, cwd: "/" };
  };

  /** A session thread as the store and its reviews know it, without reading
   * its agent: for the archive. */
  const coldSession = (
    id: string,
    session: AgentSession,
    reviews: readonly IndexedReview[],
  ): Thread => {
    const entry = store.entry(id);
    const newest = reviews[0];
    const place = entry?.place ?? {};
    // The last scan's read, without reading the transcript again.
    const scanned = options.sessions.known(id);
    return {
      id,
      kind: "session",
      title: entry?.title ?? newest?.title ?? "Agent session",
      createdAt:
        entry?.createdAt ??
        reviews.at(-1)?.createdAt ??
        new Date(entry?.updatedAt ?? now()).toISOString(),
      updatedAt: Math.max(entry?.updatedAt ?? 0, newest?.modifiedAt ?? 0, scanned?.mtimeMs ?? 0),
      ...place,
      ...(entry?.base && { base: entry.base }),
      agent: session.agent,
      ...(scanned && { state: scanned.working ? "working" : "idle" }),
      session,
      reviews: reviews.map(reviewSummary),
      ...(newest?.pullRequestUrl && { pullRequestUrl: newest.pullRequestUrl }),
    };
  };

  /** A tab of a session, with its agent's state and where it works now. */
  const sessionTab = async (
    id: string,
    reviews: readonly IndexedReview[],
    repositories: readonly RegisteredRepository[],
  ): Promise<Thread | undefined> => {
    const known = sessionOf(id, reviews);
    if (!known) return undefined;
    const entry = store.entry(id);
    const read =
      known.agent === "acp"
        ? undefined
        : await options.sessions
            .session({ agent: known.agent, id: known.id })
            .catch(() => undefined);
    const session: AgentSession = { ...known, ...(read?.cwd && { cwd: read.cwd }) };
    const status = await options.status(id, [session]).catch(() => undefined);
    // Where it works now: the newest of its folders in a checkout; a session
    // that Med runs through ACP has no transcript, only its folder.
    const checkout =
      read?.checkout ??
      (session.cwd !== "/" ? await options.sessions.place([session.cwd]) : undefined);
    const place = checkout ? placeOf(checkout) : read ? {} : (entry?.place ?? {});
    const newest = reviews[0];
    const family = repositories.find((repository) => repository.id === place.repository?.id);
    const base = place.checkout ? changesBase(family, place.branch, entry?.base) : undefined;
    const live =
      place.checkout && base !== undefined
        ? options.checkoutChanges?.get(place.checkout, base, status?.updatedAt)
        : undefined;
    const pullRequestUrl = newest?.pullRequestUrl;
    // A branch other than the base can have a pull request that opened after
    // the review did; it links to the newest review on that branch.
    const onBranch = reviews.find(
      (review) => reviewCheckout(review)?.repo === place.checkout && !review.pullRequestUrl,
    );
    if (onBranch && place.checkout && place.branch && base)
      options.pullRequestLinks?.check(onBranch.id, place.checkout, place.branch);
    const reply = await options.lastMessage(id).catch(() => undefined);
    const thread: Thread = {
      id,
      kind: "session",
      title: read?.title ?? entry?.title ?? newest?.title ?? "Agent session",
      createdAt:
        (read && new Date(read.createdAt).toISOString()) ??
        entry?.createdAt ??
        new Date(now()).toISOString(),
      updatedAt: Math.max(
        read?.mtimeMs ?? 0,
        status?.updatedAt ?? 0,
        newest?.modifiedAt ?? 0,
        entry?.updatedAt ?? 0,
      ),
      ...place,
      ...(entry?.base && { base: entry.base }),
      agent: session.agent,
      state: status?.state ?? (read?.working ? "working" : "idle"),
      session,
      reviews: reviews.map(reviewSummary),
      ...((live ?? newest?.totals) && {
        changes: live ?? {
          files: newest!.totals!.files,
          additions: newest!.totals!.additions,
          deletions: newest!.totals!.deletions,
        },
      }),
      ...(pullRequestUrl && { pullRequestUrl }),
      ...(options.owned().some((owned) => owned.session.id === session.id) && { owned: true }),
      ...((status?.turn ?? read?.turn) && { turn: status?.turn ?? read?.turn }),
      ...(status?.halt && { halt: status.halt }),
      ...(read?.prompt && { prompt: read.prompt }),
      ...(reply && {
        replied: {
          at: Date.parse(reply.createdAt),
          text: (reply.text || `${reply.noteIds.length} comments`).slice(0, 200),
          delivery: reply.delivery,
        },
      }),
      open: true,
    };
    store.remember(id, {
      session,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      place,
      ...(read?.prompt && !entry?.prompt && { prompt: read.prompt }),
    });
    return thread;
  };

  /** A tab of a review that no session handed off. */
  const reviewTab = (review: IndexedReview, repositories: readonly RegisteredRepository[]) => {
    const summary = reviewSummary(review);
    return {
      id: review.id,
      kind: "review",
      title: summary.title,
      createdAt: review.createdAt,
      updatedAt: review.modifiedAt,
      ...reviewPlace(review, repositories),
      reviews: [summary],
      ...(summary.changes && { changes: summary.changes }),
      ...(review.pullRequestUrl && { pullRequestUrl: review.pullRequestUrl }),
    } satisfies Thread;
  };

  /** Adds the subagents of a tab's Claude session that changed lately. */
  const withSubagents = async (thread: Thread): Promise<Thread> => {
    const session = thread.session;
    if (session?.agent !== "claude" || now() - thread.updatedAt > SUBAGENTS_MS) return thread;
    const subagents = await options.subagents.of(session).catch(() => []);
    return subagents.length ? { ...thread, subagents } : thread;
  };

  /** The agent's own IDs of the sessions that Med runs through ACP: the same
   * sessions, not threads of their own. */
  const aliasIds = () =>
    new Set(options.owned().flatMap((entry) => (entry.agentId ? [entry.agentId] : [])));

  /** Found sessions that work now open as tabs, once each. The result names
   * the aliases (`aliasIds`), which never do. */
  const openNewSessions = () => {
    const aliases = aliasIds();
    for (const session of options.sessions.found()) {
      if (aliases.has(session.id) || store.known(session.key)) continue;
      // A found session opens as a tab once: when Med first sees it work.
      if (session.working)
        store.open(session.key, {
          session: { agent: session.agent, id: session.id, cwd: session.cwd },
        });
    }
    return aliases;
  };

  /** Looks for the first prompts of archived sessions, a few at a time. */
  const fillPrompts = (threads: readonly Thread[]) => {
    if (prompting) return;
    const due = threads
      .filter(
        (thread) =>
          !thread.prompt &&
          !prompted.has(thread.id) &&
          thread.session &&
          thread.session.agent !== "acp",
      )
      .slice(0, 20);
    if (!due.length) return;
    prompting = (async () => {
      for (const thread of due) {
        prompted.add(thread.id);
        const session = thread.session!;
        const path = await findTranscript(session, options.home?.()).catch(() => undefined);
        const prompt = path
          ? await transcriptPrompt(session, path).catch(() => undefined)
          : undefined;
        if (prompt) store.setPrompt(thread.id, prompt);
      }
      await store.save().catch(() => {});
    })().finally(() => {
      prompting = undefined;
    });
  };

  const requireKnown = async (id: string) => {
    await reviewIndex();
    if (!store.known(id))
      throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
  };

  const service = {
    /** The tabs, with their agents' states and Git work. */
    async list(): Promise<ThreadList> {
      const repositories = options.repositories();
      const reviews = await reviewIndex();
      const byId = new Map(reviews.map((review) => [review.id, review]));
      const byThread = reviewsByThread(reviews);
      const aliases = openNewSessions();
      const ids = store.openIds();
      const listed = await Promise.all(
        ids.map(async (id) => {
          if (REVIEW_ID.test(id)) {
            const review = byId.get(id);
            // A review that a session handed off is in the session's thread.
            if (!review || review.session) return undefined;
            const tab = reviewTab(review, repositories);
            // Its branch can have a pull request that opened after the review.
            const family = repositories.find((entry) => entry.id === tab.repository?.id);
            if (
              !tab.pullRequestUrl &&
              tab.checkout &&
              tab.branch &&
              changesBase(family, tab.branch)
            )
              options.pullRequestLinks?.check(review.id, tab.checkout, tab.branch);
            return { ...tab, open: true };
          }
          const parsed = parseSessionKey(id);
          if (!parsed || aliases.has(parsed.id)) return undefined;
          return sessionTab(id, byThread.get(id) ?? [], repositories);
        }),
      );
      // A tab whose record is gone, such as a review deleted outside Med,
      // leaves. Only with an index that has every saved review: a review saved
      // while this read ran is a tab that the index does not have yet.
      if (index?.changes === savedReviews.changes)
        ids.forEach((id, at) => {
          if (!listed[at] && REVIEW_ID.test(id)) store.forget(id);
        });
      const threads = await Promise.all(
        listed.flatMap((thread) => (thread ? [withSubagents(thread)] : [])),
      );
      void store.save().catch(() => {});
      markShared(threads);
      return {
        threads: options.checkoutWork.annotate(
          threads.map((thread) => ({ ...named(thread), seen: store.seen(thread.id) })),
          repositories,
          // Uncommitted changes are a session's work in a checkout of its own;
          // in a shared one, such as the main checkout, they may be others'.
          (thread) => thread.kind === "session" && !thread.shared,
        ),
        repositories: repositories.map((entry) => {
          const branch = baseOf(entry);
          return {
            id: entry.id,
            name: entry.name,
            path: entry.path,
            ...(branch && branch !== "Detached HEAD" && { branch }),
          };
        }),
        found: options.sessions.settings(),
      };
    },

    /** Archived threads, and found sessions that are not tabs, newest first. */
    async history(): Promise<Thread[]> {
      const reviews = await reviewIndex();
      const repositories = options.repositories();
      const byThread = reviewsByThread(reviews);
      const threads: Thread[] = [];
      const listed = new Set<string>();
      for (const entry of store.closed()) {
        if (REVIEW_ID.test(entry.id)) {
          const review = reviews.find((item) => item.id === entry.id);
          if (review && !review.session)
            threads.push({ ...reviewTab(review, repositories), open: false });
          listed.add(entry.id);
          continue;
        }
        const own = byThread.get(entry.id) ?? [];
        const session = sessionOf(entry.id, own);
        if (!session) continue;
        listed.add(entry.id);
        threads.push({ ...coldSession(entry.id, session, own), open: false });
      }
      const aliases = aliasIds();
      for (const session of options.sessions.found()) {
        if (listed.has(session.key) || store.isOpen(session.key) || aliases.has(session.id))
          continue;
        threads.push({
          ...foundThread(session, byThread.get(session.key) ?? []),
          open: false,
        });
      }
      // Newest first, by when they were archived; the threads archived
      // together by their last change.
      const listedThreads = threads.map(named);
      const time = (thread: Thread) => Math.max(thread.closedAt ?? 0, thread.updatedAt);
      listedThreads.sort((a, b) => time(b) - time(a) || b.updatedAt - a.updatedAt);
      fillPrompts(listedThreads);
      return listedThreads;
    },

    /** Opens a thread as a tab and returns it. */
    async open(id: string): Promise<Thread> {
      const reviews = await reviewIndex();
      if (REVIEW_ID.test(id)) {
        const review = reviews.find((entry) => entry.id === id);
        if (!review)
          throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
        // A session's review opens its session's thread.
        if (review.session) return service.open(threadOfReview(review));
        store.open(id);
        await store.save();
        return named({ ...reviewTab(review, options.repositories()), open: true });
      }
      const parsed = parseSessionKey(id);
      if (!parsed) throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      const own = reviewsByThread(reviews).get(id) ?? [];
      let session = sessionOf(id, own);
      if (!store.known(id) && parsed.agent !== "acp") {
        const read = await options.sessions
          .session({ agent: parsed.agent, id: parsed.id })
          .catch(() => undefined);
        if (!read) throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
        session = { agent: read.agent, id: read.id, cwd: read.cwd };
      }
      store.open(id, { ...(session && { session }) });
      await store.save();
      const thread =
        (await sessionTab(id, own, options.repositories()).catch(() => undefined)) ??
        coldSession(id, session!, own);
      await store.save().catch(() => {});
      return named({ ...thread, open: true });
    },

    /** Keeps a session in Med as a tab: Med started it, or the reader kept
     * it. `prompt` names a session that Med starts with it. */
    async keep(
      session: AgentSession,
      details: { prompt?: string; title?: string; superagent?: boolean } = {},
    ) {
      const id = sessionKey(session);
      store.open(id, {
        session,
        kept: true,
        ...(details.prompt && { prompt: details.prompt }),
        ...(details.superagent && { superagent: true }),
      });
      if (details.title && !store.entry(id)?.title) store.remember(id, { title: details.title });
      await store.save();
      return id;
    },

    /** A hand-off opens its thread as a tab, also a new version of an
     * archived one. */
    async handedOff(review: SavedReview) {
      const id = threadOfReview(review);
      store.open(id, review.session ? { session: review.session, kept: true } : {});
      await store.save();
      return id;
    },

    /** The Superagent's thread, once Med made it. */
    superagent(): string | undefined {
      return store.ids().find((id) => store.entry(id)?.superagent);
    },

    /** Med continues a session in a fork: the fork's thread takes the old
     * one's place, with its reviews, name, and pin. */
    async handOver(from: AgentSession, to: AgentSession) {
      const old = sessionKey(from);
      const next = sessionKey(to);
      store.handOver(old, next, { session: to, kept: true });
      await store.save();
      for (const review of (await reviewIndex()).filter(
        (entry) => entry.session && sessionKey(entry.session) === old,
      ))
        await savedReviews.details(review.id, { session: to }).catch(() => {});
      return next;
    },

    /** The reviews of archived threads, archived longest ago first: past the
     * byte budget, they give up their captures first. */
    archivedReviews(): string[] {
      const byThread = reviewsByThread(index?.reviews ?? []);
      return store
        .closed()
        .reverse()
        .flatMap((entry) => (byThread.get(entry.id) ?? []).map((review) => review.id));
    },

    /** Whether the thread is a tab. */
    isTab(id: string) {
      return store.isOpen(id);
    },

    /** The thread's entry in the store, for its routes. */
    entry(id: string) {
      return store.entry(id);
    },

    /** The thread of a review. */
    async threadOf(reviewId: string) {
      const review = (await reviewIndex()).find((entry) => entry.id === reviewId);
      return review && threadOfReview(review);
    },

    /** The reviews of a thread, newest first. */
    async reviewsOf(id: string): Promise<IndexedReview[]> {
      const reviews = await reviewIndex();
      return REVIEW_ID.test(id)
        ? reviews.filter((review) => review.id === id)
        : (reviewsByThread(reviews).get(id) ?? []);
    },

    /** Archives a tab. True when this call archived it. Archiving never
     * stops the agent. `removeWorktree` also removes the linked worktree that
     * Med made for it, unless another tab works there. */
    async close(
      id: string,
      details: { auto?: boolean; removeWorktree?: boolean } = {},
      signal: AbortSignal = new AbortController().signal,
    ) {
      if (details.removeWorktree) {
        const path = store.entry(id)?.place?.checkout;
        const linked = !!path && !!store.entry(id)?.place?.linked;
        if (path && linked) {
          // Another tab that works there keeps the worktree.
          const other = store
            .openIds()
            .find((other) => other !== id && store.entry(other)?.place?.checkout === path);
          if (other)
            throw new HostError(
              "worktree-shared",
              `"${store.entry(other)?.name ?? store.entry(other)?.title ?? "Another thread"}" works in this worktree too.`,
              409,
            );
          await options.removeWorktree(path, signal);
        }
      }
      const closed = store.close(id, { ...(details.auto && { auto: true }) });
      await store.save();
      return closed;
    },

    /** Opens the thread that was archived last. */
    async reopen(): Promise<Thread | undefined> {
      for (const entry of store.closed()) {
        const thread = await service.open(entry.id).catch(() => undefined);
        if (thread) return thread;
      }
      return undefined;
    },

    /**
     * Names a thread. Med keeps the name, not the agent: a new title from the
     * agent does not change it. An empty name gives the thread its agent's
     * title again.
     */
    async rename(id: string, name: string) {
      await requireKnown(id);
      store.setName(id, name.trim() || undefined);
      await store.save();
    },

    /** The branch that the thread's Changes start from; none for the base. */
    async setBase(id: string, base: string | undefined) {
      await requireKnown(id);
      if (store.setBase(id, base)) await store.save();
    },

    /** The reader saw the tab's changes up to `at`, in some window: every
     * window and the CLI read it as seen. A lower mark makes the later
     * changes new again (Mark as unread). */
    async see(id: string, at: number) {
      await requireKnown(id);
      if (store.see(id, at)) await store.save();
    },

    /** The marks that a browser kept before the host kept them. */
    async mergeSeen(marks: Readonly<Record<string, number>>) {
      if (store.mergeSeen(marks)) await store.save();
    },

    /** Pins a thread at `at` among the pins (under the others without it),
     * moves a pinned one there, or unpins it. */
    async pin(id: string, pinned: boolean, at?: number) {
      await requireKnown(id);
      if (store.setPinned(id, pinned, at)) await store.save();
    },

    /**
     * Deletes a thread: its reviews, with their captures and comments, and its
     * place in tabs and the archive. A session stays in Claude Code or Codex;
     * Med hides it, so it does not come back as a found session.
     */
    async delete(id: string) {
      const reviews = await service.reviewsOf(id);
      if (!reviews.length && !store.known(id))
        throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      for (const review of reviews) await savedReviews.delete(review.id).catch(() => {});
      store.forget(id);
      await store.save();
      const session = parseSessionKey(id);
      if (session && session.agent !== "acp")
        await options.sessions.update({ hide: { id, hidden: true } }).catch(() => {});
    },

    /** The archive does not grow without limit: a thread archived 180 days
     * ago is forgotten, with its reviews. */
    async prune() {
      const time = now();
      const reviews = await reviewIndex();
      const byThread = reviewsByThread(reviews);
      let deleted = 0;
      for (const entry of store.closed()) {
        if (time - entry.closedAt <= ARCHIVE_KEPT_MS) continue;
        for (const review of byThread.get(entry.id) ?? []) {
          await savedReviews.delete(review.id).catch(() => {});
          deleted++;
        }
        store.forget(entry.id);
      }
      store.setPrunedAt(time);
      await store.save();
      return { deleted };
    },

    /** Loads the store, and prunes now and once a day. A first start reads
     * an older Med's tabs (`migrate`). */
    async start(migrate?: () => Promise<void>) {
      if (!(await store.load()) && migrate) await migrate();
      await service.prune().catch(() => {});
      pruneTimer = setInterval(() => void service.prune().catch(() => {}), DAY);
      pruneTimer.unref?.();
    },

    /** Stops the daily pruning. */
    stop() {
      clearInterval(pruneTimer);
    },

    /** Shows or hides found sessions, or one of them. */
    updateFound: (input: FoundUpdate) => options.sessions.update(input),
  };

  /** A found session that is not a tab, as the archive lists it. */
  function foundThread(session: IndexedSession, reviews: readonly IndexedReview[]): Thread {
    return {
      id: session.key,
      kind: "session",
      title: session.title,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: session.mtimeMs,
      ...(session.checkout && placeOf(session.checkout)),
      agent: session.agent,
      state: session.working ? "working" : "idle",
      session: { agent: session.agent, id: session.id, cwd: session.cwd },
      reviews: reviews.map(reviewSummary),
      ...(session.prompt && { prompt: session.prompt }),
    };
  }

  return service;
}

export type ThreadService = ReturnType<typeof createThreadService>;
