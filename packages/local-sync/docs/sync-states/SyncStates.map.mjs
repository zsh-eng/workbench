// Chart labels for SyncStates (packages/local-sync/docs/sync-states), for
// pstack's statechart.mjs. A state reads "the session: what the app says".

// What you do, what the network and the server do around you, and time
// passing (the app's timers). The rest is the app on its own: sync attempts
// and session checks. With --cover, the overview keeps the shortest path to
// each state where the app waits for one of these.
export const readerActions = [
  "SoonTimerFires",
  "RetryTimerFires",
  "DeviceGoesOffline",
  "DeviceGoesOnline",
  "RequestsStop",
  "RequestsResume",
  "SessionEnds",
  "MarkerLapses",
  "Edit",
  "SyncNow",
  "ReturnToApp",
  "Reopen",
  "SignInHere",
  "SignInGivenUp",
  "SignInElsewhere",
  "SignOut",
];

// The truth about the session. The network is not in the label: the app
// says Offline exactly when the device is offline (OfflineMeansNoNetwork),
// and a server that does not answer shows once an attempt fails.
const ACCOUNT = {
  none: "Not signed in",
  live: "Signed in",
  new: "Signed in again",
  ended: "Session ended",
};

/** describeSyncStatus in status.ts, as the spec's Label has it. */
export function label(v) {
  if (v.connection === "offline") return "Offline";
  if (v.auth === "expired") return "Sign in again to sync";
  if (v.running) return "Syncing";
  if (v.auth === "signed-out") return "Sign in to sync";
  if (v.failure === "network") return "Couldn't reach the server";
  if (v.unsent > 0) return "Saved on this device, will sync";
  if (v.synced) return "Synced";
  return "Not synced yet";
}

export function state(v) {
  return `${ACCOUNT[v.account]}: ${label(v)}`;
}

export const regionNames = ["The session", "The app says"];

const STEPS = {
  DeviceGoesOffline: "the network drops",
  DeviceGoesOnline: "the network returns",
  RequestsStop: "requests stop getting answers",
  RequestsResume: "requests get answers again",
  SessionEnds: "the session ends on the server",
  MarkerLapses: "ten minutes pass",
  Edit: "you change something",
  SyncNow: "you tap Sync now",
  ReturnToApp: "you come back to the app",
  Reopen: "you reopen the app",
  SignInHere: "you sign in",
  SignInGivenUp: "you leave to sign in and come back without it",
  SignInElsewhere: "another tab signs in",
  SignOut: "you sign out",
  SoonTimerFires: "the requested sync starts",
  RetryTimerFires: "the retry starts",
  AttemptSucceeds: "the sync finishes",
  AttemptNoAnswer: "the sync gets no answer",
  AttemptRefused: "the server refuses the session",
  AttemptRefusedLate: "a refusal of the old session arrives",
  CheckGetsNoAnswer: "the session check gets no answer",
  CheckFindsSession: "the session check finds the session",
  CheckFindsNoSession: "the session check finds no session",
};

export function step(action) {
  return STEPS[action] ?? action;
}

export function cause(v, facts, invariant) {
  if (invariant === "NewSignInIsSeen")
    return v.marker
      ? "the device has not heard from the server since you signed in"
      : "the device has not heard from the server since you signed in, in another tab or more than ten minutes ago";
  if (invariant === "EndedSessionLooksSignedOut")
    return v.device === "offline" || v.reach === "no"
      ? "the device cannot reach the server"
      : "the device has not asked the server since the session ended";
  return null;
}
