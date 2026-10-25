import type { SimBook } from "./simulation";

/** Public-domain books, for a browser with too few of its own. */
export const SAMPLE_BOOKS: (SimBook & { tone: string })[] = [
  ["emma", "Emma", "Jane Austen", "oklch(0.78 0.06 20)"],
  ["persuasion", "Persuasion", "Jane Austen", "oklch(0.74 0.05 230)"],
  ["middlemarch", "Middlemarch", "George Eliot", "oklch(0.7 0.06 140)"],
  ["moby-dick", "Moby-Dick", "Herman Melville", "oklch(0.62 0.06 250)"],
  ["jane-eyre", "Jane Eyre", "Charlotte Brontë", "oklch(0.66 0.07 30)"],
  [
    "great-expectations",
    "Great Expectations",
    "Charles Dickens",
    "oklch(0.8 0.05 80)",
  ],
  ["little-women", "Little Women", "Louisa May Alcott", "oklch(0.8 0.05 350)"],
  ["dracula", "Dracula", "Bram Stoker", "oklch(0.5 0.08 20)"],
  ["frankenstein", "Frankenstein", "Mary Shelley", "oklch(0.64 0.05 170)"],
  ["the-odyssey", "The Odyssey", "Homer", "oklch(0.76 0.07 60)"],
  ["walden", "Walden", "Henry David Thoreau", "oklch(0.72 0.06 120)"],
  [
    "north-and-south",
    "North and South",
    "Elizabeth Gaskell",
    "oklch(0.68 0.04 280)",
  ],
].map(([id, title, author, tone], index) => ({
  id: id!,
  title: title!,
  author: author!,
  tone: tone!,
  size: 900_000 + ((index * 1_337_101) % 3_900_000),
}));
