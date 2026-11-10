/** Workspaces: the tasks open in this window, such as a thread, a branch, or
 * a vault. Each keeps its own state; this store keeps the list, the active
 * workspace, and the order in which they were last shown. */

interface WorkspaceBase {
  id: string;
  /** Reported by the workspace once it loads, such as a review title. */
  title?: string;
  /** Repository name, to tell branches of different repositories apart. */
  repository?: string;
  /** One quiet status, such as the number of changed files. */
  detail?: string;
  /** Added in the background, such as by an agent, and not shown yet. */
  unread?: boolean;
  /** The linked worktree it works in, which closing it can remove. */
  worktree?: string;
}
export interface WorkspaceSession {
  agent: "claude" | "codex";
  id: string;
  cwd: string;
}
/**
 * A thread of the sidebar: an agent session, or a review that no session
 * handed off (src/shared/threads.ts). It shows the thread's review, with its
 * session and the live Changes of the checkout where the session works now.
 */
export interface ThreadWorkspace extends WorkspaceBase {
  kind: "thread";
  /** The session's key, or the lone review's ID. */
  threadId: string;
  /** The review that shows, of the thread's reviews; the newest without it. */
  reviewId?: string;
  /** Where the thread works now, as the thread list said last: its Changes
   * and Commit follow it. */
  path?: string;
  repositoryId?: string;
  branch?: string;
}
export interface RepositoryWorkspace extends WorkspaceBase {
  kind: "repository";
  /** The window's own workspace. It stays, like a vault, and follows the
   * branch you choose in it. */
  home?: boolean;
  /** Without a path, the host's default repository opens. */
  path?: string;
  repositoryId?: string;
  branch?: string;
}
/** A registered vault. Vaults come from the server's sources and stay pinned. */
export interface VaultWorkspace extends WorkspaceBase {
  kind: "vault";
  sourceId: string;
}
/** A GitHub pull request that the host opens in a worktree. It becomes its
 * review's thread once the review is saved. */
export interface PullWorkspace extends WorkspaceBase {
  kind: "pull";
  url: string;
  /** The host's job; empty until the host accepts the link. */
  jobId?: string;
  /** The agent to start in the worktree, so Retry asks for it again. */
  agent?: string;
}
export type Workspace = ThreadWorkspace | RepositoryWorkspace | VaultWorkspace | PullWorkspace;
export type WorkspaceInput =
  | Omit<ThreadWorkspace, "id">
  | Omit<RepositoryWorkspace, "id">
  | Omit<VaultWorkspace, "id">
  | Omit<PullWorkspace, "id">;
export interface WorkspacePatch {
  title?: string;
  jobId?: string;
  reviewId?: string;
  repository?: string;
  detail?: string;
  path?: string;
  repositoryId?: string;
  branch?: string;
  worktree?: string;
}
export interface WorkspaceSnapshot {
  workspaces: Workspace[];
  active: string;
  /** Most recent first; the switcher and the memory limit follow this order. */
  recent: string[];
}

/** A thread's workspace has this id in every window. */
export const threadWorkspaceId = (threadId: string) => `thread-${threadId}`;

const SESSION_THREAD = /^(?:claude|codex|acp)-[A-Za-z0-9_-]+$/;

/** Tells the workspace of a saved review that the review has new content,
 * such as an agent's next iteration. The event detail is `{ id }`. */
export const REVIEW_UPDATED = "med:review-updated";

const STORAGE_KEY = "med:workspaces:v1";
const LIMIT = 24;
const newId = () => `w_${Math.random().toString(36).slice(2, 10)}`;
const optional = (value: unknown) => (typeof value === "string" && value ? value : undefined);

const quoted = (path: string) => `'${path.replaceAll("'", `'\\''`)}'`;

/** A shell command that resumes the session in its own directory. */
export function resumeCommand(session: WorkspaceSession) {
  const directory = quoted(session.cwd);
  return session.agent === "claude"
    ? `cd ${directory} && claude --resume ${session.id}`
    : `cd ${directory} && codex resume ${session.id}`;
}

/** A shell command that opens lazygit in a checkout, for Git work beyond the
 * Commit tab, such as a rebase or a stash. */
export const lazygitCommand = (path: string) => `cd ${quoted(path)} && lazygit`;

function parse(value: unknown): Workspace | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = optional(entry.id);
  if (!id) return null;
  const base = {
    id,
    title: optional(entry.title),
    repository: optional(entry.repository),
    detail: optional(entry.detail),
    worktree: optional(entry.worktree),
    ...(entry.unread === true ? { unread: true } : {}),
  };
  const place = {
    path: optional(entry.path),
    repositoryId: optional(entry.repositoryId),
    branch: optional(entry.branch),
  };
  if (entry.kind === "thread" && optional(entry.threadId))
    return {
      ...base,
      kind: "thread",
      threadId: entry.threadId as string,
      reviewId: optional(entry.reviewId),
      ...place,
    };
  // Lists from before sessions led: a review's workspace, or a found session's.
  if (entry.kind === "review" && optional(entry.reviewId))
    return {
      ...base,
      id: threadWorkspaceId(entry.reviewId as string),
      kind: "thread",
      threadId: entry.reviewId as string,
      reviewId: entry.reviewId as string,
    };
  const found = entry.found as { agent?: unknown; id?: unknown } | undefined;
  if (
    entry.kind === "repository" &&
    entry.home !== true &&
    (found?.agent === "claude" || found?.agent === "codex") &&
    optional(found.id)
  ) {
    const threadId = `${found.agent}-${found.id as string}`;
    return { ...base, id: threadWorkspaceId(threadId), kind: "thread", threadId, ...place };
  }
  if (entry.kind === "vault" && optional(entry.sourceId))
    return { ...base, kind: "vault", sourceId: entry.sourceId as string };
  if (entry.kind === "pull" && optional(entry.url))
    return {
      ...base,
      kind: "pull",
      url: entry.url as string,
      jobId: optional(entry.jobId),
      agent: optional(entry.agent),
    };
  if (entry.kind === "repository")
    return {
      ...base,
      kind: "repository",
      ...(entry.home === true ? { home: true } : {}),
      ...place,
    };
  return null;
}
function read(text = storedText()): WorkspaceSnapshot {
  try {
    const raw = JSON.parse(text ?? "null") as {
      workspaces?: unknown[];
      active?: unknown;
      recent?: unknown[];
    } | null;
    // A workspace from an older list can come back with a thread's id.
    const renamed = new Map<string, string>();
    const workspaces = (raw?.workspaces ?? []).flatMap((entry) => {
      const workspace = parse(entry);
      const before = (entry as { id?: unknown } | null)?.id;
      if (workspace && typeof before === "string") renamed.set(before, workspace.id);
      return workspace ?? [];
    });
    const rename = (id: unknown) => (typeof id === "string" ? (renamed.get(id) ?? id) : id);
    // Lists from before the home workspace pin their first branch workspace.
    const first = workspaces.find((entry) => entry.kind === "repository");
    if (first && !workspaces.some((entry) => entry.kind === "repository" && entry.home))
      workspaces[workspaces.indexOf(first)] = { ...first, home: true };
    const ids = new Set(workspaces.map((entry) => entry.id));
    const recent = [
      ...new Set(
        (raw?.recent ?? [])
          .map(rename)
          .filter((id): id is string => typeof id === "string" && ids.has(id)),
      ),
    ];
    const active = rename(raw?.active);
    return {
      workspaces,
      active: typeof active === "string" && ids.has(active) ? active : "",
      recent: [
        ...recent,
        ...workspaces.map((entry) => entry.id).filter((id) => !recent.includes(id)),
      ],
    };
  } catch {
    return { workspaces: [], active: "", recent: [] };
  }
}
function storedText() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function write(snapshot: WorkspaceSnapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Storage can be unavailable; the list then lasts for this page. */
  }
}

/** The same task: one thread, one vault, one branch of a repository, or one
 * detached worktree. A workspace that has not loaded yet matches nothing. */
function matches(input: WorkspaceInput, entry: Workspace) {
  if (input.kind === "thread") return entry.kind === "thread" && entry.threadId === input.threadId;
  if (input.kind === "vault") return entry.kind === "vault" && entry.sourceId === input.sourceId;
  if (input.kind === "pull") return entry.kind === "pull" && entry.url === input.url;
  if (entry.kind !== "repository") return false;
  if (!input.branch) return !!input.path && !entry.branch && input.path === entry.path;
  return (
    input.branch === entry.branch &&
    ((!!input.repositoryId && input.repositoryId === entry.repositoryId) ||
      (!!input.path && input.path === entry.path))
  );
}

const reviewPath = (pathname: string) => /^\/review\/([^/]+)\/?$/.exec(pathname)?.[1];
const vaultPath = (pathname: string) => /^\/vault\/([^/]+)/.exec(pathname)?.[1];
/** Addresses that cover the workspaces without choosing one. */
export const overlayAddress = (pathname: string) =>
  pathname === "/sources" ||
  pathname === "/pulls" ||
  pathname === "/archived" ||
  pathname === "/history" ||
  pathname === "/settings" ||
  pathname.startsWith("/settings/") ||
  pathname === "/welcome" ||
  pathname === "/files" ||
  pathname === "/file" ||
  pathname === "/search";

/** The workspace's address. A thread keeps its link; branches use "/". */
export const workspaceUrl = (workspace: Workspace) =>
  workspace.kind === "thread"
    ? `/review/${encodeURIComponent(workspace.threadId)}`
    : workspace.kind === "vault"
      ? `/vault/${encodeURIComponent(workspace.sourceId)}`
      : "/";

/** Vaults and the home workspace stay; others can close. */
export const pinned = (workspace: Workspace) =>
  workspace.kind === "vault" || (workspace.kind === "repository" && !!workspace.home);

/** Display order: vaults, the home workspace, then the rest as they opened. */
export const orderedWorkspaces = (snapshot: WorkspaceSnapshot) => [
  ...snapshot.workspaces.filter((entry) => entry.kind === "vault"),
  ...snapshot.workspaces.filter((entry) => entry.kind === "repository" && entry.home),
  ...snapshot.workspaces.filter((entry) => !pinned(entry)),
];

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;

/** The persisted list, opened at the current address. */
export function createWorkspaceStore(pathname: string, state?: unknown) {
  let snapshot = read();
  const listeners = new Set<() => void>();
  /** The thread of a review, as the thread list says: its session's. */
  let threadOf: (reviewId: string) => string | undefined = () => undefined;
  /** A review's own thread, or its session's. */
  const resolve = (input: WorkspaceInput): WorkspaceInput =>
    input.kind === "thread" && !SESSION_THREAD.test(input.threadId)
      ? {
          ...input,
          threadId: threadOf(input.threadId) ?? input.threadId,
          reviewId: input.reviewId ?? input.threadId,
        }
      : input;
  const publish = (next: WorkspaceSnapshot) => {
    snapshot = next;
    write(next);
    for (const listener of listeners) listener();
  };
  const find = (id: string) => snapshot.workspaces.find((entry) => entry.id === id);
  const store = {
    getSnapshot: () => snapshot,
    /** The open workspace for this task, if any. */
    match: (input: WorkspaceInput) =>
      snapshot.workspaces.find((entry) => matches(resolve(input), entry))?.id,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Selects a matching workspace, or adds one. Returns its id. */
    open(given: WorkspaceInput, activate = true): string {
      const input = resolve(given);
      const existing = snapshot.workspaces.find((entry) => matches(input, entry));
      if (existing) {
        // A review link shows that review in its thread.
        if (existing.kind === "thread" && input.kind === "thread" && input.reviewId)
          store.update(existing.id, { reviewId: input.reviewId });
        if (activate) store.activate(existing.id);
        return existing.id;
      }
      // A thread or a vault has one id in every window, so windows that add
      // it at the same time agree, and a tab loaded ahead shows in the same slot.
      const id =
        input.kind === "thread"
          ? threadWorkspaceId(input.threadId)
          : input.kind === "vault"
            ? `vault-${input.sourceId}`
            : newId();
      const workspace = { ...input, id } as Workspace;
      let workspaces = [...snapshot.workspaces, workspace];
      let recent = activate
        ? [workspace.id, ...snapshot.recent]
        : [...snapshot.recent, workspace.id];
      // Past the limit, forget the least recent workspace that is not in view.
      while (workspaces.length > LIMIT) {
        const drop = [...recent]
          .reverse()
          .find((id) => id !== workspace.id && id !== snapshot.active && !pinned(find(id)!));
        if (!drop) break;
        workspaces = workspaces.filter((entry) => entry.id !== drop);
        recent = recent.filter((id) => id !== drop);
      }
      publish({ workspaces, recent, active: activate ? workspace.id : snapshot.active });
      return workspace.id;
    },
    /** Shows a workspace; showing it reads it. */
    activate(id: string) {
      const workspace = find(id);
      if (!workspace) return;
      if (snapshot.active === id && snapshot.recent[0] === id && !workspace.unread) return;
      publish({
        ...snapshot,
        workspaces: workspace.unread
          ? snapshot.workspaces.map((entry) =>
              entry.id === id ? ({ ...entry, unread: undefined } as Workspace) : entry,
            )
          : snapshot.workspaces,
        active: id,
        recent: [id, ...snapshot.recent.filter((entry) => entry !== id)],
      });
    },
    /** Marks a workspace as unread, as an agent's new work does, or as read.
     * Unread clears the next time the workspace is shown. */
    setUnread(id: string, unread: boolean) {
      const workspace = find(id);
      if (!workspace || !!workspace.unread === unread) return;
      publish({
        ...snapshot,
        workspaces: snapshot.workspaces.map((entry) =>
          entry.id === id ? ({ ...entry, unread: unread || undefined } as Workspace) : entry,
        ),
      });
    },
    /** Closes a workspace; the most recent other one takes its place. Vaults
     * and the home workspace stay. */
    close(id: string) {
      const workspace = find(id);
      const others = snapshot.workspaces.filter(
        (entry) => entry.id !== id && entry.kind !== "vault",
      );
      if (!workspace || pinned(workspace) || !others.length) return;
      const workspaces = snapshot.workspaces.filter((entry) => entry.id !== id);
      const recent = snapshot.recent.filter((entry) => entry !== id);
      const active =
        snapshot.active === id
          ? (recent.find((entry) => others.some((other) => other.id === entry)) ?? others[0]!.id)
          : snapshot.active;
      publish({
        workspaces,
        active,
        recent: [active, ...recent.filter((entry) => entry !== active)],
      });
    },
    /** Records what a workspace learned about itself once it loaded. A branch
     * change that makes it the same task as another workspace merges the two. */
    update(id: string, patch: WorkspacePatch) {
      const current = find(id);
      if (!current) return;
      const allowed: (keyof WorkspacePatch)[] =
        current.kind === "repository"
          ? ["title", "repository", "detail", "path", "repositoryId", "branch", "worktree"]
          : current.kind === "thread"
            ? [
                "title",
                "repository",
                "detail",
                "path",
                "repositoryId",
                "branch",
                "worktree",
                "reviewId",
              ]
            : current.kind === "pull"
              ? ["title", "repository", "detail", "jobId"]
              : ["title", "repository", "detail"];
      const same = (key: keyof WorkspacePatch) => (current as WorkspacePatch)[key] === patch[key];
      const changes = Object.fromEntries(
        allowed.filter((key) => key in patch && !same(key)).map((key) => [key, patch[key]]),
      );
      if (!Object.keys(changes).length) return;
      const next = { ...current, ...changes } as Workspace;
      const duplicate =
        next.kind === "repository" && ("branch" in changes || "path" in changes)
          ? snapshot.workspaces.find(
              (entry) => entry.id !== id && entry.id !== snapshot.active && matches(next, entry),
            )
          : undefined;
      // A workspace that comes to match the home one takes its place and pin,
      // so the view on screen stays and the list keeps one home.
      const heir = !!duplicate && pinned(duplicate) && !pinned(current);
      if (heir) (next as RepositoryWorkspace).home = true;
      const place = heir ? duplicate.id : id;
      publish({
        ...snapshot,
        workspaces: snapshot.workspaces.flatMap((entry) =>
          entry.id === place ? [next] : entry.id === id || entry === duplicate ? [] : [entry],
        ),
        recent: snapshot.recent.filter((entry) => entry !== duplicate?.id),
      });
    },
    /** A pull request's workspace becomes its review's thread, in its
     * place in the list. A workspace that has the thread already stays. */
    settle(id: string, reviewId: string) {
      const current = find(id);
      if (current?.kind !== "pull") return;
      const input = resolve({ kind: "thread", threadId: reviewId }) as Omit<ThreadWorkspace, "id">;
      const existing = snapshot.workspaces.find((entry) => matches(input, entry));
      const next: Workspace = existing ?? {
        ...input,
        id: threadWorkspaceId(input.threadId),
        ...(current.title ? { title: current.title } : {}),
        ...(current.repository ? { repository: current.repository } : {}),
      };
      publish({
        workspaces: existing
          ? snapshot.workspaces.filter((entry) => entry.id !== id)
          : snapshot.workspaces.map((entry) => (entry.id === id ? next : entry)),
        active: snapshot.active === id ? next.id : snapshot.active,
        recent: [...new Set(snapshot.recent.map((entry) => (entry === id ? next.id : entry)))],
      });
      return next.id;
    },
    /** Closes the workspaces of a repository that was removed, except the one
     * that removed it, which has already moved to another repository. The
     * home workspace starts again on the default repository. */
    closeRepository(repositoryId: string, keep: string) {
      const gone = snapshot.workspaces.filter(
        (entry) =>
          entry.kind === "repository" && entry.repositoryId === repositoryId && entry.id !== keep,
      );
      for (const entry of gone) {
        if (!pinned(entry)) {
          store.close(entry.id);
          continue;
        }
        const fresh: Workspace = { id: newId(), kind: "repository", home: true };
        publish({
          workspaces: snapshot.workspaces.map((other) => (other.id === entry.id ? fresh : other)),
          active: snapshot.active === entry.id ? fresh.id : snapshot.active,
          recent: snapshot.recent.map((other) => (other === entry.id ? fresh.id : other)),
        });
      }
    },
    /**
     * Learns which thread each review belongs to, from the thread list. A
     * workspace opened on a review that a session handed off becomes that
     * session's thread, or gives way to the session's open workspace.
     */
    setThreadOf(next: (reviewId: string) => string | undefined) {
      threadOf = next;
      for (const entry of snapshot.workspaces) {
        if (entry.kind !== "thread" || SESSION_THREAD.test(entry.threadId)) continue;
        const threadId = threadOf(entry.threadId);
        if (!threadId) continue;
        const reviewId = entry.reviewId ?? entry.threadId;
        const heir = snapshot.workspaces.find(
          (other) => other.kind === "thread" && other.threadId === threadId,
        );
        const moved: Workspace = heir
          ? { ...(heir as ThreadWorkspace), reviewId }
          : { ...entry, id: threadWorkspaceId(threadId), threadId, reviewId };
        const workspaces = snapshot.workspaces.flatMap((other) =>
          other === entry ? (heir ? [] : [moved]) : other === heir ? [moved] : [other],
        );
        const rename = (id: string) => (id === entry.id ? moved.id : id);
        publish({
          workspaces,
          active: rename(snapshot.active),
          recent: [...new Set(snapshot.recent.map(rename))],
        });
      }
    },
    /** Pins the registered vaults; a vault that was removed closes. */
    syncVaults(vaults: { sourceId: string; title: string }[]) {
      for (const vault of vaults) {
        const id = store.open({ kind: "vault", ...vault }, false);
        store.update(id, { title: vault.title });
      }
      const gone = snapshot.workspaces.filter(
        (entry) =>
          entry.kind === "vault" && !vaults.some((vault) => vault.sourceId === entry.sourceId),
      );
      if (!gone.length) return;
      const workspaces = snapshot.workspaces.filter((entry) => !gone.includes(entry));
      const recent = snapshot.recent.filter((id) => workspaces.some((entry) => entry.id === id));
      publish({
        workspaces,
        recent,
        active: gone.some((entry) => entry.id === snapshot.active)
          ? (recent[0] ?? workspaces[0]?.id ?? "")
          : snapshot.active,
      });
      if (!snapshot.active) store.follow("/");
    },
    /** Follows the list that another window saved. This window keeps its own
     * active workspace and does not write back, so windows never echo. */
    syncAcrossWindows() {
      const adopt = (event: StorageEvent) => {
        if (event.key !== STORAGE_KEY || event.storageArea !== localStorage) return;
        const next = read(event.newValue);
        const kept = next.workspaces.some((entry) => entry.id === snapshot.active);
        snapshot = {
          ...next,
          active: kept ? snapshot.active : (next.recent[0] ?? next.workspaces[0]?.id ?? ""),
        };
        for (const listener of listeners) listener();
      };
      window.addEventListener("storage", adopt);
      return () => window.removeEventListener("storage", adopt);
    },
    /** Selects the workspace that an address names. History entries made by a
     * workspace switch carry its id, because every branch shares "/". */
    follow(path: string, historyState?: unknown) {
      const vault = vaultPath(path);
      if (vault) return void store.open({ kind: "vault", sourceId: decodeURIComponent(vault) });
      const thread = reviewPath(path);
      if (thread) return void store.open({ kind: "thread", threadId: decodeURIComponent(thread) });
      const current = find(snapshot.active);
      if (overlayAddress(path) && current) return;
      const wanted = (historyState as { workspace?: unknown } | null)?.workspace;
      const named = typeof wanted === "string" ? find(wanted) : undefined;
      if (named?.kind === "repository" || named?.kind === "pull") return store.activate(named.id);
      if (current?.kind === "repository" || current?.kind === "pull") return;
      // A review link or a vault left the address: show the last branch.
      const last = snapshot.recent
        .map((id) => find(id))
        .find((entry) => entry?.kind === "repository");
      if (last) store.activate(last.id);
      else store.open({ kind: "repository", home: true });
    },
  };
  store.follow(pathname, state);
  return store;
}
