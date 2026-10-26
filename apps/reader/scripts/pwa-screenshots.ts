/**
 * Makes the web manifest's screenshots, which Chrome shows in its install
 * dialog, from a running Reader:
 *
 *   bun run pwa-screenshots -- http://127.0.0.1:5341
 *
 * Public-domain books only, in a fresh browser that is signed out: the
 * Library is the Design ideas shelf of typeset covers, and the pages are the
 * bundled Alice's Adventures in Wonderland. The sizes match the manifest in
 * `vite.config.ts`.
 */
import { chromium, type Browser, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(import.meta.dirname, "..");
const OUT = join(APP_ROOT, "public/screenshots");
const SAMPLE_EPUB = join(APP_ROOT, "test/fixtures/sample.epub");
/** The opening of chapter one. */
const FIRST_PAGE = "Alice was beginning to get very tired";

const origin = process.argv[2];
if (!origin) {
  console.error(
    "Usage: bun run pwa-screenshots -- <origin of a running Reader>",
  );
  process.exit(1);
}

const FORMS = {
  narrow: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  wide: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
} as const;

async function newPage(browser: Browser, form: keyof typeof FORMS) {
  const context = await browser.newContext({
    ...FORMS[form],
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    // The shelf of typeset covers is a Design ideas specimen.
    localStorage.setItem("reader-debug-enabled-v1", "true");
  });
  // Signed out, whatever the server's own account.
  await context.route("**/api/**", (route) => route.fulfill({ json: null }));
  return context.newPage();
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) => image.decode().catch(() => {})),
    );
  });
  await page.waitForTimeout(500);
}

async function library(browser: Browser, form: keyof typeof FORMS) {
  const page = await newPage(browser, form);
  await page.goto(new URL("/debug/elements/frame/shelf", origin).href);
  await page.getByRole("heading", { name: "Reading" }).waitFor();
  await settle(page);
  await page.screenshot({
    path: join(OUT, `library-${form}.jpg`),
    type: "jpeg",
    quality: 85,
  });
  await page.context().close();
}

async function reader(browser: Browser, form: keyof typeof FORMS) {
  const page = await newPage(browser, form);
  await page.goto(origin);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles(SAMPLE_EPUB);
  await page
    .getByRole("heading", { name: "Alice's Adventures in Wonderland" })
    .click({ timeout: 30_000 });
  await page.waitForURL(/\/reader\//);
  // Loaded again, without the import's toast.
  await page.goto(page.url());
  await page.locator("[data-reader-page-content]").first().waitFor();
  // Past the title page and contents, to the first chapter's opening page.
  for (let turn = 0; turn < 40; turn++) {
    const text = await page
      .locator(
        '[data-reader-spread-layer="current"] [data-reader-current-page]',
      )
      .allInnerTexts();
    if (text.some((page) => page.includes(FIRST_PAGE))) break;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
  }
  // Two pages of the chapter, not the contents beside its first page.
  if (form === "wide") {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
  }
  await page
    .getByRole("button", { name: "Dismiss reading status prompt" })
    .click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
  await settle(page);
  await page.screenshot({
    path: join(OUT, `reader-${form}.jpg`),
    type: "jpeg",
    quality: 85,
  });
  await page.context().close();
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const form of ["narrow", "wide"] as const) {
    await library(browser, form);
    await reader(browser, form);
  }
} finally {
  await browser.close();
}
