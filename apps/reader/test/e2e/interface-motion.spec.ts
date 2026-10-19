import { test, expect, openLocalBook } from "./helpers/fixtures";

test("press transitions include scale and menus open without keyframes", async ({ page, localBook }) => {
  const title = page.getByRole("heading", { name: /Alice/ });
  await title.click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await page.keyboard.press("Escape");
  await openLocalBook(page, localBook.id);
  const action = page.getByRole("button", { name: "Mark as reading", exact:true });
  await expect(action).toHaveCSS("transition-property", /scale/);
});

test.describe("touch reduced motion", () => {
 test.use({ hasTouch:true, isMobile:true });
 test("reduced motion stops CSS controls and drawer movement", async ({ page, localBook }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.emulateMedia({ reducedMotion:"reduce" });
  await openLocalBook(page, localBook.id);
  await page.touchscreen.tap(195,350);
  await page.getByRole("button", { name:"Open reader tools", exact:true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("tab", { name:"Layout", exact:true }).click();
  const toggle = page.getByRole("switch", { name:"Page animations", exact:true });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveCSS("transition-duration", "0s");
  await toggle.tap();
  await expect(toggle).not.toBeChecked();
});

});
