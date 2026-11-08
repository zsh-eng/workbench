import {
  ReaderSettingsProvider,
  useReaderSettings,
} from "@/hooks/use-reader-settings";
import { paperFor, papersForTheme, readPapers } from "@/lib/reader-papers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
});

describe("papers saved before day and night", () => {
  it("come from the one theme an older build saved", () => {
    expect(papersForTheme("flexoki-light")).toEqual({
      dayTheme: "flexoki-light",
      nightTheme: "flexoki-dark",
    });
    expect(papersForTheme("flexoki-dark")).toEqual({
      dayTheme: "flexoki-light",
      nightTheme: "flexoki-dark",
    });
    expect(papersForTheme("night")).toEqual({
      dayTheme: "light",
      nightTheme: "night",
    });
    expect(papersForTheme("dark")).toEqual({
      dayTheme: "light",
      nightTheme: "dark",
    });
    expect(papersForTheme(undefined)).toEqual({
      dayTheme: "light",
      nightTheme: "dark",
    });
  });

  it("keep saved papers, and replace a paper on the wrong side", () => {
    expect(
      readPapers({ theme: "dark", dayTheme: "flexoki-light", nightTheme: "night" }),
    ).toEqual({ dayTheme: "flexoki-light", nightTheme: "night" });
    expect(readPapers({ theme: "night", dayTheme: "dark" })).toEqual({
      dayTheme: "light",
      nightTheme: "night",
    });
  });

  it("show the night paper by night and the day paper by day", () => {
    const papers = { dayTheme: "flexoki-light", nightTheme: "night" } as const;
    expect(paperFor(papers, true)).toBe("night");
    expect(paperFor(papers, false)).toBe("flexoki-light");
  });
});

function Probe() {
  const { settings, appearanceMode, setAppearanceMode, choosePaper } =
    useReaderSettings();
  return createElement(
    "div",
    null,
    createElement(
      "output",
      null,
      `${appearanceMode}:${settings.theme}:${settings.dayTheme}:${settings.nightTheme}`,
    ),
    createElement("button", { onClick: () => setAppearanceMode("light") }, "Light"),
    createElement("button", { onClick: () => setAppearanceMode("dark") }, "Dark"),
    createElement(
      "button",
      { onClick: () => setAppearanceMode("system") },
      "System",
    ),
    createElement("button", { onClick: () => choosePaper("night") }, "Night"),
    createElement(
      "button",
      { onClick: () => choosePaper("flexoki-light") },
      "Flexoki light",
    ),
  );
}

function mount() {
  render(createElement(ReaderSettingsProvider, null, createElement(Probe)));
}

function deviceIsDark(dark: boolean) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: dark,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

const shown = () => screen.getByRole("status").textContent;
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("day and night papers", () => {
  it("carry a saved Night theme into System by day and by night", () => {
    localStorage.setItem("epub-reader-settings", '{"theme":"night"}');
    localStorage.setItem("epub-reader-appearance", "system");
    deviceIsDark(false);
    mount();
    expect(shown()).toBe("system:light:light:night");
    cleanup();
    deviceIsDark(true);
    mount();
    expect(shown()).toBe("system:night:light:night");
  });

  it("keep the night paper while Light shows the day one", () => {
    localStorage.setItem("epub-reader-settings", '{"theme":"night"}');
    mount();
    expect(shown()).toBe("dark:night:light:night");
    click("Light");
    expect(shown()).toBe("light:light:light:night");
    click("Dark");
    expect(shown()).toBe("dark:night:light:night");
  });

  it("turn Light or Dark to the side of a paper chosen for it", () => {
    mount();
    expect(shown()).toBe("light:light:light:dark");
    click("Night");
    expect(shown()).toBe("dark:night:light:night");
    expect(document.documentElement.classList.contains("night")).toBe(true);
    click("Flexoki light");
    expect(shown()).toBe("light:flexoki-light:flexoki-light:night");
  });

  it("let Match system keep following the device when a paper is chosen", () => {
    deviceIsDark(false);
    mount();
    click("System");
    expect(shown()).toBe("system:light:light:dark");
    click("Night");
    expect(shown()).toBe("system:light:light:night");
    click("Flexoki light");
    expect(shown()).toBe("system:flexoki-light:flexoki-light:night");
  });

  it("save both papers", () => {
    mount();
    click("Night");
    click("Flexoki light");
    const saved = JSON.parse(localStorage.getItem("epub-reader-settings")!);
    expect(saved).toMatchObject({
      theme: "flexoki-light",
      dayTheme: "flexoki-light",
      nightTheme: "night",
    });
  });
});
