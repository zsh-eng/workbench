import {
  ReaderSettingsProvider,
  useReaderSettings,
} from "@/hooks/use-reader-settings";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { toast } from "sonner";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function Probe() {
  const { settings, appearanceMode, setAppearanceMode } = useReaderSettings();
  return createElement(
    "button",
    {
      onClick: () =>
        setAppearanceMode(appearanceMode === "light" ? "dark" : "light"),
    },
    `${appearanceMode}:${settings.theme}`,
  );
}

function mount() {
  render(createElement(ReaderSettingsProvider, null, createElement(Probe)));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  document.documentElement.className = "";
});

it("falls back when storage access is denied without replacing saved preferences", () => {
  localStorage.setItem("epub-reader-settings", '{"theme":"night"}');
  const get = vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("Denied", "SecurityError");
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mount();
  expect(screen.getByRole("button").textContent).toBe("light:light");
  expect(document.documentElement.classList.contains("light")).toBe(true);
  get.mockRestore();
  expect(localStorage.getItem("epub-reader-settings")).toBe(
    '{"theme":"night"}',
  );
});

it("applies themes after write failures, reports once, and saves after recovery", () => {
  mount();
  const set = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
    throw new DOMException("Full", "QuotaExceededError");
  });
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("button").textContent).toBe("dark:dark");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  fireEvent.click(screen.getByRole("button"));
  expect(document.documentElement.classList.contains("light")).toBe(true);
  expect(toast.error).toHaveBeenCalledTimes(1);
  set.mockRestore();
  fireEvent.click(screen.getByRole("button"));
  expect(JSON.parse(localStorage.getItem("epub-reader-settings")!).theme).toBe(
    "dark",
  );
  expect(localStorage.getItem("epub-reader-appearance")).toBe("dark");
});

it("preserves unread settings while saved System appearance applies", () => {
  const saved = '{"theme":"night","fontSize":24}';
  localStorage.setItem("epub-reader-settings", saved);
  localStorage.setItem("epub-reader-appearance", "system");
  const read = localStorage.getItem.bind(localStorage);
  const get = vi.spyOn(localStorage, "getItem").mockImplementation((key) => {
    if (key === "epub-reader-settings")
      throw new DOMException("Denied", "SecurityError");
    return read(key);
  });
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mount();
  expect(screen.getByRole("button").textContent).toBe("system:dark");
  get.mockRestore();
  expect(localStorage.getItem("epub-reader-settings")).toBe(saved);
});

it("reopens a saved Inter choice in System, the sans that replaced it", () => {
  localStorage.setItem("epub-reader-settings", '{"fontFamily":"inter"}');
  function FontProbe() {
    return createElement(
      "output",
      null,
      useReaderSettings().settings.fontFamily,
    );
  }
  render(createElement(ReaderSettingsProvider, null, createElement(FontProbe)));
  expect(screen.getByRole("status").textContent).toBe("system");
});
