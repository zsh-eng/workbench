import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SymbolPicker, type SymbolPickerProps } from "../../src/web/components/SymbolPicker";
import type { BrowseRead, BrowseSource } from "../../src/shared/browse";
import type { SymbolMatch, SymbolSearch } from "../../src/shared/symbols";
import type { BrowseApi } from "../../src/web/data/browse";
import "../../src/web/reset.css";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
beforeEach(async () => {
  await page.viewport(1200, 800);
});
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
const source: BrowseSource = { kind: "worktree", repo: "/repo" };
const commit: BrowseSource = { kind: "commit", repo: "/repo", oid: "a".repeat(40) };
const file: BrowseRead = {
  source,
  path: "main.ts",
  identity: "file-snapshot-1",
  kind: "text",
  size: 2000,
  plain: true,
  text: Array.from({ length: 100 }, (_, i) => `function example${i + 1}() {}`).join("\n"),
};
const symbols: SymbolMatch[] = [
  { name: "example10", kind: "function", path: "main.ts", line: 10, column: 10 },
  { name: "example80", kind: "function", path: "main.ts", line: 80, column: 10 },
];
function response(overrides: Partial<SymbolSearch> = {}): SymbolSearch {
  return {
    source,
    path: file.path,
    identity: file.identity,
    query: "",
    matches: symbols,
    truncated: false,
    engine: "ctags",
    ...overrides,
  };
}
function baseApi(): BrowseApi {
  return {
    read: vi.fn<BrowseApi["read"]>(async () => file),
    list: vi.fn<BrowseApi["list"]>(),
    symbols: vi.fn<NonNullable<BrowseApi["symbols"]>>(async () => response()),
  };
}
function Harness(props: Partial<SymbolPickerProps> & Pick<SymbolPickerProps, "api" | "onOpen">) {
  const [open, setOpen] = useState(true);
  return (
    <SymbolPicker
      open={open}
      onOpenChange={setOpen}
      mode="file"
      source={source}
      sourceLabel="main"
      path={file.path}
      identity={file.identity}
      currentFile={file}
      {...props}
    />
  );
}

test("file symbols filter locally and Enter opens the arrow-selected symbol", async () => {
  const api = baseApi();
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(<Harness api={api} onOpen={onOpen} />);
  await expect
    .element(page.getByRole("option", { name: "example10 function Line 10" }))
    .toBeVisible();
  const popup = page.getByRole("dialog").element();
  expect(getComputedStyle(popup).animationName).toBe("none");
  expect(getComputedStyle(popup).transitionProperty).toBe("none");
  await page.getByRole("combobox", { name: "Find symbol in file" }).fill("ex");
  await userEvent.keyboard("{ArrowDown}");
  expect(document.querySelector('[aria-label="Symbol preview"]')).toBeNull();
  expect(popup.getBoundingClientRect().left).toBe(8);
  expect(popup.getBoundingClientRect().width).toBeLessThan(350);
  expect(onOpen).not.toHaveBeenCalled();
  expect(api.symbols).toHaveBeenCalledTimes(1);
  expect(api.read).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("main.ts", 80, source, 10);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("Escape cancels symbol preview without opening a location", async () => {
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(<Harness api={baseApi()} onOpen={onOpen} />);
  await expect
    .element(page.getByRole("option", { name: "example10 function Line 10" }))
    .toBeVisible();
  await userEvent.keyboard("{ArrowDown}{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
});

test("project symbols search immediately and ignore stale results and Enter", async () => {
  const requests: { query: string; signal?: AbortSignal; resolve(result: SymbolSearch): void }[] =
    [];
  const api = baseApi();
  api.symbols = (_source, query, _options, signal) =>
    new Promise((resolve) => requests.push({ query, signal, resolve }));
  api.read = vi.fn<BrowseApi["read"]>(async () => ({ ...file, source: commit }));
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(<Harness mode="project" api={api} onOpen={onOpen} currentFile={null} />);
  const input = page.getByRole("combobox", { name: "Find symbol in project" });
  // The picker asks with an empty query as it opens, so the host reads the
  // project's symbols before the first key.
  await expect.poll(() => requests.map((request) => request.query)).toEqual([""]);
  await input.fill("example");
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal?.aborted).toBe(true);
  requests[1]!.resolve(response({ query: "example", resultSource: commit, engine: "zoekt" }));
  await expect
    .element(page.getByRole("option", { name: "example10 function main.ts:10" }))
    .toBeVisible();
  await input.fill("example80");
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[1]!.signal?.aborted).toBe(true);
  await userEvent.keyboard("{Enter}");
  expect(onOpen).not.toHaveBeenCalled();
  requests[2]!.resolve(
    response({ query: "example80", resultSource: commit, engine: "zoekt", matches: [symbols[1]!] }),
  );
  await expect
    .element(page.getByRole("option", { name: "example80 function main.ts:80" }))
    .toBeEnabled();
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("main.ts", 80, commit, 10);
  expect(api.read).toHaveBeenCalledWith(commit, "main.ts", expect.any(AbortSignal));
});

test("changed file content cannot preview or open stale symbol positions", async () => {
  const api = baseApi();
  api.read = vi.fn<BrowseApi["read"]>(async () => ({ ...file, identity: "new-content" }));
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(<Harness api={api} onOpen={onOpen} currentFile={null} />);
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("The file changed. Close and reopen symbol search to refresh.");
  await userEvent.keyboard("{Enter}");
  expect(onOpen).not.toHaveBeenCalled();
  expect(document.querySelector("diffs-container")).toBeNull();
});

test("a source switch discards an outstanding symbol request", async () => {
  const pending: {
    source: BrowseSource;
    signal?: AbortSignal;
    resolve(result: SymbolSearch): void;
  }[] = [];
  const api = baseApi();
  api.symbols = (source, _query, _options, signal) =>
    new Promise((resolve) => pending.push({ source, signal, resolve }));
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  function Switching() {
    const [current, setCurrent] = useState(source);
    return (
      <>
        <button id="switch-source" onClick={() => setCurrent({ kind: "worktree", repo: "/other" })}>
          Switch source
        </button>
        <Harness api={api} onOpen={onOpen} source={current} currentFile={null} />
      </>
    );
  }
  render(<Switching />);
  await expect.poll(() => pending.length).toBe(1);
  // The app can change the repository while a modal request is outstanding.
  document.querySelector<HTMLButtonElement>("#switch-source")!.click();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending[0]!.signal?.aborted).toBe(true);
  pending[0]!.resolve(response());
  pending[1]!.resolve(response({ source: pending[1]!.source, matches: [] }));
  await expect.element(page.getByText("No matching symbols.")).toBeVisible();
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  expect(onOpen).not.toHaveBeenCalled();
});

test("ambiguous definitions use the indexed snapshot and need an explicit choice", async () => {
  const api = baseApi();
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(
    <Harness
      mode="project"
      api={api}
      onOpen={onOpen}
      definitionResult={response({ resultSource: commit, query: "example", path: undefined })}
    />,
  );
  await expect.element(page.getByRole("dialog", { name: "Go to definition" })).toBeVisible();
  expect(onOpen).not.toHaveBeenCalled();
  expect(api.symbols).not.toHaveBeenCalled();
  await page.getByRole("combobox", { name: "Filter definitions" }).fill("80");
  await userEvent.keyboard("{Enter}");
  expect(onOpen).toHaveBeenCalledWith("main.ts", 80, commit, 10);
});

test("file symbols start near the captured cursor and do not rerank as previews move", async () => {
  const preview = vi.fn<(line: number, column: number | undefined, name: string) => void>();
  const finish = vi.fn<(accept: boolean) => void>();
  const onOpen = vi.fn<SymbolPickerProps["onOpen"]>();
  render(
    <Harness
      api={baseApi()}
      onOpen={onOpen}
      beginFilePreview={() => ({
        origin: { line: 76, column: 1 },
        preview,
        finish,
      })}
    />,
  );
  const nearest = page.getByRole("option", { name: "example80 function Line 80" });
  await expect.element(nearest).toHaveAttribute("aria-selected", "true");
  await expect
    .element(page.getByRole("combobox", { name: "Find symbol in file" }))
    .toHaveAttribute("aria-activedescendant", nearest.element().id);
  await expect.poll(() => preview.mock.calls.at(-1)).toEqual([80, 10, "example80"]);
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => preview.mock.calls.at(-1)).toEqual([10, 10, "example10"]);
  await userEvent.keyboard("{Escape}");
  expect(finish).toHaveBeenCalledWith(false);
  expect(onOpen).not.toHaveBeenCalled();
});
