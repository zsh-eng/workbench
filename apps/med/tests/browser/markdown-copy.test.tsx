import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { SessionMarkdown } from "../../src/web/components/session/SessionMarkdown";
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

const REPLY = [
  "The limits:",
  "",
  "| Queue | Holds |",
  "| :---- | ----: |",
  "| `mail` | 4 |",
  "| **jobs** | 12 |",
  "",
  "How they connect:",
  "",
  "```mermaid",
  "flowchart LR",
  "  A --> B",
  "```",
  "",
  "Done.",
].join("\n");
const SOURCE = "flowchart LR\n  A --> B";

/** A reply as the thread shows it, in a column of the thread's width. */
async function show(text = REPLY) {
  await page.viewport(1280, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "700px", padding: "40px" });
  document.body.append(frame);
  root = createRoot(frame);
  root.render(<SessionMarkdown text={text} streaming={false} />);
  await expect.element(page.getByText("Done.")).toBeVisible();
}

function clipboard() {
  const items: ClipboardItem[] = [];
  vi.spyOn(navigator.clipboard, "write").mockImplementation(async (next) => {
    items.push(...next);
  });
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  return { items, write };
}

const rightClick = (target: Element) => {
  const box = target.getBoundingClientRect();
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: box.left + 10,
    clientY: box.top + 10,
  });
  target.dispatchEvent(event);
  return event;
};

test("a reply's table copies as its Markdown and as a table, says so, and keeps its place", async () => {
  const { items } = clipboard();
  await show();
  const table = await vi.waitUntil(() => document.querySelector<HTMLElement>(".med-md-table"));
  // The frame takes no room of its own: the table's margins collapse
  // through it, as the thread's height estimate expects.
  const inner = table.querySelector("table")!.getBoundingClientRect();
  const outer = table.getBoundingClientRect();
  expect([outer.top, outer.height]).toEqual([inner.top, inner.height]);
  table.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  await page.getByRole("button", { name: "Copy table" }).click();
  await expect.element(page.getByRole("status").filter({ hasText: "Table copied" })).toBeVisible();
  const markdown = await (await items[0]!.getType("text/plain")).text();
  expect(markdown).toBe(
    ["| Queue | Holds |", "| :---- | ----: |", "| `mail` | 4 |", "| **jobs** | 12 |"].join("\n"),
  );
  const html = await (await items[0]!.getType("text/html")).text();
  expect(html).toContain("<code>mail</code>");
  expect(html).toContain("<strong>jobs</strong>");
  expect(html).not.toMatch(/class=|data-|<button/);
});

test("a table whose lines no longer match its text copies as cells", async () => {
  const { items } = clipboard();
  await show();
  const table = await vi.waitUntil(() => document.querySelector<HTMLElement>(".med-md-table"));
  // The text moved on: the table's lines now hold prose.
  table.querySelector("table")!.dataset.sourceLine = "1";
  await page.getByRole("button", { name: "Copy table" }).click();
  await expect.poll(() => items.length).toBe(1);
  expect(await (await items[0]!.getType("text/plain")).text()).toBe(
    "Queue\tHolds\nmail\t4\njobs\t12",
  );
});

test("a reply's diagram: right-click and Copy beside Full screen offer an image, an SVG, and its text", async () => {
  const { items, write } = clipboard();
  await show();
  const diagram = page.getByRole("img", { name: "Mermaid diagram" });
  await expect.element(diagram).toBeVisible();
  // Text keeps the browser's menu.
  expect(rightClick(page.getByText("How they connect:").element()).defaultPrevented).toBe(false);

  const svg = diagram.element().querySelector("svg")!;
  expect(rightClick(svg).defaultPrevented).toBe(true);
  const menu = page.getByRole("menu", { name: "Diagram actions" });
  await expect.element(menu.getByRole("menuitem", { name: "Copy as image" })).toBeVisible();
  await expect.element(menu.getByRole("menuitem", { name: "Copy as SVG" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Copy text" }).click();
  await expect.poll(() => write.mock.calls.at(-1)?.[0]).toBe(SOURCE);
  await expect
    .element(page.getByRole("status").filter({ hasText: "Mermaid copied" }))
    .toBeVisible();

  // From the keys: the Copy button opens the same copies, and a letter chooses one.
  const copy = page.getByRole("button", { name: "Copy diagram" });
  (copy.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("menuitem", { name: "Copy as SVG" })).toBeVisible();
  await userEvent.keyboard("s");
  await expect.poll(() => write.mock.calls.at(-1)?.[0]).toMatch(/^<svg[^>]+xmlns=/);
  await expect.element(page.getByRole("status").filter({ hasText: "SVG copied" })).toBeVisible();

  await copy.click();
  await page.getByRole("menuitem", { name: "Copy as image" }).click();
  await expect
    .element(page.getByRole("status").filter({ hasText: "Diagram copied" }))
    .toBeVisible();
  const png = await createImageBitmap(await items[0]!.getType("image/png"));
  expect([png.width, png.height]).toEqual([
    Number(svg.getAttribute("width")) * 2,
    Number(svg.getAttribute("height")) * 2,
  ]);
});

test("Full screen opens in the click's frame, and its copies show over the dialog", async () => {
  const { items, write } = clipboard();
  await show();
  await expect.element(page.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  // A drawn diagram loads the dialog ahead, so the click shows it at once,
  // not after React's 300 ms hold for a lazy component.
  await import("../../src/web/components/DiagramDialog");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const expand = page.getByRole("button", { name: "Show the diagram full screen" });
  (expand.element() as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector("[role='dialog'] .med-md-diagram-large")).not.toBeNull();

  const dialog = page.getByRole("dialog", { name: "Diagram" });
  const large = dialog.getByRole("img", { name: "Mermaid diagram" });
  await expect.element(large).toBeVisible();
  await dialog.getByRole("button", { name: "Copy diagram" }).click();
  // Above the dialog, so it takes the click.
  await page.getByRole("menuitem", { name: "Copy as image" }).click();
  await expect.poll(() => items.length).toBe(1);
  expect((await items[0]!.getType("image/png")).type).toBe("image/png");
  await expect.element(dialog.getByRole("status")).toHaveTextContent("Diagram copied");

  rightClick(large.element().querySelector("svg")!);
  await page
    .getByRole("menu", { name: "Diagram actions" })
    .getByRole("menuitem", { name: "Copy text" })
    .click();
  await expect.poll(() => write.mock.calls.at(-1)?.[0]).toBe(SOURCE);
  await expect.element(dialog).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
});
