import type { BrowserContext, Page } from "@playwright/test";
import { MAX_SYNC_VALUE_BYTES } from "@zsh-eng/local-sync";
import { LARGE_TECHNICAL_BOOK, largeEpub } from "../fixtures/large-epub";
import {
  expect,
  openAccountMenu,
  test,
  waitForReaderReady,
} from "./helpers/fixtures";
import { mockApi } from "./helpers/mock-api";

// A large technical book: its table of contents alone is several times the
// 64 KiB a synced record holds. The mock API validates every push with the
// server's own schema.
test.use({
  signedIn: true,
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

const epub = largeEpub();
const shape = LARGE_TECHNICAL_BOOK;
const topics =
  shape.chapters *
  shape.sectionsPerChapter *
  shape.subsectionsPerSection *
  shape.topicsPerSubsection;

type StoredFiles = Map<string, { body: Buffer; contentType: string }>;

/** The account's file storage: uploads land here, downloads read from it. */
async function routeFiles(context: BrowserContext, stored: StoredFiles) {
  await context.route("**/api/files/*", async (route) => {
    const request = route.request();
    const id = decodeURIComponent(
      new URL(request.url()).pathname.split("/").at(-1)!,
    );
    if (request.method() === "PUT") {
      const body = request.postDataBuffer()!;
      const contentType = request.headers()["content-type"]!;
      stored.set(id, { body, contentType });
      await route.fulfill({
        json: {
          id,
          fileSize: body.byteLength,
          mediaType: contentType,
          createdAt: Date.now(),
        },
      });
      return;
    }
    const file = stored.get(id);
    if (!file)
      return route.fulfill({ status: 404, json: { error: "No file" } });
    await route.fulfill({ body: file.body, contentType: file.contentType });
  });
}

/** Opens Contents in the desktop Reader tools and waits for its entries. */
async function openContents(page: Page) {
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Contents", exact: true }).click();
  return tools;
}

async function expectWholeContents(page: Page) {
  const tools = await openContents(page);
  // The fourth level exists only in the EPUB's own contents, not in the row.
  await expect(tools.getByText(epub.lastTopic, { exact: true })).toBeAttached();
  await expect(tools.getByText(/^\d+\.\d+\.\d+\.\d+ /)).toHaveCount(topics);
}

test("a book with a huge table of contents imports, syncs, and opens whole on another device", async ({
  page,
  context,
  remote,
  browser,
}) => {
  const stored: StoredFiles = new Map();
  await routeFiles(context, stored);
  await page.goto("/");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles({
    name: "handbook.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from(epub.bytes),
  });
  await expect(
    page.getByRole("heading", { name: shape.title, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  const bookId = await page.evaluate(async () => {
    const { syncV2Db } = await import("/src/lib/sync-v2/db.ts");
    return (await syncV2Db.books.toArray())[0]!.id as string;
  });

  const menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: /^Sync now:/ }).click();
  const key = JSON.stringify(["books", bookId]);
  await expect
    .poll(() => remote.pushed.some((change) => change.key === key))
    .toBe(true);
  const pushedBook = remote.pushed.find((change) => change.key === key)!;
  expect(Buffer.byteLength(pushedBook.value)).toBeLessThanOrEqual(
    MAX_SYNC_VALUE_BYTES,
  );
  await expect.poll(() => stored.size).toBe(2); // The EPUB and its cover.

  await page.goto(`/reader/${bookId}`);
  await waitForReaderReady(page);
  await expectWholeContents(page);

  // Another device on the same account, with an empty library.
  const other = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
  });
  try {
    const otherRemote = await mockApi(other, true);
    for (const change of remote.pushed) otherRemote.enqueue(change);
    await routeFiles(other, stored);
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    const otherMenu = await openAccountMenu(otherPage);
    await otherMenu.getByRole("menuitem", { name: /^Sync now:/ }).click();
    await expect(
      otherPage.getByRole("heading", { name: shape.title, exact: true }),
    ).toBeVisible();

    await otherPage.goto(`/reader/${bookId}`);
    await waitForReaderReady(otherPage);
    await expectWholeContents(otherPage);
    expect(otherRemote.unexpected, "Unexpected API requests").toEqual([]);
  } finally {
    await other.close();
  }
});
