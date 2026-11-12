import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { AppTooltip } from "../../src/web/components/ToolButton";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison, LivePullRequest, PullRequestComments } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";
import "../../src/web/components/TitleRow.css";

// GitHub threads on a thread's Changes, in quiet chrome: a branch whose tip is
// the pull request head shows them at their lines, except in files with
// edits after that commit; the window's title band counts the comments in words.

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
/** The general comments; a test adds some. */
let conversation: PullRequestComments["conversation"] = [];
let reviews: PullRequestComments["reviews"] = [];
/** What the Pull request tab asks the host, each path with its query. */
let asked: string[] = [];
let liveFails = "";
const live = (): LivePullRequest => ({
  url: pullUrl,
  number: 7,
  title: pullTitle,
  author: "mira",
  state: "open",
  body: [
    "Renames the export for $3 and $5. See [the test](src/alpha.ts:4), [gone](./no/such.ts), and [the notes](#notes).",
    '<img width="300" alt="The chart" src="https://github.com/user-attachments/assets/36b555b6-b4ac-46c3-8cb8-56fb574b7c89">',
    '<p align="center"><img alt="Centered" src="https://github.com/user-attachments/assets/aaaaaaaa-b4ac-46c3-8cb8-56fb574b7c89"></p>',
    '<details>\n<summary>Shots</summary>\n<img alt="Folded" src="https://github.com/user-attachments/assets/bbbbbbbb-b4ac-46c3-8cb8-56fb574b7c89">\nA caption under it.\n</details>',
    '1. Before\n   <img alt="Listed" src="https://github.com/user-attachments/assets/cccccccc-b4ac-46c3-8cb8-56fb574b7c89">\n2. After',
    '> <p><img alt="Quoted" src="https://github.com/user-attachments/assets/dddddddd-b4ac-46c3-8cb8-56fb574b7c89"></p>',
    '<!-- Template: <img alt="Hidden" src="https://github.com/user-attachments/assets/eeeeeeee-b4ac-46c3-8cb8-56fb574b7c89"> -->',
    'Inline `<img src="inline.png">` stays code.',
    '```html\n<img src="kept.png">\n```',
    "## Notes",
  ].join("\n\n"),
  base: "main",
  head: "feature",
  labels: [{ name: "bug", color: "d73a4a" }],
  checks: [
    {
      id: "CI/test",
      name: "test",
      workflow: "CI",
      outcome: "failed",
      state: "FAILURE",
      startedAt: "2026-11-01T09:40:00Z",
      completedAt: "2026-11-01T09:42:49Z",
      url: "https://github.com/acme/app/actions/runs/1/job/5",
      job: 5,
    },
    {
      id: "/deploy",
      name: "deploy",
      outcome: "failed",
      state: "ERROR",
      startedAt: "2026-11-01T09:40:00Z",
      completedAt: null,
    },
    ...["a", "b", "c", "d", "e", "f"].map((name) => ({
      id: `CI/${name}`,
      name,
      workflow: "CI",
      outcome: "passed" as const,
      state: "SUCCESS",
      startedAt: "2026-11-01T09:40:00Z",
      completedAt: "2026-11-01T09:40:42Z",
    })),
  ],
  reviewers: [
    { name: "sam", state: "CHANGES_REQUESTED" },
    { name: "jordan", state: "REQUESTED" },
  ],
  merge: { mergeable: "MERGEABLE", status: "BLOCKED", decision: "CHANGES_REQUESTED", behindBy: 3 },
  fetchedAt: Date.now(),
});
const failedLog = {
  skipped: 40,
  text: "##[group]Run tests\nbun test\n##[endgroup]\nexpected 3, got 1\n##[error]Process completed with exit code 1.\nCleaning up orphan processes",
};
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
  conversation,
  reviews,
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
    kind: "review",
    title: savedReview.title,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: Date.now() - 60_000,
    reviews: [
      {
        id: "pull",
        title: savedReview.title,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: Date.now() - 60_000,
        pullRequest: { url: pullUrl, number: 7 },
      },
    ],
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
  if (url.pathname.startsWith("/api/reviews/pull/pull-request"))
    asked.push(url.pathname.replace("/api/reviews/pull/", "") + url.search);
  switch (url.pathname) {
    case "/api/reviews/pull":
      return Response.json(savedReview);
    case "/api/reviews/pull/pull-request":
      return Response.json(pullRequest());
    case "/api/reviews/pull/pull-request-live":
      return liveFails
        ? Response.json({ error: { code: "gh-failed", message: liveFails } }, { status: 502 })
        : Response.json(live());
    case "/api/reviews/pull/pull-request-log":
      return Response.json(failedLog);
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
        entries: [{ path: "src/alpha.ts", kind: "file" }],
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
  conversation = [];
  reviews = [];
  asked = [];
  liveFails = "";
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
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
  const sidebar = page.getByRole("navigation", { name: "Sessions" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: /^Rename the export/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("pull-target");
  await page.getByRole("radio", { name: /^Changes/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("live-working");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
}
/** A GitHub thread, at its line or in the panel. */
const inDiff = '[aria-label^="GitHub thread by"]';
const thread = (author: string, line: string) =>
  page.getByRole("article", { name: `GitHub thread by ${author} at ${line}` });

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

test("a pull request names the review in its row, quietly: its mark in its state's colour, its title, and its number; the band keeps the checkout and the comments", async () => {
  pullTitle = `Rename the export ${"and every caller of it ".repeat(12)}`;
  await openChanges();
  const link = page.getByRole("link", { name: /^Open pull request #7: Rename the export/ });
  await expect.element(link).toBeVisible();
  expect(link.element().getAttribute("href")).toBe(pullUrl);
  expect(link.element().getAttribute("target")).toBe("_blank");
  // The review's own row, under the title band, leads with the pull
  // request: its mark in the colour of its state, its title, and its number.
  // No badge or author: those are on the Pull request page.
  const row = link.element().closest<HTMLElement>('header[aria-label="Review header"]')!;
  expect(row).not.toBeNull();
  expect(row.closest('[data-pane="review"]')).not.toBeNull();
  await expect.poll(() => row.querySelector('[data-state="open"]')).not.toBeNull();
  expect(link.element().textContent).toMatch(/^Rename the export.*#7$/);
  expect(row.textContent).not.toContain("mira");
  // One row: the title gives way, cut at its end; the number stays.
  expect(row.getBoundingClientRect().height).toBeLessThanOrEqual(44);
  const title = [...link.element().querySelectorAll("span")]
    .filter((span) => span.textContent?.startsWith("Rename the export"))
    .at(-1)!;
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
  // The band names the checkout, and the comments count is at its end, with
  // the pages; it holds no review header.
  const band = document.querySelector<HTMLElement>('header[aria-label="Workspace"]')!;
  const checkout = page.getByRole("button", { name: "fixture. Copy the path", exact: true });
  await expect.element(checkout).toBeVisible();
  expect(band.contains(checkout.element())).toBe(true);
  const comments = page.getByRole("button", { name: "5 pull request comments" });
  await expect.element(comments).toHaveTextContent("5 comments");
  expect(band.contains(comments.element())).toBe(true);
  expect(band.querySelector('[aria-label="Review header"]')).toBeNull();
  // The band moves the window; its buttons take clicks.
  const region = (element: Element) => getComputedStyle(element).getPropertyValue("app-region");
  expect(region(band)).toBe("drag");
  expect(region(comments.element())).toBe("no-drag");
});

/** The thread's Pull request tab, once its review shows. */
async function openPullTab() {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const sidebar = page.getByRole("navigation", { name: "Sessions" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: /^Rename the export/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("pull-target");
  await page.getByRole("radio", { name: "Pull request" }).click();
  return page.getByRole("region", { name: "Pull request" });
}

test("the Pull request tab shows the pull request as GitHub has it", async () => {
  conversation = [comment(2, "lee", "The flaky test failed again on main.")];
  reviews = [
    {
      ...comment(3, "sam", "Please split the write path."),
      createdAt: "2026-09-30T00:00:00Z",
      state: "CHANGES_REQUESTED",
    },
    { ...comment(4, "jordan", ""), createdAt: "2026-09-29T00:00:00Z", state: "APPROVED" },
  ];
  // Nothing reads the live pull request until the reader opens the tab.
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  expect(asked.filter((path) => path.startsWith("pull-request-live"))).toEqual([]);
  root?.unmount();
  mount?.remove();

  const view = await openPullTab();
  // The number follows the title, as on GitHub.
  await expect
    .element(view.getByRole("heading", { name: "Rename the export #7", exact: true }))
    .toBeVisible();
  // One line: the state, then who wants to merge which branch into which; no labels.
  await expect
    .poll(() => view.element().querySelector("header p")?.textContent)
    .toBe("Openmira wants to merge feature into main");
  expect(view.getByText("bug", { exact: true }).query()).toBeNull();
  await expect
    .element(view.getByRole("link", { name: "#7", exact: true }))
    .toHaveAttribute("href", pullUrl);
  // What stops the merge, and how far behind, in words.
  const merge = view.getByRole("region", { name: "Merge" });
  await expect.element(merge.getByText("Blocked: changes requested.")).toBeVisible();
  await expect.element(merge.getByText("3 commits behind main.")).toBeVisible();
  // One status box. Failures show; the six that passed are a count, which opens.
  const status = view.getByRole("region", { name: "Status" });
  const checks = status.getByRole("region", { name: "Checks" });
  await expect.element(checks.getByText("2m 49s")).toBeVisible();
  await expect.element(checks.getByRole("img", { name: "Error" })).toBeVisible();
  expect(checks.getByText("a", { exact: true }).query()).toBeNull();
  await checks.getByRole("button", { name: "Checks: 6 passed" }).click();
  await expect.element(checks.getByText("a", { exact: true })).toBeVisible();
  await expect
    .element(view.getByRole("region", { name: "Reviewers" }).getByText("Changes requested"))
    .toBeVisible();
  // GitHub's <img> tag shows through the host; in code, it stays text.
  await expect
    .poll(() => view.getByRole("img", { name: "The chart" }).element().getAttribute("src"))
    .toBe(
      `/api/reviews/pull/pull-request-image?src=${encodeURIComponent("https://github.com/user-attachments/assets/36b555b6-b4ac-46c3-8cb8-56fb574b7c89")}`,
    );
  await expect.element(view.getByText('<img src="kept.png">')).toBeVisible();
  await expect.element(view.getByText('<img src="inline.png">')).toBeVisible();
  // So does one that HTML holds, which Markdown alone would drop, where it stands.
  for (const name of ["Centered", "Folded", "Listed", "Quoted"])
    await expect.element(view.getByRole("img", { name })).toBeVisible();
  const listed = view.getByRole("img", { name: "Listed" }).element();
  expect(listed.closest("ol")?.querySelectorAll("li")).toHaveLength(2);
  expect(view.getByRole("img", { name: "Quoted" }).element().closest("blockquote")).not.toBeNull();
  // The words beside an image stay.
  await expect.element(view.getByText(/A caption under it\./)).toBeVisible();
  // GitHub shows no HTML comment, and a dollar is not math here.
  expect(view.getByRole("img", { name: "Hidden" }).query()).toBeNull();
  await expect.element(view.getByText(/for \$3 and \$5/)).toBeVisible();
  // An approval with no text is one line.
  await expect.element(view.getByText("jordan approved", { exact: true })).toBeVisible();
  // Reviews and comments in time order, with the threads below them.
  const talk = view.getByRole("region", { name: "Conversation" });
  await expect
    .poll(() => talk.element().textContent)
    .toMatch(/Please split the write path\..*The flaky test failed again/s);
});

test("the description's links: a file opens, a dead one is text, and a heading's stays in the pane", async () => {
  const view = await openPullTab();
  await expect.element(view.getByText("the notes")).toBeVisible();
  // A file link is a real link: reachable by keyboard, and resolved in the index.
  const file = view.getByRole("link", { name: "Open src/alpha.ts at L4" });
  await expect.element(file).toBeVisible();
  await expect.element(view.getByText(/, gone, and/)).toBeVisible();
  expect(view.getByRole("link", { name: "gone" }).query()).toBeNull();
  const address = location.href;
  const scroll = vi.spyOn(Element.prototype, "scrollTo");
  await view.getByText("the notes").click();
  expect(location.href).toBe(address);
  expect(scroll.mock.contexts).toContain(
    view.getByRole("heading", { name: "Notes" }).element().closest(".med-md-scroll"),
  );
  scroll.mockRestore();
  await file.click();
  await expect.element(page.getByRole("tab", { name: /alpha\.ts/ })).toBeVisible();
});

test("a failed job's log comes only when asked for, and opens at its error", async () => {
  const view = await openPullTab();
  await expect.element(view.getByRole("region", { name: "Checks" })).toBeVisible();
  expect(asked.filter((path) => path.startsWith("pull-request-log"))).toEqual([]);
  await view.getByRole("button", { name: "Show the failed log of test" }).click();
  const log = view.getByLabelText("Failed log of test");
  await expect.element(log).toBeVisible();
  await expect.element(view.getByText("The last 5 lines of 45")).toBeVisible();
  expect(asked).toContain("pull-request-log?job=5");
  // GitHub's marks are gone, and an error stands out.
  expect(log.element().textContent).toContain("Run tests");
  expect(log.element().textContent).not.toContain("##[");
  expect(log.element().querySelector("[data-log-error]")?.textContent).toBe(
    "Process completed with exit code 1.",
  );
  // Closing and opening it again does not ask GitHub again.
  await view.getByRole("button", { name: "Hide the failed log of test" }).click();
  await view.getByRole("button", { name: "Show the failed log of test" }).click();
  await expect.element(log).toBeVisible();
  expect(asked.filter((path) => path.startsWith("pull-request-log"))).toHaveLength(1);
  // A check with no GitHub Actions job has no log to ask for.
  expect(view.getByRole("button", { name: "Show the failed log of deploy" }).query()).toBeNull();
});

test("the ⌘K command reads GitHub past the host's cache; the page has no Refresh", async () => {
  const view = await openPullTab();
  await expect.element(view.getByRole("region", { name: "Checks" })).toBeVisible();
  // Med reads while the page is open, so the page names no time and no Refresh.
  expect(view.getByRole("button", { name: "Read the pull request again" }).query()).toBeNull();
  expect(view.element().textContent).not.toContain("Read just now");
  asked = [];
  await userEvent.keyboard("{Control>}k{/Control}");
  await userEvent.keyboard("Read the pull request again");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => asked)
    .toEqual(expect.arrayContaining(["pull-request?refresh=1", "pull-request-live?refresh=1"]));
});

test("a thread in the tab links to its line in the diff, and says why when it cannot", async () => {
  const view = await openPullTab();
  // One timeline: comments, reviews, and code threads together.
  await expect.element(view.getByRole("region", { name: "Conversation" })).toBeVisible();
  // The reader's own comment is in their pending review, which only they see.
  const pending = view.getByRole("region", { name: "Your pending review" });
  await expect.element(pending.getByText("1 comment, only you see them")).toBeVisible();
  await expect.poll(() => pending.element().textContent).toContain("And in the docs.");
  const code = view.getByRole("region", { name: "Conversation" });
  // An outdated thread is one line, which opens.
  expect(code.element().textContent).not.toContain("Outdated on GitHub.");
  await code.getByRole("button", { name: /gamma\.ts, outdated$/ }).click();
  await expect.poll(() => code.element().textContent).toContain("Outdated on GitHub.");
  expect(code.getByRole("button", { name: "Show gamma.ts:R4 in the diff" }).query()).toBeNull();
  await pending.getByRole("button", { name: "Show alpha.ts:R1 in the diff" }).click();
  // The tab gives way to the diff, with the thread on screen at its line.
  await expect.poll(() => view.query()).toBeNull();
  await expect
    .poll(() =>
      [...shown()!.querySelectorAll<HTMLElement>('[data-pull-request-thread="11"]')].some(
        (card) => {
          const { top, bottom } = card.getBoundingClientRect();
          return card.checkVisibility() && top >= 0 && bottom <= innerHeight;
        },
      ),
    )
    .toBe(true);
});

test("a failed read says why and leaves the way to GitHub open", async () => {
  liveFails = "HTTP 502: 502 Bad Gateway (https://api.github.com/graphql)";
  const view = await openPullTab();
  await expect
    .poll(() => view.getByRole("alert").query()?.textContent)
    .toContain("502 Bad Gateway");
  await expect.element(view.getByRole("heading", { name: "Rename the export #7" })).toBeVisible();
  await expect
    .element(view.getByRole("link", { name: "#7", exact: true }))
    .toHaveAttribute("href", pullUrl);
  // Refresh tries again, and the page fills in.
  liveFails = "";
  await view.getByRole("button", { name: "Read the pull request again" }).click();
  await expect.element(view.getByRole("region", { name: "Checks" })).toBeVisible();
  expect(view.getByRole("alert").query()).toBeNull();
});
