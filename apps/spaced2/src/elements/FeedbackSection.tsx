import FlashcardTable from "@/components/cards-table";
import DeckCard from "@/components/deck/deck-card";
import { ConnectionNotice } from "@/components/profile/connection-notice";
import EmptyReviewUi from "@/components/review/empty";
import EmptyStats from "@/components/stats/empty";
import {
  UpdatePillButton,
  type UpdatePillPhase,
} from "@/components/update-pill";
import {
  HistoryRestoreNote,
  SyncBoundary,
  type SyncStatusSource,
} from "@/components/sync-status";
import type { Restoring } from "@/lib/sync/engine";
import EmptyImages from "@/lib/images/empty";
import { useMemo, useState } from "react";
import { sampleDecks } from "./deck-fixture";
import { ElementsSection } from "./ElementsLayout";
import { FrameSpecimen } from "./FrameSpecimen";
import { useSelection } from "./selection";
import { Specimen } from "./Specimen";

const RESTORE_STATES = [
  { id: "cards", label: "Restoring cards" },
  { id: "history", label: "Restoring history" },
  { id: "restored", label: "Restored" },
] as const;

/** A sync status that never changes, so the boundary does not run sync. */
function sampleSyncStatus(restoring: Restoring): SyncStatusSource {
  const snapshot = { syncing: restoring !== false, error: null, restoring };
  return { subscribe: () => () => {}, getSnapshot: () => snapshot };
}

function Restore() {
  const selection = useSelection(RESTORE_STATES);
  const restoring: Restoring =
    selection.state === "cards" || selection.state === "history"
      ? selection.state
      : false;
  const source = useMemo(() => sampleSyncStatus(restoring), [restoring]);
  const [deck] = useState(() => sampleDecks()[0]);
  return (
    <Specimen
      title="First restore"
      note="On a new device the sync boundary holds the pages until the cards are stored; Review then opens with a note while the review history restores, and only Stats waits for it. The specimen gives SyncBoundary a sample status, so nothing syncs."
      states={RESTORE_STATES}
      selection={selection}
    >
      <div className="grid min-h-40 grid-cols-12 items-start">
        <SyncBoundary source={source}>
          <div className="relative col-span-12 flex justify-center pt-8">
            <HistoryRestoreNote source={source} />
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
      note="The top of the Profile page while the device is offline. It goes away when the device is back online."
    >
      <ConnectionNotice status="offline" />
    </Specimen>
  );
}

const UPDATE_STATES = [
  { id: "ready", label: "Ready" },
  { id: "restarting", label: "Restarting" },
] as const;

function Update() {
  const selection = useSelection(UPDATE_STATES);
  return (
    <Specimen
      title="Update"
      note="A new version is ready. The pill floats above the tab bar, except while a card is on the review screen; a tap restarts into it. After the reload, a toast says Updated."
      states={UPDATE_STATES}
      selection={selection}
    >
      <div className="flex justify-center">
        <UpdatePillButton
          phase={selection.state as UpdatePillPhase}
          onRestart={() => selection.choose("restarting")}
        />
      </div>
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
      description="Toasts after actions, sync and session notices, the app update, and empty states. Toasts and the session banner cover the screen, so they show in device frames."
    >
      <FrameSpecimen id="toasts" />
      <FrameSpecimen id="session" />
      <Restore />
      <Offline />
      <Update />
      <EmptyStates />
    </ElementsSection>
  );
}
