import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createReviewController } from "../../src/web/data/controller";
import type {
  Comparison,
  Note,
  PullRequestComments,
  ReviewResponse,
} from "../../src/shared/protocol";
import { HistoryPanel } from "../../src/web/components/HistoryPanel";
import { initializeTheme, themeController } from "../../src/web/themes";
import { layoutHistory } from "../../src/web/components/history-layout";
import { createBrowseApi } from "../../src/web/data/browse";
import type { BrowseSource } from "../../src/shared/browse";
import type { BlameLoader } from "../../src/web/data/blame";
import type { CommitApi } from "../../src/web/data/commit";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";

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

beforeEach(() => {
  localStorage.removeItem("med:vim");
  localStorage.removeItem("med:zen");
  localStorage.removeItem("med:history");
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  localStorage.removeItem("med:vim");
  localStorage.removeItem("med:zen");
  localStorage.removeItem("med:history");
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
    /** Markdown brief of the saved review. */
    brief?: string;
    readOnly?: boolean;
    noteMutation?: () => Promise<Response | undefined>;
    /** One agent iteration per brief. The first and the last own the two saved targets. */
    iterationBriefs?: string[];
    /** Both iterations are commits on the main branch of one repository. */
    oneBranch?: boolean;
    /** Replaces the two small files with these, as path and unified patch. */
    review?: { paths: string[]; patch: string };
    /** GitHub comments; the first saved target compares the pull request head. */
    pullRequest?: PullRequestComments;
    loadBlame?: BlameLoader;
    /** The Commit tab's repository. */
    commitApi?: CommitApi;
  } = {},
) {
  initializeTheme();
  themeController.commit("graphite-dark");
  const requests: Comparison[] = [];
  const fileRequests: { source: BrowseSource; path: string }[] = [];
  let notes = options.notes ?? [];
  let revision = 0;
  const savedTargets = (
    options.oneBranch ? ["/test/repo", "/test/repo"] : ["/test/repo", "/test/feature"]
  ).map((repo, index) => {
    const commit =
      options.pullRequest && !index
        ? options.pullRequest.head
        : options.oneBranch
          ? [firstCommit, secondCommit][index]
          : undefined;
    return {
      id: `target-${index}`,
      repositoryId: options.oneBranch ? "repo-0" : `repo-${index}`,
      repo,
      branch: index && !options.oneBranch ? "feature" : "main",
      label: `Captured ${index}`,
      comparison: (commit ? { kind: "commit", commit } : { kind: "working" }) as Comparison,
      base: secondCommit,
      head: commit ?? "working",
      captured: !(options.pullRequest && !index),
    };
  });
  const pullRequestReads: string[] = [];
  const savedRepositories = savedTargets.slice(0, options.oneBranch ? 1 : 2).map((target) => ({
    id: target.repositoryId,
    path: target.repo,
    name: target.repo.split("/").at(-1)!,
    branches: [
      { name: target.branch, head: firstCommit, worktreePath: target.repo, current: true },
    ],
    worktrees: [{ path: target.repo, head: firstCommit, branch: target.branch }],
  }));
  let brief = options.brief;
  const savedNotes: Note[] = [];
  const savedBundle = () => ({
    id: "saved",
    title: "Agent review",
    createdAt: "2026-09-20T00:00:00Z",
    revision: 0,
    commentCount: 0,
    targets: savedTargets,
    ...(options.pullRequest
      ? { pullRequestUrl: options.pullRequest.url, pullRequestTitle: "Read pull request threads" }
      : {}),
    ...(brief ? { brief: { text: brief, updatedAt: "2026-09-20T00:00:00Z" } } : {}),
    ...(options.iterationBriefs
      ? {
          key: "feat/agent",
          iterations: options.iterationBriefs.map((text, index) => ({
            number: index + 1,
            createdAt: new Date(Date.UTC(2026, 8, 20 + index)).toISOString(),
            targetIds:
              index === 0
                ? [savedTargets[0]!.id]
                : index === options.iterationBriefs!.length - 1
                  ? [savedTargets[1]!.id]
                  : [],
            brief: { text, updatedAt: new Date(Date.UTC(2026, 8, 20 + index)).toISOString() },
          })),
        }
      : {}),
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (options.savedReview) {
      if (url.pathname === "/api/reviews/saved") return Response.json(savedBundle());
      if (url.pathname === "/api/reviews/saved/pull-request" && options.pullRequest) {
        pullRequestReads.push(url.search);
        return Response.json(options.pullRequest);
      }
      if (url.pathname === "/api/reviews/saved/brief" && init?.method === "POST") {
        brief = JSON.parse(String(init.body)).brief ?? undefined;
        return Response.json(savedBundle());
      }
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
        if (savedRoute[2] === "notes" && init?.method === "POST") {
          const { mutation } = JSON.parse(String(init.body));
          if (mutation.type === "add")
            savedNotes.push({
              ...mutation.note,
              id: `saved-note-${savedNotes.length}`,
              resolution: "active",
              createdAt: "2026-09-20T00:00:00Z",
              updatedAt: "2026-09-20T00:00:00Z",
            });
          return Response.json({ reviewId: target.id, revision: ++revision, notes: savedNotes });
        }
        return Response.json(
          savedRoute[2] === "notes"
            ? { reviewId: target.id, revision, notes: savedNotes }
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
      if (options.review) {
        review.patch = options.review.patch;
        review.files = options.review.paths.map((path) => ({
          path,
          status: "M",
          additions: 1,
          deletions: 1,
          binary: false,
        }));
      }
      if (options.metadataFile)
        review.files.push({
          path: "assets/model.bin",
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
  const browse = createBrowseApi(fetcher, "fixture");
  // Writable working files open in the Vim editor; without write they use the read-only viewer.
  root.render(
    <App
      controller={controller}
      browseApi={{ ...browse, write: options.readOnly ? undefined : browse.write }}
      loadBlame={options.loadBlame}
      commitApi={options.commitApi && (() => options.commitApi!)}
    />,
  );
  await expect
    .poll(() => document.querySelector("[data-review-status]")?.getAttribute("data-review-status"))
    .toBe("ready");
  // A saved review with a brief opens on the Brief tab. Its hidden diff views
  // have no box, so they render when Changes shows.
  const briefFirst =
    options.savedReview && (options.brief !== undefined || options.iterationBriefs);
  await expect
    .poll(() => document.querySelectorAll("diffs-container").length)
    .toBeGreaterThanOrEqual(briefFirst ? 0 : options.review ? 1 : 2);
  return { controller, requests, fileRequests, pullRequestReads };
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
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
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
      .element(page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true }))
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
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
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
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
  });
  test("Git blame opens for the current file tab only and closes when another tab shows", async () => {
    await mountApp({
      loadBlame: async (file, start) => ({
        source: file.source,
        path: file.path,
        identity: file.identity,
        truncated: false,
        lines: [{ line: start, commit: "a".repeat(40), author: "Mira", date: "", summary: "Add" }],
      }),
    });
    for (const name of ["src/alpha.ts", "src/beta.ts"])
      await page.getByRole("link", { name, exact: true }).click({ modifiers: ["Meta"] });
    const blame = page.getByRole("button", { name: "Toggle Git blame" });
    await page.getByRole("tab", { name: "alpha.ts", exact: true }).click();
    await blame.click();
    await expect.element(blame).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("tab", { name: "beta.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true }))
      .toBeVisible();
    await expect.element(blame).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("tab", { name: "alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
      .toBeVisible();
    await expect.element(blame).toHaveAttribute("aria-pressed", "false");
  });
  test("the editor shows the resting cursor line's blame until the draft changes", async () => {
    await mountApp({
      loadBlame: async (file, start, end) => ({
        source: file.source,
        path: file.path,
        identity: file.identity,
        truncated: false,
        lines: Array.from({ length: end - start + 1 }, (_, index) => ({
          line: start + index,
          commit: "a".repeat(40),
          author: index ? "Sam" : "Mira",
          date: "2026-09-20T01:23:45.000Z",
          summary: `Change line ${start + index}`,
        })),
      }),
    });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    const label = () => document.querySelector<HTMLElement>(".cm-line [data-med-line-blame-label]");
    await expect.poll(() => label()?.dataset.who).toMatch(/^Mira, /);
    expect(label()!.closest(".cm-line")!.textContent).toBe(
      'export const workspace = "/test/repo";',
    );
    await userEvent.keyboard("j");
    await expect.poll(() => label()?.dataset.who).toMatch(/^Sam, /);
    expect(label()!.dataset.summary).toBe(" · Change line 2");
    await userEvent.keyboard("ix");
    await expect.poll(() => label()).toBeNull();
  });
  test("a click on the selected changes-tree file shows it in Changes again", async () => {
    await mountApp();
    const alpha = page.getByRole("treeitem", { name: /alpha.ts/ });
    await alpha.click();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await alpha.click();
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");
  });
  test("a fresh launch opens read-only files with a visible Vim cursor and keyboard focus", async () => {
    await mountApp({ readOnly: true });
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
    await mountApp({ readOnly: true });
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
      .element(page.getByRole("region", { name: "File editor", exact: true }))
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

  test("zen mode hides every bar and leaves the sidebars as they are", async () => {
    await page.viewport(1400, 850);
    await mountApp({ branches: true });
    const sidebar = () => document.getElementById("review-sidebar")?.checkVisibility() ?? false;
    const files = () =>
      document.querySelector('[aria-label="Workspace files"]')?.checkVisibility() ?? false;
    const bars = () =>
      ['[aria-label="Open files"]', "footer"].some(
        (selector) => document.querySelector(selector)?.checkVisibility() ?? false,
      );
    const key = (code: string, options: KeyboardEventInit) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: code.at(-1)!, code, bubbles: true, ...options }),
      );
    const exit = page.getByRole("button", { name: "Exit zen mode", exact: true });
    key("KeyB", { metaKey: true, shiftKey: true });
    await expect.poll(files).toBe(true);
    await page.getByRole("button", { name: "Enter zen mode", exact: true }).click();
    await expect.element(exit).toBeInTheDocument();
    expect([sidebar(), files(), bars()]).toEqual([true, true, false]);
    // The toggle left with the chrome, so focus moves to the way out.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Exit zen mode");
    // Panel keys work as usual inside zen, and the choice outlasts it.
    key("KeyB", { metaKey: true });
    await expect.poll(sidebar).toBe(false);
    key("KeyB", { metaKey: true, shiftKey: true });
    await expect.poll(files).toBe(false);
    expect(bars()).toBe(false);
    await expect.element(exit).toBeInTheDocument();
    key("KeyZ", { altKey: true });
    await expect.poll(bars).toBe(true);
    expect([sidebar(), files()]).toEqual([false, false]);
    expect(localStorage.getItem("med:zen")).toBe("off");
    key("KeyB", { metaKey: true });
    await expect.poll(sidebar).toBe(true);
    key("KeyZ", { altKey: true });
    await expect.element(exit).toBeInTheDocument();
    expect([sidebar(), files()]).toEqual([true, false]);
    expect(localStorage.getItem("med:zen")).toBe("on");
    await exit.click();
    await expect.poll(bars).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Enter zen mode");
  });

  test("a single branch needs no tab strip; Command Shift G opens another beside it", async () => {
    await mountApp({ branches: true });
    const strip = page.getByRole("tablist", { name: "Branches and worktrees" });
    const switcher = page.getByRole("button", { name: "Open branch", exact: true });
    const branch = () => switcher.element().textContent?.split("/").at(-1);
    await expect.poll(branch).toBe("main");
    await expect.element(strip).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "G", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(page.getByRole("dialog", { name: "Open branch" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(strip.getByRole("tab", { name: "feature", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(strip.getByRole("tab", { name: "main", exact: true })).toBeVisible();
    await expect.poll(branch).toBe("feature");
    await page.getByRole("button", { name: "Close feature", exact: true }).click();
    await expect.element(strip).not.toBeInTheDocument();
    await expect.poll(branch).toBe("main");
  });

  test("the shortcut guide opens on the current context and searches keys", async () => {
    await mountApp({ branches: true });
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    const guide = page.getByRole("dialog", { name: "Shortcuts & commands" });
    await expect.element(guide.getByRole("tab", { name: /Review/, selected: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("zz");
    await expect
      .element(guide.getByRole("option", { name: /Center the cursor line/ }))
      .toBeVisible();
    expect(guide.getByRole("option").elements()).toHaveLength(2);
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("zen");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("button", { name: "Exit zen mode", exact: true }))
      .toBeInTheDocument();
    await expect.element(guide).not.toBeInTheDocument();
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
    const editor = page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    altKey("KeyW", true);
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("tab", { name: "Changes", exact: true })).toBeVisible();
  });
  test("Find file opens a preview tab with Enter and a kept tab with Mod+Enter; tab keys move along the row", async () => {
    await mountApp();
    const find = async (name: string, keys: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
      );
      await page.getByRole("combobox", { name: "Find file", exact: true }).fill(name);
      await expect.element(page.getByRole("option", { name: new RegExp(name) })).toBeVisible();
      await userEvent.keyboard(keys);
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    };
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    // A preview tab's tooltip says so.
    const title = (name: string) => tab(name).query()?.getAttribute("title");
    await find("alpha.ts", "{Enter}");
    await expect.poll(() => title("alpha.ts")).toMatch(/Preview/);
    await find("beta.ts", "{Control>}{Enter}{/Control}");
    await expect.poll(() => title("beta.ts")).toMatch(/^src\/beta\.ts(?!.*Preview)/);
    // The kept tab replaced the preview tab, as a double-click in Files does.
    await expect.element(tab("alpha.ts")).not.toBeInTheDocument();
    await find("alpha.ts", "{Enter}");
    // The row is Changes, Commit, beta.ts, alpha.ts.
    const key = (init: KeyboardEventInit, target: EventTarget = window) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
      );
    const selected = async (name: string) => {
      await expect.element(tab(name)).toHaveAttribute("aria-selected", "true");
    };
    // From alpha.ts's editor too, where Option+3 would otherwise type £.
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    key({ key: "£", code: "Digit3", altKey: true }, editor.element());
    await selected("beta.ts");
    key({ key: "¡", code: "Digit1", altKey: true });
    await selected("Changes");
    key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    await selected("Commit");
    key({ key: "ª", code: "Digit9", altKey: true });
    await selected("alpha.ts");
    key({ key: "}", code: "BracketRight", metaKey: true, shiftKey: true });
    await selected("Changes");
    key({ key: "{", code: "BracketLeft", ctrlKey: true, shiftKey: true });
    await selected("alpha.ts");
  });
  test("opens working contents from a historical diff and keeps the diff mounted", async () => {
    await page.viewport(1400, 850);
    const { fileRequests } = await mountApp({ branches: true });
    await page.getByRole("option", { name: /Add the initial renderer/ }).click();
    const diffHost = document.querySelector("diffs-container");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "File editor", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({ source: { kind: "worktree", repo: "/test/repo" }, path: "src/alpha.ts" });
    expect(diffHost?.isConnected).toBe(true);
    await page.getByRole("button", { name: "Open before", exact: true }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("commit");
    // Commit snapshots stay read-only.
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .toBeVisible();
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
    const sidebar = () => document.getElementById("review-sidebar")?.checkVisibility() ?? false;
    const panel = document.querySelector("#review-sidebar section");
    expect(panel).not.toBeNull();
    // A new branch name rolls in; moving the switch with the sidebar does not replay it.
    const name = () =>
      page.getByRole("button", { name: "Open branch" }).getByText("release", { exact: true });
    expect(name().element().getAnimations().length).toBeGreaterThan(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(false);
    expect(name().element().getAnimations()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(true);
    expect(name().element().getAnimations()).toEqual([]);
    // The sidebar comes back as it was, without building its panels again.
    expect(document.querySelector("#review-sidebar section")).toBe(panel);
  });

  test("mounts real Pierre stream, changes theme and reviews commits without dropping other files", async () => {
    await page.viewport(1280, 800);
    const { requests } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Change theme");
    await page.getByRole("option", { name: /Change theme/ }).click();
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
    const totals = page.getByRole("button", {
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
    // Every match is marked; the current hit's matches are marked on top.
    await expect.poll(() => CSS.highlights.get("med-diff-find")?.size ?? 0).toBeGreaterThan(1);
    await expect
      .poll(() => [...(CSS.highlights.get("med-diff-find-current") ?? [])].map(String))
      .toContain("after");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(page.getByText("2 / 2 hunks", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => CSS.highlights.has("med-diff-find")).toBe(false);
  });

  test("find in diffs centers matches in other files, collapsed ones too", async () => {
    await page.viewport(1280, 800);
    // Long files, so a match starts far outside the viewport and the
    // virtualized list must measure rows it has not drawn yet.
    const paths = [0, 1, 2, 3, 4].map((index) => `src/long${index}.ts`);
    const body = (index: number) =>
      Array.from({ length: 140 }, (_, line) =>
        index === 3 && line === 100
          ? "const needleLater = 1;"
          : index === 0 && line === 120
            ? "const needleCollapsed = 1;"
            : `const value${line} = ${index};`,
      );
    const reviewPatch = paths
      .map(
        (path, index) =>
          `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,140 +1,140 @@\n` +
          body(index)
            .map((line) => `-${line.replace(/= \d+;$/, "= -1;")}\n+${line}\n`)
            .join(""),
      )
      .join("");
    await mountApp({ review: { paths, patch: reviewPatch } });
    await page.getByRole("button", { name: "Collapse src/long0.ts", exact: true }).click();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in diff contents" }).fill("needle");
    await expect.element(page.getByText("1 / 2 hunks", { exact: true })).toBeVisible();
    const stream = page.getByRole("main", { name: "Continuous review" }).element();
    const line = (text: string) => {
      for (const host of document.querySelectorAll("diffs-container")) {
        const walker = document.createTreeWalker(host.shadowRoot!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode())
          if (walker.currentNode.textContent?.includes(text))
            return walker.currentNode.parentElement!.getBoundingClientRect();
      }
      return null;
    };
    const centered = async (text: string) => {
      const near = () => {
        const rect = line(text);
        const view = stream.getBoundingClientRect();
        return (
          !!rect &&
          Math.abs((rect.top + rect.bottom) / 2 - (view.top + view.bottom) / 2) < view.height / 4
        );
      };
      await expect.poll(near).toBe(true);
      // It stays there once the rows around it have been measured.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(near()).toBe(true);
    };
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 / 2 hunks", { exact: true })).toBeVisible();
    await centered("needleLater");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 / 2 hunks", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Collapse src/long0.ts", exact: true }))
      .toBeInTheDocument();
    await centered("needleCollapsed");
  });

  test("next hunk puts the whole hunk in the middle of the view", async () => {
    await page.viewport(1280, 800);
    // One file with 14 hunks of 8 lines each: a context line, 6 added lines, a context line.
    const path = "src/hunks.ts";
    const hunks = Array.from({ length: 14 }, (_, index) => {
      const start = 1 + index * 50;
      return (
        `@@ -${start},2 +${start + index * 6},8 @@\n const before${index} = 0;\n` +
        ["a", "b", "c", "d", "e", "f"].map((part) => `+const hunk${index}${part} = 1;\n`).join("") +
        ` const after${index} = 0;\n`
      );
    });
    await mountApp({
      review: {
        paths: [path],
        patch: `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`,
      },
    });
    const row = (text: string) => {
      for (const host of document.querySelectorAll("diffs-container")) {
        const walker = document.createTreeWalker(host.shadowRoot!, NodeFilter.SHOW_TEXT);
        while (walker.nextNode())
          if (walker.currentNode.textContent?.includes(text))
            return walker.currentNode.parentElement!.getBoundingClientRect();
      }
      return null;
    };
    await expect.poll(() => row("hunk0a")).not.toBeNull();
    let scroller = document.querySelector("diffs-container")!.parentElement!;
    while (!/auto|scroll/.test(getComputedStyle(scroller).overflowY))
      scroller = scroller.parentElement!;
    for (let step = 0; step < 6; step++) await userEvent.keyboard("]");
    // The middle of the hunk, between its third and fourth added lines, is
    // the middle of the scrolling view, within a line. Before, the hunk's first
    // line was at the top.
    const offset = () => {
      const third = row("hunk6c");
      const view = scroller.getBoundingClientRect();
      return third ? Math.abs(third.bottom - (view.top + view.bottom) / 2) : Infinity;
    };
    await expect.poll(offset).toBeLessThan(20);
  });

  test("the comparison totals split lines into code, tests, and lockfiles", async () => {
    const file = (path: string, lines: number) =>
      `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,${lines + 1} @@\n const kept = 1;\n` +
      Array.from({ length: lines }, (_, line) => `+const added${line} = ${line};\n`).join("");
    const paths = ["src/app.ts", "src/app.test.ts", "bun.lock"];
    await mountApp({
      review: { paths, patch: file(paths[0], 2) + file(paths[1], 3) + file(paths[2], 40) },
    });
    // The fixture reports one added and one deleted line for each file.
    const totals = page.getByRole("button", { name: /^Comparison total:/ });
    await expect.element(totals).toHaveTextContent("+3−3");
    totals.element().focus();
    const tooltip = page.getByRole("table");
    await expect.element(tooltip).toBeVisible();
    expect(
      [...tooltip.element().querySelectorAll("tr")].map((row) => [
        row.dataset.kind,
        row.textContent,
      ]),
    ).toEqual([
      ["code", "Code1 file+1−1"],
      ["tests", "Tests1 file+1−1"],
      ["lockfiles", "Lockfiles1 file+1−1"],
    ]);
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
    await expect.element(page.getByRole("textbox", { name: "Edit src/alpha.ts" })).toBeVisible();
    await page.getByRole("tab", { name: "Changes", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("gd uses ctags to jump to a declaration in the current file", async () => {
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    const cursorLine = () => document.querySelector(".med-editor .cm-activeLine")?.textContent;
    // Type a use on the last line, then jump to the fixture's ctags match at line 2, column 14.
    await userEvent.keyboard("Giuse(workingContents);{Escape}0wwgd");
    await expect.poll(cursorLine).toBe("export const workingContents = true;");
    // Insert at the cursor to prove the column.
    await userEvent.keyboard("i_{Escape}");
    await expect.poll(cursorLine).toBe("export const _workingContents = true;");
    await expect.poll(() => document.activeElement).toBe(editor.element());
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
    await expect
      .element(page.getByRole("form", { name: "Local comment on line R2", exact: true }))
      .toBeVisible();
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
    await page.getByRole("treeitem", { name: /model.bin/ }).click();
    const target = page.getByText("Binary file", { exact: true });
    await expect.element(target).toBeVisible();
    const row = document.querySelector('[data-metadata-file="assets/model.bin"]');
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
    ).toBe("assets/model.bin");
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
  test("q opens the Commit tab, where keys stage, commit, and push a new branch", async () => {
    // An unsent message is kept per checkout; start without one.
    for (const key of Object.keys(localStorage))
      if (key.startsWith("med:commit-message:")) localStorage.removeItem(key);
    const repository = createFakeRepository({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("tab", { name: "Commit", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    const files = page.getByRole("listbox", { name: "Changed files" });
    await expect.element(files).toHaveFocus();
    const row = (path: string) => files.getByRole("option", { name: new RegExp(`^${path}, `) });
    const rows = () =>
      files
        .getByRole("option")
        .elements()
        .map((element) => element.getAttribute("aria-label"));
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");

    // / filters the list and the diff stream. Enter keeps the filter; Esc in
    // the list clears it, as in a search.
    const stream = page.getByRole("region", { name: "Changes to commit" });
    await userEvent.keyboard("/");
    await expect
      .element(page.getByRole("textbox", { name: "Filter files to commit" }))
      .toHaveFocus();
    await userEvent.keyboard("src/web");
    await expect
      .poll(rows)
      .toEqual([
        "src/web/App.tsx, partly staged, modified",
        "src/web/components/CommitView.tsx, not staged, untracked",
      ]);
    await expect
      .element(stream.getByRole("button", { name: /stage docs\/USAGE\.md$/i }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await expect.element(files).toHaveFocus();
    expect(rows()).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => rows().length).toBe(5);

    // Space stages the focused file at once, before Git answers; j moves on.
    repository.configure({ upstream: false, hookFails: true, pushRejected: false, slow: true });
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"), { timeout: 400 })
      .toHaveAccessibleName("docs/USAGE.md, staged, modified");
    await expect
      .element(stream.getByRole("button", { name: "Unstage docs/USAGE.md" }), { timeout: 400 })
      .toBeVisible();
    repository.configure({ upstream: false, hookFails: true, pushRejected: false, slow: false });
    await userEvent.keyboard("j");
    await expect
      .element(row("scripts/obsolete-check.mjs"))
      .toHaveAttribute("aria-selected", "true");

    // c opens the message in a dialog. A failed hook keeps the message and
    // shows its output there.
    await expect
      .element(page.getByRole("textbox", { name: "Commit message" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("c");
    const message = page.getByRole("textbox", { name: "Commit message" });
    await expect.element(message).toHaveFocus();
    await userEvent.keyboard("docs: explain the Commit tab");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .element(page.getByRole("alert").filter({ hasText: "lint-staged" }))
      .toMatchTextContent("Missing semicolon");
    await expect.element(message).toHaveValue("docs: explain the Commit tab");
    repository.configure({ upstream: false, hookFails: false, pushRejected: false, slow: false });
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Committed " }))
      .toMatchTextContent(/^Committed [0-9a-f]{7} docs: explain the Commit tab$/);
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(files).toHaveFocus();
    // Staged files left the list; the unstaged half of App.tsx stayed.
    await expect
      .poll(rows)
      .toEqual([
        "src/web/App.tsx, not staged, modified",
        "src/web/components/CommitView.tsx, not staged, untracked",
      ]);

    // A branch without an upstream asks before it pushes and tracks.
    await userEvent.keyboard("{Shift>}P{/Shift}");
    const confirm = page.getByRole("group", { name: "Track a new upstream" });
    await expect
      .element(confirm)
      .toMatchTextContent("Push to origin/feature/commit-tab and track it?");
    await expect.element(confirm.getByRole("button", { name: "Push and track" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Pushed " }))
      .toMatchTextContent(/^Pushed [0-9a-f]{7} to origin\/feature\/commit-tab$/);

    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("tab", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-selected", "true");

    // As in Changes, a file name in the stream opens the file (Command-click
    // behind this tab), and Enter opens the focused file.
    await userEvent.keyboard("q");
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await expect.element(tab("Commit")).toHaveAttribute("aria-selected", "true");
    stream
      .getByRole("link", { name: "src/web/components/CommitView.tsx", exact: true })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    await expect.element(tab("CommitView.tsx")).toBeVisible();
    await expect.element(tab("Commit")).toHaveAttribute("aria-selected", "true");
    await row("src/web/App.tsx").click();
    await userEvent.keyboard("{Enter}");
    await expect.element(tab("App.tsx")).toHaveAttribute("aria-selected", "true");
  });
});

describe("review brief", () => {
  const excerptText = () =>
    [...document.querySelectorAll("[data-brief-excerpt] diffs-container")]
      .map((host) => host.shadowRoot?.textContent ?? "")
      .join("\n");

  test("opens on the brief, shows the cited lines, and follows a link into Changes", async () => {
    await mountApp({
      savedReview: true,
      brief: "# Rename the export\n\nThe constant changes in [alpha.ts:1](src/alpha.ts:1).\n",
    });
    await expect
      .element(page.getByRole("tab", { name: "Brief" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("heading", { name: "Rename the export" })).toBeVisible();
    await expect.element(page.getByText("Cites 1 of 2 changed files")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Open src/alpha.ts L1 in Changes" }))
      .toBeVisible();
    await expect.poll(excerptText).toContain("export const after = 2;");
    await expect.element(page.getByRole("heading", { name: "Not in the brief 1" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "src/beta.ts +1 −1" })).toBeVisible();

    await page.getByRole("link", { name: "alpha.ts:1" }).click();
    await expect
      .element(page.getByRole("tab", { name: "Changes" }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("button", { name: "Clear line selection" }))
      .toBeInTheDocument();
  });

  test("an agent's iterations switch the brief and its comparison together", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp({
      savedReview: true,
      iterationBriefs: ["# First round\n", "# Second round\n"],
    });
    // The current iteration opens: its brief and its comparison.
    await expect.element(page.getByRole("heading", { name: "Second round" })).toBeVisible();
    expect(controller.getSnapshot().savedTargetId).toBe("target-1");
    await expect
      .element(page.getByRole("button", { name: "Iteration 2" }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Iteration 1" }).click();
    await expect.element(page.getByRole("heading", { name: "First round" })).toBeVisible();
    await expect.poll(() => controller.getSnapshot().savedTargetId).toBe("target-0");
    await expect
      .element(page.getByRole("combobox", { name: "Review target" }))
      .toHaveValue("target-0");
    // Choosing a comparison shows it, and the brief follows its iteration.
    await page.getByRole("combobox", { name: "Review target" }).selectOptions("target-1");
    await expect
      .element(page.getByRole("tab", { name: "Changes" }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "Brief" }).click();
    await expect.element(page.getByRole("heading", { name: "Second round" })).toBeVisible();
  });

  test("many iterations keep the latest keys and list earlier ones in a menu", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      iterationBriefs: Array.from({ length: 12 }, (_, index) => `# Round ${index + 1}\n`),
    });
    await expect.element(page.getByRole("heading", { name: "Round 12" })).toBeVisible();
    const keys = page.getByRole("group", { name: "Iterations" });
    expect(
      keys
        .getByRole("button")
        .elements()
        .map((key) => key.textContent),
    ).toEqual(["…", "7", "8", "9", "10", "11", "12"]);
    const header = keys.element().parentElement!;
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
    // An earlier round opens from the menu, and the menu key shows it.
    await page.getByRole("button", { name: "Earlier iterations" }).click();
    await page.getByRole("menuitemcheckbox", { name: /^Iteration 3 · / }).click();
    await expect.element(page.getByRole("heading", { name: "Round 3" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Iteration 3, earlier iterations" }))
      .toHaveTextContent("3");
    await page.getByRole("button", { name: "Iteration 12" }).click();
    await expect.element(page.getByRole("heading", { name: "Round 12" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Earlier iterations" })).toBeVisible();
    // A narrow pane keeps fewer keys; the label stays on one line.
    await page.viewport(700, 800);
    await expect.poll(() => keys.getByRole("button").elements().length).toBeLessThan(7);
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
    const label = header.firstElementChild!.getBoundingClientRect();
    expect(label.height).toBeLessThan(24);
  });

  test("an iteration on the same branch replaces the brief without reloading the review", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      oneBranch: true,
      iterationBriefs: ["# First round\n", "# Second round\n"],
    });
    await expect.element(page.getByRole("heading", { name: "Second round" })).toBeVisible();
    // Record each state that the window shows, from the click to the new brief.
    const shown = new Set<string>();
    const record = () => {
      const app = document.querySelector<HTMLElement>("[data-review-status]");
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      const heading = document.querySelector(".med-brief-prose h1")?.textContent;
      shown.add(`${app?.dataset.reviewStatus} ${tab?.textContent} ${heading}`);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    await page.getByRole("button", { name: "Iteration 1" }).click();
    await expect.element(page.getByRole("heading", { name: "First round" })).toBeVisible();
    observer.disconnect();
    expect([...shown].filter((state) => !/^ready Brief (First|Second) round$/.test(state))).toEqual(
      [],
    );
  });

  test("draws a Mermaid diagram in the brief", async () => {
    await mountApp({
      savedReview: true,
      brief: "# Flow\n\n```mermaid\nflowchart LR\n  Edit --> Journal\n```\n",
    });
    await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeInTheDocument();
    expect(document.querySelector(".med-md-diagram svg")?.textContent).toContain("Journal");
    // Flat shapes: Mermaid's default look adds grey drop shadows.
    const shapes = document.querySelectorAll(".med-md-diagram svg :is(rect, path, polygon)");
    expect([...shapes].filter((shape) => getComputedStyle(shape).filter !== "none")).toEqual([]);
  });

  test("loads a brief image from the repository", async () => {
    await mountApp({ savedReview: true, brief: "# Screens\n\n![The review](docs/review.png)\n" });
    await expect.element(page.getByRole("img", { name: "The review" })).toBeInTheDocument();
    const source = new URL(document.querySelector<HTMLImageElement>("img[alt='The review']")!.src);
    expect(source.pathname).toBe("/api/markdown/image");
    expect(source.searchParams.get("href")).toBe("docs/review.png");
    expect(JSON.parse(source.searchParams.get("source")!)).toMatchObject({ kind: "worktree" });
  });

  test("adds a note on excerpt lines that also shows in Changes", async () => {
    const { controller } = await mountApp({
      savedReview: true,
      brief: "The constant changes in [alpha.ts:1](src/alpha.ts:1).\n",
    });
    const excerpt = () => document.querySelector("[data-brief-excerpt] diffs-container");
    await expect
      .poll(() => excerpt()?.shadowRoot?.querySelectorAll("[data-column-number]").length)
      .toBeGreaterThanOrEqual(2);
    const host = excerpt()!;
    const added = page
      .getByText("1", { exact: true })
      .all()
      .find((locator) => {
        const element = locator.element();
        return (
          element.getRootNode() === host.shadowRoot &&
          element.closest("[data-column-number]") &&
          element.closest('[data-line-type="change-addition"]')
        );
      })!;
    await added.click();
    await userEvent.keyboard("c");
    await page.getByRole("textbox", { name: "Review note text" }).fill("Keep this name");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ path: "src/alpha.ts", side: "new", line: 1, text: "Keep this name" });
    await expect.element(page.getByTitle("1 note on these lines")).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Review note text" }))
      .not.toBeInTheDocument();

    await page.getByRole("tab", { name: "Changes" }).click();
    await expect
      .poll(() => page.getByText("Keep this name", { exact: true }).elements().length)
      .toBe(2);
  });

  test("shows GitHub pull request comments read-only, apart from local notes", async () => {
    const comment = (id: number, author: string, body: string) => ({
      id,
      author,
      body,
      createdAt: "2026-09-20T00:00:00Z",
      url: `https://github.com/acme/med/pull/7#discussion_r${id}`,
    });
    const { pullRequestReads } = await mountApp({
      savedReview: true,
      pullRequest: {
        url: "https://github.com/acme/med/pull/7",
        head: firstCommit,
        fetchedAt: Date.now(),
        threads: [
          {
            id: 11,
            path: "src/alpha.ts",
            side: "new",
            line: 1,
            startLine: null,
            originalLine: 1,
            comments: [
              comment(11, "mira", "Rename `after` to `next`."),
              comment(12, "sam", "Done in the next push."),
            ],
          },
          {
            id: 21,
            path: "src/beta.ts",
            side: "old",
            line: null,
            startLine: null,
            originalLine: 2,
            comments: [comment(21, "mira", "Is this still needed?")],
          },
        ],
        conversation: [comment(31, "sam", "Ready for review.")],
        reviews: [{ ...comment(41, "jordan", ""), state: "APPROVED" }],
      },
    });
    // The header names the PR by its own title; the browser tab keeps the short title.
    await expect
      .element(page.getByRole("link", { name: "Open pull request: Read pull request threads" }))
      .toBeVisible();
    expect(document.title).toBe("Agent review");
    // The thread on the pull request head shows on its line, with no way to write.
    const thread = page.getByRole("article", { name: "GitHub thread by mira at R1, read-only" });
    await expect.element(thread).toBeVisible();
    expect(thread.element().textContent).toMatch(
      /Rename after to next\..*sam.*Done in the next push/,
    );
    expect(thread.element().querySelector("textarea, [contenteditable]")).toBeNull();
    expect(
      thread
        .getByRole("button")
        .elements()
        .map((button) => button.ariaLabel),
    ).toEqual(["Copy thread"]);
    await expect
      .element(thread.getByRole("link", { name: "Open on GitHub" }))
      .toHaveAttribute("href", "https://github.com/acme/med/pull/7#discussion_r11");

    // The panel holds the conversation and the thread the diff cannot show.
    await page.getByRole("button", { name: "5 pull request comments" }).click();
    const panel = page.getByRole("dialog", { name: "Pull request comments" });
    await expect.element(panel).toBeVisible();
    const text = panel.element().textContent;
    expect(text).toMatch(/jordan\s*Approved/);
    expect(text).toContain("Ready for review.");
    expect(text).toContain("1 thread shows in the diff.");
    expect(text).toMatch(/src\/beta\.ts\s*L2\s*Outdated.*Is this still needed\?/);
    await panel.getByRole("button", { name: "Read again from GitHub" }).click();
    await expect.poll(() => pullRequestReads.at(-1)).toBe("?refresh=1");
    expect(pullRequestReads.slice(0, -1).every((search) => search === "")).toBe(true);
  });

  test("attaches a pasted brief to a saved review and undoes it", async () => {
    await mountApp({ savedReview: true });
    await expect.element(page.getByRole("tab", { name: "Brief" })).not.toBeInTheDocument();
    const data = new DataTransfer();
    data.setData("text/plain", "Only [beta.ts:2](src/beta.ts:2) matters.");
    document.body.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
    await expect
      .element(page.getByRole("tab", { name: "Brief" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("status")).toMatchTextContent("Brief attached.");
    await expect.poll(excerptText).toContain("export const shared = true;");

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.element(page.getByRole("tab", { name: "Brief" })).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("tab", { name: "Changes" }))
      .toHaveAttribute("aria-selected", "true");
    await expect.element(page.getByRole("status")).toHaveTextContent("Brief removed.");
  });
});

test("collapses history to a heading that names the selection, and remembers it", async () => {
  await mountApp();
  const toggle = page.getByRole("button", { name: /^History/ });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await expect.element(toggle).toHaveTextContent("HistoryWorking changes");
  const body = toggle.element().getAttribute("aria-controls")!;
  expect(document.getElementById(body)!.inert).toBe(true);
  expect(localStorage.getItem("med:history")).toBe("closed");

  root!.unmount();
  mount!.remove();
  await mountApp();
  const restored = page.getByRole("button", { name: /^History/ });
  await expect.element(restored).toHaveAttribute("aria-expanded", "false");
  await restored.click();
  await expect.element(restored).toHaveAttribute("aria-expanded", "true");
  await expect
    .element(page.getByRole("option", { name: /Improve the review stream/ }))
    .toBeVisible();
});
