import { test, expect } from "./helpers/fixtures";

// Sync Lab is a debugging tool. This browser check guards the user's data:
// copying the library into the lab must leave the real database unchanged.
// Its multi-client sync scenarios run in the client suite.
test("sync lab copies the current library without changing its database", async ({
  page,
  localBook,
}) => {
  const before = await page.evaluate(async () => {
    const { syncV2SyncDb } = await import("/src/lib/sync-v2/db.ts");
    return JSON.stringify(await syncV2SyncDb.books.toArray());
  });
  await page.goto("/debug/sync");
  await page
    .getByRole("button", { name: "Copy my library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Copy 1 selected book", exact: true })
    .click();
  await expect(
    page
      .getByRole("article", { name: "Client A", exact: true })
      .getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Active book")).toHaveValue(localBook.id);
  await page
    .getByRole("article", { name: "Client A", exact: true })
    .getByRole("button", { name: "Save note", exact: true })
    .click();
  const after = await page.evaluate(async () => {
    const { syncV2SyncDb } = await import("/src/lib/sync-v2/db.ts");
    return {
      books: JSON.stringify(await syncV2SyncDb.books.toArray()),
      notes: await syncV2SyncDb.notes.toArray(),
    };
  });
  expect(after.books).toEqual(before);
  expect(after.notes.some((note) => note.id.startsWith("lab-note:"))).toBe(
    false,
  );
});
