import { afterEach, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemePicker } from "../../src/web/components/ThemePicker";
import {
  findTheme,
  initializeTheme,
  THEME_STORAGE_KEY,
  themeController,
} from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  localStorage.removeItem(THEME_STORAGE_KEY);
  initializeTheme();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Choose theme</button>
      <ThemePicker open={open} onOpenChange={setOpen} />
    </>
  );
}

async function mountPicker(saved = "graphite-dark") {
  localStorage.setItem(THEME_STORAGE_KEY, saved);
  initializeTheme();
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<Harness />);
  await page.getByRole("button", { name: "Choose theme" }).click();
  await expect.element(page.getByRole("combobox", { name: "Search themes" })).toBeVisible();
}

test("opening preserves a non-default saved choice until the highlight moves", async () => {
  await mountPicker("tokyo-night");
  await expect
    .element(page.getByRole("option", { name: /Tokyo Night/ }))
    .toHaveAttribute("aria-selected", "true");
  expect(themeController.getSnapshot().active.id).toBe("tokyo-night");
  expect(document.documentElement.dataset.theme).toBe("tokyo-night");
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => themeController.getSnapshot().active.id).not.toBe("tokyo-night");
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => themeController.getSnapshot().active.id).toBe("tokyo-night");
});

test("arrow preview updates the portal immediately; Escape restores the saved theme", async () => {
  await mountPicker();
  await userEvent.keyboard("{ArrowDown}");
  await expect.poll(() => themeController.getSnapshot().active.id).not.toBe("graphite-dark");
  const preview = themeController.getSnapshot().active;
  expect(document.documentElement.style.getPropertyValue("--med-canvas")).toBe(
    preview.palette.canvas,
  );
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("graphite-dark");
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  const expected = document.createElement("div");
  // Palettes use the raised surface; the previewed theme must reach the portal at once.
  expected.style.backgroundColor = preview.palette.raised;
  expect(getComputedStyle(dialog!).backgroundColor).toBe(expected.style.backgroundColor);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.documentElement.dataset.theme).toBe("graphite-dark");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});

test("search and Enter commit; click commits another theme; an empty search does not overwrite it", async () => {
  await mountPicker();
  const liveRegion = document.querySelector('[role="dialog"] [role="status"]')!;
  expect(liveRegion.getAttribute("aria-live")).toBe("polite");
  expect(liveRegion.getBoundingClientRect().height).toBe(0);
  await page.getByRole("combobox", { name: "Search themes" }).fill("Vitesse Light");
  await expect.poll(() => themeController.getSnapshot().active.id).toBe("vitesse-light");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => localStorage.getItem(THEME_STORAGE_KEY)).toBe("vitesse-light");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByRole("option", { name: /Tokyo Night/ }).click();
  await expect.poll(() => localStorage.getItem(THEME_STORAGE_KEY)).toBe("tokyo-night");
  await page.getByRole("button", { name: "Choose theme" }).click();
  await page.getByRole("combobox", { name: "Search themes" }).fill("no matching theme");
  await expect.element(page.getByText("No themes found.")).toBeVisible();
  const emptyRegion = document.querySelector('[role="dialog"] [role="status"]')!;
  expect(emptyRegion.getAttribute("aria-live")).toBe("polite");
  expect(emptyRegion.getBoundingClientRect().height).toBeGreaterThan(0);
  await userEvent.keyboard("{Enter}");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("tokyo-night");
  await userEvent.keyboard("{Escape}");
  expect(document.documentElement.style.getPropertyValue("--med-canvas")).toBe(
    findTheme("tokyo-night").palette.canvas,
  );
  // An installed app colors its title bar to match the app frame.
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe(
    findTheme("tokyo-night").palette.panel,
  );
});
