import type { Page } from "@playwright/test";
import { test, expect, openLocalBook } from "./helpers/fixtures";

// One subject keeps one toast: deletions in quick succession share it, and
// Undo turns that same toast into "Restored" rather than showing another.

test.use({
  viewport: { width: 1280, height: 900 },
  isMobile: false,
  hasTouch: false,
});

/** Opens the desktop notebook and writes these notes in it. */
async function writeNotes(page: Page, contents: string[]) {
  await page.mouse.move(200, 10);
  await page
    .getByRole("button", { name: "Open reader tools", exact: true })
    .click();
  const tools = page.getByRole("complementary", {
    name: "Reader tools",
    exact: true,
  });
  await tools.getByRole("button", { name: "Notebook", exact: true }).click();
  const compose = tools.getByRole("textbox", {
    name: "Write a note",
    exact: true,
  });
  for (const content of contents) {
    await compose.fill(content);
    await tools.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(compose).toHaveValue("");
  }
  const panel = tools.getByRole("region", { name: "Book notebook" });
  const rows = panel.locator("[data-note-id]");
  await expect(rows).toHaveCount(contents.length);
  return {
    rows,
    remove: async (content: string) => {
      await panel
        .getByText(content, { exact: true })
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    },
  };
}

test("deletions share one toast, and Undo turns it into Restored", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  const { rows, remove } = await writeNotes(page, [
    "First thought.",
    "Second thought.",
    "Third thought.",
  ]);
  const toasts = page.locator(".reader-toast");

  await remove("First thought.");
  const toast = page.getByRole("status").filter({ hasText: "Note deleted" });
  await expect(toast).toBeVisible();
  // Marks this toast's element, to find it again after it changes.
  await toast.evaluate((element) => element.setAttribute("data-probe", ""));
  const same = page.locator(".reader-toast[data-probe]");

  // More deletions join the same toast, which counts them.
  await remove("Second thought.");
  await remove("Third thought.");
  await expect(rows).toHaveCount(0);
  await expect(same).toContainText("3 notes deleted");
  await expect(toasts).toHaveCount(1);

  // Undo takes them all back, and the same toast says so.
  await same.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows).toHaveCount(3);
  await expect(same).toContainText("Restored");
  await expect(
    page.getByRole("status").filter({ hasText: "Restored" }),
  ).toHaveCount(1);
  await expect(
    same.getByRole("button", { name: "Undo", exact: true }),
  ).toHaveCount(0);
  await expect(toasts).toHaveCount(1);

  // Then it leaves.
  await expect(toasts).toHaveCount(0);
});
