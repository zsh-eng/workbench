import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemePicker } from "../../src/web/components/ThemePicker";
import { SettingsPage } from "../../src/web/components/settings/SettingsPage";
import {
  findTheme,
  initializeTheme,
  THEME_DARK_KEY,
  THEME_LIGHT_KEY,
  THEME_MODE_KEY,
  THEME_STORAGE_KEY,
  themeController,
} from "../../src/web/themes";

let root: Root | undefined;
let mount: HTMLDivElement | undefined;
// Other files share this localStorage: a theme they chose would outrank the
// one a test saves.
function clearTheme() {
  for (const key of [THEME_STORAGE_KEY, THEME_MODE_KEY, THEME_LIGHT_KEY, THEME_DARK_KEY])
    localStorage.removeItem(key);
  initializeTheme();
}
beforeEach(clearTheme);
afterEach(() => {
  root?.unmount();
  mount?.remove();
  root = undefined;
  mount = undefined;
  clearTheme();
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

test("a theme's aesthetic previews with its colors: type, corners, shadow, and the chosen row", async () => {
  await mountPicker();
  const dialog = () => getComputedStyle(document.querySelector('[role="dialog"]')!);
  const rgb = (hex: string) => {
    const probe = document.createElement("div");
    probe.style.color = hex;
    return probe.style.color;
  };
  expect(dialog().fontFamily).toContain("Geist");
  expect(dialog().borderRadius).toBe("12px");
  await page.getByRole("combobox", { name: "Search themes" }).fill("Paper Light");
  await expect.poll(() => themeController.getSnapshot().active.id).toBe("paper-light");
  // Paper: Paper Mono for the interface, nearly square corners, no shadow, and a
  // solid accent selection whose secondary text turns light with it.
  expect(dialog().fontFamily).toContain("Paper Mono");
  expect(dialog().borderRadius).toBe("3.6px");
  expect(dialog().boxShadow).toBe("none");
  const option = page.getByRole("option", { name: /Paper Light/ }).element();
  expect(getComputedStyle(option).backgroundColor).toBe(
    rgb(findTheme("paper-light").palette.accent),
  );
  expect(getComputedStyle(option).color).toBe("rgb(255, 255, 255)");
  // The row's sun, its appearance, turns light with the row.
  const kind = option.querySelector('[data-appearance="light"]')!;
  expect(getComputedStyle(kind).color).toMatch(/^rgba\(255, 255, 255, 0\.8/);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.documentElement.dataset.theme).toBe("graphite-dark");
  await page.getByRole("button", { name: "Choose theme" }).click();
  expect(dialog().fontFamily).toContain("Geist");
  expect(dialog().borderRadius).toBe("12px");
  expect(dialog().boxShadow).not.toBe("none");
});

test("Settings shows the light theme, the dark one, or the system's choice, with a theme for each", async () => {
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<SettingsPage onSources={() => {}} />);
  await expect.poll(() => document.title).toBe("Settings");
  const html = document.documentElement;
  // Every setting is on the one page.
  for (const name of ["Appearance", "Code", "Files and sessions", "Sources"])
    await expect.element(page.getByRole("region", { name, exact: true })).toBeVisible();
  await expect.element(page.getByRole("switch", { name: "Vim keys" })).toBeInTheDocument();
  const modes = page.getByRole("radiogroup", { name: "Interface theme" });
  await modes.getByRole("radio", { name: "Dark" }).click();
  await expect.element(modes.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect.poll(() => html.dataset.appearance).toBe("dark");

  await modes.getByRole("radio", { name: "Light" }).click();
  await expect.poll(() => html.dataset.appearance).toBe("light");
  expect(localStorage.getItem(THEME_MODE_KEY)).toBe("light");
  // The light theme's choice shows at once.
  await page.getByRole("combobox", { name: "Light theme" }).click();
  await page.getByRole("option", { name: "Vitesse Light" }).click();
  await expect.poll(() => html.dataset.theme).toBe("vitesse-light");
  expect(localStorage.getItem(THEME_LIGHT_KEY)).toBe("vitesse-light");

  // System shows the theme for the browser's appearance.
  await modes.getByRole("radio", { name: "System" }).click();
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  await expect.poll(() => html.dataset.appearance).toBe(dark ? "dark" : "light");
  expect(localStorage.getItem(THEME_MODE_KEY)).toBe("system");
  await expect.element(modes.getByRole("radio", { name: "System" })).toBeChecked();
});

test("Settings › Open in lists the sources' code hosts and this Mac's editors, and writes their keys", async () => {
  const writes: { key: string; value: unknown }[] = [];
  const settings: Record<string, unknown> = {};
  const fetches = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input), location.href);
    if (url.pathname === "/api/open-in/hosts")
      return Response.json({
        hosts: [
          { host: "github.acme.build", repositories: 31, github: true },
          { host: "git.acme.build", repositories: 2, github: false },
        ],
        editors: [
          { id: "vscode", name: "VS Code", usage: "code -g file:line" },
          { id: "zed", name: "Zed", usage: "zed file:line" },
        ],
      });
    if (url.pathname === "/api/settings" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { key: string; value: unknown };
      writes.push(body);
      settings[body.key] = body.value;
      return Response.json({ path: "/tmp/med/settings.json", settings, error: null });
    }
    return Response.json({ error: { message: "Not in this test." } }, { status: 404 });
  });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  root.render(<SettingsPage onSources={() => {}} />);
  const section = page.getByRole("region", { name: "Open in", exact: true });
  await expect.element(section.getByText("github.acme.build", { exact: true })).toBeVisible();
  await expect
    .element(section.getByText(/^GitHub Enterprise, found through its API · 31 repositories/))
    .toBeVisible();
  await expect
    .element(section.getByText(/^Not recognised, so Open in leaves it out until you choose/))
    .toBeVisible();

  // A host that Med does not recognise is left out until you choose its kind.
  await section.getByRole("combobox", { name: "Kind of git.acme.build" }).click();
  await page.getByRole("option", { name: "GitLab" }).click();
  await expect
    .poll(() => writes.at(-1))
    .toEqual({
      key: "openIn.hosts",
      value: { "git.acme.build": "gitlab" },
    });

  // Sourcegraph's address saves on Enter, without its last slash.
  const address = section.getByRole("textbox", { name: "Sourcegraph address" });
  await address.fill("https://sourcegraph.acme.build/");
  await userEvent.keyboard("{Enter}");
  await expect
    .poll(() => writes.at(-1))
    .toEqual({
      key: "openIn.sourcegraph",
      value: "https://sourcegraph.acme.build",
    });

  // Make default puts an editor first; a switch leaves one out.
  await section.getByRole("button", { name: "Make default" }).click();
  await expect
    .poll(() => writes.at(-1))
    .toEqual({ key: "openIn.editors", value: ["zed", "vscode"] });
  await section.getByRole("switch", { name: "VS Code in Open in" }).click();
  await expect.poll(() => writes.at(-1)).toEqual({ key: "openIn.editors", value: ["zed"] });

  // Another link: a name, and a template with the file's place.
  await section.getByRole("textbox", { name: "Link name" }).fill("Blame");
  await section
    .getByRole("textbox", { name: "Link template" })
    .fill("https://blame.acme.build/{repo}/{ref}/{path}#L{line}");
  await section.getByRole("button", { name: "Add", exact: true }).click();
  await expect
    .poll(() => writes.at(-1))
    .toEqual({
      key: "openIn.links",
      value: { Blame: "https://blame.acme.build/{repo}/{ref}/{path}#L{line}" },
    });
  await expect.element(section.getByRole("button", { name: "Remove Blame" })).toBeVisible();

  // Code's preview is a diff in the theme on screen.
  await expect.element(page.getByRole("img", { name: "A diff in your theme" })).toBeInTheDocument();
  fetches.mockRestore();
});
