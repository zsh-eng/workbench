import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  firstCommit,
  mountApp,
  openBranch,
  prepareWindow,
  secondCommit,
  unmountApp,
} from "./app-fixture";

beforeEach(prepareWindow);
afterEach(unmountApp);

describe("graphical review", () => {
  test("the Review tab and its version restore the Review after live file browsing", async () => {
    const { controller } = await mountApp({
      savedReview: true,
      branches: true,
    });
    const reviewTab = page.getByRole("radio", { name: "Review", exact: true });
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true }))
      .toBeVisible();
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "false");
    await reviewTab.click();
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    expect(controller.getSnapshot().savedView).toBe(true);

    // Retain an active file in both workspaces, then return to a version whose
    // stored file navigation would otherwise hide its saved comparison.
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await openBranch("feature");
    await page.getByRole("link", { name: "src/beta.ts", exact: true }).click();
    await expect
      .element(page.getByRole("textbox", { name: "Edit src/beta.ts", exact: true }))
      .toBeVisible();
    await reviewTab.click();
    await expect.poll(() => controller.getSnapshot().savedView).toBe(true);
    await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    // Two checkouts: a click switches to the other.
    const checkout = page.getByRole("button", { name: /^Review checkout: / });
    for (const [index, name] of [
      [0, /^Review checkout: repo · /],
      [1, /^Review checkout: feature · /],
    ] as const) {
      if (!name.test(checkout.element().getAttribute("aria-label") ?? "")) await checkout.click();
      await expect.element(checkout).toHaveAccessibleName(name);
      await expect.poll(() => controller.getSnapshot().review?.id).toBe(`target-${index}`);
      await expect.element(reviewTab).toHaveAttribute("aria-checked", "true");
    }
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

  test("a saved review moves the workspace to its branch, and its files open from there", async () => {
    const { controller, fileRequests } = await mountApp({ savedReview: true, oneBranch: true });
    // The checkout has the first commit checked out: its files are the working files.
    const link = page.getByRole("link", { name: "src/alpha.ts", exact: true });
    await link.click();
    await expect
      .poll(() => fileRequests.at(-1)?.source)
      .toEqual({ kind: "worktree", repo: "/test/repo" });
    await page.getByRole("button", { name: "Close src/alpha.ts" }).click();
    // The second is the tip of tax-rates, which no checkout has, though the
    // review was captured on main: the workspace shows tax-rates.
    await controller.selectSavedTarget("target-1");
    await expect.poll(() => controller.getSnapshot().review?.head).toBe(secondCommit);
    expect(controller.getSnapshot()).toMatchObject({
      activeBranch: "tax-rates",
      historyRef: "refs/heads/tax-rates",
    });
    await link.click();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({
        source: { kind: "commit", repo: "/test/repo", oid: secondCommit },
        path: "src/alpha.ts",
      });
    await expect.element(page.getByRole("tab", { name: /alpha\.ts/ })).toBeVisible();
  });

  test("Find file says why it can't open files when the checkout did not load", async () => {
    await mountApp({ sessionFails: "Permission denied: /test/repo" });
    await userEvent.keyboard("{Meta>}{Shift>}K{/Shift}{/Meta}");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Permission denied: /test/repo" }))
      .toBeVisible();
    expect(page.getByRole("dialog", { name: /Find file/ }).query()).toBeNull();
  });

  test("Command-click opens background tabs from diff filenames and the changes tree", async () => {
    const { controller } = await mountApp();
    await page
      .getByRole("link", { name: "src/alpha.ts", exact: true })
      .click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    const selected = controller.getSnapshot().selectedFileId;
    await page.getByRole("treeitem", { name: /beta.ts/ }).click({ modifiers: ["Meta"] });
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    expect(controller.getSnapshot().selectedFileId).toBe(selected);
    // The tabs are the Files page's: Changes has none.
    expect(page.getByRole("tab", { name: "alpha.ts", exact: true }).query()).toBeNull();
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect
      .element(page.getByRole("tab", { name: "beta.ts", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    // The tabs are the same width, as in Chrome, whatever their names.
    const items = () =>
      [...document.querySelectorAll('[aria-label="Open files"] [role="tab"]')].map(
        (tab) => tab.parentElement!.getBoundingClientRect().width,
      );
    expect(items()).toHaveLength(2);
    expect(new Set(items()).size).toBe(1);
    // The pointer on a tab's × fills the tab, as on the tab itself.
    const alpha = page.getByRole("tab", { name: "alpha.ts", exact: true });
    const fill = () => getComputedStyle(alpha.element()).backgroundColor;
    const resting = fill();
    await userEvent.hover(page.getByRole("button", { name: "Close src/alpha.ts" }));
    await expect.poll(fill).not.toBe(resting);
    await alpha.click();
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
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
        lines: [
          {
            line: start,
            commit: "a".repeat(40),
            author: "Mira",
            date: "",
            summary: "Add",
          },
        ],
      }),
    });
    for (const name of ["src/alpha.ts", "src/beta.ts"])
      await page.getByRole("link", { name, exact: true }).click({ modifiers: ["Meta"] });
    const blame = page.getByRole("button", { name: "Toggle Git blame" });
    // Files opened behind wait on the Files page.
    await page.getByRole("radio", { name: "Files", exact: true }).click();
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
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
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

  test("a fresh launch opens read-only files with a visible Vim cursor and keyboard focus", async () => {
    await mountApp({ readOnly: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", {
      name: "File navigation",
      exact: true,
    });
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
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "File", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("worktree");
    await expect.element(page.getByRole("dialog", { name: "Find symbol" })).not.toBeInTheDocument();
    // With a file open, ⌘⇧O opens its symbols; the picker switches to the project's.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "o",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await page.getByRole("button", { name: "Project", exact: true }).click();
    await page.getByRole("combobox").fill("working");
    await page.getByRole("option", { name: /workingContents/ }).click();
    await expect
      .poll(() => fileRequests.at(-1)?.source)
      .toEqual({ kind: "commit", repo: "/test/repo", oid: firstCommit });
  });

  test("question mark shows the command guide with keycaps", async () => {
    await mountApp({ branches: true });
    await expect.element(page.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    const input = document.querySelector('input[aria-label="Filter changed files"]')!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
    await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    expect(document.querySelectorAll('[role="dialog"] kbd').length).toBeGreaterThan(10);
    await page.getByRole("option", { name: /Open command palette/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search commands" })).toBeVisible();
    await page.getByRole("combobox", { name: "Search commands" }).fill("Open branch");
    await page.getByRole("option", { name: /Open branch/ }).click();
    await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
  });

  test("⌘K lists commands in sections, ranks a query's matches in bold, and still finds an older name", async () => {
    await mountApp({ branches: true });
    await expect.element(page.getByRole("textbox", { name: "Filter changed files" })).toBeVisible();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    const input = page.getByRole("combobox", { name: "Search commands" });
    await expect.element(input).toHaveAttribute("placeholder", "Search commands…");
    const dialog = () => document.querySelector('[role="dialog"]')!;
    // No query: the commands in sections, Go to first, each with its icon.
    const sections = () =>
      [...dialog().querySelectorAll('[role="listbox"] > [role="group"]')].map(
        (group) => document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent,
      );
    expect(sections()[0]).toBe("Go to");
    expect(sections()).toContain("Settings");
    const first = dialog().querySelector('[role="option"]')!;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.querySelector("svg")).not.toBeNull();
    // A query: one ranked list, the match in bold.
    await input.fill("find file");
    expect(sections()).toEqual([]);
    const best = dialog().querySelector('[role="option"]')!;
    expect(best.querySelector("b")?.textContent).toBe("Find file");
    // An older, longer name still finds its command.
    await input.fill("Close all files in this workspace");
    await expect.element(page.getByRole("option", { name: /^Close all files/ })).toBeVisible();
    await input.fill("no such command");
    await expect
      .element(page.getByRole("status").filter({ hasText: "No commands match" }))
      .toHaveTextContent("No commands match “no such command”");
    expect(dialog().querySelector('[role="listbox"]')).not.toBeNull();
  });

  test("a single branch needs no tab strip; Command Shift G opens another beside it", async () => {
    await mountApp({ branches: true });
    const strip = page.getByRole("tablist", { name: "Branches and worktrees" });
    const switcher = page.getByRole("button", {
      name: "Open branch",
      exact: true,
    });
    const branch = () => switcher.element().textContent?.split("/").at(-1);
    await expect.poll(branch).toBe("main");
    await expect.element(strip).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "G",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
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
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect.element(guide.getByRole("tab", { name: /Review/, selected: true })).toBeVisible();
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("zz");
    await expect
      .element(guide.getByRole("option", { name: /Center the cursor line/ }))
      .toBeVisible();
    expect(guide.getByRole("option").elements()).toHaveLength(2);
    await page.getByRole("combobox", { name: "Search shortcuts and commands" }).fill("Open branch");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByRole("combobox", { name: "Search branches" })).toBeVisible();
    await expect.element(guide).not.toBeInTheDocument();
  });

  test("file close shortcuts preserve Changes and close only the requested tabs", async () => {
    await mountApp();
    // The changed files are the Changes page's sidebar, so each open starts there.
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await changes.click();
    await page.getByRole("treeitem", { name: /beta.ts/ }).dblClick();
    const altKey = (code: string, shiftKey = false) =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "∑",
          code,
          altKey: true,
          shiftKey,
          bubbles: true,
        }),
      );
    altKey("KeyO", true);
    await expect
      .element(page.getByRole("tab", { name: "alpha.ts", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("tab", { name: "beta.ts", exact: true })).toBeVisible();
    // The tab that showed before comes back, not the closed tab's neighbor:
    // the list's first click showed alpha.ts in Changes.
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await changes.click();
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect.element(tab("alpha.ts")).toHaveAttribute("aria-selected", "true");
    altKey("KeyW");
    await expect.element(tab("alpha.ts")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await tab("beta.ts").click();
    await tab("alpha.ts").click();
    altKey("KeyW");
    await expect.element(tab("alpha.ts")).not.toBeInTheDocument();
    await expect.element(tab("beta.ts")).toHaveAttribute("aria-selected", "true");
    const editor = page.getByRole("textbox", {
      name: "Edit src/beta.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    await expect.poll(() => document.activeElement).toBe(editor.element());
    altKey("KeyW", true);
    await expect.element(tab("beta.ts")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });

  test("each file that Find file opens keeps its tab, a second open shows that tab, and tab keys move along the row", async () => {
    await mountApp();
    const find = async (name: string, keys: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "K",
          metaKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
      await page.getByRole("combobox", { name: "Find file", exact: true }).fill(name);
      await expect.element(page.getByRole("option", { name: new RegExp(name) })).toBeVisible();
      await userEvent.keyboard(keys);
      await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    };
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await find("beta.ts", "{Enter}");
    await find("alpha.ts", "{Enter}");
    await expect.element(tab("beta.ts")).toBeVisible();
    // A second open shows the file's tab; it adds none.
    await find("beta.ts", "{Enter}");
    await expect.element(tab("beta.ts")).toHaveAttribute("aria-selected", "true");
    expect(page.getByRole("tab", { name: "beta.ts", exact: true }).all()).toHaveLength(1);
    await find("alpha.ts", "{Enter}");
    // The order is Changes, Commit, beta.ts, alpha.ts.
    const key = (init: KeyboardEventInit, target: EventTarget = window) =>
      target.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    // The pages are a switch in the header; files are tabs.
    const selected = async (name: string) => {
      const isPage = name === "Changes" || name === "Commit";
      const shown = isPage ? page.getByRole("radio", { name, exact: true }) : tab(name);
      await expect
        .element(shown)
        .toHaveAttribute(isPage ? "aria-checked" : "aria-selected", "true");
    };
    // From alpha.ts's editor too, where Option+3 would otherwise type £.
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
    await expect.element(editor).toBeVisible();
    // / starts Vim's search in the file, also from outside it.
    (document.activeElement as HTMLElement | null)?.blur();
    key({ key: "/", code: "Slash" });
    await expect.element(page.getByRole("textbox", { name: "Edit src/alpha.ts" })).toBeVisible();
    await expect.poll(() => document.activeElement?.closest(".med-find-panel")).not.toBeNull();
    key({ key: "Escape", code: "Escape" }, document.activeElement!);
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
    const { controller, fileRequests } = await mountApp({ branches: true });
    await controller.selectComparison({ kind: "commit", commit: secondCommit });
    const diffHost = document.querySelector("diffs-container");
    await page.getByRole("treeitem", { name: /alpha.ts/ }).dblClick();
    await expect
      .element(page.getByRole("region", { name: "File editor", exact: true }))
      .toBeVisible();
    await expect
      .poll(() => fileRequests.at(-1))
      .toEqual({
        source: { kind: "worktree", repo: "/test/repo" },
        path: "src/alpha.ts",
      });
    expect(diffHost?.isConnected).toBe(true);
    // The file's header has no Open before; ⌘K does.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("option", { name: /^Open before version of current file/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.kind).toBe("commit");
    // Commit snapshots stay read-only.
    await expect
      .element(page.getByRole("region", { name: "Full file", exact: true }))
      .toBeVisible();
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
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
      new KeyboardEvent("keydown", {
        key: "K",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await expect.element(page.getByRole("option", { name: /feature-only.ts/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /alpha.ts/ })).not.toBeInTheDocument();
    await page.getByRole("option", { name: /feature-only.ts/ }).click();
    await expect.poll(() => fileRequests.at(-1)?.source.repo).toBe("/test/feature");
  });

  test("Space stays unhandled and Command K still opens commands", async () => {
    await mountApp();
    for (let i = 0; i < 2; i++) {
      const space = new KeyboardEvent("keydown", {
        key: " ",
        bubbles: true,
        cancelable: true,
      });
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
});
