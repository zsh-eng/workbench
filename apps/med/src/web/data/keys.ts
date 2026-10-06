// One key vocabulary for keycaps, tooltips, palettes, and the shortcut guide.
//
// Notation: `+` joins the keys of one chord ("Mod+Shift+K"); a space separates
// the steps of a sequence ("g g", ": {line} Enter"). `Mod` is Command on macOS
// and Control elsewhere, matching Med's handlers. `{name}` is a placeholder the
// person types, such as `{char}` or `{a–z}`. Bare letters keep their case:
// Vim and Med treat `N` as Shift+N.

export type Platform = "mac" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "mac";
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const value = data?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad/i.test(value) ? "mac" : "other";
}

export const platform: Platform = detectPlatform();

const glyphs: Record<string, string> = {
  "⌘": "Mod",
  "⌃": "Ctrl",
  "⌥": "Alt",
  "⇧": "Shift",
  "↵": "Enter",
  "⌫": "Backspace",
};

const labels: Record<string, Record<Platform, string>> = {
  Mod: { mac: "⌘", other: "Ctrl" },
  Cmd: { mac: "⌘", other: "Ctrl" },
  Ctrl: { mac: "⌃", other: "Ctrl" },
  Alt: { mac: "⌥", other: "Alt" },
  Shift: { mac: "⇧", other: "Shift" },
  Enter: { mac: "↵", other: "Enter" },
  Backspace: { mac: "⌫", other: "Backspace" },
  Delete: { mac: "⌦", other: "Delete" },
  Escape: { mac: "Esc", other: "Esc" },
  Esc: { mac: "Esc", other: "Esc" },
  Tab: { mac: "Tab", other: "Tab" },
  Space: { mac: "Space", other: "Space" },
  Up: { mac: "↑", other: "↑" },
  Down: { mac: "↓", other: "↓" },
  Left: { mac: "←", other: "←" },
  Right: { mac: "→", other: "→" },
  Click: { mac: "Click", other: "Click" },
};

const spoken: Record<string, Record<Platform, string>> = {
  Mod: { mac: "Command", other: "Control" },
  Cmd: { mac: "Command", other: "Control" },
  Ctrl: { mac: "Control", other: "Control" },
  Alt: { mac: "Option", other: "Alt" },
  Shift: { mac: "Shift", other: "Shift" },
  Up: { mac: "Up arrow", other: "Up arrow" },
  Down: { mac: "Down arrow", other: "Down arrow" },
  Left: { mac: "Left arrow", other: "Left arrow" },
  Right: { mac: "Right arrow", other: "Right arrow" },
  Esc: { mac: "Escape", other: "Escape" },
};

const modifiers = new Set(["Mod", "Cmd", "Ctrl", "Alt", "Shift"]);

/** Normalize one written key, accepting the legacy glyph spellings. */
export function normalizeKey(token: string): string {
  return glyphs[token] ?? (token === "↑" ? "Up" : token === "↓" ? "Down" : token);
}

export function isModifier(token: string) {
  return modifiers.has(normalizeKey(token));
}

export function isPlaceholder(token: string) {
  return /^\{.+\}$/.test(token);
}

/** The keycap text for one key on this platform. */
export function keyLabel(token: string, target: Platform = platform): string {
  const key = normalizeKey(token);
  if (isPlaceholder(key)) return key.slice(1, -1);
  return labels[key]?.[target] ?? key;
}

/** Words a screen reader or a search query can use for one key. */
export function keyWords(token: string, target: Platform = platform): string {
  const key = normalizeKey(token);
  if (isPlaceholder(key)) return key.slice(1, -1);
  if (spoken[key]) return spoken[key][target];
  if (/^[A-Z]$/.test(key)) return `Shift ${key}`;
  return key;
}

/** A shortcut as steps of chords: "g g" → [["g"], ["g"]]; "Mod+K" → [["Mod", "K"]]. */
export function parseShortcut(value: string): string[][] {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((step) => (step.length > 1 && step.includes("+") ? step.split("+") : [step]));
}

/**
 * Split a legacy keycap string such as "⌘ ⇧ K", "⌘⇧K", or "↑ ↓" into keys. Each
 * key renders as its own cap; this does not imply a sequence.
 */
export function splitLegacyKeys(value: string): string[] {
  return value
    .trim()
    .split(/\s+|(?=[⌘⇧⌥⌃])|(?<=[⌘⇧⌥⌃])/)
    .filter(Boolean);
}

/** Plain text for search and accessible names, on this platform. */
export function describeShortcut(value: string, target: Platform = platform): string {
  return parseShortcut(value)
    .map((chord) => chord.map((key) => keyWords(key, target)).join(" "))
    .join(", then ");
}

/** Every spelling of a shortcut a person might search for: "zz", "⌘K", "cmd k". */
export function shortcutSearchText(value: string, target: Platform = platform): string {
  const steps = parseShortcut(value);
  const glyph = steps.map((chord) => chord.map((key) => keyLabel(key, target)).join("")).join("");
  const words = describeShortcut(value, target);
  const aliases = steps
    .flat()
    .map((key) => {
      const normalized = normalizeKey(key);
      return normalized === "Mod" ? (target === "mac" ? "cmd command" : "ctrl control") : "";
    })
    .join(" ");
  return `${value} ${value.replace(/\s+/g, "")} ${glyph} ${words} ${aliases}`.toLowerCase();
}
