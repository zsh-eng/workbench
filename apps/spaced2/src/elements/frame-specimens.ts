import type { ComponentType } from "react";
import { CreateSpecimen } from "./CreateSpecimen";
import { SessionSpecimen, ToastSpecimen } from "./FeedbackSpecimens";
import { ReviewScreen } from "./ReviewSpecimen";
import type { FrameSpecimenProps, SpecimenState } from "./selection";
import { StatsSpecimen } from "./StatsSpecimen";

export interface FrameState extends SpecimenState {
  /** Replay for a state that plays by itself; Reset for one that waits. */
  demo: "Replay" | "Reset";
}

export interface FrameSpecimen {
  id: string;
  title: string;
  note: string;
  states: readonly FrameState[];
  Component: ComponentType<FrameSpecimenProps>;
}

/**
 * Specimens that render alone in desktop and phone frames, because they
 * depend on the viewport, cover the screen, or listen for keys on the window.
 */
export const FRAME_SPECIMENS = [
  {
    id: "review",
    title: "Review screen",
    note: "The card, its state badge, the actions menu and the grade buttons on a sample queue of five cards. Grade with the buttons or the keys 1 to 4; a grade only moves to the next sample card. Undo and the queue counts read the live queue, so they are not shown.",
    states: [
      { id: "question", label: "Question", demo: "Reset" },
      { id: "answer", label: "Answer", demo: "Replay" },
      { id: "grade", label: "Grade press", demo: "Replay" },
      { id: "done", label: "Done for now", demo: "Reset" },
      { id: "empty", label: "No cards yet", demo: "Reset" },
    ],
    Component: ReviewScreen,
  },
  {
    id: "create",
    title: "Create flashcard",
    note: "The deck picker and the real form. Its draft stays in the frame's memory, never in your saved draft, and submitting never creates a card. Missing answer, Save failed and Created submit by themselves.",
    states: [
      { id: "empty", label: "Empty", demo: "Reset" },
      { id: "draft", label: "Restored draft", demo: "Reset" },
      { id: "missing", label: "Missing answer", demo: "Replay" },
      { id: "failed", label: "Save failed", demo: "Replay" },
      { id: "created", label: "Created", demo: "Replay" },
    ],
    Component: CreateSpecimen,
  },
  {
    id: "stats",
    title: "Stats",
    note: "Every chart on the Stats page with sample reviews: three months, a first week, and none. Change the duration range, or tap a heatmap day.",
    states: [
      { id: "quarter", label: "Three months", demo: "Reset" },
      { id: "week", label: "First week", demo: "Reset" },
      { id: "none", label: "No reviews", demo: "Reset" },
    ],
    Component: StatsSpecimen,
  },
  {
    id: "toasts",
    title: "Toasts",
    note: "The app's Toaster with the messages that actions show. Each toast stays for two seconds; Replay shows it again.",
    states: [
      { id: "created", label: "Created", demo: "Replay" },
      { id: "saved", label: "Saved", demo: "Replay" },
      { id: "skipped", label: "Skipped", demo: "Replay" },
      { id: "deleted", label: "Deleted, with Undo", demo: "Replay" },
      { id: "undo", label: "Undo", demo: "Replay" },
      { id: "error", label: "Error", demo: "Replay" },
      { id: "sync", label: "Syncing", demo: "Replay" },
    ],
    Component: ToastSpecimen,
  },
  {
    id: "session",
    title: "Session expired",
    note: "The banner that asks the user to sign in again over the current screen. Sign in and close dismiss it here; the real Sign in opens the login dialog.",
    states: [{ id: "expired", label: "Expired", demo: "Reset" }],
    Component: SessionSpecimen,
  },
] as const satisfies readonly FrameSpecimen[];

export type FrameSpecimenId = (typeof FRAME_SPECIMENS)[number]["id"];

export function frameSpecimen(id: string): FrameSpecimen | undefined {
  return FRAME_SPECIMENS.find((specimen) => specimen.id === id);
}

export function specimenSrc(id: string, state: string) {
  return `/debug/elements/frame/${id}?state=${encodeURIComponent(state)}`;
}
