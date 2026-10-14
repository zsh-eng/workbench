import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  attemptLetter,
  attemptRoutes,
  type AttemptCompare,
  type AttemptKept,
} from "../../shared/attempts";
import type { AgentChoices } from "../../shared/owned-session";
import { savedReviewSchema, type SavedReview } from "../../shared/saved-review";
import { threadSlug, type Thread } from "../../shared/threads";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { browserFetch } from "./live";

// Attempts in the browser: the Attempts page's address, the sidebar's groups,
// starting a task as several attempts, and the host's compare, keep, and undo.

const api = (fetcher: typeof fetch) => createApi(fetcher, readBrowserToken());

// ---------------------------------------------------------------- address

const ATTEMPTS_PATH = "/attempts/";

/** The group that an address shows, such as /attempts/week-view. */
export function attemptsGroupOf(pathname: string) {
  const match = /^\/attempts\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

interface AttemptsState {
  /** Set when this window opened the page, so Back returns to the view before it. */
  attempts?: string;
  /** A problem from the start, such as an attempt that did not start. */
  attemptsProblem?: string;
}

/** Shows the Attempts page of a group over the workspaces. */
export function openAttempts(group: string, problem?: string) {
  const state: AttemptsState = {
    attempts: group,
    ...(problem ? { attemptsProblem: problem } : {}),
  };
  history.pushState(state, "", `${ATTEMPTS_PATH}${encodeURIComponent(group)}`);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

/** Whether this window opened the page that shows now. */
export const attemptsOpenedHere = () =>
  typeof (history.state as AttemptsState | null)?.attempts === "string";

const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
const readGroup = () => attemptsGroupOf(location.pathname);
const noGroup = () => null;

/** The group whose Attempts page shows, or null. */
export function useAttemptsAddress() {
  return useSyncExternalStore(subscribe, readGroup, noGroup);
}

const readProblem = () => (history.state as AttemptsState | null)?.attemptsProblem;
const noProblem = () => undefined;

/** The problem that the start left for the page, if any. */
export function useAttemptsProblem() {
  return useSyncExternalStore(subscribe, readProblem, noProblem);
}

// ---------------------------------------------------------------- sidebar

export interface AttemptGroup {
  id: string;
  /** The task's title: the first attempt's. */
  title: string;
  /** The attempts in the list, by letter. */
  attempts: Thread[];
}
export type SidebarEntry =
  | { kind: "thread"; thread: Thread }
  | { kind: "group"; group: AttemptGroup };

/**
 * Threads in their order, with the attempts of one task together at the place
 * of the first one, by letter. A group needs two attempts in the list: after
 * Keep, the kept attempt is an ordinary thread.
 */
export function attemptEntries(threads: readonly Thread[]): SidebarEntry[] {
  const groups = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (!thread.group) continue;
    const members = groups.get(thread.group.id);
    if (members) members.push(thread);
    else groups.set(thread.group.id, [thread]);
  }
  const entries: SidebarEntry[] = [];
  const placed = new Set<string>();
  for (const thread of threads) {
    const members = thread.group && groups.get(thread.group.id);
    if (!members || members.length < 2) {
      entries.push({ kind: "thread", thread });
      continue;
    }
    if (placed.has(thread.group!.id)) continue;
    placed.add(thread.group!.id);
    const attempts = [...members].sort((a, b) => a.group!.attempt - b.group!.attempt);
    entries.push({
      kind: "group",
      group: { id: thread.group!.id, title: attempts[0]!.title, attempts },
    });
  }
  return entries;
}

/** Threads in sidebar order, with each group's attempts together. */
export const orderAttempts = (threads: readonly Thread[]) =>
  attemptEntries(threads).flatMap((entry) =>
    entry.kind === "thread" ? [entry.thread] : entry.group.attempts,
  );

const agentNames: Record<string, string> = { claude: "Claude", codex: "Codex" };

/** An attempt's name in the sidebar, such as "B · Codex · gpt-6-astra". */
export function attemptName(thread: Thread) {
  const letter = attemptLetter(thread.group?.attempt ?? 1);
  const agent = thread.group?.label ?? (thread.agent ? agentNames[thread.agent] : undefined);
  return agent ? `${letter} · ${agent}` : `Attempt ${letter}`;
}

// ------------------------------------------------------------------ start

export interface AttemptStart {
  preset: string;
  choices: AgentChoices;
  /** The agent and model as the pickers name them. */
  label?: string;
}

/**
 * Starts one task as several attempts, one after the other, so each branch
 * name is free when its worktree is made. When a later attempt does not
 * start, the ones that started stay, and `problem` says which did not.
 */
export async function startAttempts(
  input: { repositoryId: string; prompt: string; title: string; attempts: AttemptStart[] },
  fetcher: typeof fetch = browserFetch,
) {
  const group = `${threadSlug(input.title)}-${Math.random().toString(16).slice(2, 6)}`;
  const reviews: SavedReview[] = [];
  for (const [index, attempt] of input.attempts.entries()) {
    try {
      const result = await api(fetcher).json(
        "/api/threads",
        z.object({ review: savedReviewSchema }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repositoryId: input.repositoryId,
            prompt: input.prompt,
            title: input.title,
            preset: attempt.preset,
            worktree: true,
            choices: attempt.choices,
            group: {
              id: group,
              attempt: index + 1,
              ...(attempt.label ? { label: attempt.label } : {}),
            },
          }),
        },
      );
      reviews.push(result.review);
    } catch (error) {
      if (!reviews.length) throw error;
      const reason = error instanceof Error ? error.message : "Med could not start it.";
      return {
        group,
        reviews,
        problem: `Attempt ${attemptLetter(index + 1)} did not start. ${reason}`,
      };
    }
  }
  return { group, reviews };
}

// ---------------------------------------------------------- compare, keep

export function keepAttempt(group: string, threadId: string, fetcher = browserFetch) {
  return api(fetcher).call(attemptRoutes.keep, { group, threadId });
}

export function undoKeep(group: string, fetcher = browserFetch) {
  return api(fetcher).call(attemptRoutes.undo, { group });
}

/** What changes the comparison: an attempt's time, state, or counts in the thread list. */
export function attemptsVersion(threads: readonly Thread[], group: string) {
  return threads
    .filter((thread) => thread.group?.id === group)
    .map((thread) => `${thread.id}:${thread.updatedAt}:${thread.state}:${thread.changes?.files}`)
    .join(",");
}

/**
 * The comparison of a group's attempts. It is read again, a little later,
 * when `version` changes, such as while an agent works; the last result
 * stays on screen meanwhile.
 */
export function useAttemptCompare(group: string, version: string, fetcher = browserFetch) {
  const [state, setState] = useState<{
    group: string;
    data?: AttemptCompare;
    error?: { message: string; missing: boolean };
  }>({ group });
  const [round, setRound] = useState(0);
  const shown = state.group === group ? state : { group };
  const loaded = !!shown.data;
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        void api(fetcher)
          .call(attemptRoutes.compare, { group }, controller.signal)
          .then(
            (data) => setState({ group, data }),
            (error: unknown) => {
              if (controller.signal.aborted) return;
              const message = error instanceof Error ? error.message : "Med could not read them.";
              const missing = (error as { status?: number }).status === 404;
              setState((last) => ({
                group,
                ...(last.group === group && last.data && !missing ? { data: last.data } : {}),
                error: { message, missing },
              }));
            },
          ),
      loaded ? 400 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // A new version reads again; the first read waits for nothing.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [group, version, round, fetcher]);
  return { ...shown, retry: () => setRound((value) => value + 1) };
}

export type { AttemptKept };
