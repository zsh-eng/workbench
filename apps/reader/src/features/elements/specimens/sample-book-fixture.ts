import type { TOCItem } from "@/lib/db";
import type { ChapterEntry } from "@/features/reader/types";
import { SAMPLE_PARAGRAPHS } from "./SamplePage";

/** Public-domain chapters: Lewis Carroll, "Alice's Adventures in Wonderland". */
const CHAPTERS = [
  "Down the Rabbit-Hole",
  "The Pool of Tears",
  "A Caucus-Race and a Long Tale",
  "The Rabbit Sends in a Little Bill",
  "Advice from a Caterpillar",
  "Pig and Pepper",
  "A Mad Tea-Party",
  "The Queen’s Croquet-Ground",
  "The Mock Turtle’s Story",
  "The Lobster Quadrille",
  "Who Stole the Tarts?",
  "Alice’s Evidence",
];

export const SAMPLE_CHAPTER_ENTRIES: ChapterEntry[] = CHAPTERS.map(
  (title, index) => ({
    index,
    spineItemId: `chapter-${index + 1}`,
    href: `chapter-${index + 1}.xhtml`,
    title: `Chapter ${index + 1}. ${title}`,
  }),
);

export const SAMPLE_TOC: TOCItem[] = SAMPLE_CHAPTER_ENTRIES.map((entry) => ({
  label: entry.title,
  href: entry.href,
}));

export const SAMPLE_CHAPTER_START_PAGES = [
  1, 14, 27, 38, 52, 66, 80, 94, 108, 119, 128, 139,
];
export const SAMPLE_TOTAL_PAGES = 150;

/** Highlights for the Notebook: the first sentence of each paragraph. */
export const SAMPLE_HIGHLIGHTS = SAMPLE_PARAGRAPHS.map((paragraph, index) => ({
  id: `highlight-${index}`,
  chapter: SAMPLE_CHAPTER_ENTRIES[index].title,
  text: paragraph.split(/(?<=[.!?”])\s/)[0] ?? paragraph,
}));
