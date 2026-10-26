/** The parts of the app with ideas to compare, each on its own page. */
const TOPICS = [
  // Add a new topic at the end, with `added` set to the day it first appears.
  { id: "library", label: "Library", added: "2026-10-10" },
  { id: "reader", label: "Reader", added: "2026-10-11" },
  { id: "dark", label: "Dark mode", added: "2026-10-18" },
  { id: "search", label: "Reader search", added: "2026-10-18" },
  { id: "fonts", label: "Reading fonts", added: "2026-10-24" },
  { id: "covers", label: "Living covers", added: "2026-10-25" },
  { id: "paper", label: "Paper", added: "2026-10-25" },
  { id: "sheets", label: "Sheet motion", added: "2026-10-25" },
  { id: "feedback", label: "Feedback", added: "2026-10-25" },
  { id: "background", label: "Background activity", added: "2026-10-26" },
  { id: "arriving", label: "Arriving books", added: "2026-10-26" },
  { id: "installing", label: "Installing", added: "2026-10-26" },
] as const;

/**
 * Newest first, for the tabs; Design ideas opens on the first. Topics added
 * on the same day keep the later one first.
 */
export const IDEA_TOPICS = [...TOPICS]
  .reverse()
  .sort((a, b) => b.added.localeCompare(a.added));

export type IdeaTopic = (typeof TOPICS)[number]["id"];

export function isIdeaTopic(value: string | undefined): value is IdeaTopic {
  return IDEA_TOPICS.some((topic) => topic.id === value);
}
