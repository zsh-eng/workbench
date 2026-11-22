import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";
import {
  chooseLayout,
  firstCommit,
  mountApp,
  openBranch,
  prepareWindow,
  secondCommit,
  toggleFilesSidebar,
  unmountApp,
} from "./app-fixture";

beforeEach(prepareWindow);
afterEach(unmountApp);

describe("graphical review", () => {
  test("Show files sidebar opens the Files page with its tree; it has no shortcut", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    const tree = () =>
      document.querySelector('nav[aria-label="Workspace files"]')?.checkVisibility() ?? false;
    const filesPage = page.getByRole("radio", { name: "Files", exact: true });
    // Without an agent session, Command Shift B does nothing.
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "B",
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(tree()).toBe(false);
    await expect.element(filesPage).not.toBeChecked();
    // The tree is the Files page's sidebar: showing it shows the page, and
    // hiding it leaves the page on screen.
    for (const visible of [true, false]) {
      await toggleFilesSidebar();
      await expect.poll(tree).toBe(visible);
      await expect.element(filesPage).toBeChecked();
    }
    // With no file open, the page says how to open one, and has no tabs.
    await expect.element(page.getByText("No file open", { exact: true })).toBeVisible();
    expect(page.getByRole("tab").elements()).toHaveLength(0);
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

  test("side panes tile beside the review: zoom, resize, balance, and close", async () => {
    await page.viewport(1280, 800);
    const events = [
      {
        at: 0,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Renamed in [alpha.ts:1](src/alpha.ts:1)." },
        },
      },
    ];
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events, idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const session = page.getByRole("region", { name: "Agent session", exact: true });
    const panes = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]:not([hidden])")]
        .map((pane) => [pane.dataset.pane!, pane.getBoundingClientRect()] as const)
        .sort((a, b) => a[1].left - b[1].left);
    // The session leads, at the left.
    await expect.poll(() => panes().map(([id]) => id)).toEqual(["session", "review"]);

    // Zoom gives one pane the whole tree; the others wait behind it, inert.
    // The review's row has Expand; ⌘E expands the pane in use.
    const tree = document.querySelector("[data-pane-tree]")!.getBoundingClientRect();
    const sessionPane = document.querySelector<HTMLElement>('[data-pane="session"]')!;
    const reviewPane = document.querySelector<HTMLElement>('[data-pane="review"]')!;
    await page.getByRole("button", { name: "Expand review" }).click();
    await expect.poll(() => reviewPane.getBoundingClientRect().width).toBe(tree.width);
    expect(sessionPane.inert).toBe(true);
    await page.getByRole("button", { name: "Restore the other panes" }).click();
    await expect.poll(() => sessionPane.inert).toBe(false);
    const expandSession = async () => {
      sessionPane.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await userEvent.keyboard("{Meta>}e{/Meta}");
      await expect.poll(() => sessionPane.getBoundingClientRect().width).toBe(tree.width);
      expect(reviewPane.inert).toBe(true);
    };
    await expandSession();
    await userEvent.keyboard("{Meta>}e{/Meta}");
    await expect
      .poll(() => sessionPane.getBoundingClientRect().width)
      .toBeLessThan(tree.width * 0.75);

    // A gutter's arrow keys move the edge between two panes; ⌘⌃= gives each
    // pane the same width.
    const gutter = page.getByRole("separator", { name: /^Resize Session and .+$/ });
    const share = () => Number(gutter.element().getAttribute("aria-valuenow"));
    const start = share();
    (gutter.element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(share).toBeGreaterThan(start);
    await userEvent.keyboard("{Meta>}{Control>}={/Control}{/Meta}");
    await expect
      .poll(() => {
        const widths = panes().map(([, rect]) => rect.width);
        return Math.max(...widths) - Math.min(...widths);
      })
      .toBeLessThanOrEqual(2);

    // A window too small for both panes shows one, and both come back.
    const ids = () => panes().map(([id]) => id);
    await page.viewport(400, 800);
    await expect.poll(() => ids().length).toBe(1);
    await page.viewport(1280, 800);
    await expect.poll(ids).toEqual(["session", "review"]);

    // A file that opens from a zoomed pane shows: the review gets its room back.
    await expandSession();
    await session.getByRole("link", { name: "Open src/alpha.ts at L1" }).click();
    await expect
      .poll(() => sessionPane.getBoundingClientRect().width)
      .toBeLessThan(tree.width * 0.75);
    expect(reviewPane.inert).toBe(false);
  });

  test("a Markdown file reads rendered, and ⌘⇧V shows its source in its place", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    await toggleFilesSidebar();
    const files = page.getByRole("navigation", { name: "Workspace files", exact: true });
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    const editor = page.getByRole("textbox", { name: "Edit docs/GUIDE.md", exact: true });
    await expect.element(editor).not.toBeInTheDocument();
    // The page is the whole view: Copy and Edit source sit at its top corner.
    const tools = reading.getByRole("toolbar", { name: "Page" });
    await expect.element(tools.getByRole("button", { name: "Copy page" })).toBeVisible();
    await expect.element(tools.getByRole("button", { name: "Edit source" })).toBeVisible();
    expect(document.querySelector(".med-markdown-reader header")).toBeNull();

    // The source shows in place of the text, never beside it.
    await page.getByRole("button", { name: "Edit source" }).click();
    await expect.element(editor).toBeVisible();
    await expect.element(reading).not.toBeInTheDocument();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "V", metaKey: true, shiftKey: true, bubbles: true }),
    );
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    await expect.element(editor).not.toBeInTheDocument();

    // The file keeps the view that it showed last.
    await page.getByRole("button", { name: "Edit source" }).click();
    await expect.element(editor).toBeVisible();
    await files.getByRole("treeitem", { name: "alpha.ts", exact: true }).click();
    await expect.element(editor).not.toBeInTheDocument();
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    await expect.element(editor).toBeVisible();
    await page.getByRole("button", { name: "Read" }).click();
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    expect(document.querySelector('[data-pane="preview"]')).toBeNull();
  });

  test("a Markdown file that shows again shows its page from the first frame while it reads, never its source", async () => {
    let holding = false;
    let release: (() => void) | undefined;
    await page.viewport(1280, 800);
    await mountApp({
      readGate: (path) =>
        holding && path.endsWith(".md")
          ? new Promise<void>((done) => (release = done))
          : Promise.resolve(),
    });
    await toggleFilesSidebar();
    const files = page.getByRole("navigation", { name: "Workspace files", exact: true });
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    await files.getByRole("treeitem", { name: "alpha.ts", exact: true }).click();
    await expect.element(reading).not.toBeInTheDocument();

    // Each frame from here says what it showed: the page with its text, the
    // page empty, or the note's source.
    const frames: string[] = [];
    let recording = true;
    const look = () => {
      const editor = [...document.querySelectorAll(".cm-editor")].some((node) =>
        node.textContent?.includes("# Guide"),
      );
      const prose = document.querySelector(".med-md-prose");
      const state = editor
        ? "source"
        : prose?.querySelector("h1")?.textContent === "Guide"
          ? "page"
          : document.querySelector(".med-markdown-reader")
            ? "empty page"
            : "other file";
      if (frames.at(-1) !== state) frames.push(state);
      if (recording) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
    holding = true;
    await files.getByRole("treeitem", { name: "GUIDE.md", exact: true }).click();
    await expect.poll(() => release).toBeDefined();
    // The read is still out: the note's page shows, not its source.
    await expect.element(reading.getByRole("heading", { name: "Guide" })).toBeVisible();
    release!();
    await new Promise((done) => setTimeout(done, 200));
    recording = false;
    expect(frames).toEqual(["other file", "page"]);
    await expect
      .element(page.getByRole("textbox", { name: "Edit docs/GUIDE.md", exact: true }))
      .not.toBeInTheDocument();
  });

  test("Find file opens a vault's note in the workspace's tabs; its links stay in the vault", async () => {
    await page.viewport(1280, 800);
    const { vaultWrites } = await mountApp({ vault: true });
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
    );
    const find = page.getByRole("combobox", { name: "Find file", exact: true });
    await find.fill("notes");
    await expect.element(page.getByRole("option", { name: "Vault notes" })).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect
      .element(page.getByRole("button", { name: "Back to current repository" }))
      .toHaveTextContent("notes");
    // A space finds words that a hyphen or a slash separates.
    await find.fill("projects plan");
    await expect.element(page.getByRole("option", { name: /Plan.md/ })).toBeVisible();
    await userEvent.keyboard("{Enter}");

    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Plan" })).toBeVisible();
    // The page has no bar; its tab names the note and its vault.
    await expect
      .element(page.getByRole("tab", { name: /Plan\.md/ }))
      .toHaveAttribute("data-tooltip", "Projects/Plan.md · notes");
    await reading.getByRole("link", { name: "Target" }).click();
    await expect.element(page.getByRole("tab", { name: /Target.md/ })).toBeVisible();
    await expect.element(reading.getByRole("heading", { name: "Target" })).toBeVisible();

    // Its source saves to the vault's file.
    await page.getByRole("button", { name: "Edit source" }).click();
    const editor = page.getByRole("textbox", { name: "Edit /test/notes/Target.md", exact: true });
    await expect.element(editor).toBeVisible();
    await userEvent.click(editor);
    await userEvent.keyboard("ggA again{Escape}:w{Enter}");
    await expect
      .poll(() => vaultWrites)
      .toEqual([
        { path: "/test/notes/Target.md", text: "# Target again\n\nLinked from the plan.\n" },
      ]);
    await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  });

  test("Find file shows a vault's notes without the Tab step, and the vault's chip searches only it", async () => {
    await page.viewport(1280, 800);
    await mountApp({ vault: true });
    const open = () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "K", metaKey: true, shiftKey: true, bubbles: true }),
      );
    open();
    const find = page.getByRole("combobox", { name: "Find file", exact: true });
    await expect.element(find).toHaveAttribute("placeholder", "Find a file…");
    // A note whose name holds the words is an option, with its vault's name.
    await find.fill("plan");
    const note = page.getByRole("option", { name: /Plan\.md/ });
    await expect.poll(() => note.element().textContent).toBe("Plan.mdnotes · Projects · Note");
    expect(document.querySelectorAll('[role="dialog"] [role="option"]')).toHaveLength(1);
    await userEvent.keyboard("{Enter}");
    const reading = page.getByRole("region", { name: "Markdown preview" });
    await expect.element(reading.getByRole("heading", { name: "Plan" })).toBeVisible();
    // The page has no bar; its tab names the note and its vault.
    await expect
      .element(page.getByRole("tab", { name: /Plan\.md/ }))
      .toHaveAttribute("data-tooltip", "Projects/Plan.md · notes");

    // The chip under the field scopes the search to the vault.
    open();
    await page.getByRole("button", { name: "notes", exact: true }).click();
    await expect
      .element(page.getByRole("button", { name: "Back to current repository" }))
      .toHaveTextContent("notes");
    await find.fill("target");
    await expect.element(page.getByRole("option", { name: /Target\.md/ })).toBeVisible();
  });

  test("a pane's header drags it beside another pane or swaps the two; Escape keeps it", async () => {
    await page.viewport(1280, 800);
    await mountApp({
      savedReview: true,
      session: `event: reset\ndata: ${JSON.stringify({ events: [], idle: true, modifiedAt: 0, truncated: false })}\n\n`,
    });
    await page.getByRole("button", { name: "Show agent session" }).click();
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("[data-pane]:not([hidden])")]
        .map((pane) => [pane.dataset.pane!, pane.getBoundingClientRect()] as const)
        .sort((a, b) => a[1].top - b[1].top || a[1].left - b[1].left)
        .map(([id]) => id);
    await expect.poll(order).toEqual(["session", "review"]);
    const rect = (id: string) =>
      document.querySelector(`[data-pane="${id}"]`)!.getBoundingClientRect();
    const grip = () => document.querySelector('[data-pane="session"] [data-pane-handle]')!;
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    /** Drags the Session header to a point, then drops it or presses Escape. */
    const dragTo = async (x: number, y: number, end: "drop" | "escape" = "drop") => {
      const handle = grip();
      const start = handle.getBoundingClientRect();
      const at = (type: string, clientX: number, clientY: number) =>
        handle.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            button: 0,
            pointerId: 7,
            clientX,
            clientY,
          }),
        );
      at("pointerdown", start.x + 4, start.y + 4);
      at("pointermove", start.x + 40, start.y + 40);
      at("pointermove", x, y);
      await frame();
      await frame();
      if (end === "escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      else at("pointerup", x, y);
    };

    // The lower edge of the review: the session goes below it.
    const review = rect("review");
    await dragTo(review.left + review.width / 2, review.bottom - 10);
    await expect.poll(order).toEqual(["review", "session"]);
    expect(Math.round(rect("session").top)).toBeGreaterThan(Math.round(review.top) + 100);
    // It settles in from a slight scale, as a new pane does.
    await expect.poll(() => Math.round(rect("session").left)).toBe(Math.round(rect("review").left));

    // The middle of the review swaps the two.
    const above = rect("review");
    await dragTo(above.left + above.width / 2, above.top + above.height / 2);
    await expect.poll(() => Math.round(rect("session").top)).toBe(Math.round(above.top));

    // Escape keeps the pane where it was.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const before = order();
    const target = rect("review");
    await dragTo(target.left + 8, target.top + target.height / 2, "escape");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(order()).toEqual(before);
    expect(document.querySelector("[data-pane-tree] > [aria-hidden='true']")).toBeNull();

    // ⌘⌥⇧ and an arrow move the focused pane past its neighbor.
    document.querySelector<HTMLElement>('[data-pane="session"]')!.focus();
    const top = Math.round(rect("session").top);
    await userEvent.keyboard("{Meta>}{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}{/Meta}");
    await expect.poll(() => Math.round(rect("session").top)).toBeGreaterThan(top);
  });

  test("the Files page keeps its tree and collapsed folders across toggles and pages", async () => {
    await page.viewport(1280, 800);
    await mountApp({ branches: true });
    const selector = 'nav[aria-label="Workspace files"] file-tree-container';
    // The tree waits, prepared and hidden, before the Files page shows.
    await expect
      .poll(
        () =>
          document.querySelector(selector)?.shadowRoot?.querySelectorAll('[role="treeitem"]')
            .length ?? 0,
      )
      .toBeGreaterThan(0);
    const preparedHost = document.querySelector(selector);
    expect(preparedHost?.checkVisibility()).toBe(false);
    await toggleFilesSidebar();
    const sidebar = page.getByRole("navigation", { name: "Workspace files", exact: true });
    const folder = sidebar.getByRole("treeitem", { name: "src", exact: true });
    await expect.element(folder).toHaveAttribute("aria-expanded", "true");
    await folder.click();
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    const host = document.querySelector(selector);
    expect(host).toBe(preparedHost);
    await toggleFilesSidebar();
    await expect.poll(() => host?.checkVisibility()).toBe(false);
    await toggleFilesSidebar();
    await expect.poll(() => host?.checkVisibility()).toBe(true);
    expect(document.querySelector(selector)).toBe(host);
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    // Another page and back: the same tree, as the reader left it.
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
    await expect.poll(() => host?.checkVisibility()).toBe(false);
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect.poll(() => host?.checkVisibility()).toBe(true);
    expect(document.querySelector(selector)).toBe(host);
    await expect.element(folder).toHaveAttribute("aria-expanded", "false");
    // Another branch has its own files. It opens on Changes.
    await openBranch("feature");
    await page.getByRole("radio", { name: "Files", exact: true }).click();
    await expect
      .element(sidebar.getByRole("treeitem", { name: "feature-only.ts", exact: true }))
      .toBeVisible();
    expect(document.querySelector(selector)).not.toBe(host);
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
    // A new branch name rolls in; moving the switch with the sidebar does not replay it.
    const name = () =>
      page.getByRole("button", { name: "Open branch" }).getByText("release", { exact: true });
    await openBranch("release");
    await expect.poll(() => name().element().getAnimations().length).toBeGreaterThan(0);
    await expect.poll(() => controller.getSnapshot().historyRef).toBe("refs/heads/release");
    // A branch that no worktree has shows its commits since the base.
    expect(controller.getSnapshot().comparison).toEqual({
      kind: "range",
      base: "main",
      head: secondCommit,
      mergeBase: true,
    });
    await expect
      .element(page.getByRole("button", { name: "Working changes", exact: true }))
      .not.toBeInTheDocument();
    // Alone, ⌘B is the Changes page's sidebar.
    const sidebar = () =>
      document.querySelector('nav[aria-label="Files and commits"]')?.checkVisibility() ?? false;
    const panel = document.querySelector('nav[aria-label="Files and commits"]');
    expect(panel).not.toBeNull();
    await expect.poll(() => name().element().getAnimations()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(false);
    expect(name().element().getAnimations()).toEqual([]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    await expect.poll(sidebar).toBe(true);
    expect(name().element().getAnimations()).toEqual([]);
    // The sidebar comes back as it was, without building its content again.
    expect(document.querySelector('nav[aria-label="Files and commits"]')).toBe(panel);
  });

  test("mounts real Pierre stream, changes theme and reviews commits without dropping other files", async () => {
    await page.viewport(1280, 800);
    const { controller, requests } = await mountApp();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Change theme");
    await page.getByRole("option", { name: /Change theme/ }).click();
    await page.getByRole("combobox", { name: "Search themes" }).fill("Tokyo");
    await page.getByRole("option", { name: /Tokyo Night/ }).click();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
    await controller.selectComparison({ kind: "commit", commit: firstCommit });
    await expect
      .poll(() =>
        document.querySelector("[data-selected-commit]")?.getAttribute("data-selected-commit"),
      )
      .toBe(firstCommit);
    await expect
      .poll(() => document.querySelectorAll("diffs-container").length)
      .toBeGreaterThanOrEqual(2);
    await controller.selectComparison({ kind: "commit", commit: secondCommit });
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

  test("filters the full file set, switches layout, and finds across both files", async () => {
    const { controller } = await mountApp();
    await page.getByRole("textbox", { name: "Filter changed files" }).fill("alpha");
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(1);
    expect(controller.getSnapshot().files).toHaveLength(2);
    await page.getByRole("button", { name: "Clear file filter" }).click();
    await expect.poll(() => controller.getSnapshot().visibleFiles.length).toBe(2);
    await chooseLayout("Unified");
    expect(localStorage.getItem("med:mode")).toBe("unified");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    await page.getByRole("combobox", { name: "Search commands" }).fill("Find in diff");
    await page.getByRole("option", { name: /Find in diff contents/ }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
    // Typing goes to the first matching line.
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    // Every match is marked; the current hit's matches are marked on top.
    await expect.poll(() => CSS.highlights.get("med-diff-find")?.size ?? 0).toBeGreaterThan(1);
    await expect
      .poll(() => [...(CSS.highlights.get("med-diff-find-current") ?? [])].map(String))
      .toContain("after");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(page.getByText("2 of 2", { exact: true })).toBeVisible();
    // Match case finds none; a regular expression finds them again.
    await page.getByRole("button", { name: "Match case" }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("AFTER");
    await expect.element(page.getByText("No results", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Match case" }).click();
    await page.getByRole("button", { name: "Regular expression" }).click();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("aft(er");
    await expect.element(page.getByText("Not a valid pattern", { exact: true })).toBeVisible();
    await page.getByRole("textbox", { name: "Find in changes" }).fill("af+ter");
    await expect.element(page.getByText("1 of 2", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => CSS.highlights.has("med-diff-find")).toBe(false);
  });

  test("a palette command that opens a field leaves the focus in it", async () => {
    await mountApp();
    // Focus starts on a control, which the palette would otherwise give it back to.
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    await changes.click();
    expect(document.activeElement).toBe(changes.element());
    const command = async (name: string) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }),
      );
      await page.getByRole("combobox", { name: "Search commands" }).fill(name);
      await userEvent.keyboard("{Enter}");
    };
    await command("Find in diff contents");
    const find = page.getByRole("textbox", { name: "Find in changes" });
    await expect.poll(() => document.activeElement).toBe(find.element());
    // Typing goes into the box.
    await userEvent.keyboard("after");
    await expect.element(find).toHaveValue("after");
    await userEvent.keyboard("{Escape}");
    await changes.click();
    await command("Filter changed files");
    await expect.poll(() => document.activeElement?.getAttribute("aria-label")).toMatch(/filter/i);
  });

  test("the Changes page keeps its place while another page shows, each time", async () => {
    await page.viewport(1280, 800);
    const paths = [0, 1, 2].map((index) => `src/long${index}.ts`);
    const patch = paths
      .map(
        (path, index) =>
          `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,140 +1,140 @@\n` +
          Array.from(
            { length: 140 },
            (_, line) => `-const value${line} = -1;\n+const value${line} = ${index};\n`,
          ).join(""),
      )
      .join("");
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ review: { paths, patch }, commitApi: repository.api });
    const stream = page.getByRole("main", { name: "Continuous review" });
    const scroller = () =>
      [stream.element(), ...stream.element().querySelectorAll<HTMLElement>("*")].find(
        (node) => getComputedStyle(node).overflowY === "auto" && node.scrollHeight > 2000,
      );
    await expect.poll(() => scroller()?.scrollHeight ?? 0).toBeGreaterThan(2000);
    await stream.wheel({ delta: { y: 1500 } });
    await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(1000);
    // Settled: the place the page keeps is the last one it reported.
    await new Promise((done) => setTimeout(done, 200));
    const top = scroller()!.scrollTop;
    const changes = page.getByRole("radio", { name: "Changes", exact: true });
    const commit = page.getByRole("radio", { name: "Commit", exact: true });
    for (const _ of [1, 2, 3]) {
      await commit.click();
      await expect.element(commit).toHaveAttribute("aria-checked", "true");
      await changes.click();
      await expect.poll(() => scroller()?.scrollTop).toBeCloseTo(top, 0);
    }
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
    // Each line counts, on both sides of a change: two lines are four matches.
    await page.getByRole("textbox", { name: "Find in changes" }).fill("needle");
    await expect.element(page.getByText("1 of 4", { exact: true })).toBeVisible();
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
    // The first match is in the collapsed file, which opens for it.
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("2 of 4", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("3 of 4", { exact: true })).toBeVisible();
    await centered("needleLater");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("1 of 4", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByRole("button", {
          name: "Collapse src/long0.ts",
          exact: true,
        }),
      )
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

  test("the full diff header toggles collapse while its filename opens the file", async () => {
    await mountApp();
    const toggle = page.getByRole("button", {
      name: "Collapse src/alpha.ts",
      exact: true,
    });
    await expect.element(toggle).toBeVisible();
    const bounds = toggle.element().getBoundingClientRect();
    // The far edge of the header is clickable, not just the chevron.
    await toggle.click({
      position: { x: bounds.width - 4, y: bounds.height / 2 },
    });
    const expand = page.getByRole("button", {
      name: "Expand src/alpha.ts",
      exact: true,
    });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    (expand.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    await expect.element(page.getByRole("textbox", { name: "Edit src/alpha.ts" })).toBeVisible();
    await page.getByRole("radio", { name: "Changes", exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("gd uses ctags to jump to a declaration in the current file", async () => {
    await mountApp();
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", {
      name: "Edit src/alpha.ts",
      exact: true,
    });
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
});
