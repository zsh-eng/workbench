import type { AgentStatus } from "../shared/agent-status";
import type { AgentMessage } from "../shared/agent-inbox";
import {
  FOUND_DAYS,
  foundThreadId,
  parseFoundThreadId,
  type FoundUpdate,
} from "../shared/found-sessions";
import { baseOf, changesBase, type RegisteredRepository } from "../shared/protocol";
import {
  handoffTargets,
  threadCheckout,
  type AgentSession,
  type SavedReview,
} from "../shared/saved-review";
import type { Thread, ThreadList } from "../shared/threads";
import { findTranscript, transcriptPrompt } from "./agent-transcripts";
import { HostError } from "./runtime/errors";
import type { SavedReviewStore } from "./saved-reviews";
import { CAPTURES_KEPT_MS, STUBS_KEPT_MS, type TabStub, type ThreadTabs } from "./thread-tabs";
import type { createThreadSubagents } from "./thread-subagents";
import type { createCheckoutWork } from "./checkout-work";
import type { createPullRequestLinks } from "./pull-request-links";
import type { createCheckoutChanges } from "./checkout-changes";

// The threads of the host: the tabs, which the thread list polls, and history,
// which a picker reads when it opens. See thread-tabs.ts for the store, and
// docs/USAGE.md#threads for the rules.

const DAY = 24 * 60 * 60 * 1000;
/** The first start with tabs opens the threads that changed in this time, the
 * window of found sessions, and at most `FIRST_TABS` of them. */
const FIRST_TABS_MS = FOUND_DAYS * DAY;
const FIRST_TABS = 8;
/** A tab lists subagents while its session changed within this time. */
const SUBAGENTS_MS = DAY;
/** The list of saved reviews is read again after this time, or after a write. */
const INDEX_MS = 30_000;
const REVIEW_ID = /^r_[a-f0-9]{24}$/;

type IndexedReview = SavedReview & { modifiedAt: number };

export interface ThreadServiceOptions {
  savedReviews: SavedReviewStore;
  tabs: ThreadTabs;
  repositories(): RegisteredRepository[];
  status(reviewId: string, sessions: AgentSession[]): Promise<AgentStatus | undefined>;
  lastMessage(reviewId: string): Promise<AgentMessage | undefined>;
  found: {
    threads(reviews: readonly { sessions?: readonly AgentSession[] }[]): Thread[];
    session(threadId: string): Promise<AgentSession[] | undefined>;
    update(input: FoundUpdate): Promise<unknown>;
    settings(): { shown: boolean };
  };
  checkoutWork: ReturnType<typeof createCheckoutWork>;
  /** Finds the pull request that a tab's branch opened later. */
  pullRequestLinks?: Pick<ReturnType<typeof createPullRequestLinks>, "check">;
  /** The counts of a checkout's live Changes, for a tab without a Review. */
  checkoutChanges?: Pick<ReturnType<typeof createCheckoutChanges>, "get">;
  subagents: ReturnType<typeof createThreadSubagents>;
  /** Removes a linked worktree that Med made, as `git worktree remove` does. */
  removeWorktree(path: string, signal: AbortSignal): Promise<void>;
  now?: () => number;
  home?: () => string;
}

/** Where a review's thread works: its checkout, else its first comparison
 * that is not a comment's. */
const primary = (review: SavedReview) => threadCheckout(review);

/**
 * Marks the tabs whose checkout is shared: a repository's main checkout, or
 * a worktree where more than one tab works. Their Changes offer "Only this
 * session's files".
 */
function markShared(threads: Thread[]) {
  const transcript = (thread: Thread) =>
    !!thread.checkout && !!thread.sessions?.some((session) => session.agent !== "acp");
  const counts = new Map<string, number>();
  for (const thread of threads)
    if (transcript(thread)) counts.set(thread.checkout!, (counts.get(thread.checkout!) ?? 0) + 1);
  for (const thread of threads)
    if (transcript(thread) && (!thread.linked || counts.get(thread.checkout!)! > 1))
      thread.shared = true;
}

export function createThreadService(options: ThreadServiceOptions) {
  const { savedReviews, tabs } = options;
  const now = options.now ?? Date.now;
  let index: { at: number; changes: number; reviews: IndexedReview[] } | undefined;
  let indexing: Promise<IndexedReview[]> | undefined;
  let pruneTimer: ReturnType<typeof setInterval> | undefined;
  /** Closed threads whose first prompt was looked for. */
  const prompted = new Set<string>();
  /** First prompts of found sessions in history, by thread ID. */
  const foundPrompts = new Map<string, string | null>();
  let prompting: Promise<void> | undefined;

  const familyOf = (repositories: readonly RegisteredRepository[], path?: string, id?: string) =>
    repositories.find((entry) => entry.id === id) ??
    (path
      ? repositories.find(
          (entry) => entry.path === path || entry.worktrees.some((tree) => tree.path === path),
        )
      : undefined);

  /** The sidebar's group of a thread: its repository, else its checkout. */
  const groupOf = (thread: Pick<Thread, "repository" | "checkout">) =>
    thread.repository?.id ?? thread.checkout ?? "other";

  /** What every list says of a review, without its agent's state or Git work. */
  const describe = (review: IndexedReview, repositories: readonly RegisteredRepository[]) => {
    const target = primary(review);
    const family = familyOf(repositories, target?.repo, target?.repositoryId);
    // The checkout's branch as it is now: an agent can switch it. A detached
    // checkout shows by its folder.
    const tree = family?.worktrees.find((entry) => entry.path === target?.repo);
    const branch = tree
      ? tree.branch && tree.branch !== "Detached HEAD"
        ? tree.branch
        : undefined
      : target?.branch;
    const lead = review.sessions?.at(-1);
    return {
      id: review.id,
      title: review.pullRequestTitle ?? review.title,
      createdAt: review.createdAt,
      updatedAt: review.modifiedAt,
      ...(family && { repository: { id: family.id, name: family.name, path: family.path } }),
      ...(target && { checkout: target.repo }),
      ...(family?.worktrees.some((tree) => tree.path === target?.repo && tree.linked) && {
        linked: true,
      }),
      ...(branch && { branch }),
      ...(lead && { agent: lead.agent }),
      ...(review.sessions?.length && { sessions: review.sessions }),
      // A thread's Review counts its hand-offs; before one, its tab counts
      // the live Changes (`reviewTab`).
      ...(review.totals &&
        handoffTargets(review).length && {
          changes: {
            files: review.totals.files,
            additions: review.totals.additions,
            deletions: review.totals.deletions,
          },
        }),
      ...(review.pullRequestUrl && { pullRequestUrl: review.pullRequestUrl }),
      ...(review.group && { group: review.group }),
    } satisfies Thread;
  };

  const stubOf = (thread: Thread): TabStub => ({
    title: thread.title,
    createdAt: thread.createdAt,
    ...(thread.repository && { repository: thread.repository }),
    ...(thread.checkout && { checkout: thread.checkout }),
    ...(thread.linked && { linked: true }),
    ...(thread.branch && { branch: thread.branch }),
    sessions: thread.sessions ?? [],
    ...(thread.pullRequestUrl && { pullRequestUrl: thread.pullRequestUrl }),
    updatedAt: thread.updatedAt,
  });

  /** A thread with the name that the reader gave it, if any. The agent's
   * title stays in `agentTitle`, and stubs keep it. */
  const named = (thread: Thread): Thread => {
    const name = tabs.entry(thread.id)?.name;
    return name ? { ...thread, title: name, agentTitle: thread.title } : thread;
  };

  /** A thread from what history keeps of it. */
  const fromStub = (id: string, stub: TabStub): Thread => {
    const lead = stub.sessions.at(-1);
    const entry = tabs.entry(id);
    return {
      id,
      title: stub.title,
      createdAt: stub.createdAt ?? new Date(stub.updatedAt ?? 0).toISOString(),
      updatedAt: stub.updatedAt ?? entry?.closedAt ?? 0,
      ...(stub.repository && { repository: stub.repository }),
      ...(stub.checkout && { checkout: stub.checkout }),
      ...(stub.linked && { linked: true }),
      ...(stub.branch && { branch: stub.branch }),
      ...(lead && { agent: lead.agent }),
      ...(stub.sessions.length && { sessions: stub.sessions }),
      ...(stub.pullRequestUrl && { pullRequestUrl: stub.pullRequestUrl }),
      ...(parseFoundThreadId(id) ? { found: true, state: "idle" as const } : { stub: true }),
      ...(entry?.prompt && { prompt: entry.prompt }),
    };
  };

  /**
   * Every saved review's description, read again after a write or after
   * INDEX_MS. A review that the tabs do not know, such as one that an older
   * Med saved, opens as a tab, as a hand-off does.
   */
  const reviewIndex = async (): Promise<IndexedReview[]> => {
    if (index && index.changes === savedReviews.changes && now() - index.at < INDEX_MS)
      return index.reviews;
    indexing ??= (async () => {
      const changes = savedReviews.changes;
      const reviews = await savedReviews.list();
      const repositories = options.repositories();
      for (const review of reviews)
        if (!tabs.known(review.id))
          tabs.open(review.id, { group: groupOf(describe(review, repositories)) });
      index = { at: now(), changes, reviews };
      return reviews;
    })().finally(() => {
      indexing = undefined;
    });
    return indexing;
  };

  /** A tab of a saved review, with its agent's state. */
  const reviewTab = async (
    review: IndexedReview,
    repositories: readonly RegisteredRepository[],
  ): Promise<Thread> => {
    const base = describe(review, repositories);
    const status = review.sessions?.length
      ? await options.status(review.id, review.sessions).catch(() => undefined)
      : undefined;
    const reply = review.sessions?.length
      ? await options.lastMessage(review.id).catch(() => undefined)
      : undefined;
    // Before the agent hands off a Review, the tab counts the live Changes.
    const target = primary(review);
    const family = familyOf(repositories, target?.repo, target?.repositoryId);
    const tree = family?.worktrees.find((entry) => entry.path === target?.repo);
    const branch = tree ? tree.branch : target?.branch;
    const live =
      target && !handoffTargets(review).length
        ? options.checkoutChanges?.get(
            target.repo,
            changesBase(family, branch, target.base),
            status?.updatedAt,
          )
        : undefined;
    // A branch other than the base can have a pull request that opened after
    // the thread did.
    if (
      target &&
      branch &&
      branch !== "Detached HEAD" &&
      !review.pullRequestUrl &&
      changesBase(family, branch, target.base)
    )
      options.pullRequestLinks?.check(review.id, target.repo, branch);
    return {
      ...base,
      updatedAt: Math.max(review.modifiedAt, status?.updatedAt ?? 0),
      ...(live && { changes: live }),
      ...(status && { agent: status.agent, state: status.state }),
      ...(status?.turn && { turn: status.turn }),
      ...(reply && {
        replied: {
          at: Date.parse(reply.createdAt),
          text: (reply.text || `${reply.noteIds.length} comments`).slice(0, 200),
          delivery: reply.delivery,
        },
      }),
      open: true,
    };
  };

  /** Adds the subagents of a tab's lead Claude session that changed lately. */
  const withSubagents = async (thread: Thread): Promise<Thread> => {
    const lead = thread.sessions?.findLast((session) => session.agent === "claude");
    if (!lead || now() - thread.updatedAt > SUBAGENTS_MS) return thread;
    const subagents = await options.subagents.of(lead).catch(() => []);
    return subagents.length ? { ...thread, subagents } : thread;
  };

  /** Looks for the first prompts of closed threads, a few at a time. */
  const fillPrompts = (threads: readonly Thread[]) => {
    if (prompting) return;
    const due = threads
      .filter((thread) => !thread.prompt && !prompted.has(thread.id) && thread.sessions?.length)
      .slice(0, 20);
    if (!due.length) return;
    prompting = (async () => {
      for (const thread of due) {
        prompted.add(thread.id);
        const session = thread.sessions!.find((entry) => entry.agent !== "acp");
        if (!session) continue;
        const path = await findTranscript(session, options.home?.()).catch(() => undefined);
        const prompt = path
          ? await transcriptPrompt(session, path).catch(() => undefined)
          : undefined;
        if (thread.found) foundPrompts.set(thread.id, prompt ?? null);
        else if (prompt) tabs.setPrompt(thread.id, prompt);
      }
      await tabs.save().catch(() => {});
    })().finally(() => {
      prompting = undefined;
    });
  };

  const service = {
    /** The tabs, in the user's order, with their agents' states and Git work. */
    async list(): Promise<ThreadList> {
      const repositories = options.repositories();
      const reviews = await reviewIndex();
      const byId = new Map(reviews.map((review) => [review.id, review]));
      const found = options.found.threads(reviews);
      // A found session opens as a tab once: when Med first sees it work.
      for (const thread of found) {
        if (thread.state === "working" && !tabs.known(thread.id))
          tabs.open(thread.id, { group: groupOf(thread) });
        if (tabs.isOpen(thread.id)) tabs.setStub(thread.id, stubOf(thread));
      }
      // A found tab whose session a saved review now names gives that review its place.
      const owners = new Map<string, string>();
      for (const review of reviews)
        for (const session of review.sessions ?? []) owners.set(session.id, review.id);
      for (const id of [...tabs.order()]) {
        const session = parseFoundThreadId(id);
        const owner = session && owners.get(session.id);
        if (!owner) continue;
        // The review keeps the name that the reader gave the session.
        const name = tabs.entry(id)?.name;
        if (name && !tabs.entry(owner)?.name) tabs.setName(owner, name);
        if (tabs.isOpen(owner)) tabs.forget(id);
        else tabs.open(owner, { replace: id });
      }
      const live = new Map(found.map((thread) => [thread.id, thread]));
      // The tabs as this read lists them: a tab that opens while it waits is
      // not one of them.
      const order = [...tabs.order()];
      const listed = await Promise.all(
        order.map(async (id) => {
          const review = byId.get(id);
          if (review) return reviewTab(review, repositories);
          const thread = live.get(id);
          if (thread) return { ...thread, open: true };
          const stub = tabs.entry(id)?.stub;
          return stub && parseFoundThreadId(id) ? { ...fromStub(id, stub), open: true } : undefined;
        }),
      );
      // A tab whose record is gone, such as one deleted outside Med, leaves.
      // Only with an index that has every saved review: a review saved while
      // this read ran is a tab that the index does not have yet.
      if (index?.changes === savedReviews.changes)
        order.forEach((id, at) => {
          if (!listed[at] && tabs.isOpen(id)) tabs.forget(id);
        });
      const threads = await Promise.all(
        listed.flatMap((thread) => (thread ? [withSubagents(thread)] : [])),
      );
      for (const thread of threads) tabs.setGroup(thread.id, groupOf(thread));
      void tabs.save().catch(() => {});
      markShared(threads);
      // A tab's work counts the uncommitted changes when its Changes or its
      // Review shows them.
      const onWorking = new Set(
        reviews
          .filter(
            (review) =>
              !handoffTargets(review).length ||
              review.targets.some((entry) => entry.comparison.kind === "working"),
          )
          .map((review) => review.id),
      );
      return {
        threads: options.checkoutWork.annotate(
          threads.map(named),
          repositories,
          (thread) => !!thread.found || onWorking.has(thread.id),
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
        found: options.found.settings(),
      };
    },

    /** Closed threads and found sessions that are not tabs, newest first. */
    async history(): Promise<Thread[]> {
      const repositories = options.repositories();
      const reviews = await reviewIndex();
      const threads: Thread[] = [];
      const listed = new Set<string>();
      for (const review of reviews) {
        if (tabs.isOpen(review.id)) continue;
        const entry = tabs.entry(review.id);
        listed.add(review.id);
        threads.push({
          ...describe(review, repositories),
          open: false,
          ...(entry?.closedAt !== undefined && { closedAt: entry.closedAt }),
          ...(entry?.prompt && { prompt: entry.prompt }),
        });
      }
      for (const thread of options.found.threads(reviews)) {
        if (tabs.isOpen(thread.id)) continue;
        const closedAt = tabs.entry(thread.id)?.closedAt;
        const prompt = foundPrompts.get(thread.id);
        listed.add(thread.id);
        threads.push({
          ...thread,
          open: false,
          ...(closedAt !== undefined && { closedAt }),
          ...(prompt && { prompt }),
        });
      }
      for (const entry of tabs.closed())
        if (!listed.has(entry.id) && entry.stub)
          threads.push({
            ...fromStub(entry.id, entry.stub),
            open: false,
            closedAt: entry.closedAt,
          });
      // Newest first; the threads that closed together, as at the first start
      // with tabs, by their last change.
      const time = (thread: Thread) => Math.max(thread.closedAt ?? 0, thread.updatedAt);
      threads.sort((a, b) => time(b) - time(a) || b.updatedAt - a.updatedAt);
      fillPrompts(threads);
      return threads.map(named);
    },

    /**
     * Opens a thread as a tab and returns it. A thread whose captures are gone
     * opens as its newest session, under that session's found ID.
     */
    async open(id: string, place: { restore?: boolean } = {}): Promise<Thread> {
      const repositories = options.repositories();
      const reviews = await reviewIndex();
      const review = reviews.find((entry) => entry.id === id);
      if (review) {
        const thread = describe(review, repositories);
        tabs.open(id, { group: groupOf(thread), ...place });
        await tabs.save();
        return named({ ...thread, open: true });
      }
      const stub = tabs.entry(id)?.stub;
      if (REVIEW_ID.test(id)) {
        const session = stub?.sessions.findLast((entry) => entry.agent !== "acp");
        if (!stub) throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
        if (!session || session.agent === "acp")
          throw new HostError(
            "thread-no-session",
            "History kept no session to resume for this thread.",
            409,
          );
        const foundId = foundThreadId(session.agent, session.id);
        // A session that Med finds again shows as it finds it.
        const thread =
          options.found.threads(reviews).find((entry) => entry.id === foundId) ??
          fromStub(foundId, stub);
        const name = tabs.entry(id)?.name;
        tabs.forget(id);
        tabs.open(foundId, { group: groupOf(thread), ...place });
        if (name) tabs.setName(foundId, name);
        tabs.setStub(foundId, stub);
        await tabs.save();
        return named({ ...thread, open: true });
      }
      const parsed = parseFoundThreadId(id);
      if (!parsed) throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      let thread = options.found.threads(reviews).find((entry) => entry.id === id);
      if (!thread && stub) thread = fromStub(id, stub);
      if (!thread) {
        const sessions = await options.found.session(id);
        const session = sessions?.[0];
        if (!session)
          throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
        const family = familyOf(repositories, session.cwd);
        thread = {
          id,
          title: "Agent session",
          createdAt: new Date(now()).toISOString(),
          updatedAt: now(),
          ...(family && { repository: { id: family.id, name: family.name, path: family.path } }),
          checkout: session.cwd,
          agent: session.agent,
          sessions,
          found: true,
        };
      }
      tabs.open(id, { group: groupOf(thread), ...place });
      tabs.setStub(id, stubOf(thread));
      await tabs.save();
      return named({ ...thread, open: true });
    },

    /** Opens the review that a hand-off or a new thread saved, in the place
     * of the found session that it saves, if that is a tab. */
    async opened(review: SavedReview, prompt?: string) {
      const replace = (review.sessions ?? [])
        .flatMap((session) =>
          session.agent === "acp" ? [] : [foundThreadId(session.agent, session.id)],
        )
        .find((id) => tabs.isOpen(id));
      const target = primary(review);
      const family = familyOf(options.repositories(), target?.repo, target?.repositoryId);
      tabs.open(review.id, {
        group: family?.id ?? target?.repo ?? "other",
        ...(replace && { replace }),
        ...(prompt && { prompt }),
      });
      await tabs.save();
    },

    /** Sends a tab to history. True when this call closed it. Closing never
     * stops the agent. `removeWorktree` also removes the linked worktree that
     * Med made for it, unless another tab works there. */
    async close(
      id: string,
      details: { auto?: boolean; removeWorktree?: boolean } = {},
      signal: AbortSignal = new AbortController().signal,
    ) {
      if (details.removeWorktree && REVIEW_ID.test(id)) {
        const reviews = await reviewIndex();
        const review = reviews.find((entry) => entry.id === id);
        const path = review && primary(review)?.repo;
        const linked =
          !!path &&
          familyOf(options.repositories(), path)?.worktrees.some(
            (tree) => tree.path === path && tree.linked,
          );
        if (linked) {
          // Another tab that works there keeps the worktree.
          const other = reviews.find(
            (entry) =>
              entry.id !== id &&
              tabs.isOpen(entry.id) &&
              (primary(entry)?.repo === path ||
                entry.targets.some((target) => target.repo === path)),
          );
          if (other)
            throw new HostError(
              "worktree-shared",
              `"${other.title}" works in this worktree too.`,
              409,
            );
          await options.removeWorktree(path, signal);
        }
      }
      const closed = tabs.close(id, { ...(details.auto && { auto: true }) });
      await tabs.save();
      return closed;
    },

    /** Opens the thread that closed last, at its place. */
    async reopen(): Promise<Thread | undefined> {
      const reviews = new Set((await reviewIndex()).map((review) => review.id));
      for (const entry of tabs.closed()) {
        if (!reviews.has(entry.id) && !entry.stub) continue;
        const thread = await service.open(entry.id, { restore: true }).catch(() => undefined);
        if (thread) return thread;
      }
      return undefined;
    },

    async order(order: readonly string[]) {
      tabs.reorder(order);
      await tabs.save();
    },

    /**
     * Names a tab or a thread in history. Med keeps the name, not the agent:
     * a hand-off that changes the review's title does not change it. An empty
     * name gives the thread its agent's title again.
     */
    async rename(id: string, name: string) {
      await reviewIndex();
      if (!tabs.known(id))
        throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      tabs.setName(id, name.trim() || undefined);
      await tabs.save();
    },

    /**
     * Deletes a thread: its saved review, with its captures and comments, and
     * its place in tabs and history. Its sessions stay in Claude Code and
     * Codex; Med hides them, so they do not come back as found sessions.
     */
    async delete(id: string) {
      const found = parseFoundThreadId(id);
      if (!found && !REVIEW_ID.test(id))
        throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
      let sessions = tabs.entry(id)?.stub?.sessions ?? [];
      if (!found) {
        const review = await savedReviews.summary(id).catch(() => undefined);
        if (!review && !tabs.known(id))
          throw new HostError("thread-not-found", "Med has no thread with this ID.", 404);
        sessions = review?.sessions ?? sessions;
        if (review) await savedReviews.delete(id);
      } else sessions = [{ agent: found.agent, id: found.id, cwd: "" }];
      tabs.forget(id);
      await tabs.save();
      for (const session of sessions)
        if (session.agent !== "acp")
          await options.found
            .update({ hide: { id: foundThreadId(session.agent, session.id), hidden: true } })
            .catch(() => {});
    },

    /**
     * Prunes history: 30 days after a thread closed, its saved review gives
     * way to a stub; 180 days after, the stub goes too.
     */
    async prune() {
      const time = now();
      const stubbed: string[] = [];
      const deleted: string[] = [];
      const repositories = options.repositories();
      for (const entry of tabs.closed()) {
        const age = time - entry.closedAt;
        if (age > STUBS_KEPT_MS) {
          if (REVIEW_ID.test(entry.id)) deleted.push(entry.id);
          tabs.forget(entry.id);
        } else if (age > CAPTURES_KEPT_MS && REVIEW_ID.test(entry.id)) {
          const review = await savedReviews.summary(entry.id).catch(() => undefined);
          if (!review) continue;
          tabs.setStub(entry.id, stubOf(describe(review, repositories)));
          stubbed.push(entry.id);
        }
      }
      tabs.setPrunedAt(time);
      // The stubs are on disk before their records go.
      await tabs.save();
      for (const id of [...stubbed, ...deleted]) await savedReviews.delete(id).catch(() => {});
      return { stubbed: stubbed.length, deleted: deleted.length };
    },

    /** The first start with tabs makes them from the saved reviews. */
    async migrate() {
      const time = now();
      const repositories = options.repositories();
      const reviews = await savedReviews.list();
      const rows = await Promise.all(
        reviews.map(async (review) => {
          const group = groupOf(describe(review, repositories));
          // Archived threads close when they were archived.
          if (review.archivedAt)
            return {
              id: review.id,
              open: false,
              archived: true,
              closedAt: Date.parse(review.archivedAt) || time,
              updatedAt: review.modifiedAt,
              group,
            };
          // A thread's last change is its record's, or its session's.
          let updatedAt = review.modifiedAt;
          if (review.sessions?.length && time - updatedAt >= FIRST_TABS_MS) {
            const status = await options.status(review.id, review.sessions).catch(() => undefined);
            updatedAt = Math.max(updatedAt, status?.updatedAt ?? 0);
          }
          return { id: review.id, open: false, archived: false, closedAt: time, updatedAt, group };
        }),
      );
      // The newest threads of the last 7 days open; the others close now.
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      const recent = rows.filter((row) => !row.archived && time - row.updatedAt < FIRST_TABS_MS);
      for (const row of recent.slice(0, FIRST_TABS)) row.open = true;
      // The sidebar's order: the repository with the newest thread first, and
      // each repository's threads newest first.
      const groups = [...new Set(rows.map((row) => row.group))];
      rows.sort((a, b) => groups.indexOf(a.group) - groups.indexOf(b.group));
      tabs.migrate(rows);
      await tabs.save();
      return {
        open: rows.filter((row) => row.open).length,
        closed: rows.filter((row) => !row.open).length,
      };
    },

    /** Loads the tabs, or makes them on the first start, and prunes now and once a day. */
    async start() {
      if (!(await tabs.load())) await service.migrate();
      await service.prune().catch(() => {});
      pruneTimer = setInterval(() => void service.prune().catch(() => {}), DAY);
      pruneTimer.unref?.();
    },

    /** The saved reviews as attempts read them: a closed thread is archived. */
    async attemptReviews(): Promise<SavedReview[]> {
      return (await reviewIndex()).map((review) => {
        const { archivedAt: _old, ...rest } = review;
        const closedAt = tabs.entry(review.id)?.closedAt;
        return tabs.isOpen(review.id) || closedAt === undefined
          ? rest
          : { ...rest, archivedAt: new Date(closedAt).toISOString() };
      });
    },

    /** Stops the daily pruning. */
    stop() {
      clearInterval(pruneTimer);
    },
  };
  return service;
}

export type ThreadService = ReturnType<typeof createThreadService>;
