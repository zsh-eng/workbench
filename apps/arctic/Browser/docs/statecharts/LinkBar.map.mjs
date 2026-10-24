// Chart labels for LinkBar, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes.
export const readerActions = [
  "OpenBar",
  "Type",
  "PressSave",
  "PressPaste",
  "Cancel",
  "Filter",
];

const waits = (label, v) =>
  v.clipboard === "reading" ? `${label} (an earlier Paste waits)` : label;

// The label for one model state.
export function state(v) {
  if (v.savedAfterCancel) return "A link saved after Cancel";
  if (v.justSaved)
    return waits(
      v.filtered && !v.newMatches
        ? "Saved, but the filter hides the new link"
        : "Saved, the new link at the top",
      v,
    );
  if (v.bar === "open") {
    if (v.clipboard === "reading" && !v.pasteCancelled)
      return "Link bar, waiting for the clipboard";
    const field =
      v.field === "empty"
        ? "Link bar, empty"
        : v.field === "prose"
          ? "Link bar, not a link"
          : "Link bar, a link typed";
    return waits(field, v);
  }
  const library = v.filtered ? "Library, filtered" : "Library";
  return waits(library, v);
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (v.justSaved) return "Saved";
  if (v.bar === "open") return "Link bar";
  return "Library";
}

const STEPS = {
  OpenBar: "Tap +",
  Type: "Type in the field",
  PressSave: "Tap Save",
  PressPaste: "Tap Paste",
  Cancel: "Tap × or the list",
  Filter: "Search, or pick a topic",
  ClipboardGivesLink: "The clipboard gives a link",
  ClipboardDropped: "The clipboard's link is dropped",
  ClipboardRefused: "The browser refuses the clipboard",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
