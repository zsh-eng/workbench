import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
let fixture: ChildProcess;
let endpoints: { publisher: string; service: string };
test.beforeAll(async () => {
  fixture = spawn(
    "bun",
    [fileURLToPath(new URL("./download-fixture.ts", import.meta.url))],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  endpoints = await new Promise((resolve, reject) => {
    const lines = createInterface({ input: fixture.stdout! });
    lines.once("line", (line) => {
      lines.close();
      resolve(JSON.parse(line));
    });
    fixture.once("error", reject);
    fixture.once("exit", (code) =>
      reject(new Error(`Download fixture exited: ${code}`)),
    );
  });
});
test.afterAll(async () => {
  if (fixture && fixture.exitCode === null) {
    const exited = new Promise((resolve) => fixture.once("exit", resolve));
    fixture.kill("SIGTERM");
    await exited;
  }
});

test("Save downloads in the background; migrated notes and downloaded text survive reload, delete and undo", async ({
  page,
}) => {
  // Start from the previous shipped storage schema, not a fresh database.
  await page.route("**/__old-library", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__old-library");
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("arctic-browser", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("library");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("library", "readwrite");
      transaction.objectStore("library").put(
        {
          version: 1,
          articles: [
            {
              id: "old",
              title: "An existing article",
              description: "",
              author: "",
              tags: [],
              url: "https://example.org/old",
              savedAt: 1,
              saved: true,
              archived: false,
              favourite: false,
              bodyPath: "/seed/bodies/old.html",
            },
          ],
          annotations: [
            {
              id: "note",
              articleId: "old",
              text: "Keep this existing note",

              createdAt: 1,
              updatedAt: 1,
              color: "yellow",
            },
          ],
        },
        "current",
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.route("**/seed/bodies/old.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>An existing saved article.</p>",
    }),
  );
  let requests = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/extract", async (route) => {
    requests++;
    const response = await route.fetch({
      url: endpoints.service + "/api/extract",
    });
    await ready;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByRole("heading", { name: "An existing article" }).click();
  await page.getByRole("button", { name: "Show notes", exact: true }).click();
  await expect(page.locator(".annotation-sidebar")).toContainText(
    "Keep this existing note",
  );
  await page.getByRole("link", { name: "Back to reading list" }).click();
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Article URL" })
    .fill(endpoints.publisher + "/essay?edition=1#part");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".add-article-panel")).toHaveCount(0);
  await expect(page.locator(".article-card")).toHaveCount(2);
  await expect(page).toHaveURL("/");
  release();
  await page
    .getByRole("heading", { name: "Reading without a connection" })
    .click();
  await expect(page.locator(".article-body")).toContainText(
    "A downloaded article remains available",
  );
  expect(requests).toBe(1);
  // Make the endpoint unavailable; all further reads must come from IndexedDB.
  await page.unroute("**/api/extract");
  await page.route("**/api/extract", (route) => {
    requests++;
    return route.abort();
  });
  await page.reload();
  await expect(page.locator(".article-body")).toContainText(
    "A downloaded article remains available",
  );
  await page.getByRole("link", { name: "Back to reading list" }).click();
  const card = page.locator(".article-card").filter({
    has: page.getByRole("heading", { name: "Reading without a connection" }),
  });
  await card.hover();
  await card
    .getByRole("button", { name: "Delete article", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.reload();
  await page
    .getByRole("heading", { name: "Reading without a connection" })
    .click();
  await expect(page.locator(".article-body")).toContainText(
    "A downloaded article remains available",
  );
  expect(requests).toBe(1);
});

test("a late download cannot restore an article deleted during Save", async ({
  page,
}) => {
  await page.route("**/seed/index.json", (route) =>
    route.fulfill({ json: { version: 1, articles: [], annotations: [] } }),
  );
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/extract", async (route) => {
    const response = await route.fetch({
      url: endpoints.service + "/api/extract",
    });
    await ready;
    await route.fulfill({ response });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Add article", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Article URL" })
    .fill(endpoints.publisher + "/late");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".article-card").hover();
  await page
    .getByRole("button", { name: "Delete article", exact: true })
    .click();
  const completed = page.waitForResponse("**/api/extract");
  release();
  await completed;
  await expect(page.locator(".article-card")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("navigation", { name: "Library folders" }),
  ).toBeVisible();
  await expect(page.locator(".article-card")).toHaveCount(0);
});
