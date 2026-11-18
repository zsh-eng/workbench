import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { PullJob } from "../../src/shared/pull-workspace";
import type { Thread, ThreadReview } from "../../src/shared/threads";
import type { ReviewGuide } from "../../src/shared/review-guide";
import { initializeTheme, themeController } from "../../src/web/themes";

// A thread with its reviews in the workspace shell, with a fake host, for
// the session-reviews*.test.tsx files.

// A session that handed off two reviews is one thread: its rail's Reviews
// card shows each in the thread's workspace, and the session stays on screen.
// A review projects its own place: Changes are its checkout's. A pull request
// joins the thread as one more review. The host is a fake.

export const head = "a".repeat(40);
export const pullHead = "b".repeat(40);
/** The worktree of pull request #7, which Med made. */
export const PULL_TREE = "/test/worktrees/pr-7";
export const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "tide",
    branches: [
      { name: "main", head, worktreePath: "/test/repo", current: true },
      { name: "release", head, current: false },
      { name: "durations", head: pullHead, worktreePath: PULL_TREE, current: false },
    ],
    worktrees: [
      { path: "/test/repo", head, branch: "main" },
      { path: PULL_TREE, head: pullHead, branch: "durations", linked: true },
    ],
  },
];
export const tide = { id: "repo-0", name: "tide", path: "/test/repo" };
export const paths = ["src/tides.ts", "src/moon.ts"];
export const patch = paths
  .map(
    (path) =>
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`,
  )
  .join("");
export const reviewFor = (comparison: Comparison, id: string, repo = "/test/repo") => ({
  id,
  repo,
  comparison,
  base: head,
  head: comparison.kind === "range" ? comparison.head : "working",
  label: comparison.kind === "range" ? "main → durations" : "Working changes",
  files: paths.map((path) => ({
    path,
    status: "M",
    additions: 1,
    deletions: 1,
    binary: false,
  })),
  patch,
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
});
export const guide: ReviewGuide = {
  summary: "Tides and the moon.",
  segments: [
    {
      title: "Read the tides",
      summary: "The table reads hours.",
      files: ["src/tides.ts"],
    },
    {
      title: "Phase of the moon",
      summary: "The phase shows.",
      files: ["src/moon.ts"],
    },
  ],
};
export const session = { agent: "claude" as const, id: "s1", cwd: "/test/repo" };
export const PULL_URL = "https://github.com/acme/tide/pull/7";
/** A saved review that the session handed off, with its Guide. The review
 * "pull" is pull request #7's, in the worktree that Med made for it. */
/** The versions the reader opened, by review, as the host records them. */
export const readVersions = new Map<string, number[]>();
export const savedReview = (id: string) => ({
  id,
  ...(readVersions.has(id) && { readVersions: readVersions.get(id) }),
  title: id === "pull" ? "#7 Add durations" : id === "rev-b" ? "Month view" : "Week view",
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
  session,
  ...(id === "pull" && { pullRequestUrl: PULL_URL, pullRequestTitle: "Add durations" }),
  targets: [
    id === "pull"
      ? {
          id: "pull-target",
          repositoryId: "repo-0",
          repo: PULL_TREE,
          branch: "durations",
          label: "main → durations",
          comparison: { kind: "range", base: head, head: pullHead, mergeBase: true },
          base: head,
          head: pullHead,
          captured: false,
          // The comparison names its base: the review's Changes start there.
          names: { base: "release", head: "durations" },
        }
      : {
          id: `${id}-target`,
          repositoryId: "repo-0",
          repo: "/test/repo",
          branch: "main",
          label: "Captured",
          comparison: { kind: "working" },
          base: head,
          head: "working",
          captured: true,
        },
  ],
  guide: { ...guide, updatedAt: "2026-10-01T00:00:00Z" },
});
/** Pull request #7's review, as the thread lists it. */
export const pullReview = (now: number, state?: "open" | "merged"): ThreadReview => ({
  id: "pull",
  title: "Add durations",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: now - 500,
  place: { repository: tide, checkout: PULL_TREE, branch: "durations", linked: true },
  pullRequest: { url: PULL_URL, number: 7, title: "Add durations", ...(state && { state }) },
  fromPull: true,
});
export const events = [
  {
    at: 1000,
    update: {
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "Times in Tromsø are an hour off." },
    },
  },
  {
    at: 5000,
    update: {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: {
        type: "text",
        text: "Fixed formatTime. Week and month views use it.",
      },
    },
  },
];
export let root: Root | undefined;
export let mount: HTMLDivElement | undefined;
export let address = "";
export const KEYS = ["med:workspaces:v1", "med:window"];
/** The stored keys of these tests, and each thread's pane layout, which
 * another file's thread of the same ID would otherwise leave behind. */
export function forget() {
  for (const key of KEYS) localStorage.removeItem(key);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:panes:")) localStorage.removeItem(key);
}
/** A window wide enough for the session rail, with nothing saved. */
export async function prepareWindow() {
  await page.viewport(1500, 900);
  address = location.pathname + location.search;
  forget();
}
/** Unmounts the shell and gives the page its address back. */
export function cleanUp() {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  forget();
  history.replaceState(null, "", address);
}

export const stream = (init: RequestInit | undefined, first?: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        if (first) controller.enqueue(new TextEncoder().encode(first));
        init?.signal?.addEventListener("abort", () =>
          controller.error(new DOMException("Aborted", "AbortError")),
        );
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

export function createHost(initial: Thread[]) {
  let threads = initial;
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const frame = () =>
    `event: state\ndata: ${JSON.stringify({ threads, repositories: [tide] })}\n\n`;
  /** The live comparisons that the page asked for, in order. */
  const reviews: { repo: string; comparison: Comparison }[] = [];
  /** The pull requests that the page asked the host to open. */
  const pulls: { url: string; thread?: string }[] = [];
  /** The searches that the page asked for: the checkout, then the query. */
  const searches: string[] = [];
  let pullJob: PullJob | undefined;
  const pullStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const pullFrame = () =>
    new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(pullJob)}\n\n`);
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (url.pathname === "/api/pulls") {
      pulls.push(body as { url: string; thread?: string });
      pullJob = {
        id: `job-${pulls.length}`,
        url: pulls.at(-1)!.url,
        slug: "acme/tide",
        number: 7,
        status: "running",
        steps: [{ id: "repository", label: "Find acme/tide", state: "running" }],
        thread: pulls.at(-1)!.thread,
      };
      return Response.json(pullJob);
    }
    if (pullJob && url.pathname === `/api/pulls/${pullJob.id}/events`)
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            pullStreams.add(controller);
            controller.enqueue(pullFrame());
            init?.signal?.addEventListener("abort", () => {
              pullStreams.delete(controller);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    const opened = /^\/api\/threads\/([\w-]+)\/open$/.exec(url.pathname);
    if (opened)
      return Response.json({
        thread: threads.find((each) => each.id === opened[1]),
      });
    if (url.pathname === "/api/sessions/claude-s1/events")
      return stream(
        init,
        `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      );
    if (url.pathname === "/api/sessions/claude-s1/agent/events")
      return stream(
        init,
        `event: state\ndata: ${JSON.stringify({ messages: [], waiting: [], drafts: [] })}\n\n`,
      );
    const target = /^\/api\/reviews\/([\w-]+)\/targets\/[\w-]+\/(review|notes)$/.exec(url.pathname);
    if (target?.[2] === "review")
      return Response.json(
        target[1] === "pull"
          ? reviewFor(
              savedReview("pull").targets[0]!.comparison as Comparison,
              "pull-target",
              PULL_TREE,
            )
          : reviewFor({ kind: "working" }, `${target[1]}-target`),
      );
    // The pull request's comments say that it merged.
    if (url.pathname === "/api/reviews/pull/pull-request")
      return Response.json({
        url: PULL_URL,
        head: pullHead,
        pull: { number: 7, title: "Add durations", author: "ada", state: "merged" },
        fetchedAt: Date.now(),
        threads: [],
        conversation: [],
        reviews: [],
      });
    if (target?.[2] === "notes")
      return Response.json({
        reviewId: `${target[1]}-target`,
        revision: 0,
        notes: [],
      });
    const read = /^\/api\/reviews\/([\w-]+)\/read$/.exec(url.pathname);
    if (read && init?.method === "POST") {
      const { version } = body as { version: number };
      readVersions.set(read[1]!, [...new Set([...(readVersions.get(read[1]!) ?? []), version])]);
      return Response.json(savedReview(read[1]!));
    }
    const saved = /^\/api\/reviews\/([\w-]+)$/.exec(url.pathname);
    if (saved) return Response.json(savedReview(saved[1]!));
    switch (url.pathname) {
      case "/api/threads/events":
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              listeners.add(controller);
              controller.enqueue(new TextEncoder().encode(frame()));
              init?.signal?.addEventListener("abort", () => {
                listeners.delete(controller);
                controller.error(new DOMException("Aborted", "AbortError"));
              });
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      case "/api/threads/history":
        return Response.json({ threads: [] });
      case "/api/events":
      case "/api/windows":
        return stream(init);
      case "/api/repositories":
        return Response.json({ repositories });
      case "/api/branches":
        return Response.json(
          repositories[0]!.branches.map((branch) => ({
            ...branch,
            current: branch.worktreePath === (url.searchParams.get("repo") ?? "/test/repo"),
          })),
        );
      case "/api/agents":
        return Response.json({
          agents: [
            {
              id: "claude",
              name: "Claude Code",
              kind: "claude",
              available: true,
            },
          ],
        });
      case "/api/session": {
        // The checkout that the page names, as Git has it.
        const tree =
          repositories[0]!.worktrees.find((entry) => entry.path === url.searchParams.get("repo")) ??
          repositories[0]!.worktrees[0]!;
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: {
            path: tree.path,
            name: "tide",
            head: tree.head,
            branch: tree.branch,
            shallow: false,
            git: true,
          },
          worktrees: repositories[0]!.worktrees,
        });
      }
      case "/api/review": {
        const request = body as { repo: string; comparison: Comparison };
        reviews.push(request);
        return Response.json(reviewFor(request.comparison, `live-${request.repo}`, request.repo));
      }
      case "/api/notes":
        return Response.json({
          reviewId: url.searchParams.get("reviewId"),
          revision: 0,
          notes: [],
        });
      case "/api/browse/list":
        return Response.json({
          source: (body as { source: unknown }).source,
          entries: [],
          truncated: false,
        });
      case "/api/browse/search": {
        const { source, query } = body as { source: { repo: string }; query: string };
        searches.push(`${source.repo} ${query}`);
        return Response.json({
          source,
          query,
          matches: "after".includes(query)
            ? [{ path: "src/tides.ts", line: 1, text: "after" }]
            : [],
          truncated: false,
          resultSource: source,
          engine: "git",
        });
      }
      case "/api/browse/read": {
        const { source, path } = body as { source: { repo: string }; path: string };
        return Response.json({
          source,
          path,
          kind: "text",
          size: 5,
          identity: `${source.repo}:${path}`,
          text: "after",
        });
      }
    }
    // Owned sessions, turns, and the rest: none here.
    return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
  };
  return {
    fetcher,
    reviews,
    pulls,
    searches,
    /** The thread list changes, as when a review joins a thread. */
    setThreads(next: Thread[]) {
      threads = next;
      for (const listener of listeners) listener.enqueue(new TextEncoder().encode(frame()));
    },
    /** The host's job moves on. */
    setPull(patch: Partial<PullJob>) {
      pullJob = { ...pullJob!, ...patch };
      for (const stream of pullStreams) stream.enqueue(pullFrame());
    },
  };
}

export function render(host: ReturnType<typeof createHost>) {
  initializeTheme();
  themeController.commit("med-night");
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const browse = createBrowseApi(host.fetcher, "fixture");
  // The Session pane's streams read the fake host too. Without it they go to
  // the test server: its live stream fails after 3 s, the session events
  // answer 404, and the pane shows the session as missing.
  root.render(
    <WorkspaceHost fetch={host.fetcher}>
      <WorkspaceViews options={{ fetch: host.fetcher }}>
        {(controller) => (
          <App controller={controller} browseApi={browse} sessionFetch={host.fetcher} />
        )}
      </WorkspaceViews>
    </WorkspaceHost>,
  );
}

export const sessionThread = (now: number): Thread => ({
  id: "claude-s1",
  kind: "session",
  title: "Tide times",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: now - 1000,
  repository: tide,
  checkout: "/test/repo",
  branch: "main",
  agent: "claude",
  state: "idle",
  session,
  reviews: [
    { id: "rev-a", title: "Week view", createdAt: "2026-10-02T00:00:00Z", updatedAt: now - 1000 },
    { id: "rev-b", title: "Month view", createdAt: "2026-10-01T00:00:00Z", updatedAt: now - 5000 },
  ],
  changes: { files: 2, additions: 14, deletions: 3 },
});

/** The review on screen, by its comparison's ID. */
export const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  )?.dataset.reviewId;
/** Whether the thread's session is on screen. */
export const sessionShown = () =>
  !!document.querySelector("[data-session-panel]")?.checkVisibility({ visibilityProperty: true });

export const pages = () => page.getByRole("radiogroup", { name: "Page" });
/** Opens the thread in a window wide enough for the session's rail, with its
 * Reviews, to stay beside the review. */
export const openThread = async () => {
  await page.viewport(2400, 900);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
};
