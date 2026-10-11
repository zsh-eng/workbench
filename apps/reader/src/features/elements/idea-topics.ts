/** The parts of the app with ideas to compare, each on its own page. */
export const IDEA_TOPICS = [
  { id: "library", label: "Library" },
  { id: "highlights", label: "Highlights" },
  { id: "reader", label: "Reader" },
] as const;

export type IdeaTopic = (typeof IDEA_TOPICS)[number]["id"];

export function isIdeaTopic(value: string | undefined): value is IdeaTopic {
  return IDEA_TOPICS.some((topic) => topic.id === value);
}
