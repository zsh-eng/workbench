import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files/types";

interface SampleBook {
  book: Book;
  coverUrl: string;
  /** Share read, from 0 to 1. */
  progress: number;
}

/** A plain typeset cover, as an SVG data URL. */
function cover(lines: string[], author: string, paper: string, ink: string) {
  const title = lines
    .map(
      (line, index) =>
        `<text x="100" y="${118 + index * 30}" text-anchor="middle" font-family="Georgia, serif" font-size="25" fill="${ink}">${line}</text>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="${paper}"/><rect x="12" y="12" width="176" height="276" fill="none" stroke="${ink}" stroke-opacity="0.4"/>${title}<text x="100" y="252" text-anchor="middle" font-family="Georgia, serif" font-size="${author.length > 15 ? 9.5 : 12}" letter-spacing="1.5" fill="${ink}" fill-opacity="0.8">${author.toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function sample(
  id: string,
  title: string,
  author: string,
  lines: string[],
  paper: string,
  ink: string,
  progress: number,
): SampleBook {
  return {
    book: {
      id: `elements-${id}`,
      sourceFileId: `elements-${id}` as FileId,
      title,
      author,
      fileSize: 0,
      dateAdded: 0,
      metadata: {},
      manifest: [],
      spine: [],
      toc: [],
      cover: null,
    },
    coverUrl: cover(lines, author, paper, ink),
    progress,
  };
}

/** Public-domain books with typeset covers. The first five are being read. */
export const SAMPLE_LIBRARY: SampleBook[] = [
  sample(
    "middlemarch",
    "Middlemarch",
    "George Eliot",
    ["Middlemarch"],
    "#7a2e2a",
    "#f1e4cf",
    0.42,
  ),
  sample(
    "alice",
    "Alice's Adventures in Wonderland",
    "Lewis Carroll",
    ["Alice's", "Adventures in", "Wonderland"],
    "#c9b79c",
    "#3b2f2a",
    0.09,
  ),
  sample(
    "moby",
    "Moby-Dick; or, The Whale",
    "Herman Melville",
    ["Moby-Dick"],
    "#1f3550",
    "#e8eef2",
    0.71,
  ),
  sample(
    "pride",
    "Pride and Prejudice",
    "Jane Austen",
    ["Pride and", "Prejudice"],
    "#2f4a3a",
    "#efe6d2",
    0.25,
  ),
  sample(
    "walden",
    "Walden",
    "Henry David Thoreau",
    ["Walden"],
    "#5d6b3c",
    "#f0ead8",
    0.88,
  ),
  sample(
    "frankenstein",
    "Frankenstein",
    "Mary Shelley",
    ["Frankenstein"],
    "#2b2b2b",
    "#d9d2c3",
    0,
  ),
  sample(
    "innocence",
    "The Age of Innocence",
    "Edith Wharton",
    ["The Age of", "Innocence"],
    "#d8c3c0",
    "#4a2b33",
    0,
  ),
  sample(
    "expectations",
    "Great Expectations",
    "Charles Dickens",
    ["Great", "Expectations"],
    "#e9e1cf",
    "#2a2a2a",
    0,
  ),
];
