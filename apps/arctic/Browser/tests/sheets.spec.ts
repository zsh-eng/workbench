import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

// A phone: sheets, and the bottom bar under the toasts.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test.beforeEach(async ({ context }) => {
  await signUp(context);
});

test("a sheet whose code failed to load opens on the next tap", async ({
  page,
  context,
}) => {
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  // No connection for the sheet's code: its preload and the first tap fail.
  let offline = true;
  await page.route("**/src/sheet.tsx*", (route) =>
    offline ? route.abort("internetdisconnected") : route.continue(),
  );
  await page.goto("/");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await expect(page.locator(".prose")).toContainText("Paragraph 12.");
  const text = page
    .getByRole("toolbar", { name: "Article" })
    .getByRole("button", { name: "Text and theme" });
  await text.click();
  await expect(page.locator(".toast")).toContainText("could not open");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  offline = false;
  await text.click();
  await expect(
    page.getByRole("dialog", { name: "Text and theme" }),
  ).toBeVisible();
});

test("Undo counts down above the bottom bar and takes the change back", async ({
  page,
  context,
}) => {
  await phone(context.request).push([
    ...article("https://example.com/polynya", {
      title: "A polynya in winter",
      savedAt: Date.UTC(2026, 9, 2),
    }).records,
    ...article("https://example.com/brash-ice", {
      title: "Brash ice",
      savedAt: Date.UTC(2026, 9, 1),
    }).records,
  ]);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(2);

  const archive = async (title: string) => {
    await page.getByRole("button", { name: `More for ${title}` }).click();
    const sheet = page.getByRole("dialog", { name: `Actions for ${title}` });
    // It takes focus once it rests.
    await expect
      .poll(() =>
        page.evaluate(() => !!document.activeElement?.closest("[role=dialog]")),
      )
      .toBe(true);
    await sheet.getByRole("button", { name: "Archive" }).click();
    await expect(page.locator(".card-title", { hasText: title })).toHaveCount(
      0,
    );
  };

  await archive("A polynya in winter");
  const toast = page.getByRole("status", { name: "Notifications" });
  await expect(toast).toContainText("Archived");
  // The toast comes to rest above the search bar, clear of it.
  const bar = (await page.locator(".library-dock").boundingBox())!;
  await expect
    .poll(async () => {
      const box = (await toast.locator(".toast").boundingBox())!;
      return box.y + box.height <= bar.y;
    })
    .toBe(true);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);

  // ⌘Z or Ctrl+Z undoes while Undo is on offer.
  await archive("Brash ice");
  await expect(toast).toContainText("Archived");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(toast.locator(".toast")).toHaveCount(0);

  // Two archives share one toast, which counts them. Its Undo takes both
  // back, and the same toast says so before it leaves.
  await archive("A polynya in winter");
  const one = toast.locator(".toast");
  await one.evaluate((element) => element.setAttribute("data-probe", ""));
  await archive("Brash ice");
  const same = toast.locator(".toast[data-probe]");
  await expect(same).toContainText("2 archived");
  await same.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".card")).toHaveCount(2);
  await expect(same).toContainText("Back in Saved");
  await expect(same.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(toast.locator(".toast")).toHaveCount(0);
});
