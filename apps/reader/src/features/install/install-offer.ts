import { getLabRuntime } from "@/features/sync-lab/runtime";
import { useSyncExternalStore } from "react";
import {
  currentTraits,
  installPlatform,
  isInstalled,
  type InstallPlatform,
} from "./install-platform";
import { useInstallPrompt } from "./install-prompt";

const STORAGE_KEY = "reader-install-offer-v1";

/** Time away that starts a new visit: the usual gap between two sessions. */
export const VISIT_GAP_MS = 30 * 60_000;

/** What this browser remembers about offering to install. */
export interface InstallOfferRecord {
  /** Page loads, and returns to the page, after VISIT_GAP_MS away. */
  visits: number;
  /** When the page was last open and in view. */
  lastSeenAt: number;
  /** When the library first got a book while the page was open. */
  firstBookAt: number | null;
  /** When the sheet was closed. It never opens by itself again. */
  closedAt: number | null;
}

const EMPTY: InstallOfferRecord = {
  visits: 0,
  lastSeenAt: 0,
  firstBookAt: null,
  closedAt: null,
};

export function readOfferRecord(): InstallOfferRecord {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function writeOfferRecord(
  change: (record: InstallOfferRecord) => Partial<InstallOfferRecord>,
): InstallOfferRecord {
  const record = readOfferRecord();
  const next = { ...record, ...change(record) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A blocked store keeps the offer to this visit; it never nags twice in one.
  }
  return next;
}

/** Counts a visit when the page opens or comes back after a long time away. */
export function recordVisit(now = Date.now()): InstallOfferRecord {
  return writeOfferRecord((record) => ({
    visits:
      now - record.lastSeenAt >= VISIT_GAP_MS
        ? record.visits + 1
        : record.visits,
    lastSeenAt: now,
  }));
}

/** Marks the page as seen until now, so a reload is not a new visit. */
export function recordSeen(now = Date.now()): void {
  writeOfferRecord(() => ({ lastSeenAt: now }));
}

export function recordFirstBook(now = Date.now()): InstallOfferRecord {
  return writeOfferRecord((record) => ({
    firstBookAt: record.firstBookAt ?? now,
  }));
}

export function recordSheetClosed(now = Date.now()): InstallOfferRecord {
  return writeOfferRecord(() => ({ closedAt: now }));
}

/**
 * The sheet may open by itself once: after the first book is added, or on
 * a second visit, until it has been closed.
 */
export function offerDue(record: InstallOfferRecord): boolean {
  if (record.closedAt !== null) return false;
  return record.firstBookAt !== null || record.visits >= 2;
}

/** Platforms where the sheet opens by itself: installing takes a few taps. */
export function offersByItself(
  platform: InstallPlatform,
  canPrompt: boolean,
): boolean {
  return platform === "ios-safari" || (platform === "chromium" && canPrompt);
}

export interface InstallAvailability {
  platform: InstallPlatform;
  /** Reader runs from the Home Screen or the Dock, or was just installed. */
  installed: boolean;
  /** Chromium holds an install prompt. */
  canPrompt: boolean;
  /** The sheet has a way to install here: the menu and Settings offer it. */
  available: boolean;
}

/**
 * Frames (Elements, Design ideas) and Sync Lab clients show one part of
 * the app: they never offer to install, and have no sheet to open.
 */
export function hostsInstallOffer(): boolean {
  return !getLabRuntime() && window.parent === window;
}

/**
 * Whether and how this browser can install Reader. Chromium can install
 * only while it holds a prompt; it holds none once Reader is installed.
 */
export function useInstallAvailability(): InstallAvailability {
  const { prompt, installedHere } = useInstallPrompt();
  const platform = installPlatform(currentTraits());
  const installed = installedHere || isInstalled();
  const canPrompt = prompt !== null;
  const available =
    hostsInstallOffer() &&
    !installed &&
    (platform === "ios-safari" ||
      platform === "ios-other" ||
      platform === "mac-safari" ||
      (platform === "chromium" && canPrompt));
  return { platform, installed, canPrompt, available };
}

/** Who opened the sheet: the Library at a calm moment, or the person. */
export type InstallSheetSource = "offer" | "menu";

interface InstallSheetState {
  open: boolean;
  source: InstallSheetSource;
}

let sheetState: InstallSheetState = { open: false, source: "menu" };
const sheetListeners = new Set<() => void>();

function publishSheet(next: InstallSheetState): void {
  sheetState = next;
  for (const listener of sheetListeners) listener();
}

/** Opens the install sheet; InstallOfferHost renders it. */
export function openInstallSheet(source: InstallSheetSource = "menu"): void {
  publishSheet({ open: true, source });
}

export function closeInstallSheet(): void {
  if (!sheetState.open) return;
  publishSheet({ ...sheetState, open: false });
}

export function useInstallSheet(): InstallSheetState {
  return useSyncExternalStore(
    (listener) => {
      sheetListeners.add(listener);
      return () => sheetListeners.delete(listener);
    },
    () => sheetState,
  );
}
