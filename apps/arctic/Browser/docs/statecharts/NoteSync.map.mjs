// Chart labels for NoteSync, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes; the clock is not the app's.
export const readerActions = ["WebEdit", "PhoneEdit", "Tick"];

const who = (note) => (note.text === "none" ? "no note" : `the ${note.text}'s note`);
const same = (v) => v.webNote.text === v.phoneNote.text && v.webNote.at === v.phoneNote.at;

// The label for one model state.
export function state(v) {
  let label;
  if (same(v) && v.webNote.text === "none") label = "No note yet";
  else if (same(v))
    label = `Both show ${who(v.webNote)}${v.webNote.at === v.newest.at ? "" : ", an older edit"}`;
  else label = `The web shows ${who(v.webNote)}, the phone ${who(v.phoneNote)}`;
  const notes = [];
  if (v.webPending) notes.push("the web has not sent its edit");
  const phoneUnsent =
    v.outbox.by !== "none" ||
    (v.phoneNote.text === "phone" && v.phoneNote.at !== v.phoneRow.note.at);
  if (phoneUnsent) notes.push("the phone has not sent its edit");
  if (v.phase !== "idle") notes.push("the phone is syncing");
  return notes.length ? `${label} (${notes.join(", ")})` : label;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (!same(v)) return "The devices differ";
  return v.webNote.at === v.newest.at ? "The newest edit" : "An older edit";
}

const STEPS = {
  WebEdit: "Edit the note on the web",
  PhoneEdit: "Edit the note on the phone",
  Tick: "Time passes",
  WebPull: "The web takes the account's note",
  WebPush: "The web sends its edit",
  PhonePull: "The phone pulls",
  PhoneReconcile: "The phone compares updatedAt",
  PhonePush: "The phone sends",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
