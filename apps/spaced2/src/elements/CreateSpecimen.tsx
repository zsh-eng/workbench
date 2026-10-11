import { CreateUpdateFlashcardForm } from "@/components/create-flashcard";
import SearchBar from "@/components/search-bar";
import { deckMatchesSearch } from "@/lib/deck-search";
import { DeckSelectionCard } from "@/routes/CreateFlashcardRoute";
import { useEffect, useRef, useState } from "react";
import { CARD_SAMPLES } from "./card-fixture";
import { sampleDecks } from "./deck-fixture";
import { sandboxDraft, setSampleDraft } from "./frame-sandbox";
import type { FrameSpecimenProps } from "./selection";

const DRAFTS: Record<string, { front: string; back: string } | null> = {
  empty: null,
  draft: CARD_SAMPLES.maths,
  missing: { front: CARD_SAMPLES.text.front, back: "" },
  failed: CARD_SAMPLES.code,
  created: CARD_SAMPLES.text,
};

/** These states submit the form once it has mounted. */
const SUBMITS = new Set(["missing", "failed", "created"]);

/**
 * The Create page's deck picker and the real form. The draft lives in memory
 * (see `sandboxDraft`), and submitting never creates a card: "Save failed"
 * rejects, the others resolve.
 */
export function CreateSpecimen({ state }: FrameSpecimenProps) {
  useState(() => {
    sandboxDraft();
    setSampleDraft(DRAFTS[state] ?? null);
    return true;
  });
  const [decks] = useState(() => sampleDecks());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() =>
    state === "empty" ? [] : [decks[0].id, decks[2].id],
  );
  const form = useRef<HTMLDivElement>(null);
  const shown = decks.filter((deck) => deckMatchesSearch(deck, search));

  useEffect(() => {
    if (!SUBMITS.has(state)) return;
    const timer = window.setTimeout(() => {
      form.current
        ?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div className="min-h-svh bg-muted px-2 pt-20 pb-12 dark:bg-background md:px-0 md:pt-8">
      <div className="mx-auto h-full w-full pb-40 md:px-24 xl:w-1/2 xl:px-0">
        <SearchBar
          search={search}
          setSearch={setSearch}
          placeholder="Filter decks..."
        />
        <div className="mb-2 flex h-48 gap-4 overflow-x-scroll rounded-xl bg-background p-4">
          {shown.map((deck) => {
            const isSelected = selected.includes(deck.id);
            return (
              <DeckSelectionCard
                key={deck.id}
                title={deck.name}
                backgroundType={isSelected ? "cool-mint" : "plain"}
                selected={isSelected}
                onSelect={() =>
                  setSelected((ids) =>
                    isSelected
                      ? ids.filter((id) => id !== deck.id)
                      : [...ids, deck.id],
                  )
                }
              />
            );
          })}
          {shown.length === 0 && (
            <div className="flex h-full w-full items-center justify-center">
              <p className="text-muted-foreground">No decks found</p>
            </div>
          )}
        </div>
        <div ref={form}>
          <CreateUpdateFlashcardForm
            numDecks={selected.length}
            onSubmit={async () => {
              await new Promise((resolve) => window.setTimeout(resolve, 400));
              if (state === "failed") throw new Error("Sample save failure");
            }}
          />
        </div>
      </div>
    </div>
  );
}
