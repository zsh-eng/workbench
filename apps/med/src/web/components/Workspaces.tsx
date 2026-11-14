import type { Thread, ThreadReview } from "../../shared/threads";
import { openSettings } from "./settings/settings-commands";
import * as stylex from "@stylexjs/stylex";
import { createPortal, flushSync } from "react-dom";
import {
  Activity,
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createReviewController,
  type ReviewController,
  type ReviewControllerOptions,
} from "../data/controller";
import { lastScreen } from "../data/navigation";
import {
  createWorkspaceStore,
  orderedWorkspaces,
  overlayAddress,
  pinned,
  REVIEW_UPDATED,
  workspaceUrl,
  type PullWorkspace,
  type RepositoryWorkspace,
  threadWorkspaceId,
  type ThreadWorkspace,
  type Workspace,
  type WorkspaceInput,
  type WorkspacePatch,
  type WorkspaceSnapshot,
} from "../data/workspaces";
import { z } from "zod";
import { picked, tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { visibleElement } from "../data/palette-focus";
import { Matched, matchRanges, usePaletteFade } from "./Palette";
import { createApi } from "../data/api";
import { createWindowDrafts, type WindowDrafts } from "../data/editor-drafts";
import { browserFetch } from "../data/live";
import { readBrowserToken } from "../data/auth";
import { readServerEvents } from "../data/sse";
import { renderBriefs } from "../markdown/brief-render";
import { endReplies } from "./session/thread-model";
import { themeController } from "../themes";
import { parsePullUrl, samePull } from "../../shared/pull-workspace";
import { startPull, usePullJob } from "../data/pull-jobs";
import { HistoryPage, isArchivedAddress, openHistoryPage } from "./HistoryPage";
import { OPEN_PULL_EVENT, openPullRequests, type OpenPull } from "./PullRequestsPage";
import { PullWorkspaceView, pullTitle, type PullState } from "./PullWorkspace";
import {
  matches,
  needsYou,
  NO_THREADS,
  shortAge,
  tabOrder,
  threadFields,
  threadInput,
  useThreads,
  workspaceThread,
} from "../data/threads";
import { parseSessionKey, REVIEW_ID } from "../../shared/threads";
import {
  closeThread,
  deleteThread,
  landed,
  openThread,
  readHistory,
  reopenThread,
  renameThread,
  pinThread,
  useReadState,
} from "../data/tabs";
import type { ReviewCommand } from "./Controls";
import { barContext, WorkspaceBar } from "./shell/WorkspaceBar";
import { HistoryArrows, useHistoryKeys } from "./shell/HistoryArrows";
import { ToolButton } from "./ToolButton";
import { newThreadKeys, useTitleBarOverlay } from "../data/title-bar";
import { NoticeBar, type TabNotice } from "./shell/NoticeBar";
import { SessionSidebar } from "./shell/SessionSidebar";
import { NewThread } from "./shell/NewThread";
import { SEARCH_OPEN_EVENT, type SearchOpen } from "./SearchView";
import { requestFileOpen, requestSearchOpen } from "../data/file-opens";
import { prefetchSavedReview } from "../data/controller";
import { onInput, QUIET_MS, whenFree, whenIdle } from "../data/idle";
import {
  chooseNotify,
  needsCount,
  useAppBadge,
  useNeedsYouNotifications,
  useNotifyChoice,
} from "../data/signals";
import { reconnectPause } from "../data/reconnect";
import { viewSettings } from "../data/view-settings";

/** Workspaces kept mounted besides the tabs, such as branches, most recently
 * shown first. Older ones reload. */
const MOUNTED = 6;
/** Tabs stay mounted, as a terminal keeps its open tabs; beyond this many,
 * the least recently shown drop their DOM and stay in the sidebar. */
const TABS_MOUNTED = 16;
/** How long a thread on screen waits for the host's list before it asks to
 * be a tab: the host sends its list every 1.5 s. */
const LIST_WAIT_MS = 2500;
/** The longest that a new workspace prepares out of sight before it shows. */
const PREPARE_MS = 600;
/** The longest that a thread loaded ahead renders out of sight to settle. */
const SETTLE_MS = 1500;
/** The longest that the warm pool waits for the workspace on screen to load. */
const SHOW_WAIT_MS = 5000;

type ControllerOptions = Omit<ReviewControllerOptions, "savedReviewId" | "start">;
/** A patch parser keeps only its latest request, so each workspace has its own:
 * one workspace's load never cancels another's. The parsers can share
 * workers: the one of the workspace on screen (`show`) goes first. */
type ParserFactory = () => {
  parse: NonNullable<ReviewControllerOptions["parsePatch"]>;
  show?(shown: boolean): void;
  dispose(): void;
};

interface WorkspaceActions {
  /** Shows a workspace and moves the address to it. */
  activate(id: string): void;
  close(id: string): void;
  /** Closes a workspace, after a question when it has unsaved drafts. */
  requestClose(id: string): void;
  setUnread(id: string, unread: boolean): void;
  /** Shows the workspace for this task, opening it first if needed. */
  open(input: WorkspaceInput): void;
  match(input: WorkspaceInput): string | undefined;
  closeRepository(repositoryId: string, keep: string): void;
  update(id: string, patch: WorkspacePatch): void;
  /** Opens the switcher without a held key, as the palette does. */
  openSwitcher(): void;
  /** Opens a GitHub pull request in a new workspace at once; the host checks
   * it out in a worktree and starts `agent` there if set. */
  openPull(url: string, agent?: string): void;
  /** Asks the host again for a pull request that it could not open. */
  retryPull(id: string): void;
  /** Shows the open pull requests that wait on you, and yours. */
  openPullRequests(): void;
  /** Removes the workspace's linked worktree, then closes each workspace in
   * it. Rejects with Git's reason when Git keeps the worktree. */
  removeWorktree(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceSnapshot;
}

const NARROW = "(max-width: 760px)";
const isNarrow = () => typeof matchMedia === "function" && matchMedia(NARROW).matches;
const subscribeNarrow = (listener: () => void) => {
  if (typeof matchMedia !== "function") return () => {};
  const query = matchMedia(NARROW);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

const Actions = createContext<WorkspaceActions | null>(null);
const Snapshot = createContext<WorkspaceSnapshot | null>(null);
/** The window's threads by review ID, with their lead sessions' states, as
 * the host last sent them. A component reads only what it shows, so a change
 * to one thread renders only what shows it, not every workspace that stays
 * mounted. */
interface ThreadStore {
  get(): ReadonlyMap<string, Thread>;
  /** The threads, the most recently changed first. */
  list(): readonly Thread[];
  subscribe(listener: () => void): () => void;
}
function createThreadStore() {
  let threads: ReadonlyMap<string, Thread> = new Map();
  let sorted: readonly Thread[] | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => threads,
    list: () => (sorted ??= [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt)),
    set(next: ReadonlyMap<string, Thread>) {
      if (next === threads) return;
      threads = next;
      sorted = null;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
const Threads = createContext<ThreadStore>(createThreadStore());
const Current = createContext<string | null>(null);
/** Why the host refused a pull request link, by workspace. */
const PullErrors = createContext<ReadonlyMap<string, string>>(new Map());
const HostFetch = createContext<typeof fetch>(browserFetch);
const LOST = "Med restarted before it opened this pull request.";
const removedSchema = z.object({ removed: z.literal(true) });
/** Disposers that run when a workspace closes or leaves memory. */
const Lifetime = createContext<Set<() => void> | null>(null);
/** The window's drafts: unsaved ones of workspaces that closed or left
 * memory, and the ones in the browser's storage. */
const Drafts = createContext<WindowDrafts | null>(null);
/** Tabs to load before their first visit: the one under the pointer
 * (`next`), then the others, nearest in the sidebar to the tab on screen
 * first. The tabs (`active`, by workspace ID) stay loaded, as open terminal
 * tabs do, up to TABS_MOUNTED, until they close. History is never loaded
 * ahead. */
interface WarmThreads {
  threads: { workspace: ThreadWorkspace; session?: string }[];
  next: string | null;
  active: ReadonlySet<string>;
}
const Warm = createContext<WarmThreads>({ threads: [], next: null, active: new Set() });

/** What the tabs can do, for the palette (useTabCommands). It does not
 * change; `subscribe` tells when the tabs change. */
interface TabActions {
  isTab(threadId: string | undefined): boolean;
  close(threadId: string): void;
  reopen(): void;
  openHistory(): void;
  /** Opens New thread. */
  newThread(): void;
  /** Shows the Archived page. */
  showHistory(): void;
  /** Shows the next tab that needs the reader, else the next that works. */
  next(): void;
  /** Shows the name field of the thread. */
  rename(threadId: string): void;
  /** Turns the notifications for tabs that need the reader on or off. */
  notify(on: boolean): void;
  subscribe(listener: () => void): () => void;
}
const Tabs = createContext<TabActions | null>(null);

/** The palette's commands for tabs: close this workspace's tab, reopen a
 * closed one, open one from history, go to the next that needs you, rename
 * it, and notifications. Outside a window with tabs, none. */
export function useTabCommands(): ReviewCommand[] {
  const tabs = use(Tabs);
  const thread = workspaceThread(use(Entry) ?? undefined);
  const isTab = useSyncExternalStore(tabs?.subscribe ?? noSubscription, () =>
    tabs ? tabs.isTab(thread) : false,
  );
  const notifying = useNotifyChoice();
  return useMemo(() => {
    if (!tabs) return [];
    const run = (action: (id: string) => void) => () => thread && action(thread);
    return [
      {
        id: "new-thread",
        icon: "plus",
        group: "Threads",
        managesFocus: true,
        label: "New thread",
        shortcut: newThreadKeys(),
        run: tabs.newThread,
      },
      {
        id: "close-tab",
        icon: "close",
        group: "Threads",
        label: "Close tab",
        shortcut: "⌘ ⌥ W",
        disabled: !isTab,
        run: run(tabs.close),
      },
      {
        id: "reopen-tab",
        icon: "reply",
        group: "Threads",
        label: "Reopen closed tab",
        shortcut: "⌘ ⌥ T",
        run: tabs.reopen,
      },
      {
        id: "open-history",
        icon: "history",
        group: "Threads",
        managesFocus: true,
        label: "Open archived thread",
        keywords: "history",
        run: tabs.openHistory,
      },
      {
        id: "history-page",
        icon: "history",
        group: "Threads",
        managesFocus: true,
        label: "Archived",
        keywords: "history",
        run: tabs.showHistory,
      },
      {
        id: "next-needs-you",
        icon: "jump",
        group: "Threads",
        label: "Next tab that needs you",
        shortcut: "⌘ 0",
        run: tabs.next,
      },
      {
        id: "rename-thread",
        icon: "edit",
        group: "Threads",
        label: "Rename thread…",
        managesFocus: true,
        disabled: !isTab,
        run: run(tabs.rename),
      },
      {
        id: "notify-needs-you",
        icon: "alert",
        group: "Threads",
        label: notifying
          ? "Stop notifying me when a tab needs you"
          : "Notify me when a tab needs you",
        run: () => tabs.notify(!notifying),
      },
    ];
  }, [isTab, notifying, tabs, thread]);
}
/** The title band's slots for the workspace on screen, and which one that
 * is; null outside the shell. */
interface TitleBand {
  lead: HTMLElement | null;
  trail: HTMLElement | null;
  cover: HTMLElement | null;
  session: HTMLElement | null;
  tools: HTMLElement | null;
  workspace: string | null;
  /** The workspace's title leads the band, or a pane's row covers its end,
   * until the returned function runs. */
  claim(kind: "lead" | "cover"): () => void;
  /** The views tell which workspace shows: the one before stays on screen
   * while the next prepares, and the band names it until they swap. */
  showing(id: string | null): void;
}
const Band = createContext<TitleBand | null>(null);

/**
 * A workspace's own title in the window's title band, while the workspace is
 * on screen: `lead` before its checkout, which then follows quieter, and
 * `trail` at the band's end. Or `cover`: a pane's own row over the band's end,
 * above the pane, as the review's title row beside the session. The portal
 * keeps the workspace's context, so its controls work as in the workspace.
 * Outside the shell, nothing shows.
 */
export function InTitleBand({
  lead,
  trail,
  cover,
  session,
  tools,
}: {
  lead?: ReactNode;
  trail?: ReactNode;
  cover?: ReactNode;
  /** The session's own controls, at the band's end before `tools`. */
  session?: ReactNode;
  /** The workspace's pages and what acts on all of it, at the band's end. */
  tools?: ReactNode;
}) {
  const band = use(Band);
  const shown = useInTitleBand();
  const claim = band?.claim;
  const kind = cover ? "cover" : lead ? "lead" : null;
  useLayoutEffect(() => (shown && claim && kind ? claim(kind) : undefined), [shown, claim, kind]);
  if (!shown || !band) return null;
  return (
    <>
      {lead && band.lead && createPortal(lead, band.lead)}
      {trail && band.trail && createPortal(trail, band.trail)}
      {cover && band.cover && createPortal(cover, band.cover)}
      {session && band.session && createPortal(session, band.session)}
      {tools && band.tools && createPortal(tools, band.tools)}
    </>
  );
}

/** Whether this workspace is the one in view, which Back and Forward step
 * through (navigation.ts). Outside the workspace shell, none is. */
export function useWorkspaceInView() {
  const id = use(Current);
  const inView = use(InView);
  return !!id && inView !== false;
}

/** Whether the title band shows this workspace: InTitleBand's portals render.
 * While the next workspace prepares out of sight, the band stays with the one
 * on screen, so the band and the view swap in one frame. */
export function useInTitleBand() {
  const band = use(Band);
  const id = use(Current);
  const inView = use(InView);
  return !!band?.workspace && (inView ?? band.workspace === id);
}

/** The title band's slots, and whether a workspace's title leads it or a
 * pane's row covers its end. */
function useTitleBand(workspace: string | null, showing: (id: string | null) => void) {
  const [lead, setLead] = useState<HTMLElement | null>(null);
  const [trail, setTrail] = useState<HTMLElement | null>(null);
  const [cover, setCover] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<HTMLElement | null>(null);
  const [tools, setTools] = useState<HTMLElement | null>(null);
  const [claims, setClaims] = useState({ lead: 0, cover: 0 });
  const claim = useCallback((kind: "lead" | "cover") => {
    setClaims((count) => ({ ...count, [kind]: count[kind] + 1 }));
    return () => setClaims((count) => ({ ...count, [kind]: count[kind] - 1 }));
  }, []);
  const value = useMemo(
    () => ({ lead, trail, cover, session, tools, workspace, claim, showing }),
    [lead, trail, cover, session, tools, workspace, claim, showing],
  );
  return {
    value,
    slots: {
      lead: setLead,
      trail: setTrail,
      cover: setCover,
      session: setSession,
      tools: setTools,
    },
    titled: claims.lead > 0,
    covered: claims.cover > 0,
  };
}

/** Whether this workspace is the one on screen. One that renders out of
 * sight runs its effects but takes no keys. */
const ShownCheck = createContext<() => boolean>(() => true);
/** Whether a slot's workspace is the one in view: the last one while the
 * next prepares out of sight. Null outside WorkspaceViews. */
const InView = createContext<boolean | null>(null);
/** The workspace that a slot renders, also for a thread not open yet. */
const Entry = createContext<Workspace | null>(null);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Names in reading order: case aside, and numbers by value. */
export const byName = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name);

/** The state of a saved review's lead session, as the thread list shows it. */
export function useThreadState(reviewId: string | undefined) {
  const store = use(Threads);
  return useSyncExternalStore(store.subscribe, () => store.get().get(reviewId ?? "")?.state);
}

/** One thread of the window's list, by ID. It renders again only when that
 * thread changes. */
export function useThread(id: string | undefined) {
  const store = use(Threads);
  return useSyncExternalStore(store.subscribe, () => store.get().get(id ?? ""));
}

const NO_REVIEWS: readonly ThreadReview[] = [];
/** The reviews of a thread, newest first: the ones its session handed off,
 * or a lone review itself. */
export function useThreadReviews(id: string | undefined): readonly ThreadReview[] {
  return useThread(id)?.reviews ?? NO_REVIEWS;
}

/** A pull request that Med adds to the workspace's thread, with its job. */
export interface AddingPull {
  url: string;
  state: PullState;
}

/**
 * Adds a GitHub pull request to the workspace's thread as one more of its
 * reviews (⌘K, "Add a pull request…"). The host runs the job that a pasted
 * link runs, and saves the review in the thread; no workspace opens for it.
 * `onReview` shows a review of the thread: the new one when its job ends, or
 * at once the one that the thread has for the link already. Only a session's
 * thread takes more reviews; elsewhere `add` is undefined.
 */
export function useAddPullRequest(onReview: (reviewId: string) => void) {
  const entry = use(Entry);
  const threads = use(Threads);
  const fetcher = use(HostFetch);
  const threadId =
    entry?.kind === "thread" && parseSessionKey(entry.threadId) ? entry.threadId : undefined;
  const [pending, setPending] = useState<{ url: string; jobId?: string; error?: string } | null>(
    null,
  );
  const job = usePullJob(pending?.jobId, fetcher);
  const show = useRef(onReview);
  useLayoutEffect(() => {
    show.current = onReview;
  });
  const begin = useCallback(
    (url: string) => {
      if (!threadId) return;
      setPending({ url });
      const settle = (next: { jobId: string } | { error: string }) =>
        setPending((current) =>
          current?.url === url && !current.jobId ? { url, ...next } : current,
        );
      startPull(url, undefined, fetcher, threadId).then(
        (started) => settle({ jobId: started.id }),
        (error: unknown) =>
          settle({
            error: error instanceof Error ? error.message : "Med could not open this link.",
          }),
      );
    },
    [fetcher, threadId],
  );
  const add = useCallback(
    (link: string) => {
      const address = parsePullUrl(link);
      if (!address || !threadId) return;
      // A pull request that the thread has already shows its review.
      const known = threads
        .get()
        .get(threadId)
        ?.reviews.find(
          (review) => review.pullRequest && samePull(review.pullRequest.url, address.url),
        );
      if (!known) return begin(address.url);
      setPending(null);
      show.current(known.id);
    },
    [begin, threadId, threads],
  );
  // The saved review is one of the thread's now: it shows, once. A workspace
  // that comes back on screen runs its effects again, and keeps its review.
  const saved = job && job !== "lost" && job.status === "done" ? job.reviewId : undefined;
  const jobId = pending?.jobId;
  const shownJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!saved || shownJob.current === jobId) return;
    shownJob.current = jobId;
    show.current(saved);
  }, [saved, jobId]);
  const adding: AddingPull | null =
    pending && !saved
      ? {
          url: pending.url,
          state: job === "lost" ? { error: LOST } : { job, error: pending.error },
        }
      : null;
  return {
    add: threadId ? add : undefined,
    adding,
    retry: () => pending && begin(pending.url),
    /** Hides the job. It goes on in the host, and its review joins the thread. */
    dismiss: () => setPending(null),
  };
}

/** Reads the window's threads, the most recently changed first, when called.
 * A component that lists them on demand, as @ does, does not render again
 * for each change. Outside a host, none. */
export function useThreadReader() {
  return use(Threads).list;
}

/** The workspace that renders this App, with the host's actions. Outside a
 * host, such as in a test of App alone, it is null. */
export function useWorkspace() {
  const actions = use(Actions);
  const id = use(Current);
  // Selected values change rarely, so a review renders again only for them.
  const stays = useSyncExternalStore(actions?.subscribe ?? noSubscription, () => {
    const workspace = actions?.getSnapshot().workspaces.find((entry) => entry.id === id);
    return !!workspace && pinned(workspace);
  });
  return useMemo(
    () => (actions && id ? { id, pinned: stays, ...actions } : null),
    [actions, id, stays],
  );
}
const noSubscription = () => () => {};

/** The window's shell around the workspaces: its thread list. */
export interface ShellActions {
  sidebarVisible: boolean;
  toggleSidebar(): void;
}
export const ShellContext = createContext<ShellActions | null>(null);

/** The window's shell, or null for an App alone, such as in a test. */
export function useShell() {
  return use(ShellContext);
}

/** The host's actions, for pages that cover every workspace, such as Sources. */
export function useWorkspaceActions() {
  return use(Actions);
}

/** The host's fetch, for pages that cover every workspace. */
export function useHostFetch() {
  return use(HostFetch);
}

/** The workspace that renders this App: its kind, review, or branch. A
 * thread loaded ahead has one before it opens, so it lays out as it will. */
export function useWorkspaceEntry() {
  return use(Entry);
}

/**
 * Whether the workspace around a component is on screen, read when a key
 * comes. A workspace out of sight, as one that prepares, runs its effects;
 * its window key handlers check this and leave the key to the one on screen.
 */
export function useWorkspaceShown() {
  return use(ShownCheck);
}

/**
 * Disposes a long-lived object when its owner goes away for good. A hidden
 * workspace runs effect cleanups too, and comes back with the same objects,
 * so inside a workspace disposal waits until the workspace closes.
 */
/**
 * The window's drafts, so a draft outlasts its workspace and a reload. It is
 * null outside the workspace shell.
 */
export function useWindowDrafts() {
  return use(Drafts);
}

export function useDisposeOnClose(dispose: () => void) {
  const lifetime = use(Lifetime);
  useEffect(() => {
    if (!lifetime) return dispose;
    lifetime.add(dispose);
  }, [dispose, lifetime]);
}

/** The window used last shows the reviews that agents open. */
const WINDOW_KEY = "med:window";
const SIDEBAR_WIDTH_KEY = "med:sidebar-width";
const SIDEBAR_WIDTH = 272;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 440;
const clampSidebar = (width: number) =>
  Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));
function readStored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice lasts for this window. */
  }
}

/** The lock and broadcast channel that share the host's window channel. */
const WINDOW_CHANNEL = "med:windows";
/** A review that an agent handed off, or a thread that `med thread adopt --open` shows. */
const reviewEvent = z.object({
  /** The review; none for a thread alone. */
  id: z.string().optional(),
  thread: z.string(),
  title: z.string(),
  open: z.boolean(),
  updated: z.boolean().default(false),
});

type ReviewEvent = z.infer<typeof reviewEvent>;

/** Reads the host's window channel until `signal` aborts, and reconnects with
 * backoff. It returns early from a host without the channel. */
async function listenForReviews(
  fetcher: typeof fetch,
  signal: AbortSignal,
  onReview: (review: ReviewEvent) => void,
) {
  const api = createApi(fetcher, readBrowserToken());
  let attempt = 0;
  while (!signal.aborted) {
    try {
      const response = await api.stream("/api/windows", signal);
      if (response.status === 404) return;
      if (!response.ok || !response.body) throw new Error("The window channel closed.");
      attempt = 0;
      await readServerEvents(
        response.body,
        (event) => {
          if (event.event !== "review") return;
          try {
            const review = reviewEvent.safeParse(JSON.parse(event.data));
            if (review.success) onReview(review.data);
          } catch {
            /* Ignore a malformed event. */
          }
        },
        signal,
      );
    } catch {
      /* Reconnect below. */
    }
    await reconnectPause(attempt++, signal);
  }
}

const historyWorkspace = () => (history.state as { workspace?: unknown } | null)?.workspace;

/** True when the address already shows the workspace. Branches share "/",
 * so their history entries carry the workspace id. */
function showing(workspace: Workspace) {
  if (workspace.kind === "repository") {
    const named = historyWorkspace();
    return location.pathname === "/" && (named === undefined || named === workspace.id);
  }
  return location.pathname === workspaceUrl(workspace);
}

async function readVaults(fetcher: typeof fetch) {
  try {
    const response = await fetcher("/api/service/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // A plain review host has no sources, so it has no vaults.
    if (response.status === 404) return [];
    if (!response.ok) return null;
    const data = (await response.json()) as {
      sources?: { id: string; name: string; kind: string }[];
    };
    return (data.sources ?? [])
      .filter((source) => source.kind === "vault")
      .map((source) => ({ sourceId: source.id, title: source.name }));
  } catch {
    return null;
  }
}

/** An agent that works and does not wait for the reader. */
const isWorking = (thread: Thread) => thread.state === "working" && !needsYou(thread);

const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
const reason = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ? errorText(result.reason, "") : "";

/** The workspace that a tab mounts with before it opens. It keeps one object
 * while the tab's title and place stay. A session that works in no checkout
 * and has handed off no review has nothing to load. */
function warmWorkspace(
  thread: Thread,
  cache: Map<string, ThreadWorkspace>,
): ThreadWorkspace | undefined {
  if (!thread.checkout && !thread.reviews.length) return undefined;
  const input = threadInput(thread);
  const id = threadWorkspaceId(thread.id);
  const cached = cache.get(id);
  if (
    cached &&
    cached.title === input.title &&
    cached.path === input.path &&
    cached.branch === input.branch
  )
    return cached;
  const workspace: ThreadWorkspace = { ...input, id };
  cache.set(id, workspace);
  return workspace;
}

/**
 * Owns the workspaces of this window: the persisted list, the address, the
 * shortcuts, and the switcher. Place it above the vault and file surfaces so
 * they can show the list too; {@link WorkspaceViews} renders the reviews.
 */
export function WorkspaceHost({
  fetch: providedFetch,
  children,
}: {
  fetch?: typeof fetch;
  children: ReactNode;
}) {
  const [fetcher] = useState(() => providedFetch ?? browserFetch);
  const [store] = useState(() => createWorkspaceStore(location.pathname, history.state));
  const [drafts] = useState(() => createWindowDrafts());
  // A draft that storage did not take is lost when the page goes, so leaving warns.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!drafts.loses()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [drafts]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [switcher, setSwitcher] = useState<{
    held: boolean;
    reverse: boolean;
    /** From "Open archived thread": the switcher lists archived threads. */
    history?: boolean;
  } | null>(null);
  // A vault keeps its own address, such as the open file, between visits.
  const vaultAddresses = useRef(new Map<string, string>());
  // Each workspace gets back the focus it had, as a window does.
  const focused = useRef(new Map<string, HTMLElement>());
  const rememberFocus = useCallback(() => {
    const element = document.activeElement;
    if (element instanceof HTMLElement && !element.closest("[data-workspace-switcher]"))
      focused.current.set(store.getSnapshot().active, element);
  }, [store]);

  const show = useCallback(
    (id: string, replace = false) => {
      const workspace = store.getSnapshot().workspaces.find((entry) => entry.id === id);
      if (!workspace) return;
      if (store.getSnapshot().active !== id) rememberFocus();
      store.activate(id);
      requestAnimationFrame(() => {
        const target = focused.current.get(id);
        if (target?.isConnected && target.checkVisibility()) target.focus({ preventScroll: true });
      });
      if (showing(workspace)) return;
      const address =
        (workspace.kind === "vault" && vaultAddresses.current.get(id)) || workspaceUrl(workspace);
      history[replace ? "replaceState" : "pushState"]({ workspace: id }, "", address);
      // The vault and file surfaces follow the address through popstate.
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    },
    [rememberFocus, store],
  );
  const [pullErrors, setPullErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const beginPull = useCallback(
    (id: string, url: string, agent?: string) => {
      setPullErrors((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      store.update(id, { jobId: undefined });
      startPull(url, agent, fetcher).then(
        (job) => store.update(id, { jobId: job.id }),
        (error: unknown) =>
          setPullErrors((current) =>
            new Map(current).set(
              id,
              error instanceof Error ? error.message : "Med could not open this link.",
            ),
          ),
      );
    },
    [fetcher, store],
  );
  // Set once the notice can ask.
  const askClose = useRef<(ids: readonly string[], title: string, close: () => void) => void>(
    (_ids, _title, close) => close(),
  );
  const actions = useMemo<WorkspaceActions>(
    () => ({
      activate: (id) => show(id),
      close(id) {
        const before = store.getSnapshot().active;
        store.close(id);
        const after = store.getSnapshot().active;
        if (after !== before) show(after, true);
      },
      requestClose(id) {
        const workspace = store.getSnapshot().workspaces.find((entry) => entry.id === id);
        askClose.current([id], workspace?.title ?? "This workspace", () => actions.close(id));
      },
      open: (input) => show(store.open(input, false)),
      match: store.match,
      setUnread: store.setUnread,
      closeRepository: store.closeRepository,
      update: store.update,
      openSwitcher() {
        rememberFocus();
        setSwitcher({ held: false, reverse: false });
      },
      openPull(url, agent) {
        const address = parsePullUrl(url);
        if (!address) return;
        const input = {
          kind: "pull" as const,
          url: address.url,
          title: pullTitle(address.url),
          ...(agent ? { agent } : {}),
        };
        const known = store.match(input);
        if (known) return show(known);
        const id = store.open(input, false);
        show(id);
        beginPull(id, address.url, agent);
      },
      openPullRequests() {
        rememberFocus();
        openPullRequests();
      },
      retryPull(id) {
        const workspace = store.getSnapshot().workspaces.find((entry) => entry.id === id);
        if (workspace?.kind === "pull") beginPull(id, workspace.url, workspace.agent);
      },
      async removeWorktree(id) {
        const path = store.getSnapshot().workspaces.find((entry) => entry.id === id)?.worktree;
        if (!path) return;
        await createApi(fetcher, readBrowserToken()).json("/api/worktrees/remove", removedSchema, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });
        for (const entry of store.getSnapshot().workspaces)
          if (entry.worktree === path) actions.close(entry.id);
      },
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,
    }),
    [beginPull, fetcher, rememberFocus, show, store],
  );
  // The pull requests page opens a row through the workspaces.
  useEffect(() => {
    const open = (event: Event) => {
      const { url, agent } = (event as CustomEvent<OpenPull>).detail;
      actions.openPull(url, agent);
    };
    window.addEventListener(OPEN_PULL_EVENT, open);
    return () => window.removeEventListener(OPEN_PULL_EVENT, open);
  }, [actions]);
  // A pull request's workspace takes the title once the host reads it, and
  // becomes the review's workspace once the review is saved.
  const settlePull = useCallback(
    (id: string, reviewId: string) => {
      const wasActive = store.getSnapshot().active === id;
      const next = store.settle(id, reviewId);
      if (next && wasActive) show(next, true);
    },
    [show, store],
  );
  const pulls = snapshot.workspaces.filter(
    (workspace): workspace is PullWorkspace => workspace.kind === "pull",
  );

  // Other windows' changes to the list, such as a review read there.
  useEffect(() => store.syncAcrossWindows(), [store]);

  // A switch the store makes itself, such as when another window closes the
  // active workspace, moves the address too.
  const addressed = useRef(snapshot.active);
  useEffect(() => {
    if (addressed.current === snapshot.active) return;
    addressed.current = snapshot.active;
    const workspace = snapshot.workspaces.find((entry) => entry.id === snapshot.active);
    if (!workspace || showing(workspace) || overlayAddress(location.pathname)) return;
    history.replaceState({ workspace: workspace.id }, "", workspaceUrl(workspace));
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  }, [snapshot]);

  // Threads that the host opens as tabs, or that this window asked it to
  // open, until its list has them.
  const opening = useRef(new Set<string>());
  // Reviews that agents create arrive on the window channel. Each window lists
  // them unread; with `open`, the window used last shows the review.
  const [windowId] = useState(() => `window-${Math.random().toString(36).slice(2, 10)}`);
  useEffect(() => {
    const mark = () => {
      try {
        localStorage.setItem(WINDOW_KEY, windowId);
      } catch {
        /* Without storage, every visible window shows the review. */
      }
    };
    // A closed window gives the choice back to the visible ones.
    const leave = () => {
      try {
        if (localStorage.getItem(WINDOW_KEY) === windowId) localStorage.removeItem(WINDOW_KEY);
      } catch {
        /* Nothing to clear. */
      }
    };
    if (document.hasFocus()) mark();
    window.addEventListener("focus", mark);
    window.addEventListener("pointerdown", mark, true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("focus", mark);
      window.removeEventListener("pointerdown", mark, true);
      window.removeEventListener("pagehide", leave);
    };
  }, [windowId]);
  const usedLast = useCallback(() => {
    try {
      const last = localStorage.getItem(WINDOW_KEY);
      return last ? last === windowId : document.visibilityState === "visible";
    } catch {
      return document.visibilityState === "visible";
    }
  }, [windowId]);
  useEffect(() => {
    const stop = new AbortController();
    const receive = ({ id, thread, title, open, updated }: ReviewEvent) => {
      // The host opened the thread as a tab.
      opening.current.add(thread);
      const here = open && usedLast();
      const known = store.match({ kind: "thread", threadId: thread });
      // The thread shows the review that its agent just handed off.
      const workspace = store.open(
        {
          kind: "thread",
          threadId: thread,
          ...(id && { reviewId: id }),
          // Until the thread list names it.
          ...(!known && { title }),
          ...((known && !updated) || here ? {} : { unread: true }),
        },
        false,
      );
      // A new iteration: the review marks itself unread again and reloads.
      if (known && updated) {
        if (!here && store.getSnapshot().active !== workspace) store.setUnread(workspace, true);
        window.dispatchEvent(new CustomEvent(REVIEW_UPDATED, { detail: { id } }));
      }
      if (here) show(workspace);
    };
    const others = new BroadcastChannel(WINDOW_CHANNEL);
    others.onmessage = (event: MessageEvent) => {
      const review = reviewEvent.safeParse(event.data);
      if (review.success) receive(review.data);
    };
    const listen = () =>
      listenForReviews(fetcher, stop.signal, (review) => {
        others.postMessage(review);
        receive(review);
      });
    // One window holds the channel and passes reviews to the others, so each
    // window keeps one stream of the six that the browser allows an origin.
    if ("locks" in navigator)
      navigator.locks.request(WINDOW_CHANNEL, { signal: stop.signal }, listen).catch(() => {});
    else void listen();
    return () => {
      stop.abort();
      others.close();
    };
  }, [fetcher, show, store, usedLast]);

  // The address names the workspace: links, reloads, Back, and Forward.
  useEffect(() => {
    const active = store
      .getSnapshot()
      .workspaces.find((entry) => entry.id === store.getSnapshot().active);
    // The start address names the workspace that the window opened on, and
    // the page that it showed when the window closed. Its query and hash,
    // which a link to Med can carry, stay.
    if (active && location.pathname === "/" && !historyWorkspace()) {
      const screen = lastScreen();
      history.replaceState(
        {
          ...(history.state as object),
          workspace: active.id,
          ...(screen?.workspace === active.id && { screen }),
        },
        "",
        workspaceUrl(active) + location.search + location.hash,
      );
    }
    const follow = () => {
      store.follow(location.pathname, history.state);
      if (location.pathname.startsWith("/vault/"))
        vaultAddresses.current.set(store.getSnapshot().active, location.pathname + location.search);
    };
    follow();
    window.addEventListener("popstate", follow);
    window.addEventListener("med:location", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("med:location", follow);
    };
  }, [store]);

  // A page that covers the workspaces, such as Sources, has no checkout for
  // the title band to name.
  const [pathname, setPathname] = useState(() => location.pathname);
  useEffect(() => {
    const follow = () => setPathname(location.pathname);
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);
  // Search is a tab of each workspace. An old search link (`/search?q=…`)
  // opens the Search tab of the workspace on screen, or of a repository's.
  useEffect(() => {
    const follow = () => {
      if (location.pathname !== "/search") return;
      const query = new URLSearchParams(location.search).get("q") ?? "";
      const { workspaces, active } = store.getSnapshot();
      const target =
        workspaces.find((entry) => entry.id === active && entry.kind !== "vault") ??
        workspaces.find((entry) => entry.kind === "repository");
      if (!target) return history.replaceState(history.state, "", "/");
      requestSearchOpen(target.id, query);
      show(target.id, true);
    };
    follow();
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [show, store]);
  // A Search tab's match in another repository opens in that repository's
  // workspace, which opens if it is not open.
  useEffect(() => {
    const open = (event: Event) => {
      const match = (event as CustomEvent<SearchOpen>).detail;
      const id =
        store
          .getSnapshot()
          .workspaces.find(
            (entry) => entry.kind === "repository" && entry.path === match.repository.path,
          )?.id ||
        store.open(
          {
            kind: "repository",
            repositoryId: match.repository.id,
            path: match.repository.path,
            title: match.repository.name,
          },
          false,
        );
      requestFileOpen(id, {
        path: match.path,
        line: match.line,
        source: match.source,
        label:
          match.source.kind === "commit"
            ? `Commit ${match.source.oid.slice(0, 8)}`
            : "Working files",
      });
      show(id);
    };
    window.addEventListener(SEARCH_OPEN_EVENT, open);
    return () => window.removeEventListener(SEARCH_OPEN_EVENT, open);
  }, [show, store]);

  // Registered vaults are pinned first. A vault that is removed closes.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const vaults = await readVaults(fetcher);
      if (cancelled || !vaults) return;
      const before = store.getSnapshot().active;
      store.syncVaults(vaults);
      const after = store.getSnapshot().active;
      if (after !== before) show(after, true);
    };
    void sync();
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [fetcher, show, store]);

  // A quick ⌃Tab can release Control before the switcher listens, so the host
  // tracks the key itself.
  const control = useRef(false);
  const controlHeld = useCallback(() => control.current, []);
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      // Releasing Control reports ctrlKey false; releasing Tab keeps it true.
      control.current = event.ctrlKey;
    };
    const release = () => {
      control.current = false;
    };
    window.addEventListener("keydown", track, true);
    window.addEventListener("keyup", track, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", track, true);
      window.removeEventListener("keyup", track, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  // ⌃Tab opens the switcher: the tabs and the other workspaces, the most
  // recently shown first. Typing in it searches archived threads too.
  const hostHasTabs = useRef(false);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      if (overlayAddress(location.pathname) || visibleElement('[role="dialog"]')) return;
      // Without tabs and history, the switcher needs two workspaces.
      if (!hostHasTabs.current && orderedWorkspaces(store.getSnapshot()).length < 2) return;
      if (event.key === "Tab" && event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        rememberFocus();
        setSwitcher({ held: true, reverse: event.shiftKey });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [rememberFocus, store]);

  // The sidebar lists the tabs, in the reader's order, and the repositories.
  const hostList = useThreads(fetcher);
  // A name that the reader gives a thread shows at once; the host's next list
  // confirms it.
  const [naming, setNaming] = useState<ReadonlyMap<string, Pick<Thread, "title" | "agentTitle">>>(
    () => new Map(),
  );
  if (naming.size && hostList) {
    const still = [...naming].filter(([id, want]) => {
      const thread = hostList.threads.find((entry) => entry.id === id);
      return !!thread && (thread.title !== want.title || thread.agentTitle !== want.agentTitle);
    });
    if (still.length !== naming.size) setNaming(new Map(still));
  }
  const threadList = useMemo(() => {
    if (!naming.size || !hostList || hostList === NO_THREADS) return hostList;
    const threads = hostList.threads.map((thread) => {
      const want = naming.get(thread.id);
      if (!want) return thread;
      const { agentTitle: _agent, ...rest } = thread;
      return { ...rest, ...want };
    });
    return { ...hostList, threads };
  }, [hostList, naming]);
  const hasTabs = !!threadList && threadList !== NO_THREADS;
  useLayoutEffect(() => {
    hostHasTabs.current = hasTabs;
  });
  // Tabs that close here leave at once; the host's next list confirms it.
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());
  if (closing.size && threadList) {
    const still = [...closing].filter((id) => threadList.threads.some((entry) => entry.id === id));
    if (still.length !== closing.size) setClosing(new Set(still));
  }
  const tabs = useMemo(() => {
    const list = threadList?.threads ?? [];
    return closing.size ? list.filter((entry) => !closing.has(entry.id)) : list;
  }, [threadList, closing]);
  const tabsRef = useRef(tabs);
  useLayoutEffect(() => {
    tabsRef.current = tabs;
  });
  // ⌘1–⌘9 follow this order.
  const order = useMemo(() => tabOrder(tabs), [tabs]);
  // Each workspace and the switcher read the tabs' agent states from one store.
  const statuses = useMemo(
    () => new Map((threadList?.threads ?? []).map((entry) => [entry.id, entry])),
    [threadList],
  );
  const [threads] = useState(createThreadStore);
  useLayoutEffect(() => threads.set(statuses), [threads, statuses]);
  // Each window keeps its sidebar: read once, not followed (view-settings.ts).
  const [sidebarVisible, setSidebarVisible] = useState(
    () => viewSettings.sidebar.get() === "shown",
  );
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebar(Number(readStored(SIDEBAR_WIDTH_KEY)) || SIDEBAR_WIDTH),
  );
  const resizeSidebar = useCallback((width: number) => setSidebarWidth(clampSidebar(width)), []);
  useEffect(() => {
    const timer = setTimeout(() => writeStored(SIDEBAR_WIDTH_KEY, String(sidebarWidth)), 200);
    return () => clearTimeout(timer);
  }, [sidebarWidth]);
  // In a narrow window the sidebar opens over the workspace, and a choice closes it.
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const [overlay, setOverlay] = useState(false);
  if (overlay && !narrow) setOverlay(false);
  const showsSidebar = narrow ? overlay : sidebarVisible;
  const toggleSidebar = useCallback(() => {
    if (isNarrow()) return setOverlay((open) => !open);
    setSidebarVisible((visible) => {
      viewSettings.sidebar.set(visible ? "hidden" : "shown");
      return !visible;
    });
  }, [setOverlay, setSidebarVisible]);
  useEffect(() => {
    if (!overlay) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOverlay(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [overlay]);
  const shell = useMemo(
    () => ({ sidebarVisible: showsSidebar, toggleSidebar }),
    [showsSidebar, toggleSidebar],
  );

  // A new thread covers the workspaces until it starts or the reader leaves.
  const [newThread, setNewThread] = useState(false);
  // The Archived page covers them too, at its own address.
  const historyPage = isArchivedAddress(pathname);
  const activeEntry = snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  // The workspace that the views show: while the next one prepares out of
  // sight, the one before, so the band and the view swap in one frame.
  const [viewing, setViewing] = useState<string | null>(null);
  const shownEntry =
    (viewing && activeEntry?.kind !== "vault"
      ? snapshot.workspaces.find((entry) => entry.id === viewing)
      : undefined) ?? activeEntry;
  // The thread on screen, which the title band names.
  const barId = workspaceThread(shownEntry);
  // Its name, which the band shows and renames.
  const barThread = barId ? tabs.find((thread) => thread.id === barId) : undefined;
  // The band names the workspace on screen; none while a page covers them.
  const covered = newThread || !!overlayAddress(pathname);
  const band = useTitleBand(covered ? null : (activeEntry?.id ?? null), setViewing);
  // A page such as Settings names itself, so in a browser tab the band would
  // hold only Show sidebar: the page takes the band's height, and the button
  // sits in its corner. The installed app keeps the band for the window
  // controls.
  const drawsTitleBar = useTitleBarOverlay();
  const pageTop = !newThread && !!overlayAddress(pathname) && !drawsTitleBar;
  useHistoryKeys();
  const activeThread = workspaceThread(activeEntry);
  // The thread on screen; none while a page covers the workspaces.
  const currentThread = newThread || overlayAddress(pathname) ? null : (activeThread ?? null);
  const read = useReadState(tabs, currentThread, fetcher);

  const currentRef = useRef(currentThread);
  // When each tab was last on screen, or first listed in this window.
  const lastShown = useRef(new Map<string, number>());
  useEffect(() => {
    const now = Date.now();
    if (currentRef.current) lastShown.current.set(currentRef.current, now);
    currentRef.current = currentThread;
    if (currentThread) lastShown.current.set(currentThread, now);
  }, [currentThread]);
  // Tabs that closed on their own and that the reader brought back: they stay.
  const kept = useRef(new Set<string>());

  const [notice, setNotice] = useState<TabNotice | null>(null);
  // The Superagent's thread: Med makes it the first time (superagent.ts),
  // then it opens as any thread does.
  const startSuperagent = useCallback(async () => {
    try {
      const { thread } = await createApi(fetcher, readBrowserToken()).json(
        "/api/superagent",
        z.object({ thread: z.string() }),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      );
      actions.open({ kind: "thread", threadId: thread });
    } catch (reason) {
      setNotice({ problem: true, text: errorText(reason, "Med could not start the Superagent.") });
    }
  }, [actions, fetcher]);
  useEffect(() => {
    if (!notice || notice.stays) return;
    const timer = setTimeout(() => setNotice(null), notice.problem ? 8000 : 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // A thread's saved review and its session start to load before its
  // workspace mounts: under the pointer, or at the key that opens it.
  const readThread = useCallback(
    (thread: Thread) => {
      const review = thread.reviews[0];
      if (review) prefetchSavedReview(review.id, fetcher);
      if (thread.session) prefetchThreadSession(thread.id, fetcher);
    },
    [fetcher],
  );
  /** Shows a tab, or a thread from history once the host opens it. */
  const openTab = useCallback(
    (thread: Thread) => {
      setNewThread(false);
      setOverlay(false);
      readThread(thread);
      actions.open(threadInput(thread));
    },
    [actions, readThread, setNewThread],
  );
  // A tab's workspace closes with it, so its streams and Git polling stop.
  const closeView = useCallback(
    (thread: Thread) => {
      const id = store.match(threadInput(thread));
      if (id) actions.close(id);
    },
    [actions, store],
  );
  const forget = useCallback(
    (list: readonly Thread[]) =>
      setClosing((value) => new Set([...value].filter((id) => !list.some((t) => t.id === id)))),
    [],
  );
  /** Asks before a close that leaves unsaved drafts. They stay in the
   * window and in the browser's storage, so the question is a reminder. */
  const confirmClose = useCallback(
    (ids: readonly string[], title: string, close: () => void) => {
      const files = ids.flatMap((id) => drafts.unsavedFiles(id));
      if (!files.length) return close();
      setNotice({
        stays: true,
        text:
          files.length === 1
            ? `“${title}” has unsaved changes in ${files[0]}. Close it? The draft stays, and comes back when you open the file.`
            : `“${title}” has unsaved changes in ${files.length} files. Close it? The drafts stay, and come back when you open the files.`,
        actions: [
          {
            label: "Close",
            run: () => {
              setNotice(null);
              close();
            },
          },
          { label: "Cancel", run: () => setNotice(null) },
        ],
      });
    },
    [drafts],
  );
  useLayoutEffect(() => {
    askClose.current = confirmClose;
  }, [confirmClose]);
  /** Sends tabs to history. Their agents keep working. */
  const closeNow = useCallback(
    async (list: readonly Thread[], details: { auto?: boolean; removeWorktree?: boolean }) => {
      const shown = list.find((thread) => thread.id === currentRef.current);
      setClosing((value) => new Set([...value, ...list.map((thread) => thread.id)]));
      setNotice(null);
      for (const thread of list) closeView(thread);
      const results = await Promise.allSettled(
        list.map((thread) => closeThread(thread.id, details, fetcher)),
      );
      const failed = list.filter((_, index) => results[index]!.status === "rejected");
      if (failed.length) {
        forget(failed);
        if (shown && failed.includes(shown)) openTab(shown);
        const problem = results.find((result) => result.status === "rejected")!;
        setNotice({
          problem: true,
          text: `Kept “${failed[0]!.title}” open. ${reason(problem)}`.trim(),
        });
        return;
      }
      // Archived: ⌘⌥T, ⌃Tab and history bring it back, so no notice.
    },
    [closeView, fetcher, forget, openTab],
  );
  /** Closes tabs. A close that you ask for checks for unsaved drafts first;
   * one that Med makes, as for landed work, does not. */
  const closeTabs = useCallback(
    async (list: readonly Thread[], details: { auto?: boolean; removeWorktree?: boolean } = {}) => {
      if (!list.length) return;
      if (details.auto) return closeNow(list, details);
      const ids = list.flatMap((thread) => store.match(threadInput(thread)) ?? []);
      const title = list.length === 1 ? list[0]!.title : `${list.length} tabs`;
      confirmClose(ids, title, () => void closeNow(list, details));
    },
    [closeNow, confirmClose, store],
  );
  /** ⌘⌥T: the tab that closed last opens at its place. */
  const reopenLast = useCallback(async () => {
    try {
      const thread = await reopenThread(fetcher);
      kept.current.add(thread.id);
      opening.current.add(thread.id);
      forget([thread]);
      openTab(thread);
    } catch (error) {
      setNotice({ problem: true, text: errorText(error, "No closed tab to reopen.") });
    }
  }, [fetcher, forget, openTab]);
  /** Opens a thread from history as a tab, at the top of its repository. */
  const openFromHistory = useCallback(
    async (thread: Thread) => {
      opening.current.add(thread.id);
      forget([thread]);
      openTab(thread);
      try {
        await openThread(thread.id, false, fetcher);
      } catch (error) {
        opening.current.delete(thread.id);
        setNotice({
          problem: true,
          text: `Could not open “${thread.title}”. ${errorText(error, "")}`.trim(),
        });
      }
    },
    [fetcher, forget, openTab],
  );
  /** Deletes a thread for good: its saved review, comments, and history entry. */
  const deleteNow = useCallback(
    async (thread: Thread) => {
      setClosing((value) => new Set(value).add(thread.id));
      closeView(thread);
      try {
        await deleteThread(thread.id, fetcher);
        setNotice({ text: `Deleted “${thread.title}”.` });
      } catch (error) {
        forget([thread]);
        setNotice({
          problem: true,
          text: `Kept “${thread.title}”. ${errorText(error, "")}`.trim(),
        });
        throw error;
      }
    },
    [closeView, fetcher, forget],
  );
  const confirmDelete = useCallback(
    (thread: Thread) =>
      setNotice({
        stays: true,
        text: `Delete “${thread.title}”? Med removes its captures and comments; its agent sessions stay.`,
        actions: [
          { label: "Delete", run: () => void deleteNow(thread).catch(() => {}) },
          { label: "Cancel", run: () => setNotice(null) },
        ],
      }),
    [deleteNow],
  );
  // The thread whose name field shows: in its sidebar row, or in the title band
  // while the sidebar hides.
  const [renaming, setRenaming] = useState<string | null>(null);
  if (renaming && !tabs.some((thread) => thread.id === renaming)) setRenaming(null);
  const pinTo = useCallback(
    async (thread: Thread, pinned: boolean, at?: number) => {
      try {
        await pinThread(thread.id, pinned, fetcher, at);
      } catch (error) {
        setNotice({
          problem: true,
          text: `Could not ${pinned ? "pin" : "unpin"} “${thread.title}”. ${errorText(error, "")}`.trim(),
        });
      }
    },
    [fetcher],
  );
  /** Names a thread. An empty name, or its agent's own title, gives it its
   * agent's title again. */
  const renameTo = useCallback(
    async (thread: Thread, value: string) => {
      const owner = thread.id;
      const agent = thread.agentTitle ?? thread.title;
      const typed = value.trim();
      const name = typed === agent ? "" : typed;
      const want = name ? { title: name, agentTitle: agent } : { title: agent };
      if (want.title === thread.title && want.agentTitle === thread.agentTitle) return;
      setNaming((current) => new Map(current).set(owner, want));
      try {
        await renameThread(owner, name, fetcher);
      } catch (error) {
        setNaming((current) => {
          const next = new Map(current);
          next.delete(owner);
          return next;
        });
        setNotice({
          problem: true,
          text: `Could not rename “${thread.title}”. ${errorText(error, "")}`.trim(),
        });
      }
    },
    [fetcher],
  );
  /** Shows the next tab after the one on screen, in the sidebar's order, that
   * this test chooses. False when there is none. */
  const nextTab = useCallback(
    (wanted: (thread: Thread) => boolean) => {
      const list = tabOrder(tabsRef.current);
      const start = list.findIndex((thread) => thread.id === currentRef.current);
      for (let step = 1; step <= list.length; step++) {
        const thread = list[(start + step) % list.length]!;
        if (thread.id !== currentRef.current && wanted(thread)) {
          openTab(thread);
          return true;
        }
      }
      return false;
    },
    [openTab],
  );
  // ⌘0: the next tab that needs the reader, else the next one whose work
  // finished since they looked, else the next one that works.
  const readRef = useRef(read);
  useLayoutEffect(() => {
    readRef.current = read;
  });
  const nextAttention = useCallback(
    () =>
      nextTab(needsYou) ||
      nextTab((thread) => !needsYou(thread) && readRef.current.isUnread(thread)) ||
      nextTab(isWorking),
    [nextTab],
  );

  // While the reader looks elsewhere: the Dock badge counts the tabs that
  // need them, and an opt-in notification tells when one starts to.
  const needs = needsCount(tabs);
  useAppBadge(threadList ? needs : null);
  useNeedsYouNotifications(threadList ? tabs : null, openTab);

  // ⌘1–⌘9 show the tab at that place in the sidebar; ⌘0 the next that needs
  // the reader; ⌘⌥W closes the tab on screen and ⌘⌥T opens it again.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      if (overlayAddress(location.pathname) || visibleElement('[role="dialog"]')) return;
      const take = () => {
        event.preventDefault();
        event.stopPropagation();
      };
      if (event.altKey) {
        if (event.code === "KeyW") {
          const thread = tabsRef.current.find((entry) => entry.id === currentRef.current);
          if (!thread) return;
          take();
          void closeTabs([thread]);
        } else if (event.code === "KeyT" && hostHasTabs.current) {
          take();
          void reopenLast();
        }
        return;
      }
      if (event.code === "Digit0") {
        if (nextAttention()) take();
        return;
      }
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      const thread = digit && tabOrder(tabsRef.current)[Number(digit) - 1];
      if (!thread) return;
      take();
      openTab(thread);
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [closeTabs, nextAttention, openTab, reopenLast]);

  // The host's tabs and this window's workspaces agree. A tab that closes
  // elsewhere, as with `med thread close`, closes here too.
  const listed = useRef<ReadonlyMap<string, Thread> | null>(null);
  useEffect(() => {
    if (!threadList || threadList === NO_THREADS) return;
    const next = new Map(threadList.threads.map((entry) => [entry.id, entry]));
    for (const id of opening.current) if (next.has(id)) opening.current.delete(id);
    const before = listed.current;
    listed.current = next;
    if (!before) {
      // A window from before tabs can keep workspaces of threads that are
      // history now; they close, except the one on screen.
      const { active, workspaces } = store.getSnapshot();
      for (const workspace of workspaces) {
        const id = workspaceThread(workspace);
        if (id && workspace.id !== active && !next.has(id)) actions.close(workspace.id);
      }
      return;
    }
    for (const [id, thread] of before) {
      if (next.has(id) || opening.current.has(id)) continue;
      const workspace = store.match(threadInput(thread));
      if (!workspace) continue;
      actions.close(workspace);
    }
  }, [actions, store, threadList]);
  // A link to a review that a session handed off opens the session's thread.
  useEffect(() => {
    const owners = new Map<string, string>();
    for (const thread of threadList?.threads ?? [])
      if (thread.kind === "session")
        for (const review of thread.reviews) owners.set(review.id, thread.id);
    store.setThreadOf((reviewId) => owners.get(reviewId));
  }, [store, threadList]);
  // A thread that shows here without a tab, as from a link, opens as one.
  // A thread that the host just made, as with Keep in Med, is in its next list.
  useEffect(() => {
    if (!hasTabs || !activeThread) return;
    const known = () => listed.current?.has(activeThread) || opening.current.has(activeThread);
    if (known()) return;
    const timer = setTimeout(() => {
      if (known()) return;
      opening.current.add(activeThread);
      void openThread(activeThread, true, fetcher).catch(() =>
        opening.current.delete(activeThread),
      );
    }, LIST_WAIT_MS);
    return () => clearTimeout(timer);
  }, [activeThread, fetcher, hasTabs]);

  // A tab whose work has landed goes to history on its own, from the window
  // used last, once it has been off screen for a while (data/tabs.ts). A tab
  // with unsaved drafts stays: only a close that you choose can hide them.
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!hasTabs || !usedLast()) return;
    const now = Math.max(clock, Date.now());
    const done = tabs.filter((thread) => {
      if (!lastShown.current.has(thread.id)) lastShown.current.set(thread.id, now);
      const workspace = store.match(threadInput(thread));
      return (
        !kept.current.has(thread.id) &&
        !(workspace && drafts.unsavedFiles(workspace).length) &&
        landed(thread, {
          unread: read.isUnread(thread),
          onScreen: thread.id === currentThread,
          quietFor: now - lastShown.current.get(thread.id)!,
        })
      );
    });
    if (done.length) void closeTabs(done, { auto: true });
  }, [clock, closeTabs, currentThread, drafts, hasTabs, read, store, tabs, usedLast]);

  // The palette reaches the tabs through one object that does not change, so
  // a change to the tabs does not render every mounted workspace again.
  const [tabListeners] = useState(() => new Set<() => void>());
  useLayoutEffect(() => {
    for (const listener of tabListeners) listener();
  }, [tabListeners, tabs]);
  const latest = useRef({ closeTabs, reopenLast, nextAttention });
  useLayoutEffect(() => {
    latest.current = { closeTabs, reopenLast, nextAttention };
  });
  const tabActions = useMemo<TabActions>(() => {
    const find = (id: string | undefined) =>
      id ? tabsRef.current.find((thread) => thread.id === id) : undefined;
    return {
      isTab: (id) => !!find(id),
      close(id) {
        const thread = find(id);
        if (thread) void latest.current.closeTabs([thread]);
      },
      reopen: () => void latest.current.reopenLast(),
      openHistory() {
        rememberFocus();
        setSwitcher({ held: false, reverse: false, history: true });
      },
      newThread: () => setNewThread(true),
      showHistory: openHistoryPage,
      next: () => void latest.current.nextAttention(),
      rename(id) {
        if (find(id)) setRenaming(id);
      },
      notify(on) {
        void chooseNotify(on).then((result) =>
          setNotice(
            result === "on"
              ? { text: "Med notifies you when a tab needs you and no Med window shows." }
              : result === "off"
                ? { text: "Notifications are off." }
                : result === "blocked"
                  ? {
                      problem: true,
                      text: "The browser blocks Med's notifications. Allow them in its site settings.",
                    }
                  : { problem: true, text: "This browser cannot show notifications." },
          ),
        );
      },
      subscribe(listener) {
        tabListeners.add(listener);
        return () => void tabListeners.delete(listener);
      },
    };
  }, [rememberFocus, tabListeners, setRenaming, setNewThread]);

  // The tabs load ahead, as open terminal tabs stay loaded; the one under the
  // pointer first. History never loads ahead.
  const [pointed, setPointed] = useState<string | null>(null);
  // A tab loaded ahead keeps one workspace object while it stays the same, so
  // a list update or a switch does not render its view again.
  const [warmWorkspaces] = useState(() => new Map<string, ThreadWorkspace>());
  const warm = useMemo<WarmThreads>(() => {
    const open = new Map(
      snapshot.workspaces.flatMap((entry) => {
        const id = workspaceThread(entry);
        return id ? [[id, entry.id] as const] : [];
      }),
    );
    const active = new Set<string>();
    const ahead: (WarmThreads["threads"][number] & { place: number })[] = [];
    for (const [place, thread] of order.entries()) {
      const known = open.get(thread.id);
      if (known) {
        active.add(known);
        continue;
      }
      const workspace = warmWorkspace(thread, warmWorkspaces);
      if (!workspace) continue;
      active.add(workspace.id);
      ahead.push({ workspace, ...(thread.session && { session: thread.session.id }), place });
    }
    // The tabs next to the one on screen are the likeliest visits: nearest
    // first, the one below before the one above.
    const shown = workspaceThread(
      snapshot.workspaces.find((entry) => entry.id === snapshot.active),
    );
    const at = order.findIndex((thread) => thread.id === shown);
    const far = (place: number) => Math.abs(place - at) * 2 + (place < at ? 1 : 0);
    if (at >= 0) ahead.sort((a, b) => far(a.place) - far(b.place));
    return {
      threads: ahead.map(({ place: _place, ...entry }) => entry),
      next: ahead.some((entry) => entry.workspace.id === pointed) ? pointed : null,
      active,
    };
  }, [order, snapshot.workspaces, snapshot.active, pointed, warmWorkspaces]);
  const activeRepositoryId =
    activeEntry?.kind === "repository"
      ? activeEntry.repositoryId
      : activeEntry?.kind === "thread"
        ? statuses.get(activeEntry.threadId)?.repository?.id
        : undefined;
  // A press on a thread reads its session before the click renders the
  // workspace, so the session's code loads while the window is idle.
  const hasSessions = tabs.some((thread) => thread.session);
  useEffect(() => {
    if (!hasSessions || sessionStream) return;
    return whenIdle(() => {
      void import("../data/session-stream").then((module) => (sessionStream ??= module));
    });
  }, [hasSessions]);
  useEffect(() => {
    // ⌥N, or ⌘N where the browser lets the page have it: the installed app
    // gets every key first (Chrome reserves none in an app's window), and a
    // browser tab keeps ⌘N for a new window. Before any other handler, so the
    // app's window never opens a second window instead. Control+N stays the
    // editor's on macOS. In another dialog, ⌘N does nothing.
    const mac = /Mac/.test(navigator.platform);
    const keydown = (event: KeyboardEvent) => {
      if (event.shiftKey || event.isComposing) return;
      // ⌥N by the key's place, as macOS types a dead key for it; ⌘N by its
      // letter, so other layouts keep their own ⌘ keys.
      const option = event.code === "KeyN" && event.altKey && !event.metaKey && !event.ctrlKey;
      const command =
        event.key.toLowerCase() === "n" &&
        !event.altKey &&
        (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey);
      if (!option && !command) return;
      const target = event.target instanceof Element ? event.target : null;
      const dialog = target?.closest('[role="dialog"], [role="alertdialog"]');
      if (dialog && dialog.getAttribute("aria-label") !== "New thread") {
        // Another dialog keeps ⌥N for its text; ⌘N still opens no window.
        if (command) event.preventDefault();
        return;
      }
      event.preventDefault();
      setNewThread(true);
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, []);
  // ⌘B anywhere, such as in a vault; a review handles it first.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      if ((event.target as HTMLElement).closest?.(".cm-editor") && event.ctrlKey) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [toggleSidebar]);
  const noticeBar = notice && (
    <NoticeBar notice={notice} onDismiss={() => setNotice(null)} floating={!showsSidebar} />
  );
  return (
    <Drafts value={drafts}>
      <Actions value={actions}>
        <Snapshot value={snapshot}>
          <Threads value={threads}>
            <Tabs value={tabActions}>
              <HostFetch value={fetcher}>
                <PullErrors value={pullErrors}>
                  {pulls.map((workspace) => (
                    <PullWatcher
                      key={workspace.id}
                      workspace={workspace}
                      onTitle={(title) => store.update(workspace.id, { title })}
                      onSaved={(reviewId) => settlePull(workspace.id, reviewId)}
                    />
                  ))}
                  <ShellContext value={shell}>
                    <div {...stylex.props(styles.shell)}>
                      {showsSidebar && narrow && (
                        <div
                          aria-hidden="true"
                          onPointerDown={() => setOverlay(false)}
                          {...stylex.props(styles.shellScrim)}
                        />
                      )}
                      {showsSidebar && (
                        <>
                          <aside
                            aria-label="Sidebar"
                            {...stylex.props(
                              styles.shellSidebar,
                              narrow ? styles.shellOverlay : styles.width(sidebarWidth),
                            )}
                          >
                            <SessionSidebar
                              threads={tabs}
                              current={currentThread ?? null}
                              read={read}
                              loaded={!!threadList}
                              notice={noticeBar}
                              newThread={newThread}
                              renaming={renaming}
                              onOpen={(thread) => {
                                setOverlay(false);
                                openTab(thread);
                              }}
                              onNewThread={() => {
                                setOverlay(false);
                                setNewThread(true);
                              }}
                              onHide={toggleSidebar}
                              onSettings={() => openSettings()}
                              onHistory={() => {
                                setOverlay(false);
                                setNewThread(false);
                                openHistoryPage();
                              }}
                              onPullRequests={() => {
                                setOverlay(false);
                                openPullRequests();
                              }}
                              onSuperagent={() => {
                                setOverlay(false);
                                void startSuperagent();
                              }}
                              onArchive={(thread) =>
                                void closeTabs([thread], { removeWorktree: false })
                              }
                              onDelete={confirmDelete}
                              onPrefetch={(thread) => {
                                readThread(thread);
                                setPointed(threadWorkspaceId(thread.id));
                              }}
                              onRenaming={(thread) => setRenaming(thread?.id ?? null)}
                              onRename={(thread, name) => void renameTo(thread, name)}
                              onPin={(thread, pinned, at) => void pinTo(thread, pinned, at)}
                            />
                          </aside>
                          {!narrow && (
                            <div
                              role="separator"
                              aria-label="Resize sidebar"
                              aria-orientation="vertical"
                              aria-valuenow={sidebarWidth}
                              aria-valuemin={SIDEBAR_MIN}
                              aria-valuemax={SIDEBAR_MAX}
                              tabIndex={0}
                              {...stylex.props(styles.shellGutter, stylex.defaultMarker())}
                              onKeyDown={(event) => {
                                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                                event.preventDefault();
                                resizeSidebar(
                                  sidebarWidth + (event.key === "ArrowLeft" ? -16 : 16),
                                );
                              }}
                              onPointerDown={(event) =>
                                event.currentTarget.setPointerCapture(event.pointerId)
                              }
                              onPointerMove={(event) => {
                                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                                resizeSidebar(event.clientX);
                              }}
                              onDoubleClick={() => resizeSidebar(SIDEBAR_WIDTH)}
                            >
                              <span {...stylex.props(styles.shellGutterLine)} />
                            </div>
                          )}
                        </>
                      )}
                      <div data-shell-main="" {...stylex.props(styles.shellMain)}>
                        {!pageTop && (
                          <WorkspaceBar
                            context={
                              covered
                                ? undefined
                                : barContext(shownEntry, threadList ?? null, barThread?.title)
                            }
                            slots={band.slots}
                            titled={band.titled}
                            covered={band.covered}
                            showSidebar={!showsSidebar || narrow ? toggleSidebar : undefined}
                            needs={showsSidebar ? 0 : needs}
                            rename={
                              barThread && {
                                thread: barThread,
                                editing: !showsSidebar && renaming === barThread.id,
                                start: () => setRenaming(barThread.id),
                                done: (name) => {
                                  setRenaming(null);
                                  if (name !== null) void renameTo(barThread, name);
                                },
                              }
                            }
                          />
                        )}
                        <div {...stylex.props(styles.shellViews)}>
                          {pageTop && (!showsSidebar || narrow) && (
                            <span {...stylex.props(styles.pageToggle)}>
                              <ToolButton
                                label={
                                  needs > 0 ? `Show sidebar · ${needs} needs you` : "Show sidebar"
                                }
                                shortcut="Mod+B"
                                icon="panelLeft"
                                dot={needs > 0}
                                onClick={toggleSidebar}
                              />
                              <HistoryArrows />
                            </span>
                          )}
                          <div
                            inert={newThread || historyPage || undefined}
                            {...stylex.props(styles.shellLayer)}
                          >
                            <Band value={band.value}>
                              <Warm value={warm}>{children}</Warm>
                            </Band>
                          </div>
                          {historyPage && (
                            <HistoryPage
                              tabs={order}
                              fetcher={fetcher}
                              onOpen={(thread) => void openFromHistory(thread)}
                              onDelete={deleteNow}
                            />
                          )}
                          {!showsSidebar && noticeBar}
                          {newThread && (
                            <NewThread
                              list={threadList}
                              fetcher={fetcher}
                              repositoryId={activeRepositoryId}
                              onCancel={() => setNewThread(false)}
                              onStarted={(thread) => {
                                opening.current.add(thread);
                                setNewThread(false);
                                actions.open({ kind: "thread", threadId: thread });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </ShellContext>
                </PullErrors>
              </HostFetch>
              {switcher && (
                <WorkspaceSwitcher
                  snapshot={snapshot}
                  tabs={order}
                  hasHistory={hasTabs}
                  history={!!switcher.history}
                  held={switcher.held}
                  controlHeld={controlHeld}
                  reverse={switcher.reverse}
                  fetcher={fetcher}
                  onChoose={(id) => {
                    setSwitcher(null);
                    show(id);
                  }}
                  onOpenTab={(thread) => {
                    setSwitcher(null);
                    openTab(thread);
                  }}
                  onOpenHistory={(thread) => {
                    setSwitcher(null);
                    void openFromHistory(thread);
                  }}
                  onDelete={deleteNow}
                  onCancel={() => setSwitcher(null)}
                />
              )}
            </Tabs>
          </Threads>
        </Snapshot>
      </Actions>
    </Drafts>
  );
}

/** One controller per mounted workspace, with the disposers of the objects
 * its view owns, such as its open files. Only the one on screen listens for
 * changes; the rest catch up when they are shown again. */
function createControllerPool(
  options: ControllerOptions,
  threads: ThreadStore,
  createParser?: ParserFactory,
) {
  const live = new Map<
    string,
    {
      controller: ReviewController;
      /** The review that the controller shows, if any. */
      reviewId?: string;
      /** Whether the thread list had the thread when the controller started. */
      listed: boolean;
      parser?: ReturnType<ParserFactory>;
      disposers: Set<() => void>;
    }
  >();
  const end = (id: string) => {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    entry.controller.dispose();
    entry.parser?.dispose();
    for (const dispose of entry.disposers) dispose();
  };
  return {
    get(workspace: RepositoryWorkspace | ThreadWorkspace) {
      const thread =
        workspace.kind === "thread" ? threads.get().get(workspace.threadId) : undefined;
      let entry = live.get(workspace.id);
      // A thread shows the review that the reader chose, else the one that it
      // shows already while the thread still lists it, else its newest; a
      // session that has handed off none shows its checkout's Changes.
      const shown =
        entry?.reviewId &&
        (!thread || thread.reviews.some((review) => review.id === entry!.reviewId))
          ? entry.reviewId
          : undefined;
      const reviewId =
        workspace.kind === "thread"
          ? (workspace.reviewId ??
            shown ??
            thread?.reviews[0]?.id ??
            (REVIEW_ID.test(workspace.threadId) ? workspace.threadId : undefined))
          : undefined;
      // The thread's first hand-off joins the controller that shows its
      // Changes, so the reader stays where they are. A thread that the list
      // did not have yet, as one that opens again, starts on its review.
      if (entry && !entry.reviewId && entry.listed && reviewId) {
        entry.reviewId = reviewId;
        void entry.controller.attachSavedReview(reviewId);
      }
      // Another review of the thread takes the controller's place. The
      // workspace's view stays mounted, so what it owns stays too: its open
      // files, its drafts, and what it read ahead.
      let disposers: Set<() => void> | undefined;
      if (entry && entry.reviewId !== reviewId) {
        live.delete(workspace.id);
        entry.controller.dispose();
        entry.parser?.dispose();
        disposers = entry.disposers;
        entry = undefined;
      }
      if (!entry) {
        const parser = createParser?.();
        const own = parser ? { ...options, parsePatch: parser.parse } : options;
        const start = {
          path: thread?.checkout ?? workspace.path,
          repositoryId: thread?.repository?.id ?? workspace.repositoryId,
          branch: workspace.kind === "repository" ? workspace.branch : undefined,
        };
        const controller = createReviewController({
          ...own,
          ...(workspace.kind === "thread"
            ? {
                thread: {
                  id: workspace.threadId,
                  ...(start.path && { path: start.path }),
                  ...(start.repositoryId && { repositoryId: start.repositoryId }),
                  ...(thread?.base && { base: thread.base }),
                },
                lead: () => leadReady(workspace.id),
              }
            : {}),
          ...(reviewId ? { savedReviewId: reviewId } : { start }),
        });
        entry = {
          controller,
          ...(reviewId && { reviewId }),
          listed: !!thread,
          parser,
          disposers: disposers ?? new Set(),
        };
        live.set(workspace.id, entry);
        void controller.initialize();
      }
      return entry;
    },
    retain(ids: readonly string[]) {
      for (const id of [...live.keys()]) if (!ids.includes(id)) end(id);
    },
    focus(id: string | null) {
      for (const [key, { controller, parser }] of live) {
        parser?.show?.(key === id);
        if (key === id) controller.resume();
        else controller.suspend();
      }
    },
    dispose() {
      for (const id of [...live.keys()]) end(id);
    },
  };
}

/**
 * Renders the review of each mounted workspace. Hidden ones keep their state,
 * scroll, and open files; their effects stop until they are shown again.
 */
export function WorkspaceViews({
  options,
  createParser,
  children: render,
}: {
  options: ControllerOptions;
  createParser?: ParserFactory;
  children(controller: ReviewController): ReactNode;
}) {
  const snapshot = use(Snapshot);
  if (!snapshot) throw new Error("WorkspaceViews needs a WorkspaceHost.");
  const fetcher = use(HostFetch);
  const warm = use(Warm);
  const threadStore = use(Threads);
  const [pool] = useState(() => createControllerPool(options, threadStore, createParser));
  const [mounted, setMounted] = useState<string[]>([]);
  const active = snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  const onScreen = active && active.kind !== "vault" ? active.id : null;
  // A thread that is not open yet mounts under its workspace's id, so its
  // first visit shows the same slot.
  const workspaceOf = useCallback(
    (id: string): Workspace | undefined =>
      snapshot.workspaces.find((entry) => entry.id === id) ??
      warm.threads.find((entry) => entry.workspace.id === id)?.workspace,
    [snapshot.workspaces, warm.threads],
  );
  const isOpen = (id: string) => snapshot.workspaces.some((entry) => entry.id === id);
  let next = mounted.filter((id) => workspaceOf(id));
  if (warm.next && !next.includes(warm.next)) next = [warm.next, ...next];
  if (onScreen && next[0] !== onScreen) next = [onScreen, ...next.filter((id) => id !== onScreen)];
  // The tabs, up to TABS_MOUNTED of the most recently shown, and the most
  // recent of the other open workspaces.
  let tabs = 0;
  let opened = 0;
  next = next.filter((id) =>
    warm.active.has(id) ? ++tabs <= TABS_MOUNTED : isOpen(id) && ++opened <= MOUNTED,
  );
  if (next.length !== mounted.length || next.some((id, index) => id !== mounted[index]))
    setMounted(next);

  // A thread shows its newest review once its agent hands one off.
  useSyncExternalStore(threadStore.subscribe, () =>
    mounted
      .map((id) => {
        const workspace = workspaceOf(id);
        return workspace?.kind === "thread" && !workspace.reviewId
          ? (threadStore.get().get(workspace.threadId)?.reviews[0]?.id ?? "")
          : "";
      })
      .join(" "),
  );
  useEffect(() => pool.retain(mounted), [pool, mounted]);
  useEffect(() => pool.focus(onScreen), [pool, onScreen, mounted]);

  // A workspace that has not shown yet renders out of sight while the last
  // one stays on screen, and takes its place in one frame when nothing in it
  // is still pending, as a native app swaps views. A thread whose session is
  // on screen shows when its session is ready, and its review fills in after,
  // so a large diff does not hold the thread. A slow one shows anyway after
  // PREPARE_MS.
  const [seen] = useState(() => new Set<string>());
  const [shown, setShown] = useState(onScreen);
  const preparing =
    onScreen && shown && onScreen !== shown && !seen.has(onScreen) && next.includes(shown)
      ? onScreen
      : null;
  if (!preparing && shown !== onScreen) setShown(onScreen);
  const visible = preparing ? shown : onScreen;
  useLayoutEffect(() => {
    if (visible) seen.add(visible);
  }, [seen, visible]);
  // The band names what shows; a layout effect, so it changes before the paint.
  const showingIn = use(Band)?.showing;
  useLayoutEffect(() => {
    showingIn?.(visible);
  }, [showingIn, visible]);
  useEffect(() => {
    if (!preparing) return;
    const started = performance.now();
    let frame = requestAnimationFrame(function check() {
      const slot = document.querySelector(`[data-workspace-slot="${CSS.escape(preparing)}"]`);
      const ready =
        !!slot?.firstElementChild && !pending(slot.querySelector("[data-lead]") ?? slot);
      // The swap commits in this frame, before it paints; a plain update
      // would render after the paint and show a frame later.
      if (ready || performance.now() - started > PREPARE_MS) flushSync(() => setShown(preparing));
      else frame = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(frame);
  }, [preparing]);

  // The warm pool loads tabs ahead and settles them, one step at a time, and
  // only while the reader does not act: each step waits until no key or press
  // came for QUIET_MS, no workspace prepares, and the one on screen has
  // loaded (or tried for SHOW_WAIT_MS), and then for an idle callback.
  const screenRef = useRef<{ visible?: string | null; preparing: string | null; since: number }>({
    preparing: null,
    since: 0,
  });
  useLayoutEffect(() => {
    if (screenRef.current.visible !== visible) screenRef.current.since = performance.now();
    screenRef.current.visible = visible;
    screenRef.current.preparing = preparing;
  });
  const [busy] = useState(() => () => {
    const { visible, preparing, since } = screenRef.current;
    if (preparing) return true;
    if (!visible || performance.now() - since > SHOW_WAIT_MS) return false;
    const slot = document.querySelector(`[data-workspace-slot="${CSS.escape(visible)}"]`);
    return !slot?.firstElementChild || pending(slot);
  });
  // It starts QUIET_MS after the first workspace shows, so a key soon after
  // the page loads does not wait for it.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (started) return;
    let ready = 0;
    return whenFree(
      () => setStarted(true),
      () => {
        if (busy()) ready = 0;
        else ready ||= performance.now();
        return !ready || performance.now() - ready < QUIET_MS;
      },
    );
  }, [started, busy]);
  // One session reads ahead at a time; the pool's next step waits for it.
  const [reading, setReading] = useState<string | null>(null);
  const [read] = useState(() => new Set<string>());
  // A thread loaded ahead shows out of sight once while the browser is idle,
  // so its effects measure it and render its Markdown, as a visit would.
  // Its state stays when it hides again, and its first visit then shows it
  // at once, as a revisit does.
  const [settling, setSettling] = useState<string | null>(null);
  // One try each: a thread whose agent writes all the time never settles.
  const [tried] = useState(() => new Set<string>());
  if (settling && (settling === onScreen || !next.includes(settling))) setSettling(null);
  const unsettled = preparing
    ? []
    : next.filter(
        (id) =>
          id !== onScreen && !seen.has(id) && !tried.has(id) && workspaceOf(id)?.kind === "thread",
      );
  const unsettledKey = unsettled.join(" ");
  useEffect(() => {
    if (!started || settling || !unsettledKey) return;
    const controllers = unsettledKey.split(" ").flatMap((id) => {
      const workspace = workspaceOf(id) as ThreadWorkspace;
      // A thread settles after its session has read ahead.
      return id === reading ? [] : [{ id, controller: pool.get(workspace).controller }];
    });
    let cancel: (() => void) | undefined;
    const check = () => {
      const loaded = controllers.find(
        // A thread with a session settles once it knows its review: its
        // session leads, and its diff waits for the session.
        ({ id, controller }) => {
          const snapshot = controller.getSnapshot();
          const workspace = workspaceOf(id);
          const session =
            workspace?.kind === "thread" && threadStore.get().get(workspace.threadId)?.session;
          return snapshot.status !== "loading" || (!!session && !!snapshot.savedReview);
        },
      );
      if (!loaded || cancel) return;
      cancel = whenFree(() => setSettling(loaded.id), busy);
    };
    const stops = controllers.map(({ controller }) => controller.subscribe(check));
    check();
    return () => {
      for (const stop of stops) stop();
      cancel?.();
    };
  }, [started, settling, unsettledKey, reading, workspaceOf, pool, busy, threadStore]);
  useEffect(() => {
    if (!settling) return;
    tried.add(settling);
    const slot = document.querySelector(`[data-workspace-slot="${CSS.escape(settling)}"]`);
    if (!slot) {
      const frame = requestAnimationFrame(() => setSettling(null));
      return () => cancelAnimationFrame(frame);
    }
    // A key or a press stops it, to try again when the reader stops.
    const stop = onInput(() => {
      tried.delete(settling);
      setSettling(null);
    });
    // Panes size themselves after the first frame, so a slot is ready when
    // nothing in it is pending and nothing changed for two frames.
    let quiet = 0;
    const changes = new MutationObserver(() => (quiet = 0));
    changes.observe(slot, { subtree: true, childList: true, attributes: true });
    const started = performance.now();
    let frame = requestAnimationFrame(function check() {
      quiet = slot.firstElementChild && !slot.querySelector("[data-pending]") ? quiet + 1 : 0;
      if (quiet > 2) seen.add(settling);
      if (quiet > 2 || performance.now() - started > SETTLE_MS) setSettling(null);
      else frame = requestAnimationFrame(check);
    });
    return () => {
      stop();
      cancelAnimationFrame(frame);
      changes.disconnect();
    };
  }, [seen, tried, settling]);

  // Key handlers read which workspace is on screen when a key comes.
  const [screen] = useState(createScreen);
  useLayoutEffect(() => screen.show(visible), [screen, visible]);

  // A workspace that shows ends its entrance animations at once for a moment
  // (see reset.css): they restart when display: none ends.
  useLayoutEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.dataset.workspaceShown = "";
    const timer = setTimeout(() => delete root.dataset.workspaceShown, 400);
    return () => {
      clearTimeout(timer);
      delete root.dataset.workspaceShown;
    };
  }, [visible]);

  // When every mounted workspace has loaded, read its session, and settled,
  // the next one loads hidden while the reader does not act: open
  // workspaces, then the tabs nearest to the one on screen, as a terminal
  // keeps its open tabs. A first visit then shows a rendered thread instead
  // of loading in front of the reader.
  const tabsMounted = mounted.filter((id) => warm.active.has(id)).length;
  const openCount = mounted.filter((id) => !warm.active.has(id) && isOpen(id)).length;
  const cold =
    orderedWorkspaces(snapshot).find(
      (entry) =>
        entry.kind !== "vault" &&
        entry.kind !== "pull" &&
        !mounted.includes(entry.id) &&
        (warm.active.has(entry.id) ? tabsMounted < TABS_MOUNTED : openCount < MOUNTED),
    )?.id ??
    warm.threads.find(
      ({ workspace }) => !mounted.includes(workspace.id) && tabsMounted < TABS_MOUNTED,
    )?.workspace.id;
  useEffect(() => {
    if (!started || !cold || settling || reading || unsettledKey) return;
    const controllers = mounted.flatMap((id) => {
      const workspace = workspaceOf(id);
      return workspace && workspace.kind !== "vault" && workspace.kind !== "pull"
        ? [pool.get(workspace).controller]
        : [];
    });
    let cancel: (() => void) | undefined;
    const check = () => {
      if (cancel) return;
      if (controllers.some((controller) => controller.getSnapshot().status === "loading")) return;
      cancel = whenFree(
        () => setMounted((current) => (current.includes(cold) ? current : [...current, cold])),
        busy,
      );
    };
    const stops = controllers.map((controller) => controller.subscribe(check));
    check();
    return () => {
      for (const stop of stops) stop();
      cancel?.();
    };
  }, [started, cold, settling, reading, unsettledKey, mounted, pool, workspaceOf, busy]);

  // Its newest session reads ahead too, one at a time while the reader does
  // not act, so a first visit shows the thread with the review.
  useEffect(() => {
    if (!started || reading) return;
    const entry = mounted
      .map((id) => {
        const workspace = workspaceOf(id);
        if (workspace?.kind !== "thread" || id === onScreen) return undefined;
        const session =
          threadStore.get().get(workspace.threadId)?.session?.id ??
          warm.threads.find((entry) => entry.workspace.id === id)?.session;
        return session ? { id, threadId: workspace.threadId } : undefined;
      })
      .find((entry) => entry && !read.has(entry.threadId));
    if (!entry) return;
    return whenFree(() => {
      read.add(entry.threadId);
      setReading(entry.id);
      prefetchThreadSession(entry.threadId, fetcher, () => setReading(null));
    }, busy);
  }, [
    started,
    reading,
    read,
    mounted,
    onScreen,
    workspaceOf,
    warm.threads,
    fetcher,
    busy,
    threadStore,
  ]);
  useEffect(() => {
    const leave = () => pool.dispose();
    window.addEventListener("pagehide", leave, { once: true });
    return () => {
      window.removeEventListener("pagehide", leave);
      pool.dispose();
    };
  }, [pool]);
  // Slots keep one order: `mounted` is most recent first, and a slot that
  // moved in the DOM would lose its scroll offsets, as a thread that jumps to
  // its top while the next workspace prepares.
  const slots = mounted.toSorted().flatMap((id) => {
    const workspace = workspaceOf(id);
    if (!workspace || workspace.kind === "vault") return [];
    if (workspace.kind === "pull")
      return (
        <Activity key={id} mode={id === onScreen ? "visible" : "hidden"}>
          <Current value={id}>
            <PullView workspace={workspace} />
          </Current>
        </Activity>
      );
    const { controller, disposers } = pool.get(workspace);
    const outOfSight = id === preparing || id === settling;
    return (
      <Activity key={id} mode={id === visible || outOfSight ? "visible" : "hidden"}>
        <Current value={id}>
          <Entry value={workspace}>
            <ShownCheck value={screen.check(id)}>
              <InView value={id === visible}>
                <Lifetime value={disposers}>
                  <KeepScroll id={id} preparing={outOfSight} showing={id === preparing}>
                    {render(controller)}
                  </KeepScroll>
                </Lifetime>
              </InView>
            </ShownCheck>
          </Entry>
        </Current>
      </Activity>
    );
  });
  return slots;
}

/** Follows a pull request's job for the list: its title, then its review. */
function PullWatcher({
  workspace,
  onTitle,
  onSaved,
}: {
  workspace: PullWorkspace;
  onTitle(title: string): void;
  onSaved(reviewId: string): void;
}) {
  const job = usePullJob(workspace.jobId, use(HostFetch));
  const known = job && job !== "lost" ? job : undefined;
  const title = known?.title ? pullTitle(workspace.url, known) : undefined;
  const saved = known?.status === "done" ? known.reviewId : undefined;
  const latest = useRef({ onTitle, onSaved });
  useLayoutEffect(() => {
    latest.current = { onTitle, onSaved };
  });
  useEffect(() => {
    if (title) latest.current.onTitle(title);
  }, [title]);
  useEffect(() => {
    if (saved) latest.current.onSaved(saved);
  }, [saved]);
  return null;
}

/** A pull request's workspace while the host opens it. */
function PullView({ workspace }: { workspace: PullWorkspace }) {
  const actions = use(Actions);
  const errors = use(PullErrors);
  const job = usePullJob(workspace.jobId, use(HostFetch));
  const state: PullState =
    job === "lost" ? { error: LOST } : { job, error: errors.get(workspace.id) };
  return (
    <PullWorkspaceView
      url={workspace.url}
      state={state}
      onRetry={() => actions?.retryPull(workspace.id)}
    />
  );
}

/** The session module once a thread has loaded it, so that a press reads
 * its session at once rather than after the click renders the workspace. */
let sessionStream: typeof import("../data/session-stream") | undefined;
/** A thread's session, read ahead with its newest replies' Markdown, so the
 * thread shows with the workspace's first frame. */
function prefetchThreadSession(threadId: string, fetcher: typeof fetch, onDone?: () => void) {
  const read = ({ prefetchSession }: typeof import("../data/session-stream")) =>
    prefetchSession(
      threadId,
      (store) => {
        // The replies that the thread shows first render in the worker
        // while the thread builds, so it shows when it is built.
        const { items, running } = store.getSnapshot();
        const theme = themeController.getSnapshot().active.pierreTheme;
        for (const done of renderBriefs(theme, endReplies(items, running, 24), false, {
          cache: "session",
        }))
          done.catch(() => {});
      },
      fetcher,
    );
  void (
    sessionStream
      ? read(sessionStream)
      : import("../data/session-stream").then((module) => read((sessionStream = module)))
  )
    .catch(() => {})
    .finally(() => onDone?.());
}

/** The workspace on screen, and a check of it for each workspace. */
function createScreen() {
  let shown: string | null = null;
  const checks = new Map<string, () => boolean>();
  return {
    show(id: string | null) {
      shown = id;
    },
    check(id: string) {
      let check = checks.get(id);
      if (!check) checks.set(id, (check = () => shown === id));
      return check;
    },
  };
}

/** A part of a workspace that still loads, or holds one that does. */
const pending = (node: Element) =>
  node.matches("[data-pending]") || !!node.querySelector("[data-pending]");

/** Resolves once the workspace's lead pane, its session on screen, has its
 * thread, and has painted if the workspace is about to show; as soon as the
 * review shows that the session does not lead, and after PREPARE_MS at the
 * latest. Work that waits for it does not hold the frame that shows the
 * thread. */
function leadReady(id: string) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, PREPARE_MS);
    let frame = 0;
    function done() {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    }
    (function check() {
      const slot = document.querySelector(`[data-workspace-slot="${CSS.escape(id)}"]`);
      // A workspace out of sight renders late; it says which pane leads once
      // it has its saved review.
      const leads = slot?.querySelector<HTMLElement>("[data-leads]")?.dataset.leads;
      if (leads === "review") return done();
      const lead = leads && slot!.querySelector("[data-lead]");
      if (!lead) {
        frame = requestAnimationFrame(check);
        return;
      }
      // A slot that is about to show waits until it shows; the task after
      // this frame comes after its paint. One loaded ahead goes on at once.
      if (!pending(lead) && !slot!.hasAttribute("data-showing")) setTimeout(done);
      else frame = requestAnimationFrame(check);
    })();
  });
}

/** Hidden workspaces have no layout, so the browser forgets their scroll
 * offsets. This records them as they change and restores them when the
 * workspace is shown, before its own effects read them. Virtualized diffs
 * measure themselves again after the first frame and re-anchor, so the saved
 * offsets apply once more after that measurement. */
function KeepScroll({
  id,
  preparing,
  showing,
  children,
}: {
  id: string;
  /** Renders out of sight until it shows; it takes no input meanwhile. */
  preparing: boolean;
  /** Prepares to take the screen, rather than to settle while loaded ahead. */
  showing: boolean;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<Element, [number, number]>());
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const saved = [...offsets.current].filter(([element]) => element.isConnected);
    offsets.current = new Map(saved);
    const restore = () => {
      for (const [element, [top, left]] of saved)
        element.scrollTo({ top, left, behavior: "instant" });
    };
    restore();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore);
    });
    const record = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.getClientRects().length)
        offsets.current.set(target, [target.scrollTop, target.scrollLeft]);
    };
    node.addEventListener("scroll", record, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", record, { capture: true });
    };
  }, []);
  return (
    <div
      ref={root}
      data-workspace-slot={id}
      data-showing={showing || undefined}
      inert={preparing || undefined}
      style={{ display: "contents", visibility: preparing ? "hidden" : undefined }}
    >
      {children}
    </div>
  );
}

function iconFor(workspace: Workspace): IconName {
  // A session's thread shows its agent.
  const agent =
    workspace.kind === "thread" ? /^(claude|codex)-/.exec(workspace.threadId)?.[1] : undefined;
  if (agent) return agent as IconName;
  return workspace.kind === "vault"
    ? "vault"
    : workspace.kind === "thread" || workspace.kind === "pull"
      ? "pullRequest"
      : workspace.branch
        ? "branch"
        : "commit";
}
function labelFor(workspace: Workspace) {
  if (workspace.title) return workspace.title;
  if (workspace.kind === "vault") return "Vault";
  if (workspace.kind === "thread") return "Thread";
  if (workspace.kind === "pull") return "Pull request";
  return workspace.branch ?? "Working changes";
}
/** Repository names help only when the list spans more than one repository. */
function qualifiers(rows: Workspace[]) {
  const names = new Set(
    rows.flatMap((entry) =>
      entry.kind === "repository" && entry.repository ? [entry.repository] : [],
    ),
  );
  return (workspace: Workspace) =>
    names.size > 1 && workspace.kind === "repository" ? workspace.repository : undefined;
}

const agentLabel = (thread: Thread) =>
  thread.agent === "claude" ? "Claude" : thread.agent === "codex" ? "Codex" : "The agent";

/** A small turning arc while the review's agent works. */
function WorkingMark({ label, hides }: { label: string; hides: boolean }) {
  return (
    <span
      aria-hidden="true"
      title={label}
      {...stylex.props(styles.working, hides && styles.detailHides)}
    />
  );
}
type SwitchRow =
  | { kind: "workspace"; key: string; workspace: Workspace; thread?: Thread }
  | { kind: "tab"; key: string; thread: Thread }
  | { kind: "history"; key: string; thread: Thread };

/** The most history rows that the switcher shows at once. */
const HISTORY_ROWS = 60;
const optionId = (key: string) => `workspace-switch-${key.replace(/[^\w-]/g, "-")}`;

/** A thread's state in the switcher: one mark at most. */
function ThreadState({ thread, unread }: { thread: Thread | undefined; unread?: boolean }) {
  if (thread && needsYou(thread))
    return <span {...stylex.props(ui.paletteAside, styles.needsYou)}>Needs you</span>;
  if (thread?.state === "working")
    return <WorkingMark label={`${agentLabel(thread)} is working`} hides={false} />;
  return unread ? (
    <span aria-hidden="true" {...stylex.props(styles.dot, styles.dotArrives)} />
  ) : null;
}

/**
 * The switcher: the tabs and the other workspaces, most recently shown first,
 * then the tabs not shown in this window yet. Held ⌃Tab steps through them
 * and releasing Control shows the selection, as an app switcher does. A typed
 * word searches them and archived threads: closed threads and found sessions
 * that are not tabs, by title, branch, repository, and first prompt, newest
 * first.
 * From the palette it stays open until Return, a click, or Escape.
 */
function WorkspaceSwitcher({
  snapshot,
  tabs,
  hasHistory,
  history: historyMode,
  held: heldAtStart,
  controlHeld,
  reverse,
  fetcher,
  onChoose,
  onOpenTab,
  onOpenHistory,
  onDelete,
  onCancel,
}: {
  snapshot: WorkspaceSnapshot;
  /** The tabs in the sidebar's order. */
  tabs: readonly Thread[];
  /** The host keeps history, so typing searches it. */
  hasHistory: boolean;
  /** Opened to choose a thread from history. */
  history: boolean;
  held: boolean;
  controlHeld(): boolean;
  reverse: boolean;
  fetcher: typeof fetch;
  onChoose(id: string): void;
  onOpenTab(thread: Thread): void;
  onOpenHistory(thread: Thread): void;
  onDelete(thread: Thread): Promise<void>;
  onCancel(): void;
}) {
  const threads = use(Threads);
  const statuses = useSyncExternalStore(threads.subscribe, threads.get);
  // A typed letter ends the held mode: the switcher stays open to search.
  const [held, setHeld] = useState(heldAtStart && !historyMode);
  const [query, setQuery] = useState("");
  const [past, setPast] = useState<readonly Thread[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now] = useState(Date.now);
  useEffect(() => {
    if (!hasHistory) return;
    let current = true;
    readHistory(fetcher).then(
      (list) => current && setPast(list),
      () => current && setPast([]),
    );
    return () => {
      current = false;
    };
  }, [fetcher, hasHistory]);

  const ordered = orderedWorkspaces(snapshot);
  const qualifier = qualifiers(ordered);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo<SwitchRow[]>(() => {
    const ordered = orderedWorkspaces(snapshot);
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list: SwitchRow[] = [];
    const shown = new Set<string>();
    if (!historyMode) {
      for (const id of snapshot.recent) {
        const workspace = ordered.find((entry) => entry.id === id);
        if (!workspace) continue;
        const threadId = workspaceThread(workspace);
        if (threadId) shown.add(threadId);
        const thread = threadId ? statuses.get(threadId) : undefined;
        const fields = [labelFor(workspace), workspace.repository, thread && threadFields(thread)]
          .flat()
          .concat(workspace.kind === "repository" ? [workspace.branch] : []);
        if (matches(words, fields))
          list.push({ kind: "workspace", key: workspace.id, workspace, thread });
      }
      for (const thread of tabs)
        if (!shown.has(thread.id) && matches(words, threadFields(thread)))
          list.push({ kind: "tab", key: `tab:${thread.id}`, thread });
    }
    if (past && (historyMode || words.length)) {
      let count = 0;
      for (const thread of past) {
        if (count >= HISTORY_ROWS) break;
        if (tabs.some((tab) => tab.id === thread.id)) continue;
        if (!matches(words, threadFields(thread))) continue;
        list.push({ kind: "history", key: `history:${thread.id}`, thread });
        count++;
      }
    }
    return list;
  }, [historyMode, past, query, snapshot, statuses, tabs]);
  const [index, setIndex] = useState(() =>
    // The current workspace is first; start on the one before it.
    historyMode || rows.length < 2 ? 0 : reverse ? rows.length - 1 : 1,
  );
  const [searched, setSearched] = useState(query);
  if (searched !== query) {
    setSearched(query);
    setIndex(0);
    setConfirming(null);
  }
  const selected = rows[Math.min(index, rows.length - 1)];
  const list = useRef<HTMLDivElement>(null);
  const fade = usePaletteFade<HTMLDivElement>();
  const listRef = useCallback(
    (node: HTMLDivElement | null) => {
      list.current = node;
      return fade(node);
    },
    [fade],
  );
  const input = useRef<HTMLInputElement>(null);
  const choose = useCallback(
    (row: SwitchRow | undefined) => {
      if (!row) return;
      if (row.kind === "workspace") onChoose(row.workspace.id);
      else if (row.kind === "tab") onOpenTab(row.thread);
      else onOpenHistory(row.thread);
    },
    [onChoose, onOpenHistory, onOpenTab],
  );
  const remove = useCallback(
    (thread: Thread) => {
      setConfirming(null);
      onDelete(thread).then(
        () => setPast((value) => value?.filter((entry) => entry.id !== thread.id) ?? null),
        (error: unknown) => setProblem(errorText(error, "Med could not delete this thread.")),
      );
    },
    [onDelete],
  );

  // The focus comes back to where it was when the switcher closes.
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  // The list takes the keys while ⌃Tab is held; then the field does.
  useEffect(() => {
    if (held) list.current?.focus({ preventScroll: true });
    else input.current?.focus({ preventScroll: true });
  }, [held]);
  useLayoutEffect(() => {
    // Control was released before this listened: a quick tap toggles back.
    if (held && !controlHeld() && selected) return choose(selected);
    const step = (by: number) =>
      rows.length && setIndex((value) => (value + by + rows.length) % rows.length);
    const keydown = (event: KeyboardEvent) => {
      // A letter while ⌃Tab is held starts a search.
      if (
        held &&
        hasHistory &&
        event.key.length === 1 &&
        event.key !== " " &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        setHeld(false);
        setQuery((value) => value + event.key);
        return;
      }
      const deleting = selected?.kind === "history" && confirming === selected.thread.id;
      const keys: Record<string, () => void> = {
        Tab: () => step(event.shiftKey ? -1 : 1),
        ArrowDown: () => step(1),
        ArrowUp: () => step(-1),
        Enter: () => (deleting ? remove(selected.thread) : choose(selected)),
        Escape: () => (confirming ? setConfirming(null) : onCancel()),
        // ⌘⌫ deletes a thread in history, after a second Return.
        ...(selected?.kind === "history" && (event.metaKey || event.ctrlKey)
          ? { Backspace: () => setConfirming(selected.thread.id) }
          : {}),
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    const keyup = (event: KeyboardEvent) => {
      if (held && event.key === "Control" && selected) choose(selected);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", onCancel);
    };
  }, [choose, confirming, controlHeld, hasHistory, held, onCancel, remove, rows.length, selected]);
  useLayoutEffect(() => {
    if (!selected) return;
    document.getElementById(optionId(selected.key))?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // A held ⌃Tab with nothing to switch to closes at once.
  if (!rows.length && held) return null;
  const firstHistory = rows.findIndex((row) => row.kind === "history");
  const searching = !held || historyMode;
  return (
    <div {...stylex.props(styles.scrim)} onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-label={historyMode ? "Open archived thread" : "Switch workspace"}
        data-workspace-switcher
        onPointerDown={(event) => event.stopPropagation()}
        {...stylex.props(ui.palette, styles.switcher)}
      >
        {/* A transient list: the band shows once a key searches. */}
        {searching && (
          <div {...stylex.props(ui.paletteInput)}>
            <Icon name="search" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-controls="workspace-switch-list"
              aria-activedescendant={selected ? optionId(selected.key) : undefined}
              aria-label={hasHistory ? "Search tabs and archived threads" : "Search workspaces"}
              placeholder={
                historyMode
                  ? "Search archived threads…"
                  : hasHistory
                    ? "Search tabs and archived threads…"
                    : "Search workspaces…"
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              {...stylex.props(ui.paletteField)}
            />
          </div>
        )}
        <div
          ref={listRef}
          id="workspace-switch-list"
          role="listbox"
          tabIndex={-1}
          aria-label={historyMode ? "Archived" : "Recent workspaces"}
          aria-activedescendant={selected ? optionId(selected.key) : undefined}
          {...stylex.props(ui.paletteList)}
        >
          {rows.map((row, position) => {
            const isSelected = row === selected;
            const option = (content: ReactNode, extra?: ReactNode) => (
              <div
                key={row.key}
                id={optionId(row.key)}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                data-history={row.kind === "history" || undefined}
                aria-label={row.kind === "history" ? `${row.thread.title}, archived` : undefined}
                onPointerMove={() => setIndex(position)}
                onClick={() => choose(row)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") choose(row);
                }}
                {...stylex.props(
                  ui.paletteRow,
                  styles.option,
                  isSelected && [ui.paletteRowOn, picked],
                  stylex.defaultMarker(),
                )}
              >
                {content}
                {extra}
              </div>
            );
            const heading = position === firstHistory && !historyMode && (
              <div
                key="history-heading"
                role="presentation"
                {...stylex.props(ui.label, ui.paletteSection, styles.archivedLabel)}
              >
                Archived
              </div>
            );
            if (row.kind === "workspace") {
              const { workspace, thread } = row;
              const repository = qualifier(workspace);
              return option(
                <>
                  <span {...stylex.props(ui.paletteRowIcon)}>
                    <Icon name={iconFor(workspace)} />
                  </span>
                  <span {...stylex.props(styles.name)}>
                    {repository && (
                      <span {...stylex.props(styles.repository)}>{repository} / </span>
                    )}
                    <Matched
                      text={labelFor(workspace)}
                      ranges={matchRanges(labelFor(workspace), query)}
                    />
                  </span>
                  <ThreadState thread={thread} unread={workspace.unread} />
                  {workspace.id === snapshot.active && (
                    <span {...stylex.props(ui.paletteAside)}>Current</span>
                  )}
                </>,
              );
            }
            const { thread } = row;
            const place = thread.repository?.name ?? thread.checkout?.split("/").at(-1);
            if (row.kind === "tab")
              return option(
                <>
                  <span {...stylex.props(ui.paletteRowIcon)}>
                    <Icon
                      name={
                        thread.agent === "claude" || thread.agent === "codex"
                          ? thread.agent
                          : "agent"
                      }
                    />
                  </span>
                  <span {...stylex.props(styles.name)}>
                    <Matched text={thread.title} ranges={matchRanges(thread.title, query)} />
                  </span>
                  <ThreadState thread={thread} />
                  {place && <span {...stylex.props(ui.paletteAside)}>{place}</span>}
                </>,
              );
            const asking = confirming === thread.id;
            return [
              heading,
              option(
                <>
                  <span aria-hidden="true" {...stylex.props(ui.paletteRowIcon)}>
                    <span {...stylex.props(styles.hollow)} />
                  </span>
                  <span {...stylex.props(styles.name)}>
                    {asking ? (
                      `Delete “${thread.title}” for good?`
                    ) : (
                      <Matched text={thread.title} ranges={matchRanges(thread.title, query)} />
                    )}
                  </span>
                  {!asking && (
                    <span {...stylex.props(ui.paletteAside)}>
                      {[place, shortAge(thread.closedAt ?? thread.updatedAt, now)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </>,
                asking ? (
                  <span {...stylex.props(styles.confirm)}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        remove(thread);
                      }}
                      {...stylex.props(styles.textButton, styles.danger)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirming(null);
                      }}
                      {...stylex.props(styles.textButton)}
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  // Stubs of deleted reviews and found sessions delete too.
                  <button
                    type="button"
                    aria-label={`Delete ${thread.title}`}
                    title="Delete (⌘⌫)"
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirming(thread.id);
                    }}
                    {...stylex.props(styles.rowDelete, isSelected && styles.rowDeleteShown)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                ),
              ),
            ];
          })}
          {!rows.length && (
            <p {...stylex.props(ui.paletteEmpty)}>
              {past === null && (historyMode || words.length)
                ? "Reading archived threads…"
                : words.length
                  ? `Nothing matches “${query}”.`
                  : historyMode
                    ? "Nothing is archived. Tabs that you archive show here."
                    : "No other workspaces."}
            </p>
          )}
        </div>
        {problem && (
          <p role="alert" {...stylex.props(styles.switchEmpty, styles.failed)}>
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

const turn = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const appear = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(0.985)" },
  to: { opacity: 1, transform: "none" },
});
const arrive = stylex.keyframes({
  "0%": { opacity: 0, transform: "scale(0.4)" },
  "60%": { opacity: 1, transform: "scale(1.25)" },
  "100%": { opacity: 1, transform: "scale(1)" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";
/** The list's hover transitions. They stop while the list moves to another
 * sidebar, because the row under the pointer loses its hover state for a
 * frame, and would fade its controls out and in again. */
const MOTION = "--workspace-list-motion";
const listMotion = `var(${MOTION}, 120ms)`;

const styles = stylex.create({
  // The window: the sidebar on the frame, then the shown workspace.
  shell: {
    position: "fixed",
    inset: 0,
    display: "flex",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  width: (width: number) => ({ width }),
  // The sidebar on the panel's color, with a line at its edge.
  shellSidebar: {
    display: "flex",
    flexShrink: 0,
    minWidth: 0,
    minHeight: 0,
    boxShadow: `inset -1px 0 0 ${tokens.line}`,
  },
  shellGutter: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    width: 6,
    marginInlineEnd: -6,
    flexShrink: 0,
    zIndex: 3,
    cursor: "col-resize",
    outline: "none",
    touchAction: "none",
  },
  shellGutterLine: {
    width: 2,
    marginBlock: 6,
    borderRadius: 2,
    backgroundColor: tokens.accentLine,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
      [stylex.when.ancestor(":active")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
    transitionDelay: {
      default: "0ms",
      [stylex.when.ancestor(":hover")]: "250ms",
      [stylex.when.ancestor(":active")]: "0ms",
    },
  },
  // The title band, then the workspace below it.
  shellMain: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    backgroundColor: tokens.canvas,
  },
  shellViews: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
  },
  shellOverlay: {
    position: "absolute",
    zIndex: 41,
    insetBlock: 0,
    left: 0,
    width: "min(320px, 86vw)",
    backgroundColor: tokens.panel,
    boxShadow: `1px 0 0 ${tokens.line}, 12px 0 32px -12px #00000066`,
  },
  shellScrim: {
    position: "absolute",
    zIndex: 40,
    inset: 0,
    backgroundColor: "#00000040",
  },
  shellLayer: { position: "absolute", inset: 0 },
  // Show sidebar in the corner of a page of its own, such as Settings, where
  // the title row's would be.
  pageToggle: {
    position: "absolute",
    zIndex: 2,
    display: "flex",
    gap: 4,
    top: "calc(var(--med-top-row) / 2 - 14px)",
    left: "max(calc(var(--med-titlebar-left) + 4px), 8px)",
  },
  slot: { display: "contents" },
  // The list sits under the sidebar's identity row and above History. It
  // appears with the second workspace, so it settles in rather than sliding.
  list: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    paddingBottom: 6,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 30,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  add: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    margin: 0,
    padding: 0,
    paddingInline: 6,
    listStyle: "none",
    maxHeight: 236,
    overflowY: "auto",
    scrollbarWidth: "thin",
  },
  // A problem wraps below the row.
  item: { position: "relative", display: "flex", flexWrap: "wrap" },
  // The Sessions row, above the heading, as wide as the rows.
  entry: { display: "flex", paddingInline: 6, paddingBlock: 2 },
  problem: {
    flexBasis: "100%",
    marginTop: 2,
    marginBottom: 6,
    paddingInline: 30,
    color: tokens.red,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
  // Clear of the close control, which shows while the row is hovered.
  clearClose: { marginInlineEnd: 18 },
  menuPositioner: { zIndex: 60 },
  menu: { minWidth: 220 },
  menuLabel: { display: "inline-flex", alignItems: "center", gap: 8 },
  menuHint: { color: tokens.faint, fontFamily: tokens.code, fontSize: 11 },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: "1",
    minWidth: 0,
    height: 28,
    paddingInlineStart: 8,
    paddingInlineEnd: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color, color",
    transitionDuration: listMotion,
  },
  current: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
    fontWeight: 500,
  },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  repository: { color: tokens.faint, fontWeight: 450 },
  // New and not yet shown: a brighter name and an accent dot, like unread mail.
  unreadName: { color: tokens.text, fontWeight: 550 },
  dot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    marginInline: 3,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
  },
  needsYou: { color: tokens.accent, fontWeight: 500 },
  failed: { color: tokens.red },
  working: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: 10,
    height: 10,
    marginInline: 1,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.muted,
    animationName: { default: turn, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  dotArrives: {
    animationName: { default: arrive, [reduced]: "none" },
    animationDuration: "320ms",
    animationTimingFunction: tokens.easeOut,
  },
  detail: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    transitionProperty: "opacity",
    transitionDuration: listMotion,
  },
  // The close control takes the status's place while the row is hovered.
  detailHides: {
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover")]: 0,
      [stylex.when.ancestor(":focus-within")]: 0,
    },
  },
  close: {
    position: "absolute",
    insetInlineEnd: 11,
    top: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: listMotion,
  },
  scrim: { position: "fixed", inset: 0, zIndex: 120 },
  // ui.palette, without a header: a transient list.
  switcher: {
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "140ms",
    animationTimingFunction: tokens.easeOut,
  },
  option: { cursor: "pointer" },
  // Archived, after the open ones: 30 px, as a later section's label is.
  archivedLabel: { height: { default: 30, ":first-child": 26 } },
  // A thread in history: a hollow mark, as it is not loaded.
  hollow: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: 8,
    height: 8,
    marginInline: 3,
    borderRadius: "50%",
    borderWidth: 1.25,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
  },
  rowDelete: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    opacity: { default: 0, ":focus-visible": 1, [stylex.when.ancestor(":hover")]: 1 },
  },
  rowDeleteShown: { opacity: 1 },
  confirm: { display: "inline-flex", gap: 2, flexShrink: 0 },
  textButton: {
    height: 22,
    paddingInline: 7,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  danger: { color: tokens.red },
  switchEmpty: {
    margin: 0,
    paddingBlock: 10,
    paddingInline: 10,
    color: tokens.faint,
    fontSize: 12.5,
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
