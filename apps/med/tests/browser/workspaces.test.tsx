import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread, ThreadList } from "../../src/shared/threads";
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
  for (const key of ["thread-seen", "thread-seen-since", "subagent-seen", "subagent-seen-since"])
    localStorage.removeItem(`med:${key}`);
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
  // The tabs that the host lists, history, and the requests that change them.
  let threads: Thread[] = [];
  let past: Thread[] = [];
  const setHistory = (next: Thread[]) => {
    past = next;
  };
  const places = new Map<string, number>();
  let threadRepositories: ThreadList["repositories"] = [
    { id: "repo-0", name: "fixture", path: "/test/repo", branch: "main" },
  ];
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
    // Tabs and history, as the host keeps them (src/host/thread-service.ts).
    if (url.pathname === "/api/threads/history")
      return Response.json({ threads: past.map((entry) => ({ ...entry, open: false })) });
    if (url.pathname === "/api/threads/order" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { order: string[] };
      threadRequests.push({ path: url.pathname, body });
      setThreads(body.order.flatMap((id) => threads.find((entry) => entry.id === id) ?? []));
      return Response.json({ ok: true });
    }
    if (url.pathname === "/api/threads/reopen" && init?.method === "POST") {
      threadRequests.push({ path: url.pathname, body: {} });
      const last = past.shift();
      if (!last) return Response.json({ error: { message: "No closed tab." } }, { status: 404 });
      setThreads([last, ...threads]);
      return Response.json({ thread: { ...last, open: true } });
    }
    const action = /^\/api\/threads\/([\w-]+)\/(open|close|delete)$/.exec(url.pathname);
    if (action && init?.method === "POST") {
      const [, id, verb] = action;
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      threadRequests.push({ path: url.pathname, body });
      const tab = threads.find((entry) => entry.id === id);
      const closed = past.find((entry) => entry.id === id);
      if (verb === "close") {
        if (tab) {
          places.set(tab.id, threads.indexOf(tab));
          past = [{ ...tab, closedAt: Date.now() }, ...past];
          setThreads(threads.filter((entry) => entry !== tab));
        }
        return Response.json({ closed: !!tab });
      }
      if (verb === "delete") {
        past = past.filter((entry) => entry.id !== id);
        if (tab) setThreads(threads.filter((entry) => entry !== tab));
        return Response.json({ deleted: true });
      }
      // A thread in history opens; one that the test does not list stays out.
      if (closed) {
        past = past.filter((entry) => entry !== closed);
        const at = body.restore ? (places.get(closed.id) ?? 0) : 0;
        setThreads([...threads.slice(0, at), closed, ...threads.slice(at)]);
      }
      return Response.json({
        thread: { ...(tab ?? closed ?? { ...savedReview(id!), updatedAt: 0 }), open: true },
      });
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
          // A subagent that still works.
          {
            at: 3,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "toolu_edge",
              title: "Check the edge cases",
              status: "in_progress",
              _meta: { med: { tool: "Agent" } },
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
    setHistory,
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
  // The Session pane's streams read the fake host too, not the test server.
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
  // Before any click, the thread loads in a slot of its own, out of sight,
  // once the reader has not acted for a second.
  const slot = () => document.querySelector<HTMLElement>('[data-workspace-slot="review-agent"]');
  await expect
    .poll(() => slot()?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus, {
      timeout: 5000,
    })
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

test("every tab loads out of sight and stays, as open terminal tabs do; history does not load", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const inView = ["agent", "second", "third", "fourth", "fifth"];
  // A closed thread is history: Med does not load it or watch it.
  host.setHistory([thread("older", { updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000 })]);
  host.setThreads(
    inView.map((id, index) => thread(id, { updatedAt: Date.now() - (index + 1) * 60_000 })),
  );
  const slot = (id: string) =>
    document.querySelector<HTMLElement>(`[data-workspace-slot="review-${id}"]`);
  // More threads than the three that loaded ahead before.
  for (const id of inView)
    await expect
      .poll(
        () => slot(id)?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus,
        { timeout: 5000 },
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
    .poll(() => host.requested.includes("/api/reviews/talk/targets/talk-target/review"), {
      timeout: 5000,
    })
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
  await expect.element(page.getByText(/^Version 1\b/)).toBeVisible();
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

test("tabs keep the reader's order: a state change moves no row, ⌘1–⌘9 follow the rows, and ⌥↓ or a drag moves one", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const minutes = (count: number) => Date.now() - count * 60_000;
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle", updatedAt: minutes(30) }),
    thread("second", { agent: "codex", state: "idle", updatedAt: minutes(20) }),
    thread("third", { agent: "claude", state: "idle", updatedAt: minutes(10) }),
  ]);
  const ids = () =>
    [...document.querySelectorAll<HTMLElement>("[data-thread]")].map((row) => row.dataset.thread);
  await expect.poll(ids).toEqual(["agent", "second", "third"]);
  // Nothing works or waits: no counts line.
  const counts = page.getByRole("group", { name: "Tabs at work" });
  await expect.element(counts).not.toBeInTheDocument();

  // The first asks and the third starts to work: no row moves.
  host.setThreads([
    thread("agent", { agent: "claude", state: "waiting", updatedAt: minutes(30) }),
    thread("second", { agent: "codex", state: "idle", updatedAt: minutes(20) }),
    thread("third", { agent: "claude", state: "working", updatedAt: Date.now() }),
  ]);
  await expect
    .poll(threadRows)
    .toEqual(["Agent review, needs you", "Second review", "Third review, working"]);
  // ⌃3 (⌘3 on a Mac) shows the third row.
  await userEvent.keyboard("{Control>}3{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");

  // The counts line; ⌘0 shows the next tab that needs you, and a count the
  // next of its tabs.
  await expect.element(counts).toHaveTextContent("1 needs you·1 working");
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  await counts.getByRole("button", { name: "1 working" }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");

  // ⌥↓ on a row moves its tab down in its repository; the row keeps the
  // focus, and the host keeps the order.
  (page.getByRole("button", { name: /^Agent review/ }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await expect.poll(ids).toEqual(["second", "agent", "third"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/order",
    body: { order: ["second", "agent", "third"] },
  });
  await expect.poll(() => (document.activeElement as HTMLElement).dataset.thread).toBe("agent");
  // ⌘1 follows the new order.
  await userEvent.keyboard("{Control>}1{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");

  // A drag puts a tab in another place.
  await page
    .getByRole("button", { name: /^Third review/ })
    .dropTo(page.getByRole("button", { name: /^Second review/ }));
  await expect.poll(() => ids()[0]).toBe("third");
  expect(host.threadRequests.at(-1)?.path).toBe("/api/threads/order");
});

test("a tab closes by ×, ⌘⌥W, or the palette; Undo and ⌘⌥T bring it back; ⌃Tab finds it in history", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle" }),
    thread("second", { agent: "codex", state: "working" }),
    thread("third", { agent: "claude", state: "idle" }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, working", "Third review"]);

  // × on the row closes the tab; its agent keeps working.
  await page.getByRole("button", { name: /^Second review/ }).hover();
  await page.getByRole("button", { name: "Close Second review" }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Third review"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/second/close",
    body: { removeWorktree: false },
  });
  const notice = page.getByRole("status").filter({ hasText: "Closed “Second review”." });
  await expect.element(notice).toBeVisible();
  // Undo opens it again at its place.
  await notice.getByRole("button", { name: "Undo" }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, working", "Third review"]);

  // ⌘⌥W closes the tab on screen with its workspace, and ⌘⌥T opens it again.
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, working"]);
  await expect.poll(() => shown()?.dataset.reviewId).not.toBe("third-target");
  expect(document.querySelector('[data-workspace-slot="review-third"]')).toBeNull();
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await expect.poll(threadRows).toContain("Third review(current)");

  // The palette closes the tab on screen too.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Close tab");
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, working"]);

  // ⌃Tab with a typed word searches history too; Return opens the thread as
  // a tab, at the top. A letter with Control held searches and runs no
  // shortcut (⌃K is the palette).
  await userEvent.keyboard("{Control>}{Tab}k{/Control}");
  const search = page.getByRole("combobox", { name: "Search tabs and history" });
  await expect.element(search).toHaveValue("k");
  await userEvent.keyboard("{Backspace}third");
  await expect.element(search).toHaveValue("third");
  const option = page.getByRole("option", { name: "Third review, in history" });
  await expect.element(option).toBeVisible();
  await expect.element(option).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/third/open",
    body: { restore: false },
  });
  await expect.poll(threadRows).toContain("Third review(current)");

  // "Open from history…" lists the closed threads, newest first.
  await page.getByRole("button", { name: /^Agent review/ }).hover();
  await page.getByRole("button", { name: "Close Agent review" }).click();
  await expect.poll(threadRows).not.toContain("Agent review");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Open from history");
  await userEvent.keyboard("{Enter}");
  const history = page.getByRole("dialog", { name: "Open from history" });
  await expect.element(history.getByRole("option", { name: /^Agent review/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(history).not.toBeInTheDocument();
});

test("a tab lists its subagents; a click opens one in the Session pane, and a finished one folds once seen", async () => {
  const host = createHost();
  render(host);
  host.releaseSession();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle" }),
    thread("talk", {
      agent: "claude",
      state: "working",
      updatedAt: Date.now(),
      sessions: [talkSession],
      subagents: [
        {
          id: "toolu_edge",
          description: "Check the edge cases",
          state: "working",
          activity: "Running bun test",
          updatedAt: Date.now(),
        },
        { id: "toolu_docs", description: "Read the docs", state: "idle", updatedAt: Date.now() },
      ],
    }),
  ]);
  const subagents = page.getByRole("list", { name: "Talk review subagents" });
  const working = subagents.getByRole("button", { name: /^Check the edge cases/ });
  await expect.element(working).toBeVisible();
  await expect.element(subagents.getByText("Running bun test")).toBeVisible();
  await expect
    .element(subagents.getByRole("button", { name: /^Read the docs\W+done$/ }))
    .toBeVisible();

  // A click shows the thread with the subagent's tab open in its Session pane.
  await working.click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  await expect
    .element(page.getByRole("tab", { name: /Check the edge cases/ }))
    .toHaveAttribute("aria-selected", "true");
  // The thread on screen shows the finished subagent's result: its row folds.
  await expect
    .element(subagents.getByRole("button", { name: /^Read the docs/ }))
    .not.toBeInTheDocument();
  await expect.element(working).toBeVisible();
});

test("a tab's menu copies its resume command, marks it unread, and closes it", async () => {
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

  // Close leaves the list at once, with its worktree; Undo brings the tab back.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Close and remove worktree/ }).click();
  await expect.poll(threadRows).toEqual(["Second review"]);
  expect(host.threadRequests).toEqual([
    { path: "/api/threads/agent/close", body: { removeWorktree: true } },
  ]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/agent/open",
    body: { restore: true },
  });

  // The second has no linked worktree, so its menu only closes it. Delete
  // asks first.
  await page.getByRole("button", { name: /^Second review/ }).click({ button: "right" });
  await expect.element(page.getByRole("menuitem", { name: /^Close tab/ })).toBeVisible();
  expect(document.body.textContent).not.toContain("Close and remove worktree");
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const ask = page.getByRole("status").filter({ hasText: "Delete “Second review”?" });
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect.poll(threadRows).toEqual(["Agent review"]);
  expect(host.threadRequests.at(-1)).toEqual({ path: "/api/threads/second/delete", body: {} });
});

test("a new thread starts its agent in a new worktree and opens", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const dialog = page.getByRole("dialog", { name: "New thread" });
  await expect.element(dialog).toBeVisible();
  const task = dialog.getByRole("combobox", { name: "Task" });
  await expect.element(task).toHaveFocus();
  // Each choice is a row of options, the chosen one marked.
  const chosen = (name: string) =>
    dialog
      .getByRole("radiogroup", { name, exact: true })
      .element()
      .querySelector('[aria-checked="true"]')?.textContent;
  const where = dialog.getByRole("radiogroup", { name: "Where the agent works" });
  await task.fill("Show each result's age in the list");
  // The worktree names the branch that Med creates; the checkout names its own.
  await expect
    .poll(() => chosen("Where the agent works"))
    .toBe("New worktree · show-each-results-age-list");
  await expect.element(where.getByRole("radio", { name: "Checkout · main" })).toBeVisible();
  // The only agent is a fact, not a choice.
  await expect.element(dialog.getByText("Claude Code", { exact: true })).toBeVisible();
  await expect.element(dialog.getByRole("radiogroup", { name: "Agent" })).not.toBeInTheDocument();
  // Med chooses Opus at medium effort; one click chooses, and the choice stays
  // for the next thread.
  await expect.poll(() => chosen("Model")).toBe("Opus 5.5");
  expect(chosen("Effort")).toBe("medium");
  await dialog
    .getByRole("radiogroup", { name: "Effort" })
    .getByRole("radio", { name: "high" })
    .click();
  expect(chosen("Effort")).toBe("high");
  // Start sits in the task box, at its bottom right, above the choices.
  const start = dialog
    .getByRole("button", { name: /^Start/ })
    .element()
    .getBoundingClientRect();
  const box = task.element().getBoundingClientRect();
  const first = dialog.getByRole("radiogroup").first().element().getBoundingClientRect();
  expect(start.top).toBeGreaterThanOrEqual(box.bottom);
  expect(start.bottom).toBeLessThan(first.top);
  expect(box.right - start.right).toBeLessThan(16);
  // ⌘↵ starts from anywhere on the page: here, from the Effort row.
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

  // ← and → move within a row and choose. A model without efforts has no
  // effort to choose. Escape leaves a new thread that has not started.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => chosen("Effort")).toBe("high");
  const model = dialog.getByRole("radiogroup", { name: "Model" });
  await model.getByRole("radio", { name: "Opus 5.5" }).click();
  await userEvent.keyboard("{ArrowRight}");
  expect(chosen("Model")).toBe("Haiku 4.5");
  expect(document.activeElement?.textContent).toBe("Haiku 4.5");
  await expect.element(dialog.getByRole("radiogroup", { name: "Effort" })).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowLeft}");
  expect(chosen("Model")).toBe("Opus 5.5");
  await expect.poll(() => chosen("Effort")).toBe("high");
  // Tab goes on to the next row, at its chosen option.
  await userEvent.keyboard("{Tab}");
  expect(document.activeElement?.textContent).toBe("high");
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  expect(shown()?.dataset.reviewId).toBe("agent-target");

  // A repository chosen here wins over the repository on screen.
  host.setThreads(
    [thread("agent")],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo", branch: "main" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect.poll(() => chosen("Repository")).toBe("fixture");
  await dialog
    .getByRole("radiogroup", { name: "Repository" })
    .getByRole("radio", { name: "other" })
    .click();
  expect(chosen("Repository")).toBe("other");
  // Med does not know the other checkout's branch. One click chooses it.
  await where.getByRole("radio", { name: "Checkout", exact: true }).click();
  expect(chosen("Where the agent works")).toBe("Checkout");
  await task.fill("Rank results by age");
  await dialog.getByRole("button", { name: /^Start/ }).click();
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ repositoryId: "repo-1", prompt: "Rank results by age", worktree: false });

  // @ names a vault's note: the agent gets its path, and the title its name.
  await userEvent.keyboard("{Alt>}n{/Alt}");
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

test("⌘⇧F opens the workspace's Search tab; a match opens in a file tab, and the tab keeps its results", async () => {
  // A second registered repository, for repo: filters.
  repositories.push({ id: "repo-1", path: "/test/other", name: "other", branches, worktrees: [] });
  onTestFinished(() => void repositories.splice(1));
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
  const searchKey = () => userEvent.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const panel = page.getByRole("tabpanel", { name: "Search", exact: true });

  await searchKey();
  const query = page.getByRole("combobox", { name: "Search query" });
  await expect.element(query).toHaveFocus();
  await expect.element(query).toHaveValue("");
  await expect.element(tab("Search")).toHaveAttribute("aria-selected", "true");
  expect(location.pathname).toBe("/");

  // Results show as you type, from this checkout only; the tab names the query.
  await userEvent.keyboard("AFTER");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  expect(host.searches).toEqual(["/test/repo AFTER"]);
  await expect.element(tab("Search: AFTER")).toHaveAttribute("aria-selected", "true");
  await expect
    .element(panel.getByRole("option", { selected: true }))
    .toHaveTextContent("1export const after = 2;");
  expect(panel.element().querySelector("mark")?.textContent).toBe("after");

  // repo:* searches every repository.
  await query.fill("repo:* after");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("2 results in 2 files across 2 repositories");
  expect(host.searches).toContain("/test/other after");

  // Enter opens the chosen match in a file tab here, at the commit searched.
  await query.fill("after");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await expect.element(tab("Search: after")).toHaveAttribute("aria-selected", "false");
  expect(location.pathname).toBe("/");

  // ⌘⇧F shows the same tab, with its query selected and its results.
  const searches = host.searches.length;
  await searchKey();
  await expect.element(tab("Search: after")).toHaveAttribute("aria-selected", "true");
  await expect.element(query).toHaveFocus();
  const field = query.element() as HTMLInputElement;
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, "after".length]);
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  expect(host.searches).toHaveLength(searches);
  expect(page.getByRole("tab", { name: /^Search/ }).elements()).toHaveLength(1);

  // Escape shows the tab that showed before; ⌥W in the query closes the tab.
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await tab("Search: after").click();
  await expect.element(query).toHaveFocus();
  query
    .element()
    .dispatchEvent(
      new KeyboardEvent("keydown", { key: "∑", code: "KeyW", altKey: true, bubbles: true }),
    );
  await expect.element(tab("Search: after")).not.toBeInTheDocument();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");

  // An old search link opens the Search tab with its query.
  history.pushState(null, "", "/search?q=AFTER");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(tab("Search: AFTER")).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => location.pathname).toBe("/");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");

  // A match in another repository opens in that repository's workspace.
  await query.fill("repo:other after");
  await expect.element(panel.getByRole("status")).toHaveTextContent("1 result in 1 file in other");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("lib/other.ts");
});
