import { useEffect, useMemo, useState } from "react";
import type {
  ReaderSessionActions,
  ReaderSessionResources,
  ReaderSessionState,
} from "../hooks/use-reader-session";
import { FooterPageIndicator } from "./FooterPageIndicator";
import { ReaderHistoryStrip } from "./ReaderHistoryStrip";

interface ReaderHistoryPageIndicatorProps {
  state: ReaderSessionState;
  locateAnchors: ReaderSessionResources["locateAnchors"];
  onSelect: ReaderSessionActions["selectHistoryVisit"];
  onPreview: ReaderSessionActions["previewHistoryVisit"];
  onRestore: ReaderSessionActions["restoreHistoryVisit"];
  onExpandedChange: ReaderSessionActions["setHistoryExpanded"];
}

/** Resolve saved content anchors in the current layout. These labels never
 * replace the anchors, and unavailable destinations remain disabled.
 */
export function ReaderHistoryPageIndicator({
  state,
  locateAnchors,
  onSelect,
  onPreview,
  onRestore,
  onExpandedChange,
}: ReaderHistoryPageIndicatorProps) {
  const [animate, setAnimate] = useState(true);
  const {
    jumpHistory: history,
    historyPresentation: presentation,
    pagination,
    navigation,
  } = state;
  useEffect(() => setAnimate(true), [history.cursor, history.entries]);
  const layoutKey = JSON.stringify([
    pagination.paginationConfig,
    navigation.chapterStartPages,
  ]);
  const requests = useMemo(
    () =>
      history.entries.map((entry, index) => ({
        id: JSON.stringify([
          layoutKey,
          presentation.firstSlot + index,
          entry.anchor,
        ]),
        anchor: entry.anchor,
      })),
    [history.entries, presentation.firstSlot, layoutKey],
  );
  useEffect(() => {
    if (pagination.status !== "ready" || !requests.length) return;
    locateAnchors(requests, "history");
  }, [requests, locateAnchors, pagination.status]);
  if (!history.entries.length)
    return (
      <FooterPageIndicator
        currentPage={navigation.currentPage}
        totalPages={navigation.totalPages}
      />
    );
  const entries = history.entries.map((entry, index) => ({
    slot: presentation.firstSlot + index,
    kind: entry.kind,
    // In a multi-page spread the target can be on the second page. Use the
    // anchor's page for every visit, including the current one.
    page: pagination.historyAnchorPages[requests[index].id] ?? null,
  }));
  return (
    <ReaderHistoryStrip
      entries={entries}
      cursor={history.cursor}
      page={navigation.currentPage}
      total={navigation.totalPages}
      expanded={presentation.expanded && !presentation.preview}
      animate={animate}
      onSelect={(index, shouldAnimate) => {
        setAnimate(shouldAnimate);
        onSelect(index);
      }}
      onExpandedChange={(expanded) => {
        setAnimate(true);
        onExpandedChange(expanded);
      }}
      onPreview={onPreview}
      onRestore={onRestore}
    />
  );
}
