// Chart labels for SentComments, for statechart.mjs. The labels say what
// the reader sees: the comment, the drafts in the message box, and the
// message in the thread.

// The steps that the reader takes. The clock is not the app's.
export const readerActions = ["PressSend", "Edit", "Tick"];

const version = (n) => (n === 2 ? "the edited comment" : "the first comment");

// Draft or sent, as the host's inbox says (host/server.ts:1497-1506).
function draft(v) {
  if (!v.message.sent) return true;
  if ("version" in v.message) return v.message.version !== v.text;
  return v.message.at < v.updatedAt;
}

// The label for one model state.
export function state(v) {
  const comment = v.text === 2 ? "Comment edited" : "Comment written";
  let where;
  if (!v.message.sent) where = v.send.at === "none" ? "in your drafts" : "sending";
  else where = draft(v) ? "back in your drafts" : "sent";
  const notes = [];
  if (v.message.sent) {
    notes.push(`the agent's message has ${version(v.message.body)}`);
    if (v.message.shown !== v.message.body)
      notes.push(`the thread shows ${version(v.message.shown)}`);
  }
  if (v.agentGot) notes.push("delivered");
  return notes.length ? `${comment}, ${where} (${notes.join(", ")})` : `${comment}, ${where}`;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (!v.message.sent) return "Not sent";
  return draft(v) ? "Waits to be sent again" : "Sent";
}
export const groupColors = { "Not sent": "#e8eef7", Sent: "#dff3e4" };

const STEPS = {
  PressSend: "You press Send",
  Edit: "You edit the comment",
  Tick: "A millisecond passes",
  ReadDrafts: "The host reads the drafts for the thread",
  ReadBody: "The host reads the comments for the agent",
  Read: "The host reads the comments",
  Stamp: "The host stores the message with the time",
  Deliver: "The agent gets the message",
};
export function step(action) {
  return STEPS[action] ?? action;
}

// Why a bad state is bad.
export function cause(v, facts, invariant) {
  if (invariant === "SentIsNewest")
    return "the edit landed after the host read the comment and before it stamped the message";
  if (invariant === "ThreadShowsSent")
    return "the edit landed between the host's two reads of the comment";
  return null;
}
