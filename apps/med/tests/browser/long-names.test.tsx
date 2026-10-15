import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { AppTooltip } from "../../src/web/components/ToolButton";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import { setChromeMode } from "../../src/web/data/chrome";
import type { Comparison } from "../../src/shared/protocol";
import type { Thread } from "../../src/shared/threads";
import { initializeTheme, themeController } from "../../src/web/themes";

// Long names in narrow lists: a cut name shows whole in the app's tooltip,
// and a list beside the diff is a column that the reader can widen.

const head = "a".repeat(40);
const base = "b".repeat(40);
const long = "src/components/very-long-directory-name/AnExtremelyLongComponentFileName.test.tsx";
const short = "src/a.ts";
const longTitle =
  "Move the refresh token rotation into its own handler so that the session store can retry it safely after a failed write";
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "fixture",
    branches: [{ name: "main", head, worktreePath: "/test/repo", current: true }],
    worktrees: [{ path: "/test/repo", head, branch: "main" }],
  },
];
const patch = [long, short]
  .map(
    (path) =>
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
  )
  .join("");
const reviewFor = (comparison: Comparison, id: string) => ({
  id,
  repo: "/test/repo",
  comparison,
  base,
  head: comparison.kind === "commit" ? comparison.commit : "worktree",
  label: "Review",
  files: [long, short].map((path) => ({
    path,
    status: "M",
    additions: 1,
    deletions: 1,
    binary: false,
  })),
  patch,
  warnings: [],
  metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
});
const savedReview = {
  id: "guide",
  title: "Rotate refresh tokens",
  createdAt: "2026-10-01T00:00:00Z",
  revision: 0,
  commentCount: 0,
  guide: {
    updatedAt: "2026-10-01T00:00:00Z",
    segments: [
      { title: longTitle, files: [long] },
      { title: "Docs", files: [short] },
    ],
  },
  targets: [
    {
      id: "guide-target",
      repositoryId: "repo-0",
      repo: "/test/repo",
      branch: "main",
      label: "Captured",
      comparison: { kind: "commit", commit: head },
      base,
      head,
      captured: false,
    },
  ],
};
const threads: Thread[] = [
  {
    id: "guide",
    title: savedReview.title,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: Date.now() - 60_000,
    repository: { id: "repo-0", name: "fixture", path: "/test/repo" },
    checkout: "/test/repo",
    branch: "main",
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
  switch (url.pathname) {
    case "/api/reviews/guide":
      return Response.json(savedReview);
    case "/api/reviews/guide/targets/guide-target/review":
      return Response.json(reviewFor({ kind: "commit", commit: head }, "guide-target"));
    case "/api/reviews/guide/targets/guide-target/notes":
      return Response.json({ reviewId: "guide-target", revision: 0, notes: [] });
    case "/api/repositories":
      return Response.json({ repositories });
    case "/api/session":
      return Response.json({
        protocol: 1,
        repositories,
        repositoryId: "repo-0",
        repository: {
          path: "/test/repo",
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
const clearStorage = () => {
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:") && key !== "med:theme:v1") localStorage.removeItem(key);
  // As from another window: the column widths drop their in-memory copy.
  window.dispatchEvent(new StorageEvent("storage", { key: "med:column:v1:changes" }));
};

beforeEach(async () => {
  await page.viewport(1280, 800);
  clearStorage();
  setChromeMode("quiet", false);
});
afterEach(() => {
  unmount();
  clearStorage();
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
function unmount() {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
}

const shown = () =>
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find((element) =>
    element.checkVisibility({ visibilityProperty: true }),
  );
const tooltip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
/** Moves the pointer off every control, and waits for the tooltip to close. */
async function away() {
  await userEvent.hover(page.getByRole("tab", { name: /^Changes/ }));
  await expect.poll(tooltip).toBeNull();
}
async function openThread() {
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const sidebar = page.getByRole("navigation", { name: "Threads" });
  if (!sidebar.query()) await page.getByRole("button", { name: "Show sidebar" }).click();
  await page.getByRole("button", { name: /^Rotate refresh tokens/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("guide-target");
}
/** The thread's live Changes. */
async function openChanges() {
  await openThread();
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("live-working");
}
/** A row of the Changed files pane's tree, in its shadow root. */
const treeRow = (path: string) => {
  const rows = page.getByRole("treeitem", { name: path.split("/").at(-1)!, exact: true });
  const index = rows
    .elements()
    .findIndex((row) => row.getAttribute("data-item-path") === path && row.checkVisibility());
  if (index < 0) throw new Error(`No tree row for ${path}`);
  return rows.nth(index);
};

test("a cut file name shows its path in the tooltip, a whole one shows none; full chrome's status bar names the file under the pointer", async () => {
  render();
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await treeRow(long).hover();
  await expect.poll(tooltip).toBe(long);
  await away();
  await treeRow(short).hover();
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(tooltip()).toBeNull();

  // Full chrome's status bar says the path of the file under the pointer.
  setChromeMode("full", false);
  const status = () =>
    [...document.querySelectorAll("footer")].find((footer) => footer.checkVisibility());
  await expect.poll(() => status()).toBeTruthy();
  await away();
  await treeRow(long).hover();
  await expect.poll(() => status()?.textContent).toContain(long);
});

test("a thread's file list resizes with the pointer and the keys, resets on a double-click, and keeps its width", async () => {
  render();
  await openChanges();
  // Without the Changed files pane, the review lists its files in a column.
  await page.getByRole("button", { name: /^Close changed files/i }).click();
  const rail = page.getByRole("navigation", { name: "Files and commits" });
  await expect.element(rail).toBeVisible();
  const handle = page.getByRole("separator", { name: "Resize the file list" });
  // Its width less its hairline.
  const width = () => rail.element().clientWidth;
  const value = () => Number(handle.element().getAttribute("aria-valuenow"));
  const first = value();
  expect(first).toBe(268);
  await expect.poll(width).toBe(first);

  // A drag moves the column's edge with the pointer.
  const row = rail.element().parentElement!;
  await userEvent.dragAndDrop(handle, page.elementLocator(row), {
    targetPosition: { x: first + 100, y: 200 },
  });
  await expect.poll(value).toBeGreaterThan(first + 80);
  await expect.poll(width).toBe(value());
  const dragged = value();

  // The keys move it by 24 pixels; a double-click gives back the first width.
  (handle.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.poll(value).toBe(dragged + 24);
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  await expect.poll(value).toBe(dragged - 24);
  // At most 60% of the pane.
  for (let step = 0; step < 4; step++) await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
  const pane = row.getBoundingClientRect().width;
  await expect.poll(value).toBe(Math.round(Math.min(pane * 0.6, pane - 480)));
  await userEvent.dblClick(handle);
  await expect.poll(value).toBe(first);
  await expect.poll(width).toBe(first);

  // The width holds after a reload.
  (handle.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  await expect.poll(value).toBe(first + 48);
  expect(localStorage.getItem("med:column:v1:changes")).toBe(String(first + 48));
  unmount();
  window.dispatchEvent(new StorageEvent("storage", { key: "med:column:v1:changes" }));
  render();
  await openChanges();
  await expect.element(rail).toBeVisible();
  await expect.poll(width).toBe(first + 48);
});

test("a Guide segment's title wraps to two lines; a longer one shows whole in the tooltip", async () => {
  render();
  await openThread();
  await page.getByRole("button", { name: /^01\s*Move the refresh token/ }).click();
  const guide = page.getByRole("navigation", { name: "Guide" });
  const segments = guide.getByRole("list", { name: "Segments" });
  const first = segments.getByRole("button", { name: /^1\. Move the refresh token/ });
  await expect.element(first).toBeVisible();
  // Two lines of the title, then "…".
  const title = first.element().querySelector<HTMLElement>('[data-clip="lines"]')!;
  const lineHeight = parseFloat(getComputedStyle(title).lineHeight);
  expect(Math.round(title.clientHeight / lineHeight)).toBe(2);
  await away();
  await first.hover();
  await expect.poll(tooltip).toBe(longTitle);
  await away();
  await segments.getByRole("button", { name: /^2\. Docs/ }).hover();
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(tooltip()).toBeNull();
});
