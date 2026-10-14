import type { BrowseSource } from "../../shared/browse";

/** A file that a page outside the workspaces, such as Search, asks one
 * workspace to open. The workspace opens it once it shows. */
export interface FileOpen {
  path: string;
  line?: number;
  source: BrowseSource;
  label: string;
}

const requests = new Map<string, FileOpen>();
const listeners = new Set<() => void>();

export function requestFileOpen(workspaceId: string, request: FileOpen) {
  requests.set(workspaceId, request);
  for (const listener of listeners) listener();
}

/** The workspace's request, which only one taker gets. */
export function takeFileOpen(workspaceId: string) {
  const request = requests.get(workspaceId);
  requests.delete(workspaceId);
  return request;
}

export function subscribeFileOpens(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
