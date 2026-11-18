import { afterEach, expect, test, vi } from "vitest";
import { viewSettings } from "../../src/web/data/view-settings";
import { page, userEvent } from "vitest/browser";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { WorkerPoolContextProvider, useWorkerPool } from "@pierre/diffs/react";
import PierreWorker from "@pierre/diffs/worker/worker.js?worker";
import type { BrowseRead } from "../../src/shared/browse";
import type { BrowseBlame } from "../../src/shared/inspect";
import type { BlameLoader, CommitLoader } from "../../src/web/data/blame";
import { FullFileView, type BeginFileSymbolPreview } from "../../src/web/components/FullFileView";
import type { FileComment } from "../../src/shared/saved-review";
import { createEditorDrafts } from "../../src/web/data/editor-drafts";
import { FileViewTabs } from "../../src/web/components/FileViewTabs";
import {
  base,
  cleanUp,
  commentProps,
  fourLines,
  hoverProps,
  hoverText,
  lines,
  mount,
  props,
  render,
  root,
  searchRanges,
  unmount,
} from "./full-file-fixture";

afterEach(cleanUp);

test("binary, missing and too-large responses never mount a code renderer", async () => {
  render(<FullFileView {...props} file={{ ...base, kind: "binary", text: "DO NOT RENDER" }} />);
  await expect
    .element(page.getByText("Binary file — content preview is not available."))
    .toBeVisible();
  expect(document.querySelector("diffs-container")).toBeNull();
  expect(mount!.textContent).not.toContain("DO NOT RENDER");
  root!.render(<FullFileView {...props} file={{ ...base, kind: "missing" }} />);
  await expect.element(page.getByText("This file does not exist in this worktree.")).toBeVisible();
  expect(document.querySelector("diffs-container")).toBeNull();
  root!.render(<FullFileView {...props} file={{ ...base, kind: "too-large", size: 90_000_000 }} />);
  await expect.element(page.getByText("This file exceeds the preview size limit.")).toBeVisible();
  expect(document.querySelector("diffs-container")).toBeNull();
});

test("a symbol in the editor keeps four lines between it and the view's edges, as zt and zb do", async () => {
  const text = Array.from({ length: 400 }, (_, at) => `const line${at + 1} = ${at};`).join("\n");
  let begin: BeginFileSymbolPreview | null = null;
  render(
    <FullFileView
      {...props}
      file={{ ...base, text, size: text.length, identity: "long:1" }}
      editor={{
        drafts: createEditorDrafts(),
        key: "long",
        autoEdit: true,
        write: async () => ({ ...base, identity: "long:2" }),
      }}
      onSymbolPreviewReady={(value) => {
        begin = value;
      }}
    />,
  );
  await expect.poll(() => document.querySelector(".cm-activeLine")).not.toBeNull();
  await expect.poll(() => begin).not.toBeNull();
  const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
  const gap = (edge: "top" | "bottom") => {
    const row = document.querySelector(".cm-activeLine")?.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    return row ? (edge === "top" ? row.top - view.top : view.bottom - row.bottom) : -1;
  };
  const preview = begin!();
  const lines = () => document.querySelector(".cm-activeLine")!.getBoundingClientRect().height;
  const clear = async (edge: "top" | "bottom") =>
    await expect.poll(() => gap(edge) / lines()).toBeGreaterThanOrEqual(3.5);
  // A symbol below the view lands above its bottom edge, and one above it
  // lands below its top edge.
  preview.preview(200, 7, "line200");
  await clear("bottom");
  preview.preview(100, 7, "line100");
  await clear("top");
  // So does a line in view that is too near an edge.
  const top = scroller.scrollTop;
  preview.preview(98, 7, "line98");
  await clear("top");
  expect(scroller.scrollTop).toBeLessThan(top);
  // A line well inside the view moves nothing.
  const inside = scroller.scrollTop;
  preview.preview(106, 7, "line106");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(scroller.scrollTop).toBe(inside);
  preview.finish(true);
});

test("large plain files remain virtualized and never enter worker syntax highlighting", async () => {
  const large: BrowseRead = {
    ...base,
    plain: true,
    size: 2_000_000,
    identity: "large:1",
    text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
  };
  let pool: ReturnType<typeof useWorkerPool>;
  let highlight: ReturnType<typeof vi.spyOn> | undefined;
  function Probe() {
    const current = useWorkerPool();
    const [ready, setReady] = useState(false);
    useEffect(() => {
      pool = current;
      if (current) highlight = vi.spyOn(current, "highlightFileAST");
      let disposed = false;
      void current?.initialize().then(() => {
        if (!disposed) setReady(true);
      });
      return () => {
        disposed = true;
      };
    }, [current]);
    return ready ? <FullFileView {...props} file={large} line={39000} /> : null;
  }
  render(
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      highlighterOptions={{ theme: "med-graphite-dark", preferredHighlighter: "highlights" }}
    >
      <Probe />
    </WorkerPoolContextProvider>,
  );
  await expect.poll(() => pool?.isInitialized(), { timeout: 5000 }).toBe(true);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  expect(lines()!.length).toBeLessThan(300);
  expect(highlight).not.toHaveBeenCalled();
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("value38999");
  expect(lines()!.length).toBeLessThan(300);
});

test("a preview is positioned at its target before its first visible frame", async () => {
  const file: BrowseRead = {
    ...base,
    identity: "first-frame:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
  };
  render(<FullFileView {...props} file={file} compact />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const frames: number[] = [];
  let frame = 0;
  const sample = () => {
    const container = document.querySelector("diffs-container");
    if (container?.shadowRoot?.querySelector("[data-line]")) {
      const scroller = Array.from(mount!.querySelectorAll("div")).find(
        (node) => getComputedStyle(node).overflowY === "auto",
      );
      if (scroller) frames.push(scroller.scrollTop);
    }
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  try {
    flushSync(() =>
      root!.render(
        <FullFileView
          {...props}
          file={{ ...file, identity: "first-frame:2" }}
          compact
          line={1500}
        />,
      ),
    );
    await expect.poll(() => frames.length).toBeGreaterThan(2);
    expect(frames.every((top) => top > 20_000)).toBe(true);
    await expect
      .poll(() =>
        document
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelector('[data-line="1500"][data-selected-line]'),
      )
      .not.toBeNull();
  } finally {
    cancelAnimationFrame(frame);
  }
});

test("search highlights span syntax tokens, use literal text, and clear when the preview changes", async () => {
  const file = {
    ...base,
    identity: "highlight:1",
    text: "const value = fn(value); // İ 🙂 FN(value)\n",
  };
  render(<FullFileView {...props} compact file={file} highlightQuery="fn(value)" />);
  await expect
    .poll(() => searchRanges().map((range) => range.toString()))
    .toEqual(["fn(value)", "FN(value)"]);
  const shadow = document.querySelector("diffs-container")!.shadowRoot!;
  // Highlight overlays must not insert markup or remove syntax tokens.
  expect(shadow.querySelector("mark")).toBeNull();
  expect(shadow.querySelector("[data-line]")?.textContent).toContain(file.text.trim());
  await expect
    .poll(() => searchRanges()[0]?.startContainer !== searchRanges()[0]?.endContainer)
    .toBe(true);

  root!.render(<FullFileView {...props} compact file={file} highlightQuery="İ 🙂" />);
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["İ 🙂"]);
  root!.render(<FullFileView {...props} compact file={file} highlightQuery="" />);
  await expect.poll(() => searchRanges().length).toBe(0);
  root!.render(<FullFileView {...props} compact file={file} highlightQuery="value" />);
  await expect.poll(() => searchRanges().length).toBe(3);
  root!.render(
    <FullFileView {...props} compact file={{ ...base, kind: "binary" }} highlightQuery="value" />,
  );
  await expect.poll(() => searchRanges().length).toBe(0);
});

test("search highlights follow virtualized rows and release their ranges on close", async () => {
  const file = {
    ...base,
    identity: "highlight-scroll:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `needle ${i + 1}\n`).join(""),
  };
  render(<FullFileView {...props} compact file={file} highlightQuery="needle" />);
  await expect.poll(() => searchRanges().length).toBeGreaterThan(0);
  const firstText = searchRanges()[0]!.startContainer.textContent;
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 4000 } });
  await expect.poll(() => searchRanges()[0]?.startContainer.textContent).not.toBe(firstText);
  expect(
    searchRanges().every(
      (range) => range.startContainer.isConnected && range.toString() === "needle",
    ),
  ).toBe(true);
  expect(searchRanges().length).toBeLessThan(300);
  unmount();
  expect(searchRanges()).toEqual([]);
});

test("an unsupported grammar keeps readable source and identifies plain highlighting", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, path: "example.cr", identity: "cr:1", text: 'puts "hello"' }}
    />,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  expect(lines()![0].textContent).toContain('puts "hello"');
  await expect
    .poll(() => mount!.querySelector('[role="status"]')?.textContent)
    .toContain("Syntax highlighting is not available for crystal");
});

test("a long plain line uses horizontal scrolling instead of wrapping", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, identity: "long:1", plain: true, text: "x".repeat(250000), size: 250000 }}
    />,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const shadow = document.querySelector("diffs-container")!.shadowRoot!;
  expect(shadow.querySelector("[data-overflow]")?.getAttribute("data-overflow")).toBe("scroll");
  expect(lines()!.length).toBeLessThan(3);
  expect(mount!.querySelector('[role="status"]')?.textContent).toContain("Plain text preview");
});

test("native wheel input scrolls a full file and restored previews stay scrollable", async () => {
  const file = {
    ...base,
    identity: "scroll:1",
    plain: true,
    text: Array.from({ length: 2000 }, (_, i) => `line ${i + 1}\n`).join(""),
  };
  let position = 0;
  render(
    <FullFileView
      {...props}
      file={file}
      compact
      initialScrollTop={1000}
      onScrollPosition={(top) => {
        position = top;
      }}
    />,
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  await expect.poll(() => position).toBeGreaterThanOrEqual(1000);
  const scroller = Array.from(mount!.querySelectorAll("div")).find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  expect(scroller.clientHeight).toBeLessThanOrEqual(420);
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  const initial = position;
  await page.getByRole("region", { name: "Full file" }).wheel({ delta: { y: 600 } });
  await expect.poll(() => position).toBeGreaterThan(initial + 100);
  expect(lines()!.length).toBeLessThan(300);
  expect(document.documentElement.scrollTop).toBe(0);
});

test("Git blame reads only when shown, keeps its cache across toggles, and hides stale attribution", async () => {
  const load = vi.fn<BlameLoader>(
    async (file: BrowseRead, startLine: number): Promise<BrowseBlame> => ({
      source: file.source,
      path: file.path,
      identity: file.identity,
      truncated: false,
      lines: [
        {
          line: startLine,
          commit: "a".repeat(40),
          author: "Mira",
          date: "2026-09-19T12:00:00Z",
          summary: "Add example",
        },
      ],
    }),
  );
  render(<FullFileView {...props} file={base} loadBlame={load} />);
  await expect.element(page.getByRole("button", { name: "Toggle Git blame" })).toBeVisible();
  await expect.poll(() => lines()?.length).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(load).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await expect.element(page.getByText("Mira")).toBeVisible();
  expect(load.mock.calls[0]?.slice(0, 2)).toEqual([base, 1]);
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await expect.element(page.getByText("Mira")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await expect.element(page.getByText("Mira")).toBeVisible();
  expect(load).toHaveBeenCalledTimes(1);
  root!.render(<FullFileView {...props} file={base} loadBlame={load} stale />);
  await expect
    .element(page.getByText("Refresh the file before reading its line history."))
    .toBeVisible();
  expect(mount!.textContent).not.toContain("Mira");
});

test("blame uses Base UI tooltips that update between lines and dismiss on Escape", async () => {
  const load: BlameLoader = async (file) => ({
    source: file.source,
    path: file.path,
    identity: file.identity,
    truncated: false,
    lines: [1, 2].map((line) => ({
      line,
      commit: "a".repeat(40),
      author: "Mira",
      date: "2026-09-20T01:23:45.000Z",
      summary: `Change for line ${line}`,
    })),
  });
  render(<FullFileView {...props} file={base} loadBlame={load} blameEnabled />);
  const first = page.getByLabelText(/^Line 1: aaaaaaaa/);
  const second = page.getByLabelText(/^Line 2: aaaaaaaa/);
  await expect.element(first).toBeVisible();
  expect(first.element().hasAttribute("title")).toBe(false);
  const date = first.element().querySelector("time")!;
  expect(date.dateTime).toBe("2026-09-20T01:23:45.000Z");
  expect(date.textContent).toBe(
    new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
      new Date("2026-09-20T01:23:45.000Z"),
    ),
  );
  await first.hover();
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain("Change for line 1");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "2026-09-20T01:23:45.000Z",
  );
  await second.hover();
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain("Change for line 2");
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("tooltip")).not.toBeInTheDocument();
});

test("line blame follows the resting Vim cursor and opens its commit card", async () => {
  const load = vi.fn<BlameLoader>(async (file, start, end) => ({
    source: file.source,
    path: file.path,
    identity: file.identity,
    truncated: false,
    lines: Array.from({ length: end - start + 1 }, (_, index) => ({
      line: start + index,
      commit: (start + index === 3 ? "b" : "a").repeat(40),
      author: start + index === 3 ? "Sam" : "Mira",
      date: "2026-09-20T01:23:45.000Z",
      summary: `Change line ${start + index}`,
    })),
  }));
  const loadCommit = vi.fn<CommitLoader>(async (_repo, id) => ({
    id,
    body: "Explains why the line changed.",
    coAuthors: [],
    files: 2,
    additions: 3,
    deletions: 1,
  }));
  const file = { ...base, text: "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\n" };
  render(
    <FullFileView {...props} file={file} loadBlame={load} loadCommit={loadCommit} vimEnabled />,
  );
  await expect.poll(() => lines()?.length).toBeGreaterThanOrEqual(4);
  const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
  pane.focus();
  const label = () =>
    document
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>("[data-med-line-blame-label]");
  await expect.poll(() => label()?.dataset.who).toMatch(/^Mira, /);
  expect(label()!.closest("[data-line]")!.getAttribute("data-line")).toBe("1");
  // The label is generated content; the row's text stays the code.
  expect(label()!.closest("[data-line]")!.textContent).toBe("const a = 1;");
  pane.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }));
  pane.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true }));
  await expect.poll(() => label()).toBeFalsy();
  await expect.poll(() => label()?.dataset.who).toMatch(/^Sam, /);
  expect(label()!.dataset.summary).toBe(" · Change line 3");
  expect(label()!.closest("[data-line]")!.getAttribute("data-line")).toBe("3");
  await userEvent.hover(label()!);
  await expect.element(page.getByText("Explains why the line changed.")).toBeVisible();
  expect(loadCommit).toHaveBeenCalledWith("/fixture", "b".repeat(40), expect.any(AbortSignal));
  await expect.element(page.getByRole("button", { name: "Copy commit hash" })).toBeVisible();
  // The open gutter names every line's commit, so the line blame steps aside.
  await page.getByRole("button", { name: "Toggle Git blame" }).click();
  await expect.poll(() => label()).toBeFalsy();
  expect(load).toHaveBeenCalledTimes(1);
});

test("compact blame dates fit beside long authors and omit uncommitted or missing dates", async () => {
  const load: BlameLoader = async (file) => ({
    source: file.source,
    path: file.path,
    identity: file.identity,
    truncated: false,
    lines: [1, 2, 3].map((line) => ({
      line,
      commit: (line === 2 ? "0" : "a").repeat(40),
      author: "An author with a name much wider than the blame gutter",
      date: line === 3 ? "" : "2026-09-20T01:23:45.000Z",
      summary: `Change for line ${line}`,
    })),
  });
  render(
    <FullFileView
      {...props}
      file={{ ...base, text: "one\ntwo\nthree\n" }}
      loadBlame={load}
      blameEnabled
    />,
  );
  const committed = page.getByLabelText(/^Line 1: aaaaaaaa/);
  const uncommitted = page.getByLabelText(/^Line 2: Uncommitted/);
  const missingDate = page.getByLabelText(/^Line 3: aaaaaaaa/);
  await expect.element(committed).toBeVisible();
  const author = committed.element().firstElementChild!;
  const date = committed.element().querySelector("time")!;
  expect(author.scrollWidth).toBeGreaterThan(author.clientWidth);
  expect(date.getBoundingClientRect().right).toBeLessThanOrEqual(
    committed.element().getBoundingClientRect().right + 1,
  );
  expect(date.getBoundingClientRect().left).toBeGreaterThan(author.getBoundingClientRect().right);
  expect(uncommitted.element().textContent).toContain("Uncommitted");
  expect(uncommitted.element().querySelector("time")).toBeNull();
  expect(missingDate.element().querySelector("time")).toBeNull();
});

test("picker previews do not start background blame", async () => {
  const load = vi.fn<BlameLoader>();
  render(<FullFileView {...props} file={base} loadBlame={load} compact />);
  await expect.poll(() => lines()?.length).toBeGreaterThan(0);
  // Let the background scheduler run if it was accidentally enabled.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(load).not.toHaveBeenCalled();
});

test("a late Git blame result cannot replace another file's line history", async () => {
  const requests: { file: BrowseRead; signal: AbortSignal; resolve(value: BrowseBlame): void }[] =
    [];
  const load = (file: BrowseRead, _start: number, _end: number, signal: AbortSignal) =>
    new Promise<BrowseBlame>((resolve) => requests.push({ file, signal, resolve }));
  render(<FullFileView {...props} file={base} loadBlame={load} blameEnabled />);
  await expect.poll(() => requests.length).toBe(1);
  const replacement = { ...base, path: "src/next.ts", identity: "next:1" };
  root!.render(<FullFileView {...props} file={replacement} loadBlame={load} blameEnabled />);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[0]!.signal.aborted).toBe(true);
  requests[0]!.resolve({
    source: base.source,
    path: base.path,
    identity: base.identity,
    truncated: false,
    lines: [
      {
        line: 1,
        commit: "a".repeat(40),
        author: "Wrong file author",
        date: "",
        summary: "Old result",
      },
    ],
  });
  requests[1]!.resolve({
    source: replacement.source,
    path: replacement.path,
    identity: replacement.identity,
    truncated: false,
    lines: [
      {
        line: 1,
        commit: "0".repeat(40),
        author: "Not committed",
        date: "",
        summary: "Working changes",
      },
    ],
  });
  await expect.element(page.getByText("Uncommitted", { exact: true })).toBeVisible();
  expect(mount!.textContent).not.toContain("Wrong file author");
});

test("blame follows virtualized rows in the left gutter with bounded reads", async () => {
  const load = vi.fn<BlameLoader>(async (file, start, end) => ({
    source: file.source,
    path: file.path,
    identity: file.identity,
    truncated: false,
    lines: Array.from({ length: end - start + 1 }, (_, i) => ({
      line: start + i,
      commit: "a".repeat(40),
      author: "Mira",
      date: "2026-09-20",
      summary: `History of line ${start + i}`,
    })),
  }));
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "one\n".repeat(40000) }}
      loadBlame={load}
      blameEnabled
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  const attribution = () =>
    document
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>('[data-med-blame="1"]');
  await expect
    .poll(() =>
      attribution()?.querySelector("[data-med-blame-trigger]")?.getAttribute("aria-label"),
    )
    .toContain("History of line 1");
  const row = document
    .querySelector("diffs-container")!
    .shadowRoot!.querySelector<HTMLElement>('[data-line="1"]')!;
  expect(attribution()!.getBoundingClientRect().right).toBeLessThan(
    row.getBoundingClientRect().left,
  );
  await userEvent.keyboard("39000G");
  await expect.element(pane).toHaveAttribute("data-vim-line", "39000");
  await expect
    .poll(() =>
      document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelector('[data-med-blame="39000"]')
        ?.querySelector("[data-med-blame-trigger]")
        ?.getAttribute("aria-label"),
    )
    .toContain("History of line 39000");
  await page.getByLabelText(/^Line 39000: aaaaaaaa/).hover();
  await expect
    .poll(() => document.querySelector('[role="tooltip"]')?.textContent)
    .toContain("History of line 39000");
  expect(load.mock.calls.every(([, start, end]) => end - start < 200)).toBe(true);
  expect(load.mock.calls.length).toBeLessThan(6);
  expect(
    document.querySelector("diffs-container")!.shadowRoot!.querySelectorAll("[data-med-blame]")
      .length,
  ).toBeLessThan(250);
});

test("the current Vim search match has a distinct range through n, N and Escape", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "needle one needle\nneedle two\n" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("/needle");
  const active = () => [...CSS.highlights.keys()].find((key) => key.endsWith("-search-current"));
  await expect.poll(active).toBeTruthy();
  const range = () => [...CSS.highlights.get(active()!)!][0]! as Range;
  expect(range().toString()).toBe("needle");
  await userEvent.keyboard("{Enter}");
  const first = range().getBoundingClientRect().toJSON();
  await userEvent.keyboard("n");
  await expect.poll(() => range().getBoundingClientRect().toJSON()).not.toEqual(first);
  await userEvent.keyboard("N");
  await expect.poll(() => range().getBoundingClientRect().toJSON()).toEqual(first);
  await userEvent.keyboard("{Escape}");
  await expect.poll(active).toBeUndefined();
});

test("changing file identity refreshes contents and commit labels remain explicit", async () => {
  render(<FullFileView {...props} file={base} />);
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("example");
  root!.render(
    <FullFileView
      {...props}
      sourceLabel="Commit aaaaaaa · release"
      file={{
        ...base,
        identity: "example:2",
        text: "const replacement = 42;\n",
        source: { kind: "commit", repo: "/fixture", oid: "a".repeat(40) },
      }}
    />,
  );
  await expect.element(page.getByText("Commit aaaaaaa · release")).toBeVisible();
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("replacement");
  expect(document.querySelector("diffs-container")?.shadowRoot?.textContent).not.toContain(
    "export",
  );
});

test("a stale working file keeps its contents until explicit refresh", async () => {
  let refreshes = 0;
  render(<FullFileView {...props} file={base} stale onRefresh={() => refreshes++} />);
  await expect
    .poll(() => document.querySelector("diffs-container")?.shadowRoot?.textContent)
    .toContain("example");
  await expect
    .element(page.getByText("Workspace changed. Refresh this file to read the latest contents."))
    .toBeVisible();
  await page.getByRole("button", { name: "Refresh contents" }).click();
  expect(refreshes).toBe(1);
  expect(document.querySelector("diffs-container")?.shadowRoot?.textContent).toContain("example");
});

test("Changes stays available; the × or a middle click closes a file tab", async () => {
  let selected = "";
  const closed: string[] = [];
  render(
    <FileViewTabs
      tabs={[
        { id: "a", path: "src/a.ts" },
        { id: "b", path: "src/b.ts" },
      ]}
      active="a"
      onSelect={(id) => {
        selected = id;
      }}
      onClose={(id) => closed.push(id)}
    />,
  );
  await page.getByRole("tab", { name: "Changes", exact: true }).click();
  expect(selected).toBe("changes");
  await expect
    .element(page.getByRole("tab", { name: "Changes", exact: true }))
    .toHaveAttribute("aria-controls", "file-view-panel");
  await page.getByRole("button", { name: "Close src/a.ts" }).click();
  page
    .getByRole("tab", { name: "b.ts", exact: true })
    .element()
    .dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true }));
  expect(closed).toEqual(["a", "b"]);
  await expect.element(page.getByRole("tab", { name: "Changes", exact: true })).toBeVisible();
});

test("a Markdown file that loads is an empty page, with no header that the page replaces", async () => {
  render(<FullFileView {...props} file={null} path="docs/notes.md" loading />);
  await expect
    .poll(() => mount!.querySelector(".med-markdown-reader")?.getAttribute("aria-busy"))
    .toBe("true");
  expect(mount!.querySelector("header")).toBeNull();
  expect(mount!.textContent).toBe("");
});

test("a pending file keeps its requested name and footer position", async () => {
  render(<FullFileView {...props} file={null} path="src/parser.rs" loading vimEnabled />);
  const header = page.getByTitle("src/parser.rs", { exact: true });
  await expect.element(header).toBeVisible();
  expect(mount!.textContent).not.toContain("File preview");
  const footer = page.getByText("NORMAL · Read-only navigation", { exact: true }).element();
  const top = footer.getBoundingClientRect().top;
  flushSync(() =>
    root!.render(
      <FullFileView
        {...props}
        file={{ ...base, path: "src/parser.rs", plain: true }}
        path="src/parser.rs"
        vimEnabled
      />,
    ),
  );
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  // Quiet chrome has no status bar; the path's tooltip gives the file's size.
  await expect.element(page.getByTitle(/^src\/parser\.rs · [\d,]+ bytes$/)).toBeVisible();
  expect(Math.abs(footer.getBoundingClientRect().top - top)).toBeLessThan(1);
  flushSync(() =>
    root!.render(<FullFileView {...props} file={null} path="src/next.rs" loading vimEnabled />),
  );
  await expect.element(page.getByTitle("src/next.rs", { exact: true })).toBeVisible();
  expect(mount!.textContent).not.toContain("src/parser.rs");
  expect(mount!.textContent).not.toContain("File preview");
  expect(Math.abs(footer.getBoundingClientRect().top - top)).toBeLessThan(1);
});

test.each(["java", "cpp"])("%s is highlighted by the real syntax worker", async (lang) => {
  const text = lang === "java" ? "class Demo { int count = 42; }" : "int main() { return 42; }";
  render(
    <WorkerPoolContextProvider
      highlighterOptions={{ theme: "github-dark", preferredHighlighter: "highlights" }}
      poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
    >
      <FullFileView
        {...props}
        file={{ ...base, path: `example.${lang}`, identity: `${lang}:worker`, text }}
      />
    </WorkerPoolContextProvider>,
  );
  await expect.poll(() => lines()?.[0]?.textContent).toBe(text);
  await expect
    .poll(() => {
      const tokens = document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelectorAll("[data-line] span[style]");
      return new Set(Array.from(tokens ?? [], (token) => token.getAttribute("style"))).size;
    })
    .toBeGreaterThan(2);
  expect(mount!.textContent).not.toContain("Syntax highlighting is not available");
});

test("worker highlighting preserves distant multiline state across file switches", async () => {
  const text = [
    "class Demo {",
    "/*",
    ...Array.from({ length: 300 }, (_, i) => `comment ${i}`),
    "*/",
    "int count = 42;",
    "}",
  ].join("\n");
  function Harness() {
    const [second, setSecond] = useState(false);
    return (
      <WorkerPoolContextProvider
        highlighterOptions={{ theme: "github-dark", preferredHighlighter: "highlights" }}
        poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      >
        <button onClick={() => setSecond((value) => !value)}>Switch file</button>
        <FullFileView
          {...props}
          vimEnabled
          line={second ? 1 : 290}
          file={{
            ...base,
            path: "Demo.java",
            identity: second ? "short" : "long",
            text: second ? "class Other { int value = 7; }" : text,
          }}
        />
      </WorkerPoolContextProvider>
    );
  }
  render(<Harness />);
  const shadow = () => document.querySelector("diffs-container")?.shadowRoot;
  const line = (number: number) => shadow()?.querySelector(`[data-line="${number}"]`);
  const color = (number: number) =>
    line(number)?.querySelector("span[style]")?.getAttribute("style")?.toLowerCase();
  await expect.poll(() => line(290)?.textContent).toBe("comment 287");
  await expect.poll(() => color(290)).toContain("#6a737d");
  expect(lines()!.length).toBeLessThan(300);
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await pane.click();
  await userEvent.keyboard("gg");
  await expect.poll(() => line(1)?.textContent).toBe("class Demo {");
  // The jump paints line 1 at once; its colors follow from the worker.
  await expect.poll(() => color(1), { timeout: 5_000 }).toContain("#f97583");
  await userEvent.keyboard("G");
  await expect.poll(() => line(304)?.textContent).toBe("int count = 42;");
  // Code again after the comment: `int` is a type in Pierre's Java grammar.
  await expect.poll(() => color(304)).toContain("#b392f0");
  await page.getByRole("button", { name: "Switch file" }).click();
  await expect.poll(() => line(1)?.textContent).toBe("class Other { int value = 7; }");
  await page.getByRole("button", { name: "Switch file" }).click();
  await expect.poll(() => line(290)?.textContent).toBe("comment 287");
  await expect.poll(() => color(290)).toContain("#6a737d");
});

test("colors Groovy and Gradle files with the Groovy grammar", async () => {
  function Harness() {
    const [gradle, setGradle] = useState(false);
    return (
      <WorkerPoolContextProvider
        highlighterOptions={{ theme: "github-dark", preferredHighlighter: "highlights" }}
        poolOptions={{ workerFactory: () => new PierreWorker(), poolSize: 1 }}
      >
        <button onClick={() => setGradle(true)}>Open Gradle</button>
        <FullFileView
          {...props}
          file={{
            ...base,
            path: gradle ? "build.gradle" : "src/Build.groovy",
            identity: gradle ? "gradle" : "groovy",
            text: gradle ? "def name = 'med'" : "class Build { def name = 'med' }",
          }}
        />
      </WorkerPoolContextProvider>
    );
  }
  render(<Harness />);
  const color = (text: string) =>
    [
      ...(document.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("span[style]") ??
        []),
    ]
      .find((span) => span.textContent?.trim() === text)
      ?.getAttribute("style")
      ?.toLowerCase();
  await expect.poll(() => color("class")).toContain("#f97583");
  await expect.poll(() => color("'med'")).toContain("#9ecbff");
  await page.getByRole("button", { name: "Open Gradle" }).click();
  await expect.poll(() => color("class")).toBeUndefined();
  await expect.poll(() => color("'med'")).toContain("#9ecbff");
});

test("Open in lists the code host and Sourcegraph at the file's line, the editors, and the paths, each with a letter", async () => {
  const opened: unknown[] = [];
  const notes: string[] = [];
  const windows = vi.spyOn(window, "open").mockReturnValue(null);
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const actions = {
    reveal: vi.fn<() => Promise<void>>(async () => {}),
    notify: (text: string) => notes.push(text),
    openIn: {
      links: async () => ({
        editors: [
          { id: "vscode", name: "VS Code" },
          { id: "zed", name: "Zed" },
        ],
        host: {
          name: "github.acme.build",
          base: "https://github.acme.build/acme/trailhead/blob/feature/tides",
        },
        links: [
          {
            name: "Sourcegraph",
            template:
              "https://sourcegraph.acme.build/github.acme.build/acme/trailhead@feature/tides/-/blob/{path}?L{line}",
          },
        ],
      }),
      open: async (...args: unknown[]) => void opened.push(args),
    },
  };
  const target = { repo: "/work/trailhead-open-in", path: "src/trail notes.ts" };
  render(<FullFileView {...props} file={base} line={1} openIn={{ actions, target }} />);
  await page.getByRole("button", { name: "Open in" }).click();
  const item = (name: string) => page.getByRole("menuitem", { name });
  await expect.element(item("github.acme.build")).toBeVisible();
  const names = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
  expect(names).toEqual([
    "github.acme.build",
    "Sourcegraph",
    "VS Code",
    "Zed",
    "Reveal in Finder",
    "Copy path",
    "Copy link",
  ]);
  // Each link goes to the same line on the branch.
  await item("github.acme.build").click();
  expect(windows).toHaveBeenCalledWith(
    "https://github.acme.build/acme/trailhead/blob/feature/tides/src/trail%20notes.ts#L1",
    "_blank",
    "noopener",
  );
  await page.getByRole("button", { name: "Open in" }).click();
  await item("Sourcegraph").click();
  expect(windows).toHaveBeenLastCalledWith(
    "https://sourcegraph.acme.build/github.acme.build/acme/trailhead@feature/tides/-/blob/src/trail%20notes.ts?L1",
    "_blank",
    "noopener",
  );
  // A letter chooses while the menu is open.
  await page.getByRole("button", { name: "Open in" }).click();
  await expect.element(item("Zed")).toBeVisible();
  await userEvent.keyboard("z");
  await expect.poll(() => opened).toEqual([[target, 1, "zed"]]);
  await page.getByRole("button", { name: "Open in" }).click();
  await expect.element(item("Copy link")).toBeVisible();
  await userEvent.keyboard("p");
  await expect.poll(() => notes).toEqual(["Path copied."]);
  expect(copy).toHaveBeenCalledWith("/work/trailhead-open-in/src/trail notes.ts");
  windows.mockRestore();
  copy.mockRestore();
});

test("Open in says Push to open while the branch has no page on its host", async () => {
  const actions = {
    reveal: async () => {},
    notify: () => {},
    openIn: {
      links: async () => ({
        editors: [],
        host: { name: "github.com", push: true as const },
        links: [{ name: "Sourcegraph", push: true as const }],
      }),
      open: async () => {},
    },
  };
  render(
    <FullFileView
      {...props}
      file={base}
      openIn={{ actions, target: { repo: "/work/trailhead-unpushed", path: "src/example.ts" } }}
    />,
  );
  await page.getByRole("button", { name: "Open in" }).click();
  await expect
    .element(page.getByRole("menuitem", { name: "Push to open on github.com" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect
    .element(page.getByRole("menuitem", { name: "Push to open on Sourcegraph" }))
    .toHaveAttribute("aria-disabled", "true");
  await expect.element(page.getByRole("menuitem", { name: "Copy link" })).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
});

test("gc comments on the visual lines, and on the cursor's line; Send to Claude now decides whether it goes", async () => {
  const comments = commentProps();
  render(
    <FullFileView
      {...props}
      vimEnabled
      file={{ ...base, text: fourLines, size: fourLines.length, identity: "four:1" }}
      comments={comments}
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  (pane.element() as HTMLElement).focus();
  await userEvent.keyboard("jVjgc");
  const box = page.getByRole("form", { name: "Comment on lines 2–3" });
  await expect.element(box).toBeVisible();
  // One Comment button; the checkbox, ticked at first, sends it as it is saved.
  await expect.element(box.getByRole("button", { name: "Comment" })).toBeDisabled();
  await expect.element(box.getByRole("checkbox", { name: "Send to Claude now" })).toBeChecked();
  await userEvent.keyboard("Log it once.");
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  await expect.poll(() => comments.add.mock.calls.length).toBe(1);
  expect(comments.add.mock.calls[0]).toEqual([
    { line: 2, endLine: 3, quote: "const b = 2;\nconst c = 3;" },
    "Log it once.",
    "send",
  ]);
  // The box closes, and the file has the keys again.
  await expect.element(box).not.toBeInTheDocument();
  await userEvent.keyboard("jgc");
  const next = page.getByRole("form", { name: "Comment on line 4" });
  await expect.element(next).toBeVisible();
  // Not ticked, the comment waits in the message box; Med keeps the choice.
  await next.getByRole("checkbox", { name: "Send to Claude now" }).click();
  await next.getByRole("textbox", { name: "Comment text" }).fill("Later.");
  await next.getByRole("button", { name: "Comment" }).click();
  await expect.poll(() => comments.add.mock.calls.length).toBe(2);
  expect(comments.add.mock.calls[1]![2]).toBe("keep");
  expect(viewSettings.commentsSendNow.get()).toBe("off");
  viewSettings.commentsSendNow.set("on");
});

test("in the editor, gc opens the box under the lines, whose keys are its own", async () => {
  const comment: FileComment = {
    id: "5d1c0a2e-0000-4000-8000-000000000002",
    source: { kind: "worktree", repo: "/fixture" },
    path: "src/example.ts",
    line: 1,
    quote: "const a = 1;",
    text: "Rename it to retries.",
    createdAt: "2026-11-08T05:00:00.000Z",
    updatedAt: "2026-11-08T05:00:00.000Z",
    replies: [],
  };
  const comments = commentProps([comment]);
  render(
    <FullFileView
      {...props}
      file={{ ...base, text: fourLines, size: fourLines.length, identity: "four:3" }}
      editor={{
        drafts: createEditorDrafts(),
        key: "four",
        autoEdit: true,
        write: async () => ({ ...base, identity: "four:4" }),
      }}
      comments={comments}
    />,
  );
  // The thread sits under its line, in the editor's text.
  await expect.element(page.getByRole("article", { name: "Comment on line 1" })).toBeVisible();
  await expect.poll(() => document.querySelector(".cm-activeLine")).not.toBeNull();
  document.querySelector<HTMLElement>(".cm-content")!.focus();
  await userEvent.keyboard("jVjgc");
  const box = page.getByRole("form", { name: "Comment on lines 2–3" });
  await expect.element(box).toBeVisible();
  expect(document.querySelectorAll(".med-cited-line")).toHaveLength(2);
  // Vim's keys type into the box, and Esc closes it without a change.
  await userEvent.keyboard("dd ggx");
  await expect.element(box.getByRole("textbox")).toHaveValue("dd ggx");
  await userEvent.keyboard("{Escape}");
  await expect.element(box).not.toBeInTheDocument();
  expect(document.querySelector(".med-save-dot")?.getAttribute("data-dirty")).toBe("false");
  // The editor has the keys again; the cursor stayed on line 3.
  await userEvent.keyboard("gc");
  await expect.element(page.getByRole("form", { name: "Comment on line 3" })).toBeVisible();
  await userEvent.keyboard("Log it once.");
  await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
  await expect.poll(() => comments.add.mock.calls.length).toBe(1);
  expect(comments.add.mock.calls[0]).toEqual([
    { line: 3, endLine: 3, quote: "const c = 3;" },
    "Log it once.",
    "send",
  ]);
  await expect.poll(() => document.activeElement?.classList.contains("cm-content")).toBe(true);
  await userEvent.keyboard("Vkgc");
  await expect.element(page.getByRole("form", { name: "Comment on lines 2–3" })).toBeVisible();
});

test("a comment that the agent resolved says so, and opens again", async () => {
  const comment: FileComment = {
    id: "5d1c0a2e-0000-4000-8000-000000000001",
    source: { kind: "worktree", repo: "/fixture" },
    path: "src/example.ts",
    line: 1,
    quote: "const a = 1;",
    text: "Rename it to retries.",
    createdAt: "2026-11-08T05:00:00.000Z",
    updatedAt: "2026-11-08T05:00:00.000Z",
    replies: [
      {
        id: "r1",
        text: "Renamed it in the three places that read it.",
        author: { agent: "claude" },
        createdAt: "2026-11-08T05:02:00.000Z",
      },
    ],
    resolved: { at: "2026-11-08T05:02:00.000Z", by: { agent: "claude" } },
  };
  const comments = commentProps([comment]);
  render(
    <FullFileView
      {...props}
      vimEnabled
      file={{ ...base, text: fourLines, size: fourLines.length, identity: "four:2" }}
      comments={comments}
    />,
  );
  const card = page.getByRole("article", { name: "Comment on line 1" });
  await expect.element(card).toBeVisible();
  await expect.element(card.getByText("Resolved by Claude")).toBeVisible();
  await expect
    .element(card.getByText("Renamed it in the three places that read it."))
    .toBeVisible();
  await card.getByRole("button", { name: "Reopen" }).click();
  expect(comments.mutate).toHaveBeenCalledWith({ reopen: comment.id });
});

test("a name's card shows its definition, from the pointer or K, and opens it", async () => {
  const hover = hoverProps();
  render(
    <FullFileView
      {...props}
      vimEnabled
      file={{ ...base, text: hoverText, size: hoverText.length, identity: "hover:1" }}
      loadHover={hover.loadHover}
      onOpenDefinition={hover.onOpenDefinition}
    />,
  );
  await expect.poll(() => lines()?.length).toBeGreaterThan(1);
  // The pointer rests on the name: a moment later, its card.
  const token = () =>
    [...(lines()?.[0]?.querySelectorAll<HTMLElement>("span") ?? [])].find(
      (span) => span.textContent === "retries" && !span.querySelector("span"),
    );
  await expect.poll(() => token()).toBeTruthy();
  await userEvent.hover(token()!);
  const card = page.getByRole("tooltip", { name: "Definition of retries" });
  await expect.element(card).toBeVisible();
  const text = card.element().textContent;
  expect(text).toContain("export const retries = 3;");
  expect(text).toContain("How often a request goes again, as fetch does.");
  expect(card.element().querySelector("code")?.textContent).toBe("fetch");
  expect(hover.loadHover).toHaveBeenCalledWith(
    "retries",
    expect.any(AbortSignal),
    expect.any(String),
  );
  await userEvent.click(card.getByRole("button", { name: "limits.ts:3" }));
  expect(hover.onOpenDefinition).toHaveBeenCalledWith(hover.definition);
  await expect.element(card).not.toBeInTheDocument();
  // K shows the card of the name under the cursor; Esc puts it away.
  const pane = page.getByRole("textbox", { name: "File navigation" });
  (pane.element() as HTMLElement).focus();
  await userEvent.keyboard("0wwwK");
  await expect.element(card).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(card).not.toBeInTheDocument();
  // A name with no definition shows nothing.
  await userEvent.keyboard("j0wwwK");
  await expect.poll(() => hover.loadHover.mock.calls.at(-1)?.[0]).toBe("other");
  expect(document.querySelector("[data-symbol-hover]")).toBeNull();
});

test("in the editor, K shows the card of the name under the cursor", async () => {
  const hover = hoverProps();
  render(
    <FullFileView
      {...props}
      file={{ ...base, text: hoverText, size: hoverText.length, identity: "hover:1" }}
      editor={{
        drafts: createEditorDrafts(),
        key: "hover",
        autoEdit: true,
        write: async () => ({ ...base, identity: "hover:2" }),
      }}
      loadHover={hover.loadHover}
      onOpenDefinition={hover.onOpenDefinition}
    />,
  );
  await expect.poll(() => document.querySelector(".cm-activeLine")).not.toBeNull();
  document.querySelector<HTMLElement>(".cm-content")!.focus();
  await userEvent.keyboard("wwwK");
  const card = page.getByRole("tooltip", { name: "Definition of retries" });
  await expect.element(card).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(card).not.toBeInTheDocument();
  expect(document.querySelector(".med-save-dot")?.getAttribute("data-dirty")).toBe("false");
});
