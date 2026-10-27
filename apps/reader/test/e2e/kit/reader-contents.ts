import type { Page } from "@playwright/test";
import { waitForSheet, waitForSheetToRest } from "../helpers/fixtures";

/**
 * agent-kit `--steps` for a Reader at any size: shows the header with a tap
 * in the middle of the page, opens Reader tools and then Contents. In a
 * compact window they are sheets, Contents over the tools; wider, the tools
 * are a sidebar and Contents is its first tab. With `KIT_SWIPE` set, a fast
 * touch swipe then takes the Contents sheet away and waits until it closes.
 */
export default async function readerContents({ page }: { page: Page }) {
  const { width, height } = page.viewportSize()!;
  const button = page.getByRole("button", {
    name: "Open reader tools",
    exact: true,
  });
  // A phone's header hides while you read; a tap on the page shows it.
  await button.click({ timeout: 2_000 }).catch(async () => {
    await page.touchscreen.tap(width / 2, height / 2);
    await button.click();
  });
  const sheet = page.getByRole("dialog", { name: "Reader tools", exact: true });
  const sidebar = page.getByRole("complementary", { name: "Reader tools" });
  await sheet.or(sidebar).first().waitFor();
  if (await sidebar.isVisible()) {
    await sidebar
      .getByRole("button", { name: "Contents", exact: true })
      .click();
    await page.waitForTimeout(600);
    return;
  }
  const tools = await waitForSheet(page, "Reader tools");
  await waitForSheetToRest(tools);
  await page.waitForTimeout(300);
  await tools.getByRole("button", { name: /Contents/ }).click();
  const contents = await waitForSheet(page, "Contents");
  await waitForSheetToRest(contents);
  if (!process.env.KIT_SWIPE) return;
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.synthesizeScrollGesture", {
    x: width / 2,
    y: height * 0.75,
    yDistance: Math.round(height * 0.4),
    gestureSourceType: "touch",
    speed: 3000,
  });
  await cdp.detach();
  await contents.waitFor({ state: "hidden" });
  await page.waitForTimeout(500);
}
