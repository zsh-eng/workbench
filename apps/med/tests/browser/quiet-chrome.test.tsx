import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";
import { createBrowseApi } from "../../src/web/data/browse";
import { setChromeMode } from "../../src/web/data/chrome";
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
      comparison: saved[id]!.comparison,
      base: saved[id]!.comparison.kind === "range" ? base : head,
      head: saved[id]!.comparison.kind === "range" ? head : "working",
      captured: saved[id]!.comparison.kind === "working",
      ...(saved[id]!.names ? { names: saved[id]!.names } : {}),
    },
  ],
});
const thread = (id: string, patch: Partial<Thread> = {}): Thread => ({
  id,
  title: saved[id]!.title,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: Date.now() - 60_000,
  repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
  checkout: "/test/repo",
  branch: "main",
  ...patch,
});
const threads = [
  ...["week", "older", "model"].map((id) => thread(id)),
  thread("talk", { agent: "claude", state: "idle", sessions: [talkSession] }),
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
  setChromeMode("quiet", false);
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
    </WorkspaceHost>,
  );
}

const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
/** The review's row: its tabs and the controls after them. */
const row = () => shown()?.querySelector<HTMLElement>('[role="tablist"]')?.parentElement;
/** What the diff shows: in Changes the comparison, in Review the version (a
 * select, or text when there is one version). */
const comparison = () =>
  row()?.querySelector<HTMLElement>(
    '[aria-label="Comparison"], [aria-label="Review version"], [data-choice-static]',
  );
/** A Review of one version: "Version 1" and its age. */
const versionOne = /^Version 1 · (just now|\d+ (min|hr|day|days|mo|yr) ago)$/;
const openThread = async (title: string) => {
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: new RegExp(`^${title}`) }).click();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
};
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

test("Review names its version and age, and says a range by the names saved with it, or by short object IDs", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // Live, the row says the working changes in full.
  await expect.poll(() => comparison()?.textContent).toBe("Working changes");

  // A Review of one version: its number and age, as text with no menu. The
  // range that it shows is in the tooltip, with no Git comparison to choose.
  await openThread("Week view");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("week-target");
  await expect.poll(() => comparison()?.textContent).toMatch(versionOne);
  expect(comparison()?.tagName).not.toBe("BUTTON");
  expect(comparison()?.title).toBe("repo · main · main → week-view");
  // An older record has no names.
  await openThread("Older range");
  await expect.poll(() => comparison()?.title).toBe("repo · main · bbbbbbb → aaaaaaa");
  // Object IDs on main: the branch's newest commits.
  await openThread("Prediction model");
  await expect.poll(() => comparison()?.title).toBe("repo · main · 2 commits on main");
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
  await page.getByRole("tab", { name: "Commit", exact: true }).click();
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
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect.poll(() => stage()).toBeUndefined();

  // Full chrome keeps the Commit tab's own header.
  setChromeMode("full", false);
  await page.getByRole("tab", { name: "Commit", exact: true }).click();
  await expect.element(page.getByText("feature/commit-tab", { exact: true })).toBeVisible();
  await expect.element(files.getByRole("option").first()).toBeVisible();
  expect(stage()).toBeUndefined();
});

test("a narrow row shortens the comparison, then moves it into ⋯, and keeps ⋯ in view", async () => {
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
  // Review's version: with its age, then without, then in ⋯.
  const [long, short, menu] = [...seen.keys()];
  expect(long).toMatch(versionOne);
  expect([short, menu]).toEqual(["Version 1", "⋯"]);
  expect(seen.get(long!)).toBe(1280);

  // In ⋯, the comparison is the menu's first item: in Review, the version,
  // which has nothing to choose; in Changes, the comparisons.
  await page.viewport(seen.get("⋯")!, 800);
  await expect.poll(() => comparison()).toBeFalsy();
  const more = () =>
    [...row()!.querySelectorAll<HTMLElement>('[aria-label="More actions"]')].at(-1)!;
  more().click();
  await expect.element(page.getByRole("menuitem", { name: versionOne })).toBeDisabled();
  expect(page.getByRole("menuitem", { name: "Working changes" }).query()).toBeNull();
  await userEvent.keyboard("{Escape}");
  await page.getByRole("tab", { name: /^Changes/ }).click();
  more().click();
  await page.getByRole("menuitem", { name: "Working changes" }).hover();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Staged changes" }))
    .not.toBeChecked();
  await userEvent.keyboard("{Escape}{Escape}");

  // 600 px: the tabs keep their place and ⋯ its own.
  await page.viewport(600, 800);
  await frame();
  const changes = row()!.querySelector<HTMLElement>('[role="tab"]')!;
  expect(changes.getBoundingClientRect().width).toBeGreaterThan(0);

  // On the Commit tab, a row without room for Stage all gives it back to
  // the view's header, and the tabs keep that room. It returns to the row as
  // the row widens.
  await page.getByRole("tab", { name: "Commit", exact: true }).click();
  const stage = () =>
    [...row()!.querySelectorAll("button")].find((button) =>
      /^(Un)?[Ss]tage /.test(button.textContent ?? ""),
    );
  await expect.element(page.getByRole("button", { name: /^(Un)?[Ss]tage all$/ })).toBeVisible();
  await expect.poll(() => stage()).toBeUndefined();
  await page.viewport(1280, 800);
  await expect.poll(() => stage()?.textContent).toMatch(/^(Un)?[Ss]tage all$/);
});

test("the tabs keep their places as you switch between Review, Changes, and Commit", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await openThread("A thread about the export");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const names = ["Review", "Changes", "Commit"];
  const tab = (name: string) =>
    row()!.querySelector<HTMLElement>(`[role="tab"][aria-label="${name}"]`)!;
  const boxes = () =>
    names.map((name) => {
      const box = tab(name).getBoundingClientRect();
      return `${name} ${Math.round(box.left)}+${Math.round(box.width)}`;
    });
  for (const width of [1440, 900, 600]) {
    await page.viewport(width, 800);
    const seen: string[][] = [];
    for (const name of [...names, "Review"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect.poll(() => tab(name).getAttribute("aria-selected")).toBe("true");
      await frame();
      await frame();
      seen.push(boxes());
    }
    for (const entry of seen) expect(entry, `at ${width} px`).toEqual(seen[0]);
    // Changes has no count in a thread with a Review: it could not keep one
    // while Review shows.
    expect(tab("Changes").textContent).toBe("Changes");
  }
});

test("Push… waits for the remotes, with the reason in its tooltip", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const more = () =>
    [...row()!.querySelectorAll<HTMLElement>('[aria-label="More actions"]')].at(-1)!;
  more().click();
  const push = page.getByRole("menuitem", { name: "Push…" });
  await expect.element(push).toHaveAttribute("aria-disabled", "true");
  await expect.element(push).toHaveAttribute("aria-description", "Reading the remotes…");
  await push.hover();
  await expect.element(page.getByRole("tooltip", { name: "Reading the remotes…" })).toBeVisible();

  releaseRemotes();
  await expect.element(push).not.toHaveAttribute("aria-disabled", "true");
  await push.click();
  await expect.element(page.getByRole("dialog", { name: "Push to remote" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Push to origin" })).toBeVisible();
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
