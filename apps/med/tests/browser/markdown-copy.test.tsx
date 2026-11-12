import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { SessionMarkdown } from "../../src/web/components/session/SessionMarkdown";
// The thread's own rules for a reply's prose, as the thread loads them.
import "../../src/web/components/session/SessionThread.css";
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
async function show(text = REPLY, { streaming = false, until = "Done." } = {}) {
  await page.viewport(1280, 900);
  initializeTheme();
  frame = document.createElement("div");
  Object.assign(frame.style, { width: "700px", padding: "40px" });
  document.body.append(frame);
  root = createRoot(frame);
  root.render(<SessionMarkdown text={text} streaming={streaming} />);
  await expect.element(page.getByText(until)).toBeVisible();
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

const shown = (element: Element) => getComputedStyle(element).opacity === "1";

test("a reply's code block has Copy on hover and focus, which copies the code as the fence holds it", async () => {
  const { write } = clipboard();
  await show(
    ["Run it:", "", "```ts", "const width = 768;", "", "  return width;", "```", "", "Done."].join(
      "\n",
    ),
  );
  const code = await vi.waitUntil(() => document.querySelector<HTMLElement>(".med-md-code"));
  // The frame takes no room of its own, as the thread's height estimate expects.
  const inner = code.querySelector("pre")!.getBoundingClientRect();
  const outer = code.getBoundingClientRect();
  expect([outer.top, outer.height]).toEqual([inner.top, inner.height]);

  // At rest the block shows only its code.
  const copy = page.getByRole("button", { name: "Copy code" });
  const button = copy.element() as HTMLButtonElement;
  await userEvent.hover(page.getByText("Done."));
  await expect.poll(() => shown(button)).toBe(false);
  await userEvent.hover(page.elementLocator(code.querySelector("pre")!));
  await expect.poll(() => shown(button)).toBe(true);
  // The button is on the block, level with its first line.
  const box = button.getBoundingClientRect();
  const line = code.querySelector("code span")!.getBoundingClientRect();
  expect(box.right).toBeLessThan(inner.right);
  expect(Math.abs((box.top + box.bottom) / 2 - (line.top + line.bottom) / 2)).toBeLessThan(1.5);
  // The keyboard reaches it.
  await userEvent.hover(page.getByText("Done."));
  await expect.poll(() => shown(button)).toBe(false);
  button.focus();
  await expect.poll(() => shown(button)).toBe(true);

  await copy.click();
  await expect
    .poll(() => write.mock.calls.at(-1)?.[0])
    .toBe("const width = 768;\n\n  return width;");
  // A check for a moment, and a screen reader hears it.
  expect(button.dataset.copied).toBe("");
  await expect.element(page.getByRole("status").filter({ hasText: "Copied" })).toBeInTheDocument();
  await expect.poll(() => button.dataset.copied, { timeout: 3000 }).toBeUndefined();
  expect(code.querySelector("[role='status']")!.textContent).toBe("");

  // A copy that the browser refuses says why, beside the button.
  write.mockRejectedValueOnce(new DOMException("", "NotAllowedError"));
  await copy.click();
  await expect.element(page.getByText("Copying needs clipboard access")).toBeVisible();
  expect(button.dataset.copied).toBeUndefined();
});

test("while a reply streams, a closed code block keeps its Copy button and the last block waits", async () => {
  const { write } = clipboard();
  const start = ["```", "bun test", "```", "", "Then:", "", "```ts", "const a"].join("\n");
  await show(start, { streaming: true, until: "const a" });
  await vi.waitUntil(() => document.querySelectorAll(".med-md-code").length === 1);
  const copy = page.getByRole("button", { name: "Copy code" });
  const button = copy.element() as HTMLButtonElement;
  await copy.click();
  await expect.poll(() => write.mock.calls.at(-1)?.[0]).toBe("bun test");
  expect(button.dataset.copied).toBe("");

  // More text arrives: the same button, which keeps the focus.
  root!.render(<SessionMarkdown text={`${start} = 1;\n`} streaming />);
  await expect.element(page.getByText("const a = 1;")).toBeVisible();
  expect(button.isConnected && document.activeElement === button).toBe(true);
  expect(document.querySelectorAll(".med-md-code")).toHaveLength(1);

  // The reply ends: its last block has Copy too.
  root!.render(<SessionMarkdown text={`${start} = 1;\n\`\`\`\n`} streaming={false} />);
  await expect.poll(() => document.querySelectorAll(".med-md-code").length).toBe(2);
  expect(button.isConnected).toBe(true);
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
