import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { AppTooltip } from "../../src/web/components/ToolButton";
import { comparisonLabel } from "../../src/web/components/QuietChrome";
import { SourcesView } from "../../src/web/components/SourcesPage";
// The window's top row, as main.tsx loads it.
import "../../src/web/components/TitleRow.css";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";
import { createBrowseApi } from "../../src/web/data/browse";
import type { CommitApi } from "../../src/web/data/commit";
import type { Comparison } from "../../src/shared/protocol";
import type { EndpointNames } from "../../src/shared/saved-review";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

// The review pane's one row with quiet chrome: what the diff compares, the
// Commit tab's Stage all, a narrow row, Push…, and the title band's inset.

const head = "a".repeat(40);
const base = "b".repeat(40);
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "fixture",
    branches: [{ name: "main", head, worktreePath: "/test/repo", current: true }],
    worktrees: [{ path: "/test/repo", head, branch: "main" }],
  },
];
const patch = ["alpha.ts", "beta.ts"]
  .map(
    (path) =>
      `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
  )
  .join("");
const range: Comparison = { kind: "range", base, head, includeBase: false };
/** Saved reviews: a range with its endpoints' names, an older record without
 * them, an agent's commits on main, and working changes with a session. */
const saved: Record<string, { title: string; comparison: Comparison; names?: EndpointNames }> = {
  week: { title: "Week view", comparison: range, names: { base: "main", head: "week-view" } },
  older: { title: "Older range", comparison: range },
  model: {
    title: "Prediction model",
    comparison: range,
    names: { head: "main", on: { branch: "main", commits: 2 } },
  },
  talk: { title: "A thread about the export with a long title", comparison: { kind: "working" } },
  // A long title and branch for the title band.
};
const talkSession = { agent: "claude" as const, id: "talk-session", cwd: "/test/repo" };
const reviewFor = (comparison: Comparison, id: string) => ({
  id,
  repo: "/test/repo",
  comparison,
  base: comparison.kind === "range" ? base : head,
  head: comparison.kind === "range" ? head : "working",
  label: "Review",
  files: ["alpha.ts", "beta.ts"].map((path) => ({
    path: `src/${path}`,
    status: "M",
    additions: 1,
    deletions: 1,
    binary: false,
  })),
  patch,
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
});
const savedReview = (id: string) => ({
  id,
  title: saved[id]!.title,
  ...(id === "talk" ? { session: talkSession } : {}),
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
      comparison: saved[id]!.comparison,
      base: saved[id]!.comparison.kind === "range" ? base : head,
      head: saved[id]!.comparison.kind === "range" ? head : "working",
      captured: saved[id]!.comparison.kind === "working",
      ...(saved[id]!.names ? { names: saved[id]!.names } : {}),
    },
  ],
});
/** A review's row: its own, or its session's, which `patch` makes. */
const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  kind: "review",
  title: saved[id]!.title,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: Date.now() - 60_000,
  reviews: [
    {
      id,
      title: saved[id]!.title,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: Date.now() - 60_000,
    },
  ],
  repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
  checkout: "/test/repo",
  branch: "main",
  ...patch,
});
/** The talk session's thread, with the review that it handed off. */
const TALK_THREAD = `claude-${talkSession.id}`;
const threads = [
  ...["week", "older", "model"].map((id) => thread(id)),
  thread("talk", {
    id: TALK_THREAD,
    kind: "session",
    agent: "claude",
    state: "idle",
    session: talkSession,
  }),
];

/** An event stream that stays open until the page closes it. */
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

const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input), "http://localhost");
  const repo = url.searchParams.get("repo") || "/test/repo";
  if (url.pathname === `/api/sessions/${TALK_THREAD}/events`) {
    const reset = {
      events: [
        {
          at: 1,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: "Rename the export." },
          },
        },
      ],
      idle: true,
      modifiedAt: 0,
      truncated: false,
    };
    return stream(init, `event: reset\ndata: ${JSON.stringify(reset)}\n\n`);
  }
  const savedRoute = /^\/api\/reviews\/(\w+)(?:\/targets\/[\w-]+\/(review|notes))?$/.exec(
    url.pathname,
  );
  if (savedRoute && saved[savedRoute[1]!]) {
    const id = savedRoute[1]!;
    if (savedRoute[2] === "review")
      return Response.json(reviewFor(saved[id]!.comparison, `${id}-target`));
    if (savedRoute[2] === "notes")
      return Response.json({ reviewId: `${id}-target`, revision: 0, notes: [] });
    return Response.json(savedReview(id));
  }
  switch (url.pathname) {
    case "/api/repositories":
      return Response.json({ repositories });
    case "/api/session":
      return Response.json({
        protocol: 1,
        repositories,
        repositoryId: "repo-0",
        repository: {
          path: repo,
          name: "fixture",
          head,
          branch: "main",
          shallow: false,
          git: true,
        },
        worktrees: repositories[0]!.worktrees,
      });
    case "/api/branches":
      return Response.json(repositories[0]!.branches);
    case "/api/review": {
      const body = JSON.parse(String(init?.body)) as { comparison: Comparison };
      return Response.json(reviewFor(body.comparison, `live-${body.comparison.kind}`));
    }
    case "/api/notes":
      return Response.json({ reviewId: url.searchParams.get("reviewId"), revision: 0, notes: [] });
    case "/api/threads/events":
      return stream(
        init,
        `event: state\ndata: ${JSON.stringify({ threads, repositories: [repositories[0]] })}\n\n`,
      );
    case "/api/events":
    case "/api/windows":
      return stream(init);
    case "/api/browse/list":
      return Response.json({
        source: JSON.parse(String(init?.body)).source,
        entries: [],
        truncated: false,
      });
  }
  // A session's inbox and controls, and the rest: none here.
  return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
};

// Push… and the base branch menu read the remotes with the page's own fetch.
const pageFetch = globalThis.fetch;
let releaseRemotes = () => {};
let root: Root | undefined;
let mount: HTMLDivElement | undefined;
const address = location.pathname + location.search;

beforeEach(async () => {
  await page.viewport(1280, 800);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
  const remotes = new Promise<void>((resolve) => (releaseRemotes = resolve));
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("/api/git/targets")) return pageFetch(input, init);
    await remotes;
    return Response.json({
      branch: "main",
      head,
      refs: [{ name: "refs/heads/main", label: "main" }],
      remotes: [{ name: "origin", branches: ["main"] }],
    });
  };
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  globalThis.fetch = pageFetch;
  const html = document.documentElement;
  delete html.dataset.titlebar;
  for (const name of ["--med-titlebar-height", "--med-titlebar-left", "--med-titlebar-right"])
    html.style.removeProperty(name);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
  history.replaceState(null, "", address);
});

function render(commit?: CommitApi) {
  initializeTheme();
  themeController.commit("graphite-dark");
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const browse = createBrowseApi(fetcher, "fixture");
  root.render(
    <>
      <AppTooltip />
      <WorkspaceHost fetch={fetcher}>
        <WorkspaceViews options={{ fetch: fetcher }}>
          {(controller) => (
            <App
              controller={controller}
              browseApi={browse}
              {...(commit ? { commitApi: () => commit } : {})}
            />
          )}
        </WorkspaceViews>
      </WorkspaceHost>
    </>,
  );
}

const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
/** The review's header: in its pane, or, where the review fills the window,
 * the title band, which is then the review's one row. */
const row = () =>
  shown()?.querySelector<HTMLElement>('header[aria-label="Review header"]') ?? undefined;
/** What the diff shows: in Changes the comparison (atop the page's sidebar,
 * or in the header while it hides), in Review the checkout, when it has
 * several. */
const comparison = () =>
  (shown()?.querySelector<HTMLElement>(
    '[aria-label="Comparison"], [aria-label="Review checkout"]',
  ) ??
    row()?.querySelector<HTMLElement>(
      '[aria-label="Comparison"], [aria-label="Review checkout"]',
    )) ||
  null;
/** Opens a thread from the sidebar. It opens on its session alone; with
 * `review`, its first page in the title band opens the review beside it. */
const openThread = async (title: string, { review = true } = {}) => {
  const sidebar = page.getByRole("navigation", { name: "Sessions" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  const before = shown();
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  // The workspace before stays on screen until the thread's is ready.
  await expect.poll(() => shown() !== before && shown()?.dataset.reviewStatus).toBe("ready");
  if (!review || reviewPane()) return;
  await page.getByRole("group", { name: "Review tools" }).getByRole("radio").first().click();
  await expect.poll(reviewPane).toBeTruthy();
};
const reviewPane = () =>
  [...document.querySelectorAll<HTMLElement>('[data-pane="review"]')].find((element) =>
    element.checkVisibility(),
  );
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
/** The middle of an element's box, from the window's top. */
const middle = (element: Element) => {
  const box = element.getBoundingClientRect();
  return (box.top + box.bottom) / 2;
};
/** The installed app with its title bar hidden: Chrome's strip, `height` px
 * tall, with the traffic lights at its left and Chrome's buttons at its right. */
function hideTitleBar(height: number) {
  const html = document.documentElement;
  html.dataset.titlebar = "overlay";
  html.style.setProperty("--med-titlebar-height", `${height}px`);
  html.style.setProperty("--med-titlebar-left", "86px");
  html.style.setProperty("--med-titlebar-right", "100px");
}

test("Review names no version, and one checkout leaves nothing to choose", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // Live, the row says the working changes in full.
  await expect.poll(() => comparison()?.textContent).toBe("Working changes");

  // A Review of one checkout: no menu, no version, no Git comparison.
  await openThread("Week view");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("week-target");
  await expect.poll(() => comparison()).toBeFalsy();
  expect(row()!.textContent).not.toMatch(/Version \d/);
  // A checkout menu says a range by the names saved with it, or by short
  // object IDs in an older record, or as a branch's newest commits.
  expect(comparisonLabel(range, saved.week!.names).long).toBe("main → week-view");
  expect(comparisonLabel(range).long).toBe("bbbbbbb → aaaaaaa");
  expect(comparisonLabel(range, saved.model!.names).long).toBe("2 commits on main");
});

test("the Commit tab's Stage all is in the review's row, and the tab does not name the branch again", async () => {
  const repository = createFakeRepository({
    upstream: false,
    hookFails: false,
    pushRejected: false,
    slow: false,
  });
  render(repository.api);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await page.getByRole("radio", { name: "Commit", exact: true }).click();
  const files = page.getByRole("listbox", { name: "Changed files" });
  await expect.element(files).toBeVisible();
  const stage = () =>
    [...(row()?.querySelectorAll("button") ?? [])].find((button) =>
      /^(Un)?[Ss]tage /.test(button.textContent ?? ""),
    );
  await expect.poll(() => stage()?.textContent).toBe("Stage all");
  // The view's own header, which said the branch beside Stage all, is gone.
  await expect
    .element(page.getByText("feature/commit-tab", { exact: true }))
    .not.toBeInTheDocument();
  stage()!.click();
  await expect
    .poll(() =>
      files
        .getByRole("option")
        .elements()
        .every((option) => /, staged\b/.test(option.getAttribute("aria-label") ?? "")),
    )
    .toBe(true);
  await expect.poll(() => stage()?.textContent).toBe("Unstage all");
  // Changes has no Stage all.
  await page.getByRole("radio", { name: /^Changes/ }).click();
  await expect.poll(() => stage()).toBeUndefined();
});

test("a narrow row keeps ⋯ in view, and the comparison and Stage all keep their room", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("A thread about the export");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  await expect
    .element(page.getByRole("region", { name: "Claude session" }).getByText("Rename the export."))
    .toBeVisible();

  // From wide to narrow, with the session beside the review.
  const seen = new Map<string, number>();
  for (let width = 1280; width >= 600; width -= 20) {
    await page.viewport(width, 800);
    await frame();
    const line = row()!;
    const more = [...line.querySelectorAll('[aria-label="More actions"]')].at(-1)!;
    // ⋯ stays in the row, whatever the tabs need.
    expect(more.getBoundingClientRect().right, `⋯ at ${width} px`).toBeLessThanOrEqual(
      line.getBoundingClientRect().right,
    );
    expect(more.getBoundingClientRect().width).toBeGreaterThan(0);
    // A label that shows is whole, never cut to "Wor…", once the row has
    // measured its new width.
    const value = () => comparison()?.querySelector<HTMLElement>("[data-choice-value]");
    await expect
      .poll(() => (value() ? value()!.scrollWidth - value()!.clientWidth : 0), { timeout: 1000 })
      .toBeLessThanOrEqual(1);
    const label = value()?.textContent ?? "⋯";
    if (!seen.has(label)) seen.set(label, width);
  }
  // Review names no comparison at any width.
  expect([...seen.keys()]).toEqual(["⋯"]);

  // In Changes, beside the session, the comparison keeps its place in the
  // row at every width, whole: the pages are in the title row, so the second
  // row has room for it, and ⋯ stays in view.
  await page.getByRole("radio", { name: /^Changes/ }).click();
  for (let width = 1280; width >= 600; width -= 40) {
    await page.viewport(width, 800);
    await frame();
    const line = row()!;
    const more = [...line.querySelectorAll('[aria-label="More actions"]')].at(-1)!;
    expect(more.getBoundingClientRect().right, `⋯ at ${width} px`).toBeLessThanOrEqual(
      line.getBoundingClientRect().right,
    );
    const value = () => comparison()?.querySelector<HTMLElement>("[data-choice-value]");
    await expect.poll(() => value()?.textContent, { timeout: 1000 }).toBe("Working changes");
    await expect
      .poll(() => value()!.scrollWidth - value()!.clientWidth, { timeout: 1000 })
      .toBeLessThanOrEqual(1);
  }

  // 600 px: the pages keep their place in the title row.
  const changes = page.getByRole("radio", { name: "Changes", exact: true }).element();
  expect(changes.getBoundingClientRect().width).toBeGreaterThan(0);

  // On the Commit page, Stage all is in the row beside the title at every
  // width: the pages left the row the room for it.
  await page.getByRole("radio", { name: "Commit", exact: true }).click();
  const stage = () =>
    [...row()!.querySelectorAll("button")].find((button) =>
      /^(Un)?[Ss]tage /.test(button.textContent ?? ""),
    );
  await expect.poll(() => stage()?.textContent).toMatch(/^(Un)?[Ss]tage all$/);
  await page.viewport(2400, 800);
  await expect.poll(() => stage()?.textContent).toMatch(/^(Un)?[Ss]tage all$/);
});

test("the tabs keep their places as you switch between Review, Changes, and Commit", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("A thread about the export");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const names = ["Review", "Changes", "Commit"];
  // The pages are in the review's title row, in the band above it here.
  const tab = (name: string) =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="radiogroup"][aria-label="Page"] [role="radio"]',
      ),
    ].find((radio) => radio.checkVisibility() && radio.getAttribute("aria-label") === name)!;
  const boxes = () =>
    names.map((name) => {
      const box = tab(name).getBoundingClientRect();
      return `${name} ${Math.round(box.left)}+${Math.round(box.width)}`;
    });
  // Beside the session, at a width with room for the header's pages.
  for (const width of [1440]) {
    await page.viewport(width, 800);
    // The thread opened Review; Review again would hide the review.
    const seen: string[][] = [boxes()];
    for (const name of ["Changes", "Commit", "Review"]) {
      await page.getByRole("radio", { name, exact: true }).click();
      await expect.poll(() => tab(name).getAttribute("aria-checked")).toBe("true");
      await frame();
      await frame();
      seen.push(boxes());
    }
    for (const entry of seen) expect(entry, `at ${width} px`).toEqual(seen[0]);
    // The pages are icons: no count or name that could change their width.
    expect(tab("Changes").textContent).toBe("");
  }
});

/** The element on screen that matches a selector. */
const visible = (selector: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].find((element) =>
    element.checkVisibility(),
  );
/** The Changes page's sidebar on screen. */
const changesSidebar = () => visible('nav[aria-label="Files and commits"]');
const hideChanged = page.getByRole("button", { name: "Hide changed files" });
const showChanged = page.getByRole("button", { name: "Show changed files" });

test("the Changes page's sidebar hides from its heading, comes back by the header's button, ⌘⌥B, and ⌘K, and stays as chosen after a restart", async () => {
  await page.viewport(1600, 900);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("Week view");
  await page.getByRole("radio", { name: "Changes", exact: true }).click();
  await expect.poll(changesSidebar).toBeTruthy();
  // What the diff compares tops it.
  expect(changesSidebar()!.contains(comparison()!)).toBe(true);
  // Its heading hides it, and the tooltip names the shortcut.
  expect(hideChanged.element().getAttribute("data-tooltip-keys")).toBe("Mod+Alt+B");
  await hideChanged.click();
  await expect.poll(changesSidebar).toBeUndefined();
  // Hidden, its button is at the start of the review's header, with the
  // focus, and the comparison is in the header.
  await expect.element(showChanged).toBeVisible();
  expect(row()!.contains(showChanged.element())).toBe(true);
  await expect.poll(() => document.activeElement).toBe(showChanged.element());
  expect(row()!.contains(comparison()!)).toBe(true);
  expect(localStorage.getItem("med:changes-rail")).toBe("closed");
  await showChanged.click();
  await expect.poll(changesSidebar).toBeTruthy();
  await expect.element(showChanged).not.toBeInTheDocument();

  // ⌘⌥B and ⌘K show it too; ⋯ holds only what a narrow row folds.
  await userEvent.keyboard("{Control>}{Alt>}b{/Alt}{/Control}");
  await expect.poll(changesSidebar).toBeUndefined();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Show changed files");
  await page.getByRole("option", { name: /^Show changed files/ }).click();
  await expect.poll(changesSidebar).toBeTruthy();

  // Hidden, it stays hidden when Med opens again.
  await hideChanged.click();
  await expect.poll(changesSidebar).toBeUndefined();
  root!.unmount();
  mount!.remove();
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await page.getByRole("radio", { name: "Changes", exact: true }).click();
  await expect.element(showChanged).toBeVisible();
  expect(changesSidebar()).toBeUndefined();
});

test("a hidden session pane comes back by its button where it was, and ⌘K hides the session rail where it has room", async () => {
  await page.viewport(1920, 900);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("A thread about the export");
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  const session = () => visible('[data-pane="session"]');
  await expect.poll(session).toBeTruthy();
  const showSession = page.getByRole("button", { name: "Show agent session" });
  // The session is open, so the review's row has no button for it.
  expect(showSession.query()).toBeNull();

  // Its session rail has room: ⌘K hides it as its own button does.
  const side = () => visible("[data-session-rail-toggle]");
  await expect.poll(() => side()?.getAttribute("aria-pressed")).toBe("true");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("session rail");
  await page.getByRole("option", { name: /^Hide session rail/ }).click();
  await expect.poll(() => side()?.getAttribute("aria-pressed")).toBe("false");
  expect(localStorage.getItem("med:session-panel")).toBe("closed");

  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Hide agent session");
  await page.getByRole("option", { name: /^Hide agent session/ }).click();
  await expect.poll(session).toBeUndefined();
  await expect.element(showSession).toBeVisible();
  expect(row()!.querySelector('[data-pane-show="session"]')).toBe(showSession.element());
  // ⌘⇧B is the review's: the button names no keys.
  expect(showSession.element().getAttribute("data-tooltip-keys")).toBeNull();
  expect(document.activeElement).toBe(showSession.element());
  await showSession.click();
  await expect.poll(session).toBeTruthy();
  expect(showSession.query()).toBeNull();
});

test("a thread opens on its session; the band's pages show and hide the review, and ⌘E expands it or the session", async () => {
  await page.viewport(1600, 900);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // Alone, the review has no Expand: it is the whole workspace, and stays.
  expect(page.getByRole("button", { name: "Expand review" }).query()).toBeNull();
  await openThread("A thread about the export", { review: false });
  await page.getByRole("button", { name: "Hide sidebar" }).click();
  const session = () => visible('[data-pane="session"]');
  await expect.poll(session).toBeTruthy();
  expect(reviewPane()).toBeUndefined();
  // The session has no Expand or Hide of its own.
  expect(
    page.getByRole("button", { name: /^Expand session|^Hide the session/ }).query(),
  ).toBeNull();

  // The band's pages, with the review's actions and Display, show while the
  // review hides. A page opens it beside the thread, and the page on screen,
  // clicked again, hides it.
  const tools = page.getByRole("group", { name: "Review tools" });
  await expect.element(tools.getByRole("button", { name: "Display" })).toBeVisible();
  const reviewPage = tools.getByRole("radio", { name: "Review" });
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "false");
  await reviewPage.click();
  await expect.poll(reviewPane).toBeTruthy();
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "true");
  await reviewPage.click();
  await expect.poll(reviewPane).toBeUndefined();
  await expect.poll(session).toBeTruthy();

  // ⌘E opens the hidden review expanded, and restores the thread beside it.
  const sessionInert = () => document.querySelector<HTMLElement>('[data-pane="session"]')!.inert;
  await userEvent.keyboard("{Meta>}e{/Meta}");
  await expect.poll(reviewPane).toBeTruthy();
  await expect.poll(sessionInert).toBe(true);
  await userEvent.keyboard("{Meta>}e{/Meta}");
  await expect.poll(sessionInert).toBe(false);

  // In the session beside the review, ⌘E expands the session instead, and
  // restores the review. While it hides behind the session, no page is on
  // screen, and a page shows the review again.
  const reviewInert = () => document.querySelector<HTMLElement>('[data-pane="review"]')!.inert;
  session()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await userEvent.keyboard("{Meta>}e{/Meta}");
  await expect.poll(reviewInert).toBe(true);
  expect(sessionInert()).toBe(false);
  await userEvent.keyboard("{Meta>}e{/Meta}");
  await expect.poll(reviewInert).toBe(false);
  session()!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await userEvent.keyboard("{Meta>}e{/Meta}");
  await expect.poll(reviewInert).toBe(true);
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "false");
  await reviewPage.click();
  await expect.poll(reviewInert).toBe(false);
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "true");
  expect(sessionInert()).toBe(false);

  // Beside the session, Expand ends the review's own row, which has no
  // pages and no Hide: the band holds the pages.
  const expand = page.getByRole("button", { name: "Expand review" });
  await expect.element(expand).toBeVisible();
  expect(row()!.contains(expand.element())).toBe(true);
  expect(row()!.querySelector('[role="radiogroup"][aria-label="Page"]')).toBeNull();
  expect(page.getByRole("button", { name: "Hide the review" }).query()).toBeNull();
  await expand.click();
  await expect.poll(sessionInert).toBe(true);
  await page.getByRole("button", { name: "Restore the other panes" }).click();
  await expect.poll(sessionInert).toBe(false);

  // ⌘K hides it too, and ⌘⇧B shows it again beside the session.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Hide review");
  await page.getByRole("option", { name: /^Hide review/ }).click();
  await expect.poll(reviewPane).toBeUndefined();
  const press = () => userEvent.keyboard("{Control>}{Shift>}b{/Shift}{/Control}");
  await press();
  await expect.poll(reviewPane).toBeTruthy();
  await expect.poll(session).toBeTruthy();
  // With the session hidden, ⌘⇧B hides the review and the session comes back,
  // so the workspace keeps a pane.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Hide agent session");
  await page.getByRole("option", { name: /^Hide agent session/ }).click();
  await expect.poll(session).toBeUndefined();
  await press();
  await expect.poll(reviewPane).toBeUndefined();
  await expect.poll(session).toBeTruthy();
  await press();
  await expect.poll(reviewPane).toBeTruthy();

  // A narrow row puts Expand in ⋯, with no Hide.
  await page.viewport(700, 800);
  await expect
    .poll(() => document.querySelector('[aria-label="Expand review"]')?.checkVisibility() ?? false)
    .toBe(false);
  const more = [...row()!.querySelectorAll<HTMLElement>('[aria-label="More actions"]')].at(-1)!;
  more.click();
  await expect.element(page.getByRole("menuitem", { name: /^Expand review/ })).toBeVisible();
  expect(page.getByRole("menuitem", { name: "Hide review" }).query()).toBeNull();
  await userEvent.keyboard("{Escape}");
});

/**
 * What the browser painted while `act` ran, and in the frames after it, in
 * order and without repeats. A ResizeObserver runs after a frame's animation
 * callbacks and before its paint, so the last record of a frame is what it
 * painted.
 */
async function painted(watched: Element, read: () => string, act: () => Promise<void>) {
  const frames = new Map<number, string>();
  let at = 0;
  let on = true;
  const tick = () => {
    if (!on) return;
    frames.set(++at, read());
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const observer = new ResizeObserver(() => frames.set(at, read()));
  observer.observe(watched);
  await act();
  for (let count = 0; count < 10; count++) await frame();
  on = false;
  observer.disconnect();
  return [...frames.values()].filter((value, index, all) => value !== all[index - 1]);
}

test("the sidebar moves the session pane and its session rail in one frame, as wide as they end", async () => {
  // With the sidebar, the session pane is too narrow for its session rail;
  // without it, the panel has room.
  await page.viewport(2050, 900);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("A thread about the export");
  const pane = () => visible("[data-session-panel]");
  await expect.poll(pane).toBeTruthy();
  // The pane's width, and where its side panel starts when it has one.
  const read = () =>
    `${pane()!.clientWidth} ${visible('[aria-label="Session rail"]')?.getBoundingClientRect().x ?? "none"}`;
  const start = read();
  expect(start).toMatch(/ none$/);
  const hidden = await painted(pane()!, read, () =>
    page.getByRole("button", { name: "Hide sidebar" }).click(),
  );
  expect(hidden).toHaveLength(2);
  expect(hidden[0]).toBe(start);
  expect(hidden[1]).not.toMatch(/ none$/);
  const shownAgain = await painted(pane()!, read, () =>
    page.getByRole("button", { name: "Show sidebar" }).click(),
  );
  expect(shownAgain).toEqual([hidden[1], start]);
});

test("Push… waits for the remotes, with the reason beside it in ⌘K", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // ⋯ holds only what a narrow row folds; Push is in ⌘K.
  expect(row()!.querySelector('[aria-label="More actions"]')).toBeNull();
  await userEvent.keyboard("{Control>}k{/Control}");
  const push = page.getByRole("option", { name: /^Push to remote…/ });
  await expect.element(push).toHaveAttribute("aria-disabled", "true");
  await expect.element(push).toHaveAccessibleDescription("Reading the remotes…");

  releaseRemotes();
  await expect.element(push).not.toHaveAttribute("aria-disabled", "true");
  await push.click();
  await expect.element(page.getByRole("dialog", { name: "Push to remote" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Push to origin" })).toBeVisible();
});

test("the installed app's top row is the strip's height, so its controls sit on the window controls' centre line", async () => {
  hideTitleBar(38);
  await page.viewport(460, 800);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const band = page.getByRole("banner", { name: "Workspace" });
  const toggle = band.getByRole("button", { name: "Show sidebar" });
  await expect.element(toggle).toBeVisible();
  // macOS's strip, and Windows' lower one.
  for (const height of [38, 33]) {
    hideTitleBar(height);
    const row = band.element().getBoundingClientRect();
    expect(row.height).toBe(height);
    expect(middle(toggle.element()) - row.top).toBeCloseTo(height / 2, 1);
  }
});

test("a page's header in the title bar puts its controls on the window controls' centre line", async () => {
  hideTitleBar(38);
  await page.viewport(1280, 800);
  initializeTheme();
  mount = document.createElement("div");
  // As #root in the installed app: a view starts below the strip.
  mount.style.cssText =
    "position:fixed;inset:0;display:flex;flex-direction:column;box-sizing:border-box;padding-top:var(--med-titlebar-height)";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <SourcesView
      sources={[]}
      loaded={false}
      tab
      onBack={() => {}}
      onOpen={() => {}}
      onAdd={() => {}}
      onRequest={async () => {}}
      onCommands={() => {}}
    />,
  );
  const card = page.getByRole("main", { name: "Sources" });
  const back = card.getByRole("button", { name: "Back" });
  await expect.element(back).toBeVisible();
  const parts = [
    back,
    card.getByRole("button", { name: "Add sources…" }),
    card.getByRole("button", { name: "Commands" }),
    card.getByRole("heading", { name: "Sources" }),
  ];
  // macOS's strip and a taller one: the strip's centre line. A strip lower
  // than 38 px keeps a 38 px header: its controls sit at 19 px, below that
  // strip's centre.
  for (const [height, line] of [
    [38, 19],
    [44, 22],
    [33, 19],
  ] as const) {
    hideTitleBar(height);
    await frame();
    for (const part of parts) expect(middle(part.element())).toBeCloseTo(line, 1);
    // The header starts at the window's top, and its controls are inside it.
    const edge = card.element().getBoundingClientRect().top;
    for (const part of parts.slice(0, 3))
      expect(part.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(edge + 2);
  }
});

test("the title band keeps clear of window controls at its right", async () => {
  // The installed app's title bar, with its controls at the right, as on
  // Windows and Linux.
  const html = document.documentElement;
  html.dataset.titlebar = "overlay";
  html.style.setProperty("--med-titlebar-height", "38px");
  html.style.setProperty("--med-titlebar-left", "0px");
  html.style.setProperty("--med-titlebar-right", "140px");
  await page.viewport(460, 800);
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // A narrow window hides the sidebar, so the band names the thread too.
  await openThread("A thread about the export");
  const band = page.getByRole("banner", { name: "Workspace" });
  await expect.element(band.getByText(saved.talk!.title, { exact: true })).toBeVisible();
  const header = band.element() as HTMLElement;
  const right = Math.max(
    ...[...header.querySelectorAll("*")].map((element) => element.getBoundingClientRect().right),
  );
  expect(right).toBeLessThanOrEqual(innerWidth - 140);
  // The band's own controls stay in view.
  expect(
    (
      band.getByRole("button", { name: "Show sidebar" }).element() as HTMLElement
    ).getBoundingClientRect().left,
  ).toBeGreaterThanOrEqual(0);
});
