import { afterEach, beforeEach, expect, test } from "vitest";
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

// A session that handed off two reviews is one thread: its rail's Reviews
// card shows each in the thread's workspace, and the session stays on screen.
// A review projects its own place: Changes are its checkout's. A pull request
// joins the thread as one more review. The host is a fake.

const head = "a".repeat(40);
const pullHead = "b".repeat(40);
/** The worktree of pull request #7, which Med made. */
const PULL_TREE = "/test/worktrees/pr-7";
const repositories = [
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
const tide = { id: "repo-0", name: "tide", path: "/test/repo" };
const paths = ["src/tides.ts", "src/moon.ts"];
const patch = paths
  .map(
    (path) =>
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`,
  )
  .join("");
const reviewFor = (comparison: Comparison, id: string, repo = "/test/repo") => ({
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
const guide: ReviewGuide = {
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
const session = { agent: "claude" as const, id: "s1", cwd: "/test/repo" };
const PULL_URL = "https://github.com/acme/tide/pull/7";
/** A saved review that the session handed off, with its Guide. The review
 * "pull" is pull request #7's, in the worktree that Med made for it. */
const savedReview = (id: string) => ({
  id,
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
const pullReview = (now: number, state?: "open" | "merged"): ThreadReview => ({
  id: "pull",
  title: "Add durations",
  createdAt: "2026-10-03T00:00:00Z",
  updatedAt: now - 500,
  place: { repository: tide, checkout: PULL_TREE, branch: "durations", linked: true },
  pullRequest: { url: PULL_URL, number: 7, title: "Add durations", ...(state && { state }) },
});
const events = [
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
let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const KEYS = ["med:workspaces:v1", "med:window"];
/** The stored keys of these tests, and each thread's pane layout, which
 * another file's thread of the same ID would otherwise leave behind. */
function forget() {
  for (const key of KEYS) localStorage.removeItem(key);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:panes:")) localStorage.removeItem(key);
}
beforeEach(async () => {
  await page.viewport(1500, 900);
  address = location.pathname + location.search;
  forget();
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  forget();
  history.replaceState(null, "", address);
});

const stream = (init: RequestInit | undefined, first?: string) =>
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

function createHost(initial: Thread[]) {
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

function render(host: ReturnType<typeof createHost>) {
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

const sessionThread = (now: number): Thread => ({
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
const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  )?.dataset.reviewId;
/** Whether the thread's session is on screen. */
const sessionShown = () =>
  !!document.querySelector("[data-session-panel]")?.checkVisibility({ visibilityProperty: true });

test("a session's reviews show in its one thread, and the session stays on screen", async () => {
  render(createHost([sessionThread(Date.now())]));
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.element(reviews).toBeVisible();
  await expect
    .element(
      page.getByRole("log", { name: "Session" }).getByText("Times in Tromsø are an hour off."),
    )
    .toBeVisible();
  // The newest review shows first.
  await expect.poll(shown).toBe("rev-a-target");

  // The other review takes its place in the same workspace; the session stays.
  await reviews.getByRole("button", { name: /^Month view/ }).click();
  await expect.poll(shown).toBe("rev-b-target");
  expect(sessionShown()).toBe(true);
  expect(document.querySelectorAll('[data-workspace-slot$="claude-s1"]').length).toBe(1);
});

test("the review's name lists the thread's reviews, also while the rail hides; a choice shows that review", async () => {
  render(createHost([sessionThread(Date.now())]));
  // A window too narrow for the session's rail beside the review.
  await page.viewport(1280, 800);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  await expect.poll(shown).toBe("rev-a-target");
  // The review opens beside the session: its row has the name.
  await userEvent.click(pages().getByRole("radio", { name: /^Review/ }));
  // The session is narrow beside the review: its rail, with Reviews, hides.
  await expect
    .poll(
      () =>
        document.querySelector('[role="region"][aria-label="Reviews"]')?.checkVisibility() ?? false,
    )
    .toBe(false);
  await userEvent.click(page.getByRole("button", { name: "Reviews of this thread" }));
  // The review on screen is the checked one.
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Week view" }))
    .toHaveAttribute("aria-checked", "true");
  await userEvent.click(page.getByRole("menuitemcheckbox", { name: "Month view" }));
  await expect.poll(shown).toBe("rev-b-target");
  expect(sessionShown()).toBe(true);
});

test("a thread with one review has no list at the review's name", async () => {
  const thread = sessionThread(Date.now());
  render(createHost([{ ...thread, reviews: thread.reviews.slice(0, 1) }]));
  await page.viewport(1280, 800);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
  await expect.poll(shown).toBe("rev-a-target");
  await userEvent.click(pages().getByRole("radio", { name: /^Review/ }));
  await expect
    .poll(() => document.querySelector('header[aria-label="Review header"]')?.checkVisibility())
    .toBe(true);
  expect(document.querySelector('[aria-label="Reviews of this thread"]')).toBeNull();
});

const pages = () => page.getByRole("radiogroup", { name: "Page" });
/** Opens the thread in a window wide enough for the session's rail, with its
 * Reviews, to stay beside the review. */
const openThread = async () => {
  await page.viewport(2400, 900);
  await userEvent.click(
    page.getByRole("navigation", { name: "Sessions" }).getByRole("button", { name: /^Tide times/ }),
  );
};

test("Changes are the checkout of the review on screen: a pull request's worktree, then the session's again", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const host = createHost([{ ...thread, reviews: [...thread.reviews, pullReview(now - 9000)] }]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.poll(shown).toBe("rev-a-target");

  // The session's own review is of the checkout where it works: its Changes
  // are that checkout's working changes, on the base branch.
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  expect(host.reviews.at(-1)).toEqual({ repo: "/test/repo", comparison: { kind: "working" } });

  // The pull request's review is in its own worktree. The session still
  // works in /test/repo; Changes are the worktree's branch, since the base
  // that the review names, not the repository's main.
  await reviews.getByRole("button", { name: /^Add durations/ }).click();
  await expect.poll(shown).toBe("pull-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.at(-1)).toEqual({
    repo: PULL_TREE,
    comparison: { kind: "working", base: "release" },
  });
  await expect
    .element(page.getByRole("combobox", { name: "Comparison" }))
    .toMatchTextContent("durations since release");
  expect(sessionShown()).toBe(true);
  // The session moves to another checkout. The Changes on screen are the
  // review's: they stay in its worktree.
  const moved = host.reviews.length;
  host.setThreads([
    {
      ...thread,
      checkout: "/test/worktrees/next",
      branch: "next",
      reviews: [...thread.reviews, pullReview(now - 9000)],
    },
  ]);
  await expect
    .element(page.getByRole("region", { name: "Environment" }))
    .toMatchTextContent("next");
  expect(shown()).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.slice(moved)).toEqual([]);
  // The Review and its Changes are one place: going back and forth reads
  // no other checkout.
  const asked = host.reviews.length;
  await pages().getByRole("radio", { name: "Review" }).click();
  await expect.poll(shown).toBe("pull-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe(`live-${PULL_TREE}`);
  expect(host.reviews.slice(asked).map((request) => request.repo)).not.toContain("/test/repo");
  // Search reads the same checkout, and its match opens that checkout's file.
  const openTab = () =>
    document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title");
  await userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
  await userEvent.keyboard("after");
  await expect.poll(() => host.searches).toContain(`${PULL_TREE} after`);
  await expect.element(page.getByRole("option", { selected: true })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(openTab).toMatch(/^src\/tides\.ts · Working files · durations/);
  expect(host.searches.filter((search) => search.startsWith("/test/repo "))).toEqual([]);

  // The other review switches the place back. Its Changes are the session's
  // checkout's, and the worktree's file is not among its tabs.
  await reviews.getByRole("button", { name: /^Week view/ }).click();
  await expect.poll(shown).toBe("rev-a-target");
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  expect(host.reviews.at(-1)).toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
  // The page is Changes, not the review's Guide: the workspace's pages still
  // answer after its review changed.
  await expect.element(page.getByRole("combobox", { name: "Comparison" })).toBeVisible();
  await expect.element(pages().getByRole("radio", { name: "Changes" })).toBeChecked();
  expect(page.getByRole("tab", { name: /tides\.ts/ }).query()).toBeNull();

  // The pull request's review again: its checkout, with the file that was open there.
  await reviews.getByRole("button", { name: /^Add durations/ }).click();
  await expect.poll(shown).toBe("pull-target");
  await expect.element(page.getByRole("tab", { name: /tides\.ts/ })).toBeVisible();
  expect(sessionShown()).toBe(true);
});

test("the Reviews list says which review has which pull request, and its state once Med has read it", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const [week, month] = thread.reviews;
  const withPulls = (state?: "open" | "merged"): Thread => ({
    ...thread,
    reviews: [
      week!,
      {
        ...month!,
        pullRequest: { url: "https://github.com/acme/tide/pull/3", number: 3, state: "open" },
      },
      pullReview(now - 9000, state),
    ],
    pullRequestUrl: "https://github.com/acme/tide/pull/3",
  });
  const host = createHost([withPulls()]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.poll(shown).toBe("rev-a-target");
  // A review without a pull request names none; the others name theirs.
  await expect.element(reviews.getByRole("button", { name: /^Week view/ })).toBeVisible();
  expect(reviews.getByRole("button", { name: /^Week view/ }).element().textContent).not.toContain(
    "#",
  );
  await expect
    .element(reviews.getByRole("button", { name: /^Month view/ }))
    .toMatchTextContent("#3 open");
  // Nothing has read #7 yet: the number alone.
  await expect
    .element(reviews.getByRole("button", { name: /^Add durations/ }))
    .toMatchTextContent("#7 · ");

  // The host read it: the row names the state, also for the review on screen.
  host.setThreads([withPulls("merged")]);
  await expect
    .element(reviews.getByRole("button", { name: /^Add durations/ }))
    .toMatchTextContent("#7 merged");
  await reviews.getByRole("button", { name: /^Add durations/ }).click();
  await expect.poll(shown).toBe("pull-target");
  await expect
    .element(reviews.getByRole("button", { name: /^#7 Add durations/ }))
    .toMatchTextContent("#7 merged");
});

test("Add a pull request… on a thread with no review shows the review, before the thread list has it", async () => {
  const now = Date.now();
  const thread = { ...sessionThread(now), reviews: [] };
  const host = createHost([thread]);
  render(host);
  await openThread();
  await pages().getByRole("radio", { name: "Changes" }).click();
  await expect.poll(shown).toBe("live-/test/repo");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Add a pull request");
  await userEvent.keyboard("{Enter}");
  await page.getByRole("textbox", { name: "Add a pull request" }).fill(PULL_URL);
  await expect.element(page.getByRole("button", { name: /Add pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => host.pulls).toEqual([{ url: PULL_URL, thread: "claude-s1" }]);
  await expect
    .element(page.getByRole("region", { name: "Opening the pull request" }))
    .toBeVisible();
  // The job ends first; the thread list names the review later.
  host.setPull({ status: "done", reviewId: "pull" });
  await expect.poll(shown).toBe("pull-target");
  await expect.element(pages().getByRole("radio", { name: "Review" })).toBeChecked();
  host.setThreads([{ ...thread, reviews: [pullReview(Date.now(), "open")] }]);
  await expect.poll(shown).toBe("pull-target");
  expect(sessionShown()).toBe(true);
  expect(location.pathname).toBe("/review/claude-s1");
});

test("Add a pull request… adds it to the thread as one more review; a link that the thread has shows that review", async () => {
  const now = Date.now();
  const thread = sessionThread(now);
  const host = createHost([thread]);
  render(host);
  await openThread();
  const reviews = page.getByRole("region", { name: "Reviews" });
  await expect.poll(shown).toBe("rev-a-target");
  /** The workspaces that the window has mounted. */
  const slots = () => document.querySelectorAll("[data-workspace-slot]").length;
  const open = slots();
  const add = async (link: string) => {
    await userEvent.keyboard("{Control>}k{/Control}");
    await page.getByRole("combobox", { name: "Search commands" }).fill("Add a pull request");
    await userEvent.keyboard("{Enter}");
    const field = page.getByRole("textbox", { name: "Add a pull request" });
    await expect.element(field).toBeVisible();
    return { field, fill: () => field.fill(link) };
  };

  // Text that names no pull request gives nothing to run.
  const first = await add(`${PULL_URL}/files`);
  await first.field.fill("durations");
  await expect.element(page.getByText(/^Paste a GitHub pull request link/)).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(host.pulls).toEqual([]);
  // A link from the Files tab names the pull request. The host gets it for
  // this thread, and no workspace opens for it.
  await first.fill();
  await expect.element(page.getByRole("button", { name: /Add pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => host.pulls).toEqual([{ url: PULL_URL, thread: "claude-s1" }]);
  expect(slots()).toBe(open);
  expect(location.pathname).toBe("/review/claude-s1");
  // Its steps show where the review shows next, as a pull request's workspace
  // shows them. A failed step says why, and Retry asks the host again.
  const progress = page.getByRole("region", { name: "Opening the pull request" });
  await expect.element(progress).toBeVisible();
  host.setPull({
    status: "failed",
    error: "Add a clone of acme/tide to Med, then open the link again.",
    steps: [{ id: "repository", label: "Find acme/tide", state: "failed" }],
  });
  await expect
    .element(progress.getByRole("alert"))
    .toMatchTextContent("Add a clone of acme/tide to Med, then open the link again.");
  await progress.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => host.pulls.length).toBe(2);
  expect(host.pulls[1]).toEqual({ url: PULL_URL, thread: "claude-s1" });

  // The host saved the review in the thread: it shows, in the thread's
  // workspace, at its own place, and the list has it.
  host.setThreads([{ ...thread, reviews: [pullReview(Date.now(), "open"), ...thread.reviews] }]);
  host.setPull({ status: "done", reviewId: "pull" });
  await expect.poll(shown).toBe("pull-target");
  await expect.element(progress).not.toBeInTheDocument();
  expect(slots()).toBe(open);
  expect(location.pathname).toBe("/review/claude-s1");
  expect(sessionShown()).toBe(true);
  await expect
    .element(reviews.getByRole("button", { name: /^#7 Add durations/ }))
    .toMatchTextContent("#7 open");

  // The same link again asks the host nothing: its review shows.
  await reviews.getByRole("button", { name: /^Week view/ }).click();
  await expect.poll(shown).toBe("rev-a-target");
  const again = await add(PULL_URL);
  await again.fill();
  await userEvent.keyboard("{Enter}");
  await expect.poll(shown).toBe("pull-target");
  expect(host.pulls.length).toBe(2);
});
