import {
  currentPages,
  expect,
  nextSpread,
  openLocalBook,
  test,
  waitForReaderReady,
  SAMPLE_EPUB_PATH,
} from "./helpers/fixtures";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
});

test("the Reading shelf puts the book you read last first", async ({
  page,
  localBook,
}) => {
  // Prepare a second valid EPUB through the importer. Distinct source bytes
  // preserve the database's unique source-file invariant.
  const entries = unzipSync(await readFile(SAMPLE_EPUB_PATH));
  const opf = Object.keys(entries).find((path) => path.endsWith(".opf"))!;
  entries[opf] = strToU8(
    strFromU8(entries[opf]).replaceAll(
      "Alice's Adventures in Wonderland",
      "Second local book",
    ),
  );
  // A populated Library accepts another EPUB through its drop target.
  const dataTransfer = await page.evaluateHandle(
    (bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array(bytes)], "second.epub", {
          type: "application/epub+zip",
        }),
      );
      return transfer;
    },
    [...zipSync(entries)],
  );
  await page
    .getByRole("heading", { name: /Alice/ })
    .dispatchEvent("drop", { dataTransfer });
  await dataTransfer.dispose();
  await expect(
    page.getByRole("heading", { name: "Second local book", exact: true }),
  ).toBeVisible();
  const secondId = await page.evaluate(async () => {
    const dataPath = "/src/lib/db.ts";
    const data = await import(dataPath);
    const books = await data.getAllBooks();
    return books.find(
      (book: { title: string }) => book.title === "Second local book",
    ).id as string;
  });
  await page.evaluate(
    async ({ firstId, secondId }) => {
      const dataPath = "/src/lib/db.ts";
      const data = await import(dataPath);
      await data.setReadingStatus(firstId, "reading");
      await data.setReadingStatus(secondId, "reading");
      for (const [index, id] of [firstId, secondId].entries()) {
        await data.upsertCurrentDeviceReadingCheckpoint({
          bookId: id,
          currentSpineIndex: 0,
          scrollProgress: 0,
          lastRead: Date.now() - (index + 1) * 10 * 60_000,
        });
      }
    },
    { firstId: localBook.id, secondId },
  );
  await page.reload();

  const shelf = page.getByRole("region", { name: "Reading", exact: true });
  const order = () =>
    shelf
      .getByRole("link", { name: /^Open / })
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  await expect
    .poll(order)
    .toEqual([`/reader/${localBook.id}`, `/reader/${secondId}`]);

  await shelf
    .getByRole("link", { name: "Open Second local book", exact: true })
    .click();
  await expect(page).toHaveURL(`/reader/${secondId}`);
  await waitForReaderReady(page);
  await page.mouse.move(200, 10);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect
    .poll(order)
    .toEqual([`/reader/${secondId}`, `/reader/${localBook.id}`]);
});

test("the Reading shelf shows how far through the book's pages you are", async ({
  page,
  localBook,
}) => {
  await page.evaluate(async (bookId) => {
    const dataPath = "/src/lib/db.ts";
    await (await import(dataPath)).setReadingStatus(bookId, "reading");
  }, localBook.id);
  await openLocalBook(page, localBook.id);
  for (let index = 0; index < 10; index++) await nextSpread(page);
  const checkpoint = () =>
    page.evaluate(async (bookId) => {
      const modulePath = "/src/lib/sync-v2/db.ts";
      const { syncV2Db: db } = await import(modulePath);
      return db.readingCheckpoints.where("bookId").equals(bookId).first();
    }, localBook.id);
  // Page numbers are final once the whole book is paginated in the background.
  await expect
    .poll(async () => (await checkpoint())?.bookProgress)
    .toBeGreaterThan(0);
  await page.mouse.move(720, 880);
  const indicator = await page
    .getByText(/ of \d+$/)
    .first()
    .textContent();
  const totalPages = Number(/ of (\d+)$/.exec(indicator ?? "")?.[1]);
  const [leadingPage] = await currentPages(page);
  const expected = (Number(leadingPage) - 1) / (totalPages - 1);
  expect((await checkpoint()).bookProgress).toBeCloseTo(expected, 5);

  await page.mouse.move(200, 10);
  await page.getByRole("button", { name: "Library", exact: true }).click();
  const shelf = page.getByRole("region", { name: "Reading", exact: true });
  await expect(shelf.getByText(`${Math.round(expected * 100)}%`)).toBeVisible();
});
