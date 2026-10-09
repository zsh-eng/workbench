import * as stylex from "@stylexjs/stylex";
import { ContextMenu } from "@base-ui/react/context-menu";
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
import {
  createWorkspaceStore,
  orderedWorkspaces,
  overlayAddress,
  pinned,
  resumeCommand,
  REVIEW_UPDATED,
  workspaceUrl,
  type RepositoryWorkspace,
  type ReviewWorkspace,
  type Workspace,
  type WorkspaceInput,
  type WorkspacePatch,
  type WorkspaceSnapshot,
} from "../data/workspaces";
import { z } from "zod";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";
import { ActionTooltip } from "./ToolButton";
import { visibleElement } from "../data/palette-focus";
import { createApi } from "../data/api";
import { readBrowserToken } from "../data/auth";
import { readServerEvents } from "../data/sse";
import { renderBrief } from "../markdown/brief-render";
import { themeController } from "../themes";

/** Workspaces kept mounted, most recently shown first. Older ones reload. */
const MOUNTED = 4;

type ControllerOptions = Omit<ReviewControllerOptions, "savedReviewId" | "start">;
/** A patch parser keeps only its latest request, so each workspace has its own:
 * one workspace's load never cancels another's. */
type ParserFactory = () => {
  parse: NonNullable<ReviewControllerOptions["parsePatch"]>;
  dispose(): void;
};

interface WorkspaceActions {
  /** Shows a workspace and moves the address to it. */
  activate(id: string): void;
  close(id: string): void;
  setUnread(id: string, unread: boolean): void;
  /** Shows the workspace for this task, opening it first if needed. */
  open(input: WorkspaceInput): void;
  match(input: WorkspaceInput): string | undefined;
  closeRepository(repositoryId: string, keep: string): void;
  update(id: string, patch: WorkspacePatch): void;
  /** Opens the switcher without a held key, as the palette does. */
  openSwitcher(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceSnapshot;
}

const Actions = createContext<WorkspaceActions | null>(null);
const Snapshot = createContext<WorkspaceSnapshot | null>(null);
const Current = createContext<string | null>(null);
/** Disposers that run when a workspace closes or leaves memory. */
const Lifetime = createContext<Set<() => void> | null>(null);

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

/** The host's actions, for pages that cover every workspace, such as Sources. */
export function useWorkspaceActions() {
  return use(Actions);
}

/**
 * Disposes a long-lived object when its owner goes away for good. A hidden
 * workspace runs effect cleanups too, and comes back with the same objects,
 * so inside a workspace disposal waits until the workspace closes.
 */
export function useDisposeOnClose(dispose: () => void) {
  const lifetime = use(Lifetime);
  useEffect(() => {
    if (!lifetime) return dispose;
    lifetime.add(dispose);
  }, [dispose, lifetime]);
}

/** The window used last shows the reviews that agents open. */
const WINDOW_KEY = "med:window";
/** The lock and broadcast channel that share the host's window channel. */
const WINDOW_CHANNEL = "med:windows";
const reviewEvent = z.object({
  id: z.string(),
  title: z.string(),
  open: z.boolean(),
  updated: z.boolean().default(false),
  sessions: z
    .array(z.object({ agent: z.enum(["claude", "codex"]), id: z.string(), cwd: z.string() }))
    .default([]),
});

type ReviewEvent = z.infer<typeof reviewEvent>;

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });

/** Reads the host's window channel until `signal` aborts, and reconnects with
 * backoff. It returns early from a host without the channel. */
async function listenForReviews(
  fetcher: typeof fetch,
  signal: AbortSignal,
  onReview: (review: ReviewEvent) => void,
) {
  const api = createApi(fetcher, readBrowserToken());
  let delay = 1000;
  while (!signal.aborted) {
    try {
      const response = await api.stream("/api/windows", signal);
      if (response.status === 404) return;
      if (!response.ok || !response.body) throw new Error("The window channel closed.");
      delay = 1000;
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
    await pause(delay, signal);
    delay = Math.min(delay * 2, 30_000);
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
  const [fetcher] = useState(() => providedFetch ?? globalThis.fetch.bind(globalThis));
  const [store] = useState(() => createWorkspaceStore(location.pathname, history.state));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [switcher, setSwitcher] = useState<{ held: boolean; reverse: boolean } | null>(null);
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
  const actions = useMemo<WorkspaceActions>(
    () => ({
      activate: (id) => show(id),
      close(id) {
        const before = store.getSnapshot().active;
        store.close(id);
        const after = store.getSnapshot().active;
        if (after !== before) show(after, true);
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
      subscribe: store.subscribe,
      getSnapshot: store.getSnapshot,
    }),
    [rememberFocus, show, store],
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
  useEffect(() => {
    const stop = new AbortController();
    const usedLast = () => {
      try {
        const last = localStorage.getItem(WINDOW_KEY);
        return last ? last === windowId : document.visibilityState === "visible";
      } catch {
        return document.visibilityState === "visible";
      }
    };
    const receive = ({ id, title, open, updated, sessions }: ReviewEvent) => {
      const here = open && usedLast();
      const known = store.match({ kind: "review", reviewId: id });
      const workspace = store.open(
        {
          kind: "review",
          reviewId: id,
          title,
          ...((known && !updated) || here ? {} : { unread: true }),
        },
        false,
      );
      store.update(workspace, { title, ...(sessions.length ? { sessions } : {}) });
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
  }, [fetcher, show, store, windowId]);

  // The address names the workspace: links, reloads, Back, and Forward.
  useEffect(() => {
    const active = store
      .getSnapshot()
      .workspaces.find((entry) => entry.id === store.getSnapshot().active);
    if (active?.kind === "repository" && location.pathname === "/" && !historyWorkspace())
      history.replaceState({ ...(history.state as object), workspace: active.id }, "");
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

  // ⌘1–9 shows a workspace by its place in the list; ⌃Tab opens the switcher.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      if (overlayAddress(location.pathname) || visibleElement('[role="dialog"]')) return;
      const rows = orderedWorkspaces(store.getSnapshot());
      if (rows.length < 2) return;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const target = rows[Number(digit) - 1];
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        show(target.id);
      } else if (event.key === "Tab" && event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        rememberFocus();
        setSwitcher({ held: true, reverse: event.shiftKey });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [rememberFocus, show, store]);

  return (
    <Actions value={actions}>
      <Snapshot value={snapshot}>
        {children}
        {switcher && (
          <WorkspaceSwitcher
            snapshot={snapshot}
            held={switcher.held}
            controlHeld={controlHeld}
            reverse={switcher.reverse}
            onChoose={(id) => {
              setSwitcher(null);
              show(id);
            }}
            onCancel={() => setSwitcher(null)}
          />
        )}
      </Snapshot>
    </Actions>
  );
}

/** One controller per mounted workspace, with the disposers of the objects
 * its review owns. Only the one on screen listens for changes; the rest catch
 * up when they are shown again. */
function createControllerPool(options: ControllerOptions, createParser?: ParserFactory) {
  const live = new Map<string, { controller: ReviewController; disposers: Set<() => void> }>();
  const end = (id: string) => {
    const entry = live.get(id);
    if (!entry) return;
    live.delete(id);
    entry.controller.dispose();
    for (const dispose of entry.disposers) dispose();
  };
  return {
    get(workspace: RepositoryWorkspace | ReviewWorkspace) {
      let entry = live.get(workspace.id);
      if (!entry) {
        const parser = createParser?.();
        const own = parser ? { ...options, parsePatch: parser.parse } : options;
        const controller = createReviewController(
          workspace.kind === "review"
            ? { ...own, savedReviewId: workspace.reviewId }
            : {
                ...own,
                start: {
                  path: workspace.path,
                  repositoryId: workspace.repositoryId,
                  branch: workspace.branch,
                },
              },
        );
        entry = { controller, disposers: new Set(parser ? [parser.dispose] : []) };
        live.set(workspace.id, entry);
        void controller.initialize();
      }
      return entry;
    },
    retain(ids: readonly string[]) {
      for (const id of [...live.keys()]) if (!ids.includes(id)) end(id);
    },
    focus(id: string | null) {
      for (const [key, { controller }] of live) {
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
  const [pool] = useState(() => createControllerPool(options, createParser));
  const [mounted, setMounted] = useState<string[]>([]);
  const active = snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  const onScreen = active && active.kind !== "vault" ? active.id : null;
  let next = mounted.filter((id) => snapshot.workspaces.some((entry) => entry.id === id));
  if (onScreen && next[0] !== onScreen)
    next = [onScreen, ...next.filter((id) => id !== onScreen)].slice(0, MOUNTED);
  if (next.length !== mounted.length || next.some((id, index) => id !== mounted[index]))
    setMounted(next);

  useEffect(() => pool.retain(mounted), [pool, mounted]);
  useEffect(() => pool.focus(onScreen), [pool, onScreen, mounted]);

  // When every mounted workspace has loaded, the next one in the list loads
  // hidden while the browser is idle, until MOUNTED are ready. A first visit
  // then shows a rendered review instead of loading in front of the reviewer,
  // as a browser keeps a pool of warm tabs.
  const cold = orderedWorkspaces(snapshot).find(
    (entry) => entry.kind !== "vault" && !mounted.includes(entry.id),
  )?.id;
  useEffect(() => {
    if (!cold || !onScreen || mounted.length >= MOUNTED) return;
    const controllers = mounted.flatMap((id) => {
      const workspace = snapshot.workspaces.find((entry) => entry.id === id);
      return workspace && workspace.kind !== "vault" ? [pool.get(workspace).controller] : [];
    });
    let cancel: (() => void) | undefined;
    const check = () => {
      if (cancel) return;
      if (controllers.some((controller) => controller.getSnapshot().status === "loading")) return;
      cancel = whenIdle(() =>
        setMounted((current) => (current.includes(cold) ? current : [...current, cold])),
      );
    };
    const stops = controllers.map((controller) => controller.subscribe(check));
    check();
    return () => {
      for (const stop of stops) stop();
      cancel?.();
    };
  }, [cold, onScreen, mounted, pool, snapshot.workspaces]);

  // A hidden workspace runs no effects, so its brief renders here, ahead of
  // its first visit, with the briefs of its other iterations.
  useEffect(() => {
    const stops = mounted.flatMap((id) => {
      const workspace = snapshot.workspaces.find((entry) => entry.id === id);
      if (id === onScreen || workspace?.kind !== "review") return [];
      const { controller } = pool.get(workspace);
      let warmed: unknown;
      const warm = () => {
        const saved = controller.getSnapshot().savedReview;
        if (!saved || saved === warmed) return;
        warmed = saved;
        const theme = themeController.getSnapshot().active.pierreTheme;
        for (const brief of [
          saved.brief,
          ...(saved.iterations ?? []).toReversed().map((entry) => entry.brief),
        ].slice(0, 7))
          if (brief) renderBrief(theme, brief.text, false).catch(() => {});
      };
      warm();
      return [controller.subscribe(warm)];
    });
    return () => {
      for (const stop of stops) stop();
    };
  }, [mounted, onScreen, pool, snapshot.workspaces]);
  useEffect(() => {
    const leave = () => pool.dispose();
    window.addEventListener("pagehide", leave, { once: true });
    return () => {
      window.removeEventListener("pagehide", leave);
      pool.dispose();
    };
  }, [pool]);

  return mounted.flatMap((id) => {
    const workspace = snapshot.workspaces.find((entry) => entry.id === id);
    if (!workspace || workspace.kind === "vault") return [];
    const { controller, disposers } = pool.get(workspace);
    return (
      <Activity key={id} mode={id === onScreen ? "visible" : "hidden"}>
        <Current value={id}>
          <Lifetime value={disposers}>
            <KeepScroll>{render(controller)}</KeepScroll>
          </Lifetime>
        </Current>
      </Activity>
    );
  });
}

function whenIdle(run: () => void) {
  if (!("requestIdleCallback" in globalThis)) {
    const timer = setTimeout(run, 300);
    return () => clearTimeout(timer);
  }
  const id = requestIdleCallback(run, { timeout: 2000 });
  return () => cancelIdleCallback(id);
}

/** Hidden workspaces have no layout, so the browser forgets their scroll
 * offsets. This records them as they change and restores them when the
 * workspace is shown, before its own effects read them. Virtualized diffs
 * measure themselves again after the first frame and re-anchor, so the saved
 * offsets apply once more after that measurement. */
function KeepScroll({ children }: { children: ReactNode }) {
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
    <div ref={root} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

/** Claude's terracotta, so an agent's reviews read at a glance. */
const agentColor = (icon: IconName) => (icon === "claude" ? { color: "#d97757" } : undefined);
function iconFor(workspace: Workspace): IconName {
  // An agent's review shows the agent that made it.
  const agent = workspace.sessions?.at(-1)?.agent;
  if (agent) return agent;
  return workspace.kind === "vault"
    ? "vault"
    : workspace.kind === "review"
      ? "pullRequest"
      : workspace.branch
        ? "branch"
        : "commit";
}
function labelFor(workspace: Workspace) {
  if (workspace.title) return workspace.title;
  if (workspace.kind === "vault") return "Vault";
  if (workspace.kind === "review") return "Saved review";
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

/**
 * The open workspaces, at the top of a sidebar. It appears with the second
 * workspace; one workspace needs no list.
 */
export function WorkspaceList({ onNew }: { onNew?(): void }) {
  const snapshot = use(Snapshot);
  const actions = use(Actions);
  // The row whose resume command was just copied says so for a moment.
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  if (!snapshot || !actions) return null;
  const rows = orderedWorkspaces(snapshot);
  if (rows.length < 2) return null;
  const qualifier = qualifiers(rows);
  return (
    <nav aria-label="Workspaces" {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.heading)}>
        <span>Workspaces</span>
        {onNew && (
          <ActionTooltip label="New workspace" shortcut="Mod+Enter">
            <button
              type="button"
              aria-label="New workspace"
              onClick={onNew}
              {...stylex.props(styles.add)}
            >
              <Icon name="plus" size={12} />
            </button>
          </ActionTooltip>
        )}
      </div>
      <ul {...stylex.props(styles.rows)}>
        {rows.map((workspace, index) => {
          const current = workspace.id === snapshot.active;
          const label = labelFor(workspace);
          const repository = qualifier(workspace);
          const closable = !pinned(workspace);
          return (
            <WorkspaceMenu
              key={workspace.id}
              workspace={workspace}
              label={label}
              closable={closable}
              copied={copied === workspace.id}
              onCopy={(command) => {
                void navigator.clipboard.writeText(command).then(() => {
                  setCopied(workspace.id);
                  clearTimeout(copiedTimer.current);
                  copiedTimer.current = setTimeout(() => setCopied(null), 1600);
                });
              }}
            >
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                aria-keyshortcuts={index < 9 ? `Meta+${index + 1} Control+${index + 1}` : undefined}
                title={
                  workspace.kind === "repository" && workspace.path
                    ? `${label}\n${workspace.path}`
                    : undefined
                }
                onClick={() => actions.activate(workspace.id)}
                onKeyDown={(event) => {
                  if (closable && (event.key === "Delete" || event.key === "Backspace")) {
                    event.preventDefault();
                    actions.close(workspace.id);
                  }
                }}
                {...stylex.props(styles.row, current && styles.current)}
              >
                <Icon name={iconFor(workspace)} size={14} style={agentColor(iconFor(workspace))} />
                <span {...stylex.props(styles.name, workspace.unread && styles.unreadName)}>
                  {repository && <span {...stylex.props(styles.repository)}>{repository} / </span>}
                  {label}
                  {workspace.unread && <span {...stylex.props(styles.hidden)}>, new</span>}
                </span>
                {copied === workspace.id ? (
                  <span
                    role="status"
                    {...stylex.props(styles.detail, closable && styles.clearClose)}
                  >
                    Copied
                  </span>
                ) : workspace.unread ? (
                  <span
                    aria-hidden="true"
                    {...stylex.props(styles.dot, closable && styles.detailHides)}
                  />
                ) : (
                  workspace.detail && (
                    <span {...stylex.props(styles.detail, closable && styles.detailHides)}>
                      {workspace.detail}
                      <span {...stylex.props(styles.hidden)}> changed files</span>
                    </span>
                  )
                )}
              </button>
              {closable && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${label}`}
                  title={`Close ${label}`}
                  onClick={() => actions.close(workspace.id)}
                  {...stylex.props(styles.close)}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </WorkspaceMenu>
          );
        })}
      </ul>
    </nav>
  );
}

/** A workspace row with its right-click menu: resume its agent sessions in a
 * terminal, mark it unread or read, or close it. */
function WorkspaceMenu({
  workspace,
  label,
  closable,
  copied,
  onCopy,
  children,
}: {
  workspace: Workspace;
  label: string;
  closable: boolean;
  copied: boolean;
  onCopy(command: string): void;
  children: ReactNode;
}) {
  const actions = use(Actions)!;
  const sessions = workspace.sessions ?? [];
  const item = (state: { highlighted: boolean }, ...extra: stylex.StyleXStyles[]) =>
    stylex.props(ui.menuItem, ...extra, state.highlighted && ui.menuHighlighted).className;
  const agentName = (agent: "claude" | "codex") => (agent === "claude" ? "Claude Code" : "Codex");
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={<li data-copied={copied || undefined} />}
        {...stylex.props(styles.item, stylex.defaultMarker())}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner {...stylex.props(styles.menuPositioner)}>
          <ContextMenu.Popup
            aria-label={`${label} actions`}
            {...stylex.props(ui.popup, styles.menu)}
          >
            <ContextMenu.Item
              onClick={() => actions.activate(workspace.id)}
              className={(state) => item(state)}
            >
              Open
            </ContextMenu.Item>
            {sessions.length > 0 && <ContextMenu.Separator {...stylex.props(styles.separator)} />}
            {[...sessions].reverse().map((session) => (
              <ContextMenu.Item
                key={`${session.agent}:${session.id}`}
                onClick={() => onCopy(resumeCommand(session))}
                className={(state) => item(state)}
              >
                <span {...stylex.props(styles.menuLabel)}>
                  <Icon name={session.agent} size={13} style={agentColor(session.agent)} />
                  Copy {agentName(session.agent)} resume command
                </span>
                <span {...stylex.props(styles.menuHint)}>{session.id.slice(0, 8)}</span>
              </ContextMenu.Item>
            ))}
            <ContextMenu.Separator {...stylex.props(styles.separator)} />
            <ContextMenu.Item
              onClick={() => actions.setUnread(workspace.id, !workspace.unread)}
              className={(state) => item(state)}
            >
              {workspace.unread ? "Mark as read" : "Mark as unread"}
            </ContextMenu.Item>
            {closable && (
              <ContextMenu.Item
                onClick={() => actions.close(workspace.id)}
                className={(state) => item(state)}
              >
                Close workspace
              </ContextMenu.Item>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * Recent workspaces, most recent first. Held ⌃Tab steps through them and
 * releasing Control shows the selection, as an app switcher does. From the
 * palette it stays open until Return, a click, or Escape.
 */
function WorkspaceSwitcher({
  snapshot,
  held,
  controlHeld,
  reverse,
  onChoose,
  onCancel,
}: {
  snapshot: WorkspaceSnapshot;
  held: boolean;
  controlHeld(): boolean;
  reverse: boolean;
  onChoose(id: string): void;
  onCancel(): void;
}) {
  const ordered = orderedWorkspaces(snapshot);
  const rows = snapshot.recent.flatMap((id) => ordered.find((entry) => entry.id === id) ?? []);
  const [index, setIndex] = useState(() =>
    // The current workspace is first; start on the one before it.
    rows.length < 2 ? 0 : reverse ? rows.length - 1 : 1,
  );
  const list = useRef<HTMLDivElement>(null);
  const qualifier = qualifiers(ordered);
  const selected = rows[Math.min(index, rows.length - 1)];

  useEffect(() => {
    const previous = document.activeElement;
    list.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useLayoutEffect(() => {
    // Control was released before this listened: a quick tap toggles back.
    if (held && !controlHeld() && selected) return onChoose(selected.id);
    const step = (by: number) => setIndex((value) => (value + by + rows.length) % rows.length);
    const keydown = (event: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Tab: () => step(event.shiftKey ? -1 : 1),
        ArrowDown: () => step(1),
        ArrowUp: () => step(-1),
        Enter: () => selected && onChoose(selected.id),
        Escape: onCancel,
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    const keyup = (event: KeyboardEvent) => {
      if (held && event.key === "Control" && selected) onChoose(selected.id);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", onCancel);
    };
  }, [controlHeld, held, onCancel, onChoose, rows.length, selected]);

  if (!rows.length) return null;
  return (
    <div {...stylex.props(styles.scrim)} onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-label="Switch workspace"
        data-workspace-switcher
        onPointerDown={(event) => event.stopPropagation()}
        {...stylex.props(styles.switcher)}
      >
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label="Recent workspaces"
          aria-activedescendant={selected ? `workspace-switch-${selected.id}` : undefined}
          {...stylex.props(styles.switchList)}
        >
          {rows.map((workspace, position) => {
            const place = ordered.indexOf(workspace);
            const repository = qualifier(workspace);
            return (
              <div
                key={workspace.id}
                id={`workspace-switch-${workspace.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={workspace === selected}
                onPointerMove={() => setIndex(position)}
                onClick={() => onChoose(workspace.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onChoose(workspace.id);
                }}
                {...stylex.props(styles.option, workspace === selected && styles.optionSelected)}
              >
                <Icon name={iconFor(workspace)} size={14} />
                <span {...stylex.props(styles.name)}>
                  {repository && <span {...stylex.props(styles.repository)}>{repository} / </span>}
                  {labelFor(workspace)}
                </span>
                {workspace.unread && <span aria-hidden="true" {...stylex.props(styles.dot)} />}
                {workspace.id === snapshot.active && (
                  <span {...stylex.props(styles.here)}>Current</span>
                )}
                {place < 9 && <ShortcutKeys value={`Mod+${place + 1}`} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const appear = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(0.985)" },
  to: { opacity: 1, transform: "none" },
});
const settle = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-3px)" },
  to: { opacity: 1, transform: "none" },
});
const arrive = stylex.keyframes({
  "0%": { opacity: 0, transform: "scale(0.4)" },
  "60%": { opacity: 1, transform: "scale(1.25)" },
  "100%": { opacity: 1, transform: "scale(1)" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // The list sits under the sidebar's identity row and above History. It
  // appears with the second workspace, so it settles in rather than sliding.
  list: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    paddingBottom: 6,
    animationName: { default: settle, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
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
    borderRadius: 6,
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
  item: { position: "relative", display: "flex" },
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
    borderRadius: 7,
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
    transitionDuration: "120ms",
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
    transitionDuration: "120ms",
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
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  scrim: { position: "fixed", inset: 0, zIndex: 120 },
  switcher: {
    position: "fixed",
    top: "18vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(440px, calc(100vw - 32px))",
    boxSizing: "border-box",
    padding: 6,
    borderRadius: 12,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, ${tokens.shadow}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "140ms",
    animationTimingFunction: tokens.easeOut,
  },
  switchList: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    maxHeight: "56vh",
    overflowY: "auto",
    outline: "none",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 34,
    paddingInline: 10,
    borderRadius: 8,
    color: tokens.muted,
    fontSize: 13,
    cursor: "pointer",
  },
  optionSelected: { backgroundColor: tokens.fillStrong, color: tokens.text },
  here: { color: tokens.faint, fontSize: 11 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
