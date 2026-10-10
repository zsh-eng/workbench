import {
  expect,
  SAMPLE_BOOK_TITLE,
  test,
  waitForReaderReady,
  nextSpread,
  showNotesCapsule,
} from "./helpers/fixtures";

test.describe("Library", () => {
  test("should display empty library initially", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Your library is empty")).toBeVisible();
    await expect(
      page.getByText("Drag and drop an EPUB file here", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import EPUB" }),
    ).toBeVisible();
  });

  test("should add a book via file picker", async ({ page, addSampleBook }) => {
    await page.goto("/");
    await addSampleBook();
    await expect(page.getByText("Your library is empty")).not.toBeVisible();

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
  });

  test("should search books by title", async ({ page, localBook }) => {
    expect(localBook.id).toBeTruthy();
    const bookHeading = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
    const searchInput = page.getByRole("searchbox", { name: "Search library" });
    await searchInput.fill("Alice");
    await expect(bookHeading).toBeVisible();
    await searchInput.fill("Nonexistent Book");
    await expect(page.getByText("Nothing on these shelves")).toBeVisible();
    await expect(bookHeading).not.toBeVisible();
    await searchInput.fill("");
    await expect(bookHeading).toBeVisible();
  });

  test("should open a book from library", async ({ page, localBook }) => {
    await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
    await expect(page).toHaveURL(`/reader/${localBook.id}`);
  });
});

test("updates reading status and library placement while offline", async ({
  page,
  localBook,
  context,
}) => {
  await context.setOffline(true);
  const book = page.getByRole("heading", { name: SAMPLE_BOOK_TITLE });
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Reading", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Continue reading", exact: true }),
  ).toBeVisible();
  await book.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Finished", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Continue reading", exact: true }),
  ).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const modulePath = "/src/lib/db.ts";
        return (await import(modulePath)).getReadingStatus(id);
      }, localBook.id),
    )
    .toBe("finished");
});

test("imports then immediately opens a new EPUB", async ({
  page,
  addSampleBook,
}) => {
  await page.goto("/");
  await addSampleBook();
  await page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }).click();
  await waitForReaderReady(page);
  await nextSpread(page);
});

test("keeps duplicate and failed imports in the Library", async ({
  page,
  localBook,
}) => {
  const { SAMPLE_EPUB_PATH } = await import("./helpers/fixtures");
  const { readFile } = await import("node:fs/promises");
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
  await drop("broken.epub", Buffer.from("invalid EPUB"));
  await expect(
    page.getByText("Could not add 1 book.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: SAMPLE_BOOK_TITLE }),
  ).toBeVisible();
});

test("reports mixed multi-file import outcomes without opening a book", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import("fflate");
  const { SAMPLE_EPUB_PATH } = await import("./helpers/fixtures");
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
    page.getByRole("button", { name: "Import EPUB", exact: true }).click(),
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
  await expect(page.getByText("Added 2; skipped 2; failed 1.")).toBeVisible();
  await expect(page).toHaveURL("/");
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
      await original.click();
      await expect(page).toHaveURL(`/reader/${localBook.id}`);
      await waitForReaderReady(page);
      if (phone) {
        // The capsule shows once the chrome has settled in view.
        await showNotesCapsule(page);
        await page.getByRole("button", { name: "Back to library" }).click();
      } else await page.goBack();
      await expect(page).toHaveURL("/");
      await expect(original).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => Math.round(window.scrollY)))
        .toBe(before);
    });
  });
