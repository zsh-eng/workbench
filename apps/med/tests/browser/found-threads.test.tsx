import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { SavedCheckout } from "../../src/shared/saved-review";
import type { Thread } from "../../src/shared/threads";
import type { RunningSession } from "../../src/shared/found-sessions";
import { initializeTheme, themeController } from "../../src/web/themes";

// Sessions that Med found by itself (src/host/found-sessions.ts) list as
// threads; one opens as a workspace on its checkout, with its session.

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
const found = (patch: Partial<Thread> = {}): Thread => ({
  id: `found-claude-${glossarySession.id}`,
  title: "README glossary",
  createdAt: "2026-10-15T00:00:00Z",
  updatedAt: Date.now() - 20_000,
  repository: { id: "repo-0", name: "tide", path: "/test/repo" },
  checkout: "/test/glossary",
  linked: true,
  branch: "glossary",
  agent: "claude",
  state: "working",
  sessions: [glossarySession],
  changes: { files: 1, additions: 6, deletions: 0 },
  found: true,
  ...patch,
});
/** A kept thread: it captured nothing, so it names only its checkout. Each
 * version is one comparison that the agent handed off. */
const kept = (id: string, title: string, repo = "/test/glossary", versions = 0) => ({
  id,
  title,
  sessions: [{ ...glossarySession, cwd: repo }],
  createdAt: "2026-10-15T00:00:00Z",
  revision: versions,
  commentCount: 0,
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
  ...(versions
    ? {
        key: "readme-glossary",
        // The latest version is 5 minutes old, and each one before it 5 more.
        iterations: Array.from({ length: versions }, (_, index) => ({
          number: index + 1,
          createdAt: new Date(Date.now() - (versions - index) * 5 * 60_000).toISOString(),
          targetIds: [`v${index + 1}`],
        })),
      }
    : {}),
  checkout: {
    repositoryId: "repo-0",
    repo,
    branch: repo === "/test/glossary" ? "glossary" : "main",
  },
});

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const KEYS = ["med:workspaces:v1", "med:window", "med:thread-seen", "med:thread-seen-since"];
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
function createHost(threads: Thread[], running: RunningSession[] = []) {
  const posts: { path: string; body: unknown }[] = [];
  const sessionStreams: string[] = [];
  const reviews: { repo: string; comparison: Comparison }[] = [];
  let keptReview: ReturnType<typeof kept> = kept("r_kept", "README glossary");
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const repo = url.searchParams.get("repo") || "/test/repo";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (url.pathname === "/api/found" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json({ shown: true, hidden: [] });
    }
    if (url.pathname === "/api/sessions/adopt" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json({
        id: "r_kept",
        title: "README glossary",
        created: true,
        session: {
          ...glossarySession,
          title: "README glossary",
          path: "/test/transcript.jsonl",
          createdAt: "2026-10-15T00:00:00Z",
          updatedAt: "2026-10-15T00:00:00Z",
        },
      });
    }
    const tab = /^\/api\/threads\/([\w-]+)\/(open|close|delete)$/.exec(url.pathname);
    if (tab && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json(
        tab[2] === "close"
          ? { closed: true }
          : tab[2] === "delete"
            ? { deleted: true }
            : { thread: threads.find((thread) => thread.id === tab[1]) },
      );
    }
    const session = /^\/api\/reviews\/([\w-]+)\/sessions\/([\w-]+)\/events$/.exec(url.pathname);
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
    if (url.pathname === "/api/reviews/r_kept/details" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      const { checkout } = body as { checkout: SavedCheckout & { branch: string } };
      keptReview = { ...keptReview, checkout };
      return Response.json(keptReview);
    }
    switch (url.pathname) {
      case "/api/sessions/running":
        return Response.json({ sessions: running });
      case "/api/threads/events":
        return stream(
          init,
          `event: state\ndata: ${JSON.stringify({
            threads,
            repositories: [{ id: "repo-0", name: "tide", path: "/test/repo" }],
            found: { shown: true },
          })}\n\n`,
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
    /** The kept thread as the host reads it next, such as after a hand-off. */
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

test("a found session lists as a thread, opens on its checkout with its session, and Keep in Med saves it", async () => {
  const host = createHost([found()]);
  render(host);
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  const row = sidebar.getByRole("button", { name: /^README glossary/ });
  // Among its repository's threads, with its agent's state.
  await expect.element(sidebar.getByRole("region", { name: "tide" })).toBeVisible();
  await expect.element(row).toHaveAccessibleName(/README glossary.*working/);
  await expect.element(sidebar.getByText("+6")).toBeVisible();

  // It opens on its checkout's live changes, with its session beside them.
  await row.click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("glossary");
  await expect.element(row).toHaveAttribute("aria-current", "page");
  const pane = page.getByRole("region", { name: "Claude session" });
  await expect.element(pane.getByText("Add a short glossary to the README.")).toBeVisible();
  expect(host.sessionStreams).toContain(`found-claude-${glossarySession.id}`);
  // No saved review to read: the session has no message box, only where it runs.
  expect(host.sessionStreams.every((id) => id.startsWith("found-"))).toBe(true);
  const bar = page.getByRole("group", { name: "Runs in Claude Code" });
  await expect.element(bar.getByText(`claude --resume ${glossarySession.id}`)).toBeVisible();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await bar.getByRole("button", { name: "Copy Claude Code resume command" }).click();
  expect(copy).toHaveBeenCalledWith(`cd '/test/glossary' && claude --resume ${glossarySession.id}`);
  await expect.element(bar.getByText("Copied")).toBeVisible();
  copy.mockRestore();

  // Keep in Med adopts the session on its checkout and captures nothing. The
  // saved thread takes the workspace's place and shows the live Changes: on
  // a branch, its commits since main and its uncommitted changes.
  await bar.getByRole("button", { name: "Keep in Med" }).click();
  await expect.poll(() => location.pathname).toBe("/review/r_kept");
  expect(host.posts).toEqual([
    {
      path: "/api/sessions/adopt",
      body: { session: glossarySession.id, repo: "/test/glossary", title: "README glossary" },
    },
  ]);
  await expect.poll(() => shown()?.dataset.reviewId).toBe("review-/test/glossary");
  expect(host.reviews.at(-1)).toEqual({
    repo: "/test/glossary",
    comparison: { kind: "working", base: "main" },
  });
  // Until the agent shows a Review, the tabs are Changes and Commit.
  const tabs = page.getByRole("tablist", { name: "Open files" });
  await expect
    .element(tabs.getByRole("tab", { name: "Changes" }))
    .toHaveAttribute("aria-selected", "true");
  expect(tabs.getByRole("tab", { name: "Review" }).query()).toBeNull();
  expect(document.body.textContent).not.toContain("Return to review");
});

test("Running now lists the agent sessions that run, in Med or elsewhere: one with a thread opens it, and Keep in Med makes one a thread", async () => {
  const host = createHost(
    [found()],
    [
      {
        agent: "claude",
        id: glossarySession.id,
        title: "README glossary",
        cwd: "/test/glossary",
        place: "med",
        thread: found().id,
      },
      {
        agent: "codex",
        id: "01a189b0-0000-7000-8000-000000000001",
        title: "Port the tide parser",
        cwd: "/test/repo",
        place: "other-app",
      },
    ],
  );
  render(host);
  const running = page
    .getByRole("navigation", { name: "Threads" })
    .getByRole("region", { name: "Running now" });
  await expect.element(running.getByText("2")).toBeVisible();
  // One that a thread has opens it.
  await running.getByRole("button", { name: /README glossary/ }).click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("glossary");
  // Codex in its app: one click keeps it in Med, as a thread.
  const codex = running.getByRole("button", { name: /Port the tide parser/ });
  await expect.element(running.getByText("Keep in Med")).toBeVisible();
  await codex.click();
  await expect.poll(() => location.pathname).toBe("/review/r_kept");
  expect(host.posts).toEqual([
    {
      path: "/api/sessions/adopt",
      body: { session: "01a189b0-0000-7000-8000-000000000001", title: "Port the tide parser" },
    },
  ]);
});

test("Close on a found tab sends it to history, Delete hides its session, and the palette hides all", async () => {
  const codex = found({
    id: "found-codex-c1",
    title: "Readers in the US want heights in feet",
    agent: "codex",
    state: "idle",
    sessions: [{ agent: "codex", id: "c1", cwd: "/test/glossary" }],
  });
  const host = createHost([found(), codex]);
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const row = page.getByRole("button", { name: /^Readers in the US/ });
  await row.click({ button: "right" });
  // A found thread has no worktree of Med's to remove.
  expect(document.body.textContent).not.toContain("Close and remove worktree");
  await page.getByRole("menuitem", { name: /^Close tab/ }).click();
  await expect.element(row).not.toBeInTheDocument();
  await expect
    .element(page.getByText("Closed “Readers in the US want heights in feet”."))
    .toBeVisible();
  expect(host.posts).toEqual([
    { path: "/api/threads/found-codex-c1/close", body: { removeWorktree: false } },
  ]);

  // Delete asks first; the host hides the session, so it does not come back.
  const glossary = page.getByRole("button", { name: /^README glossary/ });
  await glossary.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Delete “README glossary”?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect.element(glossary).not.toBeInTheDocument();
  expect(host.posts.at(-1)?.path).toMatch(/^\/api\/threads\/found-claude-[\w-]+\/delete$/);

  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("not kept in Med");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.posts.at(-1))
    .toEqual({ path: "/api/found", body: { shown: false } });
});

test("a kept thread on a shared checkout shows its Changes, keeps its session's files on request, and shows each Review version that its agent hands off", async () => {
  const thread: Thread = {
    id: "r_kept",
    title: "README glossary",
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: Date.now() - 20_000,
    repository: { id: "repo-0", name: "tide", path: "/test/repo" },
    checkout: "/test/repo",
    branch: "main",
    agent: "claude",
    state: "idle",
    sessions: [{ ...glossarySession, cwd: "/test/repo" }],
    // Another session works in the main checkout too.
    shared: true,
  };
  const host = createHost([thread]);
  host.setKept(kept("r_kept", "README glossary", "/test/repo"));
  render(host);
  await page.getByRole("button", { name: /^README glossary/ }).click();
  await expect.poll(() => location.pathname).toBe("/review/r_kept");
  // The main checkout's workspace shows the same working changes, and stays
  // on screen until the thread is ready to take its place.
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
  const tabs = page.getByRole("tablist", { name: "Open files" });
  expect(tabs.getByRole("tab", { name: "Review" }).query()).toBeNull();
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

  // The agent hands off a Review: the Review tab comes, and Changes stay.
  host.setKept(kept("r_kept", "README glossary", "/test/repo", 1));
  window.dispatchEvent(new CustomEvent("med:review-updated", { detail: { id: "r_kept" } }));
  const review = tabs.getByRole("tab", { name: "Review", exact: true });
  await expect.element(review).toBeVisible();
  await expect
    .element(tabs.getByRole("tab", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await review.click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("r_kept-v1");
  // One version: its number and age as text. Review has no Git comparisons.
  await expect.element(page.getByText(/^Version 1 · [45] min ago$/)).toBeVisible();
  const version = page.getByRole("combobox", { name: "Review version" });
  expect(version.query()).toBeNull();
  expect(select.query()).toBeNull();
  // A new version moves the Review that shows the latest one, and the row
  // lists the versions, newest first.
  host.setKept(kept("r_kept", "README glossary", "/test/repo", 2));
  window.dispatchEvent(new CustomEvent("med:review-updated", { detail: { id: "r_kept" } }));
  await expect.poll(() => shown()?.dataset.reviewId).toBe("r_kept-v2");
  await expect.poll(() => version.query()?.textContent).toMatch(/^Version 2 · [45] min ago$/);
  await expect.element(review).toHaveAttribute("aria-selected", "true");
  await version.click();
  const options = page.getByRole("option");
  await expect.poll(() => options.elements().length).toBe(2);
  const [latest, first] = options.elements().map((option) => option.textContent ?? "");
  expect(latest).toMatch(/^Version 2 · [45] min ago/);
  expect(first).toMatch(/^Version 1 · (9|10) min ago/);
  expect(`${latest}${first}`).not.toMatch(/changes/i);
  await userEvent.keyboard("{Escape}");
  // Changes keep the Git comparisons.
  await tabs.getByRole("tab", { name: "Changes", exact: true }).click();
  await select.click();
  await expect.element(page.getByRole("option", { name: /^Working changes/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
});

test("a thread's Comparison menu keeps a base for its Changes and moves the thread to another checkout", async () => {
  const thread: Thread = {
    id: "r_kept",
    title: "README glossary",
    createdAt: "2026-10-15T00:00:00Z",
    updatedAt: Date.now() - 20_000,
    repository: { id: "repo-0", name: "tide", path: "/test/repo" },
    checkout: "/test/glossary",
    linked: true,
    branch: "glossary",
    agent: "claude",
    state: "idle",
    sessions: [glossarySession],
  };
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
    // The control names the checkout's branch and its base.
    const select = page.getByRole("combobox", { name: "Comparison" });
    await expect.element(select).toHaveTextContent("glossary since main");
    await select.click();
    await expect
      .element(page.getByRole("option", { name: /^Thread checkout…/ }))
      .toHaveTextContent("Thread checkout…glossary");
    await page.getByRole("option", { name: /^Base branch…/ }).click();
    await page.getByRole("menuitem", { name: "stable" }).click();
    // The thread keeps the base, and its Changes keep the uncommitted ones.
    const checkout = { repositoryId: "repo-0", repo: "/test/glossary", branch: "glossary" };
    await expect
      .poll(() => host.posts.at(-1))
      .toEqual({
        path: "/api/reviews/r_kept/details",
        body: { checkout: { ...checkout, base: "stable" } },
      });
    await expect
      .poll(() => host.reviews.at(-1))
      .toEqual({ repo: "/test/glossary", comparison: { kind: "working", base: "stable" } });
    await expect.element(select).toHaveTextContent("glossary since stable");
    // The repository's usual base is not saved.
    await select.click();
    await page.getByRole("option", { name: /^Base branch…/ }).click();
    await page.getByRole("menuitem", { name: "main" }).click();
    await expect
      .poll(() => host.posts.at(-1))
      .toEqual({ path: "/api/reviews/r_kept/details", body: { checkout } });
    await expect.element(select).toHaveTextContent("glossary since main");

    // Thread checkout… is ⌘⇧G in a thread: ↵ moves the thread, and its
    // Changes show the new checkout.
    await select.click();
    await page.getByRole("option", { name: /^Thread checkout…/ }).click();
    await expect.element(page.getByRole("dialog", { name: "Thread checkout" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search branches" }).fill("main");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(() => host.posts.at(-1))
      .toEqual({
        path: "/api/reviews/r_kept/details",
        body: { checkout: { repositoryId: "repo-0", repo: "/test/repo", branch: "main" } },
      });
    await expect
      .poll(() => host.reviews.at(-1))
      .toEqual({ repo: "/test/repo", comparison: { kind: "working" } });
    await expect.element(page.getByText("This thread shows main now.")).toBeVisible();
    await expect.element(select).toHaveTextContent("Working changes");
    expect(location.pathname).toBe("/review/r_kept");
  } finally {
    globalThis.fetch = pageFetch;
  }
});
