import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FilePicker,
  findFiles,
  parseFileQuery,
  type FilePickerProps,
} from "../../src/web/components/FilePicker";
import { RepositoryFiles } from "../../src/web/components/RepositoryFiles";
import { useBrowseFiles, type BrowseApi } from "../../src/web/data/browse";
import type { BrowseSearch } from "../../src/shared/inspect";
import type { BrowseEntry, BrowseList, BrowseSource } from "../../src/shared/browse";
import type { RegisteredRepository } from "../../src/shared/protocol";
import "../../src/web/reset.css";

beforeEach(async () => {
  await page.viewport(1200, 800);
});

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
});
function render(element: React.ReactNode) {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(element);
}
const entries: BrowseEntry[] = [
  { path: "src/main.ts", kind: "file" },
  { path: "src/menu.ts", kind: "file" },
  { path: "assets/logo.png", kind: "file" },
];

test("picker ranks filenames, bounds results, and parses file:line", () => {
  expect(findFiles(entries, "smt").map((entry) => entry.path)).toEqual([
    "src/main.ts",
    "src/menu.ts",
  ]);
  expect(
    findFiles([{ path: "main.ts/index.ts", kind: "file" }, ...entries], "main.ts")[0]?.path,
  ).toBe("src/main.ts");
  expect(
    findFiles(
      Array.from({ length: 100 }, (_, i) => ({ path: `${i}.ts`, kind: "file" })),
      "",
    ),
  ).toHaveLength(50);
  expect(parseFileQuery("main.ts:42:8")).toEqual({ text: "main.ts", line: 42 });
});

test("picker opens only a scoped result with an optional line", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="feature/auth · Working files"
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  await page.getByRole("combobox", { name: "Find file" }).fill("main.ts:42");
  await expect.element(page.getByRole("option", { name: "main.ts src" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/main.ts", 42]]);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("repository scopes show and match relative names but open the absolute worktree", async () => {
  const home = "/Users/alice";
  const worktree = `${home}/workbench/.claude/worktrees/keen`;
  const repositories: RegisteredRepository[] = [
    {
      id: "workbench",
      name: "workbench",
      path: `${home}/workbench`,
      branches: [],
      worktrees: [
        { path: `${home}/workbench`, head: "a".repeat(40), branch: "main" },
        { path: worktree, head: "b".repeat(40), branch: "claude/keen" },
      ],
    },
  ];
  const api: BrowseApi = {
    list: async (source) => ({
      source,
      entries: [{ path: "src/keen.ts", kind: "file" }],
      truncated: false,
    }),
    read: async (source, path) => ({ source, path, kind: "binary", size: 1, identity: path }),
  };
  const onOpen = vi.fn<FilePickerProps["onOpen"]>();
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <FilePicker
        repositories={repositories}
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Working files · main"
        source={{ kind: "worktree", repo: `${home}/workbench` }}
        api={api}
        onOpen={onOpen}
      />
    );
  }
  // Text, tooltips, and accessible names all reach screenshots or screen readers.
  const shown = () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    return [
      dialog.textContent,
      ...[...dialog.querySelectorAll("[title], [aria-label]")].flatMap((node) => [
        node.getAttribute("title"),
        node.getAttribute("aria-label"),
      ]),
    ].join("\n");
  };
  render(<Harness />);
  const input = page.getByRole("combobox", { name: "Find file" });
  await input.fill("alice");
  await expect.element(page.getByText("No matching files.")).toBeVisible();
  await input.fill("keen");
  await expect
    .element(page.getByRole("option", { name: "Repository workbench · .claude/worktrees/keen" }))
    .toBeVisible();
  await expect
    .element(page.getByLabelText("File preview").getByText(".claude/worktrees/keen"))
    .toBeVisible();
  expect(shown()).not.toContain(home);
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("option", { name: "keen.ts src" })).toBeVisible();
  await expect
    .element(page.getByText("Working files · workbench · .claude/worktrees/keen"))
    .toBeVisible();
  expect(shown()).not.toContain(home);
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => onOpen.mock.calls)
    .toEqual([
      [
        "src/keen.ts",
        undefined,
        { kind: "worktree", repo: worktree },
        "Working files · workbench · .claude/worktrees/keen",
      ],
    ]);
});

test("tree click previews, double-click pins, and directory clicks do not open files", async () => {
  const onPreview = vi.fn<(path: string) => void>();
  const onPin = vi.fn<(path: string) => void>();
  render(
    <div style={{ width: 300, height: 450 }}>
      <RepositoryFiles
        entries={entries}
        loading={false}
        error={null}
        truncated={false}
        sourceLabel="main · Working files"
        selectedPath={null}
        onPreview={onPreview}
        onPin={onPin}
        ignored={false}
        onIgnoredChange={() => {}}
        onRefresh={() => {}}
        onClose={() => {}}
      />
    </div>,
  );
  await page.getByRole("treeitem", { name: "main.ts", exact: true }).click();
  await expect.poll(() => onPreview.mock.calls).toEqual([["src/main.ts"]]);
  await page.getByRole("treeitem", { name: "main.ts", exact: true }).dblClick();
  await expect.poll(() => onPin.mock.calls).toEqual([["src/main.ts"]]);
  await page.getByRole("treeitem", { name: "src", exact: true }).dblClick();
  expect(onPin).toHaveBeenCalledTimes(1);
});

test("a hidden tree retains its scroll position when shown again", async () => {
  const files: BrowseEntry[] = Array.from({ length: 2000 }, (_, i) => ({
    path: `file-${i}.ts`,
    kind: "file",
  }));
  function Harness() {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Toggle tree</button>
        <div style={{ width: 300, height: 450, display: visible ? "block" : "none" }}>
          <RepositoryFiles
            entries={files}
            loading={false}
            error={null}
            truncated={false}
            sourceLabel="Test"
            selectedPath={null}
            onPreview={() => {}}
            onPin={() => {}}
            ignored={false}
            onIgnoredChange={() => {}}
            onRefresh={() => {}}
            onClose={() => {}}
          />
        </div>
      </>
    );
  }
  render(<Harness />);
  const scroll = () =>
    document
      .querySelector("file-tree-container")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-file-tree-virtualized-scroll]");
  await expect.poll(() => scroll()?.scrollHeight ?? 0).toBeGreaterThan(1000);
  scroll()!.scrollTop = 5000;
  await expect.poll(() => scroll()?.scrollTop).toBe(5000);
  await page.getByRole("button", { name: "Toggle tree", exact: true }).click();
  await expect.poll(() => scroll()?.checkVisibility()).toBe(false);
  await page.getByRole("button", { name: "Toggle tree", exact: true }).click();
  await expect.poll(() => scroll()?.checkVisibility()).toBe(true);
  await expect.poll(() => scroll()?.scrollTop).toBe(5000);
});

test("the active source prepares its file tree before the sidebar is first opened", async () => {
  const list = vi.fn<BrowseApi["list"]>(async (source) => ({
    source,
    entries: [{ path: `${source.repo.slice(1)}.ts`, kind: "file" }],
    truncated: false,
  }));
  const api: BrowseApi = { list, read: vi.fn<BrowseApi["read"]>() };
  function Harness() {
    const [visible, setVisible] = useState(false);
    const [repo, setRepo] = useState("/first");
    const state = useBrowseFiles({ kind: "worktree", repo }, true, 0, { api });
    return (
      <>
        <button onClick={() => setVisible(!visible)}>Toggle tree</button>
        <button onClick={() => setRepo("/second")}>Switch source</button>
        <div hidden={!visible} style={{ width: 300, height: 450 }}>
          <RepositoryFiles
            {...state}
            sourceLabel={repo}
            selectedPath={null}
            onPreview={() => {}}
            onPin={() => {}}
            onIgnoredChange={state.setIgnored}
            onRefresh={state.refresh}
            onClose={() => setVisible(false)}
          />
        </div>
      </>
    );
  }
  render(<Harness />);
  const tree = () => document.querySelector("file-tree-container");
  const hasPreparedFile = (path: string) =>
    !!tree()?.shadowRoot?.querySelector(`[data-item-path="${path}"]`);
  await expect.poll(() => hasPreparedFile("first.ts")).toBe(true);
  expect(tree()!.checkVisibility()).toBe(false);
  expect(list).toHaveBeenCalledTimes(1);

  // A new branch must also prepare its tree while the sidebar stays closed.
  await page.getByRole("button", { name: "Switch source", exact: true }).click();
  await expect.poll(() => hasPreparedFile("second.ts")).toBe(true);
  expect(hasPreparedFile("first.ts")).toBe(false);
  expect(tree()!.checkVisibility()).toBe(false);
  expect(list).toHaveBeenCalledTimes(2);
  const preparedTree = tree();

  await page.getByRole("button", { name: "Toggle tree", exact: true }).click();
  await expect
    .element(page.getByRole("treeitem", { name: "second.ts", exact: true }))
    .toBeVisible();
  expect(tree()).toBe(preparedTree);
  expect(list).toHaveBeenCalledTimes(2);
  await page.getByRole("button", { name: "Toggle tree", exact: true }).click();
  await page.getByRole("button", { name: "Toggle tree", exact: true }).click();
  expect(tree()).toBe(preparedTree);
  expect(list).toHaveBeenCalledTimes(2);
});

test("file lists load on demand and a stale worktree response cannot replace the new scope", async () => {
  const requests: {
    source: BrowseSource;
    signal?: AbortSignal;
    resolve(value: BrowseList): void;
  }[] = [];
  const api: BrowseApi = {
    list: (source, _ignored, signal) =>
      new Promise((resolve) => requests.push({ source, signal, resolve })),
    read: vi.fn<BrowseApi["read"]>(),
  };
  function Harness() {
    const [enabled, setEnabled] = useState(false);
    const [repo, setRepo] = useState("/first");
    const state = useBrowseFiles({ kind: "worktree", repo }, enabled, 0, { api });
    return (
      <>
        <button onClick={() => setEnabled(true)}>Enable</button>
        <button onClick={() => setRepo("/second")}>Switch</button>
        <output>{state.entries.map((entry) => entry.path).join(",")}</output>
      </>
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("button", { name: "Enable" })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Enable" }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "Switch" }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal!.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    entries: [{ path: "second.ts", kind: "file" }],
    truncated: false,
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("second.ts");
  requests[0]!.resolve({
    source: requests[0]!.source,
    entries: [{ path: "first.ts", kind: "file" }],
    truncated: false,
  });
  await expect.element(page.getByRole("status")).toHaveTextContent("second.ts");
});

test("file-list cache survives toggles but refreshes for every source input", async () => {
  const list = vi.fn<BrowseApi["list"]>(async (source, ignored) => ({
    source,
    entries: [{ path: `${source.repo.slice(1)}${ignored ? "-ignored" : ""}.ts`, kind: "file" }],
    truncated: false,
  }));
  const api: BrowseApi = { list, read: vi.fn<BrowseApi["read"]>() };
  function Harness() {
    const [enabled, setEnabled] = useState(true);
    const [repo, setRepo] = useState("/first");
    const [revision, setRevision] = useState(0);
    const state = useBrowseFiles({ kind: "worktree", repo }, enabled, revision, { api });
    return (
      <>
        <button onClick={() => setEnabled(!enabled)}>Toggle</button>
        <button onClick={() => setRepo("/second")}>Switch</button>
        <button onClick={() => setRevision(revision + 1)}>Invalidate</button>
        <button onClick={() => state.setIgnored(!state.ignored)}>Ignored</button>
        <button onClick={state.refresh}>Refresh</button>
        <output>{state.entries.map((entry) => entry.path).join(",")}</output>
      </>
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("status")).toHaveTextContent("first.ts");
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  expect(list).toHaveBeenCalledTimes(1);
  await page.getByRole("button", { name: "Invalidate", exact: true }).click();
  await expect.poll(() => list.mock.calls.length).toBe(2);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => list.mock.calls.length).toBe(3);
  await page.getByRole("button", { name: "Ignored", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("first-ignored.ts");
  expect(list).toHaveBeenCalledTimes(4);
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  await page.getByRole("button", { name: "Invalidate", exact: true }).click();
  expect(list).toHaveBeenCalledTimes(4);
  await page.getByRole("button", { name: "Toggle", exact: true }).click();
  await expect.poll(() => list.mock.calls.length).toBe(5);
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("second-ignored.ts");
  expect(list).toHaveBeenCalledTimes(6);
});

test("Enter opens the first match after an async manifest and an empty query result", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let load = () => {};
  function Harness() {
    const [loaded, setLoaded] = useState(false);
    const [open, setOpen] = useState(true);
    useEffect(() => {
      load = () => setLoaded(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={loaded ? entries : []}
        loading={!loaded}
        error={null}
        sourceLabel="Async workspace"
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  const input = page.getByRole("combobox", { name: "Find file" });
  await input.fill("does-not-exist.ts:120");
  load();
  await expect.element(page.getByText("No matching files.")).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).not.toHaveBeenCalled();
  await input.fill("src");
  await expect.element(page.getByRole("option", { name: "main.ts src" })).toBeVisible();
  await input.fill("src/main.ts:120");
  await expect.element(page.getByRole("option", { name: "menu.ts src" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/main.ts", 120]]);
});

test("Enter preserves the option selected with arrow keys", async () => {
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  render(
    <FilePicker
      open
      onOpenChange={() => {}}
      entries={entries}
      loading={false}
      error={null}
      sourceLabel="Working files"
      onOpen={onOpen}
    />,
  );
  await page.getByRole("combobox", { name: "Find file" }).fill("src");
  await expect
    .element(page.getByRole("option", { name: "main.ts src" }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{ArrowDown}");
  await expect
    .element(page.getByRole("option", { name: "menu.ts src" }))
    .toHaveAttribute("data-highlighted");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => onOpen.mock.calls).toEqual([["src/menu.ts", undefined]]);
});

test("an externally opened deep file expands its parent folders and becomes visible", async () => {
  const onPreview = vi.fn<(path: string) => void>();
  const deepEntries: BrowseEntry[] = [
    ...entries,
    { path: "src/js/node/_http_client.ts", kind: "file" },
    { path: "src/js/web/fetch.ts", kind: "file" },
  ];
  let select = () => {};
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    useEffect(() => {
      select = () => setSelected("src/js/node/_http_client.ts");
    }, []);
    return (
      <div style={{ width: 300, height: 450 }}>
        <RepositoryFiles
          entries={deepEntries}
          loading={false}
          error={null}
          truncated={false}
          sourceLabel="Working files"
          selectedPath={selected}
          onPreview={onPreview}
          onPin={() => {}}
          ignored={false}
          onIgnoredChange={() => {}}
          onRefresh={() => {}}
          onClose={() => {}}
        />
      </div>
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("treeitem", { name: "src", exact: true })).toBeVisible();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .not.toBeInTheDocument();
  select();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("treeitem", { name: "_http_client.ts", exact: true }))
    .toHaveAttribute("aria-selected", "true");
  expect(onPreview).not.toHaveBeenCalled();
});

test("picker ranks open and recent files without introducing another workspace's paths", () => {
  expect(
    findFiles(entries, "", ["src/menu.ts", "foreign.ts"], ["assets/logo.png"]).map(
      (file) => file.path,
    ),
  ).toEqual(["src/menu.ts", "assets/logo.png", "src/main.ts"]);
  expect(findFiles(entries, "main.ts", ["src/menu.ts"])[0]?.path).toBe("src/main.ts");
});

test("preview follows selection, cancels stale reads, and Escape leaves the current tab unchanged", async () => {
  type Read = Awaited<ReturnType<BrowseApi["read"]>>;
  const requests: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(file: Read): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve) => requests.push({ source, path, signal, resolve })),
  };
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Current worktree"
        source={{ kind: "worktree", repo: "/current" }}
        api={api}
        onOpen={onOpen}
      />
    );
  }
  render(<Harness />);
  await page.getByRole("combobox", { name: "Find file" }).fill("src");
  await expect.poll(() => requests.length).toBe(1);
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal?.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    path: requests[1]!.path,
    kind: "binary",
    size: 20,
    identity: "menu",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  requests[0]!.resolve({
    source: requests[0]!.source,
    path: requests[0]!.path,
    kind: "missing",
    size: 0,
    identity: "main",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  expect(onOpen).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
  reopen();
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toHaveValue("src");
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]!.path).toBe("src/menu.ts");
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/menu.ts", undefined);
});

test("content search is scoped, previews the matching line, and resumes its last mode", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text" as const,
      size: 18,
      identity: path,
      text: "first\nneedle\nlast\n",
    })),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(async (source, query) => ({
      source,
      query,
      matches: [{ path: "src/main.ts", line: 2, text: "needle" }],
      truncated: false,
    })),
  };
  const onOpen = vi.fn<(path: string, line?: number) => void>();
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Feature worktree"
        source={{ kind: "worktree", repo: "/feature" }}
        api={api}
        onOpen={onOpen}
        resume
      />
    );
  }
  render(<Harness />);
  await page.getByRole("button", { name: "Content", exact: true }).click();
  await page.getByRole("combobox", { name: "Search file contents" }).fill("needle");
  await expect.element(page.getByRole("option", { name: "main.ts:2 src needle" })).toBeVisible();
  expect(api.search).toHaveBeenCalledWith(
    { kind: "worktree", repo: "/feature" },
    "needle",
    expect.any(AbortSignal),
  );
  await expect
    .poll(() => api.read)
    .toHaveBeenCalledWith(
      { kind: "worktree", repo: "/feature" },
      "src/main.ts",
      expect.any(AbortSignal),
    );
  await userEvent.keyboard("{Escape}");
  reopen();
  await expect
    .element(page.getByRole("combobox", { name: "Search file contents" }))
    .toHaveValue("needle");
  await expect.element(page.getByRole("option", { name: "main.ts:2 src needle" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/main.ts", 2);
});

test("committed search previews and opens the exact result commit, while Files stays in the worktree", async () => {
  const source: BrowseSource = { kind: "worktree", repo: "/feature" };
  const resultSource: BrowseSource = { kind: "commit", repo: source.repo, oid: "a".repeat(40) };
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 18,
      identity: JSON.stringify(source),
      text: "first\nneedle\nlast\n",
    })),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(async (source, query) => ({
      source,
      query,
      resultSource,
      engine: "zoekt",
      index: { state: "ready" },
      matches: [{ path: "src/main.ts", line: 2, text: "needle" }],
      truncated: false,
    })),
  };
  const onOpen = vi.fn<(path: string, line?: number, source?: BrowseSource) => void>();
  render(
    <FilePicker
      open
      onOpenChange={() => {}}
      entries={entries}
      loading={false}
      error={null}
      sourceLabel="Feature worktree"
      source={source}
      api={api}
      onOpen={onOpen}
      initialMode="content"
    />,
  );
  await page.getByRole("combobox", { name: "Search file contents" }).fill("needle");
  await expect
    .element(page.getByText("Committed files · uncommitted changes excluded · aaaaaaaa · Zoekt"))
    .toBeVisible();
  await expect
    .poll(() => api.read)
    .toHaveBeenCalledWith(resultSource, "src/main.ts", expect.any(AbortSignal));
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/main.ts", 2, resultSource);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect
    .poll(() => api.read)
    .toHaveBeenCalledWith(source, "src/main.ts", expect.any(AbortSignal));
  await page.getByRole("combobox", { name: "Find file" }).fill("main.ts");
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenLastCalledWith("src/main.ts", undefined);
});

test("the preview toggle narrows Find file and the next picker keeps the choice", async () => {
  localStorage.removeItem("med:picker-preview");
  const source: BrowseSource = { kind: "worktree", repo: "/feature" };
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 6,
      identity: path,
      text: "first\n",
    })),
  };
  const picker = (
    <FilePicker
      open
      onOpenChange={() => {}}
      entries={entries}
      loading={false}
      error={null}
      sourceLabel="Feature worktree"
      source={source}
      api={api}
      onOpen={() => {}}
    />
  );
  render(picker);
  const dialog = page.getByRole("dialog");
  await expect.element(page.getByLabelText("File preview")).toBeVisible();
  const wide = dialog.element().getBoundingClientRect().width;
  const toggle = page.getByRole("button", { name: "Show preview" });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect.element(page.getByLabelText("File preview")).not.toBeInTheDocument();
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  expect(dialog.element().getBoundingClientRect().width).toBeLessThan(wide * 0.7);
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toHaveFocus();
  const reads = vi.mocked(api.read).mock.calls.length;
  await page.getByRole("combobox", { name: "Find file" }).fill("menu");
  await expect.element(page.getByRole("option", { name: "menu.ts src" })).toBeVisible();
  expect(api.read).toHaveBeenCalledTimes(reads);

  root?.unmount();
  mount?.remove();
  render(picker);
  await expect
    .element(page.getByRole("button", { name: "Show preview" }))
    .toHaveAttribute("aria-pressed", "false");
  await expect.element(page.getByLabelText("File preview")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Show preview" }).click();
  await expect.element(page.getByLabelText("File preview")).toBeVisible();
  localStorage.removeItem("med:picker-preview");
});

test("content search retains previews, blocks stale opens, and ignores late responses", async () => {
  const source: BrowseSource = { kind: "worktree", repo: "/feature" };
  const resultSource: BrowseSource = { kind: "commit", repo: source.repo, oid: "a".repeat(40) };
  const pending = new Map<string, { signal?: AbortSignal; resolve(result: BrowseSearch): void }>();
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 6,
      identity: path,
      text: "first\n",
    })),
    // Deliberately ignore abort here to exercise the UI's late-response guard.
    search: vi.fn<NonNullable<BrowseApi["search"]>>(
      (_source, query, signal) => new Promise((resolve) => pending.set(query, { signal, resolve })),
    ),
  };
  const onOpen = vi.fn<(path: string, line?: number, source?: BrowseSource) => void>();
  const resolve = (query: string) =>
    pending.get(query)!.resolve({
      source,
      query,
      resultSource,
      engine: "zoekt",
      matches: [{ path: `src/${query}.ts`, line: 1, text: query }],
      truncated: false,
    });
  render(
    <FilePicker
      open
      onOpenChange={() => {}}
      entries={entries}
      loading={false}
      error={null}
      sourceLabel="Feature worktree"
      source={source}
      api={api}
      onOpen={onOpen}
      initialMode="content"
    />,
  );
  const input = page.getByRole("combobox", { name: "Search file contents" });
  await input.fill("first");
  await expect.poll(() => pending.has("first")).toBe(true);
  resolve("first");
  const first = page.getByRole("option", { name: "first.ts:1 src first" });
  await expect.element(first).toBeVisible();
  await expect
    .poll(() => api.read)
    .toHaveBeenCalledWith(resultSource, "src/first.ts", expect.any(AbortSignal));
  const previewCalls = vi.mocked(api.read).mock.calls.length;

  await input.fill("second");
  await expect.poll(() => pending.has("second")).toBe(true);
  await expect.element(first).toBeVisible();
  await expect.element(first).toHaveAttribute("aria-disabled", "true");
  await expect.element(page.getByText("Searching…", { exact: true })).not.toBeInTheDocument();
  await expect
    .element(page.getByText("No matching files.", { exact: true }))
    .not.toBeInTheDocument();
  expect(vi.mocked(api.read).mock.calls.length).toBe(previewCalls);
  await userEvent.keyboard("{Enter}");
  await first.click({ force: true });
  expect(onOpen).not.toHaveBeenCalled();

  await input.fill("third");
  await expect.poll(() => pending.has("third")).toBe(true);
  expect(pending.get("second")!.signal!.aborted).toBe(true);
  resolve("third");
  await expect.element(page.getByRole("option", { name: "third.ts:1 src third" })).toBeVisible();
  resolve("second");
  await expect.element(page.getByRole("option", { name: "third.ts:1 src third" })).toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/third.ts", 1, resultSource);

  await input.fill("   ");
  await expect.element(page.getByRole("option")).not.toBeInTheDocument();
  expect(pending.has("   ")).toBe(false);
});

test("resume restores the content query after Enter opens an immutable result", async () => {
  const source: BrowseSource = { kind: "worktree", repo: "/feature" };
  const resultSource: BrowseSource = { kind: "commit", repo: source.repo, oid: "a".repeat(40) };
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 24,
      identity: JSON.stringify(source),
      text: "rewriteForProxiedHttp();\n",
    })),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(async (source, query) => ({
      source,
      query,
      resultSource,
      engine: "zoekt",
      index: { state: "ready" },
      matches: [{ path: "src/main.ts", line: 1, text: "rewriteForProxiedHttp();" }],
      truncated: false,
    })),
  };
  const onOpen = vi.fn<(path: string, line?: number, source?: BrowseSource) => void>();
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    const [resume, setResume] = useState(false);
    useEffect(() => {
      reopen = () => {
        setResume(true);
        setOpen(true);
      };
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel="Working files · main"
        source={source}
        api={api}
        onOpen={onOpen}
        initialMode="content"
        resume={resume}
      />
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("combobox", { name: "Search file contents" })).toBeVisible();
  await userEvent.keyboard("rewriteForProxiedHttp");
  await expect
    .element(page.getByRole("option", { name: "main.ts:1 src rewriteForProxiedHttp();" }))
    .toBeVisible();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("src/main.ts", 1, resultSource);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  reopen();
  await expect
    .element(page.getByRole("combobox", { name: "Search file contents" }))
    .toHaveValue("rewriteForProxiedHttp");
  await expect
    .element(page.getByRole("option", { name: "main.ts:1 src rewriteForProxiedHttp();" }))
    .toBeVisible();
});

test("a late preview from a different workspace cannot replace the active preview", async () => {
  type Read = Awaited<ReturnType<BrowseApi["read"]>>;
  const requests: {
    source: BrowseSource;
    path: string;
    signal?: AbortSignal;
    resolve(file: Read): void;
  }[] = [];
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: (source, path, signal) =>
      new Promise((resolve) => requests.push({ source, path, signal, resolve })),
  };
  let switchSource = () => {};
  function Harness() {
    const [repo, setRepo] = useState("/first");
    useEffect(() => {
      switchSource = () => setRepo("/second");
    }, []);
    return (
      <FilePicker
        open
        onOpenChange={() => {}}
        entries={[{ path: "file.ts", kind: "file" }]}
        loading={false}
        error={null}
        sourceLabel={repo}
        source={{ kind: "worktree", repo }}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  await expect.poll(() => requests.length).toBe(1);
  switchSource();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal?.aborted).toBe(true);
  requests[1]!.resolve({
    source: requests[1]!.source,
    path: "file.ts",
    kind: "binary",
    size: 20,
    identity: "second",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  requests[0]!.resolve({
    source: requests[0]!.source,
    path: "file.ts",
    kind: "missing",
    size: 0,
    identity: "first",
  });
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
});

test("preview scroll position is restored after Escape and reopen", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(async (source, path) => ({
      source,
      path,
      kind: "text",
      size: 20000,
      identity: "long",
      plain: true,
      text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
    })),
  };
  let reopen = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    useEffect(() => {
      reopen = () => setOpen(true);
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={[{ path: "long.txt", kind: "file" }]}
        loading={false}
        error={null}
        sourceLabel="Current worktree"
        source={{ kind: "worktree", repo: "/current" }}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  const scroller = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[aria-label="Full file"] div')).find(
      (node) => getComputedStyle(node).overflowY === "auto",
    );
  await expect.poll(() => scroller()?.scrollHeight ?? 0).toBeGreaterThan(1000);
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 800 } });
  await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(200);
  const top = scroller()!.scrollTop;
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  reopen();
  await expect.poll(() => scroller()?.scrollTop ?? 0).toBeGreaterThan(top - 5);
  expect(scroller()!.scrollTop).toBeLessThan(top + 5);
});

test("resume uses the most recently opened mode even when it was not toggled", async () => {
  const api: BrowseApi = {
    list: vi.fn<BrowseApi["list"]>(),
    read: vi.fn<BrowseApi["read"]>(),
    search: vi.fn<NonNullable<BrowseApi["search"]>>(),
  };
  let launch = (_mode: "files" | "content", _resume: boolean) => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    const [mode, setMode] = useState<"files" | "content">("content");
    const [resume, setResume] = useState(false);
    useEffect(() => {
      launch = (next, restore) => {
        setMode(next);
        setResume(restore);
        setOpen(true);
      };
    }, []);
    return (
      <FilePicker
        open={open}
        onOpenChange={setOpen}
        entries={[]}
        loading={false}
        error={null}
        sourceLabel="Current"
        initialMode={mode}
        resume={resume}
        api={api}
        onOpen={() => {}}
      />
    );
  }
  render(<Harness />);
  await expect.element(page.getByRole("combobox", { name: "Search file contents" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  launch("files", false);
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  launch("content", true);
  await expect.element(page.getByRole("combobox", { name: "Find file" })).toBeVisible();
});
