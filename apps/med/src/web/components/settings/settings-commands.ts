import type { ReviewCommand } from "../Controls";
import type { SettingsSection } from "./SettingsParts";

/** Settings' sections, in the page's order, as ⌘K names them. */
const SECTIONS: { section: SettingsSection; label: string }[] = [
  { section: "appearance", label: "Appearance" },
  { section: "code", label: "Code" },
  { section: "open-in", label: "Open in" },
  { section: "files", label: "Files and sessions" },
  { section: "sources", label: "Sources" },
  { section: "file", label: "Settings file" },
];

/** Opens Settings at a section; the page scrolls to it. */
export function openSettings(section?: SettingsSection) {
  history.pushState(
    null,
    "",
    section && section !== "appearance" ? `/settings/${section}` : "/settings",
  );
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** ⌘K's Settings, and each of its sections. */
export const settingsCommands = (): ReviewCommand[] => [
  {
    id: "settings",
    icon: "settings",
    group: "Settings",
    label: "Open Settings",
    run: () => openSettings(),
  },
  ...SECTIONS.map(({ section, label }) => ({
    id: `settings-${section}`,
    icon: "settings" as const,
    group: "Settings" as const,
    label: `Settings: ${label}`,
    run: () => openSettings(section),
  })),
];
