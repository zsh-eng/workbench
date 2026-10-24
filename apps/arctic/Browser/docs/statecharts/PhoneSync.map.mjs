// Chart labels for PhoneSync, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes; the clock and the network are not the app's.
export const readerActions = [
  "WebEdit",
  "PhoneEdit",
  "WebKeepsCopy",
  "Tick",
  "WebNetwork",
  "PhoneNetwork",
];

const who = (note) =>
  note.text === "none" ? "no note" : `the ${note.text}'s note from minute ${note.at}`;

// The label for one model state.
export function state(v) {
  const note =
    v.webNote.text === v.phoneNote.text && v.webNote.at === v.phoneNote.at
      ? `Both show ${who(v.webNote)}`
      : `Web shows ${who(v.webNote)}, phone shows ${who(v.phoneNote)}`;
  const notes = [];
  if (v.webPending) notes.push("web has not sent its edit");
  if (v.outbox.by !== "none") notes.push("phone is sending");
  if (v.phase !== "idle") notes.push(`phone sync ${v.phase}`);
  if (!v.webOnline) notes.push("web offline");
  if (!v.phoneOnline) notes.push("phone offline");
  if (v.phoneText && !v.accountText) notes.push("text only on the phone");
  return notes.length ? `${note} (${notes.join(", ")})` : note;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (v.webNote.text !== v.phoneNote.text || v.webNote.at !== v.phoneNote.at)
    return "Devices differ";
  return v.webNote.at === v.newest.at ? "Newest edit" : "An older edit";
}

const STEPS = {
  WebEdit: "Edit the note on the web",
  PhoneEdit: "Edit the note on the phone",
  WebKeepsCopy: "Keep a copy on the web",
  Tick: "A minute passes",
  WebNetwork: "The web's connection changes",
  PhoneNetwork: "The phone's connection changes",
  WebPull: "The web takes the account's note",
  WebPush: "The web sends its edit",
  PhonePull: "The phone pulls",
  PhoneReconcile: "The phone compares updatedAt",
  PhonePush: "The phone sends",
  PhoneStops: "The phone's sync stops offline",
  PhoneGetsLink: "The phone gets the link",
  PhoneKeepsText: "The phone keeps the text",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
