import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import type { ContentAnchor, SpreadIntent } from "@/lib/pagination-v2";
import {
  EMPTY_READER_HISTORY,
  ReaderJumpHistoryController,
} from "../jump-history";
import {
  loadReaderJumpHistory,
  saveReaderJumpHistory,
} from "../data/jump-history-storage";

import {
  QUIET_HISTORY,
  updateHistoryPresentation,
} from "../history-presentation";

/** A book-scoped controller. Worker results update it directly, before React
 * can batch renders, so intermediate confirmed jumps are not lost.
 */
export function useReaderJumpHistory(bookId: string, sourceFileId: string) {
  const owner = useMemo(() => {
    let initial = EMPTY_READER_HISTORY;
    try {
      initial = loadReaderJumpHistory(
        getRuntimeStorage(),
        bookId,
        sourceFileId,
      );
    } catch {
      /* Storage can be unavailable; navigation still works in memory. */
    }
    const controller = new ReaderJumpHistoryController(initial);
    const listeners = new Set<() => void>();
    let snapshot = { history: initial, presentation: QUIET_HISTORY };
    const notify = () => listeners.forEach((listener) => listener());
    return {
      getSnapshot: () => snapshot,
      setExpanded(expanded: boolean) {
        if (snapshot.presentation.expanded === expanded) return;
        snapshot = {
          ...snapshot,
          presentation: { ...snapshot.presentation, expanded },
        };
        notify();
      },
      controller,
      initialAnchor:
        controller.getSnapshot().entries[controller.getSnapshot().cursor]
          ?.anchor,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      record(anchor: ContentAnchor, intent: SpreadIntent) {
        if (!bookId || !sourceFileId) return;
        const previous = controller.getSnapshot();
        const next = controller.record(anchor, intent);
        const presentation = updateHistoryPresentation(
          snapshot.presentation,
          previous,
          next,
          intent,
        );
        if (next === previous && presentation === snapshot.presentation) return;
        snapshot = { history: next, presentation };
        if (next !== previous)
          try {
            saveReaderJumpHistory(
              getRuntimeStorage(),
              bookId,
              sourceFileId,
              next,
            );
          } catch (error) {
            console.warn("Could not save Reader jump history", error);
          }
        notify();
      },
    };
  }, [bookId, sourceFileId]);
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  const select = useCallback(
    (
      targetIndex: number,
      navigate: (
        anchor: ContentAnchor,
        options: { intent: SpreadIntent },
      ) => void,
    ) => {
      const target = owner.controller.getSnapshot().entries[targetIndex];
      if (target)
        navigate(target.anchor, { intent: { kind: "history", targetIndex } });
    },
    [owner],
  );
  // A scrub along the trail shows a visit without taking it, then puts the
  // reader back at the current visit if the finger lets go there.
  const preview = useCallback(
    (
      targetIndex: number,
      navigate: (
        anchor: ContentAnchor,
        options: { intent: SpreadIntent },
      ) => void,
    ) => {
      const target = owner.controller.getSnapshot().entries[targetIndex];
      if (target)
        navigate(target.anchor, {
          intent: { kind: "preview", source: "history" },
        });
    },
    [owner],
  );
  const restore = useCallback(
    (
      navigate: (
        anchor: ContentAnchor,
        options: { intent: SpreadIntent },
      ) => void,
    ) => {
      const { entries, cursor } = owner.controller.getSnapshot();
      const current = entries[cursor];
      if (current) navigate(current.anchor, { intent: { kind: "restore" } });
    },
    [owner],
  );
  const go = useCallback(
    (
      direction: "back" | "forward",
      navigate: (
        anchor: ContentAnchor,
        options: { intent: SpreadIntent },
      ) => void,
    ) => {
      const target = owner.controller.getReturnTarget(direction);
      if (target) navigate(target.anchor, { intent: target.intent });
    },
    [owner],
  );
  return {
    state: snapshot.history,
    presentation: snapshot.presentation,
    setExpanded: owner.setExpanded,
    select,
    preview,
    restore,
    initialAnchor: owner.initialAnchor,
    record: owner.record,
    endGroup: owner.controller.endGroup,
    go,
  };
}
