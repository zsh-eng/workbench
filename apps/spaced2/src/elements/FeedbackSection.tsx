import FlashcardTable from "@/components/cards-table";
import DeckCard from "@/components/deck/deck-card";
import OfflineUsageDialog from "@/components/profile/offline-usage-dialog";
import EmptyReviewUi from "@/components/review/empty";
import EmptyStats from "@/components/stats/empty";
import { SyncBoundary, type SyncStatusSource } from "@/components/sync-status";
import EmptyImages from "@/lib/images/empty";
import { useMemo, useState } from "react";
import { sampleDecks } from "./deck-fixture";
import { ElementsSection } from "./ElementsLayout";
import { FrameSpecimen } from "./FrameSpecimen";
import { useSelection } from "./selection";
import { Specimen } from "./Specimen";

const RESTORE_STATES = [
  { id: "restoring", label: "Restoring" },
  { id: "restored", label: "Restored" },
] as const;

/** A sync status that never changes, so the boundary does not run sync. */
function sampleSyncStatus(restoring: boolean): SyncStatusSource {
  const snapshot = { syncing: restoring, error: null, restoring };
  return { subscribe: () => () => {}, getSnapshot: () => snapshot };
}

function Restore() {
  const selection = useSelection(RESTORE_STATES);
  const restoring = selection.state === "restoring";
  const source = useMemo(() => sampleSyncStatus(restoring), [restoring]);
  const [deck] = useState(() => sampleDecks()[0]);
  return (
    <Specimen
      title="First restore"
      note="On a new device the sync boundary holds the pages until the first download finishes. The specimen gives SyncBoundary a sample status, so nothing syncs."
      states={RESTORE_STATES}
      selection={selection}
    >
      <div className="grid min-h-40 grid-cols-12 items-start">
        <SyncBoundary source={source}>
          <div className="col-span-12 flex justify-center">
            <DeckCard {...deck} />
          </div>
        </SyncBoundary>
      </div>
    </Specimen>
  );
}

function Offline() {
  return (
    <Specimen
      title="Offline notice"
      note="The Profile page shows this while the device is offline. What can I do? opens the explanation."
      surface="card"
    >
      <OfflineUsageDialog />
    </Specimen>
  );
}

const EMPTY_STATES = [
  { id: "done", label: "Done for now" },
  { id: "new", label: "No cards yet" },
  { id: "stats", label: "No stats" },
  { id: "images", label: "No offline images" },
  { id: "cards", label: "No cards found" },
] as const;

function EmptyStates() {
  const selection = useSelection(EMPTY_STATES);
  return (
    <Specimen
      title="Empty states"
      note="What each page shows with nothing to list. The review screen's button links to Create; links stay on this page."
      states={EMPTY_STATES}
      selection={selection}
    >
      {selection.state === "done" && (
        <EmptyReviewUi noCardsCreatedYet={false} />
      )}
      {selection.state === "new" && <EmptyReviewUi noCardsCreatedYet />}
      {selection.state === "stats" && <EmptyStats />}
      {selection.state === "images" && (
        <div className="grid grid-cols-3">
          <EmptyImages />
        </div>
      )}
      {selection.state === "cards" && <FlashcardTable cards={[]} />}
    </Specimen>
  );
}

export function FeedbackSection() {
  return (
    <ElementsSection
      id="feedback"
      title="Feedback"
      description="Toasts after actions, sync and session notices, and empty states. Toasts and the session banner cover the screen, so they show in device frames."
    >
      <FrameSpecimen id="toasts" />
      <FrameSpecimen id="session" />
      <Restore />
      <Offline />
      <EmptyStates />
    </ElementsSection>
  );
}
