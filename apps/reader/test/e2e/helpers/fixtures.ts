import {
  test as base,
  expect,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  DATABASE_MODULE,
  preparedLibraryPath,
  SAMPLE_EPUB_PATH,
  type PreparedLibrary,
} from "./global-setup";
import { mockApi, type MockApi } from "./mock-api";

export { SAMPLE_EPUB_PATH };
export const SAMPLE_BOOK_TITLE = /Alice.*Adventures.*Wonderland/i;
const CURRENT_SPREAD = '[data-reader-spread-layer="current"]';

let preparedLibrary: Promise<PreparedLibrary> | undefined;

/** The rows the global setup imported once, through the real importer. */
function loadPreparedLibrary(baseURL: string): Promise<PreparedLibrary> {
  preparedLibrary ??= readFile(preparedLibraryPath(baseURL), "utf8").then(
    (text) => JSON.parse(text) as PreparedLibrary,
  );
  return preparedLibrary;
}

/** Each test gets a fresh context. Only immutable imported data is shared between workers' tests. */
export const test = base.extend<{
  signedIn: boolean;
  remote: MockApi;
  addSampleBook: () => Promise<void>;
  localBook: { id: string };
}>({
  signedIn: [false, { option: true }],
  remote: [
    async ({ context, signedIn }, use) => {
      const remote = await mockApi(context, signedIn);
      await use(remote);
      expect(remote.unexpected, "Unexpected API requests").toEqual([]);
    },
    { auto: true },
  ],
  addSampleBook: async ({ page }, use) => use(() => importSampleBook(page)),
  localBook: async ({ page, baseURL }, use) => {
    const preparedLibrary = await loadPreparedLibrary(baseURL!);
    await page.goto("/");
    await page.evaluate(
      async ({ snapshot, modulePath }) => {
        const { syncV2Db: db } = await import(modulePath);
        const tables = Object.entries(snapshot);
        for (const [, rows] of tables) {
          for (const row of rows) {
            for (const [key, value] of Object.entries(row)) {
              if (
                value &&
                typeof value === "object" &&
                "blobDataUrl" in value
              ) {
                row[key] = await (
                  await fetch(value.blobDataUrl as string)
                ).blob();
              }
            }
          }
        }
        await db.transaction(
          "rw",
          tables.map(([table]) => db.table(table)),
          async () => {
            for (const [table, rows] of tables)
              await db.table(table).bulkPut(rows);
          },
        );
      },
      { snapshot: preparedLibrary, modulePath: DATABASE_MODULE },
    );
    await expect(
      page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
    ).toBeVisible();
    await use({ id: preparedLibrary.books[0].id as string });
  },
});

export { expect };

/** Opens the account menu at the end of a page header. */
export async function openAccountMenu(page: Page) {
  await page.getByRole("button", { name: /^Account/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

export async function importSampleBook(page: Page): Promise<void> {
  const importButton = page.getByRole("button", {
    name: "Choose EPUB files",
    exact: true,
  });
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    importButton.click(),
  ]);
  await fileChooser.setFiles(SAMPLE_EPUB_PATH);
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible({ timeout: 30_000 });
}

/** Wait for the current spread only, including removal of the outgoing animated spread. */
export async function waitForReaderReady(page: Page | Frame): Promise<void> {
  await expect(
    page.locator(`${CURRENT_SPREAD} [data-reader-page-content]`).first(),
  ).toBeVisible();
  await page.waitForFunction((selector) => {
    const spread = document.querySelector(selector);
    if (!spread || spread.children.length !== 1) return false;
    if (spread.querySelector("[data-reader-image-pending]")) return false;
    const moving = spread
      .getAnimations({ subtree: true })
      .some((animation) => animation.playState === "running");
    const images = [...spread.querySelectorAll("img")];
    return (
      !moving &&
      document.fonts.status === "loaded" &&
      images.every((image) => image.complete && image.naturalWidth > 0)
    );
  }, CURRENT_SPREAD);
}

export async function currentPages(page: Page): Promise<string[]> {
  return page
    .locator(`${CURRENT_SPREAD} [data-reader-current-page]`)
    .evaluateAll((elements) =>
      elements.map(
        (element) => element.getAttribute("data-reader-current-page")!,
      ),
    );
}

export async function nextSpread(page: Page): Promise<void> {
  const before = await currentPages(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => currentPages(page)).not.toEqual(before);
  await waitForReaderReady(page);
}

export async function openLocalBook(page: Page, bookId: string): Promise<void> {
  // Direct entry tests startup from prepared storage without depending on hover prefetch.
  await page.goto(`/reader/${bookId}`);
  await waitForReaderReady(page);
}

/**
 * Waits for a phone Reader sheet to rest and returns it. A detent sheet
 * slides in on the browser's own scrolling and takes focus once it rests;
 * until then a tap meets a moving target and keys still go to the page. The
 * fixed-height sheet needs no wait.
 */
export async function waitForSheet(
  page: Page,
  name: string,
  { timeout }: { timeout?: number } = {},
): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name, exact: true });
  // A Debug page loads on demand, which takes a while the first time.
  await expect(dialog).toBeVisible({ timeout });
  await expect
    .poll(() =>
      dialog.evaluate((element) => {
        const overlay = element.closest(".reader-sheet-overlay");
        if (!overlay) return true;
        const sheet = element.closest(".reader-sheet")!;
        return (
          !overlay.hasAttribute("data-entering") &&
          sheet.getBoundingClientRect().top < innerHeight
        );
      }),
    )
    .toBe(true);
  return dialog;
}

/**
 * Waits until a sheet holds still: its height rests at its content's
 * (`data-sheet-fit-state`, after a tab of another height) and its top edge
 * has stopped (after a drag or a detent change). A tap on a control that is still moving can miss, and
 * Playwright's retries then scroll React Aria's sheet scroller, which closes
 * the sheet.
 */
export async function waitForSheetToRest(sheet: Locator): Promise<void> {
  await expect
    .poll(() =>
      sheet.evaluate(
        (element) =>
          new Promise<boolean>((resolve) => {
            const surface = element.closest(".reader-sheet") ?? element;
            const fit = surface.querySelector<HTMLElement>("[data-sheet-fit]");
            if (fit && fit.dataset.sheetFitState !== "rest")
              return resolve(false);
            const top = surface.getBoundingClientRect().top;
            let frames = 0;
            const check = () => {
              if (surface.getBoundingClientRect().top !== top)
                return resolve(false);
              if (++frames === 3) return resolve(true);
              requestAnimationFrame(check);
            };
            requestAnimationFrame(check);
          }),
      ),
    )
    .toBe(true);
}

/** What a sheet did while `recordSheetMotion` watched it. */
export interface SheetMotion {
  /** Each state its height went through (`data-sheet-fit-state`). */
  states: string[];
  /** Its top edge in every frame. */
  tops: number[];
  /** Its top edge in every frame of each hold. */
  holds: number[][];
}

/**
 * Records from now on what a sheet's height does and where its top edge
 * is in every frame. Returns a function that reads the record.
 */
export async function recordSheetMotion(
  sheet: Locator,
): Promise<() => Promise<SheetMotion>> {
  await sheet.evaluate((element) => {
    const surface = element.closest<HTMLElement>(".reader-sheet") ?? element;
    const fit = surface.querySelector<HTMLElement>("[data-sheet-fit]");
    const record: SheetMotion = { states: [], tops: [], holds: [] };
    (window as { __sheetMotion?: SheetMotion }).__sheetMotion = record;
    if (fit)
      new MutationObserver(() => {
        const state = fit.dataset.sheetFitState!;
        if (record.states.at(-1) === state) return;
        record.states.push(state);
        if (state === "held") record.holds.push([]);
      }).observe(fit, { attributeFilter: ["data-sheet-fit-state"] });
    const sample = () => {
      const top = surface.getBoundingClientRect().top;
      record.tops.push(top);
      if (fit?.dataset.sheetFitState === "held") record.holds.at(-1)?.push(top);
      if (surface.isConnected) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return () =>
    sheet
      .page()
      .evaluate(
        () => (window as { __sheetMotion?: SheetMotion }).__sheetMotion!,
      );
}

/** Opens Reader tools from the phone header once it shows, and waits for them. */
export async function openReaderTools(page: Page): Promise<Locator> {
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  return waitForSheet(page, "Reader tools");
}

/**
 * Opens one of the phone's Reader tools, such as Appearance or Notebook,
 * and returns its sheet once it has come in. The header must show.
 */
export async function openReaderTool(
  page: Page,
  button: string | RegExp,
  sheet: string,
): Promise<Locator> {
  const tools = await openReaderTools(page);
  await tools
    .getByRole("button", { name: button, exact: typeof button === "string" })
    .click();
  return waitForSheet(page, sheet);
}

/**
 * Closes a phone sheet as a reader does: a tap on the dimmed page above
 * it. The detent Notebook has no close button of its own.
 */
export async function closeSheet(page: Page, sheet: Locator): Promise<void> {
  const top = await sheet.evaluate(
    (element) =>
      (element.closest(".reader-sheet") ?? element).getBoundingClientRect().top,
  );
  await page.touchscreen.tap(195, Math.max(8, top / 2));
  await expect(sheet).not.toBeVisible();
}

/**
 * Selects the first `length` characters of the `index`-th text run on the
 * current spread that is long enough and clear of the header, then
 * releases the pointer, which is when the Reader reads a selection.
 */
export async function selectPassage(
  page: Page,
  { index = 0, length = 20 }: { index?: number; length?: number } = {},
): Promise<string> {
  const text = await page.evaluate(
    ({ index, length, spread }) => {
      (document.activeElement as HTMLElement | null)?.blur();
      const root = document.querySelector(spread)!;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let found = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        range.selectNodeContents(node);
        if (
          (node.textContent?.trim().length ?? 0) < length ||
          range.getBoundingClientRect().top < 120 ||
          found++ !== index
        )
          continue;
        range.setStart(node, 0);
        range.setEnd(node, length);
        getSelection()!.removeAllRanges();
        getSelection()!.addRange(range);
        return range.toString();
      }
      throw new Error("No sample passage");
    },
    { index, length, spread: CURRENT_SPREAD },
  );
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe(text);
  await page.evaluate(() =>
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true })),
  );
  return text;
}

/**
 * A tap that the Reader handles clears the selection again 80 and 240 ms
 * later. This waits on the page's own timers, so a slow machine waits longer.
 */
export async function letTapClearSelection(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

/** Shows the phone reading chrome, which carries the Notes Island capsule. */
export async function showNotesCapsule(page: Page): Promise<void> {
  const capsule = page.locator("[data-notes-capsule]");
  // A notice from the previous action owns the bottom edge for a moment.
  await expect(page.locator("[data-notes-island]")).toHaveCount(0);
  // A footer that is sliding away still shows its capsule.
  await expect(page.locator("[data-reader-footer-leaving]")).toHaveCount(0);
  if (!(await capsule.isVisible())) {
    const spread = (await page
      .locator('[data-reader-spread-layer="current"]')
      .boundingBox())!;
    await page.touchscreen.tap(
      spread.x + spread.width / 2,
      spread.y + spread.height / 2,
    );
  }
  await expect(capsule).toBeVisible();
}
