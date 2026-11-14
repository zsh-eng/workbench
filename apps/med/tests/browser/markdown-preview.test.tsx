import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import MarkdownPreview from "../../src/web/components/MarkdownPreview";
import { createMarkdownModel } from "../../src/web/markdown/model";
import type { FileRead } from "../../src/shared/local-file";
import "../../src/web/pierre-theme";
import { initializeTheme } from "../../src/web/themes";

let root: Root | undefined;
let frame: HTMLDivElement | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  root?.unmount();
  frame?.remove();
  root = undefined;
  frame = undefined;
});

const words =
  "The worker takes the next job, holds it while it works, and renews the hold until the job ends. ";
const section = (heading: string) => `${heading}\n\n${words.repeat(6)}\n\n${words.repeat(4)}\n`;
const LONG = [
  "# Queue worker",
  words,
  section("## Goals"),
  section("## Taking jobs"),
  section("### Holds"),
  section("## Retries"),
  section("## Rollout"),
].join("\n");

async function show(
  text: string,
  width: number,
  title = "Queue worker",
  model = createMarkdownModel(text),
) {
  await page.viewport(1600, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: `${width}px`, height: "600px", display: "flex" });
  document.body.append(frame);
  root = createRoot(frame);
  const file = {
    source: { kind: "local", path: "/test/notes/Queue worker.md" },
    path: "Queue worker.md",
    kind: "text",
    size: text.length,
    identity: "queue",
    text,
  } as FileRead;
  root.render(<MarkdownPreview model={model} file={file} />);
  const reading = page.getByRole("region", { name: "Markdown preview" });
  await expect.element(reading.getByRole("heading", { name: title })).toBeVisible();
  return reading;
}

test("a long document lists its headings on the left, marks the one being read, and hides the list without room", async () => {
  const reading = await show(LONG, 1500);
  const contents = reading.getByRole("navigation", { name: "Table of contents" });
  await expect.element(contents).toBeVisible();
  const entries = () =>
    [...contents.element().querySelectorAll("button")].map((button) => button.textContent);
  // The title shows at the page's top, so the list starts below it.
  expect(entries()).toEqual(["Goals", "Taking jobs", "Holds", "Retries", "Rollout"]);
  const entry = (name: string) => contents.getByRole("button", { name, exact: true });
  const left = (name: string) => parseFloat(getComputedStyle(entry(name).element()).paddingLeft);
  expect(left("Holds")).toBeGreaterThan(left("Taking jobs"));

  // With room, the text stays centered in the pane, right of the list.
  const pane = frame!.querySelector<HTMLElement>(".med-md-scroll")!;
  const article = pane.querySelector("article")!.getBoundingClientRect();
  const box = pane.getBoundingClientRect();
  expect(
    Math.abs(article.left + article.width / 2 - (box.left + box.width / 2)),
  ).toBeLessThanOrEqual(8);
  expect(contents.element().getBoundingClientRect().right).toBeLessThanOrEqual(article.left);

  // Scrolling marks the heading being read; the ones above it read as passed.
  const retries = reading.getByRole("heading", { name: "Retries" }).element() as HTMLElement;
  // The preview can still be placing itself as it opens, so the scroll goes
  // again until it holds.
  const scrollTo = async (top: () => number, name: string) => {
    await expect
      .poll(() => {
        pane.scrollTop = top();
        return entry(name).element().getAttribute("aria-current");
      })
      .toBe("location");
  };
  await scrollTo(() => retries.offsetTop - 40, "Retries");
  expect(entry("Goals").element().hasAttribute("data-read")).toBe(true);
  expect(entry("Rollout").element().hasAttribute("data-read")).toBe(false);
  // The list stays in view while the text scrolls.
  expect(contents.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top);
  // At the end, the last heading is the one being read.
  await scrollTo(() => pane.scrollHeight, "Rollout");
  await userEvent.click(entry("Goals"));
  await expect.element(entry("Goals")).toHaveAttribute("aria-current", "location");

  // A narrow pane has no room for the list.
  const list = contents.element();
  frame!.style.width = "700px";
  await expect.poll(() => getComputedStyle(list).display).toBe("none");
});

test("a short document has no table of contents", async () => {
  const reading = await show("# Note\n\n## One\n\nText.\n\n## Two\n\nText.\n", 1500, "Note");
  await expect.element(reading.getByRole("heading", { name: "Two" })).toBeVisible();
  expect(document.querySelector(".med-md-toc")).toBeNull();
});

const FOLDS = [
  "# Runbook",
  "",
  "## Before",
  "",
  "Check the queue.",
  "",
  "<details>",
  "<summary>Why <b>drain</b> first</summary>",
  "",
  "### Draining",
  "",
  "Jobs that hold a lease **finish** first.",
  "",
  "</details>",
  "",
  "<details open>",
  "<summary>Steps</summary>",
  "",
  "1. Stop the worker.",
  "",
  "</details>",
  "",
  "## After",
  "",
  "Start the worker.",
  "",
].join("\n");

/** Whether the text shows; text in a closed fold has no place on the page. */
const shows = (text: string) =>
  [...frame!.querySelectorAll<HTMLElement>("article :is(p, h3, li)")]
    .find((node) => node.textContent?.includes(text))
    ?.checkVisibility();

test("a <details> fold shows its summary, opens on a click, and stays open while its text changes", async () => {
  const model = createMarkdownModel(FOLDS);
  const reading = await show(FOLDS, 1500, "Runbook", model);
  const why = reading.getByText("Why drain first");
  await expect.element(why).toBeVisible();
  expect(why.element().closest("summary")!.querySelector("strong")!.textContent).toBe("drain");
  expect(shows("Jobs that hold a lease")).toBe(false);
  // An open fold shows what it holds.
  expect(shows("Stop the worker.")).toBe(true);

  await userEvent.click(why);
  await expect.poll(() => shows("Jobs that hold a lease")).toBe(true);
  model.setText(FOLDS.replace("finish** first", "finish** before the worker stops"));
  await expect.poll(() => shows("before the worker stops")).toBe(true);

  // Closed again, it stays closed through an edit outside it.
  await userEvent.click(why);
  await expect.poll(() => shows("before the worker stops")).toBe(false);
  model.setText(model.getText().replace("Check the queue.", "Check the queue first."));
  await expect.element(reading.getByText("Check the queue first.")).toBeVisible();
  expect(shows("before the worker stops")).toBe(false);
});

test("a contents entry or the cursor in a closed fold opens it", async () => {
  const model = createMarkdownModel(FOLDS);
  const reading = await show(FOLDS, 1500, "Runbook", model);
  const contents = reading.getByRole("navigation", { name: "Table of contents" });
  expect(shows("Draining")).toBe(false);
  await userEvent.click(contents.getByRole("button", { name: "Draining" }));
  await expect.poll(() => shows("Draining")).toBe(true);

  await userEvent.click(reading.getByText("Why drain first"));
  await expect.poll(() => shows("Draining")).toBe(false);
  // The line of "Jobs that hold a lease".
  model.follow(12, "cursor");
  await expect.poll(() => shows("Jobs that hold a lease")).toBe(true);
});

const TABLE = [
  "# Limits",
  "",
  "> | Queue | Holds | Note |",
  "> | :---- | ----: | ---- |",
  "> | `mail` | 4 | **busy** at night |",
  "> | jobs | 12 | a \\| pipe |",
  "",
].join("\n");

test("a table copies as its Markdown and as an HTML table", async () => {
  const items: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (next) => {
    items.push(...next);
  });
  const reading = await show(TABLE, 900, "Limits");
  const table = document.querySelector<HTMLElement>(".med-md-table")!;
  table.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  await reading.getByRole("button", { name: "Copy table" }).click();
  await expect.element(reading.getByRole("status")).toHaveTextContent("Table copied");
  expect(items).toHaveLength(1);
  const markdown = await (await items[0]!.getType("text/plain")).text();
  expect(markdown).toBe(
    [
      "| Queue | Holds | Note |",
      "| :---- | ----: | ---- |",
      "| `mail` | 4 | **busy** at night |",
      "| jobs | 12 | a \\| pipe |",
    ].join("\n"),
  );
  const html = await (await items[0]!.getType("text/html")).text();
  expect(html).toContain("<code>mail</code>");
  expect(html).toContain("<strong>busy</strong>");
  expect(html).not.toMatch(/class=|data-|<wbr>/);
});

test("Full screen draws a diagram larger over the page, with zoom; Escape closes it", async () => {
  const diagram = "# Flow\n\nIntro text.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
  const reading = await show(diagram, 900, "Flow");
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  const inline = reading.element().querySelector(".med-md-diagram > svg")!.getBoundingClientRect();
  await reading.getByRole("button", { name: "Show the diagram full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Diagram" });
  const large = dialog.getByRole("img", { name: "Mermaid diagram" });
  await expect.element(large).toBeVisible();
  // Three times the page's size for a small diagram, the most that it grows.
  // The dialog can draw the diagram again, so each look finds its SVG anew: a
  // replaced one measures 0.
  await expect
    .poll(() => large.element().querySelector("svg")?.getBoundingClientRect().width ?? 0)
    .toBeCloseTo(inline.width * 3, -1);
  await expect.element(dialog.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
});

test("a diagram's right-click offers it as an image, as an SVG, and its text; text keeps the browser's menu", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const items: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (next) => {
    items.push(...next);
  });
  const diagram = "# Flow\n\nIntro text.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
  const reading = await show(diagram, 900, "Flow");
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  const text = reading.getByText("Intro text.").element();
  const plain = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  text.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(false);
  const svg = document.querySelector(".med-md-diagram > svg")!;
  const box = svg.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: box.left + 10,
    clientY: box.top + 10,
  });
  svg.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const menu = page.getByRole("menu", { name: "Diagram actions" });
  await expect.element(menu.getByRole("menuitem", { name: "Copy as image" })).toBeVisible();
  await expect.element(menu.getByRole("menuitem", { name: "Copy as SVG" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy text" }).click();
  await expect.poll(() => write.mock.calls.at(-1)?.[0]).toBe("flowchart LR\n  A --> B");
  svg.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 10,
      clientY: box.top + 10,
    }),
  );
  await page
    .getByRole("menu", { name: "Diagram actions" })
    .getByRole("menuitem", { name: "Copy as SVG" })
    .click();
  await expect.poll(() => write.mock.calls.length).toBe(2);
  const exported = write.mock.calls[1]![0];
  expect(exported).toMatch(/^<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  // Colors are written in, so the SVG draws without the page's variables.
  expect(exported).not.toContain("var(--");
  expect(exported).toMatch(/fill:rgb/);
  svg.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: box.left + 10,
      clientY: box.top + 10,
    }),
  );
  await page
    .getByRole("menu", { name: "Diagram actions" })
    .getByRole("menuitem", { name: "Copy as image" })
    .click();
  // The diagram says so beside its buttons.
  await expect
    .element(reading.getByRole("status").filter({ hasText: "Diagram copied" }))
    .toBeVisible();
  // Drawn at twice its size, on the diagram's surface.
  const png = await createImageBitmap(await items[0]!.getType("image/png"));
  expect([png.width, png.height]).toEqual([
    Number(svg.getAttribute("width")) * 2,
    Number(svg.getAttribute("height")) * 2,
  ]);
});

test("a code block has Copy, as in a session's replies; it copies the code as its fence holds it", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const reading = await show(
    ["# Setup", "", "```sh", "bun install", "bun run dev", "```", ""].join("\n"),
    900,
    "Setup",
  );
  const copy = reading.getByRole("button", { name: "Copy code" });
  await expect.element(copy).toBeInTheDocument();
  // The button sits on the block's first line, at its right end.
  const block = document.querySelector<HTMLElement>(".med-md-code")!;
  expect(block.querySelector(":scope > pre > code")?.textContent).toContain("bun install");
  await copy.click();
  expect(write).toHaveBeenCalledWith("bun install\nbun run dev");
  // The page's own notice says so, as for a table.
  await expect.element(reading.getByRole("status")).toHaveTextContent("Code copied");
});

test("without clipboard access, a copy says so briefly", async () => {
  vi.spyOn(navigator.clipboard, "write").mockRejectedValue(
    new DOMException("Write permission denied.", "NotAllowedError"),
  );
  const reading = await show(TABLE, 900, "Limits");
  await reading.getByRole("button", { name: "Copy table" }).click();
  await expect
    .element(reading.getByRole("status"))
    .toHaveTextContent("Copying needs clipboard access");
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

test("an image's right-click copies it as a PNG", async () => {
  const items: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (next) => {
    items.push(...next);
  });
  const canvas = document.createElement("canvas");
  canvas.width = 40;
  canvas.height = 30;
  canvas.getContext("2d")!.fillRect(0, 0, 40, 30);
  const jpeg = canvas.toDataURL("image/jpeg");
  const reading = await show(`# Shot\n\n![A black box](${jpeg})\n`, 900, "Shot");
  const image = reading.getByRole("img", { name: "A black box" });
  await expect.element(image).toBeVisible();
  await expect.poll(() => (image.element() as HTMLImageElement).naturalWidth).toBe(40);
  image.element().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  const menu = page.getByRole("menu", { name: "Image actions" });
  await menu.getByRole("menuitem", { name: "Copy image" }).click();
  await expect.element(reading.getByRole("status")).toHaveTextContent("Image copied");
  const png = await items[0]!.getType("image/png");
  expect(png.type).toBe("image/png");
  const bitmap = await createImageBitmap(png);
  expect([bitmap.width, bitmap.height]).toEqual([40, 30]);
});
