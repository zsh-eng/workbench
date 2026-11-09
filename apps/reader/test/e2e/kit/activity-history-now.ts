import type { Page } from "@playwright/test";
import activityHistory from "./activity-history";
import { holdDownload } from "./held-download";

/**
 * agent-kit `--steps`, with `two-devices.ts`: a book's download holds, so
 * Now has a job above Recent; then Account → Activity.
 */
export default async function activityHistoryNow({ page }: { page: Page }) {
  await holdDownload(page);
  await activityHistory({ page });
}
