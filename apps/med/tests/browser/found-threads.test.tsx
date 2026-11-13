import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";
// The title band's sizes, which the review's title row in the band reads.
import "../../src/web/components/TitleRow.css";

// Sessions that Med found by itself (src/host/session-index.ts) list as
// threads; one opens on the checkout where it works, with its session, and
// the reviews that it hands off join its thread.

const head = "a".repeat(40);
const branches = [
  { name: "main", head, worktreePath: "/test/repo", current: true },
  { name: "glossary", head, worktreePath: "/test/glossary", current: false },
];
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "tide",
    branches,
    worktrees: branches.map((branch, index) => ({
      path: branch.worktreePath,
      head,
      branch: branch.name,
      ...(index ? { linked: true } : {}),
    })),
  },
];
const patchFor = (repo: string) => {
  const path = repo === "/test/glossary" ? "README.md" : "src/tides.ts";
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`;
};
const reviewFor = (repo: string, comparison: Comparison, id = `review-${repo}`) => ({
  id,
  repo,
  comparison,
  base: head,
  head: "working",
  label: "Working changes",
  files: [
    {
      path: repo === "/test/glossary" ? "README.md" : "src/tides.ts",
      status: "M",
      additions: 1,
      deletions: 1,
      binary: false,
    },
  ],
  patch: patchFor(repo),
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: 1, cacheHit: false },
});
const glossarySession = { agent: "claude" as const, id: "5f0c2a8e-1111", cwd: "/test/glossary" };
const FOUND = `claude-${glossarySession.id}`;
const found = (patch: Partial<Thread> = {}): Thread => ({
  id: FOUND,
  kind: "session",
  title: "README glossary",
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: Date.now() - 20_000,
  repository: { id: "repo-0", name: "tide", path: "/test/repo" },
  checkout: "/test/glossary",
  linked: true,
  branch: "glossary",
  agent: "claude",
  state: "working",
  session: glossarySession,
  reviews: [],
  changes: { files: 1, additions: 6, deletions: 0 },
  ...patch,
});
/** A review that the session handed off: one comparison for each version. */
const kept = (repo: string, versions: number) => ({
  id: "r_kept",
  title: "README glossary",
  session: { ...glossarySession, cwd: repo },
  createdAt: "2026-10-15T00:00:00Z",
  revision: versions,
  commentCount: 0,
  key: "readme-glossary",
  targets: Array.from({ length: versions }, (_, index) => ({
    id: `v${index + 1}`,
    repositoryId: "repo-0",
    repo,
    branch: repo === "/test/glossary" ? "glossary" : "main",
    label: `Hand-off ${index + 1}`,
    comparison: { kind: "working" as const, paths: ["README.md"] },
    base: head,
    head: "working",
    captured: true,
  })),
  // The latest version is 5 minutes old, and each one before it 5 more.
  iterations: Array.from({ length: versions }, (_, index) => ({
    number: index + 1,
    createdAt: new Date(Date.now() - (versions - index) * 5 * 60_000).toISOString(),
    targetIds: [`v${index + 1}`],
  })),
});
/** The review's line in its session's thread. */
const handedOff = (updatedAt: number) => ({
  id: "r_kept",
  title: "README glossary",
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt,
});

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const KEYS = [
  "med:workspaces:v1",
  "med:window",
  "med:thread-seen",
  "med:thread-seen-since",
  "med:changes-rail",
];
beforeEach(async () => {
  await page.viewport(1280, 800);
  address = location.pathname + location.search;
  for (const key of KEYS) localStorage.removeItem(key);
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  for (const key of KEYS) localStorage.removeItem(key);
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

/** A host with one repository and its glossary worktree. It lists the
 * threads that the test sets, and records the requests that change them. */
function createHost(initial: Thread[]) {
  let threads = initial;
  const posts: { path: string; body: unknown }[] = [];
  const sessionStreams: string[] = [];
  const reviews: { repo: string; comparison: Comparison }[] = [];
  let keptReview = kept("/test/repo", 0);
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const frame = () =>
    `event: state\ndata: ${JSON.stringify({
      threads,
      repositories: [{ id: "repo-0", name: "tide", path: "/test/repo" }],
      found: { shown: true },
    })}\n\n`;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const repo = url.searchParams.get("repo") || "/test/repo";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (url.pathname === "/api/found" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json({ shown: true, hidden: [] });
    }
    const tab = /^\/api\/threads\/([\w-]+)\/(open|close|delete|base)$/.exec(url.pathname);
    if (tab && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json(
        tab[2] === "close"
          ? { closed: true }
          : tab[2] === "delete"
            ? { deleted: true }
            : tab[2] === "base"
              ? {}
              : { thread: threads.find((thread) => thread.id === tab[1]) },
      );
    }
    const session = /^\/api\/sessions\/([\w-]+)\/events$/.exec(url.pathname);
    if (session) {
      sessionStreams.push(session[1]!);
      const reset = {
        events: [
          {
            at: 1,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "Add a short glossary to the README." },
            },
          },
        ],
        idle: false,
        modifiedAt: Date.now(),
        truncated: false,
      };
      return stream(init, `event: reset\ndata: ${JSON.stringify(reset)}\n\n`);
    }
    const target = /^\/api\/reviews\/(\w+)\/targets\/([\w-]+)\/(review|notes)$/.exec(url.pathname);
    if (target?.[3] === "review") {
      const saved = keptReview.targets.find((entry) => entry.id === target[2])!;
      return Response.json(reviewFor(saved.repo, saved.comparison, `${target[1]}-${target[2]}`));
    }
    if (target?.[3] === "notes")
      return Response.json({ reviewId: `${target[1]}-${target[2]}`, revision: 0, notes: [] });
    if (url.pathname === "/api/reviews/r_kept") return Response.json(keptReview);
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
      case "/api/events":
      case "/api/windows":
        return stream(init);
      case "/api/repositories":
        return Response.json({ repositories });
      case "/api/branches":
        return Response.json(branches);
      case "/api/session":
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: {
            path: repo,
            name: "tide",
            head,
            branch: repo === "/test/glossary" ? "glossary" : "main",
            shallow: false,
            git: true,
          },
          worktrees: repositories[0]!.worktrees,
        });
      case "/api/review": {
        const input = body as { comparison: Comparison; repo: string };
        reviews.push(input);
        return Response.json(reviewFor(input.repo, input.comparison));
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
    }
    // Sessions' inboxes and controls, drift, and the rest: none here.
    return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
  };
  return {
    fetcher,
    posts,
    sessionStreams,
    reviews,
    /** The threads as the host lists them next. */
    setThreads(next: Thread[]) {
      threads = next;
      for (const listener of listeners) listener.enqueue(new TextEncoder().encode(frame()));
    },
    /** The session's review as the host reads it next, such as after a hand-off. */
    setKept: (next: ReturnType<typeof kept>) => {
      keptReview = next;
    },
  };
}

function render(host: ReturnType<typeof createHost>) {
  initializeTheme();
  themeController.commit("graphite-dark");
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const browse = createBrowseApi(host.fetcher, "fixture");
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

/** The review on screen; hidden workspaces stay in the document. */
const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );

test("a found session lists as a thread, and opens on the Changes where it works, beside its session", async () => {
  const host = createHost([found()]);
  render(host);
  const sidebar = page.getByRole("navigation", { name: "Sessions" });
  const row = sidebar.getByRole("button", { name: /^README glossary/ });
  // One row, like any session's: its name, dimmed while its agent works.
  await expect.element(row).toHaveAttribute("aria-busy", "true");

  // It opens on its checkout's live changes, with its session beside them:
  // on a branch, its commits since main and its uncommitted changes.
  await row.click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("glossary");
  await expect.element(row).toHaveAttribute("aria-current", "page");
  const pane = page.getByRole("region", { name: "Claude session" });
  await expect.element(pane.getByText("Add a short glossary to the README.")).toBeVisible();
  expect(host.sessionStreams).toContain(FOUND);
  await expect
    .poll(() => host.reviews.at(-1))
    .toEqual({ repo: "/test/glossary", comparison: { kind: "working", base: "main" } });
  // Until the agent hands off a review, the pages are Changes and Commit.
  const tabs = page.getByRole("radiogroup", { name: "Page" });
  expect(tabs.getByRole("radio", { name: "Review" }).query()).toBeNull();
});

test("Close on a found tab sends it to history, Delete hides its session, and the palette hides all", async () => {
  const codex = found({
    id: "codex-c1",
    title: "Readers in the US want heights in feet",
    agent: "codex",
    state: "idle",
    session: { agent: "codex", id: "c1", cwd: "/test/glossary" },
  });
  const host = createHost([found(), codex]);
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const row = page.getByRole("button", { name: /^Readers in the US/ });
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.element(row).not.toBeInTheDocument();
  expect(host.posts).toEqual([
    { path: "/api/threads/codex-c1/close", body: { removeWorktree: false } },
  ]);

  // Delete asks first; the host hides the session, so it does not come back.
  const glossary = page.getByRole("button", { name: /^README glossary/ });
  await glossary.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Delete “README glossary”?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect.element(glossary).not.toBeInTheDocument();
  expect(host.posts.at(-1)?.path).toBe(`/api/threads/${FOUND}/delete`);

  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("not kept in Med");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.posts.at(-1))
    .toEqual({ path: "/api/found", body: { shown: false } });
});

test("a session on a shared checkout keeps its own files on request, and shows the latest Review that it hands off", async () => {
  // The Changes page's sidebar shows, with the comparison at its top.
  await page.viewport(1800, 800);
  localStorage.setItem("med:changes-rail", "open");
  const thread = found({
    checkout: "/test/repo",
    linked: undefined,
    branch: "main",
    state: "idle",
    session: { ...glossarySession, cwd: "/test/repo" },
    // Another session works in the main checkout too.
    shared: true,
  });
  const host = createHost([thread]);
  render(host);
  await page.getByRole("button", { name: /^README glossary/ }).click();
  await expect.poll(() => location.pathname).toBe(`/review/${FOUND}`);
  await expect
    .element(
      page
        .getByRole("region", { name: "Claude session" })
        .getByText("Add a short glossary to the README."),
    )
    .toBeVisible();
  // No hand-off yet: the thread opens on the live Changes, which on the base
  // branch are the working changes.
  await expect.poll(() => shown()?.dataset.reviewId).toBe("review-/test/repo");
  expect(host.reviews.at(-1)).toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
  const tabs = page.getByRole("radiogroup", { name: "Page" });
  expect(tabs.getByRole("radio", { name: "Review" }).query()).toBeNull();
  await tabs.getByRole("radio", { name: "Changes" }).click();
  const select = page.getByRole("combobox", { name: "Comparison" });
  const choose = async (name: RegExp) => {
    await select.click();
    await page.getByRole("option", { name }).click();
  };

  // The shared checkout's Changes keep only this session's files on request,
  // and the choice stays while the comparison changes.
  const own = { session: { agent: "claude", id: glossarySession.id } };
  await choose(/^Only this session's files, off/);
  await expect.poll(() => host.reviews.at(-1)?.comparison).toEqual({ kind: "working", ...own });
  await expect.element(select).toHaveTextContent("Working changes · this session");
  await choose(/^Staged changes/);
  await expect.poll(() => host.reviews.at(-1)?.comparison).toEqual({ kind: "staged", ...own });
  await choose(/^Only this session's files, on/);
  await expect.poll(() => host.reviews.at(-1)?.comparison).toEqual({ kind: "staged" });

  // The agent hands off a review: it joins the thread, the Review tab comes,
  // and Changes stay.
  host.setKept(kept("/test/repo", 1));
  host.setThreads([{ ...thread, reviews: [handedOff(Date.now())] }]);
  const review = tabs.getByRole("radio", { name: "Review", exact: true });
  await expect.element(review).toBeVisible();
  await expect
    .element(tabs.getByRole("radio", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-checked", "true");
  await review.click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("r_kept-v1");
  // The Review names no version and has no Git comparisons: one checkout
  // leaves nothing to choose.
  const checkout = page.getByRole("combobox", { name: "Review checkout" });
  expect(checkout.query()).toBeNull();
  expect(select.query()).toBeNull();
  expect(document.body.textContent).not.toMatch(/Version \d/);
  // A new hand-off moves the Review to the latest version.
  host.setKept(kept("/test/repo", 2));
  window.dispatchEvent(new CustomEvent("med:review-updated", { detail: { id: "r_kept" } }));
  await expect.poll(() => shown()?.dataset.reviewId).toBe("r_kept-v2");
  await expect.element(review).toHaveAttribute("aria-checked", "true");
  expect(checkout.query()).toBeNull();
  expect(document.body.textContent).not.toMatch(/Version \d/);
  // Changes keep the Git comparisons.
  await tabs.getByRole("radio", { name: "Changes", exact: true }).click();
  await select.click();
  await expect.element(page.getByRole("option", { name: /^Working changes/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
});

test("a thread's Comparison menu keeps a base for its Changes, and the agent's move leaves the thread's view", async () => {
  // The Changes page's sidebar shows, with the comparison at its top, and
  // the session has room for its rail.
  await page.viewport(2600, 800);
  localStorage.setItem("med:changes-rail", "open");
  const thread = found({ state: "idle" });
  const host = createHost([thread]);
  // The base branch menu reads the branches with the page's own fetch.
  const pageFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) =>
    String(input).includes("/api/git/targets")
      ? Response.json({
          branch: "glossary",
          head,
          refs: ["main", "glossary", "stable"].map((name) => ({
            name: `refs/heads/${name}`,
            label: name,
          })),
          remotes: [],
        })
      : pageFetch(input, init);
  try {
    render(host);
    await page.getByRole("button", { name: /^README glossary/ }).click();
    await expect
      .poll(() => host.reviews.at(-1))
      .toEqual({ repo: "/test/glossary", comparison: { kind: "working", base: "main" } });
    await expect.element(page.getByRole("region", { name: "Claude session" })).toBeVisible();
    // The thread keeps its layout from the test before, with Changes open;
    // clicked again, the page would hide it.
    const changes = page.getByRole("radio", { name: "Changes" });
    if (changes.element().getAttribute("aria-checked") !== "true") await changes.click();
    const select = page.getByRole("combobox", { name: "Comparison" });
    await expect.element(select).toHaveTextContent("glossary since main");
    // A thread follows its session: the menu offers no checkout to move to.
    await select.click();
    expect(page.getByRole("option", { name: /^Thread checkout…/ }).query()).toBeNull();
    await page.getByRole("option", { name: /^Base branch…/ }).click();
    await page.getByRole("menuitem", { name: "stable" }).click();
    // The thread keeps the base, and its Changes keep the uncommitted ones.
    await expect
      .poll(() => host.posts.at(-1))
      .toEqual({ path: `/api/threads/${FOUND}/base`, body: { base: "stable" } });
    await expect
      .poll(() => host.reviews.at(-1))
      .toEqual({ repo: "/test/glossary", comparison: { kind: "working", base: "stable" } });
    await expect.element(select).toHaveTextContent("glossary since stable");
    // The repository's usual base is not kept.
    await select.click();
    await page.getByRole("option", { name: /^Base branch…/ }).click();
    await page.getByRole("menuitem", { name: "main" }).click();
    await expect
      .poll(() => host.posts.at(-1))
      .toEqual({ path: `/api/threads/${FOUND}/base`, body: { base: null } });
    await expect.element(select).toHaveTextContent("glossary since main");

    // The agent moves to the main checkout. The rail says where it works
    // now; what the thread shows stays, and Med reads no other checkout.
    const asked = host.reviews.length;
    host.setThreads([{ ...thread, checkout: "/test/repo", linked: undefined, branch: "main" }]);
    await expect.element(page.getByRole("region", { name: "Agent" })).toMatchTextContent("main");
    await expect
      .element(page.getByRole("region", { name: "Thread" }))
      .toMatchTextContent("glossary");
    await expect.element(select).toHaveTextContent("glossary since main");
    // A move of the view would read the agent's checkout a moment later.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(host.reviews.slice(asked).map((request) => request.repo)).not.toContain("/test/repo");
    await expect.element(select).toHaveTextContent("glossary since main");
    // The agent's branch is one click away.
    await page
      .getByRole("region", { name: "Agent" })
      .getByRole("button", { name: "main. Show the agent's branch" })
      .click();
    await expect
      .poll(() => host.reviews.at(-1))
      .toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
    await expect.element(select).toHaveTextContent("Working changes");
    expect(location.pathname).toBe(`/review/${FOUND}`);
  } finally {
    globalThis.fetch = pageFetch;
  }
});
