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

// The turn recap (src/web/data/turn-recap.ts): a turn that ended while the
// reader did not see its session ends the session thread with the turn's
// facts, Review, and Reply. The host is a fake: its thread list and the
// session's transcript are what a Claude Code turn that asks a question gives.

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
  files: paths.map((path) => ({ path, status: "M", additions: 1, deletions: 1, binary: false })),
  patch,
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
});
const guide: ReviewGuide = {
  summary: "Tides and the moon.",
  segments: [
    { title: "Read the tides", summary: "The table reads hours.", files: ["src/tides.ts"] },
    { title: "Phase of the moon", summary: "The phase shows.", files: ["src/moon.ts"] },
  ],
};
const session = { agent: "claude" as const, id: "s1", cwd: "/test/repo" };
/** A saved review with the agent's session: a hand-off with a Guide, or none yet. */
const savedReview = (id: string, handoff: boolean) => ({
  id,
  title: "Week view",
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
  sessions: [session],
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
  ...(handoff
    ? { guide: { ...guide, updatedAt: "2026-10-01T00:00:00Z" } }
    : { totals: { files: 0, additions: 0, deletions: 0, comparisons: 1 } }),
});
const question = "I kept the station's own time. Should I switch it to yours?";
/** A turn that ended on a question, with its checks. */
const ended = (id: string, endedAt: number, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: "Week view",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: endedAt,
  repository: tide,
  checkout: "/test/repo",
  branch: "main",
  agent: "claude",
  state: "idle",
  sessions: [session],
  changes: { files: 2, additions: 14, deletions: 3 },
  turn: {
    startedAt: endedAt - 60_000,
    endedAt,
    said: question,
    asks: true,
    checks: [
      { name: "bun test", status: "passed", pass: 5 },
      { name: "tsc", status: "failed" },
    ],
  },
  ...patch,
});
const working = (id: string, at: number): Thread => ({
  ...ended(id, at),
  state: "working",
  turn: { startedAt: at, activity: "Running bun test" },
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
      content: { type: "text", text: `Fixed formatTime.\n\n${question}` },
    },
  },
];

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const KEYS = ["med:workspaces:v1", "med:window", "med:recap-seen", "med:recap-seen-since"];
beforeEach(async () => {
  await page.viewport(1280, 800);
  address = location.pathname + location.search;
  for (const key of KEYS) localStorage.removeItem(key);
  // Turns from before the recap's first visit count as seen; these are after it.
  localStorage.setItem("med:recap-seen-since", "1");
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  for (const key of KEYS) localStorage.removeItem(key);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:viewed:v1:recap-")) localStorage.removeItem(key);
  history.replaceState(null, "", address);
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

/** A host with one tab whose session's last turn asked a question. */
function createHost(tab: Thread, handoff: boolean) {
  let threads = [tab];
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const frame = () =>
    `event: state\ndata: ${JSON.stringify({ threads, repositories: [tide] })}\n\n`;
  const setThread = (next: Thread) => {
    threads = [next];
    for (const listener of listeners) listener.enqueue(new TextEncoder().encode(frame()));
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    const opened = /^\/api\/threads\/([\w-]+)\/open$/.exec(url.pathname);
    if (opened) return Response.json({ thread: threads[0] });
    if (/^\/api\/reviews\/[\w-]+\/sessions\/s1\/events$/.test(url.pathname))
      return stream(
        init,
        `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
      );
    if (/^\/api\/reviews\/[\w-]+\/agent\/events$/.test(url.pathname))
      return stream(
        init,
        `event: state\ndata: ${JSON.stringify({ messages: [], waiting: [], drafts: [] })}\n\n`,
      );
    const target = /^\/api\/reviews\/([\w-]+)\/targets\/[\w-]+\/(review|notes)$/.exec(url.pathname);
    if (target?.[2] === "review")
      return Response.json(reviewFor({ kind: "working" }, `${target[1]}-target`));
    if (target?.[2] === "notes")
      return Response.json({ reviewId: `${target[1]}-target`, revision: 0, notes: [] });
    const saved = /^\/api\/reviews\/([\w-]+)$/.exec(url.pathname);
    if (saved) return Response.json(savedReview(saved[1]!, handoff));
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
          agents: [{ id: "claude", name: "Claude Code", kind: "claude", available: true }],
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
  return { fetcher, setThread };
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

const recap = page.getByRole("region", { name: "Turn recap" });
const shownRecap = () => document.querySelector<HTMLElement>("[data-recap]");
/** The session's message box. */
const composer = () => document.querySelector<HTMLTextAreaElement>("[data-session-panel] textarea");

/** Opens the tab, whose session leads it. */
async function openSession() {
  await userEvent.click(page.getByRole("button", { name: /^Week view/ }));
  const thread = page.getByRole("log", { name: "Session" });
  await expect.element(thread.getByText(question)).toBeVisible();
}

test("a turn that asked a question ends with its facts; Review opens the Guide's first segment not viewed", async () => {
  const id = "recap-guide";
  // The first segment's file is viewed already.
  localStorage.setItem(`med:viewed:v1:${id}`, JSON.stringify(["src/tides.ts\u00002222222"]));
  const host = createHost(ended(id, Date.now() - 5_000), true);
  render(host);
  await openSession();

  // One quiet line of facts under the reply: files, lines, and checks. The
  // reply above is not repeated.
  await expect.element(recap).toBeVisible();
  const facts = recap.element().querySelector("p")!;
  expect(facts.textContent).toBe("2 files·+14−3·bun test 5 pass·tsc fail");
  expect(recap.element().textContent).not.toContain("Should I switch");
  // A failed check is in the error colour; the counts use tabular figures.
  const failed = recap.element().querySelector<HTMLElement>('[data-check="failed"]')!;
  const passed = recap.element().querySelector<HTMLElement>('[data-check="passed"]')!;
  expect(getComputedStyle(failed).color).not.toBe(getComputedStyle(passed).color);
  expect(getComputedStyle(facts).fontVariantNumeric).toBe("tabular-nums");
  // Review is the only primary button; Reply and × follow.
  await expect.element(recap.getByRole("button", { name: /^Review/ })).toBeVisible();
  await expect.element(recap.getByRole("button", { name: "Reply" })).toBeVisible();
  await expect.element(recap.getByRole("button", { name: "Hide the recap" })).toBeVisible();

  // Reply puts the focus in the message box.
  await userEvent.click(recap.getByRole("button", { name: "Reply" }));
  expect(document.activeElement).toBe(composer());

  // Review: the turn is seen, and the Guide shows its first segment that is
  // not viewed. The recap keeps its place out of sight, so nothing moves.
  const before = shownRecap()!.getBoundingClientRect();
  await userEvent.click(recap.getByRole("button", { name: /^Review/ }));
  await expect.element(page.getByRole("heading", { name: "Phase of the moon" })).toBeVisible();
  await expect
    .element(page.getByRole("tab", { name: "Review", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.poll(() => shownRecap()?.dataset.recap).toBe("hidden");
  expect(getComputedStyle(shownRecap()!).visibility).toBe("hidden");
  const after = shownRecap()!.getBoundingClientRect();
  expect([after.top, after.height]).toEqual([before.top, before.height]);
  expect(JSON.parse(localStorage.getItem("med:recap-seen")!)).toEqual({
    [id]: expect.any(Number),
  });
});

test("before a hand-off Review opens Changes at the first file; ⌥↵ works from the message box, Esc hides, and the next unseen turn shows a new recap", async () => {
  const id = "recap-changes";
  const first = Date.now() - 5_000;
  const host = createHost(ended(id, first), false);
  render(host);
  await openSession();
  await expect.element(recap).toBeVisible();
  // No Review yet: the tab row has no Review tab.
  expect(page.getByRole("tab", { name: "Review", exact: true }).query()).toBeNull();

  // ⌥↵ from the message box opens Changes at its first file; the box gets no new line.
  composer()!.focus();
  await userEvent.keyboard("{Alt>}{Enter}{/Alt}");
  await expect
    .element(page.getByRole("tab", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  await expect.poll(() => shownRecap()?.dataset.recap).toBe("hidden");
  expect(composer()!.value).toBe("");
  await expect
    .poll(() => document.querySelector("[data-stream-file]")?.textContent)
    .toContain("tides.ts");

  // The next turn works while the reader watches its session, and ends: seen,
  // so no recap.
  const activity = page.getByText("Running bun test");
  host.setThread(working(id, first + 10_000));
  await expect.element(activity).toBeVisible();
  expect(shownRecap()).toBeNull();
  host.setThread(ended(id, first + 20_000));
  await expect.element(activity).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(shownRecap()).toBeNull();

  // A turn that ends while the window hides comes unseen: a new recap.
  host.setThread(working(id, first + 30_000));
  await expect.element(activity).toBeVisible();
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  host.setThread(ended(id, first + 40_000, { changes: { files: 1, additions: 2, deletions: 0 } }));
  await expect.poll(() => shownRecap()?.dataset.recap).toBe("shown");
  delete (document as unknown as Record<string, unknown>).visibilityState;
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.element(recap.getByText("1 file", { exact: true })).toBeVisible();

  // Esc, with the focus in the recap, hides it until the next turn; the
  // thread keeps the focus.
  (recap.getByRole("button", { name: "Reply" }).element() as HTMLElement).focus();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => shownRecap()?.dataset.recap).toBe("hidden");
  expect(document.activeElement?.classList.contains("med-thread-scroller")).toBe(true);
  // The tab row did not move: Esc went to the recap only.
  await expect
    .element(page.getByRole("tab", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-selected", "true");
});
