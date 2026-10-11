import type { ComponentType } from "react";
import type { DeviceId } from "./DeviceFrame";
import { CHROME_STATES, ChromeSpecimen } from "./specimens/ChromeSpecimen";
import { SHEET_STATES, SheetsSpecimen } from "./specimens/SheetsSpecimen";
import { TOAST_STATES, ToastSpecimen } from "./specimens/ToastSpecimen";

export interface Specimen {
  id: string;
  /** Short name for the section navigation. */
  label: string;
  title: string;
  description: string;
  states: readonly { id: string; label: string }[];
  /**
   * Shows these variants side by side on one device instead of a desktop
   * and a phone. The frame reads `?variant=`.
   */
  variants?: {
    device: DeviceId;
    options: readonly { id: string; label: string }[];
  };
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
    id: "sheets",
    label: "Sheets",
    title: "Reader sheets",
    description:
      "The phone Reader's sheets with the real panels on a sample book. Left: the sheet that ships, one fixed height. Right: React Aria's Sheet. It moves on native scrolling, rests on detents, and stacks pages over Reader tools. Drag a handle, flick, or tap the page behind. Appearance opens low, so the page stays in view while you change it.",
    states: SHEET_STATES,
    variants: {
      device: "phone",
      options: [
        { id: "now", label: "Now: fixed height" },
        { id: "detents", label: "Proposal: detents" },
      ],
    },
    Component: SheetsSpecimen,
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
