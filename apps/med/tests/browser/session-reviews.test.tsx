import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import type { ReviewGuide } from "../../src/shared/review-guide";
import { initializeTheme, themeController } from "../../src/web/themes";

// A session that handed off two reviews is one thread: its rail's Reviews
// card shows each in the thread's workspace, and the session stays on screen.
// The host is a fake.

const head = "a".repeat(40);
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "tide",
    branches: [{ name: "main", head, worktreePath: "/test/repo", current: true }],
    worktrees: [{ path: "/test/repo", head, branch: "main" }],
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
const reviewFor = (comparison: Comparison, id: string) => ({
  id,
  repo: "/test/repo",
  comparison,
  base: head,
  head: "working",
  label: "Working changes",
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
/** A saved review that the session handed off, with its Guide. */
const savedReview = (id: string) => ({
  id,
  title: id === "rev-b" ? "Month view" : "Week view",
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
  session,
  targets: [
    {
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

function createHost(threads: Thread[]) {
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const frame = () =>
    `event: state\ndata: ${JSON.stringify({ threads, repositories: [tide] })}\n\n`;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
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
      return Response.json(reviewFor({ kind: "working" }, `${target[1]}-target`));
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
        return Response.json(repositories[0]!.branches);
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
      case "/api/session":
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: {
            path: "/test/repo",
            name: "tide",
            head,
            branch: "main",
            shallow: false,
            git: true,
          },
          worktrees: repositories[0]!.worktrees,
        });
      case "/api/review":
        return Response.json(
          reviewFor((body as { comparison: Comparison }).comparison, "live-changes"),
        );
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
    // Owned sessions, turns, and the rest: none here.
    return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
  };
  return { fetcher };
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
