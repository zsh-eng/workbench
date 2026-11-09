// Card Markdown needs real layout and a real worker: Pele measures text and
// fits a diagram to the card. These tests drive the dev server in Chromium.
// Run with `bun run test:browser`; `bun run test` does not include them.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "playwright";

const port = Number(process.env.SPACED_BROWSER_PORT ?? 5249);
const origin = `http://127.0.0.1:${port}`;
let server: ReturnType<typeof Bun.spawn> | undefined;
let browser: Browser;

beforeAll(async () => {
  // Another browser file in the same run may have started the server.
  const up = () =>
    fetch(origin).then(
      (r) => r.ok,
      () => false,
    );
  if (!(await up()))
    server = Bun.spawn(
      [
        "./node_modules/.bin/vite",
        "--host",
        "127.0.0.1",
        "--port",
        `${port}`,
        "--strictPort",
      ],
      { cwd: `${import.meta.dir}/../..`, stdout: "ignore", stderr: "inherit" },
    );
  for (let tries = 0; !(await up()); tries++) {
    if (tries > 300) throw new Error(`No dev server on ${origin}`);
    await Bun.sleep(100);
  }
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

const FLOW = [
  "```mermaid",
  "flowchart LR",
  "  New --> Learning --> Review --> Relearning --> Review",
  "  Review --> Suspended --> Archived --> Deleted",
  "```",
].join("\n");

/** A signed-out phone (or desktop) page with these cards due, on Review. */
async function reviewWith(
  cards: { front: string; back: string }[],
  { width = 390, dark = false } = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
    colorScheme: dark ? "dark" : "light",
    isMobile: width < 600,
    hasTouch: width < 600,
  });
  await context.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  const page = await context.newPage();
  await page.goto(`${origin}/profile`);
  await page.evaluate(async (cards) => {
    const { createNewCard } = await import("/src/lib/sync/operation.ts");
    for (const card of cards) await createNewCard(card.front, card.back);
  }, cards);
  await page.goto(`${origin}/`);
  return page;
}

test("a Mermaid card draws fitted to the card, and opens full screen", async () => {
  const page = await reviewWith([
    { front: `Card states\n\n${FLOW}`, back: "B" },
  ]);
  const pre = page.locator("main pre[data-rendered]").first();
  await pre.locator("svg.pele").waitFor();
  // The source gives way to the drawing.
  expect(await pre.locator("code").isVisible()).toBe(false);
  const fit = await pre.evaluate((pre) => ({
    svg: pre.querySelector("svg.pele")!.getBoundingClientRect().width,
    card: pre.closest("article")!.clientWidth,
  }));
  expect(fit.svg).toBeGreaterThan(100);
  expect(fit.svg).toBeLessThanOrEqual(fit.card);

  await pre.getByRole("button", { name: "Show the diagram full screen" }).tap();
  const dialog = page.getByRole("dialog", { name: "Diagram" });
  await dialog.locator("svg.pele").waitFor();
  const large = await dialog
    .locator("svg.pele")
    .evaluate((svg) => svg.getBoundingClientRect().width);
  expect(large).toBeGreaterThan(fit.svg);
  // Grade keys belong to the card behind; the dialog keeps them.
  for (const key of ["1", "2", "3", "4"]) await page.keyboard.press(key);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  const graded = await page.evaluate(async () => {
    const { rawDb } = await import("/src/lib/db/persistence.ts");
    return rawDb.reviewLogOperations.count();
  });
  expect(graded).toBe(0);
  await page.context().close();
}, 60_000);

test("a diagram that does not draw shows its source as code", async () => {
  const page = await reviewWith([
    { front: "```mermaid\nflowchart LR\n  A -->\n```", back: "B" },
  ]);
  const pre = page.locator("main pre[data-diagram-error]").first();
  await pre.waitFor();
  expect(await pre.locator("code").innerText()).toContain("flowchart LR");
  expect(await pre.locator("svg.pele").count()).toBe(0);
  await page.context().close();
}, 60_000);

test("existing cards keep maths, tables, code and cached images; the next card paints with the grade", async () => {
  const cards = [
    {
      front: [
        "Solve $ax^2 + bx + c = 0$ — costs $5.",
        "",
        "| n | n² |",
        "|---|----|",
        "| 2 | 4 |",
        "",
        "```python",
        "def square(n):",
        "    return n * n",
        "```",
        "",
        "![plot](https://api.zsheng.app/api/apps/spaced/files/xxh64:0123456789abcdef)",
        "",
        "The [...] is a cloze.",
      ].join("\n"),
      back: "$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$",
    },
    { front: "Second card front", back: "Second card back" },
  ];
  const page = await reviewWith(cards, { width: 1280 });
  // Review orders new cards by a hash of their random IDs: either can be first.
  const card = page.locator("main article").first();
  await page.waitForFunction(() =>
    /Solve|Second card/.test(
      document.querySelector("main article")?.textContent ?? "",
    ),
  );
  const mathsFirst = (await card.innerText()).includes("Solve");
  const checkMaths = async () => {
    await card.locator(".katex").first().waitFor();
    expect(await card.locator("table").count()).toBe(1);
    expect(await card.innerText()).toContain("The [...] is a cloze.");
    const keyword = card.locator(".card-code span").first();
    expect(await keyword.getAttribute("style")).toContain("--hls-light");
    expect(
      await keyword.evaluate((span) => getComputedStyle(span).color),
    ).not.toBe(
      await card
        .locator("pre code")
        .evaluate((code) => getComputedStyle(code).color),
    );
    // The image waits for the local cache; it never asks the network itself.
    const image = card.locator("img");
    expect(await image.getAttribute("data-cache-src")).toContain("xxh64:");
    await page.locator("main article .katex-display").first().waitFor();
  };
  if (mathsFirst) await checkMaths();
  // Review renders the next card while this one shows. A grade within those
  // milliseconds would show it empty for a moment; wait until it is ready,
  // in the module instance that the page loaded.
  await page.evaluate(
    async (next) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes("/src/lib/markdown/cards.ts"))!;
      const { renderCard } = await import(url);
      await renderCard(next, "later");
    },
    mathsFirst ? cards[1].front : cards[0].front,
  );

  // The next card was rendered while this one showed, so it is on screen
  // with its text, and no empty frame comes between.
  const after = await page.evaluate(
    (next) =>
      new Promise<{ frames: number; blank: boolean }>((resolve) => {
        const good = [...document.querySelectorAll("main button")].find(
          (button) => button.textContent?.trim().startsWith("Good"),
        ) as HTMLButtonElement;
        good.click();
        let count = 0;
        let blank = false;
        const frame = () => {
          const article = document.querySelector("main article");
          if (article?.getAttribute("aria-busy")) blank = true;
          if (article?.textContent?.includes(next) || count > 120)
            return resolve({ frames: count, blank });
          count++;
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      }),
    mathsFirst ? "Second card front" : "Solve",
  );
  // Grading writes to IndexedDB first; the card changes when that commits.
  expect(after.frames).toBeLessThanOrEqual(10);
  expect(after.blank).toBe(false);
  if (!mathsFirst) await checkMaths();
  await page.context().close();
}, 60_000);

test("the card form previews a diagram; its full screen keeps taps, and a tap on the preview edits it", async () => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: "dark",
  });
  await context.route("**/api/**", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  const page = await context.newPage();
  await page.goto(`${origin}/create`);
  const front = page.getByPlaceholder("Enter the question");
  await front.fill(`Card states\n\n${FLOW}`);
  await page.getByRole("button", { name: "Preview" }).tap();
  const preview = page.getByRole("region", { name: "Question preview" });
  await preview.locator("pre[data-rendered] svg.pele").waitFor();
  expect(await front.isVisible()).toBe(false);

  // Taps in the full-screen diagram stay in it; Escape returns to Preview.
  await preview
    .getByRole("button", { name: "Show the diagram full screen" })
    .tap();
  const dialog = page.getByRole("dialog", { name: "Diagram" });
  await dialog.locator("svg.pele").waitFor();
  await dialog.locator("svg.pele").tap();
  await page.keyboard.press("1");
  expect(await dialog.isVisible()).toBe(true);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  expect(await preview.isVisible()).toBe(true);

  await preview.locator("p").first().tap();
  await front.waitFor({ state: "visible" });
  expect(await front.evaluate((area) => area === document.activeElement)).toBe(
    true,
  );
  expect(await front.inputValue()).toContain("flowchart LR");
  await context.close();
}, 60_000);
