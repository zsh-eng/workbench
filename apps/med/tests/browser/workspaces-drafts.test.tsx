import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AUTO_CLOSE_MS } from "../../src/web/data/tabs";
import type { Thread } from "../../src/shared/threads";
import {
  cleanUp,
  createHost,
  mount,
  prepareWindow,
  render,
  root,
  shown,
  thread,
  threadRows,
} from "./workspaces-fixture";

beforeEach(prepareWindow);
afterEach(cleanUp);

test("closing a tab with an unsaved draft asks first, and the reopened thread shows the draft", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("third", { agent: "claude", state: "idle" })]);
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");

  // A working file of the thread's checkout, edited and not saved.
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();

  // ⌘⌥W asks first. Cancel keeps the tab.
  const question = page.getByRole("status").filter({ hasText: "unsaved changes" });
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  await expect
    .element(question)
    .toMatchTextContent(/^“Third review” has unsaved changes in src\/alpha\.ts\./);
  await question.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect.element(question).not.toBeInTheDocument();
  expect(document.querySelector('[data-workspace-slot="thread-third"]')).not.toBeNull();
  // Close closes the tab with its workspace.
  await userEvent.keyboard("{Control>}{Alt>}w{/Alt}{/Control}");
  await question.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(threadRows).toEqual([]);
  expect(document.querySelector('[data-workspace-slot="thread-third"]')).toBeNull();
  // Another program changes the file. ⌘⌥T opens the thread again, and its
  // file opens with the draft and says that the file changed.
  host.setFileText("export const agent = 3;\n");
  await userEvent.keyboard("{Control>}{Alt>}t{/Alt}{/Control}");
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  if (!editor.query()) await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: "The file changed on disk" });
  await expect.element(notice).toBeVisible();
  // Undo goes back to the text that the draft started from. The file on disk
  // is still newer, and Refresh reads it.
  await editor.click();
  await userEvent.keyboard("u");
  await expect.element(editor).toHaveTextContent("export const after = 2;");
  await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  await expect.element(notice).toBeVisible();
  await page.getByRole("button", { name: "Refresh contents", exact: true }).click();
  await expect.element(editor).toHaveTextContent("export const agent = 3;");
  await expect.element(notice).not.toBeInTheDocument();
});

test("an unsaved draft outlasts a reload, and says when its file changed", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("third", { agent: "claude", state: "idle" })]);
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");

  // The draft is kept in this browser, so leaving does not warn.
  await expect
    .poll(() => {
      const leave = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leave);
      return leave.defaultPrevented;
    })
    .toBe(false);
  // The page loads again, and another program changed the file meanwhile.
  root!.unmount();
  mount!.remove();
  host.setFileText("export const agent = 3;\n");
  render(host);
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  if (!editor.query()) await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();
  const changes = page.getByRole("region", { name: "Changes on disk" });
  await expect.element(changes.getByText("export const agent = 3;")).toBeInTheDocument();
  // Use the file on disk drops the draft, and storage forgets it.
  await page.getByRole("button", { name: "Use the file on disk", exact: true }).click();
  await expect.element(editor).toHaveTextContent("export const agent = 3;");
  await expect
    .poll(() => Object.keys(localStorage).filter((key) => key.startsWith("med:draft:")))
    .toEqual([]);
});

test("a tab whose work has landed stays open while it has an unsaved draft, or while it is pinned", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // Four tabs whose work has landed on their base branch, read long ago.
  const landed = (id: string, patch: Partial<Thread> = {}) =>
    thread(id, {
      agent: "claude",
      state: "idle",
      updatedAt: 1,
      unlanded: { base: "main", ahead: 0, uncommitted: false },
      ...patch,
    });
  const tabs = () => [
    landed("talk", { pinned: 1 }),
    landed("third"),
    landed("fourth"),
    landed("fifth"),
  ];
  host.setThreads(tabs());
  await page.getByRole("button", { name: /^Third review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("third-target");
  await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
  const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  await expect.element(editor).toHaveTextContent("export draft after = 2;");
  await page.getByRole("button", { name: /^Fourth review/ }).click();
  await expect.poll(() => shown()?.dataset.reviewId).toBe("fourth-target");

  // Time passes with Talk, Third and Fifth off screen. Med closes Fifth on
  // its own. Third keeps its tab, because closing it would hide the draft,
  // and Talk keeps its tab because it is pinned.
  const realNow = Date.now.bind(Date);
  const later = vi.spyOn(Date, "now").mockImplementation(() => realNow() + AUTO_CLOSE_MS * 2);
  onTestFinished(() => later.mockRestore());
  host.setThreads(tabs());
  await expect
    .poll(() => threadRows().map((row) => row.split(/(?<=review)/)[0]))
    .toEqual(["Talk review", "Third review", "Fourth review"]);
  expect(
    host.threadRequests
      .filter((request) => request.path.endsWith("/close"))
      .map((request) => request.path),
  ).toEqual(["/api/threads/fifth/close"]);
});

test("a thread takes a name from its menu, a double-click, or the palette; Esc keeps the old one, and an empty name gives the agent's title back", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([thread("agent", { agent: "claude", state: "idle" }), thread("second")]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  const field = page.getByRole("textbox", { name: "Thread name" });
  const named = () => host.threadRequests.filter((request) => request.path.endsWith("/name"));

  // The menu's Rename puts a field with the name in the row; Enter keeps the
  // new name, and the focus goes back to the row.
  await page.getByRole("button", { name: /^Agent review/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Rename/ }).click();
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveValue("Agent review");
  await userEvent.fill(field, "Talk prep");
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Talk prep", "Second review"]);
  expect(named()).toEqual([{ path: "/api/threads/agent/name", body: { name: "Talk prep" } }]);
  const row = page.getByRole("button", { name: /^Talk prep/ });
  await expect.element(row).toHaveFocus();

  // A double-click on the row names it too; its first click opens the thread.
  // Esc keeps the name it had.
  await row.dblClick();
  await expect.element(field).toHaveFocus();
  await userEvent.keyboard("Something else{Escape}");
  await expect.element(field).not.toBeInTheDocument();
  await expect.poll(threadRows).toEqual(["Talk prep(current)", "Second review"]);
  expect(named()).toHaveLength(1);

  // The palette names the thread on screen, which the window's title shows. An
  // empty name gives the agent's title back.
  await expect.poll(() => shown()?.dataset.reviewId).toBe("agent-target");
  await expect.poll(() => document.title).toBe("Talk prep");
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Rename thread");
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveAttribute("placeholder", "Agent review");
  await userEvent.clear(field);
  await userEvent.keyboard("{Enter}");
  await expect.poll(threadRows).toEqual(["Agent review(current)", "Second review"]);
  expect(named().at(-1)).toEqual({ path: "/api/threads/agent/name", body: { name: "" } });

  // With the sidebar hidden, the title band holds the field.
  await userEvent.keyboard("{Control>}b{/Control}");
  await expect.element(page.getByRole("navigation", { name: "Sessions" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Rename thread");
  await userEvent.keyboard("{Enter}");
  const band = page.getByRole("banner", { name: "Workspace" });
  await expect.element(band.getByRole("textbox", { name: "Thread name" })).toHaveFocus();
  // The name starts selected, so typing replaces it.
  await userEvent.keyboard("Regions{Enter}");
  await expect.poll(() => document.title).toBe("Regions");
  expect(named().at(-1)).toEqual({ path: "/api/threads/agent/name", body: { name: "Regions" } });
  await userEvent.keyboard("{Control>}b{/Control}");
});

test("a tab's menu copies its resume command, marks it unread, and closes it", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  host.setThreads([
    thread("agent", {
      agent: "claude",
      state: "idle",
      checkout: "/test/feature",
      linked: true,
      branch: "feature",
      session: { agent: "claude", id: "abc-123", cwd: "/work/it's here" },
    }),
    thread("second"),
  ]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review"]);
  const row = page.getByRole("button", { name: /^Agent review/ });
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Copy resume command/ }).click();
  // The directory is quoted for the shell, so the command pastes as is.
  expect(copy).toHaveBeenCalledWith(`cd '/work/it'\\''s here' && claude --resume abc-123`);
  copy.mockRestore();

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Mark as unread/ }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review, new");
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Mark as read/ }).click();
  await expect.poll(() => threadRows()[0]).toBe("Agent review");

  // Archive leaves the list at once.
  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Archive/ }).click();
  await expect.poll(threadRows).toEqual(["Second review"]);
  expect(host.threadRequests).toEqual([
    { path: "/api/threads/agent/close", body: { removeWorktree: false } },
  ]);

  // Delete asks first.
  await page.getByRole("button", { name: /^Second review/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
  const ask = page.getByRole("status").filter({ hasText: "Delete “Second review”?" });
  await ask.getByRole("button", { name: "Delete" }).click();
  await expect.poll(threadRows).toEqual([]);
  expect(host.threadRequests.at(-1)).toEqual({ path: "/api/threads/second/delete", body: {} });
});

test("⌘0 goes to a tab that needs you, then one whose work finished since you looked, then one that works", async () => {
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  const later = Date.now() + 60_000;
  const tabs = (fourth: Partial<Thread>) => [
    thread("agent"),
    thread("second", { state: "working", updatedAt: Date.now() - 30_000 }),
    thread("third", { updatedAt: later }),
    thread("fourth", { updatedAt: later - 1000, ...fourth }),
  ];
  host.setThreads(tabs({ state: "waiting" }));
  /** The row of the thread whose title starts with this. */
  const row = (name: string) => threadRows().find((entry) => entry.startsWith(name));
  // The sidebar marks each as ⌘0 ranks it.
  await expect
    .poll(threadRows)
    .toEqual([
      "Third review, new",
      "Fourth review, needs you",
      "Second review, working",
      "Agent review",
    ]);
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Fourth")).toBe("Fourth review(current)");
  // The tab on screen still needs you: the next is the one that finished.
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Third")).toBe("Third review(current)");
  // Seen on screen, it is not new: the host has the mark, for every window
  // and the CLI.
  await expect
    .poll(() => host.requested.filter((path) => path === "/api/threads/third/seen").length)
    .toBeGreaterThan(0);
  // The tab that needed you goes on: what it did since you looked is new.
  host.setThreads(tabs({ updatedAt: later + 1000 }));
  await expect.poll(() => row("Fourth")).toBe("Fourth review, new");
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Fourth")).toBe("Fourth review(current)");
  await expect.poll(() => row("Third")).toBe("Third review");
  // Nothing needs you or is new: the next is the one that works.
  await userEvent.keyboard("{Control>}0{/Control}");
  await expect.poll(() => row("Second")).toBe("Second review, working(current)");
});

test("the marks that a browser kept of what the reader saw go to the host once", async () => {
  const before = Date.now() - 120_000;
  localStorage.setItem("med:thread-seen-since", String(before));
  localStorage.setItem("med:thread-seen", JSON.stringify({ agent: Date.now() }));
  const host = createHost();
  render(host);
  await expect.poll(() => shown()?.dataset.reviewStatus).toBe("ready");
  // The second tab changed after this browser's first visit, and it had no
  // mark: it was new here, and stays new.
  host.setThreads([thread("agent"), thread("second", { updatedAt: Date.now() - 90_000 })]);
  await expect.poll(threadRows).toEqual(["Agent review", "Second review, new"]);
  expect(host.threadRequests).toEqual([
    {
      path: "/api/threads/seen",
      body: { marks: { agent: expect.any(Number), second: before } },
    },
  ]);
  expect(localStorage.getItem("med:thread-seen")).toBeNull();
  expect(localStorage.getItem("med:thread-seen-since")).toBeNull();
});
