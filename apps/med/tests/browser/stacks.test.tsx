import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createBrowseApi } from "../../src/web/data/browse";
import { setChromeMode } from "../../src/web/data/chrome";
import { createReviewController } from "../../src/web/data/controller";
import { ThreadSidebar } from "../../src/web/components/shell/ThreadSidebar";
import type { Comparison, ReviewResponse } from "../../src/shared/protocol";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread } from "../../src/shared/threads";
import type { WorkspaceSnapshot } from "../../src/web/data/workspaces";
import "../../src/web/pierre-theme";
import { initializeTheme, themeController } from "../../src/web/themes";

// A stack of three layers in one thread (docs/STACKS.md): each layer is a
// saved comparison of the thread's one checkout, on the layer below.

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
const REVIEW = "stack";
const commit = (digit: string) => digit.repeat(40);
/** main, then each layer's head. */
const heads = [commit("0"), commit("1"), commit("2"), commit("3")];
const layers = [
  { id: "l_000000000001", title: "Parse station queries", path: "src/query.ts", state: "merged" },
  { id: "l_000000000002", title: "Rank search results", path: "src/rank.ts", state: "open" },
  { id: "l_000000000003", title: "Search by region", path: "src/region.ts", state: "draft" },
] as const;

const added = (path: string, blob: string) =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\nindex 0000000..${blob}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,2 @@\n+export const name = "${path}";\n+export const ready = true;\n`;

function review(comparison: Comparison, paths: string[], id: string): ReviewResponse {
  const patch = paths.map((path, index) => added(path, `${index + 1}`.repeat(7))).join("");
  return {
    id,
    repo: "/code/tide",
    comparison,
    base: comparison.kind === "range" ? comparison.base : heads[0]!,
    head: comparison.kind === "range" ? comparison.head : heads[3]!,
    label: "Stack",
    files: paths.map((path) => ({ path, status: "A", additions: 2, deletions: 0, binary: false })),
    patch,
    warnings: [],
    metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
  };
}

const targets = layers.map((layer, index) => ({
  id: `t${index + 1}`,
  repositoryId: "repo-0",
  repo: "/code/tide",
  branch: "stack/region",
  label: layer.title,
  comparison: {
    kind: "range",
    base: heads[index]!,
    head: heads[index + 1]!,
    mergeBase: true,
  } as Comparison,
  base: heads[index]!,
  head: heads[index + 1]!,
  captured: true,
  part: layer.id,
}));

const saved = (): SavedReview => ({
  id: REVIEW,
  title: "Station search",
  createdAt: "2026-10-26T00:00:00Z",
  revision: 0,
  commentCount: 0,
  targets,
  iterations: [
    { number: 1, createdAt: "2026-10-26T00:00:00Z", targetIds: targets.map((t) => t.id) },
  ],
  parts: {
    shape: "stack",
    items: layers.map((layer, index) => ({
      id: layer.id,
      key: `https://github.com/acme/tide/pull/${101 + index}`,
      title: layer.title,
      pullRequestUrl: `https://github.com/acme/tide/pull/${101 + index}`,
      state: layer.state,
      base: index ? `stack/${index}` : "main",
      head: `stack/${index + 1}`,
    })),
  },
  partTotals: Object.fromEntries(
    layers.map((layer, index) => [
      layer.id,
      { targetId: `t${index + 1}`, files: 1, additions: 2, deletions: 0, comments: 0 },
    ]),
  ),
});

beforeEach(async () => {
  await page.viewport(1440, 900);
  setChromeMode("full", false);
  for (const key of Object.keys(localStorage))
    if (
      key.startsWith("med:viewed:v1:") ||
      key.startsWith("med:layers:v1:") ||
      key === "med:changes-rail"
    )
      localStorage.removeItem(key);
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  window.dispatchEvent(new StorageEvent("storage", { key: `med:viewed:v1:${REVIEW}` }));
  window.dispatchEvent(new StorageEvent("storage", { key: `med:layers:v1:${REVIEW}` }));
});

async function mountStack() {
  initializeTheme();
  themeController.commit("graphite-dark");
  const ranges: Comparison[] = [];
  const reads: string[] = [];
  const repository = {
    id: "repo-0",
    path: "/code/tide",
    name: "tide",
    branches: [
      { name: "stack/region", head: heads[3]!, worktreePath: "/code/tide", current: true },
    ],
    worktrees: [{ path: "/code/tide", head: heads[3]!, branch: "stack/region" }],
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    reads.push(url.pathname);
    if (url.pathname === `/api/reviews/${REVIEW}`) return Response.json(saved());
    const target = new RegExp(`^/api/reviews/${REVIEW}/targets/(t\\d)/(review|notes|drift)$`).exec(
      url.pathname,
    );
    if (target) {
      const index = Number(target[1]!.slice(1)) - 1;
      if (target[2] === "drift") return Response.json({ changed: false });
      if (target[2] === "notes")
        return Response.json({ reviewId: target[1], revision: 0, notes: [] });
      return Response.json({
        ...review(targets[index]!.comparison, [layers[index]!.path], target[1]!),
      });
    }
    if (url.pathname === "/api/review") {
      const { comparison } = JSON.parse(String(init?.body)) as { comparison: Comparison };
      ranges.push(comparison);
      if (comparison.kind !== "range") return Response.json(review(comparison, [], "w".repeat(64)));
      const from = heads.indexOf(comparison.base);
      const to = heads.indexOf(comparison.head);
      return Response.json(
        review(
          comparison,
          layers.slice(from, to).map((layer) => layer.path),
          `${from}${to}`.repeat(32),
        ),
      );
    }
    if (/\/browsing\/[a-f0-9]+\/notes$/.test(url.pathname) || url.pathname === "/api/notes")
      return Response.json({
        reviewId: url.searchParams.get("reviewId") ?? "",
        revision: 0,
        notes: [],
      });
    if (url.pathname === "/api/repositories") return Response.json({ repositories: [repository] });
    if (url.pathname === "/api/branches") return Response.json(repository.branches);
    if (url.pathname === "/api/session")
      return Response.json({
        protocol: 1,
        repositories: [repository],
        repositoryId: "repo-0",
        repository: {
          path: "/code/tide",
          name: "tide",
          head: heads[3],
          branch: "stack/region",
          shallow: false,
          git: true,
        },
        worktrees: repository.worktrees,
      });
    if (url.pathname === "/api/history")
      return Response.json({ commits: [], cursor: null, hasMore: false });
    if (url.pathname === "/api/agents") return Response.json({ agents: [] });
    if (url.pathname === `/api/reviews/${REVIEW}/codex-reviews`) return Response.json({ runs: [] });
    if (url.pathname === "/api/browse/list")
      return Response.json({
        source: JSON.parse(String(init?.body)).source,
        entries: [],
        truncated: false,
      });
    if (url.pathname === "/api/service/status") return Response.json({ sources: [] });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const controller = createReviewController({
    fetch: fetcher,
    events: false,
    savedReviewId: REVIEW,
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <App
      controller={controller}
      browseApi={createBrowseApi(fetcher, "fixture")}
      sessionFetch={fetcher}
    />,
  );
  await expect
    .poll(() => document.querySelector("[data-review-status]")?.getAttribute("data-review-status"))
    .toBe("ready");
  return { controller, ranges, reads };
}

const rail = () => page.getByRole("region", { name: "Stack" });
const layerRow = (number: number) =>
  document.querySelector<HTMLElement>(`[data-stack-rail] [data-layer="${number}"]`);
/** The files of the diff, from their headers' Viewed boxes. */
const diffPaths = () =>
  [...document.querySelectorAll('[role="checkbox"][aria-label^="Viewed "]')]
    .map((box) => box.getAttribute("aria-label")!.slice("Viewed ".length))
    .sort();

test("a stack's rail lists its layers top first over main, and ⌥↑ and ⌥↓ go between them", async () => {
  await mountStack();
  await expect.element(rail()).toBeVisible();
  // Top to bottom, as git draws a stack, with the base branch under it.
  const numbers = [...document.querySelectorAll("[data-stack-rail] [data-layer]")].map((row) =>
    row.getAttribute("data-layer"),
  );
  expect(numbers).toEqual(["3", "2", "1"]);
  await expect.element(rail().getByText("main", { exact: true })).toBeVisible();
  await expect.element(rail().getByText("Merged")).toBeVisible();
  await expect.element(rail().getByText("Draft")).toBeVisible();
  // The thread opens on the bottom layer, with only its own file.
  await expect.poll(() => layerRow(1)?.getAttribute("aria-current")).toBe("page");
  await expect.poll(diffPaths).toEqual(["src/query.ts"]);

  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await expect.poll(() => layerRow(2)?.getAttribute("aria-current")).toBe("page");
  await expect.poll(diffPaths).toEqual(["src/rank.ts"]);
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await expect.poll(diffPaths).toEqual(["src/region.ts"]);
  // The top layer stays the top.
  await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
  await expect.poll(() => layerRow(3)?.getAttribute("aria-current")).toBe("page");
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await expect.poll(() => layerRow(2)?.getAttribute("aria-current")).toBe("page");
  await expect.poll(diffPaths).toEqual(["src/rank.ts"]);
});

test("Whole stack shows main to the top layer's head, a Shift-click a range, and This layer goes back", async () => {
  const { ranges } = await mountStack();
  await expect.poll(diffPaths).toEqual(["src/query.ts"]);
  await userEvent.click(rail().getByRole("button", { name: "Whole stack" }));
  await expect
    .poll(() => ranges.at(-1))
    .toEqual({ kind: "range", base: heads[0], head: heads[3], mergeBase: true });
  await expect.poll(diffPaths).toEqual(["src/query.ts", "src/rank.ts", "src/region.ts"]);
  await expect
    .element(rail().getByRole("button", { name: "Whole stack" }))
    .toHaveAttribute("aria-pressed", "true");

  // From the bottom layer, a Shift-click on layer 2 shows layers 1–2.
  await userEvent.click(rail().getByRole("button", { name: "This layer" }));
  await expect.poll(diffPaths).toEqual(["src/query.ts"]);
  await userEvent.click(layerRow(2)!, { modifiers: ["Shift"] });
  await expect
    .poll(() => ranges.at(-1))
    .toEqual({ kind: "range", base: heads[0], head: heads[2], mergeBase: true });
  await expect.element(rail().getByText("Layers 1–2")).toBeVisible();
  await expect.poll(diffPaths).toEqual(["src/query.ts", "src/rank.ts"]);
  await userEvent.click(rail().getByRole("button", { name: "This layer" }));
  await expect.poll(diffPaths).toEqual(["src/query.ts"]);
});

test("Next unreviewed skips a merged layer and one whose files are all viewed", async () => {
  await mountStack();
  await expect.poll(diffPaths).toEqual(["src/query.ts"]);
  // Layer 1 merged: the lowest that waits is layer 2.
  await userEvent.click(rail().getByRole("button", { name: "Next unreviewed" }));
  await expect.poll(() => layerRow(2)?.getAttribute("aria-current")).toBe("page");
  await userEvent.click(page.getByRole("checkbox", { name: "Viewed src/rank.ts" }));
  await expect.poll(() => layerRow(2)?.getAttribute("aria-label")).toContain("Approved");
  await userEvent.click(rail().getByRole("button", { name: "Next unreviewed" }));
  await expect.poll(() => layerRow(3)?.getAttribute("aria-current")).toBe("page");
  // What the sidebar draws: layer 2's file is viewed.
  expect(JSON.parse(localStorage.getItem(`med:layers:v1:${REVIEW}`) ?? "{}")).toMatchObject({
    t2: { viewed: 1, files: 1 },
  });
});

const sidebarThread = (): Thread => ({
  id: `r_${"c".repeat(24)}`,
  title: "Station search",
  createdAt: "2026-10-26T00:00:00.000Z",
  updatedAt: Date.now() - 60_000,
  repository: { id: "repo-0", name: "tide", path: "/code/tide" },
  agent: "claude",
  state: "idle",
  parts: {
    shape: "stack",
    items: [
      {
        id: "l_000000000001",
        title: "Parse station queries",
        state: "merged",
        targetId: "t1",
        files: 2,
        additions: 10,
        deletions: 0,
        comments: 0,
      },
      {
        id: "l_000000000002",
        title: "Rank search results",
        state: "open",
        targetId: "t2",
        files: 4,
        additions: 11,
        deletions: 1,
        comments: 0,
      },
      {
        id: "l_000000000003",
        title: "Fold accents",
        state: "open",
        targetId: "t3",
        files: 3,
        additions: 15,
        deletions: 5,
        comments: 2,
      },
      {
        id: "l_000000000004",
        title: "Search by region",
        state: "draft",
        targetId: "t4",
        files: 2,
        additions: 13,
        deletions: 2,
        comments: 0,
      },
    ],
  },
});

test("a stack is one sidebar row with a progress strip, and its layers under the chevron", async () => {
  initializeTheme();
  const thread = sidebarThread();
  // Layer 1 is all viewed, layer 2 half, layer 3 all with comments, layer 4 not at all.
  localStorage.setItem(
    `med:layers:v1:${thread.id}`,
    JSON.stringify({
      t1: { viewed: 2, files: 2 },
      t2: { viewed: 2, files: 4 },
      t3: { viewed: 3, files: 3 },
    }),
  );
  window.dispatchEvent(new StorageEvent("storage", { key: `med:layers:v1:${thread.id}` }));
  const opened: string[] = [];
  const snapshot: WorkspaceSnapshot = {
    workspaces: [],
    active: null,
  } as unknown as WorkspaceSnapshot;
  mount = document.createElement("div");
  mount.style.cssText = "width: 300px; height: 700px; display: flex;";
  document.body.append(mount);
  root = createRoot(mount);
  root.render(
    <ThreadSidebar
      threads={[thread]}
      sources={[]}
      snapshot={snapshot}
      loaded
      onOpen={() => {}}
      onHide={() => {}}
      onSources={() => {}}
      onOpenPart={(_, part) => opened.push(part)}
    />,
  );
  await expect.element(page.getByRole("button", { name: /^Station search/ })).toBeVisible();
  const segments = [...document.querySelectorAll("[data-part-strip] [data-progress]")].map(
    (segment) => segment.getAttribute("data-progress"),
  );
  expect(segments).toEqual(["approved", "progress", "changes", "unreviewed"]);
  await expect.element(page.getByRole("img", { name: /^2 of 4 layers reviewed/ })).toBeVisible();
  // One row: the layers show under it only when it opens.
  expect(document.querySelectorAll("[data-part]")).toHaveLength(0);
  await userEvent.click(page.getByRole("button", { name: "Show the layers of Station search" }));
  const parts = [...document.querySelectorAll<HTMLElement>("[data-part]")];
  expect(parts.map((part) => part.getAttribute("data-part"))).toEqual(["4", "3", "2", "1"]);
  expect(parts[1]!.textContent).toContain("Fold accents");
  expect(parts[1]!.textContent).toContain("+15");
  expect(parts[1]!.textContent).toContain("−5");
  await userEvent.click(parts[2]!);
  expect(opened).toEqual(["l_000000000002"]);
  localStorage.removeItem(`med:layers:v1:${thread.id}`);
  localStorage.removeItem("med:sidebar-parts");
});
