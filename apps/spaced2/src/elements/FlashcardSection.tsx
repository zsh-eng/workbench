import FlashcardContent from "@/components/flashcard-content";
import ActionsDropdownMenu from "@/components/review/actions-dropdown-menu";
import { demoOptionsFromUrl, driveAnimations } from "@workbench/elements";
import { useDemoPlayer } from "@workbench/elements/react";
import { useEffect, useRef, useState } from "react";
import { CARD_SAMPLES, type CardSampleId } from "./card-fixture";
import { DemoControls } from "./DemoControls";
import { ElementsSection } from "./ElementsLayout";
import { useSelection } from "./selection";
import { Specimen } from "./Specimen";

const CONTENT_STATES = [
  { id: "text", label: "Text" },
  { id: "markdown", label: "Markdown" },
  { id: "maths", label: "Maths" },
  { id: "code", label: "Code" },
  { id: "image", label: "Image" },
  { id: "long", label: "Long answer" },
] as const satisfies readonly { id: CardSampleId; label: string }[];

const ENTER_BEATS = [{ at: 0.15, label: "Half in" }] as const;

function Content() {
  const selection = useSelection(CONTENT_STATES);
  const demo = useDemoPlayer({
    duration: 0.3,
    beats: ENTER_BEATS,
    ...demoOptionsFromUrl(),
  });
  const root = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      driveAnimations(
        demo.player,
        () => root.current?.getAnimations?.({ subtree: true }) ?? [],
      ),
    [demo.player],
  );
  const sample = CARD_SAMPLES[selection.state as CardSampleId];
  return (
    <Specimen
      title="Flashcard content"
      note="Markdown, KaTeX maths, highlighted code and images, as the review screen shows the front and the back. Each card fades in when it appears; the timeline holds that fade. The long answer scrolls inside the card."
      states={CONTENT_STATES}
      selection={{
        state: selection.state,
        choose: (state) => {
          selection.choose(state);
          demo.player.restart();
        },
      }}
      controls={
        <DemoControls demo={demo} label="Card enter" beats={ENTER_BEATS} />
      }
      stageRef={demo.stageRef}
      stageProps={demo.stageProps()}
      surface="card"
    >
      <div
        ref={root}
        key={`${selection.state}:${demo.state.run}`}
        className="grid gap-6 sm:grid-cols-2"
      >
        {(["front", "back"] as const).map((side) => (
          <div key={side} className="flex min-w-0 flex-col gap-2">
            <span className="text-xs text-muted-foreground">
              {side === "front" ? "Front" : "Back"}
            </span>
            <FlashcardContent content={sample[side]} />
          </div>
        ))}
      </div>
    </Specimen>
  );
}

const MENU_STATES = [
  { id: "unsaved", label: "Not saved" },
  { id: "saved", label: "Saved" },
] as const;

function CardActions() {
  const selection = useSelection(MENU_STATES);
  const [saved, setSaved] = useState<boolean>();
  const [last, setLast] = useState<string>();
  const bookmarked = saved ?? selection.state === "saved";
  return (
    <Specimen
      title="Card actions menu"
      note="The menu at the top right of the review card. Open it with the ellipsis. Save toggles here; the other actions only name themselves."
      states={MENU_STATES}
      selection={{
        state: selection.state,
        choose: (state) => {
          selection.choose(state);
          setSaved(undefined);
          setLast(undefined);
        },
      }}
      surface="card"
    >
      <div className="flex min-h-24 items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {last ? `Chose ${last}.` : "No action yet."}
        </p>
        <ActionsDropdownMenu
          bookmarked={bookmarked}
          handleBookmark={(next) => {
            setSaved(next);
            setLast(next ? "Save" : "Unsave");
          }}
          handleSkip={() => setLast("Skip")}
          handleBury={() => setLast("Bury")}
          handleEdit={() => setLast("Edit")}
          handleDelete={() => setLast("Delete")}
        />
      </div>
    </Specimen>
  );
}

export function FlashcardSection() {
  return (
    <ElementsSection
      id="flashcard"
      title="Flashcard"
      description="The card itself, rendered by FlashcardContent from Markdown, and the actions on the current card."
    >
      <Content />
      <CardActions />
    </ElementsSection>
  );
}
