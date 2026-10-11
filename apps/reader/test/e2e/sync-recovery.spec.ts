import { expect, openAccountMenu, test } from "./helpers/fixtures";

test.use({ signedIn: true });
test("shows offline feedback when connectivity changes during manual sync", async ({
  page,
}) => {
  await page.goto("/");
  const menu = await openAccountMenu(page);
  const sync = menu.getByRole("menuitem", { name: /^Sync now:/ });
  await expect(sync).toBeVisible();
  // Change connectivity at the service boundary, after the enabled UI action.
  await page.evaluate(async () => {
    const path = "/src/lib/sync-service.ts";
    const { syncService } = await import(path);
    const original = syncService.syncAll.bind(syncService);
    syncService.syncAll = async () => {
      syncService.syncAll = original;
      window.dispatchEvent(new Event("offline"));
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
