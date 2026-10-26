import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createBrowseApi } from "../../src/web/data/browse";
import { setChromeMode } from "../../src/web/data/chrome";
import { createReviewController } from "../../src/web/data/controller";
import type { Comparison, ReviewFile, ReviewResponse } from "../../src/shared/protocol";
import type { SavedReview } from "../../src/shared/saved-review";
import "../../src/web/pierre-theme";
import { initializeTheme, themeController } from "../../src/web/themes";

// Generated files in a thread's Review (docs/GENERATED.md): they fold at the
// end of the stream and under the file tree, stay out of the headline totals,
// and are viewed with the file whose change made them.

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
const REVIEW = "generated";
const head = "1".repeat(40);
const base = "0".repeat(40);

/** A modified file's patch: its changed lines at `start`, then one context line. */
const modified = (path: string, before: string[], after: string[], start = 1) =>
  `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -${start},${before.length + 1} +${start},${after.length + 1} @@\n${before.map((line) => `-${line}`).join("\n")}\n${after.map((line) => `+${line}`).join("\n")}\n context\n`;

const files: (ReviewFile & { patch: string })[] = [
  {
    path: "bun.lock",
    status: "M",
    binary: false,
    additions: 2,
    deletions: 2,
    generated: { kind: "lockfile" },
    patch: modified(
      "bun.lock",
      ['    "pg": ["pg@8.13.0", "", {}, "sha512-a"],', '    "pg-pool": ["pg-pool@3.7.0"],'],
      ['    "pg": ["pg@8.16.3", "", {}, "sha512-b"],', '    "pg-pool": ["pg-pool@3.10.1"],'],
      10,
    ),
  },
  {
    path: "dist/app.js",
    status: "M",
    binary: false,
    additions: 1,
    deletions: 1,
    generated: { kind: "output" },
    patch: modified("dist/app.js", ["var a=1"], ["var a=2"]),
  },
  {
    path: "package.json",
    status: "M",
    binary: false,
    additions: 1,
    deletions: 1,
    patch: modified("package.json", ['    "pg": "^8.13.0"'], ['    "pg": "^8.16.3"'], 3),
  },
  {
    path: "scripts/gen.ts",
    status: "M",
    binary: false,
    additions: 1,
    deletions: 1,
    patch: modified("scripts/gen.ts", ["const fields = 1;"], ["const fields = 2;"]),
  },
  {
    path: "src/app.ts",
    status: "M",
    binary: false,
    additions: 30,
    deletions: 10,
    patch: modified("src/app.ts", ["export const app = 1;"], ["export const app = 2;"]),
  },
  {
    path: "src/schema.ts",
    status: "M",
    binary: false,
    additions: 300,
    deletions: 200,
    generated: { kind: "header", source: "scripts/gen.ts" },
    patch: modified(
      "src/schema.ts",
      ["export const field1 = 1;"],
      ["export const field1 = 2;"],
      40,
    ),
  },
  {
    // A capture from before marks: the path rule applies in the browser.
    path: "tests/__snapshots__/app.test.ts.snap",
    status: "M",
    binary: false,
    additions: 1,
    deletions: 1,
    patch: modified(
      "tests/__snapshots__/app.test.ts.snap",
      ["exports[`app 1`] = `1`;"],
      ["exports[`app 1`] = `2`;"],
    ),
  },
];

/** Files that a test leaves out of the comparison. */
let omitted = new Set<string>();
function review(comparison: Comparison): ReviewResponse {
  const shown = files.filter((file) => !omitted.has(file.path));
  const patch = shown.map((file) => file.patch).join("");
  return {
    id: "t1",
    repo: "/code/tide",
    comparison,
    base,
    head,
    label: "Upgrade pg",
    files: shown.map(({ patch: _patch, ...file }) => file),
    patch,
    warnings: [],
    metrics: { gitMs: 1, totalMs: 1, patchBytes: patch.length, cacheHit: false },
  };
}

const target = {
  id: "t1",
  repositoryId: "repo-0",
  repo: "/code/tide",
  branch: "upgrade-pg",
  label: "Upgrade pg",
  comparison: { kind: "range", base, head, mergeBase: true } as Comparison,
  base,
  head,
  captured: true,
};
const saved = (): SavedReview => ({
  id: REVIEW,
  title: "Upgrade pg",
  createdAt: "2026-10-26T00:00:00Z",
  revision: 0,
  commentCount: 0,
  targets: [target],
  iterations: [{ number: 1, createdAt: "2026-10-26T00:00:00Z", targetIds: ["t1"] }],
  sessions: [{ agent: "claude", id: "s1", cwd: "/code/tide" }],
});
/** The manifest's two sides: a minor bump, a major one, and a new dev dependency. */
const manifest = {
  old: JSON.stringify({ dependencies: { pg: "^8.13.0", react: "^18.3.1" } }, null, 2),
  new: JSON.stringify(
    { dependencies: { pg: "^8.16.3", react: "^19.0.0" }, devDependencies: { zod: "4.6.5" } },
    null,
    2,
  ),
};
const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await page.viewport(1440, 900);
  setChromeMode("full", false);
  for (const key of Object.keys(localStorage))
    if (key.startsWith("med:viewed:v1:") || key === "med:changes-rail")
      localStorage.removeItem(key);
});
afterEach(() => {
  omitted = new Set();
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  window.dispatchEvent(new StorageEvent("storage", { key: `med:viewed:v1:${REVIEW}` }));
});

async function mountReview(options: { without?: string[] } = {}) {
  omitted = new Set(options.without);
  initializeTheme();
  themeController.commit("graphite-dark");
  const reads: string[] = [];
  const lookups: string[][] = [];
  const provenance: unknown[] = [];
  const repository = {
    id: "repo-0",
    path: "/code/tide",
    name: "tide",
    branches: [{ name: "upgrade-pg", head, worktreePath: "/code/tide", current: true }],
    worktrees: [{ path: "/code/tide", head, branch: "upgrade-pg" }],
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    reads.push(url.pathname);
    if (url.pathname === `/api/reviews/${REVIEW}`) return Response.json(saved());
    const part = new RegExp(`^/api/reviews/${REVIEW}/targets/t1/(review|notes|drift)$`).exec(
      url.pathname,
    );
    if (part?.[1] === "drift") return Response.json({ changed: false });
    if (part?.[1] === "notes") return Response.json({ reviewId: "t1", revision: 0, notes: [] });
    if (part?.[1] === "review") return Response.json(review(target.comparison));
    if (url.pathname === `/api/reviews/${REVIEW}/targets/t1/source`) {
      const path = url.searchParams.get("path");
      if (path !== "package.json") throw new Error(`Unexpected source: ${path}`);
      return Response.json({ reviewId: "t1", path, ...manifest });
    }
    // What the thread's session did: it ran `bun add zod`, and edited the build by hand.
    if (url.pathname === "/api/review/provenance") {
      provenance.push(JSON.parse(String(init?.body)));
      return Response.json({
        files: {
          "bun.lock": { command: "bun add zod" },
          "dist/app.js": { edited: true },
        },
      });
    }
    if (url.pathname === "/api/dependencies") {
      const { packages } = JSON.parse(String(init?.body)) as {
        packages: { name: string; version: string }[];
      };
      lookups.push(packages.map(({ name, version }) => `${name}@${version}`).sort());
      const answers: Record<string, object> = {
        "pg@8.13.0": { licence: "ISC", publishedAt: Date.now() - 400 * DAY },
        "pg@8.16.3": { licence: "MIT", publishedAt: Date.now() - 2 * DAY },
        "react@19.0.0": { licence: "MIT", publishedAt: Date.now() - 300 * DAY },
      };
      return Response.json({
        packages: packages.map((entry) => ({
          ...entry,
          ...(answers[`${entry.name}@${entry.version}`] ?? { unknown: true }),
        })),
      });
    }
    if (url.pathname === "/api/review") {
      const { comparison } = JSON.parse(String(init?.body)) as { comparison: Comparison };
      return Response.json({ ...review(comparison), id: "w".repeat(64) });
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
          head,
          branch: "upgrade-pg",
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
    // The recorded session's transcript and messages are outside these tests.
    if (url.pathname.includes("/sessions/") || url.pathname.includes("/agent-"))
      return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
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
  return { controller, reads, lookups, provenance };
}

/** The files in the stream, from their headers' Viewed boxes, in order. */
const streamPaths = () =>
  [...document.querySelectorAll('[role="checkbox"][aria-label^="Viewed "]')]
    .map((box) => box.getAttribute("aria-label")!.slice("Viewed ".length))
    .filter((path) => path !== "all generated files");
const group = () => page.getByRole("region", { name: "Generated files" });
const groupLines = () =>
  [...document.querySelectorAll("[data-generated-file]")].map((line) =>
    line.getAttribute("data-generated-file"),
  );

test("generated files fold at the end of the stream and under the tree, out of the totals", async () => {
  await mountReview();
  // The stream: the files that people wrote, in order; the group folds after them.
  await expect.poll(streamPaths).toEqual(["package.json", "scripts/gen.ts", "src/app.ts"]);
  await expect.element(group()).toHaveAttribute("data-generated-group", "folded");
  await expect.element(group().getByText("4 files")).toBeVisible();
  expect(groupLines()).toEqual([
    "bun.lock",
    "dist/app.js",
    "src/schema.ts",
    "tests/__snapshots__/app.test.ts.snap",
  ]);
  // Each line names its kind and the file that it follows from.
  const line = (path: string) => document.querySelector(`[data-generated-file="${path}"]`)!;
  expect(line("bun.lock").textContent).toContain("Lockfile");
  expect(line("bun.lock").textContent).toContain("from package.json");
  expect(line("src/schema.ts").textContent).toContain("from gen.ts");
  // An older capture's snapshot is known by its path.
  expect(line("tests/__snapshots__/app.test.ts.snap").textContent).toContain("Snapshot");
  // The headline counts only the files that people wrote: +32 −12.
  await expect
    .element(page.getByRole("button", { name: /^Comparison total/ }))
    .toHaveAccessibleName(
      "Comparison total: 32 lines added, 12 lines deleted, without 508 generated lines",
    );

  // Opened, the group's files join the stream, each folded to its header.
  await userEvent.click(page.getByRole("button", { name: "Show 4 generated files" }));
  await expect
    .poll(streamPaths)
    .toEqual([
      "package.json",
      "scripts/gen.ts",
      "src/app.ts",
      "bun.lock",
      "dist/app.js",
      "src/schema.ts",
      "tests/__snapshots__/app.test.ts.snap",
    ]);
  await expect
    .element(page.getByRole("button", { name: "Expand bun.lock" }))
    .toHaveAttribute("aria-expanded", "false");
  expect(document.querySelector('[data-generated-kind="lockfile"]')?.textContent).toBe(
    "Lockfile · from package.json",
  );

  // The file tree lists them apart, folded under it.
  const tree = page.getByRole("region", { name: "Changed files" });
  await userEvent.click(tree.getByRole("button", { name: /^Generated/ }));
  await expect
    .poll(() =>
      document.querySelector("[data-generated-files]")?.getAttribute("data-generated-files"),
    )
    .toBe("open");
});

test("a generated file is viewed with its source, and the tree reveals a folded one", async () => {
  await mountReview();
  await expect.poll(streamPaths).toContain("package.json");
  await userEvent.click(page.getByRole("checkbox", { name: "Viewed package.json" }));
  // The lockfile follows the manifest; the build output has no source here.
  await userEvent.click(page.getByRole("button", { name: "Show 4 generated files" }));
  await expect
    .element(page.getByRole("checkbox", { name: "Viewed bun.lock" }))
    .toHaveAttribute("aria-checked", "true");
  await expect
    .element(page.getByRole("checkbox", { name: "Viewed dist/app.js" }))
    .toHaveAttribute("aria-checked", "false");
  await userEvent.click(page.getByRole("button", { name: "Fold 4 generated files" }));
  await expect.poll(streamPaths).toEqual(["package.json", "scripts/gen.ts", "src/app.ts"]);

  // A line of the folded group opens it, with that file's diff.
  await userEvent.click(group().getByRole("link", { name: "dist/app.js" }));
  await expect.element(group()).toHaveAttribute("data-generated-group", "open");
  await expect
    .element(page.getByRole("button", { name: "Collapse dist/app.js" }))
    .toHaveAttribute("aria-expanded", "true");
  await expect
    .element(page.getByRole("button", { name: "Expand src/schema.ts" }))
    .toHaveAttribute("aria-expanded", "false");
});

test("a manifest's dependencies show above the stream, and lookups add licences and dates", async () => {
  localStorage.removeItem("med:dependency-lookups:v1");
  const { lookups, provenance } = await mountReview();
  const card = page.getByRole("region", { name: "Dependencies" });
  await expect.element(card).toBeVisible();
  const row = (name: string) =>
    document.querySelector(`[data-dependency="${name}"]`)?.textContent ?? null;
  await expect.poll(() => row("pg")).toBe("pg8.13.0→8.16.3");
  // A major bump is marked; a new dev dependency says so.
  expect(row("react")).toBe("react18.3.1→19.0.0major");
  expect(row("zod")).toBe("zoddev4.6.5added");
  // The lockfile's line leaves out pg, which the table shows.
  await expect.element(card.getByText("1 indirect dependency updated")).toBeVisible();
  // Nothing asks deps.dev until the reader turns lookups on.
  expect(lookups).toEqual([]);
  await userEvent.click(card.getByRole("button", { name: "Look up licences and dates" }));
  await expect
    .poll(() => lookups.at(-1))
    .toEqual(["pg@8.13.0", "pg@8.16.3", "react@18.3.1", "react@19.0.0", "zod@4.6.5"]);
  // A licence that changes, and a release of this week.
  await expect.poll(() => row("pg")).toBe("pg8.13.0→8.16.3ISC → MIT2 days ago");
  expect(row("react")).toBe("react18.3.1→19.0.0majorMIT10 mo ago");
  expect(localStorage.getItem("med:dependency-lookups:v1")).toBe("on");
  localStorage.removeItem("med:dependency-lookups:v1");

  // The group says what each generated file changed and what the session did.
  expect(provenance).toEqual([
    {
      repo: "/code/tide",
      sessions: [{ agent: "claude", id: "s1" }],
      files: [
        { path: "bun.lock", kind: "lockfile" },
        { path: "dist/app.js", kind: "output" },
        { path: "src/schema.ts", kind: "header", source: "scripts/gen.ts" },
        { path: "tests/__snapshots__/app.test.ts.snap", kind: "snapshot" },
      ],
    },
  ]);
  const line = (path: string) =>
    document.querySelector(`[data-generated-file="${path}"]`)?.textContent ?? "";
  await expect.poll(() => line("bun.lock")).toContain("written by bun add zod");
  expect(line("bun.lock")).toContain("1 indirect dependency updated");
  expect(line("dist/app.js")).toContain("Edited by hand");
  expect(line("tests/__snapshots__/app.test.ts.snap")).toContain("1 snapshot changed");
  await expect.element(group().getByText("1 to check")).toBeVisible();
});

test("a lockfile without its manifest is a warning, and the group's check marks every generated file", async () => {
  await mountReview({ without: ["package.json"] });
  const line = (path: string) =>
    document.querySelector(`[data-generated-file="${path}"]`)?.textContent ?? "";
  // Lockfile-only churn: no card, and each changed package is indirect.
  await expect.poll(() => line("bun.lock")).toContain("No manifest changed");
  await expect.poll(() => line("bun.lock")).toContain("2 indirect dependencies updated");
  expect(document.querySelector("[data-dependency-card]")).toBeNull();
  // The lockfile, and the build output that the session edited by hand.
  await expect.element(group().getByText("2 to check")).toBeVisible();

  await userEvent.click(page.getByRole("checkbox", { name: "Viewed all generated files" }));
  await expect
    .element(page.getByRole("checkbox", { name: "Viewed all generated files" }))
    .toHaveAttribute("aria-checked", "true");
  await userEvent.click(page.getByRole("button", { name: "Show 4 generated files" }));
  for (const path of [
    "bun.lock",
    "dist/app.js",
    "src/schema.ts",
    "tests/__snapshots__/app.test.ts.snap",
  ])
    await expect
      .element(page.getByRole("checkbox", { name: `Viewed ${path}` }))
      .toHaveAttribute("aria-checked", "true");
  await expect
    .element(page.getByRole("checkbox", { name: "Viewed src/app.ts" }))
    .toHaveAttribute("aria-checked", "false");
});
