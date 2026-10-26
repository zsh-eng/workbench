import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { AppTooltip } from "../../src/web/components/ToolButton";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import { setChromeMode } from "../../src/web/data/chrome";
import type { Comparison, PullRequestComments } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

// GitHub threads on a thread's Changes, in quiet chrome: a branch whose tip is
// the pull request head shows them at their lines, except in files with
// edits after that commit; the review's row counts the comments in words.

const tip = "a".repeat(40);
const base = "b".repeat(40);
const pullUrl = "https://github.com/acme/app/pull/7";
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "fixture",
    branches: [
      { name: "main", head: base, worktreePath: "/test/repo", current: true },
      { name: "feature", head: tip, worktreePath: "/test/feature", current: false },
    ],
    worktrees: [
      { path: "/test/repo", head: base, branch: "main" },
      { path: "/test/feature", head: tip, branch: "feature", linked: true },
    ],
  },
];
const patch = ["alpha.ts", "beta.ts"]
  .map(
    (path) =>
      `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
  )
  .join("");
const reviewFor = (comparison: Comparison, repo: string) => ({
  id: `live-${comparison.kind}`,
  repo,
  comparison,
  base,
  head: comparison.kind === "commit" ? comparison.commit : "worktree",
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
  // Branch changes: the tip commit, and beta.ts with an edit after it.
  ...(comparison.kind === "working" ? { headCommit: tip, uncommitted: ["src/beta.ts"] } : {}),
});
const comment = (id: number, author: string, body: string) => ({
  id,
  author,
  body,
  createdAt: "2026-10-01T00:00:00Z",
  url: `${pullUrl}#discussion_r${id}`,
});
/** The pull request's head; a test moves it off the branch tip. */
let pullHead = tip;
/** The first comment's text; a test gives it more Markdown. */
let firstBody = "Rename `after` to `next`.";
/** GitHub's title of the pull request; a test makes it long. */
let pullTitle = "Rename the export";
const pullRequest = (): PullRequestComments => ({
  url: pullUrl,
  head: pullHead,
  pull: { number: 7, title: pullTitle, author: "mira", state: "open" },
  fetchedAt: Date.now(),
  threads: [
    {
      id: 11,
      path: "src/alpha.ts",
      side: "new",
      line: 1,
      startLine: null,
      originalLine: 1,
      // The last reply is the reader's draft, in their pending review on GitHub.
      comments: [
        comment(11, "mira", firstBody),
        comment(12, "sam", "Done."),
        { ...comment(13, "lee", "And in the docs."), draft: true },
      ],
    },
    {
      id: 21,
      path: "src/beta.ts",
      side: "new",
      line: 1,
      startLine: null,
      originalLine: 1,
      comments: [comment(21, "mira", "Is this still needed?")],
    },
    {
      id: 31,
      path: "src/gamma.ts",
      side: "new",
      line: null,
      startLine: null,
      originalLine: 4,
      comments: [comment(31, "jordan", "Was this off by one?")],
    },
  ],
  conversation: [],
  reviews: [],
});
const savedReview = {
  id: "pull",
  title: "Rename the export",
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
  pullRequestUrl: pullUrl,
  pullRequestTitle: "Rename the export",
  targets: [
    {
      id: "pull-target",
      repositoryId: "repo-0",
      repo: "/test/feature",
      branch: "feature",
      label: "Captured",
      comparison: { kind: "commit", commit: tip },
      base,
      head: tip,
      captured: false,
    },
  ],
};
const threads: Thread[] = [
  {
    id: "pull",
    title: savedReview.title,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: Date.now() - 60_000,
    repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
    checkout: "/test/feature",
    linked: true,
    branch: "feature",
    pullRequestUrl: pullUrl,
  },
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
  switch (url.pathname) {
    case "/api/reviews/pull":
      return Response.json(savedReview);
    case "/api/reviews/pull/pull-request":
      return Response.json(pullRequest());
    case "/api/reviews/pull/targets/pull-target/review":
      return Response.json({
        ...reviewFor({ kind: "commit", commit: tip }, "/test/feature"),
        id: "pull-target",
      });
    case "/api/reviews/pull/targets/pull-target/notes":
      return Response.json({ reviewId: "pull-target", revision: 0, notes: [] });
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
          head: repo === "/test/feature" ? tip : base,
          branch: repo === "/test/feature" ? "feature" : "main",
          shallow: false,
          git: true,
        },
        worktrees: repositories[0]!.worktrees,
      });
    case "/api/branches":
      return Response.json(repositories[0]!.branches);
    case "/api/review": {
      const body = JSON.parse(String(init?.body)) as { comparison: Comparison; repo: string };
      return Response.json(reviewFor(body.comparison, body.repo));
    }
    case "/api/notes":
      return Response.json({ reviewId: url.searchParams.get("reviewId"), revision: 0, notes: [] });
    case "/api/threads/events":
      return stream(init, `event: state\ndata: ${JSON.stringify({ threads, repositories })}\n\n`);
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
  return Response.json({ error: { code: "not-found", message: "None" } }, { status: 404 });
};

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
const address = location.pathname + location.search;

beforeEach(async () => {
  await page.viewport(1280, 800);
  pullHead = tip;
  firstBody = "Rename `after` to `next`.";
  pullTitle = "Rename the export";
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
  setChromeMode("quiet", false);
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
  history.replaceState(null, "", address);
});

function render() {
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
          {(controller) => <App controller={controller} browseApi={browse} />}
        </WorkspaceViews>
      </WorkspaceHost>
    </>,
  );
}

const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
/** The visible review's Changes, on the thread's branch. */
async function openChanges() {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: /^Rename the export/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("pull-target");
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("live-working");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
}
/** A GitHub thread, at its line or in the panel. */
const inDiff = '[aria-label^="GitHub thread by"]';
const thread = (author: string, line: string) =>
  page.getByRole("article", { name: `GitHub thread by ${author} at ${line}, read-only` });

test("Branch changes at the pull request head show its threads at their lines, apart from files edited after it", async () => {
  await openChanges();
  // The thread on a committed file shows on its line.
  await expect.element(thread("mira", "R1")).toBeVisible();
  // The comments render their Markdown once the renderer has loaded.
  await expect
    .poll(() => thread("mira", "R1").element().textContent, { timeout: 10_000 })
    .toMatch(/Rename after to next\..*Done\./);
  // A draft reply shows, marked Pending as on GitHub.
  expect(thread("mira", "R1").element().textContent).toMatch(/lee\s*Pending.*And in the docs\./);
  expect(shown()!.querySelectorAll(inDiff)).toHaveLength(1);

  // The row says the count in words.
  const trigger = page.getByRole("button", { name: "5 pull request comments" });
  await expect.element(trigger).toHaveTextContent("5 comments");
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Pull request comments" });
  await expect.element(panel).toBeVisible();
  const text = panel.element().textContent;
  expect(text).toContain("1 thread shows in the diff.");
  expect(text).toMatch(
    /src\/beta\.ts\s*R1\s*src\/beta\.ts has changes after the pull request head\..*Is this still needed\?/,
  );
  expect(text).toMatch(/src\/gamma\.ts\s*R4\s*Outdated on GitHub\..*Was this off by one\?/);
});

test("Changes whose head is not the pull request head list every thread with the reason", async () => {
  pullHead = "c".repeat(40);
  await openChanges();
  const trigger = page.getByRole("button", { name: "5 pull request comments" });
  await expect.element(trigger).toHaveTextContent("5 comments");
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "Pull request comments" });
  await expect.element(panel).toBeVisible();
  expect(panel.element().textContent).toContain(
    "Lines refer to the pull request head, ccccccc. This comparison shows aaaaaaa, so they are listed here.",
  );
  // The diff has none; the panel lists them.
  expect(shown()!.querySelector(inDiff)).toBeNull();
  expect(panel.element().querySelectorAll(inDiff)).toHaveLength(3);
});

test("a GitHub comment shows its Markdown: code, lists, task lists, quotes, and links that open in the browser; raw HTML stays out", async () => {
  firstBody = [
    "Rename `after` to `next`:",
    "",
    "```ts",
    "export const next = 2;",
    "```",
    "",
    "- [x] alpha",
    "- [ ] beta",
    "",
    "> Quoted from the spec.",
    "",
    'See [the docs](https://example.com/docs). <img src="x" onerror="window.__injected = 1"> <b>loud</b>',
    "",
    "```suggestion",
    "export const after = 3;",
    "```",
  ].join("\n");
  await openChanges();
  const card = thread("mira", "R1");
  await expect.element(card).toBeVisible();
  await expect
    .poll(() => card.element().querySelector("pre code")?.textContent, { timeout: 10_000 })
    .toContain("export const next = 2;");
  const element = card.element();
  expect(element.querySelector("p code")?.textContent).toBe("after");
  const boxes = [...element.querySelectorAll<HTMLInputElement>("li input[type=checkbox]")];
  expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
    [true, true],
    [false, true],
  ]);
  expect(element.querySelector("blockquote")?.textContent?.trim()).toBe("Quoted from the spec.");
  const link = element.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]')!;
  expect(link.target).toBe("_blank");
  expect(link.rel).toContain("noopener");
  // GitHub's suggestion is code, under its label.
  expect(element.textContent).toMatch(/Suggested change\s*export const after = 3;/);
  // Raw HTML does not render, and no Markdown marks are left as text.
  expect(element.querySelector("img[onerror], b")).toBeNull();
  expect((window as { __injected?: number }).__injected).toBeUndefined();
  expect(element.textContent).not.toContain("```");
});

test("a pull request heads the thread's card with its number, title, author, and state; the tabs and the files keep their room", async () => {
  pullTitle = `Rename the export ${"and every caller of it ".repeat(12)}`;
  await openChanges();
  const link = page.getByRole("link", { name: /^Open pull request #7: Rename the export/ });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe(pullUrl);
  expect(link.element().getAttribute("target")).toBe("_blank");
  const header = link.element().closest("header")!;
  await expect.poll(() => header.textContent).toMatch(/#7\s*Rename the export.*mira\s*Open/);
  // One row: the title gives way, cut at its end; the author and state stay.
  expect(
    header.querySelector('[title="Opened by mira"]')!.getBoundingClientRect().width,
  ).toBeGreaterThan(0);
  expect(header.getBoundingClientRect().height).toBeLessThanOrEqual(40);
  const title = [...link.element().querySelectorAll("span")].at(-1)!;
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  // The header heads the review card. The tab row has no pull request in it,
  // and the Changed files pane starts at the top of the workspace.
  const review = header.closest<HTMLElement>("[data-pane]")!;
  expect(review.dataset.pane).toBe("review");
  expect(header.nextElementSibling?.querySelector('[role="tablist"]')).not.toBeNull();
  expect(header.nextElementSibling?.textContent).not.toContain("Rename the export");
  const files = review.parentElement!.querySelector<HTMLElement>(':scope > [data-pane="changed"]')!;
  expect(files.getBoundingClientRect().top).toBe(review.getBoundingClientRect().top);
  expect(files.textContent).not.toContain("Rename the export");
  // The comments count moved to the header too.
  await expect
    .element(page.getByRole("button", { name: "5 pull request comments" }))
    .toHaveTextContent("5 comments");
  expect(
    header.contains(page.getByRole("button", { name: "5 pull request comments" }).element()),
  ).toBe(true);
});
