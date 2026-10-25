// Chart labels for Activity (packages/background-activity/docs/states), for
// pstack's statechart.mjs. A state reads "the network: what the app shows".

// What you do, the network around you, and time passing (the app's timers).
// The rest is the app on its own: browser events arriving and requests
// settling. With --cover, the overview keeps the shortest path to each
// state where the app waits for one of these.
export const readerActions = [
  "Start",
  "Cancel",
  "Retry",
  "Dismiss",
  "RetryTimerFires",
  "ForgetFires",
  "Reload",
  "DeviceGoesOffline",
  "DeviceGoesOnline",
];

const BOOKS = ["Emma", "Persuasion"];

const SHOWS = {
  queued: "next",
  waiting: "waits for a connection",
  running: "downloading",
  retrying: "will retry",
  failed: "couldn't download",
  done: "done",
  cancelled: "cancelled",
};

function books(v) {
  const parts = [];
  for (let j = 1; j <= BOOKS.length; j++) {
    const s = v.st[j];
    if (s === "none") continue;
    parts.push(`${BOOKS[j - 1]} ${SHOWS[s]}`);
  }
  return parts.length ? parts.join(", ") : "nothing to download";
}

export function state(v) {
  return `${v.net === "online" ? "Online" : "Offline"}: ${books(v)}`;
}

export const regionNames = ["The network", "The app shows"];

/** The book that a step acted on. */
function which(before, after, test) {
  for (let j = 1; j <= BOOKS.length; j++)
    if (test(j)) return BOOKS[j - 1];
  return "a book";
}

const has = (set, value) => Array.isArray(set) && set.includes(value);

export function step(action, before, after) {
  switch (action) {
    case "Start":
      return `you download ${which(before, after, (j) => !before.wanted[j] && after.wanted[j])}`;
    case "Cancel":
      return `you cancel ${which(before, after, (j) => !before.cancelled[j] && after.cancelled[j])}`;
    case "Retry":
      return `you tap Retry on ${which(before, after, (j) => before.st[j] === "failed" || before.st[j] === "retrying" ? before.st[j] !== after.st[j] || before.retryDue[j] !== after.retryDue[j] : false)}`;
    case "Dismiss":
      return `you dismiss ${which(before, after, (j) => before.st[j] !== "none" && after.st[j] === "none")}`;
    case "RetryTimerFires":
      return `${which(before, after, (j) => before.retryDue[j] && !after.retryDue[j])}'s retry is due`;
    case "ForgetFires":
      return `${which(before, after, (j) => before.st[j] !== "none" && after.st[j] === "none")} leaves the list`;
    case "Reload":
      return "the page reloads";
    case "DeviceGoesOffline":
      return "the network drops";
    case "DeviceGoesOnline":
      return "the network returns";
    case "DeliverEvent":
      return before.events[1] === "offline"
        ? "the app hears that it is offline"
        : "the app hears that it is online";
    case "StaleAttemptEnds":
      return "a stopped request ends";
    case "AttemptSucceeds":
      return `${which(before, after, (j) => has(before.runs[j], "current") && !has(after.runs[j], "current"))}'s download finishes`;
    case "AttemptFails":
      return `${which(before, after, (j) => has(before.runs[j], "current") && !has(after.runs[j], "current"))}'s request fails`;
    default:
      return action;
  }
}

export function cause(v, facts, invariant) {
  if (invariant === "OfflineNothingRuns")
    return "the app started the next download while it knew the device was offline";
  return null;
}
