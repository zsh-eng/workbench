import { afterEach, expect, test } from "vitest";
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

async function show(text: string, width: number, title = "Queue worker") {
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
  root.render(<MarkdownPreview model={createMarkdownModel(text)} file={file} />);
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
  pane.scrollTop = retries.offsetTop - 40;
  await expect.element(entry("Retries")).toHaveAttribute("aria-current", "location");
  expect(entry("Goals").element().hasAttribute("data-read")).toBe(true);
  expect(entry("Rollout").element().hasAttribute("data-read")).toBe(false);
  // The list stays in view while the text scrolls.
  expect(contents.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top);
  // At the end, the last heading is the one being read.
  pane.scrollTop = pane.scrollHeight;
  await expect.element(entry("Rollout")).toHaveAttribute("aria-current", "location");
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
