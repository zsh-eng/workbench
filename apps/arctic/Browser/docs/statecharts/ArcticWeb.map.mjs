// Chart labels for ArcticWeb, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes. The network's steps are not the app's.
export const readerActions = [
  "OpenBar",
  "Type",
  "PressSave",
  "PressPaste",
  "Cancel",
  "Filter",
  "OpenArticle",
  "Back",
  "TapTextAndTheme",
  "CloseSheet",
  "GoOffline",
  "GoOnline",
];

function where(v) {
  if (v.screen === "reader") {
    if (!v.sheetAsked) return "Reading";
    if (v.sheetCode === "loaded") return "Text and theme open";
    if (v.sheetCode === "failed") return "Text and theme tapped, nothing opens";
    return "Text and theme loading";
  }
  if (v.bar === "open") {
    if (v.clipboard === "reading") return "Link bar, waiting for the clipboard";
    if (v.field === "empty") return "Link bar, empty";
    if (v.field === "prose") return "Link bar, not a link";
    return "Link bar, a link typed";
  }
  return v.filtered ? "Library, filtered" : "Library";
}

// The label for one model state.
export function state(v) {
  const notes = [];
  if (v.saving) notes.push("saving");
  if (v.bar !== "open" && v.clipboard === "reading")
    notes.push("the clipboard read goes on");
  if (v.justSaved)
    notes.push(
      v.filtered && !v.newMatches ? "the saved link is hidden" : "the saved link is at the top",
    );
  if (v.savedBy === "cancel") notes.push("a link was saved after Cancel");
  if (v.net === "offline") notes.push("offline");
  return notes.length ? `${where(v)} (${notes.join(", ")})` : where(v);
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (v.screen === "reader") return "Reading";
  if (v.bar === "open") return "Saving a link";
  return "Library";
}

const STEPS = {
  OpenBar: "Tap +",
  Type: "Type in the field",
  PressSave: "Tap Save",
  PressPaste: "Tap Paste",
  Cancel: "Tap × or the list",
  Filter: "Search, or pick a topic",
  OpenArticle: "Open an article",
  Back: "Back",
  TapTextAndTheme: "Tap Text and theme",
  CloseSheet: "Close the sheet",
  GoOffline: "The connection drops",
  GoOnline: "The connection returns",
  ClipboardGivesLink: "The clipboard gives a link",
  ClipboardRefused: "The browser refuses the clipboard",
  FinishSave: "The save finishes",
  PreloadSheet: "Arctic loads the sheet's code",
  SheetLoads: "The sheet's code arrives",
  SheetFails: "The sheet's code fails to load",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
