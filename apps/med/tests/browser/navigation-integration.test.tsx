import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../src/web/App";
import { createReviewController } from "../../src/web/data/controller";
import { createBrowseApi } from "../../src/web/data/browse";
import { initializeTheme } from "../../src/web/themes";
import "../../src/web/reset.css";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  localStorage.removeItem("med:vim");
});
async function mountFile(
  vim = false,
  beforeRead?: () => Promise<void>,
  syntaxSource?: () => string,
  onWrite?: (text: string, identity: string) => void,
) {
  localStorage.setItem("med:vim", vim ? "on" : "off");
  initializeTheme();
  await page.viewport(1200, 800);
  const head = "a".repeat(40);
  const text = Array.from(
    { length: 100 },
    (_, i) => `export const example${i + 1} = ${i + 1};`,
  ).join("\n");
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/session")
      return Response.json({
        protocol: 1,
        repository: {
          path: "/test/repo",
          name: "navigation-fixture",
          head,
          branch: "main",
          shallow: false,
          git: true,
        },
        worktrees: [{ path: "/test/repo", head, branch: "main" }],
      });
    if (url.pathname === "/api/branches") return Response.json([]);
    if (url.pathname === "/api/history")
      return Response.json({ commits: [], cursor: null, hasMore: false });
    if (url.pathname === "/api/review") {
      const { comparison } = JSON.parse(String(init?.body));
      return Response.json({
        id: "b".repeat(64),
        repo: "/test/repo",
        comparison,
        base: head,
        head: "working",
        label: "Working changes",
        files: [{ path: "main.ts", status: "M", additions: 1, deletions: 1, binary: false }],
        patch:
          "diff --git a/main.ts b/main.ts\nindex 1111111..2222222 100644\n--- a/main.ts\n+++ b/main.ts\n@@ -1 +1 @@\n-export const old = 1;\n+export const example1 = 1;\n",
        warnings: [],
        metrics: { gitMs: 1, totalMs: 2, patchBytes: 200, cacheHit: false },
      });
    }
    if (url.pathname === "/api/notes")
      return Response.json({ reviewId: url.searchParams.get("reviewId"), revision: 0, notes: [] });
    if (url.pathname === "/api/browse/write") {
      const { source, path, expectedIdentity, text } = JSON.parse(String(init?.body));
      try {
        onWrite?.(text, expectedIdentity);
      } catch {
        return Response.json(
          { error: { code: "file-changed", message: "File changed on disk. Your draft is kept." } },
          { status: 409 },
        );
      }
      return Response.json({ source, path, identity: text, text, size: text.length, kind: "text" });
    }
    if (url.pathname === "/api/browse/read") {
      await beforeRead?.();
      const { source, path } = JSON.parse(String(init?.body));
      const contents = syntaxSource?.() ?? text;
      return Response.json({
        source,
        path,
        identity: contents,
        kind: "text",
        text: contents,
        size: contents.length,
        plain: !syntaxSource,
      });
    }
    if (url.pathname === "/api/browse/symbols") {
      const { source, path, identity, query } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        path,
        identity,
        query,
        engine: "ctags",
        truncated: false,
        matches: [10, 80].map((line) => ({
          path: "main.ts",
          line,
          column: 14,
          name: `example${line}`,
          kind: "constant",
        })),
      });
    }
    if (url.pathname === "/api/browse/list") {
      const { source } = JSON.parse(String(init?.body));
      return Response.json({
        source,
        entries: [{ path: "main.ts", kind: "file" }],
        truncated: false,
      });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const controller = createReviewController({ fetch: fetcher, events: false });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const browse = createBrowseApi(fetcher, "fixture");
  const app = (
    <App
      controller={controller}
      browseApi={{ ...browse, write: onWrite ? browse.write : undefined }}
    />
  );
  root.render(
    syntaxSource ? (
      <WorkerPoolContextProvider
        highlighterOptions={{ theme: "github-dark" }}
        poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      >
        {app}
      </WorkerPoolContextProvider>
    ) : (
      app
    ),
  );
  await expect
    .poll(() => document.querySelector("[data-review-status]")?.getAttribute("data-review-status"))
    .toBe("ready");
  await page.getByRole("treeitem", { name: /main.ts/ }).dblClick();
  await expect
    .element(
      page.getByRole("textbox", {
        name: onWrite ? "Edit main.ts" : vim ? "File navigation" : "File content",
      }),
    )
    .toBeVisible();
}
function shortcut(key: string, shiftKey = false) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, metaKey: true, shiftKey, bubbles: true, cancelable: true }),
  );
}
function focusedKey(key: string) {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}
async function command(name: string) {
  shortcut("k");
  await page.getByRole("combobox", { name: "Search commands" }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${name} gg$`) }).click();
}

test("Vim focus owns question mark while the rest of the app keeps the command guide", async () => {
  await mountFile(true);
  const pane = page.getByRole("textbox", { name: "File navigation" }).element() as HTMLElement;
  pane.focus();
  focusedKey("?");
  await expect.element(page.getByRole("textbox", { name: "Search in file" })).toBeVisible();
  await expect
    .poll(() => document.activeElement)
    .toBe(page.getByRole("textbox", { name: "Search in file" }).element());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(pane);
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true }),
  );
  await expect.element(page.getByRole("dialog", { name: "Shortcuts & commands" })).toBeVisible();
});

test("Find works with Vim disabled and a palette command moves after the modal closes", async () => {
  await mountFile();
  shortcut("f");
  const search = page.getByRole("textbox", { name: "Search in file" });
  await expect.element(search).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(search.element());
  await search.fill("example80");
  await userEvent.keyboard("{Enter}");
  const pane = page.getByRole("textbox", { name: "File content" });
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await command("Start of file");
  const vimPane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(vimPane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => document.activeElement).toBe(vimPane.element());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(localStorage.getItem("med:vim")).toBe("on");
});

test("symbol palette previews in the current file and Escape restores cursor and scroll", async () => {
  await mountFile(true);
  const pane = page.getByRole("textbox", {
    name: "File navigation",
    exact: true,
    includeHidden: true,
  });
  (pane.element() as HTMLElement).focus();
  focusedKey("7");
  focusedKey("2");
  focusedKey("G");
  await expect.element(pane).toHaveAttribute("data-vim-line", "72");
  const scroller = [...pane.element().querySelectorAll("div")].find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
  const scrollTop = scroller.scrollTop;
  shortcut("o");
  await expect.element(page.getByRole("option", { name: /example80/ })).toBeVisible();
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  expect(document.querySelector('[aria-label="Symbol preview"]')).toBeNull();
  expect(document.querySelectorAll('[data-file-pane="main"]')).toHaveLength(1);
  expect(
    [...CSS.highlights.values()]
      .flatMap((highlight) => [...highlight])
      .some((range) => range.toString() === "example80"),
  ).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "Find symbol" })).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "72");
  await expect.poll(() => scroller.scrollTop).toBe(scrollTop);
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("''");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("72G");
  shortcut("o");
  await expect
    .element(page.getByRole("option", { name: /example80/ }))
    .toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}''");
  await expect.element(pane).toHaveAttribute("data-vim-line", "72");
});

test("opening files focuses Vim and a diff filename opens the full file", async () => {
  await mountFile(true);
  const pane = page.getByRole("textbox", {
    name: "File navigation",
    exact: true,
    includeHidden: true,
  });
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.getByRole("link", { name: "main.ts", exact: true }).click();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  shortcut("k", true);
  const input = page.getByRole("combobox", { name: "Find file" });
  await input.fill("main");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.activeElement).toBe(pane.element());
  shortcut("k", true);
  await expect.element(input).toHaveValue("main");
  await expect.poll(() => (input.element() as HTMLInputElement).selectionEnd).toBe(4);
  await expect.poll(() => (input.element() as HTMLInputElement).selectionStart).toBe(0);
  await userEvent.keyboard("{ArrowRight}.ts");
  await expect.element(input).toHaveValue("main.ts");
  await userEvent.keyboard("{Escape}");
  shortcut("k", true);
  await expect.element(input).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(input.element());
  await userEvent.keyboard("x");
  await expect.element(input).toHaveValue("x");
});

test("file symbols retain a selected query and Enter accepts without reloading the file", async () => {
  await mountFile(true);
  const pane = page.getByRole("textbox", {
    name: "File navigation",
    exact: true,
    includeHidden: true,
  });
  shortcut("o");
  const input = page.getByRole("combobox", { name: "Find symbol in file" });
  await input.fill("example80");
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "81");
  shortcut("o");
  await expect.element(input).toHaveValue("example80");
  await expect.poll(() => (input.element() as HTMLInputElement).selectionEnd).toBe(9);
  await expect.poll(() => (input.element() as HTMLInputElement).selectionStart).toBe(0);
  await userEvent.keyboard("missing");
  await expect.element(input).toHaveValue("missing");
  await userEvent.keyboard("{Escape}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "81");
});

test("opening a file shows the selected path before the read completes", async () => {
  let complete = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const opened = mountFile(true, () => pending);
  const region = page.getByRole("region", { name: "Full file", exact: true });
  await expect.element(region).toHaveAttribute("aria-busy", "true");
  await expect.element(page.getByTitle("main.ts", { exact: true })).toBeVisible();
  expect(region.element().textContent).not.toContain("File preview");
  const status = page.getByText("NORMAL · Read-only navigation", { exact: true });
  const before = status.element().getBoundingClientRect().top;
  complete();
  await opened;
  await expect.element(region).toHaveAttribute("aria-busy", "false");
  await expect.element(page.getByTitle("main.ts", { exact: true })).toBeVisible();
  expect(Math.abs(status.element().getBoundingClientRect().top - before)).toBeLessThan(1);
  await expect.poll(() => document.activeElement?.getAttribute("data-file-pane")).toBe("main");
});

test("Go to line is available from the command palette and focuses its prompt", async () => {
  await mountFile();
  shortcut("k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("Go to line in file");
  await page.getByRole("option", { name: "Go to line in file :", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Go to line", exact: true });
  await expect.element(input).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(input.element());
  await input.fill("80");
  await userEvent.keyboard("{Enter}");
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await expect.poll(() => document.activeElement).toBe(pane.element());
});

test("reopening a highlighted working file shows its current contents", async () => {
  let source = "export const original = 42;";
  await mountFile(false, undefined, () => source);
  const tokens = () =>
    Array.from(
      document.querySelector('[data-file-pane="main"]')?.querySelectorAll("diffs-container") ?? [],
    ).flatMap((node) =>
      Array.from(node.shadowRoot?.querySelectorAll("[data-line] span[style]") ?? []),
    );
  await expect
    .poll(() =>
      tokens()
        .map((token) => token.textContent)
        .join(""),
    )
    .toBe(source);
  await expect
    .poll(() => new Set(tokens().map((token) => getComputedStyle(token).color)).size)
    .toBeGreaterThan(2);
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  source = 'export const revised = "fresh";';
  await page.getByRole("tab", { name: "main.ts", exact: true }).click();
  await expect
    .poll(() =>
      tokens()
        .map((token) => token.textContent)
        .join(""),
    )
    .toBe(source);
  await expect
    .poll(() => new Set(tokens().map((token) => getComputedStyle(token).color)).size)
    .toBeGreaterThan(2);
});

test("Vim edits, undo, retained drafts, and :w use the production file API", async () => {
  let source = "const count = 1;\r\n";
  await mountFile(
    true,
    undefined,
    () => source,
    (text, identity) => {
      expect(identity).toBe(source);
      source = text;
    },
  );
  const editor = page.getByRole("textbox", { name: "Edit main.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwtotal{Escape}");
  await expect.element(editor).toHaveTextContent("const total = 1;");
  await expect
    .element(page.getByRole("img", { name: "Unsaved changes", exact: true }))
    .toBeVisible();
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  await page.getByRole("tab", { name: /main.ts/ }).click();
  await expect.element(editor).toHaveTextContent("const total = 1;");
  await userEvent.keyboard("u");
  await expect.element(editor).toHaveTextContent("const count = 1;");
  await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}r{/Control}");
  await expect.element(editor).toHaveTextContent("const total = 1;");
  await userEvent.keyboard(":w{Enter}");
  await expect.poll(() => source).toBe("const total = 1;\r\n");
  await expect.element(page.getByRole("img", { name: "Saved", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await expect.element(editor).not.toBeInTheDocument();
  await page.getByRole("treeitem", { name: /main.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("const total = 1;");
});

test("a conflicting save keeps the draft until explicit discard", async () => {
  let source = "const count = 1;";
  await mountFile(
    false,
    undefined,
    () => source,
    (text, identity) => {
      if (identity !== source) throw new Error("conflict");
      source = text;
    },
  );
  const editor = page.getByRole("textbox", { name: "Edit main.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("wciwdraft{Escape}");
  source = "const agent = 2;";
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("File changed on disk. Your draft is kept.");
  await expect.element(editor).toHaveTextContent("const draft = 1;");
  expect(source).toBe("const agent = 2;");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect.element(editor).toHaveTextContent("const draft = 1;");
  await page.getByRole("button", { name: "Close file", exact: true }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect.element(editor).not.toBeInTheDocument();
  await page.getByRole("treeitem", { name: /main.ts/ }).dblClick();
  await expect.element(editor).toHaveTextContent("const agent = 2;");
});

test("files start in Normal mode and a clean reopen uses fresh contents", async () => {
  let source = "const count = 1;";
  await mountFile(
    true,
    undefined,
    () => source,
    () => {},
  );
  await userEvent.keyboard("wi");
  const editor = page.getByRole("textbox", { name: "Edit main.ts", exact: true });
  await expect.element(editor).toBeVisible();
  await userEvent.keyboard("fresh{Escape}");
  await expect.element(editor).toHaveTextContent("const freshcount = 1;");
  await userEvent.keyboard("u");
  await expect.element(editor).toHaveTextContent("const count = 1;");
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  source = "const external = 2;";
  await page.getByRole("tab", { name: "main.ts", exact: true }).click();
  await expect.element(editor).toHaveTextContent(source);
});
