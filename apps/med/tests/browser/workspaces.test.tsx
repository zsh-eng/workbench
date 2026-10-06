import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { WorkspaceHost, WorkspaceViews } from "../../src/web/components/Workspaces";
import { createBrowseApi } from "../../src/web/data/browse";
import type { Comparison } from "../../src/shared/protocol";
import { initializeTheme, themeController } from "../../src/web/themes";

const head = "a".repeat(40);
const branches = [
  { name: "main", head, worktreePath: "/test/repo", current: true },
  { name: "feature", head, worktreePath: "/test/feature", current: false },
];
const repositories = [
  {
    id: "repo-0",
    path: "/test/repo",
    name: "fixture",
    branches,
    worktrees: branches.map((branch) => ({
      path: branch.worktreePath,
      head,
      branch: branch.name,
    })),
  },
];
const changed = (repo: string) =>
  repo === "/test/feature" ? ["feature.ts"] : ["alpha.ts", "beta.ts"];
const patchFor = (repo: string) =>
  changed(repo)
    .map(
      (path) =>
        `diff --git a/src/${path} b/src/${path}\nindex 1111111..2222222 100644\n--- a/src/${path}\n+++ b/src/${path}\n@@ -1 +1 @@\n-export const before = 1;\n+export const after = 2;\n`,
    )
    .join("");

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
let address = "";
const STORAGE_KEY = "med:workspaces:v1";

beforeEach(() => {
  address = location.pathname + location.search;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem("med:zen");
});
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = mount = undefined;
  localStorage.removeItem(STORAGE_KEY);
  // Workspaces move the address; the test page keeps its own.
  history.replaceState(null, "", address);
});

/** A review host with one repository, two branch worktrees, and a vault. It
 * counts session loads and the live-update streams that are open. */
function createHost() {
  const sessions: string[] = [];
  const streams = new Set<string>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const repo = url.searchParams.get("repo") || "/test/repo";
    switch (url.pathname) {
      case "/api/service/status":
        return Response.json({
          service: "med",
          sources: [{ id: "vault-0", name: "notes", kind: "vault", path: "/test/notes" }],
        });
      case "/api/repositories":
        return Response.json({ repositories });
      case "/api/session":
        sessions.push(repo);
        return Response.json({
          protocol: 1,
          repositories,
          repositoryId: "repo-0",
          repository: {
            path: repo,
            name: "fixture",
            head,
            branch: repo === "/test/feature" ? "feature" : "main",
            shallow: false,
            git: true,
          },
          worktrees: repositories[0]!.worktrees,
        });
      case "/api/branches":
        return Response.json(branches);
      case "/api/history":
        return Response.json({ commits: [], cursor: null, hasMore: false });
      case "/api/review": {
        const body = JSON.parse(String(init?.body)) as { comparison: Comparison; repo: string };
        const patch = patchFor(body.repo);
        return Response.json({
          id: `review-${body.repo}`,
          repo: body.repo,
          comparison: body.comparison,
          base: head,
          head: "working",
          label: "Working changes",
          files: changed(body.repo).map((path) => ({
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
      }
      case "/api/notes":
        return Response.json({
          reviewId: url.searchParams.get("reviewId"),
          revision: 0,
          notes: [],
        });
      case "/api/events": {
        // Stays open until the controller aborts it, as the real stream does.
        const key = `${repo}#${Math.random()}`;
        streams.add(key);
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => {
              streams.delete(key);
              controller.error(new DOMException("Aborted", "AbortError"));
            });
          },
        });
        return new Response(body, { headers: { "content-type": "text/event-stream" } });
      }
      case "/api/browse/list":
        return Response.json({
          source: JSON.parse(String(init?.body)).source,
          entries: [],
          truncated: false,
        });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  return { fetcher, sessions, streams };
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
  [...document.querySelectorAll<HTMLElement>("[data-review-status]")].find(
    (element) => element.getClientRects().length > 0,
  );
const workspaceRows = () =>
  [...document.querySelectorAll('nav[aria-label="Workspaces"]')]
    .find((element) => element.getClientRects().length > 0)
    ?.querySelectorAll("li > button:first-child") ?? [];
/** Each row as its name and changed-file count, marking the current one. */
const rowLabels = () =>
  [...workspaceRows()].map((row) => {
    const [name, count] = row.querySelectorAll(":scope > span");
    return [
      name?.textContent,
      count?.firstChild?.textContent,
      row.getAttribute("aria-current") && "(current)",
    ]
      .filter(Boolean)
      .join(" ");
  });

test("keeps branch workspaces live, switches by shortcut, and restores the list", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The registered vault is pinned first.
  await expect.poll(rowLabels).toEqual(["notes", "main 2 (current)"]);
  const mainView = shown();

  // ⌘↵ in the branch picker opens the branch as a new workspace.
  await page.getByRole("button", { name: "Open branch", exact: true }).click();
  await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  await expect.poll(rowLabels).toEqual(["notes", "main 2", "feature 1 (current)"]);
  // The new branch loads once, at its worktree.
  expect(host.sessions.filter((repo) => repo === "/test/feature")).toHaveLength(1);
  expect(host.sessions).toHaveLength(2);
  // Both reviews stay mounted; only the one on screen listens for changes.
  expect(document.querySelectorAll("[data-review-status]")).toHaveLength(2);
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/feature"]);

  // ⌃2 shows the second row. The same review returns, not a reload; it
  // catches up on changes it missed and listens again.
  await userEvent.keyboard("{Control>}2{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  expect(shown()).toBe(mainView);
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/repo"]);

  // A tap of ⌃Tab returns to the previous workspace.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  expect(history.state).toMatchObject({ workspace: expect.any(String) });

  // A new page restores the list and opens the active branch directly.
  root!.unmount();
  mount!.remove();
  const next = createHost();
  render(next);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  await expect.poll(rowLabels).toEqual(["notes", "main 2", "feature 1 (current)"]);
  expect(next.sessions).toEqual(["/test/feature"]);

  // Closing the active workspace shows the most recent other one.
  await page.getByRole("button", { name: "Close feature" }).click();
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(rowLabels).toEqual(["notes", "main 2 (current)"]);
});
