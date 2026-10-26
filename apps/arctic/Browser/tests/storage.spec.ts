import { expect, test, type Page } from "@playwright/test";
import {
  addText,
  article,
  eventually,
  paragraphs,
  phone,
  signUp,
} from "./phone";
import { xxh64 } from "../src/sync/xxh64";

/** A copy's file id, as the server names it. */
const fileId = (html: string) => xxh64(new TextEncoder().encode(html));

/** The copies that this browser keeps, by id. */
const keptCopies = (page: Page) =>
  page.evaluate(async () => {
    const ids: string[] = [];
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("arctic:")) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db
          .transaction("files")
          .objectStore("files")
          .getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      ids.push(...(keys as string[]));
    }
    return ids.sort();
  });

/** Makes every kept copy a week old. */
const ageCopies = (page: Page) =>
  page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) {
      if (!name?.startsWith("arctic:")) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        const store = tx.objectStore("files");
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          cursor.update({ ...cursor.value, savedAt: Date.now() - 7 * 864e5 });
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }
  });

test("a copy that a longer one replaced leaves this browser", async ({
  page,
  context,
}) => {
  await signUp(context);
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  const tundra = article("https://example.com/tundra", {
    title: "The tundra in winter",
  });
  const first = `<h2>First</h2>${paragraphs(12)}`;
  const kept = `<h2>Tundra</h2>${paragraphs(12)}`;
  await phone(context.request).push([...floe.records, ...tundra.records]);
  await addText(context.request, floe, first);
  await addText(context.request, tundra, kept);

  await page.goto("/");
  const prose = page.locator(".prose");
  for (const title of ["A floe at dawn", "The tundra in winter"]) {
    await page.locator(".card-title", { hasText: title }).click();
    await expect(prose).toContainText("Paragraph 12.");
    await page.goBack();
  }
  expect(await keptCopies(page)).toEqual([fileId(first), fileId(kept)].sort());
  await ageCopies(page);

  // The phone replaces the floe's text; the tundra's copy is still named.
  await addText(context.request, floe, `<h2>Second</h2>${paragraphs(20)}`);
  await page.reload();
  await eventually(async () =>
    (await keptCopies(page)).includes(fileId(first)),
  ).toBe(false);
  expect(await keptCopies(page)).toContain(fileId(kept));
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(prose).toContainText("Paragraph 20.");
});
