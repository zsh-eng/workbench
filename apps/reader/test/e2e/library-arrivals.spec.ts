import type { Page } from "@playwright/test";
import { epubVariant } from "./helpers/epub-variants";
import {
  expect,
  SAMPLE_BOOK_TITLE,
  SAMPLE_EPUB_PATH,
  test,
  waitForReaderReady,
  waitForSheet,
  waitForSheetToRest,
} from "./helpers/fixtures";

// Debug → Arriving books: each added book holds its place in the Library at
// once and its cover develops as it is prepared. The arrival draws with
// WebGL, which headless Chromium has only through its software GPU.
test.use({
  viewport: { width: 390, height: 844 },
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

const READY = { timeout: 30_000 };

/**
 * Turns on the trial before the app loads, and records what the page shows
 * on the way: the most places held at one time, each look an arriving cover
 * took, whether a drawing canvas was ever made, and whether the arrival
 * sheet opened.
 */
async function turnOnArrivingBooks(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
    localStorage.setItem("reader-arriving-books-v1", "true");
    localStorage.setItem(
      "reader-library-view-v1",
      JSON.stringify({ sort: "added", layout: "covers" }),
    );
    const seen = {
      places: 0,
      looks: [] as string[],
      canvas: false,
      sheet: false,
    };
    Object.assign(window, { __arrivalsSeen: seen });
    new MutationObserver(() => {
      const places = document.querySelectorAll("[data-arrival-tile]").length;
      seen.places = Math.max(seen.places, places);
      for (const cover of document.querySelectorAll("[data-arrival-look]")) {
        const look = cover.getAttribute("data-arrival-look")!;
        if (!seen.looks.includes(look)) seen.looks.push(look);
      }
      if (document.querySelector("[data-arrival-canvas]")) seen.canvas = true;
      if (document.querySelector("[data-arrival-sheet]")) seen.sheet = true;
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-arrival-look"],
    });
  });
}

function seen(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __arrivalsSeen: {
            places: number;
            looks: string[];
            canvas: boolean;
            sheet: boolean;
          };
        }
      ).__arrivalsSeen,
  );
}

/** Distinct books made from the sample: odd ones keep its cover, even ones have none. */
function books(titles: string[]) {
  return titles.map((title, index) =>
    epubVariant({
      name: `arrival-${index + 1}`,
      title,
      author: "Test Author",
      cover: index % 2 === 0 ? undefined : null,
    }),
  );
}

async function chooseFiles(
  page: Page,
  files: ReturnType<typeof books> | string,
) {
  // An empty Library offers Choose EPUB files; one with books, Add books.
  const add = page
    .getByRole("button", { name: /^(Choose EPUB files|Add books)$/ })
    .first();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    add.click(),
  ]);
  await chooser.setFiles(files);
}

/**
 * Counts the frames in which the cover flying down from the arrival sheet
 * fades, and those in which the first cover in the grid under it was not
 * drawn yet: a blank card under the fade breaks the book's identity.
 */
async function watchLanding(page: Page) {
  await page.evaluate(() => {
    const landing = { flying: 0, fading: 0, blank: 0 };
    Object.assign(window, { __landing: landing });
    const sample = () => {
      const flight = document.querySelector("[data-arrival-flight]");
      if (flight) landing.flying++;
      if (flight && Number(getComputedStyle(flight).opacity) < 1) {
        landing.fading++;
        const tile = document.querySelector("ul.grid > li");
        const canvas = tile?.querySelector("canvas[data-arrival-canvas]");
        const images = [...(tile?.querySelectorAll("img") ?? [])];
        const drawn = canvas
          ? canvas.hasAttribute("data-arrival-painted")
          : images.length > 0 &&
            images.every((image) => image.complete && image.naturalWidth > 0);
        if (!drawn) landing.blank++;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

function landing(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __landing: { flying: number; fading: number; blank: number };
        }
      ).__landing,
  );
}

async function shelfTitles(page: Page) {
  return page
    .getByRole("heading", { level: 3, name: /^Arriving book / })
    .allInnerTexts();
}

test("a batch holds every place at once and ends with each book on the shelf in order", async ({
  page,
}) => {
  const titles = [1, 2, 3, 4, 5].map((n) => `Arriving book ${n}`);
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, books(titles));

  await expect(page.getByText("Added 5 books.", { exact: true })).toBeVisible(
    READY,
  );
  expect(await shelfTitles(page)).toEqual(titles);
  // The places came together, before any book was ready, and a batch
  // stays in the grid.
  expect((await seen(page)).places).toBe(5);
  expect((await seen(page)).sheet).toBe(false);
  // The places leave once the books stand in them.
  await expect(page.locator("[data-arrival-tile]")).toHaveCount(0, READY);
  expect(await shelfTitles(page)).toEqual(titles);
});

test("one book arrives in the arrival sheet, and Read now opens it", async ({
  page,
}) => {
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, books(["Arriving book 1"]));

  const sheet = page.locator("[data-arrival-sheet]");
  await expect(
    sheet.getByRole("heading", { name: "Arriving book 1" }),
  ).toBeVisible(READY);
  // Its place in the grid waits for it, empty.
  await expect(page.locator("[data-arrival-place]")).toHaveCount(1);
  const read = sheet.getByRole("button", { name: "Read now" });
  await expect(read).toBeEnabled(READY);
  // The sheet is the confirmation: no toast, no dialog.
  await expect(page.getByText("Added 1 book.", { exact: true })).toHaveCount(0);

  // A tap waits for the sheet to hold still, as a finger would.
  await waitForSheetToRest(await waitForSheet(page, "In your library", READY));
  await read.click();
  await expect(page).toHaveURL(/\/reader\//);
  await waitForReaderReady(page);
});

test("closing the sheet early leaves the book arriving in its place", async ({
  page,
  localBook,
}) => {
  void localBook;
  await turnOnArrivingBooks(page);
  await page.reload();

  await chooseFiles(page, books(["Arriving book 1"]));
  const sheet = page.locator("[data-arrival-sheet]");
  await expect(sheet).toBeVisible(READY);
  await watchLanding(page);
  // A press on the page above the sheet closes it.
  await page.mouse.click(195, 120);

  await expect(sheet).toHaveCount(0, READY);
  await expect(page.locator("[data-arrival-flight]")).toHaveCount(0, READY);
  // The cover flew down and let go only over its place, drawn.
  expect(await landing(page)).toMatchObject({ blank: 0 });
  expect((await landing(page)).fading).toBeGreaterThan(0);
  const titles = page.getByRole("heading", { level: 3 });
  await expect(titles.first()).toHaveText("Arriving book 1", READY);
  await expect(titles.nth(1)).toHaveText(SAMPLE_BOOK_TITLE);
  // The book lands for good: its place is no longer held for the sheet.
  await expect(page.locator("[data-arrival-place]")).toHaveCount(0);
  await expect(page.locator("[data-arrival-tile]")).toHaveCount(0, READY);
  await expect(titles.first()).toHaveText("Arriving book 1");
});

test("closing the sheet once the book is ready lands it on its own cover", async ({
  page,
}) => {
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, books(["Arriving book 1"]));
  const sheet = page.locator("[data-arrival-sheet]");
  await expect(sheet.getByRole("button", { name: "Read now" })).toBeEnabled(
    READY,
  );
  // Focus is in the sheet once it has come up; Escape closes it.
  const dialog = await waitForSheet(page, "In your library", READY);
  await waitForSheetToRest(dialog);
  await expect(dialog).toBeFocused();
  await watchLanding(page);
  await page.keyboard.press("Escape");

  await expect(page.locator("[data-arrival-flight]")).toHaveCount(0, READY);
  expect(await landing(page)).toMatchObject({ blank: 0 });
  expect((await landing(page)).fading).toBeGreaterThan(0);
  await expect(page.locator("[data-arrival-place]")).toHaveCount(0);
});

test("the same book again shows the copy you have in the sheet", async ({
  page,
  localBook,
}) => {
  await turnOnArrivingBooks(page);
  await page.reload();

  await chooseFiles(page, SAMPLE_EPUB_PATH);

  const sheet = page.locator('[data-arrival-sheet="duplicate"]');
  await expect(sheet).toBeVisible(READY);
  // The sheet answers; the grid holds no place for a book that is not coming.
  await expect(page.locator("[data-arrival-tile]")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Book already added" }),
  ).toHaveCount(0);
  await waitForSheetToRest(
    await waitForSheet(page, "Already in your library", READY),
  );
  await sheet.getByRole("button", { name: "Read now" }).click();
  await expect(page).toHaveURL(`/reader/${localBook.id}`);
  await waitForReaderReady(page);
});

/** What the database holds of books and their files. */
function stored(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/db.ts";
    const { db } = await import(path);
    return {
      books: await db.books.count(),
      files: await db.files.count(),
      uploads: await db.fileUploadOperations.count(),
    };
  });
}

test("a file that is no book says why in the sheet, and another file arrives", async ({
  page,
}) => {
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, [
    {
      name: "Paper.epub",
      mimeType: "application/epub+zip",
      buffer: Buffer.from("%PDF-1.7\n1 0 obj"),
    },
  ]);

  const sheet = page.locator('[data-arrival-sheet="failed"]');
  const dialog = await waitForSheet(page, "Couldn’t add this book", READY);
  await expect(sheet.getByText("Not an EPUB", { exact: true })).toBeVisible();
  await expect(sheet.locator("[data-arrival-detail]")).toHaveText(
    "It’s a PDF renamed to .epub. Reader opens EPUB books only. Add an EPUB copy instead.",
  );
  // The same file cannot work again: the sheet offers another instead.
  await expect(sheet.getByRole("button", { name: "Try again" })).toHaveCount(0);
  expect(await stored(page)).toEqual({ books: 0, files: 0, uploads: 0 });

  await waitForSheetToRest(dialog);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    sheet.getByRole("button", { name: "Choose another file" }).click(),
  ]);
  await chooser.setFiles(books(["Arriving book 1"]));
  await expect(
    page
      .locator("[data-arrival-sheet]")
      .getByRole("heading", { name: "Arriving book 1" }),
  ).toBeVisible(READY);
  await expect(
    page.locator("[data-arrival-sheet]").getByRole("button", {
      name: "Read now",
    }),
  ).toBeEnabled(READY);
  // The file you moved on from holds no place.
  await expect(page.locator('[data-arrival-tile="failed"]')).toHaveCount(0);
});

test("a batch says how it went, and why a file was not added", async ({
  page,
}) => {
  const [first, second] = books(["Arriving book 1", "Arriving book 2"]);
  // Cut off mid-download.
  const cut = {
    name: "cut.epub",
    mimeType: "application/epub+zip",
    buffer: first!.buffer.subarray(0, first!.buffer.length / 2),
  };
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, [first!, cut, second!]);

  await expect(
    page.getByText("2 added, 1 couldn’t be added.", { exact: true }),
  ).toBeVisible(READY);
  // Its place stays and says why; the same file cannot work again.
  const failed = page.locator('[data-arrival-tile="failed"]');
  await expect(failed).toContainText("File is damaged");
  await expect(failed.getByRole("button", { name: "Try again" })).toHaveCount(
    0,
  );
  expect(await stored(page)).toMatchObject({ books: 2 });

  await page.getByRole("button", { name: "See why", exact: true }).click();
  const why = await waitForSheet(page, "1 file wasn’t added");
  await expect(why.locator("[data-import-outcome]")).toHaveText([
    /^cut\.epubFile is damaged.*Download it again, then add the new copy\.$/,
  ]);
});

test("with reduced motion an arriving cover never moves", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const titles = ["Arriving book 1", "Arriving book 2"];
  await turnOnArrivingBooks(page);
  await page.goto("/");

  await chooseFiles(page, books(titles));

  await expect(page.getByText("Added 2 books.", { exact: true })).toBeVisible(
    READY,
  );
  expect(await shelfTitles(page)).toEqual(titles);
  const { looks, canvas } = await seen(page);
  expect(canvas).toBe(false);
  expect(looks).toContain("still");
  expect(looks.every((look) => look === "still" || look === "type")).toBe(true);
});

test("Design ideas compare the looks on a simulated batch", async ({
  page,
}) => {
  await page.goto("/debug/ideas/arriving-books?look=develop&state=five");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible(READY);
  await expect(page.getByText("Added 5 books.", { exact: true })).toBeVisible(
    READY,
  );
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator("[data-arrival-tile]").first()).toBeVisible();
  await expect(page.getByText("Added 5 books.", { exact: true })).toBeVisible(
    READY,
  );
});
