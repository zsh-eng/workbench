import { db, deleteBook, type Book } from "@/lib/db";
import { files, type FileId } from "@/lib/files";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it } from "vitest";

describe("deleting a book", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    localStorage.clear();
  });

  it("removes its EPUB and cover, and their uploads, unless another book uses them", async () => {
    const source = await files.put(blob("first book"));
    const cover = await files.put(blob("shared cover"));
    const otherSource = await files.put(blob("second book"));
    await db.books.bulkPut([
      { ...book("first", source, cover), isDeleted: false },
      { ...book("second", otherSource, cover), isDeleted: false },
    ]);

    await deleteBook("first");

    expect(await db.files.get(source)).toBeUndefined();
    expect(await db.fileUploadOperations.get(source)).toBeUndefined();
    // The second book still shows the same cover.
    expect(await db.files.get(cover)).toBeDefined();
    expect(await db.fileUploadOperations.get(cover)).toBeDefined();
    expect(await db.files.get(otherSource)).toBeDefined();

    await deleteBook("second");

    expect(await db.files.count()).toBe(0);
    expect(await db.fileUploadOperations.count()).toBe(0);
  });
});

function blob(text: string): Blob {
  return new NodeBlob([text], {
    type: "application/epub+zip",
  }) as unknown as Blob;
}

function book(id: string, sourceFileId: FileId, cover: FileId): Book {
  return {
    id,
    sourceFileId,
    cover: { fileId: cover, blurHash: null },
    title: id,
    author: "Author",
    fileSize: 1,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
  };
}
