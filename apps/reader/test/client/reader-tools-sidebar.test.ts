import { ReaderToolsSidebar } from "@/features/reader/ReaderToolsSidebar";
import type { ReaderSettings } from "@/types/reader.types";
import { cleanup, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hotkeyHandlers = vi.hoisted(
  () => new Map<string, (event: KeyboardEvent) => void>(),
);

vi.mock("@tanstack/react-hotkeys", () => ({
  useHotkey: (
    hotkey: string | { key: string; mod?: boolean; shift?: boolean },
    handler: (event: KeyboardEvent) => void,
  ) => {
    const normalizedHotkey =
      typeof hotkey === "string"
        ? hotkey
        : `${hotkey.mod ? "Mod+" : ""}${hotkey.shift ? "Shift+" : ""}${hotkey.key}`;
    hotkeyHandlers.set(normalizedHotkey, handler);
  },
}));

vi.mock("@/features/reader/ReaderContentsSheet", () => ({
  ReaderContentsPanel: () => "reader contents",
}));

vi.mock("@/features/reader/ReaderSettingsSheet", () => ({
  ReaderSettingsList: () => "reader settings",
}));

const settings: ReaderSettings = {
  fontSize: 16,
  lineHeight: 1.5,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
  publisherBookStylingEnabled: false,
  matchPublisherBodyTextSize: false,
  pageAnimationsEnabled: true,
  showPageNumbers: true,
};

function renderSidebar(
  activeSheet: "tools" | "contents" | "search" | "settings" | null,
  onOpenPanel = vi.fn(),
  onClose = vi.fn(),
) {
  render(
    createElement(ReaderToolsSidebar, {
      activeSheet,
      onOpenPanel,
      onClose,
      settings,
      onUpdateSettings: vi.fn(),
      toc: [],
      chapterEntries: [],
      chapterStartPages: [],
      currentChapterHref: "",
      onNavigateToHref: vi.fn(() => true),
      triggerRef: createRef<HTMLButtonElement>(),
    }),
  );
}

afterEach(() => {
  cleanup();
  hotkeyHandlers.clear();
});

describe("ReaderToolsSidebar", () => {
  // The chrome-state tests verify that "tools" restores the stored desktop tab.
  it("opens the remembered panel and closes with Command or Control + Shift + Backslash", () => {
    const onOpenPanel = vi.fn();
    renderSidebar(null, onOpenPanel);

    const preventDefault = vi.fn();
    hotkeyHandlers.get("Mod+Shift+\\")?.({ preventDefault } as never);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onOpenPanel).toHaveBeenCalledWith("tools");

    cleanup();
    hotkeyHandlers.clear();

    const onClose = vi.fn();
    renderSidebar("settings", vi.fn(), onClose);
    hotkeyHandlers.get("Mod+Shift+\\")?.({ preventDefault: vi.fn() } as never);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
