// End-to-end checks of the built page (dist/), served as a static host would.
import { expect, test } from "@playwright/test";
import { site } from "../src/site.ts";

test("install tabs work from the keyboard", async ({ page }) => {
  await page.goto("/");
  const terminal = page.getByRole("tab", { name: "Terminal" });
  const agent = page.getByRole("tab", { name: "Ask your agent" });

  await terminal.focus();
  await page.keyboard.press("ArrowRight");
  await expect(agent).toBeFocused();
  await expect(agent).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("med skills install");

  await page.keyboard.press("Home");
  await expect(terminal).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").locator("code")).toHaveText(
    site.installCommand,
  );
});

test("copy buttons copy the exact text and announce it", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  const status = page.getByRole("status");

  await page.getByRole("button", { name: "Copy the install command" }).click();
  await expect(status).toHaveText("Copied the install command.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    site.installCommand,
  );

  // Tab from the selected tab reaches the copy button of the visible panel.
  await page.getByRole("tab", { name: "Ask your agent" }).click();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Copy the agent prompt" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Copied the agent prompt.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    site.agentPrompt,
  );
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`fits a 375 px phone in ${colorScheme}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
      colorScheme,
    });
    const page = await context.newPage();
    await page.goto("/");
    const layout = await page.evaluate(() => {
      const box = document.querySelector("main .wrap")!.getBoundingClientRect();
      const hero = document.querySelector("img")!;
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        left: box.left,
        right: innerWidth - box.right,
        hero: hero.currentSrc,
      };
    });
    expect(layout).toMatchObject({ overflow: 0, left: 16, right: 16 });
    expect(layout.hero).toContain(`review-${colorScheme}-`);
    await context.close();
  });
}
