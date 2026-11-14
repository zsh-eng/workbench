import { useEffect, useState } from "react";
import { threadListSchema, type Thread, type ThreadList } from "../../shared/threads";
import type { ThreadWorkspace, Workspace, WorkspaceInput } from "./workspaces";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { noteFoundSettings } from "./found-threads";
import { readServerEvents } from "./sse";
import { reconnectPause } from "./reconnect";

/** The list of a host without threads, such as `med review` alone. */
export const NO_THREADS: ThreadList = { threads: [], repositories: [] };

/**
 * The tabs, in the user's order, and the registered repositories. The host
 * sends the list again when a tab or its agent changes; the stream reconnects
 * with a backoff. `null` until the host answers. History is not in it.
 *
 * A thread that did not change keeps its object, so that its row and its
 * workspace render again only for their own thread's changes.
 */
export function useThreads(fetcher: typeof fetch): ThreadList | null {
  const [list, setList] = useState<ThreadList | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const api = createApi(fetcher, readBrowserToken());
    let known = new Map<string, { text: string; thread: Thread }>();
    const keep = (next: ThreadList): ThreadList => {
      const seen = new Map<string, { text: string; thread: Thread }>();
      const threads = next.threads.map((thread) => {
        const text = JSON.stringify(thread);
        const before = known.get(thread.id);
        const kept = before?.text === text ? before.thread : thread;
        seen.set(thread.id, { text, thread: kept });
        return kept;
      });
      known = seen;
      return { ...next, threads };
    };
    void (async () => {
      let attempt = 0;
      while (!signal.aborted) {
        try {
          const response = await api.stream("/api/threads/events", signal);
          // A host without threads lists none.
          if (response.status === 404) return setList(NO_THREADS);
          if (!response.ok || !response.body) throw new Error("The thread stream closed.");
          attempt = 0;
          await readServerEvents(
            response.body,
            (event) => {
              if (event.event !== "state") return;
              const parsed = threadListSchema.safeParse(JSON.parse(event.data));
              if (!parsed.success) return;
              setList(keep(parsed.data));
              noteFoundSettings(parsed.data);
            },
            signal,
            4 * 1024 * 1024,
          );
        } catch {
          if (signal.aborted) return;
        }
        await reconnectPause(attempt++, signal);
      }
    })();
    return () => controller.abort();
  }, [fetcher]);
  return list;
}

/** The threads in the sidebar's order, which ⌘1–⌘9 follow: the Superagent's,
 * then the pinned ones in the order they were pinned, then the others, newest
 * activity first. */
export const tabOrder = (threads: readonly Thread[]): Thread[] => [
  ...threads.filter((thread) => thread.superagent),
  ...threads
    .filter((thread) => thread.pinned && !thread.superagent)
    .toSorted((a, b) => a.pinned! - b.pinned!),
  ...threads
    .filter((thread) => !thread.pinned && !thread.superagent)
    .toSorted((a, b) => b.updatedAt - a.updatedAt),
];

export { needsYou } from "../../shared/threads";

/** The workspace that opens a thread: its review, its session, and the
 * checkout where it works now. */
export const threadInput = (thread: Thread): Omit<ThreadWorkspace, "id"> => ({
  kind: "thread",
  threadId: thread.id,
  title: thread.title,
  ...(thread.checkout && { path: thread.checkout }),
  ...(thread.repository && {
    repositoryId: thread.repository.id,
    repository: thread.repository.name,
  }),
  ...(thread.branch && { branch: thread.branch }),
});

/** The thread that a workspace shows, if it shows one. */
export const workspaceThread = (workspace: Workspace | WorkspaceInput | undefined) =>
  workspace?.kind === "thread" ? workspace.threadId : undefined;

/** Whether each word of the query is in one of the fields. */
export function matches(words: readonly string[], fields: (string | undefined)[]) {
  if (!words.length) return true;
  const text = fields.filter(Boolean).join("\n").toLowerCase();
  return words.every((word) => text.includes(word));
}
/** What a search of tabs and history reads of a thread: its title, branch,
 * repository, checkout, and first prompt. */
export const threadFields = (thread: Thread) => [
  thread.title,
  thread.branch,
  thread.repository?.name,
  thread.checkout?.split("/").at(-1),
  thread.prompt,
];

/** A short age: now, 4m, 3h, 2d, then the date. */
export function shortAge(at: number, now: number) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
