import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useCallback, useMemo, useState } from "react";
import type { ReaderSheetId } from "../types";

const SIDEBAR_TAB_KEY = "epub-reader-sidebar-tab";
type SidebarTab = "contents" | "search" | "settings" | "notes" | "highlights";

function isSidebarTab(value: string | null): value is SidebarTab {
  return (
    value === "contents" ||
    value === "search" ||
    value === "settings" ||
    value === "notes" ||
    value === "highlights"
  );
}

function readSidebarTab(): SidebarTab {
  try {
    const value = getRuntimeStorage().getItem(SIDEBAR_TAB_KEY);
    return isSidebarTab(value) ? value : "contents";
  } catch {
    return "contents";
  }
}

export interface ReaderChromeState {
  activeReaderSheet: ReaderSheetId | null;
}

export interface ReaderChromeActions {
  openReaderSheet: (sheet: ReaderSheetId) => void;
  closeReaderSheet: () => void;
}

export interface UseReaderChromeStateResult {
  state: ReaderChromeState;
  actions: ReaderChromeActions;
}

/**
 * Owns Reader chrome state and the device-local desktop sidebar preference.
 *
 * This hook deliberately stays scoped to reader-level chrome concerns like
 * the active peer sheet. Chrome visibility itself is owned by
 * ReaderController because hover and touch modes reveal it differently.
 */
export function useReaderChromeState(
  isMobile: boolean,
): UseReaderChromeStateResult {
  const [lastSidebarTab, setLastSidebarTab] = useState(readSidebarTab);
  const [activeReaderSheet, setActiveReaderSheet] =
    useState<ReaderSheetId | null>(null);

  const openReaderSheet = useCallback(
    (sheet: ReaderSheetId) => {
      const destination =
        !isMobile && sheet === "tools" ? lastSidebarTab : sheet;
      setActiveReaderSheet(destination);
      if (isMobile || !isSidebarTab(destination)) return;
      setLastSidebarTab(destination);
      try {
        getRuntimeStorage().setItem(SIDEBAR_TAB_KEY, destination);
      } catch {
        // Keep the session preference when browser storage is unavailable.
      }
    },
    [isMobile, lastSidebarTab],
  );

  const closeReaderSheet = useCallback(() => {
    setActiveReaderSheet(null);
  }, []);

  const state = useMemo<ReaderChromeState>(
    () => ({
      activeReaderSheet:
        isMobile && activeReaderSheet === "highlights"
          ? "tools"
          : activeReaderSheet,
    }),
    [activeReaderSheet, isMobile],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      openReaderSheet,
      closeReaderSheet,
    }),
    [closeReaderSheet, openReaderSheet],
  );

  return {
    state,
    actions,
  };
}
