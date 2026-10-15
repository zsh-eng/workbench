import { useSyncExternalStore } from "react";
import {
  foundSettingsSchema,
  foundThreadId,
  sessionAdoptedSchema,
  type FoundUpdate,
  type SessionAdopt,
} from "../../shared/found-sessions";
import type { Thread, ThreadList } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";
import {
  reviewWorkspaceId,
  type Workspace,
  type WorkspaceInput,
  type WorkspaceSession,
} from "./workspaces";

// Found threads: Claude Code and Codex sessions in the registered
// repositories that Med found by itself (src/host/found-sessions.ts). One
// opens as a workspace on its checkout, with its live changes and its
// session; Keep in Med saves it as a thread and captures nothing.

export const isFoundThread = (thread: Pick<Thread, "found">) => thread.found === true;

/** The workspace that opens a thread: its saved review, or for a found
 * session, its checkout with the session beside it. */
export function threadInput(thread: Thread): WorkspaceInput {
  const session = thread.sessions?.[0];
  if (thread.found && thread.checkout && session && session.agent !== "acp")
    return {
      kind: "repository",
      path: thread.checkout,
      ...(thread.repository && {
        repositoryId: thread.repository.id,
        repository: thread.repository.name,
      }),
      ...(thread.branch && { branch: thread.branch }),
      title: thread.title,
      found: { agent: session.agent, id: session.id, cwd: session.cwd },
    };
  return { kind: "review", reviewId: thread.id, title: thread.title };
}

/** The thread ID of a found workspace's session. */
export const foundSessionThread = (session: WorkspaceSession) =>
  foundThreadId(session.agent, session.id);

/** The workspace ID of a thread in every window: its review's, or for a
 * found session, the thread's own (data/workspaces.ts). */
export const threadWorkspaceId = (thread: Pick<Thread, "id" | "found">) =>
  thread.found ? thread.id : reviewWorkspaceId(thread.id);

/** The thread that a workspace shows, if it shows one. */
export function workspaceThread(workspace: Workspace | undefined) {
  if (workspace?.kind === "review") return workspace.reviewId;
  if (workspace?.kind === "repository" && workspace.found)
    return foundSessionThread(workspace.found);
  return undefined;
}

// Whether the host lists found sessions, as its last thread list said. One
// list per window feeds it (`useThreads`); the palette reads it.
let shown = true;
const listeners = new Set<() => void>();
export function noteFoundSettings(list: ThreadList) {
  const next = list.found?.shown ?? true;
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useFoundShown = () => useSyncExternalStore(subscribe, () => shown);

/** Shows or hides all found sessions, or hides one thread. */
export function updateFound(update: FoundUpdate, fetcher: typeof fetch = browserFetch) {
  return createApi(fetcher, readBrowserToken()).json("/api/found", foundSettingsSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
}

/** The palette's command that shows or hides found sessions. */
export function useFoundCommands(fetcher: typeof fetch = browserFetch) {
  const listed = useFoundShown();
  return [
    {
      id: "found-sessions",
      label: listed ? "Hide sessions not kept in Med" : "Show sessions not kept in Med",
      run: () => void updateFound({ shown: !listed }, fetcher).catch(() => {}),
    },
  ];
}

/**
 * Keep in Med: saves a found session as a thread on its checkout, as `med
 * thread adopt` does. It captures nothing: the thread shows the checkout's
 * live Changes, and a Review once the agent shows one. A session that a
 * thread holds already opens that thread.
 */
export function keepFoundThread(
  input: { title: string; checkout: string; session: WorkspaceSession },
  fetcher: typeof fetch = browserFetch,
) {
  const { title, checkout, session } = input;
  const body: SessionAdopt = { session: session.id, repo: checkout, title };
  return createApi(fetcher, readBrowserToken()).json("/api/sessions/adopt", sessionAdoptedSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
