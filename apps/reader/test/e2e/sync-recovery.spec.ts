import { expect, openAccountMenu, test } from "./helpers/fixtures";

test.use({ signedIn: true });
test("shows offline feedback when connectivity changes during manual sync", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await openAccountMenu(page);
  const sync = menu.getByRole("menuitem", { name: /^Sync now:/ });
  await expect(sync).toBeVisible();
  // Lose the network after the enabled UI action, before the exchange starts.
  await page.exposeFunction("goOffline", () => page.context().setOffline(true));
  await page.evaluate(async () => {
    const path = "/src/lib/sync-service.ts";
    const { syncService } = await import(path);
    const original = syncService.syncAll.bind(syncService);
    syncService.syncAll = async () => {
      syncService.syncAll = original;
      await (window as unknown as { goOffline(): Promise<void> }).goOffline();
      return original();
    };
  });
  await sync.click();
  await expect(
    page.getByText("Connect to the internet to sync."),
  ).toBeVisible();
  await expect(page.getByText("Library synced", { exact: true })).toHaveCount(
    0,
  );
});
