import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

const head = "a".repeat(40);
const branches = [
  { name: "main", head, worktreePath: "/test/repo", current: true },
  { name: "feature", head, worktreePath: "/test/feature", current: false },
];
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "fixture",
    branches,
    worktrees: branches.map((branch, index) => ({
      path: branch.worktreePath,
      head,
      branch: branch.name,
      ...(index ? { linked: true } : {}),
    })),
  },
];
const changed = (repo: string) =>
  repo === "/test/feature" ? ["feature.ts"] : ["alpha.ts", "beta.ts"];
const patchFor = (repo: string) =>
  changed(repo)
    .map(
      (path) =>
        `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
    )
    .join("");

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const STORAGE_KEY = "med:workspaces:v1";
const WINDOW_KEY = "med:window";

beforeEach(async () => {
  // Wide enough for the sidebar beside the workspace.
  await page.viewport(1280, 800);
  address = location.pathname + location.search;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(WINDOW_KEY);
  localStorage.removeItem("med:zen");
  for (const key of ["med:thread-seen", "med:thread-seen-since", "med:new-thread", "med:sidebar"])
    localStorage.removeItem(key);
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(WINDOW_KEY);
  localStorage.removeItem("med:chrome:v1");
  // Workspaces move the address; the test page keeps its own.
  history.replaceState(null, "", address);
});

const reviewFor = (repo: string, comparison: Comparison, id = `review-${repo}`) => {
  const patch = patchFor(repo);
  return {
    id,
    repo,
    comparison,
    base: head,
    head: "working",
    label: "Working changes",
    files: changed(repo).map((path) => ({
      path: `src/${path}`,
      status: "M",
      additions: 1,
      deletions: 1,
      binary: false,
    })),
    patch,
    warnings: [],
    metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
  };
};
/** Saved reviews that an agent can announce, each of the main worktree. */
const savedTitles: Record<string, string> = {
  agent: "Agent review",
  second: "Second review",
  talk: "Talk review",
  third: "Third review",
  fourth: "Fourth review",
  fifth: "Fifth review",
  older: "Older review",
};
/** The agent session of the "talk" thread. */
const talkSession = { agent: "claude" as const, id: "talk-session", cwd: "/test/repo" };
const savedReview = (id: string) => ({
  id,
  title: savedTitles[id],
  ...(id === "talk" ? { sessions: [talkSession] } : {}),
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
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
});

/** A review host with one repository, two branch worktrees, and a vault. It
 * counts session loads and the live-update streams that are open, and
 * announces saved reviews on the window channel. */
function createHost() {
  const sessions: string[] = [];
  const streams = new Set<string>();
  const windows = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const announce = (review: {
    id: string;
    open: boolean;
    sessions?: { agent: "claude" | "codex"; id: string; cwd: string }[];
  }) => {
    const data = { type: "review", title: savedTitles[review.id], ...review };
    const chunk = new TextEncoder().encode(`event: review\ndata: ${JSON.stringify(data)}\n\n`);
    for (const window of windows) window.enqueue(chunk);
  };
  // The threads that the host lists, and the requests that change them.
  let threads: Thread[] = [];
  let threadRepositories = [{ id: "repo-0", name: "fixture", path: "/test/repo" }];
  const threadStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const threadFrame = () =>
    new TextEncoder().encode(
      `event: state\ndata: ${JSON.stringify({ threads, repositories: threadRepositories })}\n\n`,
    );
  const setThreads = (next: Thread[], repositories = threadRepositories) => {
    threads = next;
    threadRepositories = repositories;
    for (const stream of threadStreams) stream.enqueue(threadFrame());
  };
  const threadRequests: { path: string; body: unknown }[] = [];
  const answers: { path: string; body: unknown }[] = [];
  // The pull request jobs that the host runs; the test moves the latest one.
  const pulls: { id: string; url: string }[] = [];
  let pullJob: Record<string, unknown> = {};
  const pullStreams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const pullFrame = () =>
    new TextEncoder().encode(`event: state\ndata: ${JSON.stringify(pullJob)}\n\n`);
  const setPull = (patch: Record<string, unknown>) => {
    pullJob = { ...pullJob, ...patch };
    for (const stream of pullStreams) stream.enqueue(pullFrame());
  };
  // Worktrees that the host was asked to remove; Git keeps the first one.
  const removals: string[] = [];
  // Each request's path, in order.
  const requested: string[] = [];
  // Each text search: the checkout it read, and the text.
  const searches: string[] = [];
  // The talk thread's session sends its first view when the test releases it.
  let releaseSession!: () => void;
  const sessionHeld = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    requested.push(url.pathname);
    const repo = url.searchParams.get("repo") || "/test/repo";
    if (url.pathname === "/api/worktrees/remove") {
      removals.push(JSON.parse(String(init?.body)).path);
      return removals.length === 1
        ? Response.json(
            {
              error: {
                code: "worktree-changed",
                message:
                  "It has changed or untracked files. Commit or discard them, then try again.",
              },
            },
            { status: 409 },
          )
        : Response.json({ removed: true });
    }
    if (url.pathname === "/api/threads" && init?.method === "POST") {
      threadRequests.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return Response.json({ review: savedReview("agent") });
    }
    const archive = /^\/api\/threads\/(\w+)\/archive$/.exec(url.pathname);
    if (archive) {
      const body = JSON.parse(String(init?.body)) as { archived: boolean };
      threadRequests.push({ path: url.pathname, body });
      return Response.json({ review: savedReview(archive[1]!) });
    }
    if (url.pathname === "/api/pulls") {
      const id = `job-${pulls.length + 1}`;
      pulls.push({ id, url: JSON.parse(String(init?.body)).url });
      pullJob = {
        id,
        url: pulls.at(-1)!.url,
        slug: "acme/trails",
        number: 7,
        status: "running",
        steps: [{ id: "repository", label: "Find acme/trails", state: "running" }],
      };
      return Response.json(pullJob);
    }
    if (url.pathname === `/api/pulls/${String(pullJob.id)}/events`) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          pullStreams.add(controller);
          controller.enqueue(pullFrame());
          init?.signal?.addEventListener("abort", () => {
            pullStreams.delete(controller);
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    if (url.pathname === `/api/reviews/talk/sessions/${talkSession.id}/events`) {
      const reset = {
        events: [
          {
            at: 1,
            update: {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "Rename the export." },
            },
          },
          {
            at: 2,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Renamed **alpha**." },
            },
          },
        ],
        idle: true,
        modifiedAt: 0,
        truncated: false,
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          void sessionHeld.then(() =>
            controller.enqueue(
              new TextEncoder().encode(`event: reset\ndata: ${JSON.stringify(reset)}\n\n`),
            ),
          );
          init?.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("Aborted", "AbortError")),
          );
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    // A session's thread, inbox, and controls: none here, except an answer.
    const sessionRoute = /^\/api\/reviews\/\w+\/(sessions|owned|agent)\b/.exec(url.pathname);
    if (sessionRoute?.[1] === "owned" && init?.method === "POST") {
      answers.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return Response.json({
        sessionId: "agent-s",
        preset: "opencode",
        name: "OpenCode",
        status: "working",
        settings: [],
        commands: [],
        turns: 1,
      });
    }
    if (sessionRoute)
      return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
    const saved = /^\/api\/reviews\/(\w+)(?:\/targets\/[\w-]+\/(review|notes))?$/.exec(
      url.pathname,
    );
    if (saved?.[2] === "review")
      return Response.json(reviewFor("/test/repo", { kind: "working" }, `${saved[1]}-target`));
    if (saved?.[2] === "notes")
      return Response.json({ reviewId: `${saved[1]}-target`, revision: 0, notes: [] });
    if (saved) return Response.json(savedReview(saved[1]!));
    switch (url.pathname) {
      case "/api/service/status":
        return Response.json({
          service: "med",
          sources: [{ id: "vault-0", name: "notes", kind: "vault", path: "/test/notes" }],
        });
      case "/api/service/files":
        return Response.json({ files: [{ path: "Plans/Ages.md" }, { path: "Plans/diagram.png" }] });
      case "/api/repositories":
        return Response.json({ repositories });
      case "/api/session":
        sessions.push(repo);
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: {
            path: repo,
            name: "fixture",
            head,
            branch: repo === "/test/feature" ? "feature" : "main",
            shallow: false,
            git: true,
          },
          worktrees: repositories[0]!.worktrees,
        });
      case "/api/branches":
        return Response.json(branches);
      case "/api/agents":
        return Response.json({
          agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
        });
      case "/api/agents/claude/choices":
        return Response.json({
          model: {
            id: "model",
            name: "Model",
            category: "model",
            value: "opus",
            options: [
              { value: "default", name: "Default (recommended)" },
              { value: "opus", name: "Opus 5.5" },
              { value: "haiku", name: "Haiku 4.5" },
            ],
          },
          effort: {
            id: "effort",
            name: "Effort",
            category: "effort",
            value: "medium",
            options: ["default", "low", "medium", "high"].map((value) => ({
              value,
              name: value,
            })),
          },
          efforts: { default: ["low", "high"], opus: ["low", "medium", "high"], haiku: [] },
        });
      case "/api/review": {
        const body = JSON.parse(String(init?.body)) as { comparison: Comparison; repo: string };
        return Response.json(reviewFor(body.repo, body.comparison));
      }
      case "/api/notes":
        return Response.json({
          reviewId: url.searchParams.get("reviewId"),
          revision: 0,
          notes: [],
        });
      case "/api/events": {
        // Stays open until the controller aborts it, as the real stream does.
        const key = `${repo}#${Math.random()}`;
        streams.add(key);
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              streams.delete(key);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      case "/api/threads/events": {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            threadStreams.add(controller);
            controller.enqueue(threadFrame());
            init?.signal?.addEventListener("abort", () => {
              threadStreams.delete(controller);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      case "/api/windows": {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            windows.add(controller);
            init?.signal?.addEventListener("abort", () => {
              windows.delete(controller);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      case "/api/browse/list":
        return Response.json({
          source: JSON.parse(String(init?.body)).source,
          entries: [],
          truncated: false,
        });
      case "/api/browse/search": {
        const { source, query } = JSON.parse(String(init?.body));
        searches.push(`${source.repo} ${query}`);
        const text = "export const after = 2;";
        return Response.json({
          source,
          query,
          matches: text.toLowerCase().includes(query.toLowerCase())
            ? [
                {
                  path: source.repo === "/test/other" ? "lib/other.ts" : "src/alpha.ts",
                  line: 1,
                  text,
                },
              ]
            : [],
          truncated: false,
          resultSource: { kind: "commit", repo: source.repo, oid: head },
          engine: "zoekt",
        });
      }
      case "/api/browse/read": {
        const { source, path } = JSON.parse(String(init?.body));
        return Response.json({
          source,
          path,
          kind: "text",
          size: 24,
          identity: `${source.repo}:${path}`,
          text: "export const after = 2;\n",
        });
      }
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  return {
    fetcher,
    sessions,
    streams,
    windows,
    announce,
    setThreads,
    threadRequests,
    requested,
    searches,
    answers,
    pulls,
    setPull,
    removals,
    releaseSession,
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
        {(controller) => <App controller={controller} browseApi={browse} />}
      </WorkspaceViews>
    </WorkspaceHost>,
  );
}

/** The review on screen; hidden workspaces stay in the document. */
const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
/** Each thread row's name, with its state, and whether it is the one shown. */
const threadRows = () =>
  [...document.querySelectorAll<HTMLElement>("[data-thread]")].map((row) =>
    [
      row.children[1]?.firstElementChild?.firstElementChild?.textContent,
      row.lastElementChild?.textContent,
      row.getAttribute("aria-current") && "(current)",
    ]
      .filter(Boolean)
      .join(""),
  );
const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: savedTitles[id] ?? id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: Date.now() - 60_000,
  repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
  checkout: "/test/repo",
  branch: "main",
  ...patch,
});

test("keeps branch workspaces live, switches by shortcut, and restores them", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const mainView = shown();
  const mainDiffs = () => [...mainView!.querySelectorAll("diffs-container")];
  await expect.poll(() => mainDiffs().length).toBe(2);
  const renderedDiffs = mainDiffs();

  // ⌘↵ in the branch picker (⌘⇧G) opens the branch as a new workspace.
  await userEvent.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
  await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The new branch loads once, at its worktree.
  expect(host.sessions.filter((repo) => repo === "/test/feature")).toHaveLength(1);
  expect(host.sessions).toHaveLength(2);
  // Both reviews stay mounted; only the one on screen listens for changes.
  expect(document.querySelectorAll("[data-review-status]")).toHaveLength(2);
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/feature"]);

  // A tap of ⌃Tab shows the previous workspace. The same review returns, not a
  // reload; it catches up on changes it missed and listens again.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  expect(shown()).toBe(mainView);
  // Its diffs stay rendered while hidden; showing it does not build them again.
  expect(mainDiffs().map((element, index) => element === renderedDiffs[index])).toEqual([
    true,
    true,
  ]);
  // Files still open after the review was hidden and shown again.
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("");
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/repo"]);

  // Another tap returns.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  expect(history.state).toMatchObject({ workspace: expect.any(String) });

  // A new page restores the workspaces and opens the active branch directly.
  root!.unmount();
  mount!.remove();
  const next = createHost();
  render(next);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  expect(next.sessions).toEqual(["/test/feature"]);

  // Closing the active workspace shows the most recent other one.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Close workspace");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  expect(document.querySelectorAll("[data-review-status]")).toHaveLength(1);
});

test("a thread in view loads out of sight, and its first visit shows that slot", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("agent", { agent: "claude", state: "idle", updatedAt: Date.now() })]);
  // Before any click, the thread loads in a slot of its own, out of sight.
  const slot = () => document.querySelector<HTMLElement>('[data-workspace-slot="review-agent"]');
  await expect
    .poll(() => slot()?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus)
    .toBe("ready");
  const ahead = slot()!;
  expect(
    ahead.querySelector("[data-review-status]")!.checkVisibility({ visibilityProperty: true }),
  ).toBe(false);
  expect(shown()?.dataset.reviewId).not.toBe("agent-target");

  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  // The click shows that slot; nothing reads the review again.
  expect(slot()).toBe(ahead);
  expect(host.requested.filter((path) => path === "/api/reviews/agent")).toHaveLength(1);
});

test("every thread in view loads out of sight and stays, as open tabs do, and ⌘5 shows its slot", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const inView = ["agent", "second", "third", "fourth", "fifth"];
  host.setThreads([
    ...inView.map((id, index) => thread(id, { updatedAt: Date.now() - (index + 1) * 60_000 })),
    // Quiet for five days: it folds into the older threads and does not load.
    thread("older", { updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000 }),
  ]);
  const slot = (id: string) =>
    document.querySelector<HTMLElement>(`[data-workspace-slot="review-${id}"]`);
  // More threads than the three that loaded ahead before.
  for (const id of inView)
    await expect
      .poll(
        () => slot(id)?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus,
      )
      .toBe("ready");
  expect(slot("older")).toBeNull();

  const ahead = slot("fifth");
  await userEvent.keyboard("{Control>}5{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("fifth-target");
  expect(slot("fifth")).toBe(ahead);
  expect(host.requested.filter((path) => path === "/api/reviews/fifth")).toHaveLength(1);
  // The others stay loaded.
  for (const id of inView) expect(slot(id)).not.toBeNull();
});

test("a thread with its session on screen shows its session first, and its diff after", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("talk", { agent: "claude", state: "idle", sessions: [talkSession] })]);
  // The thread loads ahead. Its diff arrives, and waits for its session.
  const slot = () => document.querySelector<HTMLElement>('[data-workspace-slot="review-talk"]');
  const status = () =>
    slot()?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus;
  await expect
    .poll(() => host.requested.includes("/api/reviews/talk/targets/talk-target/review"))
    .toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(status()).toBe("loading");

  host.releaseSession();
  await page.getByRole("button", { name: /^Talk review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const thread_ = page.getByRole("log", { name: "Session" });
  await expect.element(thread_.getByText("Rename the export.")).toBeVisible();
  await expect.element(thread_.getByText("alpha", { exact: true })).toBeVisible();
  expect(status()).toBe("ready");
});

test("quiet chrome says each thing once, keeps rare actions in ⋯, and full chrome brings back the bars", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("talk", { agent: "claude", state: "idle", sessions: [talkSession] })]);
  host.releaseSession();
  await page.getByRole("button", { name: /^Talk review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const session = page.getByRole("region", { name: "Claude session" });
  await expect.element(session.getByText("Rename the export.")).toBeVisible();
  const band = page.getByRole("banner", { name: "Workspace" });
  const viewOptions = page.getByRole("button", { name: "View options", exact: true });
  const statusBar = () =>
    [...document.querySelectorAll("[data-connection]")].some((dot) => dot.checkVisibility());
  const command = async (name: string) => {
    await userEvent.keyboard("{Control>}k{/Control}");
    await page.getByRole("combobox", { name: "Search commands" }).fill(name);
    await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  };

  // Quiet by default: the sidebar names the thread, the band its branch, and
  // the review's one row what it shows: the Review's version, as the thread
  // opens on its Review. No toolbar or status bar.
  await expect
    .element(band.getByRole("button", { name: "fixture, main. Copy path" }))
    .toBeVisible();
  await expect.element(session.getByText("Talk review")).not.toBeInTheDocument();
  await expect.element(page.getByRole("combobox", { name: "Review version" })).toBeVisible();
  await expect.element(viewOptions).not.toBeInTheDocument();
  expect(statusBar()).toBe(false);
  // The ⋯ menu has the header's and the toolbar's actions; View has the diff's.
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  for (const name of ["Copy comments", "Clear all comments…", "Find in diffs", "Commands"])
    await expect
      .element(page.getByRole("menuitem", { name: new RegExp(`^${name}`) }))
      .toBeVisible();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: /^Agent session/ }))
    .toBeChecked();
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Wrap long lines" }))
    .toBeVisible();
  // Escape closes the submenu, then the menu.
  await userEvent.keyboard("{Escape}{Escape}");
  await expect.element(page.getByRole("menu").first()).not.toBeInTheDocument();
  // ⌘K has what the toolbar's buttons did.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Compare against");
  await expect
    .element(page.getByRole("option", { name: /^Compare against a base branch/ }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  // With the sidebar hidden, the band names the thread.
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(band.getByText("Talk review", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(band.getByText("Talk review", { exact: true })).not.toBeInTheDocument();

  // Full chrome: the session's header names the thread, and the toolbar and
  // the status bar come back.
  await command("Use full chrome");
  await expect.element(viewOptions).toBeVisible();
  await expect.element(session.getByText("Talk review")).toBeVisible();
  expect(statusBar()).toBe(true);
  await command("Use quiet chrome");
  await expect.element(viewOptions).not.toBeInTheDocument();
  expect(statusBar()).toBe(false);
});

test("the sidebar lists every thread by repository with its agent's state", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", { agent: "claude", state: "working", updatedAt: Date.now() }),
    thread("second", {
      agent: "codex",
      state: "waiting",
      branch: "export",
      changes: { files: 2, additions: 12, deletions: 3 },
    }),
  ]);
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  await expect.element(sidebar.getByRole("region", { name: "fixture" })).toBeVisible();
  await expect.poll(threadRows).toEqual(["Agent review, working", "Second review, needs you"]);
  await expect.element(sidebar.getByText("Needs you", { exact: true })).toBeVisible();
  await expect.element(sidebar.getByText("+12")).toBeVisible();

  // ⌃2 (⌘2 on a Mac) opens the second thread in the list.
  await userEvent.keyboard("{Control>}2{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
  // The title band names the checkout that the thread works in.
  const band = page.getByRole("banner", { name: "Workspace" });
  await expect
    .element(band.getByRole("button", { name: "fixture, export. Copy path" }))
    .toBeVisible();

  // A pointer that rests on a row reads its thread ahead, and the click uses
  // that read.
  const reads = (path: string) => host.requested.filter((entry) => entry === path).length;
  await page.getByRole("button", { name: /^Agent review/ }).hover();
  await expect.poll(() => reads("/api/reviews/agent/targets/agent-target/review")).toBe(1);
  expect(reads("/api/reviews/agent")).toBe(1);
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  expect(reads("/api/reviews/agent")).toBe(1);
  expect(reads("/api/reviews/agent/targets/agent-target/review")).toBe(1);
  await expect.poll(() => location.pathname).toBe("/review/agent");
  await expect.poll(() => threadRows()[0]).toBe("Agent review, working(current)");

  // A turn that ends while another thread shows marks that thread new; a
  // look at it marks it read.
  await page.getByRole("button", { name: /^Second review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle", updatedAt: Date.now() }),
    thread("second", { agent: "codex", state: "idle", branch: "export" }),
  ]);
  await expect.poll(() => threadRows()[0]).toBe("Agent review, new");
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review(current)");

  // The registered repositories open as workspaces of their own.
  await sidebar.getByRole("button", { name: /^Repositories/ }).click();
  await sidebar.getByRole("button", { name: "fixture", exact: true }).click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => threadRows()[0]).toBe("Agent review");

  // A narrow window hides the sidebar; it opens over the workspace, and a
  // choice closes it.
  await page.viewport(600, 800);
  await expect.element(sidebar).not.toBeInTheDocument();
  await band.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: /^Second review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
  await expect.element(sidebar).not.toBeInTheDocument();
});

test("a thread's row says what its agent does now and whether its turn asks you", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const ended = Date.now() - 120_000;
  host.setThreads([
    thread("agent", {
      agent: "claude",
      state: "working",
      updatedAt: Date.now(),
      turn: { activity: "Running bun test" },
    }),
    thread("second", { agent: "codex", state: "idle", turn: { endedAt: ended, asks: true } }),
    // A message sent from Med after the turn ended answers its question.
    thread("third", {
      agent: "claude",
      state: "idle",
      updatedAt: Date.now() - 90_000,
      turn: { endedAt: ended, asks: true },
      replied: { at: ended + 1000, text: "Yes", delivery: "delivered" },
    }),
  ]);
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  await expect
    .poll(threadRows)
    .toEqual(["Agent review, working", "Second review, needs you", "Third review"]);
  // The activity shows in place of the branch.
  await expect.element(sidebar.getByText("Running bun test")).toBeVisible();
  await expect.element(sidebar.getByText("Needs you", { exact: true })).toBeVisible();
});

test("each repository folds threads that have been quiet for three days", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const days = (count: number) => Date.now() - count * 24 * 60 * 60 * 1000;
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle", updatedAt: Date.now() }),
    // An agent that waits for the reader stays in view, however old its thread.
    thread("second", { agent: "codex", state: "waiting", updatedAt: days(10) }),
    thread("third", { updatedAt: days(5) }),
    thread("fourth", { updatedAt: days(20) }),
  ]);
  const ids = () =>
    [...document.querySelectorAll<HTMLElement>("[data-thread]")].map((row) => row.dataset.thread);
  const fold = page.getByRole("button", { name: "2 older" });
  await expect.poll(ids).toEqual(["agent", "second"]);
  await expect.element(fold).toHaveAttribute("aria-expanded", "false");

  // ⌃2 (⌘2 on a Mac) counts only the threads in view.
  await userEvent.keyboard("{Control>}2{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");

  // The fold opens below the threads in view, which keep their places.
  await fold.click();
  await expect.poll(ids).toEqual(["agent", "second", "third", "fourth"]);
  await expect.element(fold).toHaveAttribute("aria-expanded", "true");
  await fold.click();
  await expect.poll(ids).toEqual(["agent", "second"]);
});

test("a thread's menu copies its resume command, marks it unread, and archives it", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", {
      agent: "claude",
      state: "idle",
      checkout: "/test/feature",
      linked: true,
      branch: "feature",
      sessions: [{ agent: "claude", id: "abc-123", cwd: "/work/it's here" }],
    }),
    thread("second"),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  const row = page.getByRole("button", { name: /^Agent review/ });
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /Copy Claude Code resume command/ }).click();
  // The directory is quoted for the shell, so the command pastes as is.
  expect(copy).toHaveBeenCalledWith(`cd '/work/it'\\''s here' && claude --resume abc-123`);
  await expect.element(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  copy.mockRestore();

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mark as unread" }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review, new");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Mark as read" }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review");

  // Archive leaves the list at once, with its worktree; Undo brings the thread back.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Archive and remove worktree/ }).click();
  await expect.poll(threadRows).toEqual(["Second review"]);
  expect(host.threadRequests).toEqual([
    { path: "/api/threads/agent/archive", body: { archived: true, removeWorktree: true } },
  ]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/agent/archive",
    body: { archived: false, removeWorktree: false },
  });

  // The second has no linked worktree, so its menu only archives.
  await page.getByRole("button", { name: /^Second review/ }).click({ button: "right" });
  await expect.element(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
  expect(document.body.textContent).not.toContain("Archive and remove worktree");
});

test("a new thread starts its agent in a new worktree and opens", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const dialog = page.getByRole("dialog", { name: "New thread" });
  await expect.element(dialog).toBeVisible();
  await expect
    .element(dialog.getByRole("radio", { name: "New worktree" }))
    .toHaveAttribute("aria-checked", "true");
  await dialog.getByRole("combobox", { name: "Task" }).fill("Show each result's age in the list");
  // The hint names the branch that Med creates.
  await expect.element(dialog.getByText("show-each-results-age-list")).toBeVisible();
  // Med chooses Opus at medium effort; a choice stays for the next thread.
  const model = dialog.getByRole("combobox", { name: "Model" });
  const effort = dialog.getByRole("combobox", { name: "Effort" });
  await expect.element(model).toHaveValue("opus");
  await expect.element(effort).toHaveValue("medium");
  await effort.selectOptions("high");
  await dialog.getByRole("combobox", { name: "Task" }).click();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .poll(() => host.threadRequests)
    .toEqual([
      {
        path: "/api/threads",
        body: {
          repositoryId: "repo-0",
          prompt: "Show each result's age in the list",
          title: "Show each result's age in the list",
          preset: "claude",
          worktree: true,
          choices: { model: "opus", effort: "high" },
        },
      },
    ]);
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");

  // Escape leaves a new thread that has not started.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect.element(dialog).toBeVisible();
  await expect.element(effort).toHaveValue("high");
  // A model without efforts has no effort to choose.
  await model.selectOptions("haiku");
  await expect.element(effort).not.toBeInTheDocument();
  await model.selectOptions("opus");
  await expect.element(effort).toHaveValue("high");
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  expect(shown()?.dataset.reviewId).toBe("agent-target");

  // A repository chosen here wins over the repository on screen.
  host.setThreads(
    [thread("agent")],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const repository = dialog.getByRole("combobox", { name: "Repository" });
  await expect.element(repository).toHaveValue("repo-0");
  await repository.selectOptions("other");
  await expect.element(repository).toHaveValue("repo-1");
  await dialog.getByRole("combobox", { name: "Task" }).fill("Rank results by age");
  await expect.element(dialog.getByText(/in a new worktree of other/)).toBeVisible();
  await dialog.getByRole("button", { name: /^Start/ }).click();
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ repositoryId: "repo-1", prompt: "Rank results by age" });

  // @ names a vault's note: the agent gets its path, and the title its name.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const task = dialog.getByRole("combobox", { name: "Task" });
  await task.click();
  await userEvent.keyboard("Follow @ages");
  await expect
    .element(dialog.getByRole("group", { name: "Notes" }).getByRole("option", { name: /Ages\.md/ }))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(task).toHaveValue("Follow @Ages.md ");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ prompt: "Follow /test/notes/Plans/Ages.md ", title: "Follow @Ages.md" });
});

test("reviews that agents announce show in the window used last", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await expect.poll(() => host.windows.size).toBe(1);

  // Another window was used last: this one keeps its own workspace on screen.
  localStorage.setItem(WINDOW_KEY, "window-elsewhere");
  host.announce({ id: "agent", open: true });
  host.setThreads([thread("agent", { updatedAt: Date.now() + 1000 })]);
  await expect.poll(threadRows).toEqual(["Agent review, new"]);
  expect(shown()?.dataset.selectedBranch).toBe("main");

  // A click shows it and makes this the window used last.
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");

  // Now this window shows the next review that opens.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  host.announce({ id: "second", open: true });
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
});

test("a pasted pull request link opens a workspace at once, which becomes its review", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("New workspace");
  await userEvent.keyboard("{Enter}");
  await page
    .getByRole("combobox", { name: "Search branches" })
    .fill("https://github.com/acme/trails/pull/7/files");
  await expect.element(page.getByRole("option", { name: /Open pull request #7/ })).toBeVisible();
  await userEvent.keyboard("{Enter}");

  // The workspace shows at once, with its progress.
  const progress = page.getByRole("region", { name: "Opening the pull request" });
  await expect.element(progress).toBeVisible();
  expect(host.pulls).toEqual([{ id: "job-1", url: "https://github.com/acme/trails/pull/7" }]);

  // A failed step says why, and Retry asks the host again.
  host.setPull({
    status: "failed",
    error: "Add a clone of acme/trails to Med, then open the link again.",
    steps: [{ id: "repository", label: "Find acme/trails", state: "failed" }],
  });
  const problem = () =>
    document.querySelector('[aria-label="Opening the pull request"] [role="alert"]')?.textContent;
  await expect
    .poll(problem)
    .toMatch(/^Add a clone of acme\/trails to Med, then open the link again\./);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => host.pulls.length).toBe(2);
  await expect.poll(problem).toBeUndefined();

  // The saved review takes the workspace's place.
  host.setPull({ title: "Add durations" });
  host.setPull({ status: "done", reviewId: "agent" });
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  expect(location.pathname).toBe("/review/agent");
});

test("⌘⇧F opens the search page for the workspace's repository, and a match opens at its line", async () => {
  const host = createHost();
  render(host);
  host.setThreads(
    [],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");

  await userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
  const query = page.getByRole("combobox", { name: "Search query" });
  await expect.element(query).toHaveValue("repo:fixture ");
  expect(location.pathname).toBe("/search");
  await expect.element(query).toHaveFocus();

  // Results show as you type, from this checkout only.
  await userEvent.keyboard("AFTER");
  await expect.element(page.getByRole("status")).toHaveTextContent("1 result in 1 file in fixture");
  expect(host.searches).toEqual(["/test/repo AFTER"]);
  await expect
    .element(page.getByRole("option", { selected: true }))
    .toHaveTextContent("1export const after = 2;");
  expect(document.querySelector("mark")?.textContent).toBe("after");

  // Without a filter, every repository.
  await query.fill("after");
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("2 results in 2 files across 2 repositories");
  expect(host.searches).toContain("/test/other after");

  // Enter opens the chosen match in this workspace, at the commit searched.
  await query.fill("repo:fixture after");
  await expect.element(page.getByRole("status")).toHaveTextContent("1 result in 1 file in fixture");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  expect(location.pathname).toBe("/");
  expect(document.querySelector('[aria-label="Search query"]')).toBeNull();

  // Back returns to the results; Escape leaves them.
  history.back();
  await expect
    .element(page.getByRole("combobox", { name: "Search query" }))
    .toHaveValue("repo:fixture after");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => location.pathname).toBe("/");
  await expect.poll(() => document.querySelector('[aria-label="Search query"]')).toBeNull();
  expect(shown()?.dataset.activeFile).toBe("src/alpha.ts");
});
