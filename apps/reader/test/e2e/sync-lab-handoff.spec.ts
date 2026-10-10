import { test, expect, waitForReaderReady } from "./helpers/fixtures";

test.use({ hasTouch: true });

test("Reader note button and a synced handoff prompt stay clear of each other", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/debug/sync");
  await page
    .getByRole("button", { name: "Start with demo", exact: true })
    .click();
  const aControls = page.getByRole("article", {
    name: "Client A",
    exact: true,
  });
  const bControls = page.getByRole("article", {
    name: "Client B",
    exact: true,
  });
  await expect(
    aControls.getByRole("button", { name: "Pull", exact: true }),
  ).toBeEnabled();
  await expect(
    bControls.getByRole("button", { name: "Push", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "App views", exact: true }).click();
  const a = page.frameLocator('iframe[title="Client A app"]');
  await a
    .getByRole("heading", { name: "The Shared Bookmark", exact: true })
    .click();
  const aFrame = await page
    .locator('iframe[title="Client A app"]')
    .elementHandle()
    .then((element) => element!.contentFrame());
  if (!aFrame) throw new Error("Client A app frame is missing");
  await waitForReaderReady(aFrame);
  await a.getByRole("button", { name: "Mark as reading", exact: true }).click();

  await bControls.getByText("Local actions", { exact: true }).click();
  const position = bControls.getByRole("slider", {
    name: "Client B reading position",
  });
  await position.fill("80");
  await bControls
    .getByRole("button", { name: "Set position", exact: true })
    .click();
  await expect(bControls).toContainText("1 pending");
  await bControls.getByRole("button", { name: "Push", exact: true }).click();
  await expect(bControls).toContainText("0 pending");
  await aControls.getByRole("button", { name: "Pull", exact: true }).click();
  const prompt = a.locator("[data-reader-top-prompt]");
  await expect(
    prompt.getByRole("button", { name: /^Continue at p\. \d+ from / }),
  ).toBeVisible();
  await expect(prompt).toBeVisible();
  const note = a.getByRole("button", { name: "Jot a note", exact: true });
  if (!(await note.isVisible())) {
    await a.locator('[data-reader-spread-layer="current"]').tap();
  }
  await expect(note).toBeVisible();
  await expect
    .poll(async () => {
      const noteBounds = await note.boundingBox();
      const promptBounds = await prompt.boundingBox();
      return noteBounds && promptBounds
        ? noteBounds.y - (promptBounds.y + promptBounds.height)
        : -1;
    })
    .toBeGreaterThan(0);
  await page.screenshot({
    path: "test-results/sync-lab-handoff.png",
    fullPage: true,
  });
  await note.click();
  const editor = a.getByRole("textbox", { name: "Write a note", exact: true });
  await expect(editor).toBeVisible();
  await editor.press("Escape");
  await expect(editor).not.toBeVisible();
  await a
    .getByRole("button", { name: "Dismiss sync prompt", exact: true })
    .click();
  await expect(prompt).not.toBeVisible();
  await note.click();
  await expect(editor).toBeVisible();
});
