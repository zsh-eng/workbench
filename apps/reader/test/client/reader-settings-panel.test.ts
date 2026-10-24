import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "@/features/reader/ReaderSettingsSheet";
import type { ReaderSettings } from "@/types/reader.types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

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
const originalScrollIntoView = Element.prototype.scrollIntoView;

function SettingsPanelHarness() {
  const [currentSettings, updateSettings] = useState(settings);
  const [activeTab, setActiveTab] = useState<ReaderSettingsPanelTab>("type");

  return createElement(ReaderSettingsPanel, {
    settings: currentSettings,
    onUpdateSettings: (changes) =>
      updateSettings((previous) => ({ ...previous, ...changes })),
    activeTab,
    onActiveTabChange: setActiveTab,
  });
}

afterEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

it("exposes names and current choices through the composed mobile controls", () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(createElement(SettingsPanelHarness));
  expect(
    screen.getByRole("button", { name: "Lora", pressed: true }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "System", pressed: false }),
  );
  expect(
    screen.getByRole("button", { name: "System", pressed: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Lora", pressed: false }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
  for (const name of ["Left", "Center", "Right", "Justify"]) {
    expect(
      screen.getByRole("button", { name }).getAttribute("aria-label"),
    ).toBe(name);
  }
  fireEvent.click(screen.getByRole("button", { name: "Center" }));
  expect(
    screen.getByRole("button", { name: "Center", pressed: true }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Theme" }));
  expect(
    screen.getByRole("button", { name: "Light", pressed: true }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Night", pressed: false }),
  );
  expect(
    screen.getByRole("button", { name: "Night", pressed: true }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Light", pressed: false }),
  ).toBeTruthy();
});

it("exposes page preferences in the mobile Layout panel", () => {
  Element.prototype.scrollIntoView = vi.fn();
  render(createElement(SettingsPanelHarness));
  fireEvent.click(screen.getByRole("tab", { name: "Layout" }));
  for (const name of ["Page animations", "Page numbers"]) {
    const toggle = screen.getByRole("switch", { name });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  }
});
