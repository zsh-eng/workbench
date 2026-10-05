import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createReviewController } from "../../src/web/data/controller";
import type { Comparison, Note, ReviewResponse } from "../../src/shared/protocol";
import { HistoryPanel } from "../../src/web/components/HistoryPanel";
import { initializeTheme, themeController } from "../../src/web/themes";
import { layoutHistory } from "../../src/web/components/history-layout";
import { createBrowseApi } from "../../src/web/data/browse";
import type { BrowseSource } from "../../src/shared/browse";

const firstCommit = "a".repeat(40);
const secondCommit = "b".repeat(40);
const patch = ["alpha.ts", "beta.ts"]
  .map(
    (path) =>
      `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1,2 +1,2 @@\n-export const before = 1;\n+export const after = 2;\n export const shared = true;\n`,
  )
  .join("");
const commits = [
  {
    id: firstCommit,
    parents: [secondCommit],
    subject: "Improve the review stream",
    author: "Alex",
    timestamp: 1789909685000,
    refs: ["main"],
  },
  {
    id: secondCommit,
    parents: [],
    subject: "Add the initial renderer",
    author: "Sam",
    timestamp: 1789909063000,
    refs: [],
  },
];
let root: Root | undefined;
let mount: HTMLDivElement | undefined;

beforeEach(() => localStorage.removeItem("med:vim"));
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  localStorage.removeItem("med:vim");
});

function response(comparison: Comparison): ReviewResponse {
  return {
    id: comparison.kind === "commit" ? comparison.commit : "c".repeat(64),
    repo: "/test/repo",
    comparison,
    base: secondCommit,
    head: comparison.kind === "commit" ? comparison.commit : "working",
    label: "Review changes",
    files: ["alpha.ts", "beta.ts"].map((path) => ({
      path: `src/${path}`,
      status: "M",
      additions: 1,
      deletions: 1,
      binary: false,
    })),
    patch,
    warnings: [],
    metrics: { gitMs: 1, totalMs: 2, patchBytes: patch.length, cacheHit: false },
  };
}

async function mountApp(
  options: {
    inputOnly?: boolean;
    notes?: Note[];
    metadataFile?: boolean;
    branches?: boolean;
    savedReview?: boolean;
    noteMutation?: () => Promise<Response | undefined>;
  } = {},
) {
  initializeTheme();
  themeController.commit("graphite-dark");
  const requests: Comparison[] = [];
  const fileRequests: { source: BrowseSource; path: string }[] = [];
  let notes = options.notes ?? [];
  let revision = 0;
  const savedTargets = ["/test/repo", "/test/feature"].map((repo, index) => ({
    id: `target-${index}`,
    repositoryId: `repo-${index}`,
    repo,
    branch: index ? "feature" : "main",
    label: `Captured ${index}`,
    comparison: { kind: "working" as const },
    base: secondCommit,
    head: "working",
    captured: true,
  }));
  const savedRepositories = savedTargets.map((target) => ({
    id: target.repositoryId,
    path: target.repo,
    name: target.repo.split("/").at(-1)!,
    branches: [
      { name: target.branch, head: firstCommit, worktreePath: target.repo, current: true },
    ],
    worktrees: [{ path: target.repo, head: firstCommit, branch: target.branch }],
  }));
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (options.savedReview) {
      if (url.pathname === "/api/reviews/saved")
        return Response.json({
          id: "saved",
          title: "Agent review",
          createdAt: "2026-09-20T00:00:00Z",
          revision: 0,
          commentCount: 0,
          targets: savedTargets,
        });
      if (url.pathname === "/api/repositories")
        return Response.json({ repositories: savedRepositories });
      if (url.pathname === "/api/branches")
        return Response.json(
          savedRepositories.find((entry) => entry.path === url.searchParams.get("repo"))
            ?.branches ?? [],
        );
      const savedRoute = /^\/api\/reviews\/saved\/targets\/target-([01])\/(review|notes)$/.exec(
        url.pathname,
      );
      if (savedRoute) {
        const target = savedTargets[Number(savedRoute[1])];
        return Response.json(
          savedRoute[2] === "notes"
            ? { reviewId: target.id, revision: 0, notes: [] }
            : { ...response(target.comparison), id: target.id, repo: target.repo },
        );
      }
    }
    if (url.pathname === "/api/browse/list") {
      const { source } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        entries: (source.repo === "/test/feature"
          ? ["src/feature-only.ts"]
          : ["src/alpha.ts", "src/beta.ts", "image.bin", "missing.ts"]
        ).map((path) => ({ path, kind: "file" })),
        truncated: false,
      });
    }
    if (url.pathname === "/api/browse/symbols") {
      const { source, path, identity, query } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        resultSource: path ? undefined : { kind: "commit", repo: source.repo, oid: firstCommit },
        path,
        identity,
        query,
        engine: path ? "ctags" : "zoekt",
        truncated: false,
        matches: [
          {
            name: "workingContents",
            kind: "constant",
            path: path ?? "src/alpha.ts",
            line: 2,
            column: 14,
          },
        ],
      });
    }
    if (url.pathname === "/api/browse/read") {
      const { source, path } = JSON.parse(String(init?.body));
      fileRequests.push({ source, path });
      const kind = path === "image.bin" ? "binary" : path === "missing.ts" ? "missing" : "text";
      return Response.json({
        source,
        path,
        kind,
        size: 100,
        identity: `${JSON.stringify(source)}:${path}`,
        ...(kind === "text"
          ? {
              text: `export const workspace = "${source.repo}";\nexport const workingContents = true;\n`,
            }
          : {}),
      });
    }
    if (url.pathname === "/api/session")
      return Response.json({
        protocol: 1,
        ...(options.savedReview
          ? {
              repositories: savedRepositories,
              repositoryId: url.searchParams.get("repo") === "/test/feature" ? "repo-1" : "repo-0",
            }
          : {}),
        repository: {
          path: url.searchParams.get("repo") ?? "/test/repo",
          name: "review-fixture",
          head: firstCommit,
          branch: url.searchParams.get("repo") === "/test/feature" ? "feature" : "main",
          shallow: false,
          git: !options.inputOnly,
        },
        worktrees: options.inputOnly
          ? []
          : [{ path: "/test/repo", head: firstCommit, branch: "main" }],
        ...(options.inputOnly
          ? { initialComparison: { kind: "patch", path: "/test/change.patch" } }
          : {}),
      });
    if (url.pathname === "/api/branches")
      return Response.json(
        options.branches
          ? [
              { name: "main", head: firstCommit, worktreePath: "/test/repo", current: true },
              {
                name: "feature",
                head: secondCommit,
                worktreePath: "/test/feature",
                current: false,
              },
              { name: "release", head: secondCommit, current: false },
            ]
          : [],
      );
    if (url.pathname === "/api/history")
      return Response.json({ commits, cursor: null, hasMore: false });
    if (url.pathname === "/api/review") {
      const { comparison, repo } = JSON.parse(String(init?.body));
      requests.push(comparison);
      const review = { ...response(comparison), repo };
      if (options.metadataFile)
        review.files.push({
          path: "assets/image.png",
          status: "M",
          additions: 0,
          deletions: 0,
          binary: true,
        });
      return Response.json(review);
    }
    if (url.pathname === "/api/notes") {
      if (init?.method === "POST") {
        const response = await options.noteMutation?.();
        if (response) return response;
        const body = JSON.parse(String(init.body));
        if (body.mutation.type === "add")
          notes = [
            ...notes,
            {
              ...body.mutation.note,
              id: `note-${revision}`,
              resolution: "active",
              createdAt: "2026-09-19T00:00:00Z",
              updatedAt: "2026-09-19T00:00:00Z",
            },
          ];
        if (body.mutation.type === "remove")
          notes = notes.filter((note) => note.id !== body.mutation.id);
        if (body.mutation.type === "edit")
          notes = notes.map((note) =>
            note.id === body.mutation.id ? { ...note, text: body.mutation.text } : note,
          );
        return Response.json({ reviewId: body.reviewId, revision: ++revision, notes });
      }
      return Response.json({ reviewId: url.searchParams.get("reviewId"), revision, notes });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const controller = createReviewController({
    fetch: fetcher,
    events: false,
    savedReviewId: options.savedReview ? "saved" : undefined,
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<App controller={controller} browseApi={createBrowseApi(fetcher, "fixture")} />);
  await expect
    .poll(() => document.querySelector("[data-review-status]")?.getAttribute("data-review-status"))
    .toBe("ready");
  await expect
    .poll(() => document.querySelectorAll("diffs-container").length)
    .toBeGreaterThanOrEqual(2);
  return { controller, requests, fileRequests };
}

async function openBranch(name: string) {
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name} `) }).click();
}

describe("graphical review", () => {
  test("commit dates use the host's millisecond timestamp without converting it again", async () => {
    await mountApp();
    const row = document.getElementById(`commit-${firstCommit}`)!;
    const date = row.querySelector("time")!;
    expect(date.dateTime).toBe("2026-09-20T13:08:05.000Z");
    expect(date.textContent).toMatch(
      /^(?:just now|\d+ (?:min|hr|days?|mo|yr) ago|in \d+ (?:min|hr|days?|mo|yr))$/,
    );
    expect(date.title).toBe("");
  });
  test("saved review return and target selection restore Changes after live file browsing", async () => {
    const { controller } = await mountApp({ savedReview: true, branches: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Return to review" })).toBeVisible();
    await expect.element(page.getByText(/Captured working changes/)).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Return to review" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("button", { name: "Return to review" }))
      .not.toBeInTheDocument();

    // Retain an active file in both workspaces, then return to a target whose
    // stored file navigation would otherwise hide its saved comparison.
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await openBranch("feature");
    await page.getByRole("link", { name: "src/beta.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    await page.getByRole("combobox", { name: "Review target" }).selectOptions("target-0");
    await expect.poll(() => controller.getSnapshot().review?.id).toBe("target-0");
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("combobox", { name: "Review target" }).selectOptions("target-1");
    await expect.poll(() => controller.getSnapshot().review?.id).toBe("target-1");
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
  });
  test("hovering a full-file link shares the read with opening it", async () => {
    const { fileRequests } = await mountApp();
    const link = page.getByRole("link", { name: "src/alpha.ts", exact: true });
    await link.hover();
    await expect.poll(() => fileRequests.length).toBe(1);
    await link.click();
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    expect(fileRequests).toHaveLength(1);
  });

  test("Command-click opens pinned background tabs from diff filenames and the changes tree", async () => {
    const { controller } = await mountApp();
    await page
      .getByRole("link", { name: "src/alpha.ts", exact: true })
      .click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .toHaveAttribute("aria-selected", "false");
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    const selected = controller.getSnapshot().selectedFileId;
    await page.getByRole("treeitem", { name: /beta.ts/ }).click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "false");
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    expect(controller.getSnapshot().selectedFileId).toBe(selected);
    await page.getByRole("tab", { name: "alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => document.activeElement)
      .toBe(page.getByRole("textbox", { name: "File navigation", exact: true }).element());
  });
  test("a fresh launch opens files with a visible Vim cursor and keyboard focus", async () => {
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
    await expect.poll(() => document.activeElement).toBe(pane.element());
    const caret = document.querySelector<HTMLElement>("[data-file-pane=main] [data-vim-caret]")!;
    await expect.element(caret).toBeVisible();
    expect(caret.getBoundingClientRect().width).toBeGreaterThan(5);
    await userEvent.keyboard("j");
    await expect.element(pane).toHaveAttribute("data-vim-line", "2");
    await expect.element(caret).toBeVisible();
    await expect.element(caret).toHaveAttribute("data-vim-line", "2");
  });

  test("an explicit Vim opt-out is preserved", async () => {
    localStorage.setItem("med:vim", "off");
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "File content", exact: true }))
      .toBeVisible();
    await expect
      .element(document.querySelector<HTMLElement>("[data-file-pane=main] [data-vim-caret]")!)
      .not.toBeVisible();
    expect(localStorage.getItem("med:vim")).toBe("off");
  });

  test("symbol shortcuts open file and project palettes and project selection opens the indexed commit", async () => {
    const { fileRequests } = await mountApp({ branches: true });
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .toBeVisible();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "o", metaKey: true, bubbles: true }));
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).toBeVisible();
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("worktree");
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect
      .poll(() => fileRequests.at(-1)?.source)
      .toEqual({ kind: "commit", repo: "/test/repo", oid: firstCommit });
  });
  test("question mark shows the command guide with keycaps", async () => {
    await mountApp({ branches: true });
    await expect
      .element(page.getByRole("button", { name: "Open command palette", exact: true }))
      .toBeVisible();
    const input = document.querySelector('input[aria-label="Filter changed files"]')!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    await expect.element(page.getByRole("dialog", { name: "Shortcuts & commands" })).toBeVisible();
    expect(document.querySelectorAll('[role="dialog"] kbd').length).toBeGreaterThan(10);
    await page.getByRole("option", { name: /Open command palette/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search commands" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search commands" }).fill("Open branch");
    await page.getByRole("option", { name: /Open branch/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
  });

  test("file close shortcuts preserve Changes and close only the requested tabs", async () => {
    await mountApp();
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await page.getByRole("treeitem", { name: /beta.ts/ }).dblClick();
    const altKey = (code: string, shiftKey = false) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "∑", code, altKey: true, shiftKey, bubbles: true }),
      );
    altKey("KeyO", true);
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    altKey("KeyW");
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => document.activeElement)
      .toBe(page.getByRole("textbox", { name: "File navigation", exact: true }).element());
    altKey("KeyW", true);
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("tab", { name: "Changes", exact: true })).toBeVisible();
  });
  test("opens working contents from a historical diff and keeps the diff mounted", async () => {
    await page.viewport(1400, 850);
    const { fileRequests } = await mountApp({ branches: true });
    await page.getByRole("option", { name: /Add the initial renderer/ }).click();
    const diffHost = document.querySelector("diffs-container");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({ source: { kind: "worktree", repo: "/test/repo" }, path: "src/alpha.ts" });
    expect(diffHost?.isConnected).toBe(true);
    await page.getByRole("button", { name: "Open before", exact: true }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("commit");
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    expect(diffHost?.isConnected).toBe(true);
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .not.toBeInTheDocument();
  });

  test("Command Shift K opens a scoped file picker and binary files show metadata", async () => {
    const { fileRequests } = await mountApp({ branches: true });
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .toBeVisible();
    await page.getByRole("combobox", { name: "Find file", exact: true }).fill("image.bin");
    await page.getByRole("option", { name: /image.bin/ }).click();
    await expect
      .poll(() => document.querySelector('[data-full-file-kind="binary"]'))
      .not.toBeNull();
    expect(document.querySelector('[aria-label="Full file"] diffs-container')).toBeNull();
    await openBranch("feature");
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(page.getByRole("option", { name: /feature-only.ts/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /alpha.ts/ })).not.toBeInTheDocument();
    await page.getByRole("option", { name: /feature-only.ts/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.repo).toBe("/test/feature");
  });
  test("Space stays unhandled and Command K still opens commands", async () => {
    await mountApp();
    for (let i = 0; i < 2; i++) {
      const space = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
      document.body.dispatchEvent(space);
      expect(space.defaultPrevented).toBe(false);
    }
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .not.toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .not.toBeInTheDocument();
  });
  test("Command Shift B toggles only the files sidebar", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    for (const visible of [true, false]) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "B",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
      await expect
        .poll(
          () =>
            document.querySelector('[aria-label="Workspace files"]')?.checkVisibility() ?? false,
        )
        .toBe(visible);
      expect(document.getElementById("review-sidebar")).not.toBeNull();
    }
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "K",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect
      .element(page.getByRole("combobox", { name: "Find file", exact: true }))
      .toBeVisible();
  });
  test("files sidebar retains its tree and collapsed folders across toggles", async () => {
    await page.viewport(1280, 800);
    await mountApp({ branches: true });
    const toggle = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "B",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    await expect
      .poll(() => {
        const tree = document.querySelector('[aria-label="Workspace files"] file-tree-container');
        return tree?.shadowRoot?.querySelectorAll('[role="treeitem"]').length ?? 0;
      })
      .toBeGreaterThan(0);
    const preparedHost = document.querySelector(
      '[aria-label="Workspace files"] file-tree-container',
    );
    expect(preparedHost?.checkVisibility()).toBe(false);
    toggle();
    const sidebar = page.getByRole("complementary", { name: "Workspace files", exact: true });
    const folder = sidebar.getByRole("treeitem", { name: "src", exact: true });
    await expect.element(folder).toHaveAttribute("aria-expanded", "true");
    await folder.click();
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    const host = document.querySelector('[aria-label="Workspace files"] file-tree-container');
    expect(host).toBe(preparedHost);
    toggle();
    await expect.poll(() => host?.checkVisibility()).toBe(false);
    toggle();
    await expect.poll(() => host?.checkVisibility()).toBe(true);
    expect(document.querySelector('[aria-label="Workspace files"] file-tree-container')).toBe(host);
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    await openBranch("feature");
    await expect
      .element(sidebar.getByRole("treeitem", { name: "feature-only.ts", exact: true }))
      .toBeVisible();
    expect(document.querySelector('[aria-label="Workspace files"] file-tree-container')).not.toBe(
      host,
    );
    await expect
      .element(sidebar.getByRole("treeitem", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
  });
  test("switches branch tabs and toggles the sidebar with Command B", async () => {
    const { controller } = await mountApp({ branches: true });
    await openBranch("feature");
    await expect
      .poll(() => controller.getSnapshot().session?.repository.path)
      .toBe("/test/feature");
    await openBranch("release");
    await expect.poll(() => controller.getSnapshot().historyRef).toBe("refs/heads/release");
    expect(controller.getSnapshot().comparison).toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(page.getByRole("button", { name: "Working changes", exact: true }))
      .not.toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(() => document.getElementById("review-sidebar")).toBeNull();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(() => document.getElementById("review-sidebar")).not.toBeNull();
  });

  test("mounts real Pierre stream, changes theme and reviews commits without dropping other files", async () => {
    await page.viewport(1280, 800);
    const { requests } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Change color theme");
    await page.getByRole("option", { name: /Change color theme/ }).click();
    await page.getByRole("combobox", { name: "Search themes" }).fill("Tokyo");
    await page.getByRole("option", { name: /Tokyo Night/ }).click();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
    await page.getByRole("option", { name: /Improve the review stream/ }).click();
    await expect
      .poll(() =>
        document.querySelector("[data-selected-commit]")?.getAttribute("data-selected-commit"),
      )
      .toBe(firstCommit);
    await expect
      .poll(() => document.querySelectorAll("diffs-container").length)
      .toBeGreaterThanOrEqual(2);
    await expect.poll(() => document.body.textContent).toContain("ms frame");
    await page.getByRole("option", { name: /Add the initial renderer/ }).click();
    await expect
      .poll(() =>
        document.querySelector("[data-selected-commit]")?.getAttribute("data-selected-commit"),
      )
      .toBe(secondCommit);
    expect(requests).toEqual([
      { kind: "working" },
      { kind: "commit", commit: firstCommit },
      { kind: "commit", commit: secondCommit },
    ]);
  });

  test("clears the prior frame measurement when refreshing the same review", async () => {
    const { controller } = await mountApp();
    await expect.poll(() => document.body.textContent).toContain("ms frame");
    const before = controller.getSnapshot().review?.id;
    let refreshed: Promise<void> | undefined;
    flushSync(() => {
      refreshed = controller.refresh();
    });
    expect(document.body.textContent).not.toContain("ms frame");
    await refreshed;
    expect(controller.getSnapshot().review?.id).toBe(before);
  });

  test("filters the full file set, switches layout, and finds across both files", async () => {
    const { controller } = await mountApp();
    const totals = page.getByRole("group", {
      name: "Comparison total: 2 lines added, 2 lines deleted",
    });
    await expect.element(totals).toBeVisible();
    await page.getByRole("textbox", { name: "Filter changed files" }).fill("alpha");
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(1);
    expect(controller.getSnapshot().files).toHaveLength(2);
    await expect.element(totals).toBeVisible();
    await page.getByRole("button", { name: "Clear file filter" }).click();
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(2);
    await page.getByRole("button", { name: "Unified", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Unified", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("after");
    await expect.element(page.getByText("1 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(page.getByText("2 / 2 hunks", { exact: true })).toBeVisible();
  });

  test("the full diff header toggles collapse while its filename opens the file", async () => {
    await mountApp();
    const toggle = page.getByRole("button", { name: "Collapse src/alpha.ts", exact: true });
    await expect.element(toggle).toBeVisible();
    const bounds = toggle.element().getBoundingClientRect();
    // The far edge of the header is clickable, not just the chevron.
    await toggle.click({ position: { x: bounds.width - 4, y: bounds.height / 2 } });
    const expand = page.getByRole("button", { name: "Expand src/alpha.ts", exact: true });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    (expand.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "File navigation" })).toBeVisible();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("gd uses ctags to jump to a declaration in the current file", async () => {
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", { name: "File navigation" });
    await expect.poll(() => document.activeElement).toBe(pane.element());
    await userEvent.keyboard("2Gwwgd");
    await expect.element(pane).toHaveAttribute("data-vim-line", "2");
    await expect.element(pane).toHaveAttribute("data-vim-column", "14");
    await expect.poll(() => document.activeElement).toBe(pane.element());
  });

  test("shift-click selects an inclusive commit range and a plain click resets it", async () => {
    const { controller } = await mountApp();
    const history = page.getByRole("listbox", { name: "Commits" });
    await history.getByRole("option").nth(0).click();
    await history
      .getByRole("option")
      .nth(1)
      .click({ modifiers: ["Shift"] });
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "range", base: secondCommit, head: firstCommit, includeBase: true });
    await expect
      .element(history.getByRole("option").nth(0))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(history.getByRole("option").nth(1))
      .toHaveAttribute("aria-selected", "true");
    await history.getByRole("option").nth(1).click();
    await expect
      .poll(() => controller.getSnapshot().comparison)
      .toEqual({ kind: "commit", commit: secondCommit });
    await expect
      .element(history.getByRole("option").nth(0))
      .toHaveAttribute("aria-selected", "false");
  });

  test("dismisses selected lines with the draft and moves an open composer to a new range", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    await page.getByRole("button", { name: "Split", exact: true }).click();
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === document.querySelector("diffs-container")?.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await expect.poll(() => Boolean(number("2"))).toBe(true);
    await number("1").click();
    await number("2").click({ modifiers: ["Shift"] });
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Old range draft");
    // Editing inside the card keeps the diff selection.
    await expect
      .element(
        page.getByRole("toolbar", { name: "Line selection" }).getByText("L1–2", { exact: true }),
      )
      .toBeVisible();
    await number("2").click();
    await expect.element(page.getByRole("textbox", { name: "Review note text" })).toHaveValue("");
    await expect.element(page.getByText("Local comment on line R2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-selected-line]").length,
      )
      .toBe(0);
    await number("1").click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Escape this draft");
    await userEvent.keyboard("{Escape}");
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
    await number("1").click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Click away");
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .not.toBeInTheDocument();
  });

  test("shift-selecting line numbers keeps the full range when adding a note", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-additions] [data-column-number]").length,
      )
      .toBeGreaterThanOrEqual(2);
    const host = document.querySelector("diffs-container")!;
    const numbers = host.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-additions] [data-column-number]",
    );
    // Pierre exposes each split side as a number column.
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === host.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await number("1").click();
    await number("2").click({ modifiers: ["Shift"] });
    await expect
      .element(
        page.getByRole("toolbar", { name: "Line selection" }).getByText("L1–2", { exact: true }),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Add note to line", exact: true }).first().click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Both lines");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ line: 1, endLine: 2, side: "new", text: "Both lines" });
  });

  test("dragging the gutter plus opens a note for the full range", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect
      .poll(
        () =>
          document
            .querySelector("diffs-container")
            ?.shadowRoot?.querySelectorAll("[data-additions] [data-column-number]").length,
      )
      .toBeGreaterThanOrEqual(2);
    const host = document.querySelector("diffs-container")!;
    const numbers = host.shadowRoot!.querySelectorAll<HTMLElement>(
      "[data-additions] [data-column-number]",
    );
    // Pierre exposes each split side as a number column.
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    const number = (value: string) =>
      page
        .getByText(value, { exact: true })
        .all()
        .find((locator) => {
          const element = locator.element();
          return (
            element.getRootNode() === host.shadowRoot &&
            element.closest("[data-column-number]")?.closest("[data-additions]")
          );
        })!;
    await number("1").hover();
    await userEvent.dragAndDrop(
      page.getByRole("button", { name: "Add note to line", exact: true }).first(),
      number("2"),
    );
    await page.getByRole("textbox", { name: "Review note text" }).fill("Both lines");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ line: 1, endLine: 2, side: "new", text: "Both lines" });
  });

  test("creates and deletes an inline note without retaining an old annotation portal", async () => {
    const { controller } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Review note text" })
      .fill("Check inline reconciliation");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByText("Check inline reconciliation", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Delete review note" }).click();
    await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(0);
    await expect
      .element(page.getByText("Check inline reconciliation", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Delete review note" }))
      .not.toBeInTheDocument();
  });

  test("replaces a saved draft before completion and preserves a newer draft", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    const mutateNote = controller.mutateNote;
    let completeSave!: () => void;
    const completion = new Promise<void>((resolve) => {
      completeSave = resolve;
    });
    controller.mutateNote = async (mutation) => {
      await mutateNote(mutation);
      await completion;
    };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("First saved comment");
    try {
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
      // The promise is still pending: the published note must replace its composer,
      // rather than add another card that briefly doubles the annotation height.
      await expect.element(page.getByText("First saved comment", { exact: true })).toBeVisible();
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .not.toBeInTheDocument();
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.getByRole("textbox", { name: "Review note text" }).fill("A newer draft");
      completeSave();
      await completion;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .toHaveValue("A newer draft");
    } finally {
      completeSave();
    }
  });

  test("restores draft text after an optimistic comment is rejected", async () => {
    await page.viewport(1280, 800);
    let rejectSave!: (response: Response) => void;
    const result = new Promise<Response>((resolve) => {
      rejectSave = resolve;
    });
    const { controller } = await mountApp({ noteMutation: () => result });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Recover this comment");
    try {
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(1);
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .not.toBeInTheDocument();
      await expect.element(page.getByText("Recover this comment", { exact: true })).toBeVisible();
      rejectSave(Response.json({ error: { message: "Storage is full" } }, { status: 500 }));
      await expect
        .element(page.getByRole("textbox", { name: "Review note text" }))
        .toHaveValue("Recover this comment");
      await expect
        .element(page.getByRole("button", { name: "Clear line selection" }))
        .toBeVisible();
      await expect.poll(() => controller.getSnapshot().notes?.notes.length).toBe(0);
      await expect.element(page.getByText("Storage is full", { exact: true })).toBeVisible();
    } finally {
      rejectSave(Response.json({ error: { message: "Storage is full" } }, { status: 500 }));
    }
  });

  test("keeps an unsaved draft when its save fails", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    controller.mutateNote = async () => {
      throw new Error("Cannot save this comment");
    };
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("after");
    await page.getByRole("button", { name: "Next match" }).click();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    await page.getByRole("textbox", { name: "Review note text" }).fill("Keep my draft");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Cannot save this comment");
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .toHaveValue("Keep my draft");
    expect(controller.getSnapshot().notes?.notes).toHaveLength(0);
  });

  test("advances each keyboard event when a navigation burst is batched", async () => {
    const manyCommits = Array.from({ length: 30 }, (_, index) => ({
      ...commits[0],
      id: index.toString(16).padStart(40, "0"),
      subject: `Commit ${index}`,
      parents: index < 29 ? [(index + 1).toString(16).padStart(40, "0")] : [],
    }));
    const selected: string[] = [];
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
    function HistoryHarness() {
      const [current, setCurrent] = useState(manyCommits[0].id);
      return (
        <HistoryPanel
          commits={manyCommits}
          selected={current}
          loading={false}
          hasMore={false}
          error={null}
          working={false}
          onSelect={(id) => {
            selected.push(id);
            setCurrent(id);
          }}
          onLoadMore={() => {}}
          onWorking={() => {}}
        />
      );
    }
    root.render(<HistoryHarness />);
    await expect.element(page.getByRole("listbox", { name: "Commits" })).toBeVisible();
    const listbox = document.querySelector('[role="listbox"]')!;
    for (let index = 0; index < 21; index++)
      listbox.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(selected).toEqual(manyCommits.slice(1, 22).map((commit) => commit.id));
  });

  test("routes merge parents and preserves pending lanes across appended history pages", () => {
    const history = [
      { ...commits[0], id: "merge", parents: ["left", "right"] },
      { ...commits[0], id: "left", parents: ["base"] },
      { ...commits[0], id: "right", parents: ["base"] },
      { ...commits[0], id: "base", parents: [] },
    ];
    const prefix = layoutHistory(history.slice(0, 2));
    const full = layoutHistory(history);
    expect(full.slice(0, 2)).toEqual(prefix);
    expect(full[0].edges).toHaveLength(2);
    expect(full[2].incoming).toBe(true);
    expect(full[3].edges).toHaveLength(0);
    expect(full.every((row) => row.edges.every((edge) => edge.to >= 0))).toBe(true);
  });

  test("opens a standalone patch without exposing Git controls", async () => {
    const { requests } = await mountApp({ inputOnly: true });
    expect(requests).toEqual([{ kind: "patch", path: "/test/change.patch" }]);
    await expect
      .element(page.getByRole("region", { name: "Commit history" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("combobox", { name: "Worktree" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Toggle notes" })).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
  });

  test("reveals metadata-only files selected in the sidebar", async () => {
    await page.viewport(1280, 600);
    const { controller } = await mountApp({ metadataFile: true });
    await page.getByRole("treeitem", { name: /image.png/ }).click();
    const target = page.getByText("Binary file", { exact: true });
    await expect.element(target).toBeVisible();
    const row = document.querySelector('[data-metadata-file="assets/image.png"]');
    await expect
      .poll(() => {
        const rect = row?.getBoundingClientRect();
        return rect !== undefined && rect.top >= 0 && rect.bottom <= innerHeight;
      })
      .toBe(true);
    expect(
      controller
        .getSnapshot()
        .files.find((file) => file.id === controller.getSnapshot().selectedFileId)?.path,
    ).toBe("assets/image.png");
  });

  test("edits a stale note outside current hunks and preserves an orphaned note", async () => {
    const { controller } = await mountApp({
      notes: [
        {
          id: "inline",
          path: "src/alpha.ts",
          side: "new",
          line: 900,
          text: "Check this value",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "stale",
        },
        {
          id: "orphan",
          path: "src/removed.ts",
          side: "old",
          line: 3,
          text: "Preserve this concern",
          createdAt: "2026-09-19T00:00:00Z",
          updatedAt: "2026-09-19T00:00:00Z",
          resolution: "orphaned",
        },
      ],
    });
    await page.getByText("2 preserved notes outside this diff", { exact: true }).click();
    await expect.element(page.getByText("Check this value", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Source changed since this note was written.", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page
      .getByRole("textbox", { name: "Edit note text" })
      .fill("Checked against the current source");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes.find((note) => note.id === "inline")?.text)
      .toBe("Checked against the current source");
    await expect.element(page.getByText("Preserve this concern", { exact: true })).toBeVisible();
  });
});
