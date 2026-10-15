import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
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
const saved = (id: string, title: string) => ({
  id,
  title,
  sessions: [glossarySession],
  createdAt: "2026-10-15T00:00:00Z",
  revision: 0,
  commentCount: 0,
  targets: [
    {
      id: `${id}-target`,
      repositoryId: "repo-0",
      repo: "/test/glossary",
      branch: "glossary",
      label: "Captured",
      comparison: { kind: "working" },
      base: head,
      head: "working",
      captured: true,
    },
  ],
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
function createHost(threads: Thread[]) {
  const posts: { path: string; body: unknown }[] = [];
  const sessionStreams: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const repo = url.searchParams.get("repo") || "/test/repo";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (url.pathname === "/api/found" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json({ shown: true, hidden: [] });
    }
    if (url.pathname === "/api/reviews" && init?.method === "POST") {
      posts.push({ path: url.pathname, body });
      return Response.json(saved("r_kept", "README glossary"));
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
    const target = /^\/api\/reviews\/(\w+)\/targets\/[\w-]+\/(review|notes)$/.exec(url.pathname);
    if (target?.[2] === "review")
      return Response.json(reviewFor("/test/glossary", { kind: "working" }, `${target[1]}-t`));
    if (target?.[2] === "notes")
      return Response.json({ reviewId: `${target[1]}-t`, revision: 0, notes: [] });
    if (url.pathname === "/api/reviews/r_kept")
      return Response.json(saved("r_kept", "README glossary"));
    switch (url.pathname) {
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
  return { fetcher, posts, sessionStreams };
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

  // Keep in Med saves the checkout's working changes with the session, and
  // the saved thread takes the workspace's place.
  await bar.getByRole("button", { name: "Keep in Med" }).click();
  await expect.poll(() => location.pathname).toBe("/review/r_kept");
  expect(host.posts).toEqual([
    {
      path: "/api/reviews",
      body: {
        title: "README glossary",
        key: `readme-glossary-${glossarySession.id.slice(0, 8)}`,
        sessions: [glossarySession],
        targets: [{ repo: "/test/glossary", comparison: { kind: "working" } }],
      },
    },
  ]);
  await expect.poll(() => shown()?.dataset.reviewId).toBe("r_kept-t");
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
