import { LOCALSTORAGE_KEY as DRAFT_KEY } from "@/components/create-flashcard";
import type { CardContentFormValues } from "@/lib/form-schema";

let sample: string | null = null;
let draftInstalled = false;

/**
 * The Create form reads and saves its draft in localStorage. In a specimen
 * frame, that one key lives in memory instead, so a specimen never shows or
 * replaces the user's unsaved card. Each frame is its own window, so this
 * changes only the frame's Storage.
 */
export function sandboxDraft() {
  if (draftInstalled) return;
  draftInstalled = true;
  const storage = Storage.prototype;
  const { getItem, setItem, removeItem } = storage;
  storage.getItem = function (key) {
    if (this === localStorage && key === DRAFT_KEY) return sample;
    return getItem.call(this, key);
  };
  storage.setItem = function (key, value) {
    if (this === localStorage && key === DRAFT_KEY) sample = String(value);
    else setItem.call(this, key, value);
  };
  storage.removeItem = function (key) {
    if (this === localStorage && key === DRAFT_KEY) sample = null;
    else removeItem.call(this, key);
  };
}

/** Sets the draft that the form finds when it mounts. */
export function setSampleDraft(values: CardContentFormValues | null) {
  sample = values ? JSON.stringify(values) : null;
}

/**
 * Specimens press buttons for the viewer, and the app vibrates on some
 * presses. A browser blocks vibration before the frame is tapped and logs an
 * error each time, so specimen frames do not vibrate.
 */
export function silenceVibration() {
  if (typeof navigator.vibrate !== "function") return;
  Object.defineProperty(navigator, "vibrate", {
    configurable: true,
    value: () => false,
  });
}
