import type { ComponentType } from "react";
import { CHROME_STATES, ChromeSpecimen } from "./specimens/ChromeSpecimen";
import { TOAST_STATES, ToastSpecimen } from "./specimens/ToastSpecimen";

export interface Specimen {
  id: string;
  /** Short name for the section navigation. */
  label: string;
  title: string;
  description: string;
  states: readonly { id: string; label: string }[];
  Component: ComponentType<{ state: string; nonce: number }>;
}

/** Specimens render real components on sample data inside a device frame. */
export const SPECIMENS: Specimen[] = [
  {
    id: "chrome",
    label: "Chrome",
    title: "Reader chrome and prompts",
    description:
      "The header, footer, Notes capsule and reading prompts on a still page. Tap the page to show or hide the chrome; the prompt keeps its place.",
    states: CHROME_STATES,
    Component: ChromeSpecimen,
  },
  {
    id: "feedback",
    label: "Feedback",
    title: "Toasts and notices",
    description:
      "Feedback after an action. Undo counts down and holds while you point at it or focus it.",
    states: TOAST_STATES,
    Component: ToastSpecimen,
  },
];

export function specimenSrc(id: string, state: string) {
  return `/debug/elements/frame/${id}?state=${encodeURIComponent(state)}`;
}
