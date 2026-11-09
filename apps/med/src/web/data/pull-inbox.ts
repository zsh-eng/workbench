import { pullInboxSchema } from "../../shared/pull-inbox";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";

/** The pull requests page's read: GitHub through the host's gh sign-in.
 * `all` searches all of GitHub; `refresh` skips the host's minute-long read. */
export function readPullInbox(
  all: boolean,
  refresh: boolean,
  signal?: AbortSignal,
  fetcher = browserFetch,
) {
  const query = new URLSearchParams({
    ...(all ? { all: "1" } : {}),
    ...(refresh ? { refresh: "1" } : {}),
  }).toString();
  return createApi(fetcher, readBrowserToken()).json(
    `/api/pull-requests${query ? `?${query}` : ""}`,
    pullInboxSchema,
    { signal },
  );
}
