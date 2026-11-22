import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { Comparison } from "../../src/shared/protocol";
import { createFakeRepository } from "../../src/web/components/elements/commit-fixture";
import {
  chooseLayout,
  firstCommit,
  mount,
  mountApp,
  patch,
  prepareWindow,
  root,
  secondCommit,
  unmountApp,
} from "./app-fixture";

beforeEach(prepareWindow);
afterEach(unmountApp);

describe("graphical review", () => {
  test("dismisses selected lines with the draft and moves an open composer to a new range", async () => {
    await page.viewport(1280, 800);
    await mountApp();
    await chooseLayout("Split");
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
      .element(
        page.getByRole("form", {
          name: "Local comment on line R2",
          exact: true,
        }),
      )
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
    await chooseLayout("Split");
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
    await chooseLayout("Split");
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
    // The composer opens below the last selected line, as the saved note shows.
    const slot = (element: Element) => element.closest("[slot]")?.getAttribute("slot");
    const composer = page.getByRole("textbox", { name: "Review note text" });
    await expect.poll(() => slot(composer.element())).toBe("annotation-additions-2");
    await composer.fill("Both lines");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect
      .poll(() => controller.getSnapshot().notes?.notes[0])
      .toMatchObject({ line: 1, endLine: 2, side: "new", text: "Both lines" });
    await expect
      .poll(() => {
        const card = [...document.querySelectorAll("[slot] *")].find(
          (element) => element.textContent === "Both lines",
        );
        return card && slot(card);
      })
      .toBe("annotation-additions-2");
  });

  test("dragging the gutter plus opens a note for the full range", async () => {
    await page.viewport(1280, 800);
    const { controller } = await mountApp();
    await chooseLayout("Split");
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
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
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
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
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
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
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
    await page.getByRole("textbox", { name: "Find in changes" }).fill("after");
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

  test("opens a standalone patch without exposing Git controls", async () => {
    const { requests } = await mountApp({ inputOnly: true });
    expect(requests).toEqual([{ kind: "patch", path: "/test/change.patch" }]);
    await expect
      .element(page.getByRole("region", { name: "Commit history" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("combobox", { name: "Worktree" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Display" })).toBeVisible();
    await expect
      .poll(() => document.querySelector("[data-file-count]")?.getAttribute("data-file-count"))
      .toBe("2");
    // Display has a row for each choice: the layout and the theme are icons.
    const address = location.href;
    await page.getByRole("button", { name: "Display" }).click();
    const display = page.getByRole("dialog", { name: "Display" });
    await expect
      .element(
        display
          .getByRole("radiogroup", { name: "Diff layout" })
          .getByRole("radio", { name: "Unified" }),
      )
      .toBeVisible();
    const themes = display.getByRole("radiogroup", { name: "Theme" });
    await themes.getByRole("radio", { name: "Dark" }).click();
    await expect.poll(() => document.documentElement.dataset.appearance).toBe("dark");
    await themes.getByRole("radio", { name: "Light" }).click();
    await expect.poll(() => document.documentElement.dataset.appearance).toBe("light");
    await expect.element(themes.getByRole("radio", { name: "Light" })).toBeChecked();
    await themes.getByRole("radio", { name: "Auto" }).click();
    await expect.element(themes.getByRole("radio", { name: "Auto" })).toBeChecked();
    // Display ends with the way to every code setting.
    await page
      .getByRole("dialog", { name: "Display" })
      .getByRole("button", { name: "All code settings" })
      .click();
    expect(location.pathname).toBe("/settings/code");
    await expect.element(page.getByRole("dialog", { name: "Display" })).not.toBeInTheDocument();
    history.replaceState(null, "", address);
    // ⌘K opens Settings at each section.
    await userEvent.keyboard("{Meta>}k{/Meta}");
    await page.getByRole("combobox", { name: "Search commands" }).fill("Settings: Open in");
    await page.getByRole("option", { name: /^Settings: Open in/ }).click();
    expect(location.pathname).toBe("/settings/open-in");
    history.replaceState(null, "", address);
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

  test("ends the stream with its count of changed files, in every comparison", async () => {
    // A metadata-only file comes last in the stream, and the end still follows it.
    const { controller } = await mountApp({ metadataFile: true, branches: true });
    const end = () =>
      [...document.querySelectorAll("[data-stream-end]")].find(
        (node) => node.getClientRects().length,
      )?.textContent;
    await expect.poll(end).toBe("3 changed files");
    expect(
      document
        .querySelector("[data-stream-end]")
        ?.compareDocumentPosition(
          document.querySelector('[data-metadata-file="assets/model.bin"]')!,
        ),
    ).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    // Branch changes, staged and unstaged changes, a commit, and a range end
    // the same way: none of them is a review.
    for (const comparison of [
      { kind: "working", base: "main" },
      { kind: "staged" },
      { kind: "unstaged" },
      { kind: "commit", commit: secondCommit },
      { kind: "range", base: secondCommit, head: firstCommit },
    ] satisfies Comparison[]) {
      await controller.selectComparison(comparison);
      await expect.poll(() => controller.getSnapshot().comparison).toEqual(comparison);
      await expect.poll(end).toBe("3 changed files");
    }
    // A filter that hides files says how many the stream shows.
    controller.setFilter("alpha");
    await expect.poll(end).toBe("1 of 3 changed files");
    controller.setFilter("");
    await expect.poll(end).toBe("3 changed files");
  });

  test("a saved review's files mark viewed: each folds, the mark fills, and the end says when all are", async () => {
    localStorage.removeItem("med:viewed:v1");
    await mountApp({ savedReview: true });
    const shown = <T extends Element>(selector: string) =>
      [...document.querySelectorAll<T>(selector)].filter((node) => node.getClientRects().length);
    const end = () => shown("[data-stream-end]")[0]?.textContent;
    const meter = () => shown("[data-viewed-meter]")[0]?.getAttribute("aria-label");
    await expect.poll(end).toBe("2 changed files");
    await expect.poll(meter).toBe("0 of 2 files viewed");
    expect(shown("[data-viewed-count]")).toHaveLength(0);
    // The first file: it folds to its header, and the row counts it.
    const alpha = page.getByRole("button", { name: "Viewed src/alpha.ts" });
    await alpha.click();
    await expect.element(alpha).toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("button", { name: "Expand src/alpha.ts" }))
      .toBeInTheDocument();
    await expect.poll(meter).toBe("1 of 2 files viewed");
    await expect.poll(() => shown("[data-viewed-count]")[0]?.textContent).toBe("1 of 2 viewed");
    await expect.poll(end).toBe("2 changed files");
    // The last one: the mark is whole, and the end says so.
    await page.getByRole("button", { name: "Viewed src/beta.ts" }).click();
    await expect.poll(meter).toBe("All 2 files viewed");
    await expect.poll(end).toBe("All 2 files viewed");
    // The mark off again opens the file.
    await alpha.click();
    await expect.element(alpha).toHaveAttribute("aria-pressed", "false");
    await expect
      .element(page.getByRole("button", { name: "Collapse src/alpha.ts" }))
      .toBeInTheDocument();
    await expect.poll(meter).toBe("1 of 2 files viewed");
    // The marks outlast the page: the review opens with its viewed file folded.
    root?.unmount();
    mount?.remove();
    await mountApp({ savedReview: true });
    await expect.poll(meter).toBe("1 of 2 files viewed");
    await expect
      .element(page.getByRole("button", { name: "Expand src/beta.ts" }))
      .toBeInTheDocument();
    localStorage.removeItem("med:viewed:v1");
  });

  test("changes that are not a saved review have no Viewed marks", async () => {
    await mountApp();
    await expect
      .poll(
        () =>
          [...document.querySelectorAll("[data-stream-end]")].find(
            (node) => node.getClientRects().length,
          )?.textContent,
      )
      .toBe("2 changed files");
    expect(document.querySelector("[data-viewed]")).toBeNull();
    expect(document.querySelector("[data-viewed-meter]")).toBeNull();
  });

  test("ends a saved review's stream, and a one-file change, with the same words", async () => {
    await mountApp({ savedReview: true });
    const end = () =>
      [...document.querySelectorAll("[data-stream-end]")].find(
        (node) => node.getClientRects().length,
      )?.textContent;
    await expect.poll(end).toBe("2 changed files");
    root?.unmount();
    mount?.remove();
    await mountApp({
      review: {
        paths: ["src/alpha.ts"],
        patch: patch.slice(0, patch.indexOf("diff --git a/src/beta.ts")),
      },
    });
    await expect.poll(end).toBe("1 changed file");
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
      .element(
        page.getByText("Source changed since this note was written.", {
          exact: true,
        }),
      )
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

  test("q goes to the Commit tab from a file's Vim Normal and Visual modes, and types in Insert", async () => {
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    const fileTab = page.getByRole("tab", { name: "alpha.ts", exact: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const editor = page.getByRole("textbox", { name: "Edit src/alpha.ts", exact: true });
    await expect.element(editor).toBeVisible();
    await editor.click();
    // Insert mode types the letter; the file has none before.
    expect(editor.element().textContent).not.toContain("q");
    await userEvent.keyboard("iq{Escape}");
    await expect.poll(() => editor.element().textContent).toContain("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "false");
    // Normal mode: q goes to Commit, not into a macro.
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    // q goes back to the file, and from Visual mode to Commit again.
    await userEvent.keyboard("q");
    await expect.element(fileTab).toHaveAttribute("aria-selected", "true");
    await editor.click();
    await userEvent.keyboard("V");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
  });

  test("q goes to the Commit tab from the read-only file view, unless a motion waits for a letter", async () => {
    const repository = createFakeRepository({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api, readOnly: true });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    await page.getByRole("link", { name: "src/alpha.ts", exact: true }).click();
    const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
    await expect.poll(() => document.activeElement).toBe(pane.element());
    // `f` takes the q as the letter to find.
    await userEvent.keyboard("fq");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "false");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    // In Visual mode too.
    await userEvent.keyboard("q");
    await expect.poll(() => document.activeElement).toBe(pane.element());
    await userEvent.keyboard("v");
    await userEvent.keyboard("q");
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
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
      .element(page.getByRole("radio", { name: "Commit", exact: true }))
      .toHaveAttribute("aria-checked", "true");
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
    repository.configure({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: true,
    });
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"), { timeout: 400 })
      .toHaveAccessibleName("docs/USAGE.md, staged, modified");
    await expect
      .element(stream.getByRole("button", { name: "Unstage docs/USAGE.md" }), {
        timeout: 400,
      })
      .toBeVisible();
    repository.configure({
      upstream: false,
      hookFails: true,
      pushRejected: false,
      slow: false,
    });
    await userEvent.keyboard("j");
    await expect
      .element(row("scripts/obsolete-check.mjs"))
      .toHaveAttribute("aria-selected", "true");

    // c opens the message in a dialog: a summary, and Enter goes on to the
    // description. A failed hook keeps the message and shows its output there.
    await expect
      .element(page.getByRole("textbox", { name: "Commit summary" }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("c");
    const summary = page.getByRole("textbox", { name: "Commit summary" });
    const description = page.getByRole("textbox", { name: "Commit description" });
    await expect.element(summary).toHaveFocus();
    await userEvent.keyboard("docs: explain the Commit tab");
    await userEvent.keyboard("{Enter}");
    await expect.element(description).toHaveFocus();
    await userEvent.keyboard("It lists what each key does.");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    await expect
      .element(page.getByRole("alert").filter({ hasText: "lint-staged" }))
      .toMatchTextContent("Missing semicolon");
    await expect.element(summary).toHaveValue("docs: explain the Commit tab");
    await expect.element(description).toHaveValue("It lists what each key does.");
    repository.configure({
      upstream: false,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
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
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");

    // As in Changes, a file name in the stream opens the file (Command-click
    // behind this tab), and o opens the focused file.
    await userEvent.keyboard("q");
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    const commitPage = page.getByRole("radio", { name: "Commit", exact: true });
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    stream
      .getByRole("link", {
        name: "src/web/components/CommitView.tsx",
        exact: true,
      })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    // It opens behind this page: Commit stays, and the file waits on Files.
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    await row("src/web/App.tsx").click();
    await userEvent.keyboard("o");
    await expect.element(tab("App.tsx")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("CommitView.tsx")).toBeVisible();
    // Closing the file goes back to Commit, and q leaves Commit for the tab
    // that showed before it, by the same rule.
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "∑", code: "KeyW", altKey: true, bubbles: true }),
    );
    await expect.element(tab("App.tsx")).not.toBeInTheDocument();
    await expect.element(commitPage).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("q");
    await expect
      .element(page.getByRole("radio", { name: "Changes", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });

  test("Enter goes into a file's hunks, where Space stages one, and d discards a hunk or a file after asking", async () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith("med:commit-message:")) localStorage.removeItem(key);
    const repository = createFakeRepository({
      upstream: true,
      hookFails: false,
      pushRejected: false,
      slow: false,
    });
    await mountApp({ commitApi: repository.api });
    await userEvent.keyboard("q");
    const files = page.getByRole("listbox", { name: "Changed files" });
    await expect.element(files).toHaveFocus();
    const row = (path: string) => files.getByRole("option", { name: new RegExp(`^${path}, `) });
    const usage = { path: "docs/USAGE.md", staged: null, unstaged: "modified" } as const;
    const halves = () => repository.api.changes(usage);
    const place = (text: string) => page.getByText(text, { exact: true });
    // The confirmation's answer keys wait 400 ms after it opens.
    const read = () => new Promise((resolve) => setTimeout(resolve, 450));

    // docs/USAGE.md has two hunks, neither staged. Enter goes into them, and
    // the focused hunk's keys show under it.
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");
    await userEvent.keyboard("{Enter}");
    await expect.element(place("Hunk 1 of 2, not staged")).toBeVisible();
    const stream = page.getByRole("region", { name: "Changes to commit" });
    await expect.element(stream.getByRole("toolbar", { name: "Hunk" })).toBeVisible();

    // Space stages the first hunk alone, and the next one takes the focus.
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, partly staged, modified");
    await expect.element(place("Hunk 2 of 2, not staged")).toBeVisible();
    let { staged, unstaged } = await halves();
    expect(staged).toContain("+Med reads the working files. The Commit tab stages");
    expect(staged).not.toContain("+## Commit");
    expect(unstaged).toContain("+## Commit");
    // k goes back to the staged hunk, and Space unstages it.
    await userEvent.keyboard("k");
    await expect.element(place("Hunk 1 of 2, staged")).toBeVisible();
    await userEvent.keyboard(" ");
    await expect
      .element(row("docs/USAGE.md"))
      .toHaveAccessibleName("docs/USAGE.md, not staged, modified");
    await expect.element(place("Hunk 1 of 2, not staged")).toBeVisible();

    // d asks first and names the hunk; Cancel has the focus, and Esc keeps it.
    await userEvent.keyboard("d");
    const ask = page.getByRole("dialog", { name: "Discard this hunk?" });
    await expect
      .element(ask)
      .toMatchTextContent(
        /docs\/USAGE\.md, the hunk at line 20 \(\+1 −1\): its lines go back to the last commit\.You cannot undo this\./,
      );
    await expect.element(ask.getByRole("button", { name: /^Cancel/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(ask).not.toBeInTheDocument();
    expect((await halves()).unstaged).toContain("+Med reads the working files.");
    // A quick "dd" only asks. d in the confirmation discards the hunk once
    // the confirmation has had a moment to be read; the other hunk stays.
    await userEvent.keyboard("dd");
    await expect.element(ask).toBeVisible();
    expect((await halves()).unstaged).toContain("+Med reads the working files.");
    await read();
    await userEvent.keyboard("d");
    await expect
      .element(page.getByRole("status").filter({ hasText: "Discarded a hunk of docs/USAGE.md" }))
      .toBeVisible();
    ({ unstaged } = await halves());
    expect(unstaged).not.toContain("+Med reads the working files.");
    expect(unstaged).toContain("+## Commit");
    await expect.element(place("Hunk 1 of 1, not staged")).toBeVisible();
    await expect.element(ask).not.toBeInTheDocument();

    // Esc goes back to the files. A file that Git does not track: d asks to
    // delete it, and Enter on Cancel keeps it.
    await userEvent.keyboard("{Escape}");
    await expect.element(place("3 of 5 staged")).toBeVisible();
    await userEvent.keyboard("jjjj");
    await expect
      .element(row("src/web/components/CommitView.tsx"))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("d");
    const remove = page.getByRole("dialog", {
      name: "Delete src/web/components/CommitView.tsx?",
    });
    await expect
      .element(remove)
      .toMatchTextContent(
        /Git does not track this file, so Med deletes it\.You cannot undo this\./,
      );
    await userEvent.keyboard("{Enter}");
    await expect.element(remove).not.toBeInTheDocument();
    await expect.element(files).toHaveFocus();
    await expect.element(row("src/web/components/CommitView.tsx")).toBeVisible();
    // Tab goes to Delete file.
    await userEvent.keyboard("d");
    await expect.element(remove).toBeVisible();
    await userEvent.keyboard("{Tab}");
    await expect.element(remove.getByRole("button", { name: /^Delete file/ })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(row("src/web/components/CommitView.tsx")).not.toBeInTheDocument();
    await expect.element(remove).not.toBeInTheDocument();

    // The focus stays at the deleted file's place: the last file now. A partly
    // staged file offers to keep its staged changes, and says that the other
    // choice takes them.
    await expect.element(row("src/web/App.tsx")).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("d");
    const partial = page.getByRole("dialog", { name: "Discard changes to src/web/App.tsx?" });
    await expect
      .element(partial)
      .toMatchTextContent(
        "It has staged and unstaged changes.Unstaged only: the file goes back to its staged version.Discard all: the staged changes go too, and the file goes back to the last commit.You cannot undo this.",
      );
    await read();
    await userEvent.keyboard("u");
    await expect.element(partial).not.toBeInTheDocument();
    await expect
      .element(row("src/web/App.tsx"))
      .toHaveAccessibleName("src/web/App.tsx, staged, modified");

    // ? shows the Commit tab's keys.
    await userEvent.keyboard("?");
    const guide = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect.element(guide.getByRole("tab", { name: /Commit/, selected: true })).toBeVisible();
    await expect.element(guide.getByText("Go into the file's hunks")).toBeVisible();
  });
});
