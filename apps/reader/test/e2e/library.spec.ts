import type { Page } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { readFile } from "node:fs/promises";
import {
  expect,
  SAMPLE_BOOK_TITLE,
  SAMPLE_EPUB_PATH,
  test,
  waitForReaderReady,
  waitForSheet,
  nextSpread,
  showNotesCapsule,
} from "./helpers/fixtures";

/** What the database holds of books and their files. */
function storedCounts(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/db.ts";
    const { db } = await import(path);
    return {
      books: await db.books.count(),
      bookFiles: await db.bookFiles.count(),
      files: await db.files.count(),
      uploads: await db.fileUploadOperations.count(),
    };
  });
}

test.describe("Library", () => {
  test("imports a book from the file picker and opens it at once", async ({
    page,
    addSampleBook,
  }) => {
    await page.goto("/");
    await addSampleBook();

    const artifacts = await page.evaluate(async () => {
      const readRequest = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("epub-reader-db-v2");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const transaction = database.transaction(
        ["books", "files", "bookFiles", "bookMaterializations"],
        "readonly",
      );
      const [books, localFiles, expandedFiles, materializations] =
        (await Promise.all([
          readRequest(transaction.objectStore("books").getAll()),
          readRequest(transaction.objectStore("files").getAll()),
          readRequest(transaction.objectStore("bookFiles").getAll()),
          readRequest(transaction.objectStore("bookMaterializations").getAll()),
        ])) as Record<string, unknown>[][];
      database.close();

      const book = books.find((row) => row.isDeleted !== true);
      if (!book) throw new Error("Imported Book row was not stored");
      const cover = book.cover as {
        fileId: string;
        blurHash: string | null;
      } | null;
      if (!cover) throw new Error("Imported Book has no cover reference");
      const localCover = localFiles.find((row) => row.id === cover.fileId);
      if (!localCover) throw new Error("Optimized cover file was not stored");
      const coverBlob = localCover.blob as Blob;
      const bitmap = await createImageBitmap(coverBlob);
      const marker = materializations.find((row) => row.bookId === book.id);

      const result = {
        sourceFileId: book.sourceFileId,
        blurHash: cover.blurHash,
        coverType: coverBlob.type,
        coverSize: coverBlob.size,
        coverWidth: bitmap.width,
        coverHeight: bitmap.height,
        expandedFileCount: expandedFiles.filter((row) => row.bookId === book.id)
          .length,
        materializedSourceFileId: marker?.sourceFileId,
        materializationRecipeVersion: marker?.recipeVersion,
      };
      bitmap.close();
      return result;
    });

    expect(artifacts.coverType).toBe("image/webp");
    expect(artifacts.coverSize).toBeGreaterThan(0);
    expect(artifacts.coverWidth).toBe(480);
    expect(artifacts.coverHeight).toBeGreaterThan(0);
    expect(artifacts.blurHash).toHaveLength(28);
    expect(artifacts.expandedFileCount).toBeGreaterThan(0);
    expect(artifacts.materializedSourceFileId).toBe(artifacts.sourceFileId);
    expect(artifacts.materializationRecipeVersion).toBe(1);

    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await waitForReaderReady(page);
    await nextSpread(page);
  });

  test("search narrows the page from the title, and typing starts it", async ({
    page,
    localBook,
  }) => {
    expect(localBook.id).toBeTruthy();
    const bookHeading = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
    const searchInput = page.getByRole("searchbox", { name: "Search library" });
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await searchInput.fill("Alice");
    await expect(bookHeading).toBeVisible();
    await expect(page.getByText("1 of 1", { exact: true })).toBeVisible();
    await searchInput.fill("Nonexistent Book");
    await expect(
      page.getByText("No books match “Nonexistent Book”."),
    ).toBeVisible();
    await expect(bookHeading).not.toBeVisible();
    // Escape clears the search, then closes it.
    await searchInput.press("Escape");
    await expect(searchInput).toHaveValue("");
    await expect(bookHeading).toBeVisible();
    await searchInput.press("Escape");
    await expect(searchInput).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Places" }),
    ).toBeVisible();
    await page.keyboard.press("Slash");
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue("");
    await searchInput.press("Escape");
    await expect(searchInput).toHaveCount(0);

    // A letter typed on the page starts a search with it.
    await page.keyboard.type("won");
    await expect(searchInput).toBeFocused();
    await expect(searchInput).toHaveValue("won");
    await expect(bookHeading).toBeVisible();
    await searchInput.press("Enter");
    await expect(page).toHaveURL(`/reader/${localBook.id}`);
  });
});

test("mobile import offers Open book after durable preparation without opening automatically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Choose EPUB files", exact: true })
    .click();
  await (await chooser).setFiles(SAMPLE_EPUB_PATH);
  const openBook = page.getByRole("button", { name: "Open book", exact: true });
  await expect(openBook).toBeVisible();
  await expect(
    page.locator("[data-sonner-toast]").filter({ has: openBook }),
  ).toContainText("Added 1 book.");
  await expect(page).toHaveURL(/\/$/);
  const prepared = await page.evaluate(async (modulePath) => {
    const { syncV2Db: db } = await import(modulePath);
    const book = await db.books.toCollection().first();
    const marker = await db.bookMaterializations.get(book.id);
    return {
      id: book.id,
      source: book.sourceFileId,
      markerSource: marker?.sourceFileId,
      entries: await db.bookFiles.where("bookId").equals(book.id).count(),
    };
  }, "/src/lib/sync-v2/db.ts");
  expect(prepared.markerSource).toBe(prepared.source);
  expect(prepared.entries).toBeGreaterThan(0);
  await openBook.click();
  await expect(page).toHaveURL(new RegExp(`/reader/${prepared.id}$`));
  await waitForReaderReady(page);
});

test("updates reading status and library placement while offline", async ({
  page,
  localBook,
  context,
}) => {
  await context.setOffline(true);
  const book = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
  const shelf = page.getByRole("region", { name: "Reading" });
  await book.click({ button: "right" });
  await page
    .getByRole("menuitemradio", { name: "Reading", exact: true })
    .click();
  // A book you are reading shows once, on the shelf.
  await expect(
    shelf.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
  await expect(book).toHaveCount(1);
  await book.click({ button: "right" });
  await page
    .getByRole("menuitemradio", { name: "Finished", exact: true })
    .click();
  await expect(shelf).not.toBeVisible();
  await page.getByRole("button", { name: "Finished", exact: true }).click();
  await expect(book).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const modulePath = "/src/lib/db.ts";
        return (await import(modulePath)).getReadingStatus(id);
      }, localBook.id),
    )
    .toBe("finished");
});

test("keeps duplicate and failed imports in the Library", async ({
  page,
  localBook,
}) => {
  const drop = async (name: string, bytes: Buffer) => {
    const dataTransfer = await page.evaluateHandle(
      ({ name, bytes }) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([new Uint8Array(bytes)], name, {
            type: "application/epub+zip",
          }),
        );
        return transfer;
      },
      { name, bytes: [...bytes] },
    );
    await page
      .getByRole("heading", { name: SAMPLE_BOOK_TITLE })
      .dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
  };
  await drop("sample.epub", await readFile(SAMPLE_EPUB_PATH));
  await expect(
    page.getByRole("heading", { name: "Book already added" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open book", exact: true }).click();
  await expect(page).toHaveURL(`/reader/${localBook.id}`);
  await waitForReaderReady(page);
  await page.goto("/");
  const before = await storedCounts(page);
  await drop("broken.epub", Buffer.from("invalid EPUB"));
  // The toast says what the file is and what to do.
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Not an EPUB" }),
  ).toContainText("another kind of file, such as a PDF, MOBI or AZW");
  await expect(page).toHaveURL("/");
  // The file left nothing: no stored bytes, rows or upload.
  expect(await storedCounts(page)).toEqual(before);
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
});

test("a full disk says so, leaves nothing behind, and Try again adds the book", async ({
  page,
}) => {
  await page.goto("/");
  // The next write of a book's files fails as a full disk does.
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name !== "bookFiles") return put.apply(this, args);
      IDBObjectStore.prototype.put = put;
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    };
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles(SAMPLE_EPUB_PATH);

  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Not enough storage" });
  await expect(toast).toContainText("Free up some space, then try again.");
  expect(await storedCounts(page)).toEqual({
    books: 0,
    bookFiles: 0,
    files: 0,
    uploads: 0,
  });

  // The same toast tries again and says how it went.
  await toast.evaluate((element) => element.setAttribute("data-probe", ""));
  await toast.getByRole("button", { name: "Try again", exact: true }).click();
  const same = page.locator("[data-sonner-toast][data-probe]");
  await expect(same).toContainText("Added 1 book.");
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(1);
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
  expect(await storedCounts(page)).toMatchObject({ books: 1 });
});

test("reports mixed multi-file import outcomes without opening a book", async ({
  page,
}) => {
  const original = await readFile(SAMPLE_EPUB_PATH);
  const entries = unzipSync(original);
  const opf = Object.keys(entries).find((path) => path.endsWith(".opf"))!;
  entries[opf] = strToU8(
    strFromU8(entries[opf]).replaceAll(
      "Alice's Adventures in Wonderland",
      "Second fixture book",
    ),
  );
  const second = Buffer.from(zipSync(entries));
  await page.goto("/");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page
      .getByRole("button", { name: "Choose EPUB files", exact: true })
      .click(),
  ]);
  await chooser.setFiles([
    { name: "sample.epub", mimeType: "application/epub+zip", buffer: original },
    { name: "second.epub", mimeType: "application/epub+zip", buffer: second },
    {
      name: "duplicate.epub",
      mimeType: "application/epub+zip",
      buffer: original,
    },
    {
      name: "broken.epub",
      mimeType: "application/epub+zip",
      buffer: Buffer.from("invalid"),
    },
    {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("ignored"),
    },
  ]);
  await expect(
    page.getByText("2 added, 1 already in your library, 2 couldn’t be added."),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
  // See why says, for each file, why it was not added.
  await page.getByRole("button", { name: "See why", exact: true }).click();
  const why = await waitForSheet(page, "3 files weren’t added");
  await expect(why.locator("[data-import-outcome]")).toHaveText([
    /^duplicate\.epubAlready in your library/,
    /^broken\.epubNot an EPUB/,
    /^notes\.txtNot an EPUB/,
  ]);
  const count = await page.evaluate(async () => {
    const path = "/src/lib/db.ts";
    return (await (await import(path)).getAllBooks()).length;
  });
  expect(count).toBe(2);
});

for (const phone of [false, true])
  test.describe(phone ? "phone" : "desktop", () => {
    test.use(
      phone
        ? {
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            isMobile: true,
          }
        : { viewport: { width: 1280, height: 800 } },
    );
    test("returning from a book restores the Library scroll position", async ({
      page,
      localBook,
    }) => {
      // Newer copies sort first, so the original book sits below the fold.
      await page.evaluate(async (id) => {
        const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
        const book = (await db.books.get(id))!;
        await db.books.bulkPut(
          Array.from({ length: 30 }, (_, index) => ({
            ...book,
            id: `${id}-shelf-${index}`,
            sourceFileId: `${book.sourceFileId}-shelf-${index}`,
            title: `Shelf copy ${index + 1}`,
            dateAdded: book.dateAdded + index + 1,
          })),
        );
      }, localBook.id);
      const original = page.getByRole("link", { name: /^Open Alice/ });
      await original.scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => Math.round(window.scrollY));
      expect(before).toBeGreaterThan(400);
      // A phone has no pointer to rest over a book and prefetch it.
      if (phone) await original.tap();
      else await original.click();
      await expect(page).toHaveURL(`/reader/${localBook.id}`);
      await waitForReaderReady(page);
      if (phone) {
        // The capsule shows once the chrome has settled in view.
        await showNotesCapsule(page);
        await page.getByRole("button", { name: "Back to library" }).tap();
      } else await page.goBack();
      await expect(page).toHaveURL("/");
      await expect(original).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => Math.round(window.scrollY)))
        .toBe(before);
    });
  });
