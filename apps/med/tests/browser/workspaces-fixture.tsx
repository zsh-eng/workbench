import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread, ThreadList } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

// The workspace shell with a fake host, for the workspaces*.test.tsx files:
// branches, threads, and tabs that a window opens and keeps.

export const head = "a".repeat(40);
export const branches = [
  { name: "main", head, worktreePath: "/test/repo", current: true },
  { name: "feature", head, worktreePath: "/test/feature", current: false },
];
export const repositories = [
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
export const changed = (repo: string) =>
  repo === "/test/feature" ? ["feature.ts"] : ["alpha.ts", "beta.ts"];
export const patchFor = (repo: string) =>
  changed(repo)
    .map(
      (path) =>
        `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
    )
    .join("");

export let root: Root | undefined;
export let mount: HTMLDivElement | undefined;
export let address = "";
export const STORAGE_KEY = "med:workspaces:v1";
export const WINDOW_KEY = "med:window";

/** A window wide enough for the sidebar beside the workspace, with no saved
 * workspaces, drafts, or marks of what the reader saw. */
export async function prepareWindow() {
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
}
/** Unmounts the shell, forgets its workspaces, and gives the page its address back. */
export function cleanUp() {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(WINDOW_KEY);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:draft:")) localStorage.removeItem(key);
  // Workspaces move the address; the test page keeps its own.
  history.replaceState(null, "", address);
}

export const reviewFor = (repo: string, comparison: Comparison, id = `review-${repo}`) => {
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
export const savedTitles: Record<string, string> = {
  agent: "Agent review",
  commented: "Commented review",
  second: "Second review",
  talk: "Talk review",
  third: "Third review",
  fourth: "Fourth review",
  fifth: "Fifth review",
  older: "Older review",
};
/** The agent session of the "talk" thread, which handed off the "talk" review. */
export const talkSession = { agent: "claude" as const, id: "talk-session", cwd: "/test/repo" };
export const TALK = `claude-${talkSession.id}`;
export const savedReview = (id: string) => ({
  id,
  title: savedTitles[id],
  ...(id === "talk" ? { session: talkSession } : {}),
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
export function createHost() {
  const sessions: string[] = [];
  // Every working file's text on disk.
  let fileText = "export const after = 2;\n";
  const streams = new Set<string>();
  const windows = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const announce = (review: { id: string; open: boolean }) => {
    const data = { type: "review", title: savedTitles[review.id], thread: review.id, ...review };
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
  // Replies that its agent wrote later, and when its transcript changed.
  let talkLater: string[] = [];
  let talkModifiedAt = 0;
  // How long the talk session's stream takes to answer, as a host's round trip.
  let talkDelay = 0;
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
    // The Superagent's thread, once the host made it (src/host/superagent.ts).
    if (url.pathname === "/api/superagent" && init?.method === "POST") {
      const made = threads.find((entry) => entry.superagent);
      return made
        ? Response.json({ thread: made.id, created: false })
        : Response.json({ error: { code: "x", message: "No Superagent here." } }, { status: 500 });
    }
    // A new thread is the session that the host starts; it has no review
    // until the agent hands one off.
    if (url.pathname === "/api/threads" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { title: string };
      threadRequests.push({ path: url.pathname, body });
      const started: Thread = {
        id: "claude-started",
        kind: "session",
        title: body.title,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
        checkout: "/test/repo",
        branch: "main",
        agent: "claude",
        state: "working",
        session: { agent: "claude", id: "started", cwd: "/test/repo" },
        reviews: [],
      };
      setThreads([started, ...threads]);
      return Response.json({ thread: started.id });
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
    const action = /^\/api\/threads\/([\w-]+)\/(open|close|delete|name|pin|later)$/.exec(
      url.pathname,
    );
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
      // As the host pins a thread or puts it in Later: at its place there, or
      // under the others. A thread is in one of the two.
      if (verb === "pin" || verb === "later") {
        const field = verb === "pin" ? "pinned" : "later";
        const other = verb === "pin" ? "later" : "pinned";
        const on = body[field] === true;
        const list = threads
          .filter((entry) => entry[field] && entry.id !== id)
          .toSorted((a, b) => a[field]! - b[field]!)
          .map((entry) => entry.id);
        if (on) list.splice(typeof body.at === "number" ? body.at : list.length, 0, id!);
        setThreads(
          threads.map((entry) => {
            const next: Thread = { ...entry };
            delete next[field];
            if (on && entry.id === id) delete next[other];
            const place = list.indexOf(entry.id);
            return place < 0 ? next : { ...next, [field]: place + 1 };
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
      // An archived thread opens; one that the test does not list stays out.
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
    if (url.pathname === `/api/sessions/${TALK}/events`) {
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
          ...talkLater.map((text, index) => ({
            at: 10 + index,
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId: `later-${index}`,
              content: { type: "text", text },
            },
          })),
        ],
        idle: true,
        modifiedAt: talkModifiedAt,
        truncated: false,
      };
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          void sessionHeld
            .then(() => new Promise((resolve) => setTimeout(resolve, talkDelay)))
            .then(() =>
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
    const sessionRoute = /^\/api\/sessions\/[\w-]+(?:\/(owned|agent)\b)?/.exec(url.pathname);
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
    /** The talk session's agent replies again: the session's next stream has
     * it, and answers after `delay` milliseconds. */
    talkReplies(text: string, at: number, delay = 0) {
      talkLater = [...talkLater, text];
      talkModifiedAt = at;
      talkDelay = delay;
    },
    setFileText(text: string) {
      fileText = text;
    },
  };
}

export function render(host: ReturnType<typeof createHost>) {
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
export const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
/** Each thread row's name, with its state, and whether it is the one shown. */
// A row: its name, its dot, whether it works, and whether it is current.
export const threadRows = () =>
  [...document.querySelectorAll<HTMLElement>("[data-session-row]")].map((row) => {
    const button = row.querySelector<HTMLElement>("button")!;
    const dot = button.querySelector('[role="img"]')?.getAttribute("aria-label");
    return [
      button.getAttribute("data-tooltip-clipped") ?? "",
      dot === "New since you looked" && ", new",
      dot === "Needs you" && ", needs you",
      dot === "Stopped" && ", stopped",
      button.getAttribute("aria-busy") && ", working",
      button.getAttribute("aria-current") && "(current)",
    ]
      .filter(Boolean)
      .join("");
  });
/** A review's row: its own, or its session's, which `patch` makes. */
export const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  kind: "review",
  title: savedTitles[id] ?? id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: Date.now() - 60_000,
  reviews: [
    {
      id,
      title: savedTitles[id] ?? id,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: Date.now() - 60_000,
    },
  ],
  repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
  checkout: "/test/repo",
  branch: "main",
  ...patch,
});
/** The talk session's thread, with its review. */
export const talkThread = () =>
  thread("talk", {
    id: TALK,
    kind: "session",
    agent: "claude",
    state: "idle",
    session: talkSession,
  });
