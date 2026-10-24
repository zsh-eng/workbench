# Replays

Each bug in [FINDINGS.md](FINDINGS.md) that this branch fixes has a test in
the suites. On 24 October 2026, each test failed with its fix taken out, and
passed with the fix. Bug 3 is fixed by `agent/arctic-sheets-toast`, whose
`tests/sheets.spec.ts` replays it; its temporary replay stays below for the
code before that branch.

## Tests in the suites

| Bug          | Test                                                                                              | How the fix was taken out                                                                              | Result without the fix                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1            | `tests/links.spec.ts`: "the phone's link bar saves nothing after Cancel, and shows what it saves" | Remove `if (closes.current !== asked) return;` from `src/AddLink.tsx`.                                 | Failed: one card too many after Cancel.                                                                                  |
| 2            | The same test                                                                                     | Remove `showAll: true` from `show()` in `src/AddLink.tsx`.                                             | Failed: the saved card was not in the list.                                                                              |
| Search field | The same test                                                                                     | Use `src/styles.css` from before 4e8327b3.                                                             | Failed: the Archive folder took the tap on the search field.                                                             |
| 4            | `apps/arctic/Tests/AccountRecordsTests.swift`: `anOlderPhoneEditDoesNotReplaceANewerWebEdit`      | Remove `self?.commit(.annotations)` from the `edited` hook in `apps/arctic/Sources/LibrarySync.swift`. | Failed with 3 issues: the server refused the web's newer note and kept the phone's older one, and the phone kept it too. |
| 5            | The same file: `aReaderCopyGoesToTheAccountWhenItHasNoText`                                       | Replace `try await syncCopies()` with `break`.                                                         | Failed: the account had no record for the article.                                                                       |

`apps/arctic/Sync/Tests/ArcticSyncTests/ArticleTextTests.swift` pins the
XXH64 file IDs to values from the web's implementation, and checks the upload
request. It is new code, so it has no "without the fix" run.

To run the tests:

- In `apps/arctic/Browser`: `bunx playwright test tests/links.spec.ts`. Run
  one browser suite at a time.
- In `apps/arctic/Tests`: `python3 check-account-records.py`. It compiles
  the production sources into a temporary Swift package, with a fake server
  that keeps the real server's rules.
- In `apps/arctic/Sync`: `swift test`.

Bug 1's test gives the page a clipboard that answers when the test says, as
while a browser asks for permission. Bug 4's test sends the web's change as
the web does: stamped when it is written.

## Bug 3: temporary replay

Copy the code to `apps/arctic/Browser/tests/zz-replay.spec.ts`, then run
`bunx playwright test tests/zz-replay.spec.ts` in `apps/arctic/Browser`. Run
one browser suite at a time, and delete the file afterwards.

```ts
// Temporary statechart replay; not for commit.
import { expect, test } from "@playwright/test";
import { addText, article, paragraphs, phone, signUp } from "./phone";

test.beforeEach(async ({ page, context }) => {
  await signUp(context);
  await page.setViewportSize({ width: 390, height: 844 });
});

test("R3 a sheet after its code failed to load once", async ({
  page,
  context,
}) => {
  const floe = article("https://example.com/floe", { title: "A floe at dawn" });
  await phone(context.request).push(floe.records);
  await addText(context.request, floe, paragraphs(12));
  await page.route(/\/src\/sheet\.tsx/, (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/");
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  const toolbar = page.getByRole("toolbar", { name: "Article" });
  await toolbar.getByRole("button", { name: "Text and theme" }).click();
  await page.waitForTimeout(1500);
  console.log(
    "R3 offline sheet shown:",
    await page.getByRole("dialog", { name: "Text and theme" }).isVisible(),
  );
  // The network returns.
  await page.unroute(/\/src\/sheet\.tsx/);
  console.log(
    "R3 fresh import after unroute:",
    await page.evaluate(() =>
      import("/src/sheet.tsx").then(
        () => "ok",
        (error) => "fail: " + String(error),
      ),
    ),
  );
  await page.goBack();
  await page.locator(".card-title", { hasText: "A floe at dawn" }).click();
  await toolbar.getByRole("button", { name: "Text and theme" }).click();
  await expect(
    page.getByRole("dialog", { name: "Text and theme" }),
  ).toBeVisible({ timeout: 4000 });
});
```

Output on 24 October 2026 (the test fails, so the bug reproduced):

```text
R3 offline sheet shown: false
R3 fresh import after unroute: fail: TypeError: Failed to fetch dynamically imported module: http://localhost:5186/src/sheet.tsx
```
