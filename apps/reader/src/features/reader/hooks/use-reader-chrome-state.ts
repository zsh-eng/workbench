import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useCallback, useMemo, useState } from "react";
import type { ReaderSheetId } from "../types";

const SIDEBAR_TAB_KEY = "epub-reader-sidebar-tab";
type SidebarTab = "contents" | "search" | "settings" | "notes";

function isSidebarTab(value: string | null): value is SidebarTab {
  return (
    value === "contents" ||
    value === "search" ||
    value === "settings" ||
    value === "notes"
  );
}

function readSidebarTab(): SidebarTab {
  try {
    const value = getRuntimeStorage().getItem(SIDEBAR_TAB_KEY);
    // The Highlights tab joined the notebook.
    if (value === "highlights") return "notes";
    return isSidebarTab(value) ? value : "contents";
  } catch {
    return "contents";
  }
}

export interface ReaderChromeState {
  isBookmarked: boolean;
  activeReaderSheet: ReaderSheetId | null;
}

export interface ReaderChromeActions {
  toggleBookmark: () => void;
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
 * bookmark affordances and the active peer sheet. Chrome visibility itself is
 * owned by ReaderController because hover and touch modes reveal it differently.
 */
export function useReaderChromeState(
  isMobile: boolean,
): UseReaderChromeStateResult {
  const [lastSidebarTab, setLastSidebarTab] = useState(readSidebarTab);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [activeReaderSheet, setActiveReaderSheet] =
    useState<ReaderSheetId | null>(null);

  const toggleBookmark = useCallback(() => {
    setIsBookmarked((bookmarked) => !bookmarked);
  }, []);

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
      isBookmarked,
      activeReaderSheet,
    }),
    [activeReaderSheet, isBookmarked],
  );

  const actions = useMemo<ReaderChromeActions>(
    () => ({
      toggleBookmark,
      openReaderSheet,
      closeReaderSheet,
    }),
    [closeReaderSheet, openReaderSheet, toggleBookmark],
  );

  return {
    state,
    actions,
  };
}
