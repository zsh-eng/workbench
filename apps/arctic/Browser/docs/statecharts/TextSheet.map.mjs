// Chart labels for TextSheet, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes. The network's steps are not the app's.
export const readerActions = [
  "OpenArticle",
  "Back",
  "TapTextAndTheme",
  "CloseSheet",
  "GoOffline",
  "GoOnline",
];

function where(v) {
  if (v.screen === "library") return "Library";
  if (!v.sheetAsked) return "Reading";
  if (v.sheetCode === "loaded") return "Text and theme open";
  if (v.sheetCode === "failed") return "Text and theme tapped, nothing opens";
  return "Text and theme loading";
}

// The label for one model state.
export function state(v) {
  const notes = [];
  if (!v.sheetAsked && v.sheetCode === "failed")
    notes.push("the sheet's code failed");
  if (v.net === "offline") notes.push("offline");
  return notes.length ? `${where(v)} (${notes.join(", ")})` : where(v);
}

// The group of one model state, for the chart's colours.
export function group(v) {
  return v.screen === "library" ? "Library" : "Reading";
}

const STEPS = {
  OpenArticle: "Open an article",
  Back: "Back",
  TapTextAndTheme: "Tap Text and theme",
  CloseSheet: "Close the sheet",
  GoOffline: "The connection drops",
  GoOnline: "The connection returns",
  PreloadSheet: "Arctic loads the sheet's code",
  SheetLoads: "The sheet's code arrives",
  SheetFails: "The sheet's code fails to load",
  ShellInstalls: "The service worker keeps the sheet's code",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
