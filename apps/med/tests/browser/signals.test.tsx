import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

// Quiet signals for tabs that need the reader (src/web/data/signals.ts): the
// dot on Show sidebar, the Dock badge, opt-in OS notifications, and the
// recent repositories in New thread.

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
const listed = (id: string, name: string) => ({ id, name, path: `/test/${name}` });
const tide = { id: "repo-0", name: "tide", path: "/test/repo" };
const patch =
  "diff --git a/src/tides.ts b/src/tides.ts\nindex 1111111..2222222 100644\n--- a/src/tides.ts\n+++ b/src/tides.ts\n@@ -1 +1 @@\n-before\n+after\n";
const reviewFor = (repo: string, comparison: Comparison, id = `review-${repo}`) => ({
  id,
  repo,
  comparison,
  base: head,
  head: "working",
  label: "Working changes",
  files: [{ path: "src/tides.ts", status: "M", additions: 1, deletions: 1, binary: false }],
  patch,
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
});
const titles: Record<string, string> = {
  agent: "Week view",
  second: "Daylight saving times",
  third: "Station search",
};
const savedReview = (id: string) => ({
  id,
  title: titles[id] ?? id,
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
const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: titles[id] ?? id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: Date.now() - 60_000,
  repository: tide,
  checkout: "/test/repo",
  branch: "main",
  agent: "claude",
  state: "idle",
  ...patch,
});
/** A turn that ended on a question to the reader. */
const asking = (id: string, said: string) =>
  thread(id, { turn: { endedAt: Date.now() - 1000, said, asks: true } });

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const KEYS = [
  "med:workspaces:v1",
  "med:window",
  "med:thread-seen",
  "med:thread-seen-since",
  "med:sidebar",
  "med:new-thread",
  "med:notify",
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of ["setAppBadge", "clearAppBadge"])
    delete (navigator as unknown as Record<string, unknown>)[name];
  delete (document as unknown as Record<string, unknown>).visibilityState;
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

/** A host with the tabs and history that the test sets. It records the new
 * threads that start. */
function createHost(tabs: Thread[], { past = [] as Thread[], listedRepositories = [tide] } = {}) {
  let threads = tabs;
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const frame = () =>
    `event: state\ndata: ${JSON.stringify({ threads, repositories: listedRepositories })}\n\n`;
  const setThreads = (next: Thread[]) => {
    threads = next;
    for (const listener of listeners) listener.enqueue(new TextEncoder().encode(frame()));
  };
  const started: unknown[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const repo = url.searchParams.get("repo") || "/test/repo";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (url.pathname === "/api/threads" && init?.method === "POST") {
      started.push(body);
      return Response.json({ review: savedReview("agent") });
    }
    if (url.pathname === "/api/threads/history")
      return Response.json({ threads: past.map((entry) => ({ ...entry, open: false })) });
    const action = /^\/api\/threads\/([\w-]+)\/open$/.exec(url.pathname);
    if (action) return Response.json({ thread: threads.find((entry) => entry.id === action[1]) });
    const target = /^\/api\/reviews\/(\w+)\/targets\/[\w-]+\/(review|notes)$/.exec(url.pathname);
    if (target?.[2] === "review")
      return Response.json(reviewFor("/test/repo", { kind: "working" }, `${target[1]}-target`));
    if (target?.[2] === "notes")
      return Response.json({ reviewId: `${target[1]}-target`, revision: 0, notes: [] });
    const saved = /^\/api\/reviews\/(\w+)$/.exec(url.pathname);
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
      case "/api/events":
      case "/api/windows":
        return stream(init);
      case "/api/repositories":
        return Response.json({ repositories });
      case "/api/branches":
        return Response.json(repositories[0]!.branches);
      case "/api/agents":
        return Response.json({
          agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
        });
      case "/api/session":
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: { path: repo, name: "tide", head, branch: "main", shallow: false, git: true },
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
    // Sessions, inboxes, agent choices, and the rest: none here.
    return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
  };
  return { fetcher, setThreads, started };
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
const band = page.getByRole("banner", { name: "Workspace" });

/** Runs a palette command by its name. */
async function command(name: string) {
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill(name);
  await expect.element(page.getByRole("option", { name: new RegExp(`^${name}`) })).toBeVisible();
  await userEvent.keyboard("{Enter}");
}

test("a dot on Show sidebar says that a tab needs you while the sidebar hides", async () => {
  const host = createHost([thread("agent"), asking("second", "Should I switch it?")]);
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The sidebar counts the tab; the band has no toggle.
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  await expect.element(band.getByRole("button", { name: /^Show sidebar/ })).not.toBeInTheDocument();

  await userEvent.keyboard("{Control>}b{/Control}");
  const toggle = band.getByRole("button", { name: "Show sidebar · 1 needs you" });
  await expect.element(toggle).toBeVisible();
  const dot = () => toggle.element().querySelector("[data-dot]");
  expect(dot()).not.toBeNull();
  // The dot is on the icon's top right corner, in the "Needs you" accent.
  const icon = toggle.element().querySelector("svg")!.getBoundingClientRect();
  const box = dot()!.getBoundingClientRect();
  expect(box.width).toBe(6);
  expect(Math.abs(box.right - icon.right - 2)).toBeLessThan(1);
  expect(Math.abs(box.top - icon.top + 2)).toBeLessThan(1);
  const accent = document.createElement("span");
  accent.style.color = "var(--med-accent, #8f9cff)";
  document.body.append(accent);
  expect(getComputedStyle(dot()!).backgroundColor).toBe(getComputedStyle(accent).color);
  accent.remove();

  host.setThreads([
    asking("agent", "Which zone?"),
    asking("second", "Should I switch it?"),
    thread("third", { state: "working" }),
  ]);
  await expect
    .element(band.getByRole("button", { name: "Show sidebar · 2 needs you" }))
    .toBeVisible();
  // No tab needs you: no dot, and the plain name.
  host.setThreads([thread("agent"), thread("second", { state: "working" })]);
  const plain = band.getByRole("button", { name: "Show sidebar", exact: true });
  await expect.element(plain).toBeVisible();
  expect(plain.element().querySelector("[data-dot]")).toBeNull();

  // The sidebar shows again, with its own count; the band's toggle goes.
  host.setThreads([thread("agent"), asking("second", "Should I switch it?")]);
  await expect
    .element(band.getByRole("button", { name: "Show sidebar · 1 needs you" }))
    .toBeVisible();
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  await expect.element(band.getByRole("button", { name: /^Show sidebar/ })).not.toBeInTheDocument();
});

test("the Dock badge counts the tabs that need you, and clears at 0", async () => {
  const setAppBadge = vi.fn<(count?: number) => Promise<void>>(() => Promise.resolve());
  const clearAppBadge = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.assign(navigator, { setAppBadge, clearAppBadge });
  const host = createHost([thread("agent"), asking("second", "Should I switch it?")]);
  render(host);
  await expect.poll(() => setAppBadge.mock.calls).toEqual([[1]]);
  // Before the list came, the badge stayed as it was.
  expect(clearAppBadge).not.toHaveBeenCalled();

  host.setThreads([
    asking("agent", "Which zone?"),
    asking("second", "Should I switch it?"),
    thread("third", { state: "waiting" }),
  ]);
  await expect.poll(() => setAppBadge.mock.calls.at(-1)).toEqual([3]);
  // Work that starts or ends does not count.
  host.setThreads([thread("agent", { state: "working" }), thread("second")]);
  await expect.poll(() => clearAppBadge.mock.calls.length).toBe(1);
  expect(setAppBadge.mock.calls).toEqual([[1], [3]]);
});

/** A stub of the Notifications API that records each notification. */
function stubNotifications(answer: NotificationPermission = "granted") {
  const sent: { title: string; body?: string; tag?: string; onclick: (() => void) | null }[] = [];
  const requestPermission = vi.fn<() => Promise<NotificationPermission>>(async () => {
    Stub.permission = answer;
    return answer;
  });
  class Stub {
    static permission: NotificationPermission = "default";
    static requestPermission = requestPermission;
    onclick: (() => void) | null = null;
    close = vi.fn<() => void>();
    constructor(title: string, options: NotificationOptions = {}) {
      const entry = { title, body: options.body, tag: options.tag, onclick: null };
      sent.push(entry);
      // The entry reads the handler that the page sets after construction.
      Object.defineProperty(entry, "onclick", { get: () => this.onclick });
    }
  }
  vi.stubGlobal("Notification", Stub);
  return { sent, requestPermission };
}

/** This window hides, as when the reader works in another app. */
function hide() {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
}
function reveal() {
  delete (document as unknown as Record<string, unknown>).visibilityState;
  vi.mocked(document.hasFocus).mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
}

test("opt-in notifications: only when a tab starts to need you, only while no window shows, and a click opens the tab", async () => {
  const { sent, requestPermission } = stubNotifications();
  const host = createHost([thread("agent"), thread("second", { state: "working" })]);
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");

  // Off by default: a tab that needs you while no window shows sends nothing.
  hide();
  host.setThreads([thread("agent"), asking("second", "Should I switch it?")]);
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  reveal();

  // ⌘K turns it on; the browser asks for permission the first time.
  await command("Notify me when a tab needs you");
  expect(requestPermission).toHaveBeenCalledTimes(1);
  await expect
    .element(page.getByText("Med notifies you when a tab needs you and no Med window shows."))
    .toBeVisible();
  expect(localStorage.getItem("med:notify")).toBe("on");

  // While a window shows, a tab that starts to need you sends nothing.
  host.setThreads([asking("agent", "Which zone?"), asking("second", "Should I switch it?")]);
  await expect.element(page.getByRole("button", { name: "2 needs you" })).toBeVisible();
  host.setThreads([thread("agent"), asking("second", "Should I switch it?")]);
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();

  // Nor while another Med window shows: it holds the shared lock.
  hide();
  let leave!: () => void;
  const other = new Promise<void>((resolve) => (leave = resolve));
  void navigator.locks.request("med:looking", { mode: "shared" }, () => other);
  host.setThreads([asking("agent", "Which zone?"), asking("second", "Should I switch it?")]);
  await expect.element(page.getByRole("button", { name: "2 needs you" })).toBeVisible();
  host.setThreads([thread("agent"), asking("second", "Should I switch it?")]);
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  leave();

  // With no window shown: one notification, with the title and the first
  // line of the question. Work that starts or ends sends none.
  host.setThreads([
    asking("agent", "One choice for you: the station's time or yours?\nI kept the station's."),
    asking("second", "Should I switch it?"),
    thread("third", { state: "working" }),
  ]);
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    title: "Week view",
    body: "One choice for you: the station's time or yours?",
    tag: "agent",
  });
  host.setThreads([
    asking("agent", "One choice for you: the station's time or yours?"),
    asking("second", "Should I switch it?"),
    thread("third"),
  ]);
  // A permission request names what the agent asks for.
  host.setThreads([
    asking("agent", "One choice for you: the station's time or yours?"),
    asking("second", "Should I switch it?"),
    thread("third", {
      state: "waiting",
      turn: { activity: "Asks for permission: Run bun test", said: "Running the tests." },
    }),
  ]);
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]).toMatchObject({
    title: "Station search",
    body: "Asks for permission: Run bun test",
  });

  // A click shows Med and opens the tab.
  const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
  reveal();
  sent[0]!.onclick!();
  expect(focus).toHaveBeenCalled();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");

  // ⌘K turns it off again; the choice lasts for this browser.
  await command("Stop notifying me when a tab needs you");
  await expect.element(page.getByText("Notifications are off.")).toBeVisible();
  expect(localStorage.getItem("med:notify")).toBeNull();
  hide();
  host.setThreads([thread("agent"), thread("second"), asking("third", "Ready to land?")]);
  await expect.element(page.getByRole("button", { name: "1 needs you" })).toBeVisible();
  expect(sent).toHaveLength(2);
});

test("a blocked permission keeps notifications off and says so", async () => {
  const { requestPermission } = stubNotifications("denied");
  const host = createHost([thread("agent")]);
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await command("Notify me when a tab needs you");
  expect(requestPermission).toHaveBeenCalledTimes(1);
  await expect
    .element(page.getByRole("alert").getByText(/The browser blocks Med's notifications/))
    .toBeVisible();
  expect(localStorage.getItem("med:notify")).toBeNull();
});

test("New thread offers the repositories of the newest threads, one click each", async () => {
  const names = ["tide", "harbour", "almanac", "charts", "buoys", "pilot", "moon"];
  const known = names.map((name, index) => listed(`repo-${index}`, name));
  // Each thread is a day newer than the one before; "moon" is not registered.
  const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();
  const made = (id: string, repository: number, day: number) =>
    thread(id, { repository: known[repository], createdAt: at(day) });
  const host = createHost([made("agent", 0, 10), made("second", 1, 3)], {
    past: [
      made("old-almanac", 2, 2),
      made("charts", 3, 12),
      made("buoys", 4, 9),
      made("pilot", 5, 1),
      thread("moon", {
        repository: { id: "repo-9", name: "moon", path: "/test/moon" },
        createdAt: at(14),
      }),
      made("tide-again", 0, 11),
    ],
    listedRepositories: known.slice(0, 6),
  });
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const dialog = page.getByRole("dialog", { name: "New thread" });
  const recent = dialog.getByRole("radiogroup", { name: "Recent repositories" });
  await expect.element(recent).toBeVisible();
  // Newest first, each once, at most five; the current choice is marked.
  const choices = () =>
    [...recent.element().querySelectorAll('[role="radio"]')].map(
      (radio) => `${radio.textContent}${radio.getAttribute("aria-checked") === "true" ? " ✓" : ""}`,
    );
  expect(choices()).toEqual(["charts", "tide ✓", "buoys", "harbour", "almanac"]);
  const picker = dialog.getByRole("combobox", { name: "Repository" });
  await expect.element(picker).toHaveValue("repo-0");

  // A click chooses the repository, as the picker does, and the thread starts there.
  await recent.getByRole("radio", { name: "buoys" }).click();
  await expect.element(picker).toHaveValue("repo-4");
  expect(choices()).toEqual(["charts", "tide", "buoys ✓", "harbour", "almanac"]);
  await picker.selectOptions("harbour");
  expect(choices()).toEqual(["charts", "tide", "buoys", "harbour ✓", "almanac"]);
  await dialog.getByRole("combobox", { name: "Task" }).fill("Add the moon's phase");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => host.started).toMatchObject([{ repositoryId: "repo-1" }]);
});

test("New thread shows no recent list with one repository", async () => {
  const host = createHost([thread("agent"), thread("second")], {
    past: [thread("third")],
  });
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  const dialog = page.getByRole("dialog", { name: "New thread" });
  await expect.element(dialog.getByRole("combobox", { name: "Repository" })).toBeVisible();
  await expect.poll(() => document.querySelector('[aria-label="Recent repositories"]')).toBeNull();
});
