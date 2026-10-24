# Replays

On 24 October 2026, these temporary tests replayed each bug in
[FINDINGS.md](FINDINGS.md) against the real code. They were not committed to
the test suites. Each test asserts the rule, so it fails while the bug is
there and passes after a fix.

## Web: bugs 1, 2 and 3

Copy the code to `apps/arctic/Browser/tests/zz-replay.spec.ts`, then run
`bunx playwright test tests/zz-replay.spec.ts` in `apps/arctic/Browser`. Run
one browser suite at a time, and delete the file afterwards.

```ts
// Temporary statechart replays; not for commit.
import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

test.beforeEach(async ({ page, context }) => {
  await signUp(context);
  await page.setViewportSize({ width: 390, height: 844 });
});

test("R1 cancel while Paste waits for the clipboard", async ({ page, context }) => {
  // A slow clipboard read, as while the browser asks for permission.
  await page.addInitScript(() => {
    navigator.clipboard.readText = () =>
      new Promise((done) => setTimeout(() => done("https://example.com/polar-night"), 1500));
  });
  await phone(context.request).push(article("https://example.com/older", { title: "Older reading" }).records);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(1);
  const add = page.getByRole("button", { name: "Save a link" });
  await add.click();
  await page.getByRole("button", { name: "Paste", exact: true }).click();
  await page.mouse.click(195, 300); // the scrim: cancel
  await expect(add).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(2500);
  const titles = await page.locator(".card-title").allTextContents();
  console.log("R1 cards after cancel:", JSON.stringify(titles));
  expect(titles).toEqual(["Older reading"]);
});

test("R2 a link saved during a search", async ({ page, context }) => {
  await phone(context.request).push(article("https://example.com/older", { title: "Older reading" }).records);
  await page.goto("/");
  await page.locator("input[type=search]").fill("older");
  await expect(page.locator(".card")).toHaveCount(1);
  await page.getByRole("button", { name: "Save a link" }).click();
  await page.getByPlaceholder("Paste a link").fill("https://example.com/polar-night");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Saved");
  await page.waitForTimeout(800);
  console.log("R2 url:", page.url(), "cards:", JSON.stringify(await page.locator(".card-title").allTextContents()));
  await expect(page.locator(".card-title", { hasText: "Polar night" })).toBeVisible();
});

test("R3 a sheet after its code failed to load once", async ({ page, context }) => {
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  await page.route(/\/src\/sheet\.tsx/, (route) => route.abort("internetdisconnected"));
  await page.goto("/");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  const toolbar = page.getByRole("toolbar", { name: "Article" });
  await toolbar.getByRole("button", { name: "Text and theme" }).click();
  await page.waitForTimeout(1500);
  console.log("R3 offline sheet shown:", await page.getByRole("dialog", { name: "Text and theme" }).isVisible());
  // The network returns.
  await page.unroute(/\/src\/sheet\.tsx/);
  console.log("R3 fresh import after unroute:", await page.evaluate(() =>
    import("/src/sheet.tsx").then(() => "ok", (error) => "fail: " + String(error))));
  await page.goBack();
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await toolbar.getByRole("button", { name: "Text and theme" }).click();
  await expect(page.getByRole("dialog", { name: "Text and theme" })).toBeVisible({ timeout: 4000 });
});
```

Output on 24 October 2026 (all three fail, so each bug reproduced):

```text
R1 cards after cancel: ["Polar night","Older reading"]
R2 url: http://localhost:5186/?q=older cards: ["Older reading"]
R3 offline sheet shown: false
R3 fresh import after unroute: fail: TypeError: Failed to fetch dynamically imported module: http://localhost:5186/src/sheet.tsx
```

R1 replaces `navigator.clipboard.readText` with a read that takes 1.5 s, as
when the browser asks for permission. The link bar's own code runs unchanged.

## Phone sync: bug 4

Copy the code to `apps/arctic/Sync/Tests/ArcticSyncTests/ZZReplayScratch.swift`,
then run `swift test --filter replayOlderPhoneEditBeatsNewerWebEdit` in
`apps/arctic/Sync`. Delete the file afterwards.

```swift
// Temporary statechart replay; not for commit.
import Foundation
import Testing

@testable import ArcticSync

private actor ReplayRemote: SyncRemote {
  var records: [String: SyncRecord] = [:]
  var sequence: Int64 = 0
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    let end = head ?? sequence
    let rows = records.values.filter { $0.serverSeq > cursor && $0.serverSeq <= end }.sorted {
      $0.serverSeq < $1.serverSeq
    }
    return .init(records: rows, cursor: end, head: end, hasMore: false)
  }
  // The server's rule (packages/local-sync/src/hono/d1.ts:72): the highest HLC wins.
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    .init(
      results: changes.map { change in
        if let old = records[change.key],
          old.hlc > change.hlc || (old.hlc == change.hlc && old.deviceId >= deviceID)
        {
          return .init(accepted: false, winner: old)
        }
        sequence += 1
        let winner = SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence)
        records[change.key] = winner
        return .init(accepted: true, winner: winner)
      })
  }
}

@Test func replayOlderPhoneEditBeatsNewerWebEdit() async throws {
  struct Note: Codable { let updatedAt: Int; let text: String }
  func value(_ updatedAt: Int, _ text: String) -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    return String(decoding: try! encoder.encode(Note(updatedAt: updatedAt, text: text)), as: UTF8.self)
  }
  // AccountRecordJournal.newer (apps/arctic/Sources/LibrarySync.swift): the later updatedAt wins.
  let newer: @Sendable (String, String) -> SyncStore.Newer = { local, remote in
    let ours = try! JSONDecoder().decode(Note.self, from: Data(local.utf8))
    let theirs = try! JSONDecoder().decode(Note.self, from: Data(remote.utf8))
    if ours.updatedAt == theirs.updatedAt { return .neither }
    return ours.updatedAt > theirs.updatedAt ? .local : .remote
  }
  let remote = ReplayRemote()
  let backend = Backend.sqlite
  let phoneFile = backend.location()
  let webFile = backend.location()
  defer {
    backend.remove(phoneFile)
    backend.remove(webFile)
  }
  let phone = try backend.open(phoneFile, accountID: "alice", deviceID: "phone")
  let web = try backend.open(webFile, accountID: "alice", deviceID: "web")
  let hour: TimeInterval = 3600
  // 1. 09:00, phone offline: the note is edited on the phone (value only; it is stamped at sync).
  let phoneNote = value(9, "phone, 09:00")
  // 2. 10:00, web offline: the same note is edited on the web, stamped at write time.
  try await web.commit(
    [LocalMutation(key: "annotation/n", value: value(10, "web, 10:00"))],
    now: Date().addingTimeInterval(-hour))
  // 3. 11:00 (now): the phone comes online and syncs: pull, reconcile, push.
  _ = try await phone.sync(using: remote, reconciling: ["annotation/n": phoneNote], newer: newer)
  // 4. Later: the web comes online and syncs.
  try await web.sync(using: remote)
  let server = await remote.records["annotation/n"]?.value
  let webNow = await web.snapshot()["annotation/n"]?.value
  print("REPLAY server=\(server ?? "nil") web=\(webNow ?? "nil")")
  // Rule: once both have synced, both keep the newest edit (the web's, 10:00).
  #expect(server == value(10, "web, 10:00"))
  #expect(webNow == value(10, "web, 10:00"))
}
```

Output on 24 October 2026 (the test fails, so the bug reproduced):

```text
REPLAY server={"text":"phone, 09:00","updatedAt":9} web={"text":"phone, 09:00","updatedAt":9}
```
