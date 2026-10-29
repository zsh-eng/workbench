import FlashcardTable from "@/components/cards-table";
import { ConnectionNotice } from "@/components/profile/connection-notice";
import EmptyReviewUi from "@/components/review/empty";
import EmptyStats from "@/components/stats/empty";
import {
  UpdatePillButton,
  type UpdatePillPhase,
} from "@/components/update-pill";
import EmptyImages from "@/lib/images/empty";
import { ElementsSection } from "./ElementsLayout";
import { FrameSpecimen } from "./FrameSpecimen";
import { useSelection } from "./selection";
import { Specimen } from "./Specimen";

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
      <FrameSpecimen id="restore" />
      <Offline />
      <Update />
      <EmptyStates />
    </ElementsSection>
  );
}
