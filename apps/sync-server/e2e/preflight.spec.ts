import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const preflight = readFileSync(
  new URL("../scripts/browser-cutover-preflight.js", import.meta.url),
  "utf8",
);

test("cutover preflight detects pending old-browser data without changing it", async ({
  page,
}) => {
  await page.goto("http://localhost:5175");
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("epub-reader-db-v2", 1);
      request.onupgradeneeded = () => {
        for (const table of [
          "_sync_outbox",
          "fileUploadOperations",
          "noteDrafts",
        ])
          request.result.createObjectStore(table);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(
        ["_sync_outbox", "noteDrafts"],
        "readwrite",
      );
      transaction
        .objectStore("_sync_outbox")
        .put({ unchanged: true }, "pending");
      transaction.objectStore("noteDrafts").put({ unchanged: true }, "draft");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  const first = await page.evaluate(preflight);
  expect(first.ready).toBe(false);
  expect(first.stores).toEqual([
    {
      database: "epub-reader-db-v2",
      pending: { _sync_outbox: 1, fileUploadOperations: 0, noteDrafts: 1 },
      ready: false,
    },
  ]);
  const second = await page.evaluate(preflight);
  expect(second.stores).toEqual(first.stores);
});
