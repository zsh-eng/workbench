import {
  Sidebar,
  SidebarFloatingTrigger,
  SidebarHeader,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  ReaderSettingsProvider,
  useReaderSettings,
} from "@/hooks/use-reader-settings";
import {
  getHotkeyManager,
  type Hotkey,
  type HotkeyRegistration,
} from "@tanstack/react-hotkeys";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalMatchMedia = window.matchMedia;

function createMediaQueryList(query: string): MediaQueryList {
  return {
    media: query,
    matches: false,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

function SidebarProbe() {
  const { open, toggleSidebar } = useSidebar();
  return createElement(
    "button",
    { type: "button", onClick: toggleSidebar },
    open ? "open" : "closed",
  );
}

function ThemeProbe({ label }: { label: string }) {
  const { settings, updateSettings } = useReaderSettings();
  return createElement(
    "button",
    {
      type: "button",
      "aria-label": label,
      onClick: () => updateSettings({ theme: "dark" }),
    },
    settings.theme,
  );
}

function AppearanceProbe() {
  const { appearanceMode, setAppearanceMode, settings } = useReaderSettings();
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => setAppearanceMode("system"),
    },
    `${appearanceMode}:${settings.theme}`,
  );
}

function getHotkeyRegistration(hotkey: Hotkey): HotkeyRegistration {
  const registration = Array.from(
    getHotkeyManager().registrations.state.values(),
  ).find((candidate) => candidate.hotkey === hotkey);

  if (!registration) {
    throw new Error(`Expected ${hotkey} to be registered`);
  }

  return registration;
}

function triggerHotkey(hotkey: Hotkey): void {
  const manager = getHotkeyManager();
  const registration = getHotkeyRegistration(hotkey);

  act(() => {
    manager.triggerRegistration(registration.id);
  });
}

beforeEach(() => {
  window.matchMedia = vi.fn(createMediaQueryList);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = originalMatchMedia;
  document.documentElement.classList.remove("dark", "theme-transitioning");
});

describe("SidebarProvider", () => {
  it("toggles the desktop sidebar with Command+Backslash", () => {
    render(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(SidebarProbe),
      ),
    );

    expect(screen.getByRole("button").textContent).toBe("open");

    triggerHotkey("Mod+\\");

    expect(screen.getByRole("button").textContent).toBe("closed");
    expect(
      document
        .querySelector('[data-slot="sidebar-wrapper"]')
        ?.getAttribute("data-transition-mode"),
    ).toBe("animated");
  });

  it("closes the desktop sidebar with Escape", () => {
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);

    render(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(SidebarProbe),
      ),
    );

    triggerHotkey("Escape");

    expect(screen.getByRole("button").textContent).toBe("closed");
    expect(
      document
        .querySelector('[data-slot="sidebar-wrapper"]')
        ?.getAttribute("data-transition-mode"),
    ).toBe("instant");
  });

  it("leaves the sidebar open when another layer handles Escape", () => {
    render(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(SidebarProbe),
      ),
    );

    const escapeEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    escapeEvent.preventDefault();
    const registration = getHotkeyRegistration("Escape");
    act(() => {
      registration.callback(escapeEvent, {
        hotkey: registration.hotkey,
        parsedHotkey: registration.parsedHotkey,
      });
    });

    expect(screen.getByRole("button").textContent).toBe("open");
  });

  it("uses a shorter exit than entrance for pointer interactions", () => {
    render(
      createElement(
        SidebarProvider,
        { defaultOpen: true },
        createElement(Sidebar),
      ),
    );

    const sidebarContainer = document.querySelector<HTMLElement>(
      '[data-slot="sidebar-container"]',
    );
    const entrance = parseFloat(sidebarContainer!.style.transitionDuration);

    fireEvent.click(screen.getByRole("button", { name: "Close sidebar" }));

    const exit = parseFloat(sidebarContainer!.style.transitionDuration);
    expect(exit).toBeGreaterThan(0);
    expect(exit).toBeLessThan(entrance);
  });

  it("reports controlled changes to the app shell", () => {
    const onOpenChange = vi.fn();
    render(
      createElement(
        SidebarProvider,
        { open: true, onOpenChange },
        createElement(SidebarProbe),
      ),
    );

    fireEvent.click(screen.getByRole("button"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("exposes only one visible sidebar control at a time", () => {
    render(
      createElement(
        SidebarProvider,
        null,
        createElement(
          Sidebar,
          null,
          createElement(SidebarHeader, null, createElement(SidebarTrigger)),
        ),
        createElement(SidebarFloatingTrigger),
      ),
    );

    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" }),
    ).toHaveLength(1);
    const floatingTrigger = screen.getByRole("button", {
      name: "Toggle sidebar",
    }).parentElement;
    expect(floatingTrigger?.classList.contains("bg-background")).toBe(true);
    expect(floatingTrigger?.classList.contains("opacity-100")).toBe(true);
    expect(floatingTrigger?.classList.contains("opacity-65")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(
      screen.getAllByRole("button", { name: "Toggle sidebar" }),
    ).toHaveLength(1);
  });
});

describe("ReaderSettingsProvider", () => {
  it("shares one settings snapshot across consumers", () => {
    render(
      createElement(
        ReaderSettingsProvider,
        null,
        createElement(ThemeProbe, { label: "first" }),
        createElement(ThemeProbe, { label: "second" }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "first" }));

    expect(screen.getByRole("button", { name: "first" }).textContent).toBe(
      "dark",
    );
    expect(screen.getByRole("button", { name: "second" }).textContent).toBe(
      "dark",
    );
  });

  it("resolves system appearance and keeps following the system theme", () => {
    let onSystemThemeChange: ((event: MediaQueryListEvent) => void) | null =
      null;
    window.matchMedia = vi.fn(
      () =>
        ({
          ...createMediaQueryList("(prefers-color-scheme: dark)"),
          addEventListener: vi.fn(
            (
              eventName: string,
              listener: (event: MediaQueryListEvent) => void,
            ) => {
              if (eventName === "change") onSystemThemeChange = listener;
            },
          ),
        }) as MediaQueryList,
    );

    render(
      createElement(
        ReaderSettingsProvider,
        null,
        createElement(AppearanceProbe),
      ),
    );

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button").textContent).toBe("system:light");

    act(() => {
      onSystemThemeChange?.({ matches: true } as MediaQueryListEvent);
    });
    expect(screen.getByRole("button").textContent).toBe("system:dark");
  });
});
