import type { LabColor, LabNote } from "./lab-model";

/** Public-domain text from the bundled sample EPUB (Chapter II). */
export const BOOK = {
  title: "Alice’s Adventures in Wonderland",
  author: "Lewis Carroll",
  pages: 99,
};

export const CHAPTERS = [
  { id: "i", numeral: "I", title: "Down the Rabbit-Hole", start: 6 },
  { id: "ii", numeral: "II", title: "The Pool of Tears", start: 12 },
  {
    id: "iii",
    numeral: "III",
    title: "A Caucus-Race and a Long Tale",
    start: 18,
  },
  {
    id: "iv",
    numeral: "IV",
    title: "The Rabbit Sends in a Little Bill",
    start: 25,
  },
  { id: "v", numeral: "V", title: "Advice from a Caterpillar", start: 32 },
  { id: "vi", numeral: "VI", title: "Pig and Pepper", start: 40 },
  { id: "vii", numeral: "VII", title: "A Mad Tea-Party", start: 49 },
  {
    id: "viii",
    numeral: "VIII",
    title: "The Queen’s Croquet-Ground",
    start: 59,
  },
  { id: "ix", numeral: "IX", title: "The Mock Turtle’s Story", start: 68 },
  { id: "x", numeral: "X", title: "The Lobster Quadrille", start: 77 },
  { id: "xi", numeral: "XI", title: "Who Stole the Tarts?", start: 85 },
  { id: "xii", numeral: "XII", title: "Alice’s Evidence", start: 92 },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]["id"];

export function chapterOf(id: string) {
  return CHAPTERS.find((chapter) => chapter.id === id) ?? CHAPTERS[1];
}

export const CURRENT_PAGE = 16;
export const CURRENT_CHAPTER: ChapterId = "ii";

export const PARAGRAPHS = [
  "Just then her head struck against the roof of the hall: in fact she was now more than nine feet high, and she at once took up the little golden key and hurried off to the garden door.",
  "Poor Alice! It was as much as she could do, lying down on one side, to look through into the garden with one eye; but to get through was more hopeless than ever: she sat down and began to cry again.",
  "“You ought to be ashamed of yourself,” said Alice, “a great girl like you,” (she might well say this), “to go on crying in this way! Stop this moment, I tell you!” But she went on all the same, shedding gallons of tears, until there was a large pool all round her, about four inches deep and reaching half down the hall.",
  "After a time she heard a little pattering of feet in the distance, and she hastily dried her eyes to see what was coming. It was the White Rabbit returning, splendidly dressed, with a pair of white kid gloves in one hand and a large fan in the other: he came trotting along in a great hurry, muttering to himself as he came, “Oh! the Duchess, the Duchess! Oh! won’t she be savage if I’ve kept her waiting!” Alice felt so desperate that she was ready to ask help of any one; so, when the Rabbit came near her, she began, in a low, timid voice, “If you please, sir—” The Rabbit started violently, dropped the white kid gloves and the fan, and skurried away into the darkness as hard as he could go.",
  "Alice took up the fan and gloves, and, as the hall was very hot, she kept fanning herself all the time she went on talking: “Dear, dear! How queer everything is to-day! And yesterday things went on just as usual. I wonder if I’ve been changed in the night? Let me think: was I the same when I got up this morning? I almost think I can remember feeling a little different. But if I’m not the same, the next question is, Who in the world am I? Ah, that’s the great puzzle!”",
];

/** The passage used by each concept's "Select a passage" shortcut. */
const SAMPLE_QUOTE = "she was now more than nine feet high";

function range(paragraph: number, quote: string) {
  const start = PARAGRAPHS[paragraph].indexOf(quote);
  if (start < 0) throw new Error(`Missing lab quote: ${quote}`);
  return { paragraph, start, end: start + quote.length };
}

export const SAMPLE_SELECTION = {
  range: range(0, SAMPLE_QUOTE),
  text: SAMPLE_QUOTE,
};

const LATE_QUOTE = "I wonder if I’ve been changed in the night?";

/** Sample for layouts whose page starts later in the chapter. */
export const LATE_SAMPLE_SELECTION = {
  range: range(4, LATE_QUOTE),
  text: LATE_QUOTE,
};

const DAY = 24 * 60 * 60 * 1000;

function note(
  id: string,
  chapter: ChapterId,
  page: number,
  color: LabColor,
  quote: string | null,
  text: string,
  ageDays: number,
  paragraph?: number,
): LabNote {
  return {
    id,
    chapter,
    page,
    color,
    quote,
    text,
    createdAt: Date.now() - ageDays * DAY,
    range: paragraph === undefined || !quote ? null : range(paragraph, quote),
  };
}

/** Notes on the visible page carry a text range; other entries are notebook-only. */
export function seedNotes(): LabNote[] {
  return [
    note(
      "seed-book",
      "i",
      6,
      "yellow",
      "“and what is the use of a book,” thought Alice “without pictures or conversations?”",
      "Funny to read this inside an e-reader.",
      19,
    ),
    note(
      "seed-cry",
      "ii",
      16,
      "green",
      "she sat down and began to cry again.",
      "",
      2.1,
      1,
    ),
    note(
      "seed-pool",
      "ii",
      16,
      "blue",
      "shedding gallons of tears, until there was a large pool all round her",
      "Carroll plants the pool a page before Alice falls into it.",
      2,
      2,
    ),
    note(
      "seed-sir",
      "ii",
      16,
      "invisible",
      "“If you please, sir—”",
      "Desperate, and still polite. Manners as a survival tool.",
      1.9,
      3,
    ),
    note(
      "seed-puzzle",
      "ii",
      16,
      "yellow",
      "Who in the world am I? Ah, that’s the great puzzle!",
      "The whole book in one line. Every change of size asks the question again.",
      0.02,
      4,
    ),
    note(
      "seed-caterpillar",
      "v",
      33,
      "magenta",
      "“Who are you?” said the Caterpillar.",
      "The Chapter II puzzle, now asked by someone else.",
      12,
    ),
    note(
      "seed-mad",
      "vi",
      45,
      "green",
      "“we’re all mad here. I’m mad. You’re mad.”",
      "",
      11,
    ),
    note(
      "seed-raven",
      "vii",
      51,
      "blue",
      "“Why is a raven like a writing-desk?”",
      "A riddle without an answer, until Carroll supplied one in a later preface.",
      10,
    ),
    note(
      "seed-sense",
      "ix",
      70,
      "yellow",
      "“Take care of the sense, and the sounds will take care of themselves.”",
      "Good advice for writing notes, too.",
      6,
    ),
    note(
      "seed-end",
      "xii",
      96,
      "invisible",
      "“Begin at the beginning,” the King said gravely, “and go on till you come to the end: then stop.”",
      "Reread from here next time.",
      4,
    ),
  ];
}
