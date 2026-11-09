import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import { AUTO_CLOSE_MS } from "../../src/web/data/tabs";
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
  // A test's drafts and open files would reopen in the next one's workspace.
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:draft:") || key.startsWith("med:files:")) localStorage.removeItem(key);
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
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:draft:")) localStorage.removeItem(key);
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
  commented: "Commented review",
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
  commentCount: id === "commented" ? 1 : 0,
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
  // Every working file's text on disk.
  let fileText = "export const after = 2;\n";
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
  // What the reader saw of each tab, as the host keeps it: a tab without a
  // mark counts as seen up to when the host began.
  const seenSince = Date.now();
  const seen = new Map<string, number>();
  const listed = () =>
    threads.map((entry) => ({ ...entry, seen: seen.get(entry.id) ?? seenSince }));
  const threadFrame = () =>
    new TextEncoder().encode(
      `event: state\ndata: ${JSON.stringify({ threads: listed(), repositories: threadRepositories })}\n\n`,
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
    if (url.pathname === "/api/threads/reopen" && init?.method === "POST") {
      threadRequests.push({ path: url.pathname, body: {} });
      const last = past.shift();
      if (!last) return Response.json({ error: { message: "No closed tab." } }, { status: 404 });
      setThreads([last, ...threads]);
      return Response.json({ thread: { ...last, open: true } });
    }
    // A browser's marks from before the host kept them.
    if (url.pathname === "/api/threads/seen" && init?.method === "POST") {
      const { marks } = JSON.parse(String(init.body)) as { marks: Record<string, number> };
      threadRequests.push({ path: url.pathname, body: { marks } });
      for (const [id, at] of Object.entries(marks)) if ((seen.get(id) ?? -1) < at) seen.set(id, at);
      for (const stream of threadStreams) stream.enqueue(threadFrame());
      return Response.json({ ok: true });
    }
    const mark = /^\/api\/threads\/([\w-]+)\/seen$/.exec(url.pathname);
    if (mark && init?.method === "POST") {
      seen.set(mark[1]!, (JSON.parse(String(init.body)) as { at: number }).at);
      for (const stream of threadStreams) stream.enqueue(threadFrame());
      return Response.json({ ok: true });
    }
    const action = /^\/api\/threads\/([\w-]+)\/(open|close|delete|name|pin)$/.exec(url.pathname);
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
      // As the host pins a thread: at its place among the pins, or under them.
      if (verb === "pin") {
        const pins = threads
          .filter((entry) => entry.pinned && entry.id !== id)
          .toSorted((a, b) => a.pinned! - b.pinned!)
          .map((entry) => entry.id);
        if (body.pinned) pins.splice(typeof body.at === "number" ? body.at : pins.length, 0, id!);
        setThreads(
          threads.map((entry) => {
            const { pinned: _, ...rest } = entry;
            const place = pins.indexOf(entry.id);
            return place < 0 ? rest : { ...rest, pinned: place + 1 };
          }),
        );
        return Response.json({ ok: true });
      }
      // As the host names a thread: an empty name gives the agent's title back.
      if (verb === "name") {
        const name = String(body.name).trim();
        if (tab) {
          const { agentTitle, ...rest } = tab;
          const agent = agentTitle ?? tab.title;
          const next = name
            ? { ...rest, title: name, agentTitle: agent }
            : { ...rest, title: agent };
          setThreads(threads.map((entry) => (entry === tab ? next : entry)));
        }
        return Response.json({ ok: true });
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
    if (url.pathname === "/api/reviews/commented/clear")
      return Response.json({ ...savedReview("commented"), revision: 1, commentCount: 0 });
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
          // A checkout's search reads its working files.
          resultSource: source,
          engine: "git",
        });
      }
      case "/api/browse/read": {
        const { source, path } = JSON.parse(String(init?.body));
        return Response.json({
          source,
          path,
          kind: "text",
          size: fileText.length,
          identity: `${source.repo}:${path}:${fileText}`,
          text: fileText,
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
    setFileText(text: string) {
      fileText = text;
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
// A row: its name, its dot, whether it works, and whether it is current.
const threadRows = () =>
  [...document.querySelectorAll<HTMLElement>("[data-session-row]")].map((row) => {
    const button = row.querySelector<HTMLElement>("button")!;
    const dot = button.querySelector('[role="img"]')?.getAttribute("aria-label");
    return [
      button.title,
      dot === "New since you looked" && ", new",
      dot === "Needs you" && ", needs you",
      dot === "Stopped" && ", stopped",
      button.getAttribute("aria-busy") && ", working",
      button.getAttribute("aria-current") && "(current)",
    ]
      .filter(Boolean)
      .join("");
  });
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
  // The first diff in a page loads Pierre's highlighter on the main thread.
  await expect.poll(() => mainDiffs().length, { timeout: 5_000 }).toBe(2);
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
  await page.getByRole("radio", { name: /^Changes/ }).click();
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

test("the History page lists history by day, searches it, opens a thread as a tab, and deletes one", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const day = 24 * 60 * 60 * 1000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  host.setThreads([thread("agent")]);
  host.setHistory([
    thread("third", { agent: "claude", updatedAt: Date.now() - 1000 }),
    thread("second", { agent: "codex", branch: "feature", updatedAt: midnight - 60 * 60 * 1000 }),
    thread("older", { updatedAt: Date.now() - 20 * day, prompt: "Trim the export" }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review"]);

  // History is at the sidebar's foot.
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  expect(location.pathname).toBe("/history");
  const list = page.getByRole("listbox", { name: "History" });
  const days = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="History"] [role="group"]',
      ),
    ].map((group) => [
      group.getAttribute("aria-label"),
      [...group.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("aria-label")),
    ]);
  await expect.poll(days).toEqual([
    ["Today", ["Third review, fixture · main, Claude"]],
    ["Yesterday", ["Second review, fixture · feature, Codex"]],
    [
      new Date(Date.now() - 20 * day).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        ...(new Date(Date.now() - 20 * day).getFullYear() !== new Date().getFullYear() && {
          year: "numeric",
        }),
      }),
      ["Older review, fixture · main"],
    ],
  ]);
  // The tab is not history.
  expect(list.getByRole("option", { name: /^Agent review/ }).query()).toBeNull();
  await expect
    .element(list.getByRole("option", { name: /^Third review/ }))
    .toHaveAttribute("aria-selected", "true");

  // A letter in the list starts a search, as the switcher's does, over the
  // first prompt too.
  await userEvent.keyboard("t");
  const search = page.getByRole("combobox", { name: "Search history" });
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("rim");
  await expect.poll(days).toEqual([[expect.any(String), ["Older review, fixture · main"]]]);
  await userEvent.keyboard("{Escape}");
  await expect.element(search).toHaveValue("");
  await expect.poll(() => days().length).toBe(3);

  // ↓ and ↵ open a thread as a tab, as the switcher does; the page leaves.
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/second/open",
    body: { restore: false },
  });
  await expect
    .element(page.getByRole("heading", { name: "History", level: 1 }))
    .not.toBeInTheDocument();
  await expect.poll(threadRows).toContain("Second review(current)");

  // ⌘K opens it again; the thread that opened is a tab now.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("History");
  await page.getByRole("option", { name: "History", exact: true }).click();
  await expect.poll(days).toEqual([
    ["Today", ["Third review, fixture · main, Claude"]],
    [expect.any(String), ["Older review, fixture · main"]],
  ]);

  // ⌘⌫ asks. ↵ on Keep keeps the thread.
  const listbox = () =>
    document.querySelector('[role="listbox"][aria-label="History"]') as HTMLElement;
  listbox().focus();
  await userEvent.keyboard("{End}{Control>}{Backspace}{/Control}");
  const keep = list.getByRole("button", { name: "Keep" });
  await expect.element(keep).toBeVisible();
  const asked = host.threadRequests.length;
  (keep.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(keep).not.toBeInTheDocument();
  expect(host.threadRequests.length).toBe(asked);
  // ⌘⌫ asks again; a second ↵ deletes the thread for good.
  listbox().focus();
  await userEvent.keyboard("{End}{Control>}{Backspace}{/Control}");
  await expect
    .element(list.getByRole("option", { name: /^Older review/ }))
    .toMatchTextContent(/^Delete “Older review” for good\?/);
  await userEvent.keyboard("{Enter}");
  await expect.poll(days).toEqual([["Today", ["Third review, fixture · main, Claude"]]]);
  expect(host.threadRequests.at(-1)).toEqual({ path: "/api/threads/older/delete", body: {} });
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

test("the notice after Clear shows under the header's end, on one line, wider than All comments", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("commented")]);
  await page.getByRole("button", { name: /^Commented review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("commented-target");
  // The header keeps one action, All comments, with Copy in its panel; Clear
  // is in ⌘K.
  const all = page.getByRole("button", { name: "All comments", exact: true });
  await expect.element(all).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Copy comments", exact: true }))
    .not.toBeInTheDocument();
  const button = all.element().getBoundingClientRect();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("option", { name: /^Clear all comments…/ }).click();
  await page.getByRole("button", { name: "Confirm clear" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Comments cleared" });
  await expect.element(notice).toBeVisible();
  const box = notice.element().getBoundingClientRect();
  expect(box.height).toBeLessThan(44);
  expect(box.width).toBeGreaterThan(100);
  // Under the header, in view: not at the page's end.
  expect(box.top).toBeGreaterThanOrEqual(button.bottom);
  expect(box.top - button.bottom).toBeLessThan(40);
  // With no comments left, the button has no count, and its panel nothing to copy.
  await expect.element(all).toHaveTextContent("");
  await all.click();
  await expect.element(page.getByText("No comments yet")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Copy comments", exact: true }))
    .not.toBeInTheDocument();
});

test("the review's header names the review, keeps its actions in ⌘K, and there is no toolbar or status bar", async () => {
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
  const statusBar = () =>
    [...document.querySelectorAll("[data-connection]")].some((dot) => dot.checkVisibility());

  // The band's start names the branch; above the review, the band holds the
  // review's title row; the session's header names only its agent. No
  // toolbar or status bar.
  await expect.element(band.getByRole("button", { name: "fixture. Copy the path" })).toBeVisible();
  await expect
    .element(band.getByRole("button", { name: "main. Copy the branch name" }))
    .toBeVisible();
  await expect
    .element(band.getByRole("heading", { level: 2, name: "Talk review", exact: true }))
    .toBeVisible();
  await expect.element(session.getByText("Talk review")).not.toBeInTheDocument();
  expect(page.getByRole("button", { name: "View options", exact: true }).query()).toBeNull();
  expect(statusBar()).toBe(false);
  // No Send: comments go to the agent from its session. ⌘K has the review's
  // actions (⋯ holds only what a narrow row folds; see quiet-chrome).
  expect(page.getByRole("button", { name: /^Send comments to/ }).query()).toBeNull();
  await userEvent.keyboard("{Control>}k{/Control}");
  const search = page.getByRole("combobox", { name: "Search commands" });
  for (const name of ["Hide agent session", "Find in diff contents", "Open Settings"]) {
    await search.fill(name);
    await expect.element(page.getByRole("option", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  // ⌘K has the comparison's choices, and no other chrome to choose.
  await search.fill("Compare against");
  await expect
    .element(page.getByRole("option", { name: /^Compare against a base branch/ }))
    .toBeVisible();
  await search.fill("chrome");
  await expect.element(page.getByRole("option", { name: /full chrome/ })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  // The review's title row names the thread, so the band names it once,
  // with the sidebar hidden or shown.
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(band.getByText("Talk review", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(band.getByText("Talk review", { exact: true })).toBeVisible();
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

  // Archive in the row's menu sends the session to history; its agent keeps
  // working, and nothing announces it.
  await page.getByRole("button", { name: "Actions for Second review" }).click();
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Third review"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/second/close",
    body: { removeWorktree: false },
  });
  expect(page.getByRole("status").filter({ hasText: "Closed" }).query()).toBeNull();
  // ⌘⌥T opens it again.
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(threadRows).toContain("Second review, working(current)");

  // ⌘⌥W closes the tab on screen with its workspace, and ⌘⌥T opens it again.
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  // Reopening put Second at the top of Recent, and closing lands on it.
  await expect.poll(threadRows).toEqual(["Second review, working(current)", "Agent review"]);
  await expect.poll(() => shown()?.dataset.reviewId).not.toBe("third-target");
  expect(document.querySelector('[data-workspace-slot="review-third"]')).toBeNull();
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await expect.poll(threadRows).toContain("Third review(current)");

  // The palette closes the tab on screen too.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Close tab");
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Second review, working(current)", "Agent review"]);

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
  await page.getByRole("button", { name: "Actions for Agent review" }).click();
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).not.toContain("Agent review");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Open from history");
  await userEvent.keyboard("{Enter}");
  const history = page.getByRole("dialog", { name: "Open from history" });
  await expect.element(history.getByRole("option", { name: /^Agent review/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(history).not.toBeInTheDocument();
});

test("closing a tab with an unsaved draft asks first, and the reopened thread shows the draft", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("third", { agent: "claude", state: "idle" })]);
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");

  // A working file of the thread's checkout, edited and not saved.
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();

  // ⌘⌥W asks first. Cancel keeps the tab.
  const question = page.getByRole("status").filter({ hasText: "unsaved changes" });
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  await expect
    .element(question)
    .toMatchTextContent(/^“Third review” has unsaved changes in src\/alpha\.ts\./);
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(question).not.toBeInTheDocument();
  expect(document.querySelector('[data-workspace-slot="review-third"]')).not.toBeNull();
  // Close closes the tab with its workspace.
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(threadRows).toEqual([]);
  expect(document.querySelector('[data-workspace-slot="review-third"]')).toBeNull();
  // Another program changes the file. ⌘⌥T opens the thread again, and its
  // file opens with the draft and says that the file changed.
  host.setFileText("export const agent = 3;\n");
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  if (!editor.query()) await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: "The file changed on disk" });
  await expect.element(notice).toBeVisible();
  // Undo goes back to the text that the draft started from. The file on disk
  // is still newer, and Refresh reads it.
  await editor.click();
  await userEvent.keyboard("u");
  await expect.element(editor).toHaveTextContent("export const after = 2;");
  await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  await expect.element(notice).toBeVisible();
  await page.getByRole("button", { name: "Refresh contents", exact: true }).click();
  await expect.element(editor).toHaveTextContent("export const agent = 3;");
  await expect.element(notice).not.toBeInTheDocument();
});

test("an unsaved draft outlasts a reload, and says when its file changed", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("third", { agent: "claude", state: "idle" })]);
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");

  // The draft is kept in this browser, so leaving does not warn.
  await expect
    .poll(() => {
      const leave = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leave);
      return leave.defaultPrevented;
    })
    .toBe(false);
  // The page loads again, and another program changed the file meanwhile.
  root!.unmount();
  mount!.remove();
  host.setFileText("export const agent = 3;\n");
  render(host);
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  if (!editor.query()) await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();
  const changes = page.getByRole("region", { name: "Changes on disk" });
  await expect.element(changes.getByText("export const agent = 3;")).toBeInTheDocument();
  // Use the file on disk drops the draft, and storage forgets it.
  await page.getByRole("button", { name: "Use the file on disk", exact: true }).click();
  await expect.element(editor).toHaveTextContent("export const agent = 3;");
  await expect
    .poll(() => Object.keys(localStorage).filter((key) => key.startsWith("med:draft:")))
    .toEqual([]);
});

test("a tab whose work has landed stays open while it has an unsaved draft, or while it is pinned", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // Four tabs whose work has landed on their base branch, read long ago.
  const landed = (id: string, patch: Partial<Thread> = {}) =>
    thread(id, {
      agent: "claude",
      state: "idle",
      updatedAt: 1,
      unlanded: { base: "main", ahead: 0, uncommitted: false },
      ...patch,
    });
  const tabs = () => [
    landed("talk", { pinned: 1 }),
    landed("third"),
    landed("fourth"),
    landed("fifth"),
  ];
  host.setThreads(tabs());
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await page.getByRole("button", { name: /^Fourth review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("fourth-target");

  // Time passes with Talk, Third and Fifth off screen. Med closes Fifth on
  // its own. Third keeps its tab, because closing it would hide the draft,
  // and Talk keeps its tab because it is pinned.
  const realNow = Date.now.bind(Date);
  const later = vi.spyOn(Date, "now").mockImplementation(() => realNow() + AUTO_CLOSE_MS * 2);
  onTestFinished(() => later.mockRestore());
  host.setThreads(tabs());
  await expect
    .poll(() => threadRows().map((row) => row.split(/(?<=review)/)[0]))
    .toEqual(["Talk review", "Third review", "Fourth review"]);
  expect(
    host.threadRequests
      .filter((request) => request.path.endsWith("/close"))
      .map((request) => request.path),
  ).toEqual(["/api/threads/fifth/close"]);
});

test("a thread takes a name from its menu, a double-click, or the palette; Esc keeps the old one, and an empty name gives the agent's title back", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("agent", { agent: "claude", state: "idle" }), thread("second")]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  const field = page.getByRole("textbox", { name: "Thread name" });
  const named = () => host.threadRequests.filter((request) => request.path.endsWith("/name"));

  // The menu's Rename puts a field with the name in the row; Enter keeps the
  // new name, and the focus goes back to the row.
  await page.getByRole("button", { name: /^Agent review/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveValue("Agent review");
  await userEvent.fill(field, "Talk prep");
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Talk prep", "Second review"]);
  expect(named()).toEqual([{ path: "/api/threads/agent/name", body: { name: "Talk prep" } }]);
  const row = page.getByRole("button", { name: /^Talk prep/ });
  await expect.element(row).toHaveFocus();

  // A double-click on the row names it too; its first click opens the thread.
  // Esc keeps the name it had.
  await row.dblClick();
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("Something else{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  await expect.poll(threadRows).toEqual(["Talk prep(current)", "Second review"]);
  expect(named()).toHaveLength(1);

  // The palette names the thread on screen, which the window's title shows. An
  // empty name gives the agent's title back.
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  await expect.poll(() => document.title).toBe("Talk prep");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Rename thread");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveAttribute("placeholder", "Agent review");
  await userEvent.clear(field);
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Agent review(current)", "Second review"]);
  expect(named().at(-1)).toEqual({ path: "/api/threads/agent/name", body: { name: "" } });

  // With the sidebar hidden, the title band holds the field.
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(page.getByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Rename thread");
  await userEvent.keyboard("{Enter}");
  const band = page.getByRole("banner", { name: "Workspace" });
  await expect.element(band.getByRole("textbox", { name: "Thread name" })).toHaveFocus();
  // The name starts selected, so typing replaces it.
  await userEvent.keyboard("Regions{Enter}");
  await expect.poll(() => document.title).toBe("Regions");
  expect(named().at(-1)).toEqual({ path: "/api/threads/agent/name", body: { name: "Regions" } });
  await userEvent.keyboard("{Control>}b{/Control}");
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
  await page.getByRole("menuitem", { name: /^Copy resume command/ }).click();
  // The directory is quoted for the shell, so the command pastes as is.
  expect(copy).toHaveBeenCalledWith(`cd '/work/it'\\''s here' && claude --resume abc-123`);
  copy.mockRestore();

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Mark as unread/ }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review, new");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Mark as read/ }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review");

  // Archive leaves the list at once.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).toEqual(["Second review"]);
  expect(host.threadRequests).toEqual([
    { path: "/api/threads/agent/close", body: { removeWorktree: false } },
  ]);

  // Delete asks first.
  await page.getByRole("button", { name: /^Second review/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const ask = page.getByRole("status").filter({ hasText: "Delete “Second review”?" });
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect.poll(threadRows).toEqual([]);
  expect(host.threadRequests.at(-1)).toEqual({ path: "/api/threads/second/delete", body: {} });
});

test("⌘0 goes to a tab that needs you, then one whose work finished since you looked, then one that works", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const later = Date.now() + 60_000;
  const tabs = (fourth: Partial<Thread>) => [
    thread("agent"),
    thread("second", { state: "working", updatedAt: Date.now() - 30_000 }),
    thread("third", { updatedAt: later }),
    thread("fourth", { updatedAt: later - 1000, ...fourth }),
  ];
  host.setThreads(tabs({ state: "waiting" }));
  /** The row of the thread whose title starts with this. */
  const row = (name: string) => threadRows().find((entry) => entry.startsWith(name));
  // The sidebar marks each as ⌘0 ranks it.
  await expect
    .poll(threadRows)
    .toEqual([
      "Third review, new",
      "Fourth review, needs you",
      "Second review, working",
      "Agent review",
    ]);
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Fourth")).toBe("Fourth review(current)");
  // The tab on screen still needs you: the next is the one that finished.
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Third")).toBe("Third review(current)");
  // Seen on screen, it is not new: the host has the mark, for every window
  // and the CLI.
  await expect
    .poll(() => host.requested.filter((path) => path === "/api/threads/third/seen").length)
    .toBeGreaterThan(0);
  // The tab that needed you goes on: what it did since you looked is new.
  host.setThreads(tabs({ updatedAt: later + 1000 }));
  await expect.poll(() => row("Fourth")).toBe("Fourth review, new");
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Fourth")).toBe("Fourth review(current)");
  await expect.poll(() => row("Third")).toBe("Third review");
  // Nothing needs you or is new: the next is the one that works.
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Second")).toBe("Second review, working(current)");
});

test("the marks that a browser kept of what the reader saw go to the host once", async () => {
  const before = Date.now() - 120_000;
  localStorage.setItem("med:thread-seen-since", String(before));
  localStorage.setItem("med:thread-seen", JSON.stringify({ agent: Date.now() }));
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The second tab changed after this browser's first visit, and it had no
  // mark: it was new here, and stays new.
  host.setThreads([thread("agent"), thread("second", { updatedAt: Date.now() - 90_000 })]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, new"]);
  expect(host.threadRequests).toEqual([
    {
      path: "/api/threads/seen",
      body: { marks: { agent: expect.any(Number), second: before } },
    },
  ]);
  expect(localStorage.getItem("med:thread-seen")).toBeNull();
  expect(localStorage.getItem("med:thread-seen-since")).toBeNull();
});

test("a row drags into Pinned, to a place among the pins, and out again; its menu moves a pin", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const now = Date.now();
  host.setThreads([
    thread("agent", { updatedAt: now - 1000 }),
    thread("second", { updatedAt: now - 2000 }),
    thread("third", { updatedAt: now - 3000 }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review", "Third review"]);
  const section = (name: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(`section[aria-label="${name}"] [data-session-row]`),
    ].map((row) => row.querySelector("button")?.title);
  const button = (title: string) =>
    document.querySelector<HTMLElement>(`[data-session-row] button[title="${title}"]`)!;
  const middle = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  const settle = () => new Promise((done) => setTimeout(done, 60));
  const pinnedArea = () =>
    document.querySelector('section[aria-label="Pinned"]')!.getBoundingClientRect();
  /** Presses a row, and moves the pointer in steps to wherever `to` says. */
  const drag = async (title: string, to: () => number, release = true) => {
    const start = middle(button(title));
    const at = (y: number) => ({ clientX: start.x, clientY: y, bubbles: true, pointerId: 1 });
    button(title).dispatchEvent(new PointerEvent("pointerdown", { ...at(start.y), button: 0 }));
    document.dispatchEvent(new PointerEvent("pointermove", at(start.y + 8)));
    // The list makes room as the drag starts; the target is read after.
    await settle();
    document.dispatchEvent(new PointerEvent("pointermove", at(to())));
    await settle();
    document.dispatchEvent(new PointerEvent("pointermove", at(to())));
    await settle();
    if (release) document.dispatchEvent(new PointerEvent("pointerup", at(to())));
  };
  const pins = () => host.threadRequests.filter((request) => request.path.endsWith("/pin"));

  // With no pins, Pinned shows while a row drags, to drop into.
  await drag("Third review", () => pinnedArea().bottom - 8);
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/third/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Third review"]);
  expect(section("Recent")).toEqual(["Agent review", "Second review"]);
  // The press was a drag: it opened nothing.
  expect(threadRows().some((row) => row.endsWith("(current)") && row.startsWith("Third"))).toBe(
    false,
  );

  // Above the first pin's middle is the first place.
  await drag("Agent review", () => button("Third review").getBoundingClientRect().top + 4);
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/agent/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Agent review", "Third review"]);

  // The menu moves a pin one place, as a drag would.
  await button("Third review").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  await expect.element(page.getByRole("menuitem", { name: "Move down" })).not.toBeInTheDocument();
  await page.getByRole("menuitem", { name: "Move up" }).click();
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/third/pin", body: { pinned: true, at: 0 } });
  await expect.poll(() => section("Pinned")).toEqual(["Third review", "Agent review"]);

  // Esc puts the row back, and pins nothing.
  const before = pins().length;
  await drag("Second review", () => middle(button("Third review")).y, false);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  expect(pins().length).toBe(before);
  await expect.poll(() => section("Recent")).toEqual(["Second review"]);

  // Below Pinned is Recent: the row goes back to its place by activity.
  await drag(
    "Agent review",
    () => section("Recent").length && middle(button("Second review")).y + 20,
  );
  await expect
    .poll(() => pins().at(-1))
    .toEqual({ path: "/api/threads/agent/pin", body: { pinned: false } });
  await expect.poll(() => section("Recent")).toEqual(["Agent review", "Second review"]);
  expect(section("Pinned")).toEqual(["Third review"]);
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
  // The page asks where to work; the repository on screen is chosen.
  const repositories = dialog.getByRole("listbox", { name: "Repositories" });
  await expect
    .element(repositories.getByRole("option", { name: /^fixture/, selected: true }))
    .toBeVisible();
  // Under the composer, one line of choices; each shows its choice.
  const menu = (name: string) => dialog.getByRole("button", { name, exact: true });
  const where = dialog.getByRole("button", { name: /^Where the agent works: / });
  const model = menu("Model");
  const effort = menu("Effort");
  await task.fill("Show each result's age in the list");
  // Two places to work: a click switches between them. The worktree names
  // the branch that Med creates; the checkout names its own.
  await expect.element(where).toHaveTextContent("New worktree");
  await expect
    .element(where)
    .toHaveAccessibleName("Where the agent works: New worktree · show-each-results-age-list");
  await expect.element(where).toHaveAccessibleDescription("Switch to Checkout · main");
  await where.click();
  await expect.element(where).toHaveAccessibleName("Where the agent works: Checkout · main");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await where.click();
  await expect.element(where).toHaveTextContent("New worktree");
  await expect.element(dialog).toBeVisible();
  // Med chooses Opus at medium effort: the agent's mark and the model, then
  // the effort, each its own menu. The only agent is a fact, not a choice.
  // The choice stays for the next thread.
  await expect.element(model).toHaveTextContent("Opus 5.5");
  await expect.element(effort).toHaveTextContent("medium effort");
  await model.click();
  await expect.element(page.getByRole("menuitemcheckbox", { name: "Haiku 4.5" })).toBeVisible();
  await expect.element(page.getByRole("menuitem", { name: /^Agent/ })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await effort.click();
  await page.getByRole("menuitemcheckbox", { name: "high" }).click();
  await expect.element(effort).toHaveTextContent("high effort");
  // The composer sits right under the list, both in the page's middle, and
  // its choices under it.
  const box = task.element().getBoundingClientRect();
  const list = repositories.element().getBoundingClientRect();
  expect(list.bottom).toBeLessThan(box.top);
  expect(box.top - list.bottom).toBeLessThan(64);
  expect(box.bottom).toBeLessThan(dialog.element().getBoundingClientRect().height * 0.8);
  expect(model.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom);
  expect(box.right - effort.element().getBoundingClientRect().right).toBeLessThan(16);
  await expect.element(dialog.getByRole("button", { name: /^Start/ })).not.toBeInTheDocument();
  // ⌘↵ starts from anywhere on the page: here, from the effort's menu, once
  // it has closed and its button has the focus again.
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  await expect.element(effort).toHaveFocus();
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect
    .poll(() => host.threadRequests, { timeout: 5_000 })
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

  // A model without efforts has no effort to choose. Escape leaves a new
  // thread that has not started.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect.element(dialog).toBeVisible();
  await expect.element(model).toHaveTextContent("Opus 5.5");
  await expect.element(effort).toHaveTextContent("high effort");
  await model.click();
  await page.getByRole("menuitemcheckbox", { name: "Haiku 4.5" }).click();
  await expect.poll(() => model.element().textContent).toBe("Haiku 4.5");
  await expect.element(effort).not.toBeInTheDocument();
  await model.click();
  await page.getByRole("menuitemcheckbox", { name: "Opus 5.5" }).click();
  await expect.element(model).toHaveTextContent("Opus 5.5");
  await expect.element(effort).toHaveTextContent("high effort");
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  expect(shown()?.dataset.reviewId).toBe("agent-target");

  // A repository chosen here wins over the repository on screen. Typing in
  // the filter narrows the list, and Enter picks. With two repositories, the
  // line's Repository switches between them.
  host.setThreads(
    [thread("agent")],
    [
      { id: "repo-0", name: "fixture", path: "/test/repo", branch: "main" },
      { id: "repo-1", name: "other", path: "/test/other" },
    ],
  );
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await expect
    .element(repositories.getByRole("option", { name: /^fixture/, selected: true }))
    .toBeVisible();
  const repository = dialog.getByRole("button", { name: /^Repository: / });
  await expect.element(repository).toHaveAccessibleName("Repository: fixture");
  await dialog.getByRole("combobox", { name: "Filter repositories" }).click();
  await userEvent.keyboard("oth");
  await expect.poll(() => repositories.getByRole("option").all().length).toBe(1);
  await userEvent.keyboard("{Enter}");
  await expect
    .element(repositories.getByRole("option", { name: /^other/, selected: true }))
    .toBeVisible();
  await expect.element(repository).toHaveAccessibleName("Repository: other");
  await expect.element(task).toHaveFocus();
  // Med does not know the other checkout's branch.
  await where.click();
  await expect.element(where).toHaveAccessibleName("Where the agent works: Checkout");
  // Enter in the task starts; ⇧Enter adds a line.
  await task.click();
  await userEvent.keyboard("Rank results{Shift>}{Enter}{/Shift}by age");
  await expect.element(task).toHaveValue("Rank results\nby age");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => host.threadRequests.at(-1)?.body)
    .toMatchObject({ repositoryId: "repo-1", prompt: "Rank results\nby age", worktree: false });

  // @ names a vault's note: the agent gets its path, and the title its name.
  // Enter takes the note while the list is open, then starts.
  await userEvent.keyboard("{Alt>}n{/Alt}");
  await task.click();
  await userEvent.keyboard("Follow @ages");
  await expect
    .element(dialog.getByRole("group", { name: "Notes" }).getByRole("option", { name: /Ages\.md/ }))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(task).toHaveValue("Follow @Ages.md ");
  await userEvent.keyboard("{Enter}");
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

  // Enter opens the chosen match in the working file's tab here.
  await query.fill("after");
  await expect
    .element(panel.getByRole("status"))
    .toHaveTextContent("1 result in 1 file in fixture");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await expect.element(tab("Search: after")).toHaveAttribute("aria-selected", "false");
  expect(
    document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute("title"),
  ).toMatch(/^src\/alpha\.ts · Working files/);
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
