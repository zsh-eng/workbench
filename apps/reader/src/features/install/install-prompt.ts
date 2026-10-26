import { useSyncExternalStore } from "react";

/** Chromium's install event, which is not in the DOM typings. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

export interface InstallPromptState {
  /** Chromium's held install prompt; it can be shown once. */
  prompt: BeforeInstallPromptEvent | null;
  /** Installed while this page was open, so the tab is still a tab. */
  installedHere: boolean;
}

let state: InstallPromptState = { prompt: null, installedHere: false };
const listeners = new Set<() => void>();
let listening = false;

function publish(next: Partial<InstallPromptState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/**
 * Holds Chromium's install prompt from the first page load, before React
 * renders: the event can fire early and fires once. Holding it also keeps
 * Chrome's own mini-infobar away, so the Library offers to install at a
 * calm moment instead (InstallOfferHost).
 */
export function listenForInstallPrompt(): void {
  if (listening) return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    publish({ prompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => {
    publish({ prompt: null, installedHere: true });
  });
}

/**
 * Shows the browser's install dialog. The held event is spent either way,
 * so the sheet's Install button goes once the dialog has answered.
 */
export async function promptToInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = state.prompt;
  if (!event) return "unavailable";
  await event.prompt();
  const { outcome } = await event.userChoice;
  publish({
    prompt: null,
    installedHere: state.installedHere || outcome === "accepted",
  });
  return outcome;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallPrompt(): InstallPromptState {
  return useSyncExternalStore(subscribe, () => state);
}
