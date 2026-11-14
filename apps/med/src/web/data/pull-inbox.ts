import { pullInboxSchema, type PullInboxWant } from "../../shared/pull-inbox";
import { readBrowserToken } from "./auth";
import { createApi } from "./api";
import { browserFetch } from "./live";

/** The pull requests page's read: GitHub through the host's gh sign-in.
 * `all` searches all of GitHub; `want` asks for the host's last answer, a
 * fresh one, or a new read. */
export function readPullInbox(
  all: boolean,
  want: PullInboxWant,
  signal?: AbortSignal,
  fetcher = browserFetch,
) {
  const query = new URLSearchParams({
    ...(all ? { all: "1" } : {}),
    ...(want === "kept" ? {} : { read: want }),
  }).toString();
  return createApi(fetcher, readBrowserToken()).json(
    `/api/pull-requests${query ? `?${query}` : ""}`,
    pullInboxSchema,
    { signal },
  );
}
