import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import {
  PullRequestsDialog,
  type PullInboxLoader,
} from "../../src/web/components/PullRequestsDialog";
import type { PullInbox, PullInboxRow } from "../../src/shared/pull-inbox";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  vi.restoreAllMocks();
});

const row = (number: number, title: string, change: Partial<PullInboxRow> = {}): PullInboxRow => ({
  url: `https://github.com/acme/trailhead/pull/${number}`,
  number,
  title,
  repository: "acme/trailhead",
  author: "you",
  createdAt: "2026-11-07T00:00:00Z",
  updatedAt: "2026-11-08T00:00:00Z",
  draft: false,
  review: "required",
  checks: "pass",
  conflicts: false,
  additions: 12,
  deletions: 3,
  ...change,
});
const inbox = (all: boolean): PullInbox => ({
  viewer: "you",
  scope: all ? "all" : "registered",
  repositories: all ? [] : ["acme/trailhead"],
  readAt: new Date().toISOString(),
  waiting: [
    row(418, "Cache map tiles", { author: "maya", why: "review requested" }),
    row(412, "Retry uploads", { why: "checks failing", checks: "fail" }),
  ],
  yours: [
    row(420, "Search chips", {
      stack: [{ url: "https://github.com/acme/trailhead/pull/421", number: 421, title: "Clear" }],
    }),
    ...(all ? [row(9, "A change elsewhere", { repository: "acme/elsewhere" })] : []),
  ],
});

function setup(load: PullInboxLoader) {
  initializeTheme();
  const opened: [string, string | undefined][] = [];
  let open = true;
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const draw = () =>
    root!.render(
      <PullRequestsDialog
        open={open}
        onOpenChange={(next) => {
          open = next;
          draw();
        }}
        load={load}
        onOpenPull={(url, agent) => opened.push([url, agent])}
        agents={[{ id: "claude", name: "Claude Code" }]}
      />,
    );
  draw();
  return {
    opened,
    reopen() {
      open = true;
      draw();
    },
  };
}

test("what waits on you comes first, a stack is one row, and the keys open, review, or go to GitHub", async () => {
  const load = vi.fn<PullInboxLoader>(async (all) => inbox(all));
  const sheet = setup(load);
  const waiting = page.getByRole("group", { name: "Waiting on you" });
  await expect.element(waiting.getByRole("option")).toHaveLength(2);
  await expect.element(waiting.getByText("review requested")).toBeVisible();
  const yours = page.getByRole("group", { name: "Yours" });
  await expect.element(yours.getByText("acme/trailhead #420 → #421")).toBeVisible();
  await expect.element(yours.getByText("stack of 2")).toBeVisible();
  expect(load).toHaveBeenCalledWith(false, false, expect.any(AbortSignal));
  // ↓ ↵ opens the second row in a worktree, and the sheet closes.
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(sheet.opened).toEqual([["https://github.com/acme/trailhead/pull/412", undefined]]);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  // ⌘↵ asks Claude to review it there.
  sheet.reopen();
  await expect.element(waiting.getByRole("option")).toHaveLength(2);
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  expect(sheet.opened.at(-1)).toEqual(["https://github.com/acme/trailhead/pull/418", "claude"]);
  // ⌥↵ opens it on GitHub, and the sheet stays.
  sheet.reopen();
  const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
  await expect.element(waiting.getByRole("option")).toHaveLength(2);
  await userEvent.keyboard("jj{Alt>}{Enter}{/Alt}");
  expect(windowOpen).toHaveBeenCalledWith(
    "https://github.com/acme/trailhead/pull/420",
    "_blank",
    "noopener",
  );
  await expect.element(page.getByRole("dialog")).toBeVisible();
  // All of GitHub reads again, without the repositories.
  await userEvent.click(page.getByRole("radio", { name: "All of GitHub" }));
  await expect.element(page.getByText("A change elsewhere")).toBeVisible();
  expect(load).toHaveBeenLastCalledWith(true, false, expect.any(AbortSignal));
  // The refresh button skips the host's minute-long read.
  await userEvent.click(page.getByRole("button", { name: "Read GitHub again" }));
  expect(load).toHaveBeenLastCalledWith(true, true, expect.any(AbortSignal));
});

test("without gh, or with no GitHub remote, the sheet says why", async () => {
  setup(async (all) => ({
    ...inbox(all),
    waiting: [],
    yours: [],
    unavailable: "Install the GitHub CLI (gh) and run gh auth login to list pull requests.",
  }));
  await expect
    .element(
      page.getByText("Install the GitHub CLI (gh) and run gh auth login to list pull requests."),
    )
    .toBeVisible();
  expect(document.querySelectorAll("[role='option']")).toHaveLength(0);
});
