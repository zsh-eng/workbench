import { ControlsSection } from "./ControlsSection";
import { DecksSection } from "./DecksSection";
import { ElementsLayout, ElementsSection } from "./ElementsLayout";
import { FeedbackSection } from "./FeedbackSection";
import { FlashcardSection } from "./FlashcardSection";
import { FoundationsSection } from "./FoundationsSection";
import { FrameSpecimen } from "./FrameSpecimen";
import { LiveAppSection } from "./LiveAppSection";

const SECTIONS = [
  { id: "foundations", label: "Foundations" },
  { id: "controls", label: "Controls" },
  { id: "flashcard", label: "Flashcard" },
  { id: "decks", label: "Decks" },
  { id: "feedback", label: "Feedback" },
  { id: "review", label: "Review" },
  { id: "create", label: "Create" },
  { id: "stats", label: "Stats" },
  { id: "live-app", label: "Live app" },
] as const;

/**
 * Elements: Spaced's parts on sample data, from tokens to whole screens.
 * Inline specimens render on this page; screens render alone in desktop and
 * phone frames. Nothing here reads or writes the user's cards, except the
 * Live app row, which loads on request.
 */
export function ElementsPage() {
  return (
    <ElementsLayout sections={SECTIONS}>
      <FoundationsSection />
      <ControlsSection />
      <FlashcardSection />
      <DecksSection />
      <FeedbackSection />
      <ElementsSection
        id="review"
        title="Review"
        description="The review screen: the card, the grade buttons and the actions. Desktop shows both sides with grade buttons below; a phone shows one side at a time with large grade buttons."
      >
        <FrameSpecimen id="review" />
      </ElementsSection>
      <ElementsSection
        id="create"
        title="Create"
        description="Choosing decks and writing a new card. Space focuses the question and ⌘ Enter submits, as on the Create page."
      >
        <FrameSpecimen id="create" />
      </ElementsSection>
      <ElementsSection
        id="stats"
        title="Stats"
        description="Charts of review history. Statistics count a study day from 04:00 in the device's time zone."
      >
        <FrameSpecimen id="stats" />
      </ElementsSection>
      <LiveAppSection />
    </ElementsLayout>
  );
}
