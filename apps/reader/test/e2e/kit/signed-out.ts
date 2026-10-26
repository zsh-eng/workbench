import type { BrowserContext } from "@playwright/test";
import { mockApi } from "../helpers/mock-api";

/** agent-kit `--before`: the e2e suite's API mock, signed out. */
export default async function signedOut({
  context,
}: {
  context: BrowserContext;
}) {
  await mockApi(context);
}
