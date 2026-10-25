/** The parts of the app with ideas to compare, each on its own page. */
export const IDEA_TOPICS = [
  { id: "library", label: "Library" },
  { id: "reader", label: "Reader" },
  { id: "search", label: "Reader search" },
  { id: "fonts", label: "Reading fonts" },
  { id: "paper", label: "Paper" },
  { id: "dark", label: "Dark mode" },
  { id: "covers", label: "Living covers" },
  { id: "sheets", label: "Sheet motion" },
  { id: "feedback", label: "Feedback" },
  { id: "background", label: "Background activity" },
] as const;

export type IdeaTopic = (typeof IDEA_TOPICS)[number]["id"];

export function isIdeaTopic(value: string | undefined): value is IdeaTopic {
  return IDEA_TOPICS.some((topic) => topic.id === value);
}
