import type { Page } from "@playwright/test";
import { epubVariant } from "./helpers/epub-variants";
import { expect, test } from "./helpers/fixtures";

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
 * took, and whether a drawing canvas was ever made.
 */
async function turnOnArrivingBooks(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
    localStorage.setItem("reader-arriving-books-v1", "true");
    localStorage.setItem(
      "reader-library-view-v1",
      JSON.stringify({ sort: "added", layout: "covers" }),
    );
    const seen = { places: 0, looks: [] as string[], canvas: false };
    Object.assign(window, { __arrivalsSeen: seen });
    new MutationObserver(() => {
      const places = document.querySelectorAll("[data-arrival-tile]").length;
      seen.places = Math.max(seen.places, places);
      for (const cover of document.querySelectorAll("[data-arrival-look]")) {
        const look = cover.getAttribute("data-arrival-look")!;
        if (!seen.looks.includes(look)) seen.looks.push(look);
      }
      if (document.querySelector("[data-arrival-canvas]")) seen.canvas = true;
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
          __arrivalsSeen: { places: number; looks: string[]; canvas: boolean };
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

async function chooseFiles(page: Page, files: ReturnType<typeof books>) {
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles(files);
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
  // The places came together, before any book was ready.
  expect((await seen(page)).places).toBe(5);
  // The places leave once the books stand in them.
  await expect(page.locator("[data-arrival-tile]")).toHaveCount(0, READY);
  expect(await shelfTitles(page)).toEqual(titles);
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
  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible(
    READY,
  );
  await expect(page.getByText("Added 5 books.", { exact: true })).toBeVisible(
    READY,
  );
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator("[data-arrival-tile]").first()).toBeVisible();
  await expect(page.getByText("Added 5 books.", { exact: true })).toBeVisible(
    READY,
  );
});
