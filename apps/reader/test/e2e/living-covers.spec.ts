import type { Page } from "@playwright/test";
import { expect, test } from "./helpers/fixtures";

// Living covers draw with WebGL. Headless Chromium needs its software GPU.
// A cold dev server compiles the lazy engine on first use, hence READY.
test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

const DATABASE_MODULE = "/src/lib/sync-v2/db.ts";
const READY = { timeout: 15_000 };
const ALICE_MAPS = "/src/features/living-covers/scenes/alice";

/** Debug mode with living covers on in the Library, before the app loads. */
async function turnOnLivingCovers(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("reader-debug-enabled-v1", "true");
    localStorage.setItem(
      "reader-library-view-v1",
      JSON.stringify({ sort: "added", layout: "covers", livingCovers: true }),
    );
  });
}

async function coverFileId(page: Page): Promise<string> {
  return page.evaluate(async (modulePath) => {
    const { syncV2Db: db } = await import(modulePath);
    const [book] = await db.books.toArray();
    return book.cover.fileId as string;
  }, DATABASE_MODULE);
}

/**
 * A local scene, as the dev server would serve it from the git-ignored
 * folder, drawn for the given cover file id. Its maps are the committed
 * public-domain Alice scene.
 */
async function serveLocalScene(
  page: Page,
  fileId: string,
  life: Record<string, unknown> = {},
) {
  await page.route("**/__living-covers/manifest.json", (route) =>
    route.fulfill({
      json: {
        scenes: [
          {
            id: "test-scene",
            url: "/__living-covers/test-scene/scene.json",
            cover: null,
          },
        ],
      },
    }),
  );
  await page.route("**/__living-covers/test-scene/scene.json", (route) =>
    route.fulfill({
      json: {
        version: 1,
        title: "Test scene",
        covers: [fileId],
        maps: { depth: `${ALICE_MAPS}/depth.webp` },
        parallax: 0.05,
        relief: 0.01,
        life,
      },
    }),
  );
}

function libraryCover(page: Page) {
  return page
    .getByRole("link", { name: /^Open Alice/ })
    .locator("[data-living]");
}

test("a cover finds its hand-made scene by its file id", async ({
  page,
  localBook: _book,
}) => {
  const fileId = await coverFileId(page);
  await serveLocalScene(page, fileId);
  await turnOnLivingCovers(page);
  await page.reload();
  const cover = libraryCover(page);
  await expect(cover).toHaveAttribute("data-scene", "test-scene", READY);
  await expect(cover).toHaveAttribute("data-living", "ready");
  await expect(cover.locator("canvas")).toHaveCount(1);
});

test("a cover without a scene shows the automatic sheen", async ({
  page,
  localBook: _book,
}) => {
  await turnOnLivingCovers(page);
  await page.reload();
  const cover = libraryCover(page);
  await expect(cover).toHaveAttribute("data-scene", "default", READY);
  await expect(cover).toHaveAttribute("data-living", "ready");
  await expect(cover.locator("canvas")).toHaveCount(1);
});

test("with reduced motion, a scene with life holds one still frame", async ({
  page,
  localBook: _book,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const fileId = await coverFileId(page);
  await serveLocalScene(page, fileId, {
    glints: [{ x: 0.5, y: 0.3, size: 0.03, phase: 0, color: [1, 1, 1] }],
  });
  await turnOnLivingCovers(page);
  await page.reload();
  const cover = libraryCover(page);
  await expect(cover).toHaveAttribute("data-living", "still", READY);
  const draws = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __livingCoverStats: () => { draws: number; animating: boolean };
        }
      ).__livingCoverStats(),
    );
  const before = await draws();
  await page.waitForTimeout(600);
  const after = await draws();
  expect(after.animating).toBe(false);
  expect(after.draws).toBe(before.draws);
});

test("the Library opens a book from a living cover", async ({
  page,
  localBook,
}) => {
  await turnOnLivingCovers(page);
  await page.reload();
  const cover = libraryCover(page);
  await expect(cover).toHaveAttribute("data-living", "ready", READY);
  await page.getByRole("link", { name: /^Open Alice/ }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${localBook.id}$`));
  await expect(
    page.locator("[data-reader-page-content]").first(),
  ).toBeVisible();
});

test("Design ideas shows living covers with the hand-made maps", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("reader-debug-enabled-v1", "true"),
  );
  await page.goto("/debug/ideas/living-covers?variant=hero&scene=alice");
  const cover = page.locator("[data-living]");
  await expect(cover).toHaveAttribute("data-scene", "alice", READY);
  await expect(cover).toHaveAttribute("data-living", "ready");
  await page.getByRole("button", { name: "Depth", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Depth", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Next book" }).click();
  await expect(cover).not.toHaveAttribute("data-scene", "alice", READY);
});
