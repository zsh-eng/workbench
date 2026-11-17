import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import MarkdownPreview from "../../src/web/components/MarkdownPreview";
import { writeSetting } from "../../src/web/data/settings-file";
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

/** Whether the page's diagram, as drawn, is taller than it is wide. */
const tall = (within: Element = document.body) => {
  const svg = within.querySelector(".med-md-diagram > svg");
  return svg ? Number(svg.getAttribute("height")) > Number(svg.getAttribute("width")) : undefined;
};

test("Turn draws a diagram top to bottom, and back; Full screen shows it turned", async () => {
  const diagram =
    "# Flow\n\nIntro text.\n\n```mermaid\nflowchart LR\n  A[Take] --> B[Hold] --> C[Renew] --> D[Done]\n```\n";
  const reading = await show(diagram, 900, "Flow");
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  expect(tall()).toBe(false);
  await reading.getByRole("button", { name: "Turn the diagram" }).click();
  await expect.poll(() => tall()).toBe(true);
  await reading.getByRole("button", { name: "Show the diagram full screen" }).click();
  const dialog = page.getByRole("dialog", { name: "Diagram" });
  await expect.element(dialog.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  await expect.poll(() => tall(dialog.element())).toBe(true);
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await reading.getByRole("button", { name: "Turn the diagram" }).click();
  await expect.poll(() => tall()).toBe(false);
});

test("a diagram that a narrow pane already turned downward turns back to its own way", async () => {
  const steps = ["Take the job", "Hold the lease", "Renew the hold", "Write the result", "Done"];
  const flow = steps.map((step, index) => `S${index}[${step}]`).join(" --> ");
  const diagram = `# Flow\n\nIntro text.\n\n\`\`\`mermaid\nflowchart LR\n  ${flow}\n\`\`\`\n`;
  const reading = await show(diagram, 420, "Flow");
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  // Pele runs it downward to fit; the first turn is the other way.
  expect(tall()).toBe(true);
  await reading.getByRole("button", { name: "Turn the diagram" }).click();
  await expect.poll(() => tall()).toBe(false);
  await reading.getByRole("button", { name: "Turn the diagram" }).click();
  await expect.poll(() => tall()).toBe(true);
});

test("a diagram with no direction, such as a sequence, has no Turn", async () => {
  const diagram = "# Flow\n\nIntro text.\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n";
  const reading = await show(diagram, 900, "Flow");
  await expect.element(reading.getByRole("img", { name: "Mermaid diagram" })).toBeVisible();
  await expect
    .element(reading.getByRole("button", { name: "Show the diagram full screen" }))
    .toBeInTheDocument();
  await expect
    .element(reading.getByRole("button", { name: "Turn the diagram" }))
    .not.toBeInTheDocument();
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
  // The button sits in the block's strip for its language, at its right end,
  // above the code.
  const block = document.querySelector<HTMLElement>(".med-md-code")!;
  const code = block.querySelector<HTMLElement>(":scope > pre > code")!;
  expect(code.textContent).toContain("bun install");
  const button = copy.element().getBoundingClientRect();
  const pre = block.querySelector("pre")!.getBoundingClientRect();
  expect(button.bottom).toBeLessThanOrEqual(code.getBoundingClientRect().top);
  expect(pre.right - button.right).toBeLessThan(16);
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

test("a chart's key picks lines: one shows alone, more add theirs, and none picked shows all", async () => {
  const text = [
    "# Queues",
    "",
    "```chart",
    "title: Four queues",
    "",
    "time,mail,jobs,push,sync",
    "2026-11-16T09:00:00,1,2,3,4",
    "2026-11-16T09:01:00,2,3,4,5",
    "2026-11-16T09:02:00,3,4,5,6",
    "```",
  ].join("\n");
  const reading = await show(text, 900, "Queues");
  await expect.element(reading.getByRole("heading", { name: "Four queues" })).toBeVisible();
  const names = ["mail", "jobs", "push", "sync"];
  const key = (name: string) => reading.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect.element(key("mail")).toBeVisible();
  const hidden = () =>
    names.filter((name) => key(name).element().getAttribute("aria-label")!.endsWith(", hidden"));
  expect(hidden()).toEqual([]);
  // One line alone.
  await key("jobs").click();
  expect(hidden()).toEqual(["mail", "push", "sync"]);
  await expect.element(key("jobs")).toHaveAttribute("aria-pressed", "true");
  // Another joins it.
  await key("sync").click();
  expect(hidden()).toEqual(["mail", "push"]);
  // A picked line drops out; the last one dropped shows every line again.
  await key("jobs").click();
  expect(hidden()).toEqual(["mail", "jobs", "push"]);
  await key("sync").click();
  expect(hidden()).toEqual([]);
  await expect.element(key("sync")).toHaveAttribute("aria-pressed", "false");
});

test("a chart fence draws its rows as a chart, with prose spacing kept out, and a broken one says why", async () => {
  const text = [
    "# Checkout",
    "",
    "```chart",
    "title: p99 went past 2 s after the deploy",
    "unit: ms",
    "mark: 2026-11-16 09:02 Deploy v412",
    "threshold: 500 SLO",
    "",
    "time,p50,p99",
    "2026-11-16T09:00:00,38,240",
    "2026-11-16T09:01:00,40,260",
    "2026-11-16T09:02:00,41,2100",
    "2026-11-16T09:03:00,39,1900",
    "```",
    "",
    "```chart",
    "title: Nothing to draw",
    "```",
  ].join("\n");
  const reading = await show(text, 900, "Checkout");
  const chart = reading.getByRole("heading", { name: "p99 went past 2 s after the deploy" });
  await expect.element(chart).toBeVisible();
  // The chart's title keeps its own spacing inside the prose.
  expect(getComputedStyle(chart.element()).marginTop).toBe("0px");
  await expect.element(reading.getByRole("button", { name: "p50", exact: true })).toBeVisible();
  await expect.element(reading.getByText("SLO 500 ms")).toBeVisible();
  await expect.element(reading.getByText("Deploy v412")).toBeVisible();
  await expect
    .element(
      reading.getByText(
        "This chart has no data: add a grafana link, a link, a file, or rows of CSV.",
      ),
    )
    .toBeVisible();
  // The options wait in one menu: a log axis, and back.
  const options = reading.getByRole("button", { name: "Chart options" }).first();
  await options.click();
  await page.getByRole("menuitemcheckbox", { name: "Log scale" }).click();
  await options.click();
  await expect
    .element(page.getByRole("menuitemcheckbox", { name: "Log scale" }))
    .toHaveAttribute("aria-checked", "true");
  await userEvent.keyboard("{Escape}");
  // Full screen sits beside the menu, as on a diagram, and Escape closes it.
  await reading.getByRole("button", { name: "Show the chart full screen" }).first().click();
  const large = page.getByRole("dialog", { name: "p99 went past 2 s after the deploy" });
  await expect.element(large).toBeVisible();
  await expect.element(large.getByRole("slider")).toBeVisible();
  await expect
    .element(large.getByRole("button", { name: "Show the chart full screen" }))
    .not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(large).not.toBeInTheDocument();
});

test("a Grafana chart without a Grafana in Settings says so, and its button opens Settings → Grafana", async () => {
  const start = location.pathname;
  const asked: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    asked.push(url.pathname);
    if (url.pathname === "/api/charts/grafana")
      return Response.json(
        {
          error: {
            code: "grafana-not-set",
            message:
              "Add https://grafana.acme.build in Settings → Grafana, with a token, to draw this chart.",
          },
        },
        { status: 404 },
      );
    return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
  });
  const text = [
    "# Checkout",
    "",
    "```chart",
    "grafana: https://grafana.acme.build/d/abc/checkout?viewPanel=4&from=now-3h&to=now",
    "title: p99 tripled after the deploy",
    "```",
  ].join("\n");
  const reading = await show(text, 900, "Checkout");
  await expect.element(reading.getByRole("alert")).toBeVisible();
  expect(reading.getByRole("alert").element().textContent).toContain(
    "Add https://grafana.acme.build in Settings → Grafana, with a token",
  );
  expect(asked).toContain("/api/charts/grafana");
  // The fix replaces Try again, which would only fail the same way.
  await expect.element(reading.getByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  await reading.getByRole("button", { name: "Connect Grafana" }).click();
  expect(location.pathname).toBe("/settings/grafana");
  history.replaceState(null, "", start);
});

test("a link chart draws what its source printed, rows or a chart; a Grafana link that a source covers reads through it", async () => {
  const sources = {
    "https://metrics.acme.build": "metrics-chart",
    "https://grafana.acme.build": "grafana-with-sign-in",
  };
  const settingsFile = (settings: Record<string, Record<string, string>>) => async () =>
    Response.json({ path: "/test/settings.json", settings, error: null });
  await writeSetting("charts.sources", sources, settingsFile({ "charts.sources": sources }));
  const asked: { path: string; link?: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    asked.push({ path: url.pathname, link: body.link });
    if (url.pathname !== "/api/charts/link")
      return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
    const fetched = Date.parse("2026-11-16T09:05:00");
    if (body.link.startsWith("https://metrics.acme.build"))
      return Response.json({
        source: "https://metrics.acme.build",
        rows: "time,p99\n2026-11-16T09:00:00,120\n2026-11-16T09:01:00,180\n2026-11-16T09:02:00,240",
        live: false,
        fetched,
      });
    if (body.link.startsWith("https://grafana.acme.build"))
      return Response.json({
        source: "https://grafana.acme.build",
        chart: {
          title: "Checkout p99",
          unit: "ms",
          threshold: { value: 500, label: "SLO" },
          series: [
            {
              name: "p99",
              points: [
                [Date.parse("2026-11-16T09:00:00"), 240],
                [Date.parse("2026-11-16T09:01:00"), 2100],
              ],
            },
          ],
        },
        range: [Date.parse("2026-11-16T06:00:00"), Date.parse("2026-11-16T09:00:00")],
        live: false,
        fetched,
      });
    return Response.json(
      {
        error: {
          code: "chart-source-missing",
          message:
            "No chart source covers elsewhere.acme.build. Add one in Med's settings, charts.sources.",
        },
      },
      { status: 404 },
    );
  });
  const text = [
    "# Checkout",
    "",
    "```chart",
    "link: https://metrics.acme.build/q?metric=latency",
    "title: Latency by minute",
    "```",
    "",
    "```chart",
    "grafana: https://grafana.acme.build/d/abc/checkout?viewPanel=4&from=now-3h&to=now",
    "```",
    "",
    "```chart",
    "link: https://elsewhere.acme.build/q",
    "title: Nobody reads this",
    "```",
  ].join("\n");
  try {
    const reading = await show(text, 900, "Checkout");
    await expect.element(reading.getByRole("heading", { name: "Latency by minute" })).toBeVisible();
    await expect.element(reading.getByRole("heading", { name: "Checkout p99" })).toBeVisible();
    await expect.element(reading.getByText("SLO 500 ms")).toBeVisible();
    // A chart reads once it nears the screen.
    const unread = reading.getByRole("heading", { name: "Nobody reads this" });
    unread.element().scrollIntoView();
    await expect.element(reading.getByRole("alert")).toBeVisible();
    expect(reading.getByRole("alert").element().textContent).toContain(
      "No chart source covers elsewhere.acme.build",
    );
    // Adding the source reads the chart again, so there is nothing to try.
    await expect
      .element(reading.getByRole("button", { name: "Try again" }))
      .not.toBeInTheDocument();
    // Rows bring no title of their own, so "Latency by minute" has no
    // subtitle; the printed chart's title is its heading.
    expect(document.querySelectorAll("[data-chart-subtitle]")).toHaveLength(0);
    // Each chart reads through its source; none asks Med's Grafana reader.
    expect(
      asked
        .filter((entry) => entry.path.startsWith("/api/charts/"))
        .map((entry) => entry.link)
        .sort(),
    ).toEqual([
      "https://elsewhere.acme.build/q",
      "https://grafana.acme.build/d/abc/checkout?viewPanel=4&from=now-3h&to=now",
      "https://metrics.acme.build/q?metric=latency",
    ]);
    expect(asked.some((entry) => entry.path === "/api/charts/grafana")).toBe(false);
  } finally {
    await writeSetting("charts.sources", {}, settingsFile({}));
  }
});
