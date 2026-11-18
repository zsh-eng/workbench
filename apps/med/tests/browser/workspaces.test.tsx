import { afterEach, beforeEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  cleanUp,
  createHost,
  mount,
  prepareWindow,
  render,
  root,
  shown,
  TALK,
  talkThread,
  thread,
  threadRows,
} from "./workspaces-fixture";

beforeEach(prepareWindow);
afterEach(cleanUp);

test("keeps branch workspaces live, switches by shortcut, and restores them", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const mainView = shown();
  const mainDiffs = () => [...mainView!.querySelectorAll("diffs-container")];
  // The first diff in a page loads Pierre's highlighter on the main thread,
  // which takes longest while every worker's page loads it at once.
  await expect.poll(() => mainDiffs().length, { timeout: 15_000 }).toBe(2);
  const renderedDiffs = mainDiffs();

  // ⌘↵ in the branch picker (⌘⇧G) opens the branch as a new workspace.
  await userEvent.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
  await page.getByRole("combobox", { name: "Search branches" }).fill("feature");
  await userEvent.keyboard("{Control>}{Enter}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The new branch loads once, at its worktree.
  expect(host.sessions.filter((repo) => repo === "/test/feature")).toHaveLength(1);
  expect(host.sessions).toHaveLength(2);
  // Both reviews stay mounted; only the one on screen listens for changes.
  expect(document.querySelectorAll("[data-review-status]")).toHaveLength(2);
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/feature"]);

  // A tap of ⌃Tab shows the previous workspace. The same review returns, not a
  // reload; it catches up on changes it missed and listens again.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  expect(shown()).toBe(mainView);
  // Its diffs stay rendered while hidden; showing it does not build them again.
  expect(mainDiffs().map((element, index) => element === renderedDiffs[index])).toEqual([
    true,
    true,
  ]);
  // Files still open after the review was hidden and shown again.
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("src/alpha.ts");
  await page.getByRole("radio", { name: /^Changes/ }).click();
  await expect.poll(() => shown()?.dataset.activeFile).toBe("");
  await expect
    .poll(() => [...host.streams].map((key) => key.split("#")[0]))
    .toEqual(["/test/repo"]);

  // Another tap returns.
  await userEvent.keyboard("{Control>}{Tab}{/Control}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  expect(history.state).toMatchObject({ workspace: expect.any(String) });

  // A new page restores the workspaces and opens the active branch directly.
  root!.unmount();
  mount!.remove();
  const next = createHost();
  render(next);
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("feature");
  expect(next.sessions).toEqual(["/test/feature"]);

  // Closing the active workspace shows the most recent other one.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Close workspace");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.selectedBranch).toBe("main");
  expect(document.querySelectorAll("[data-review-status]")).toHaveLength(1);
});

test("a thread in view loads out of sight, and its first visit shows that slot", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("agent", { agent: "claude", state: "idle", updatedAt: Date.now() })]);
  // Before any click, the thread loads in a slot of its own, out of sight,
  // once the reader has not acted for a second.
  const slot = () => document.querySelector<HTMLElement>('[data-workspace-slot="thread-agent"]');
  await expect
    .poll(() => slot()?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus, {
      timeout: 5000,
    })
    .toBe("ready");
  const ahead = slot()!;
  expect(
    ahead.querySelector("[data-review-status]")!.checkVisibility({ visibilityProperty: true }),
  ).toBe(false);
  expect(shown()?.dataset.reviewId).not.toBe("agent-target");

  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  // The click shows that slot; nothing reads the review again.
  expect(slot()).toBe(ahead);
  expect(host.requested.filter((path) => path === "/api/reviews/agent")).toHaveLength(1);
});

test("every tab loads out of sight and stays, as open terminal tabs do; history does not load", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const inView = ["agent", "second", "third", "fourth", "fifth"];
  // A closed thread is history: Med does not load it or watch it.
  host.setHistory([thread("older", { updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000 })]);
  host.setThreads(
    inView.map((id, index) => thread(id, { updatedAt: Date.now() - (index + 1) * 60_000 })),
  );
  const slot = (id: string) =>
    document.querySelector<HTMLElement>(`[data-workspace-slot="thread-${id}"]`);
  // More threads than the three that loaded ahead before.
  for (const id of inView)
    await expect
      .poll(
        () => slot(id)?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus,
        { timeout: 5000 },
      )
      .toBe("ready");
  expect(slot("older")).toBeNull();

  const ahead = slot("fifth");
  await userEvent.keyboard("{Control>}5{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("fifth-target");
  expect(slot("fifth")).toBe(ahead);
  expect(host.requested.filter((path) => path === "/api/reviews/fifth")).toHaveLength(1);
  // The others stay loaded.
  for (const id of inView) expect(slot(id)).not.toBeNull();
});

test("the Archived page lists archived threads by day, searches them, opens one as a tab, and deletes one", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const day = 24 * 60 * 60 * 1000;
  const midnight = new Date().setHours(0, 0, 0, 0);
  host.setThreads([thread("agent")]);
  host.setHistory([
    thread("third", { agent: "claude", updatedAt: Date.now() - 1000 }),
    thread("second", { agent: "codex", branch: "feature", updatedAt: midnight - 60 * 60 * 1000 }),
    thread("older", { updatedAt: Date.now() - 20 * day, prompt: "Trim the export" }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review"]);

  // Archived is at the sidebar's foot.
  await page.getByRole("button", { name: "Archived", exact: true }).click();
  await expect.element(page.getByRole("heading", { name: "Archived", level: 1 })).toBeVisible();
  expect(location.pathname).toBe("/archived");
  const list = page.getByRole("listbox", { name: "Archived" });
  const days = () =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[role="listbox"][aria-label="Archived"] [role="group"]',
      ),
    ].map((group) => [
      group.getAttribute("aria-label"),
      [...group.querySelectorAll('[role="option"]')].map((row) => row.getAttribute("aria-label")),
    ]);
  await expect.poll(days).toEqual([
    ["Today", ["Third review, fixture · main, Claude"]],
    ["Yesterday", ["Second review, fixture · feature, Codex"]],
    [
      new Date(Date.now() - 20 * day).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        ...(new Date(Date.now() - 20 * day).getFullYear() !== new Date().getFullYear() && {
          year: "numeric",
        }),
      }),
      ["Older review, fixture · main"],
    ],
  ]);
  // The tab is not archived.
  expect(list.getByRole("option", { name: /^Agent review/ }).query()).toBeNull();
  await expect
    .element(list.getByRole("option", { name: /^Third review/ }))
    .toHaveAttribute("aria-selected", "true");

  // A letter in the list starts a search, as the switcher's does, over the
  // first prompt too.
  await userEvent.keyboard("t");
  const search = page.getByRole("combobox", { name: "Search archived threads" });
  await expect.element(search).toHaveFocus();
  await userEvent.keyboard("rim");
  await expect.poll(days).toEqual([[expect.any(String), ["Older review, fixture · main"]]]);
  await userEvent.keyboard("{Escape}");
  await expect.element(search).toHaveValue("");
  await expect.poll(() => days().length).toBe(3);

  // ↓ and ↵ open a thread as a tab, as the switcher does; the page leaves.
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("second-target");
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/second/open",
    body: { restore: false },
  });
  await expect
    .element(page.getByRole("heading", { name: "Archived", level: 1 }))
    .not.toBeInTheDocument();
  await expect.poll(threadRows).toContain("Second review(current)");

  // ⌘K opens it again, also by its old name; the thread that opened is a tab now.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("history");
  await expect
    .element(page.getByRole("option", { name: /^Open archived thread/ }))
    .toBeInTheDocument();
  await page.getByRole("option", { name: "Archived", exact: true }).click();
  await expect.poll(days).toEqual([
    ["Today", ["Third review, fixture · main, Claude"]],
    [expect.any(String), ["Older review, fixture · main"]],
  ]);

  // ⌘⌫ asks. ↵ on Keep keeps the thread.
  const listbox = () =>
    document.querySelector('[role="listbox"][aria-label="Archived"]') as HTMLElement;
  listbox().focus();
  await userEvent.keyboard("{End}{Control>}{Backspace}{/Control}");
  const keep = list.getByRole("button", { name: "Keep" });
  await expect.element(keep).toBeVisible();
  const asked = host.threadRequests.length;
  (keep.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(keep).not.toBeInTheDocument();
  expect(host.threadRequests.length).toBe(asked);
  // ⌘⌫ asks again; a second ↵ deletes the thread for good.
  listbox().focus();
  await userEvent.keyboard("{End}{Control>}{Backspace}{/Control}");
  await expect
    .element(list.getByRole("option", { name: /^Older review/ }))
    .toMatchTextContent(/^Delete “Older review” for good\?/);
  await userEvent.keyboard("{Enter}");
  await expect.poll(days).toEqual([["Today", ["Third review, fixture · main, Claude"]]]);
  expect(host.threadRequests.at(-1)).toEqual({ path: "/api/threads/older/delete", body: {} });

  // Its old address, /history, opens it too.
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect
    .element(page.getByRole("heading", { name: "Archived", level: 1 }))
    .not.toBeInTheDocument();
  history.pushState(null, "", "/history");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.element(page.getByRole("heading", { name: "Archived", level: 1 })).toBeVisible();
});

test("a thread with its session on screen shows its session first, and its diff after", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([talkThread()]);
  // The thread loads ahead. Its diff arrives, and waits for its session.
  const slot = () => document.querySelector<HTMLElement>(`[data-workspace-slot="thread-${TALK}"]`);
  const status = () =>
    slot()?.querySelector<HTMLElement>("[data-review-status]")?.dataset.reviewStatus;
  await expect
    .poll(() => host.requested.includes("/api/reviews/talk/targets/talk-target/review"), {
      timeout: 5000,
    })
    .toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(status()).toBe("loading");

  host.releaseSession();
  await page.getByRole("button", { name: /^Talk review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const thread_ = page.getByRole("log", { name: "Session" });
  await expect.element(thread_.getByText("Rename the export.")).toBeVisible();
  await expect.element(thread_.getByText("alpha", { exact: true })).toBeVisible();
  expect(status()).toBe("ready");
});

test("a thread whose agent went on while it was away shows with that work, in the frame that shows it", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.releaseSession();
  const changed = Date.now() - 60_000;
  host.talkReplies("Renamed it in the tests too.", changed);
  host.setThreads([{ ...talkThread(), updatedAt: changed }, thread("agent")]);
  await page.getByRole("button", { name: /^Talk review/ }).click();
  const log = () =>
    document
      .querySelector(`[data-workspace-slot="thread-${TALK}"]`)
      ?.querySelector<HTMLElement>('[role="log"][aria-label="Session"]');
  await expect.poll(() => log()?.textContent).toContain("Renamed it in the tests too.");
  await page.getByRole("button", { name: /^Agent review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");

  // Away, its agent replies again, and the thread list says the session
  // changed. The thread's stream paused while it was hidden, and takes a
  // round trip to answer when it shows.
  host.talkReplies("Then I checked the callers.", changed + 30_000, 80);
  host.setThreads([{ ...talkThread(), updatedAt: changed + 30_000 }, thread("agent")]);
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Back to it: no frame shows the thread without the new reply.
  const stale: string[] = [];
  let watching = true;
  void (async () => {
    while (watching) {
      await new Promise(requestAnimationFrame);
      const shownLog = log();
      if (
        shownLog?.checkVisibility({ visibilityProperty: true }) &&
        !shownLog.textContent?.includes("Then I checked the callers.")
      )
        stale.push(shownLog.textContent?.slice(-60) ?? "");
    }
  })();
  await page.getByRole("button", { name: /^Talk review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  await expect
    .element(page.getByRole("log", { name: "Session" }).getByText("Then I checked the callers."))
    .toBeVisible();
  watching = false;
  expect(stale).toEqual([]);
});

test("the notice after Clear shows under the header's end, on one line, wider than All comments", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("commented")]);
  await page.getByRole("button", { name: /^Commented review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("commented-target");
  // The header keeps one action, All comments, with Copy in its panel; Clear
  // is in ⌘K.
  const all = page.getByRole("button", { name: "All comments", exact: true });
  await expect.element(all).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Copy comments", exact: true }))
    .not.toBeInTheDocument();
  const button = all.element().getBoundingClientRect();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("option", { name: /^Clear all comments…/ }).click();
  await page.getByRole("button", { name: "Confirm clear" }).click();
  const notice = page.getByRole("status").filter({ hasText: "Comments cleared" });
  await expect.element(notice).toBeVisible();
  const box = notice.element().getBoundingClientRect();
  expect(box.height).toBeLessThan(44);
  expect(box.width).toBeGreaterThan(100);
  // Under the header, in view: not at the page's end.
  expect(box.top).toBeGreaterThanOrEqual(button.bottom);
  expect(box.top - button.bottom).toBeLessThan(40);
  // With no comments left, the button has no count, and its panel nothing to copy.
  await expect.element(all).toHaveTextContent("");
  await all.click();
  await expect.element(page.getByText("No comments yet")).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Copy comments", exact: true }))
    .not.toBeInTheDocument();
});

test("the review's header names the review, keeps its actions in ⌘K, and there is no toolbar or status bar", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([talkThread()]);
  host.releaseSession();
  await page.getByRole("button", { name: /^Talk review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("talk-target");
  const session = page.getByRole("region", { name: "Claude session" });
  await expect.element(session.getByText("Rename the export.")).toBeVisible();
  const band = page.getByRole("banner", { name: "Workspace" });
  const statusBar = () =>
    [...document.querySelectorAll("[data-connection]")].some((dot) => dot.checkVisibility());

  // The thread opens on its session alone. The band's start names the
  // branch, and its end holds the review's pages and Display while the
  // review hides; the session has no header of its own. No toolbar or
  // status bar.
  await expect.element(band.getByRole("button", { name: "fixture. Copy the path" })).toBeVisible();
  await expect
    .element(band.getByRole("button", { name: "main. Copy the branch name" }))
    .toBeVisible();
  const tools = band.getByRole("group", { name: "Review tools" });
  const reviewPage = tools.getByRole("radio", { name: "Review" });
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "false");
  await expect.element(tools.getByRole("button", { name: "Display" })).toBeVisible();
  const reviewPane = () => document.querySelector<HTMLElement>('[data-pane="review"]');
  expect(reviewPane()?.checkVisibility() ?? false).toBe(false);
  expect(session.getByRole("button", { name: /session menu/ }).query()).toBeNull();
  expect(session.getByRole("heading", { name: "Talk review" }).query()).toBeNull();
  // A page opens the review beside the thread; its row, under the band,
  // names it. The page on screen, clicked again, hides it.
  await reviewPage.click();
  await expect.element(reviewPage).toHaveAttribute("aria-checked", "true");
  const title = page.getByRole("heading", { level: 2, name: "Talk review", exact: true });
  await expect.element(title).toBeVisible();
  expect(band.element().contains(title.element())).toBe(false);
  expect(reviewPane()!.contains(title.element())).toBe(true);
  await reviewPage.click();
  await expect.poll(() => reviewPane()?.checkVisibility() ?? false).toBe(false);
  await reviewPage.click();
  await expect.element(title).toBeVisible();
  expect(page.getByRole("button", { name: "View options", exact: true }).query()).toBeNull();
  expect(statusBar()).toBe(false);
  // No Send: comments go to the agent from its session. ⌘K has the review's
  // actions (⋯ holds only what a narrow row folds; see quiet-chrome).
  expect(page.getByRole("button", { name: /^Send comments to/ }).query()).toBeNull();
  await userEvent.keyboard("{Control>}k{/Control}");
  const search = page.getByRole("combobox", { name: "Search commands" });
  for (const name of ["Hide agent session", "Find in diff contents", "Open Settings"]) {
    await search.fill(name);
    await expect.element(page.getByRole("option", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  // ⌘K has the comparison's choices, and no other chrome to choose.
  await search.fill("Compare against");
  await expect
    .element(page.getByRole("option", { name: /^Compare against a base branch/ }))
    .toBeVisible();
  await search.fill("chrome");
  await expect.element(page.getByRole("option", { name: /full chrome/ })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  // With the sidebar hidden, the band names the thread.
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(band.getByText("Talk review", { exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}b{/Control}");
});

test("a tab closes by ×, ⌘⌥W, or the palette; Undo and ⌘⌥T bring it back; ⌃Tab finds it archived", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", { agent: "claude", state: "idle" }),
    thread("second", { agent: "codex", state: "working" }),
    thread("third", { agent: "claude", state: "idle" }),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, working", "Third review"]);

  // Archive in the row's menu archives the session; its agent keeps
  // working, and nothing announces it.
  await page.getByRole("button", { name: "Actions for Second review" }).click();
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).toEqual(["Agent review", "Third review"]);
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/second/close",
    body: { removeWorktree: false },
  });
  expect(page.getByRole("status").filter({ hasText: "Closed" }).query()).toBeNull();
  // ⌘⌥T opens it again.
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(threadRows).toContain("Second review, working(current)");

  // ⌘⌥W closes the tab on screen with its workspace, and ⌘⌥T opens it again.
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  // Reopening put Second at the top of Recent, and closing lands on it.
  await expect.poll(threadRows).toEqual(["Second review, working(current)", "Agent review"]);
  await expect.poll(() => shown()?.dataset.reviewId).not.toBe("third-target");
  expect(document.querySelector('[data-workspace-slot="thread-third"]')).toBeNull();
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await expect.poll(threadRows).toContain("Third review(current)");

  // The palette closes the tab on screen too.
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Close tab");
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Second review, working(current)", "Agent review"]);

  // ⌃Tab with a typed word searches archived threads too; Return opens it as
  // a tab, at the top. A letter with Control held searches and runs no
  // shortcut (⌃K is the palette).
  await userEvent.keyboard("{Control>}{Tab}k{/Control}");
  const search = page.getByRole("combobox", { name: "Search tabs and archived threads" });
  await expect.element(search).toHaveValue("k");
  await userEvent.keyboard("{Backspace}third");
  await expect.element(search).toHaveValue("third");
  const option = page.getByRole("option", { name: "Third review, archived" });
  await expect.element(option).toBeVisible();
  await expect.element(option).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  expect(host.threadRequests.at(-1)).toEqual({
    path: "/api/threads/third/open",
    body: { restore: false },
  });
  await expect.poll(threadRows).toContain("Third review(current)");

  // "Open archived thread" lists the closed threads, newest first.
  await page.getByRole("button", { name: "Actions for Agent review" }).click();
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).not.toContain("Agent review");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Open archived thread");
  await userEvent.keyboard("{Enter}");
  const history = page.getByRole("dialog", { name: "Open archived thread" });
  await expect.element(history.getByRole("option", { name: /^Agent review/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(history).not.toBeInTheDocument();
});

test("the Files page's one row is its file tabs, as the title band names the checkout", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("third", { agent: "claude", state: "idle" })]);
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  const visible = (selector: string) =>
    [...shown()!.querySelectorAll(selector)].filter((node) => node.checkVisibility());
  expect(visible('header[aria-label="Review header"]')).toHaveLength(1);
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.poll(() => visible('[aria-label="Open files"]').length).toBe(1);
  expect(visible('header[aria-label="Review header"]')).toEqual([]);
  // The file's own row names the file, not where it comes from.
  const row = visible('[aria-label="Full file"] header, .med-editor-header')[0]!;
  expect(row.textContent).toContain("src/alpha.ts");
  expect(row.textContent).not.toMatch(/Working file|Added|Deleted/);
});
