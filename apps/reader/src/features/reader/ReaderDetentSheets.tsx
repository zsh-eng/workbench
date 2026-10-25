import {
  DetentSheet,
  type DetentSheetSnapPoint,
} from "@/components/ui/detent-sheet";
import { useState, type ReactNode } from "react";
import type { ReaderSheetId } from "./types";

interface ReaderSheetPage {
  title: string;
  snapPoints?: DetentSheetSnapPoint[];
  height?: "content" | "tall";
  /** Holds its height for content that changes (DetentSheet's `fit`). */
  fit?: boolean;
  /** Opens over Reader tools. Otherwise it takes the place of the tools. */
  stacks: boolean;
  /** Dims the page under the sheet. */
  dim: boolean;
}

/**
 * The medium detent every list shares: a little over half the screen, so
 * lists stacked over Reader tools open with the same top edge and the page
 * shows above them. A shorter list fits its content instead.
 */
export const MEDIUM_DETENT = "min(55dvh, 100%)";

/**
 * How each Reader sheet rests. Menus fit their content. Lists open at the
 * medium detent and drag up to full height. Appearance takes the place of
 * Reader tools, fits its tab, and does not dim, so the page stays in view
 * while it changes.
 */
export const READER_SHEET_PAGES: Record<ReaderSheetId, ReaderSheetPage> = {
  tools: { title: "Reader tools", stacks: false, dim: true },
  contents: {
    title: "Contents",
    snapPoints: [MEDIUM_DETENT],
    stacks: true,
    dim: true,
  },
  settings: { title: "Appearance", stacks: false, dim: false },
  // Results stream in under the field, so search keeps its full height
  // and rests at the medium detent below it.
  search: {
    title: "Search book",
    snapPoints: [MEDIUM_DETENT],
    height: "tall",
    stacks: true,
    dim: true,
  },
  "book-actions": { title: "Reading status", stacks: true, dim: true },
  // Entries come and go while it is open, so it holds its height for them.
  notes: {
    title: "Notebook",
    snapPoints: [MEDIUM_DETENT],
    fit: true,
    stacks: true,
    dim: true,
  },
};

const PAGES = (Object.keys(READER_SHEET_PAGES) as ReaderSheetId[]).filter(
  (page) => page !== "tools",
);

/**
 * The phone Reader's sheets on React Aria's Sheet, one sheet per page. A
 * page that stacks opens over Reader tools, and Back or a swipe down returns
 * to the tools. Other pages, and pages opened directly, stand alone.
 */
export function ReaderDetentSheets({
  activeSheet,
  onOpenSheet,
  onCloseSheet,
  renderPage,
}: {
  activeSheet: ReaderSheetId | null;
  onOpenSheet: (sheet: ReaderSheetId) => void;
  onCloseSheet: () => void;
  renderPage: (page: ReaderSheetId) => ReactNode;
}) {
  // The lowest open sheet. Pages stack only over Reader tools.
  const [root, setRoot] = useState(activeSheet);
  const [previous, setPrevious] = useState(activeSheet);
  if (previous !== activeSheet) {
    setPrevious(activeSheet);
    if (
      activeSheet !== null &&
      (previous === null || !READER_SHEET_PAGES[activeSheet].stacks)
    )
      setRoot(activeSheet);
  }
  const stacked = root === "tools";

  return (
    <>
      <DetentSheet
        isOpen={stacked && activeSheet !== null}
        onOpenChange={(open) => {
          if (!open) onCloseSheet();
        }}
        title={READER_SHEET_PAGES.tools.title}
      >
        {renderPage("tools")}
      </DetentSheet>
      {PAGES.map((page) => {
        const { title, snapPoints, height, fit, dim } =
          READER_SHEET_PAGES[page];
        const close = stacked ? () => onOpenSheet("tools") : onCloseSheet;
        return (
          <DetentSheet
            key={page}
            isOpen={activeSheet === page}
            onOpenChange={(open) => {
              if (!open) close();
            }}
            title={title}
            snapPoints={snapPoints}
            height={height}
            fit={fit}
            dim={dim}
            stacked={stacked}
            onBack={stacked ? close : undefined}
            backLabel="Back to reader tools"
          >
            {renderPage(page)}
          </DetentSheet>
        );
      })}
    </>
  );
}
