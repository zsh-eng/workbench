import {
  test,
  expect,
  openLocalBook,
  nextSpread,
  showNotesCapsule,
} from "./helpers/fixtures";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

test("failed note save preserves the mobile draft and retry saves exactly once", async ({
  page,
  localBook,
}) => {
  await openLocalBook(page, localBook.id);
  for (let i = 0; i < 8; i++) await nextSpread(page);
  if (!(await page.getByRole("button", { name: "Jot a note" }).isVisible()))
    await page.touchscreen.tap(195, 300);
  await page.getByRole("button", { name: "Jot a note" }).click();
  const input = page.getByRole("textbox", { name: "Write a note" });
  const save = page.getByRole("button", { name: "Save note", exact: true });
  const notebook = page.getByRole("button", {
    name: "Open notebook",
    exact: true,
  });
  await input.fill("A draft that must survive a failed save");
  await page.evaluate(async () => {
    const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
    const failOnce = () => {
      db.notes.hook("creating").unsubscribe(failOnce);
      throw new Error("Test storage failure");
    };
    db.notes.hook("creating", failOnce);
  });
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not save the note",
  );
  await expect(input).toHaveValue("A draft that must survive a failed save");
  await expect(save).toBeEnabled();
  await expect(page.locator("[data-reader-footer]")).toHaveCount(0);
  await page.context().setOffline(true);
  await save.click();
  await expect(input).not.toBeVisible();
  await expect(page.getByRole("status")).toContainText("Saved to notebook");
  await showNotesCapsule(page);
  await expect(notebook).toHaveAttribute(
    "aria-description",
    "1 note in this book",
  );
  await page.getByRole("button", { name: "Jot a note" }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.context().setOffline(false);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { syncV2Db: db } = await import("/src/lib/sync-v2/db.ts");
        return (await db.notes.toArray()).filter((note) => !note.isDeleted)
          .length;
      }),
    )
    .toBe(1);
});
