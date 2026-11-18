import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { flushSync } from "react-dom";
import { FullFileView } from "../../src/web/components/FullFileView";
import {
  base,
  BENCHMARK_SAMPLES,
  cleanUp,
  lines,
  mount,
  props,
  render,
  root,
  searchRanges,
  visualRanges,
} from "./full-file-fixture";

afterEach(cleanUp);

test("Vim moves a logical cursor through a virtualized file and searches exact text", async () => {
  const file = {
    ...base,
    plain: true,
    identity: "vim-large",
    text: Array.from({ length: 40000 }, (_, i) => `value${i} = example;\n`).join(""),
  };
  render(<FullFileView {...props} file={file} vimEnabled />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
  pane.focus();
  const key = (value: string, ctrlKey = false) =>
    pane.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, ctrlKey, bubbles: true, cancelable: true }),
    );
  for (const value of "39000G") key(value);
  expect(pane.dataset.vimLine).toBe("39000");
  expect(lines()!.length).toBeLessThan(300);
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-vim-caret]")!.hidden)
    .toBe(false);
  key("w");
  expect(Number(pane.dataset.vimColumn)).toBeGreaterThan(1);
  key("/");
  await expect.element(page.getByRole("textbox", { name: "Search in file" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search in file" }).fill("value39990");
  // The first search starts the search worker, which loads while every
  // worker's page renders at once.
  await expect.poll(() => pane.dataset.vimLine, { timeout: 10_000 }).toBe("39991");
  await page
    .getByRole("textbox", { name: "Search in file" })
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  // Submit the form explicitly: synthetic keyboard events do not trigger native submit.
  page.getByRole("textbox", { name: "Search in file" }).element().closest("form")!.requestSubmit();
  await expect.poll(() => pane.dataset.vimLine).toBe("39991");
  key("z");
  key("z");
  await expect
    .poll(() => document.querySelector<HTMLElement>("[data-vim-caret]")!.hidden)
    .toBe(false);
});

test("Vim incremental search uses smart case, accepts once, and Escape clears highlights", async () => {
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        identity: "incremental",
        text: "intro\nFOO\nFoo\nfoo\nFoo\nend\n",
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  const key = (key: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  element.focus();
  key("/");
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("f");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  await input.fill("foo");
  await expect
    .poll(() => searchRanges().map((range) => range.toString()))
    .toEqual(["FOO", "Foo", "foo", "Foo"]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  await input.fill("Foo");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["Foo", "Foo"]);
  await userEvent.keyboard("{Enter}");
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  key("n");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  key("Escape");
  await expect.poll(() => searchRanges().length).toBe(0);
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  key("/");
  await input.fill("intro");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("{Escape}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await expect.poll(() => searchRanges().length).toBe(0);
  key("n");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["Foo", "Foo"]);
});

test("Vim backward preview and an empty query restore the starting position", async () => {
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        identity: "backward-incremental",
        text: "intro\nfoo\nFoo\nfoo\nend\n",
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  element.focus();
  const key = (key: string) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  key("G");
  key("?");
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("f");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4");
  await input.fill("foo");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4");
  await input.fill("");
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await expect.poll(() => searchRanges().length).toBe(0);
  await input.fill("missing");
  await expect.element(page.getByText("No matches · missing", { exact: false })).toBeVisible();
  await expect.element(pane).toHaveAttribute("data-vim-line", "5");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(element);
});

test("Vim ignores old worker results after query changes and Escape", async () => {
  const sent: { worker: Worker; id: number; query: string }[] = [];
  vi.spyOn(Worker.prototype, "postMessage").mockImplementation(function (this: Worker, message) {
    if (message.id !== -1) sent.push({ worker: this, ...message });
  });
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "incremental-races", text: "intro\nfoo\nbar\n" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  const element = pane.element() as HTMLElement;
  element.focus();
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  const input = page.getByRole("textbox", { name: "Search in file", exact: true });
  await input.fill("foo");
  await input.fill("bar");
  const deliver = (item: (typeof sent)[number], matches: number[]) =>
    item.worker.onmessage?.call(
      item.worker,
      new MessageEvent("message", { data: { id: item.id, matches: Uint32Array.from(matches) } }),
    );
  deliver(sent[0]!, [6]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  deliver(sent[1]!, [10]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await input.fill("foo");
  await input.fill("");
  deliver(sent[2]!, [6]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
  await input.fill("bar");
  await userEvent.keyboard("{Escape}");
  deliver(sent[3]!, [10]);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  await input.fill("foo");
  flushSync(() =>
    root!.render(
      <FullFileView
        {...props}
        file={{ ...base, plain: true, identity: "replacement", text: "new source\n" }}
        vimEnabled
      />,
    ),
  );
  deliver(sent[4]!, [6]);
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => searchRanges().length).toBe(0);
});

test("Vim ignores commands outside its pane and preserves standard input keys", async () => {
  render(<FullFileView {...props} file={base} vimEnabled />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
  const event = new KeyboardEvent("keydown", { key: "?", bubbles: true, cancelable: true });
  pane.focus();
  pane.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await expect.element(page.getByRole("textbox", { name: "Search in file" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search in file" }).fill("jj{}");
  expect(pane.dataset.vimLine).toBe("1");
  const input = page.getByRole("textbox", { name: "Search in file" }).element();
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  await expect
    .element(page.getByRole("textbox", { name: "Search in file" }))
    .not.toBeInTheDocument();
});

test("benchmark: Vim cursor response on 40k lines and a 100k-character line", async ({
  annotate,
}) => {
  const percentile = (values: number[], p: number) =>
    [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)]!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scenarios = [
    {
      name: "40000-lines-local",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["j", "k", "w", "b"],
    },
    {
      name: "40000-lines-scroll",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["j"],
    },
    {
      name: "40000-lines-far-jump",
      text: Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join(""),
      commands: ["G", "g", "g"],
    },
    {
      name: "100000-character-line",
      text: `${"word ".repeat(20000)}\nnext line\n`,
      commands: ["$", "h", "l", "0", "w", "b"],
    },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const file = {
      ...base,
      plain: true,
      identity: `benchmark-${scenario.name}`,
      text: scenario.text,
      size: scenario.text.length,
    };
    if (!root) render(<FullFileView {...props} file={file} vimEnabled />);
    else flushSync(() => root!.render(<FullFileView {...props} file={file} vimEnabled />));
    await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
    await frame();
    const pane = document.querySelector<HTMLElement>('[aria-label="File navigation"]')!;
    pane.focus();
    const handlers: number[] = [],
      frames: number[] = [];
    for (let i = 0; i < BENCHMARK_SAMPLES; i++) {
      await frame();
      const started = performance.now();
      pane.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: scenario.commands[i % scenario.commands.length]!,
          bubbles: true,
          cancelable: true,
        }),
      );
      handlers.push(performance.now() - started);
      await frame();
      const cursor = document.querySelector<HTMLElement>("[data-vim-caret]")!;
      for (
        let attempt = 0;
        attempt < 20 &&
        (cursor.hidden ||
          cursor.dataset.vimLine !== pane.dataset.vimLine ||
          cursor.dataset.vimColumn !== pane.dataset.vimColumn);
        attempt++
      )
        await frame();
      expect(cursor.hidden).toBe(false);
      expect(cursor.dataset.vimLine).toBe(pane.dataset.vimLine);
      expect(cursor.dataset.vimColumn).toBe(pane.dataset.vimColumn);
      frames.push(performance.now() - started);
    }
    results.push({
      scenario: scenario.name,
      bytes: file.size,
      samples: handlers.length,
      handlerP50Ms: percentile(handlers, 0.5),
      handlerP95Ms: percentile(handlers, 0.95),
      handlerMaxMs: Math.max(...handlers),
      nextFrameP50Ms: percentile(frames, 0.5),
      nextFrameP95Ms: percentile(frames, 0.95),
      mountedRows: lines()!.length,
    });
    expect(lines()!.length).toBeLessThan(300);
  }
  await annotate(`VIM_BROWSER_BENCHMARK ${JSON.stringify(results)}`, "benchmark", {
    contentType: "application/json",
    body: JSON.stringify(results, null, 2),
    bodyEncoding: "utf-8",
  });
}, 30000);

test("Vim blank-line cursor is one cell wide and only cursor moves animate", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "0000\n\nnext\n", identity: "empty-caret" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  const caret = document.querySelector<HTMLElement>("[data-vim-caret]")!;
  await expect.poll(() => caret.hidden).toBe(false);
  const width = caret.getBoundingClientRect().width;
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  expect(caret.style.width).toBe("1ch");
  expect(Math.abs(caret.getBoundingClientRect().width - width)).toBeLessThan(0.6);
  expect(caret.getBoundingClientRect().width).toBeGreaterThan(5);
  expect(caret.getBoundingClientRect().width).toBeLessThan(12);
  // Check the next key synchronously; initial font/resize events may cancel
  // the first transition, as they should when viewport geometry changes.
  pane
    .element()
    .dispatchEvent(new KeyboardEvent("keydown", { key: "k", bubbles: true, cancelable: true }));
  expect(getComputedStyle(caret).transitionTimingFunction).toBe("ease-out");
  expect(getComputedStyle(caret).transitionProperty).toBe("left, top");
  expect(getComputedStyle(caret).transitionDuration).toBe("0.065s");
  pane.element().dispatchEvent(new Event("scroll"));
  expect(getComputedStyle(caret).transitionProperty).toBe("none");
});

test("Shift+A and z commands position the cursor and viewport in a virtualized file", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "vim-alignment", text: "  abcdef\n".repeat(4000) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation" });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  const scroller = [...pane.element().querySelectorAll("div")].find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  const caret = document.querySelector<HTMLElement>("[data-vim-caret]")!;
  await userEvent.keyboard("2000G{Shift>}A{/Shift}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2000");
  await expect.element(pane).toHaveAttribute("data-vim-column", "8");
  for (const [keys, align] of [
    ["zz", "center"],
    ["zt", "start"],
    ["zb", "end"],
    ["zb", "end"],
  ]) {
    await userEvent.keyboard(keys!);
    await expect
      .poll(() => {
        const row = document
          .querySelector("diffs-container")
          ?.shadowRoot?.querySelector('[data-line="2000"]');
        if (!row) return Infinity;
        const bounds = row.getBoundingClientRect();
        const viewport = scroller.getBoundingClientRect();
        return Math.abs(
          align === "start"
            ? bounds.top - viewport.top - 4 * bounds.height
            : align === "end"
              ? bounds.bottom - viewport.bottom + 4 * bounds.height
              : (bounds.top + bounds.bottom - viewport.top - viewport.bottom) / 2,
        );
      })
      .toBeLessThan(2);
    await expect.poll(() => caret.hidden).toBe(false);
    await expect.element(pane).toHaveAttribute("data-vim-line", "2000");
    await expect.element(pane).toHaveAttribute("data-vim-column", "8");
    expect(lines()!.length).toBeLessThan(300);
  }
  // Clamping at the file boundary must not leave the cursor hidden.
  await userEvent.keyboard("ggzbzb");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await expect.poll(() => caret.hidden).toBe(false);
  await expect.poll(() => scroller.scrollTop).toBe(0);
});

test("colon jumps to a line on Enter, restores focus, and keeps the file virtualized", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "colon-large", text: "abcdef\n".repeat(40000) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard(":");
  const input = page.getByRole("textbox", { name: "Go to line", exact: true });
  await expect.element(input).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(input.element());
  await input.fill("39000");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("{Enter}");
  await expect.element(input).not.toBeInTheDocument();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await expect.element(pane).toHaveAttribute("data-vim-line", "39000");
  await expect
    .poll(() =>
      document.querySelector("diffs-container")?.shadowRoot?.querySelector('[data-line="39000"]'),
    )
    .toBeTruthy();
  expect(lines()!.length).toBeLessThan(300);
  await userEvent.keyboard("j");
  await expect.element(pane).toHaveAttribute("data-vim-line", "39001");
});

test("colon rejects invalid commands and Escape leaves cursor and scroll unchanged", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "colon-cancel", text: "abcdef\n".repeat(500) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("200Gllzz");
  const scroller = [...pane.element().querySelectorAll("div")].find(
    (node) => getComputedStyle(node).overflowY === "auto",
  )!;
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0);
  const before = scroller.scrollTop;
  await userEvent.keyboard(":");
  const input = page.getByRole("textbox", { name: "Go to line", exact: true });
  for (const command of ["w", "0", "-1", "1.5", "1e2", "2x", "9007199254740992"]) {
    await input.fill(command);
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
  }
  await expect.element(pane).toHaveAttribute("data-vim-line", "200");
  await expect.element(pane).toHaveAttribute("data-vim-column", "3");
  await input.fill("12");
  await expect.element(input).toHaveAttribute("aria-invalid", "false");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await expect.element(pane).toHaveAttribute("data-vim-line", "200");
  await expect.element(pane).toHaveAttribute("data-vim-column", "3");
  await expect.poll(() => scroller.scrollTop).toBe(before);
  await userEvent.keyboard(":{Enter}");
  await expect.element(input).not.toBeInTheDocument();
  await expect.element(pane).toHaveAttribute("data-vim-line", "200");
  await userEvent.keyboard(":");
  await input.fill("99999");
  await userEvent.keyboard("{Enter}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "500");
});

test("a colon prompt belongs only to the displayed file", async () => {
  render(<FullFileView {...props} file={base} vimEnabled />);
  await expect.element(page.getByRole("textbox", { name: "File navigation" })).toBeVisible();
  await userEvent.keyboard(":");
  const input = page.getByRole("textbox", { name: "Go to line", exact: true });
  await input.fill("10");
  flushSync(() =>
    root!.render(
      <FullFileView
        {...props}
        file={{ ...base, identity: "next-colon-file", path: "next.ts" }}
        vimEnabled
      />,
    ),
  );
  await expect.element(input).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("textbox", { name: "File navigation" }))
    .toHaveAttribute("data-vim-line", "1");
  flushSync(() => root!.render(<FullFileView {...props} file={base} vimEnabled />));
  await expect.element(input).not.toBeInTheDocument();
});

test("v paints inclusive characters, V paints lines, and y copies exact source text", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "a🙂e\u0301\r\n\r\nlast" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("lvl");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "character");
  expect(
    visualRanges().flatMap(([, highlight]) =>
      [...highlight].map((range) => (range as Range).toString()),
    ),
  ).toEqual(["🙂e\u0301"]);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe("🙂e\u0301");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
  expect(visualRanges()).toHaveLength(0);
  await userEvent.keyboard("Vj");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "line");
  expect(
    document
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelectorAll("[data-vim-visual-line]").length,
  ).toBe(2);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[1]?.[0]).toBe("a🙂e\u0301\r\n\r\n");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
});

test("visual copy crosses unmounted lines without growing the rendered DOM", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const text = Array.from({ length: 40000 }, (_, i) => `line ${i + 1}\n`).join("");
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "visual-large", text }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("VG");
  await expect.element(pane).toHaveAttribute("data-vim-line", "40000");
  await expect
    .poll(() =>
      document
        .querySelector("diffs-container")
        ?.shadowRoot?.querySelector('[data-line="40000"][data-vim-visual-line]'),
    )
    .toBeTruthy();
  expect(lines()!.length).toBeLessThan(300);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe(text);
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("vG$");
  await expect.element(pane).toHaveAttribute("data-vim-line", "40000");
  expect(visualRanges().reduce((sum, [, h]) => sum + h.size, 0)).toBeLessThan(300);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[1]?.[0]).toBe(text.slice(0, -1));
});

test("empty visual lines have a marker and Escape preserves the cursor", async () => {
  render(
    <FullFileView {...props} file={{ ...base, plain: true, text: "one\n\nthree\n" }} vimEnabled />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("jv");
  expect(
    document
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector('[data-line="2"][data-vim-visual-empty]'),
  ).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
  await expect.element(pane).toHaveAttribute("data-vim-line", "2");
  expect(
    document.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-vim-visual-empty]"),
  ).toBeNull();
});

test("clipboard failure retains selection; platform copy uses source text", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Denied"));
  render(
    <FullFileView {...props} file={{ ...base, plain: true, text: "one\ntwo\n" }} vimEnabled />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("Vjy");
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Could not copy. Selection kept; use ⌘C / Ctrl+C or retry y.");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "line");
  const clipboardData = new DataTransfer();
  const event = new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true });
  pane.element().dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(clipboardData.getData("text/plain")).toBe("one\ntwo\n");
});

test("a file switch clears visual ranges and a late clipboard result cannot move the new file", async () => {
  let finish!: () => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<FullFileView {...props} file={{ ...base, plain: true }} vimEnabled />);
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("vly");
  flushSync(() =>
    root!.render(
      <FullFileView
        {...props}
        file={{ ...base, identity: "visual-next", plain: true }}
        vimEnabled
      />,
    ),
  );
  finish();
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  expect(visualRanges()).toHaveLength(0);
});

test("benchmark: visual ranges stay bounded on 40k lines and long lines", async ({ annotate }) => {
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const percentile = (samples: number[], p: number) =>
    [...samples].sort((a, b) => a - b)[Math.floor((samples.length - 1) * p)]!;
  const results = [];
  const text = Array.from({ length: 40000 }, (_, i) => `export const value${i} = ${i};\n`).join("");
  for (const scenario of [
    { name: "character-local-40k", text, mode: "v", keys: ["j", "k", "w", "b"] },
    { name: "character-far-40k", text, mode: "v", keys: ["G", "g", "g"] },
    { name: "line-far-40k", text, mode: "V", keys: ["G", "g", "g"] },
    {
      name: "character-100k-line",
      text: `${"word ".repeat(20000)}\nend\n`,
      mode: "v",
      keys: ["$", "0", "w", "b"],
    },
  ]) {
    const file = { ...base, identity: scenario.name, plain: true, text: scenario.text };
    if (!root) render(<FullFileView {...props} file={file} vimEnabled />);
    else flushSync(() => root!.render(<FullFileView {...props} file={file} vimEnabled />));
    await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
    const pane = page.getByRole("textbox", { name: "File navigation", exact: true }).element();
    pane.focus();
    const key = (value: string) =>
      pane.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
      );
    key(scenario.mode);
    const handlers: number[] = [],
      frames: number[] = [];
    for (let i = 0; i < BENCHMARK_SAMPLES; i++) {
      await frame();
      const start = performance.now();
      key(scenario.keys[i % scenario.keys.length]!);
      handlers.push(performance.now() - start);
      await frame();
      const cursor = document.querySelector<HTMLElement>("[data-vim-caret]")!;
      for (
        let attempt = 0;
        attempt < 20 &&
        (cursor.hidden ||
          cursor.dataset.vimLine !== pane.dataset.vimLine ||
          cursor.dataset.vimColumn !== pane.dataset.vimColumn);
        attempt++
      )
        await frame();
      expect(cursor.hidden).toBe(false);
      expect(cursor.dataset.vimLine).toBe(pane.dataset.vimLine);
      expect(cursor.dataset.vimColumn).toBe(pane.dataset.vimColumn);
      frames.push(performance.now() - start);
    }
    const mountedRows = lines()!.length;
    const ranges = visualRanges().reduce((sum, [, h]) => sum + h.size, 0);
    expect(mountedRows).toBeLessThan(300);
    expect(ranges).toBeLessThanOrEqual(mountedRows);
    results.push({
      scenario: scenario.name,
      samples: handlers.length,
      handlerP50Ms: percentile(handlers, 0.5),
      handlerP95Ms: percentile(handlers, 0.95),
      frameP50Ms: percentile(frames, 0.5),
      frameP95Ms: percentile(frames, 0.95),
      mountedRows,
      ranges,
    });
  }
  await annotate(`VISUAL_BENCHMARK ${JSON.stringify(results)}`, "benchmark", {
    contentType: "application/json",
    body: JSON.stringify(results, null, 2),
    bodyEncoding: "utf-8",
  });
}, 30000);

test("Escape during a pending yank prevents a late failure from restoring visual status", async () => {
  let fail!: (error: Error) => void;
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(<FullFileView {...props} file={{ ...base, plain: true }} vimEnabled />);
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("vly{Escape}");
  fail(new Error("Denied"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
  expect(visualRanges()).toHaveLength(0);
  expect(mount!.textContent).not.toContain("Selection kept");
});

test("Vim marks and jump-back cross virtualized regions without mounting the whole file", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "  abcdef\n".repeat(40000) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("200G5lma39000G''");
  await expect.element(pane).toHaveAttribute("data-vim-line", "200");
  await expect.element(pane).toHaveAttribute("data-vim-column", "3");
  await userEvent.keyboard("``");
  await expect.element(pane).toHaveAttribute("data-vim-line", "39000");
  await userEvent.keyboard("`a");
  await expect.element(pane).toHaveAttribute("data-vim-line", "200");
  await expect.element(pane).toHaveAttribute("data-vim-column", "6");
  await expect
    .poll(() => document.querySelector("[data-vim-caret]")?.getAttribute("data-vim-line"))
    .toBe("200");
  expect(lines()!.length).toBeLessThan(250);
});

test("accepted search and colon jumps update jump-back while cancelled search does not", async () => {
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        text: Array.from({ length: 100 }, (_, i) => (i === 79 ? "needle" : "abcdef")).join("\n"),
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await expect.poll(() => document.activeElement).toBe(pane.element());
  await userEvent.keyboard("20G3l/needle");
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await userEvent.keyboard("{Enter}``");
  await expect.element(pane).toHaveAttribute("data-vim-line", "20");
  await expect.element(pane).toHaveAttribute("data-vim-column", "4");
  await userEvent.keyboard("/needle");
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await userEvent.keyboard("{Escape}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "20");
  await userEvent.keyboard("''");
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
  await userEvent.keyboard(":50{Enter}''");
  await expect.element(pane).toHaveAttribute("data-vim-line", "80");
});

test.each([
  { plain: true, newline: "\n", name: "plain LF" },
  { plain: false, newline: "\n", name: "highlighted LF" },
  { plain: true, newline: "\r\n", name: "plain CRLF" },
  { plain: false, newline: "\r\n", name: "highlighted CRLF" },
])("Vim keeps empty lines at column one beside long lines ($name)", async ({ plain, newline }) => {
  const text = [
    `const longLine = "${"x".repeat(800)}";`,
    "",
    "const shortLine = 1;",
    "",
    `const longerLine = "${"y".repeat(1200)}";`,
    "",
    "",
  ].join(newline);
  render(<FullFileView {...props} file={{ ...base, plain, text }} vimEnabled />);
  await expect.poll(() => lines()?.length ?? 0).toBeGreaterThan(0);
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true }).element();
  pane.focus();
  const key = (value: string) =>
    pane.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }),
    );
  const row = (number: number) =>
    document
      .querySelector("diffs-container")!
      .shadowRoot!.querySelector<HTMLElement>(`[data-line="${number}"]`)!;
  let scroller = row(1).parentElement!;
  while (
    !(
      scroller.scrollWidth > scroller.clientWidth &&
      /auto|scroll/.test(getComputedStyle(scroller).overflowX)
    )
  ) {
    scroller = scroller.parentElement!;
  }
  expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth * 2);
  const assertEmpty = async (line: number) => {
    expect(pane.dataset.vimLine).toBe(String(line));
    expect(pane.dataset.vimColumn).toBe("1");
    await expect.poll(() => scroller.scrollLeft).toBe(0);
    await expect
      .poll(() => {
        const caret = document.querySelector<HTMLElement>("[data-vim-caret]")!;
        return (
          !caret.hidden &&
          caret.dataset.vimLine === String(line) &&
          Math.abs(caret.getBoundingClientRect().left - row(line).getBoundingClientRect().left) < 1
        );
      })
      .toBe(true);
  };
  key("j");
  await assertEmpty(2);
  // The preceding line's last character must still scroll into view normally.
  key("k");
  key("$");
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(1000);
  key("j");
  await assertEmpty(2);
  key("j");
  key("j");
  await assertEmpty(4);
  // Check upward movement and the final empty line, too.
  key("j");
  key("$");
  await expect.poll(() => scroller.scrollLeft).toBeGreaterThan(1000);
  key("k");
  await assertEmpty(4);
  key("G");
  await assertEmpty(6);
});

test("Vim text objects paint and copy words and paragraphs across virtualized rows", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const paragraph = "one.two  𝒜e\u0301\r\n" + "continuation\r\n".repeat(4000);
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, identity: "text-objects", text: paragraph + "\r\nlast" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("lviw");
  expect(
    visualRanges().flatMap(([, highlight]) =>
      [...highlight].map((range) => (range as Range).toString()),
    ),
  ).toEqual(["one"]);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe("one");
  await userEvent.keyboard("vaW");
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[1]?.[0]).toBe("one.two  ");
  await userEvent.keyboard("vip");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "line");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4001");
  expect(lines()!.length).toBeLessThan(300);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[2]?.[0]).toBe(paragraph);
  await userEvent.keyboard("vap");
  await expect.element(pane).toHaveAttribute("data-vim-line", "4002");
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[3]?.[0]).toBe(paragraph + "\r\n");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
});

test("quote and nested bracket objects copy exact source through the file pane", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const inside = "\r\n" + "  item,\r\n".repeat(4000);
  render(
    <FullFileView
      {...props}
      file={{
        ...base,
        plain: true,
        identity: "delimiter-objects",
        text: `call("value", (${inside}));`,
      }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard('vi"y');
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe("value");
  await userEvent.keyboard("2000Gvi(");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "character");
  expect(lines()!.length).toBeLessThan(300);
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[1]?.[0]).toBe(inside);
  await userEvent.keyboard("2000Gv2a(");
  await userEvent.keyboard("y");
  await expect.poll(() => write.mock.calls[2]?.[0]).toBe(`("value", (${inside}))`);
});

test.each([
  {
    name: "counted motions retain columns through short lines and stop at file boundaries",
    text: "abcdef\nx\nabcdef\n",
    copies: [
      ["4ljjv", "e"],
      ["99j99lv", "f"],
      ["2GV", "x\n"],
      ["G$kkv", "f"],
    ],
  },
  {
    name: "grapheme and word motions preserve complete Unicode characters",
    text: "a🙂e\u0301z\n𝒜𝒞 next",
    copies: [
      ["llv", "e\u0301"],
      ["lllhv", "e\u0301"],
      ["Gev", "𝒞"],
      ["Gewbv", "𝒜"],
      ["Av", "z"],
    ],
  },
  {
    name: "word motions distinguish punctuation and cross line boundaries",
    text: "one.two\n  three four",
    copies: [
      ["wv", "."],
      ["wwev", "o"],
      ["wwwev", "e"],
      ["wwwbv", "t"],
    ],
  },
  {
    name: "find and till honor counts and repeat direction",
    text: "a x b x c x d",
    copies: [
      ["2fxv2l", "x c"],
      ["2fx;v2l", "x d"],
      ["2fx;,v2l", "x c"],
      ["tx;v3l", " x c"],
      ["$Fxv2l", "x d"],
    ],
  },
  {
    name: "paragraph motions keep whitespace-only lines and support counts",
    text: "a\n \nb\n\nc\n\nd\n",
    copies: [
      ["}v", "\n"],
      ["}}2{v", "a"],
      ["V2}", "a\n \nb\n\nc\n\n"],
    ],
  },
  {
    name: "vertical motions preserve tab display columns across CRLF",
    text: "\tx\r\nabc\r\n\r\nz\r\n",
    copies: [
      ["ljv", "c"],
      ["ljkv", "x"],
      ["}V", "\r\n"],
    ],
  },
  {
    name: "visual reversal and mode switches preserve the selection anchor",
    text: "a🙂e\u0301\nnext",
    copies: [
      ["lvloh", "a🙂e\u0301"],
      ["lvlG$", "🙂e\u0301\nnext"],
      ["lvjVv", "🙂e\u0301\nne"],
      ["GV", "next"],
    ],
  },
  {
    name: "inner words select punctuation, spaces, WORDs, and full graphemes",
    text: "one.two  𝒜e\u0301🙂\n☀️ next",
    copies: [
      ["3lviw", "."],
      ["7lviw", "  "],
      ["9lviw", "𝒜e\u0301"],
      ["lviW", "one.two"],
      ["Gviw", "☀️"],
    ],
  },
  {
    name: "word objects apply counts and use adjacent whitespace",
    text: "one  two.three\nnext",
    copies: [
      ["vaw", "one  "],
      ["4lvaw", "  two"],
      ["10lvaW", "  two.three"],
      ["v2iw", "one  "],
      ["v3iw", "one  two"],
      ["v2aw", "one  two"],
      ["viwiw", "one  "],
    ],
  },
  {
    name: "paragraph objects preserve CRLF, blank separators, and missing final newline",
    text: "one\r\ntwo\r\n\r\n\r\nthree\r\nfour",
    copies: [
      ["3Gvip", "\r\n\r\n"],
      ["3Gvap", "\r\n\r\nthree\r\nfour"],
      ["Gvap", "\r\n\r\nthree\r\nfour"],
      ["v2ip", "one\r\ntwo\r\n\r\n\r\n"],
      ["vipip", "one\r\ntwo\r\n\r\n\r\n"],
      ["v2ap", "one\r\ntwo\r\n\r\n\r\nthree\r\nfour"],
    ],
  },
  {
    name: "marks retain exact Unicode columns and linewise jumps use first content",
    text: "  a🙂bc\nother\nlast\n",
    copies: [
      ["4lmaG`av", "b"],
      ["4lmaG'av", "a"],
    ],
  },
  {
    name: "empty delimiters allow selection to extend to source text",
    text: 'call(""); ()',
    copies: [
      ['5lvi"l', '")'],
      ["10lvibab", "()"],
    ],
  },
  {
    name: "unmatched objects keep the current selection",
    text: "a (unclosed",
    copies: [["vi(", "a"]],
  },
])("Vim file-pane copy: $name", async ({ text, copies }) => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<FullFileView {...props} file={{ ...base, plain: true, text }} vimEnabled />);
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  for (const [sequence, expected] of copies) {
    await userEvent.keyboard("{Escape}gg0");
    write.mockClear();
    // Vitest reserves { and [ for named key syntax.
    await userEvent.keyboard(sequence!.replaceAll("[", "[[").replaceAll("{", "{{") + "y");
    await expect.poll(() => write.mock.calls[0]?.[0]).toBe(expected);
  }
});

test.each(['"', "'", "`"])(
  "Vim quote %s preserves escaped delimiters and adjacent spaces",
  async (quote) => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const content = `a\\${quote}b`;
    render(
      <FullFileView
        {...props}
        file={{ ...base, plain: true, text: `call(${quote}${content}${quote}  );` }}
        vimEnabled
      />,
    );
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    await userEvent.keyboard(`7lvi${quote}y`);
    await expect.poll(() => write.mock.calls[0]?.[0]).toBe(content);
    await userEvent.keyboard(`gg07lva${quote}y`);
    await expect.poll(() => write.mock.calls[1]?.[0]).toBe(`${quote}${content}${quote}  `);
  },
);

test.each([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
])(
  "Vim %s%s objects ignore quoted delimiters and expand nested selections",
  async (open, close) => {
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const text = `${open}\r\n  ${open}one "${close}" two${close}\r\n${close}`;
    render(<FullFileView {...props} file={{ ...base, plain: true, text }} vimEnabled />);
    await expect
      .element(page.getByRole("textbox", { name: "File navigation", exact: true }))
      .toBeVisible();
    const object = open === "(" ? open : open + open;
    await userEvent.keyboard(`j4lvi${object}i${object}y`);
    await expect
      .poll(() => write.mock.calls[0]?.[0])
      .toBe(`\r\n  ${open}one "${close}" two${close}\r\n`);
    await userEvent.keyboard(`gg0j4lv2a${close}y`);
    await expect.poll(() => write.mock.calls[1]?.[0]).toBe(text);
  },
);

test("cancelled Vim prefixes do not affect the next selection", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(
    <FullFileView {...props} file={{ ...base, plain: true, text: "one\n\nlast" }} vimEnabled />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("4g{Escape}jvi{Escape}vixy");
  await expect.poll(() => write.mock.calls[0]?.[0]).toBe("\n");
  await expect.element(pane).toHaveAttribute("data-vim-mode", "normal");
});

test("Vim word search skips partial keywords and wraps in both directions", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "foo\nfoobar\nFOO\nend" }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("*");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
  await expect.poll(() => searchRanges().map((range) => range.toString())).toEqual(["foo", "FOO"]);
  await userEvent.keyboard("n");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
  await userEvent.keyboard("N");
  await expect.element(pane).toHaveAttribute("data-vim-line", "3");
});

test("Vim half-page keys move within the visible file and return to its start", async () => {
  render(
    <FullFileView
      {...props}
      file={{ ...base, plain: true, text: "line\n".repeat(40) }}
      vimEnabled
    />,
  );
  const pane = page.getByRole("textbox", { name: "File navigation", exact: true });
  await expect.element(pane).toBeVisible();
  await userEvent.keyboard("{Control>}d{/Control}");
  await expect.poll(() => Number(pane.element().getAttribute("data-vim-line"))).toBeGreaterThan(1);
  await userEvent.keyboard("{Control>}u{/Control}");
  await expect.element(pane).toHaveAttribute("data-vim-line", "1");
});
