// Chart labels for ArticleText, for statechart.mjs. Labels use the reader's
// words. v, before and after map each variable to its value.

// The steps that the reader takes.
export const readerActions = ["WebKeepsCopy"];

const PHONE = {
  none: "the phone has no text",
  teaser: "the phone keeps a teaser",
  article: "the phone keeps the article",
};
const WEB = {
  none: "The web has no text",
  web: "The web shows its own copy",
  phone: "The web shows the phone's copy",
};

// The label for one model state.
export function state(v) {
  if (!v.phoneHasLink) return `${WEB[v.accountText]}, the link is not on the phone yet`;
  return `${WEB[v.accountText]}, ${PHONE[v.phoneText]}`;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  return v.accountText === "none" ? "No text on the web" : "Text on the web";
}

const STEPS = {
  WebKeepsCopy: "Keep a copy on the web",
  PhoneGetsLink: "The phone gets the link",
  PhoneKeepsText: "The phone keeps a Reader copy",
  PhoneSendsText: "The phone sends the text",
};

// The label for one step.
export function step(action) {
  return STEPS[action] ?? action;
}
