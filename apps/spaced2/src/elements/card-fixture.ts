import type { CardWithMetadata } from "@/lib/types";
import { createEmptyCard, State } from "ts-fsrs";

// Remote images load through the image cache in IndexedDB. A data URL shows
// directly, so the image card never reads or fills the user's cache.
const TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 150" width="240" height="150">
<rect width="240" height="150" rx="12" fill="#ecfeff"/>
<path d="M48 118 H196 L48 30 Z" fill="#a5f3fc" stroke="#0e7490" stroke-width="3" stroke-linejoin="round"/>
<path d="M48 104 H62 V118" fill="none" stroke="#0e7490" stroke-width="2"/>
<g font-family="system-ui, sans-serif" font-size="16" fill="#164e63" text-anchor="middle">
<text x="34" y="80">a</text><text x="122" y="138">b</text><text x="130" y="66">c</text>
</g></svg>`;
const TRIANGLE = `data:image/svg+xml;base64,${btoa(TRIANGLE_SVG)}`;

export interface CardSample {
  front: string;
  back: string;
}

/** Card text for each kind of content that the review screen renders. */
export const CARD_SAMPLES = {
  text: {
    front: "What does spaced repetition schedule?",
    back: "Each review just before you would forget, at intervals that grow after each success.",
  },
  markdown: {
    front: "What are the **two** main jobs of the *mitochondria*?",
    back: [
      "1. Make ATP by oxidative phosphorylation",
      "2. Start apoptosis when the cell is damaged",
      "",
      "> Most of the cell's ATP comes from here.",
    ].join("\n"),
  },
  maths: {
    front: "Solve $ax^2 + bx + c = 0$ for $x$.",
    back: [
      "$$",
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "$$",
      "",
      "The discriminant $b^2 - 4ac$ gives the number of real roots.",
    ].join("\n"),
  },
  code: {
    front: [
      "What does this print?",
      "",
      "```ts",
      "const scores = [10, 9, 100];",
      "scores.sort();",
      "console.log(scores);",
      "```",
    ].join("\n"),
    back: "`[10, 100, 9]`. Without a compare function, `sort()` compares the values as strings.",
  },
  image: {
    front: `Which side is the hypotenuse?\n\n![A right triangle with sides a, b and c](${TRIANGLE})`,
    back: "**c**, the side opposite the right angle: $c^2 = a^2 + b^2$.",
  },
  long: {
    front: "Name the twelve cranial nerves in order.",
    back: [
      "1. Olfactory",
      "2. Optic",
      "3. Oculomotor",
      "4. Trochlear",
      "5. Trigeminal",
      "6. Abducens",
      "7. Facial",
      "8. Vestibulocochlear",
      "9. Glossopharyngeal",
      "10. Vagus",
      "11. Accessory",
      "12. Hypoglossal",
    ].join("\n"),
  },
} satisfies Record<string, CardSample>;

export type CardSampleId = keyof typeof CARD_SAMPLES;

const DAY = 24 * 60 * 60 * 1000;

/** Scheduler fields for each FSRS state, relative to `now`. */
function schedule(state: State, now: number) {
  const card = createEmptyCard(new Date(now));
  switch (state) {
    case State.New:
      return card;
    case State.Learning:
      return {
        ...card,
        state,
        stability: 0.4,
        difficulty: 6.2,
        learning_steps: 1,
        reps: 1,
        last_review: new Date(now - 10 * 60 * 1000),
      };
    case State.Review:
      return {
        ...card,
        state,
        stability: 14.2,
        difficulty: 5.1,
        elapsed_days: 12,
        scheduled_days: 12,
        reps: 6,
        lapses: 1,
        last_review: new Date(now - 12 * DAY),
      };
    case State.Relearning:
      return {
        ...card,
        state,
        stability: 2.3,
        difficulty: 7.4,
        elapsed_days: 1,
        scheduled_days: 1,
        learning_steps: 0,
        reps: 9,
        lapses: 3,
        last_review: new Date(now - DAY),
      };
  }
}

export function sampleCard(
  id: string,
  sample: CardSample,
  state: State = State.New,
  now = Date.now(),
): CardWithMetadata {
  return {
    ...schedule(state, now),
    id,
    front: sample.front,
    back: sample.back,
    deleted: false,
    bookmarked: false,
    cardLastModified: now,
    cardContentLastModified: now,
    cardDeletedLastModified: now,
    cardBookmarkedLastModified: now,
    cardSuspendedLastModified: now,
    cardMetadataLastModified: now,
    createdAt: now - 30 * DAY,
  };
}

/** A short review queue with one card in each state and each kind of content. */
export function sampleReviewQueue(now = Date.now()) {
  return [
    sampleCard("sample-text", CARD_SAMPLES.text, State.New, now),
    sampleCard("sample-maths", CARD_SAMPLES.maths, State.Review, now),
    sampleCard("sample-code", CARD_SAMPLES.code, State.Learning, now),
    sampleCard("sample-image", CARD_SAMPLES.image, State.Relearning, now),
    sampleCard("sample-markdown", CARD_SAMPLES.markdown, State.Review, now),
  ];
}
