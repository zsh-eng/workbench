import DeckCard from "@/components/deck/deck-card";
import DeckCardSkeleton from "@/components/deck/deck-card-skeleton";
import { DeckSelectionCard } from "@/routes/CreateFlashcardRoute";
import { useDemoPlayer } from "@workbench/elements/react";
import { useState } from "react";
import { sampleDecks, sampleLongDecks } from "./deck-fixture";
import { DemoControls } from "./DemoControls";
import { ElementsSection } from "./ElementsLayout";
import { useSelection } from "./selection";
import { Specimen } from "./Specimen";

const DECK_STATES = [
  { id: "decks", label: "Decks" },
  { id: "loading", label: "Loading" },
  { id: "long", label: "Long text" },
] as const;

function DeckCards() {
  const selection = useSelection(DECK_STATES);
  const [decks] = useState(() => ({
    decks: sampleDecks(),
    long: sampleLongDecks(),
  }));
  const total = decks.decks.reduce((sum, deck) => sum + deck.cardCount, 0);
  return (
    <Specimen
      title="Deck cards"
      note="The Decks page grid. All Cards comes first; a deck shows a skeleton until its record loads. Long names wrap and the description keeps one line."
      states={DECK_STATES}
      selection={selection}
    >
      <div className="flex flex-wrap items-start justify-center gap-4">
        {selection.state === "decks" && (
          <>
            <DeckCard
              id="_all"
              name="All Cards"
              description=""
              lastModified={new Date()}
              cardCount={total}
            />
            {decks.decks.map((deck) => (
              <DeckCard key={deck.id} {...deck} />
            ))}
          </>
        )}
        {selection.state === "loading" &&
          [0, 1, 2].map((index) => <DeckCardSkeleton key={index} />)}
        {selection.state === "long" &&
          decks.long.map((deck) => <DeckCard key={deck.id} {...deck} />)}
      </div>
    </Specimen>
  );
}

const PICKER_STATES = [
  { id: "unselected", label: "Not selected" },
  { id: "selected", label: "Selected" },
] as const;

function DeckPicker() {
  const selection = useSelection(PICKER_STATES);
  const demo = useDemoPlayer();
  const [decks] = useState(() => sampleDecks().slice(0, 3));
  return (
    <Specimen
      title="Deck picker"
      note="Cards on the Create page that choose the new card's decks. Selecting one shows the check with a bounce; Replay plays it again. Tap a card to toggle it."
      states={PICKER_STATES}
      selection={selection}
      controls={<DemoControls demo={demo} label="Deck picker" />}
      stageRef={demo.stageRef}
      stageProps={demo.stageProps()}
    >
      <PickerRow
        key={`${selection.state}:${selection.nonce}:${demo.state.run}`}
        decks={decks}
        initial={selection.state === "selected" ? [decks[0].id] : []}
      />
    </Specimen>
  );
}

function PickerRow({
  decks,
  initial,
}: {
  decks: { id: string; name: string }[];
  initial: string[];
}) {
  const [selected, setSelected] = useState(initial);
  return (
    <div className="flex h-48 gap-4 overflow-x-auto rounded-xl bg-background p-4">
      {decks.map((deck) => {
        const isSelected = selected.includes(deck.id);
        return (
          <DeckSelectionCard
            key={deck.id}
            title={deck.name}
            backgroundType={isSelected ? "cool-mint" : "plain"}
            selected={isSelected}
            onSelect={() =>
              setSelected((value) =>
                isSelected
                  ? value.filter((id) => id !== deck.id)
                  : [...value, deck.id],
              )
            }
          />
        );
      })}
    </div>
  );
}

export function DecksSection() {
  return (
    <ElementsSection
      id="decks"
      title="Decks"
      description="Deck cards on the Decks page and deck choices on the Create page. The specimens give the presentational cards sample decks; their containers read the live store."
    >
      <DeckCards />
      <DeckPicker />
    </ElementsSection>
  );
}
