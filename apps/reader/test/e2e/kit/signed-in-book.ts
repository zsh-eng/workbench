import type { BrowserContext, Page } from "@playwright/test";
import { importSampleBook } from "../helpers/fixtures";
import { mockApi } from "../helpers/mock-api";

/**
 * agent-kit `--before`: signed in to the e2e suite's API mock, with the
 * sample book (public domain) imported and synced. Its upload succeeds, so
 * the account has nothing to raise.
 */
export default async function signedInBook({
  page,
  context,
}: {
  page: Page;
  context: BrowserContext;
}) {
  await mockApi(context, true);
  await context.route("**/api/files/*", (route) => {
    const request = route.request();
    if (request.method() !== "PUT") return route.fallback();
    return route.fulfill({
      json: {
        id: request.url().split("/").at(-1),
        fileSize: request.postDataBuffer()?.length ?? 0,
        mediaType: request.headers()["content-type"] ?? "",
        createdAt: Date.now(),
      },
    });
  });
  await page.goto("/");
  await importSampleBook(page);
}
