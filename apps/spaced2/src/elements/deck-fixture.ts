import type { DeckCardProps } from "@/components/deck/deck-card";

const DAY = 24 * 60 * 60 * 1000;

/** Sample decks for deck cards and the deck picker. */
export function sampleDecks(now = Date.now()): DeckCardProps[] {
  return [
    {
      id: "sample-biology",
      name: "Biology",
      description: "Cells, genetics and the human body",
      lastModified: new Date(now - 2 * DAY),
      cardCount: 128,
    },
    {
      id: "sample-japanese",
      name: "Japanese N4",
      description: "Kanji, vocabulary and grammar points",
      lastModified: new Date(now - 6 * DAY),
      cardCount: 412,
    },
    {
      id: "sample-algorithms",
      name: "Algorithms",
      description: "Sorting, graphs and dynamic programming",
      lastModified: new Date(now - 15 * DAY),
      cardCount: 57,
    },
    {
      id: "sample-capitals",
      name: "World capitals",
      description: "",
      lastModified: new Date(now - 40 * DAY),
      cardCount: 195,
    },
  ];
}

/** The longest name a deck form accepts (30 characters) and a long note. */
export function sampleLongDecks(now = Date.now()): DeckCardProps[] {
  return [
    {
      id: "sample-long",
      name: "Organic chemistry reactions II",
      description:
        "Nucleophilic substitution, elimination, addition to carbonyls, aromatic substitution and the named reactions from the second-year course",
      lastModified: new Date(now - DAY),
      cardCount: 1284,
    },
    {
      id: "sample-short",
      name: "Go",
      description: "Joseki",
      lastModified: new Date(now - 300 * DAY),
      cardCount: 0,
    },
  ];
}
