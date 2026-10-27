import type { BrowserContext, Page } from "@playwright/test";
import { importSampleBook } from "../helpers/fixtures";
import { DATABASE_MODULE } from "../helpers/global-setup";
import { mockApi } from "../helpers/mock-api";

const minute = 60_000;

/**
 * agent-kit `--before`: signed in with the sample book, and a second device,
 * the mock's iPhone. The iPhone added two highlights and a note; this device
 * marked a highlight yellow, and the iPhone marked it blue a minute later,
 * so this device's edit is lost to it. Then one sync.
 */
export default async function twoDevices({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  const remote = await mockApi(context, true);
  await context.route("**/api/files/*", (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.fallback();
    return route.fulfill({
      json: {
        id: request.url().split("/").at(-1),
        fileSize: request.postDataBuffer()?.length ?? 0,
        mediaType: request.headers()["content-type"] ?? "",
        createdAt: Date.now(),
      },
    });
  });
  await page.goto("/");
  await importSampleBook(page);
  const now = Date.now();
  const bookId = await page.evaluate(async (path) => {
    const { syncV2Db } = await import(path);
    return (await syncV2Db.books.toCollection().first()).id as string;
  }, DATABASE_MODULE);
  const highlight = (id: string, color: string, createdAt: number) => ({
    id,
    bookId,
    spineItemId: "chapter-1",
    startOffset: 0,
    endOffset: 12,
    selectedText: "Down the Rabbit-Hole",
    textBefore: "",
    textAfter: "",
    color,
    createdAt,
    isDeleted: false,
  });
  const fromPhone = (table: string, row: { id: string }, at: number) =>
    remote.enqueue({
      key: JSON.stringify([table, row.id]),
      value: JSON.stringify(row),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: at, counter: 0 },
    });
  await page.evaluate(
    async ({ path, row }) => {
      const { syncV2Db } = await import(path);
      await syncV2Db.highlights.put(row);
    },
    {
      path: DATABASE_MODULE,
      row: highlight("shared", "yellow", now - 60 * minute),
    },
  );
  fromPhone(
    "highlights",
    highlight("phone-1", "green", now - 9 * minute),
    now - 9 * minute,
  );
  fromPhone(
    "highlights",
    highlight("phone-2", "green", now - 6 * minute),
    now - 6 * minute,
  );
  fromPhone(
    "notes",
    {
      id: "phone-note",
      bookId,
      kind: "note",
      content: "The rabbit is late again.",
      anchor: {
        spineItemId: "chapter-1",
        startOffset: 0,
        endOffset: 12,
        textBefore: "",
        textAfter: "",
      },
      createdAt: now - 5 * minute,
      updatedAt: now - 5 * minute,
      isDeleted: false,
    },
    now - 5 * minute,
  );
  fromPhone(
    "highlights",
    highlight("shared", "blue", now - 60 * minute),
    now + minute,
  );
  await page.evaluate(async () => {
    const { syncService } = await import("/src/lib/sync-service.ts");
    await syncService.syncAll();
  });
}
