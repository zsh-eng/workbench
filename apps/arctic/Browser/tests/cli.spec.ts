import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  API,
  article,
  eventually,
  identity,
  phone,
  signUp,
  sorted,
} from "./phone";

/**
 * `wb arctic save` (apps/sync-backup) against the same local API: the
 * records it writes for the phone are the ones this app writes, byte for
 * byte, and its credential can write nothing else.
 */
const cli = join(import.meta.dirname, "../../../sync-backup/src/cli.ts");
const swift = (ms: number) => (ms - 978_307_200_000) / 1000;

/** A Workbench Backup credential for the signed-in account, through the device flow. */
async function credential(request: APIRequestContext) {
  const grant = await (
    await request.post(`${API}/api/cli/device`, { data: {} })
  ).json();
  const approved = await request.post(`${API}/api/cli/approve`, {
    data: { user_code: grant.user_code },
    headers: { Origin: API },
  });
  expect(approved.ok()).toBeTruthy();
  const token = await request.post(`${API}/api/cli/token`, {
    data: { device_code: grant.device_code },
  });
  expect(token.ok()).toBeTruthy();
  return (await token.json()).access_token as string;
}

/** Runs wb with the credential in its environment, as on a local API. */
function wb(token: string, args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-e2e-"));
  try {
    const run = spawnSync(
      "bun",
      [cli, ...args, "--origin", API, "--data-dir", directory],
      { env: { ...process.env, WORKBENCH_TOKEN: token }, encoding: "utf8" },
    );
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function saveInWeb(page: Page, url: string) {
  await page.getByRole("button", { name: "Save a link" }).click();
  await page.getByPlaceholder("Paste a link").fill(url);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".toast")).toContainText(/saved/i);
}

/** A link the phone opened but did not save: in History, with no saved date. */
function visited(url: string) {
  const id = identity(url);
  return [
    {
      key: `article/${id}`,
      value: sorted({
        subtitle: "Read on the phone",
        title: "Polar night",
        url,
      }),
    },
    {
      key: `library/${id}`,
      value: sorted({
        archived: false,
        lastVisitedAt: swift(Date.now() - 3_600_000),
        read: true,
        saved: false,
        url,
      }),
    },
    {
      key: `tags/${id}`,
      value: sorted({
        automatic: ["Ice"],
        generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
        manual: [],
        names: ["Ice"],
        rejected: [],
        url,
      }),
    },
  ];
}

test("wb arctic save writes the web's records, restores History as the web does, and may write nothing else", async ({
  page,
  context,
  browser,
}, info) => {
  const fresh = "https://example.com/notes/how-sea-ice-keeps-time";
  const history = "https://example.com/polar-night";
  const inHistory = visited(history);
  const shelf = article("https://example.com/already-saved", {
    title: "On the shelf",
  });

  // The web: one account saves a new link and a link from History.
  await signUp(context);
  await phone(context.request).push([...inHistory, ...shelf.records]);
  await page.goto("/");
  await expect(page.locator(".card")).toHaveCount(1);
  await saveInWeb(
    page,
    "HTTPS://Example.com:443/notes/how-sea-ice-keeps-time#top",
  );
  await saveInWeb(page, history);
  const web = phone(context.request);
  await eventually(async () => {
    const records = await web.records();
    return (
      records.has(`tags/${identity(fresh)}`) &&
      JSON.parse(records.get(`library/${identity(history)}`)!.value).saved
    );
  }).toBe(true);
  const fromWeb = await web.records();

  // wb: another account with the same History and Saved, from the terminal.
  const terminal = await browser.newContext({
    baseURL: info.project.use.baseURL,
  });
  await signUp(terminal);
  const ours = phone(terminal.request);
  await ours.push([...inHistory, ...shelf.records]);
  const before = await ours.records();
  const token = await credential(terminal.request);
  const run = wb(token, [
    "arctic",
    "save",
    "HTTPS://Example.com:443/notes/how-sea-ice-keeps-time#top",
    history,
    shelf.url,
    "not a link",
    "--no-text",
    "--json",
  ]);
  expect(run.status, run.stderr).toBe(1);
  expect(
    JSON.parse(run.stdout).map((result: { status: string; url?: string }) => [
      result.status,
      result.url ?? null,
    ]),
  ).toEqual([
    ["saved", fresh],
    ["restored", history],
    ["already saved", shelf.url],
    ["invalid", null],
  ]);
  const fromWb = await ours.records();

  // Byte for byte the web's records, but for the two inputs that differ:
  // the web titles a link from its address and wb from its page (its
  // host with --no-text), and each records its own time.
  const value = (records: typeof fromWeb, key: string) =>
    records.get(key)!.value;
  const savedAt = (records: typeof fromWeb, key: string) =>
    `"savedAt":${JSON.parse(value(records, key)).savedAt}`;
  for (const url of [fresh, history]) {
    const id = identity(url);
    for (const family of ["article", "library", "tags"]) {
      const key = `${family}/${id}`;
      let expected = value(fromWeb, key);
      if (family === "library")
        expected = expected.replace(
          savedAt(fromWeb, key),
          savedAt(fromWb, key),
        );
      if (family === "article" && url === fresh)
        expected = expected.replace(
          '"title":"How sea ice keeps time"',
          '"title":"example.com"',
        );
      expect(value(fromWb, key), key).toBe(expected);
      expect(fromWb.get(key)!.isDeleted).toBe(false);
    }
  }
  // A restore changes the library record alone; a saved link nothing.
  for (const key of [
    `article/${identity(history)}`,
    `tags/${identity(history)}`,
    ...shelf.records.map((record) => record.key),
  ])
    expect(fromWb.get(key)).toEqual(before.get(key));
  expect(JSON.parse(value(fromWb, `library/${identity(history)}`))).toEqual({
    ...JSON.parse(value(before, `library/${identity(history)}`)),
    saved: true,
    savedAt: JSON.parse(value(fromWb, `library/${identity(history)}`)).savedAt,
  });

  // The web app reads what wb saved, newest first: the restored link, then
  // the new one under its host until the phone fetches its title.
  const reader = await terminal.newPage();
  await reader.goto("/");
  await expect(reader.locator(".card-title")).toHaveText([
    "Polar night",
    "example.com",
    "On the shelf",
  ]);

  // The credential cannot write anything else, and a refusal stores nothing.
  const scope = async (namespace: string) =>
    JSON.stringify(
      await (
        await terminal.request.get(
          `${API}/api/apps/${namespace}/sync/v3/state`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
      ).json(),
    );
  const push = async (
    namespace: string,
    key: string,
    value: string,
    isDeleted = false,
  ) =>
    (
      await terminal.request.post(`${API}/api/apps/${namespace}/sync/v3/push`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Device-ID": "wb-arctic",
          "X-Sync-Scope": await scope(namespace),
        },
        data: {
          changes: [
            {
              key,
              value,
              isDeleted,
              schemaVersion: 1,
              hlc: { wallTimeMs: Date.now(), counter: 0 },
            },
          ],
        },
      })
    ).status();
  const shelfLibrary = shelf.records[1]!;
  expect(await push("arctic", shelfLibrary.key, shelfLibrary.value, true)).toBe(
    403,
  );
  expect(
    await push(
      "arctic",
      `library/${identity("https://example.com/new")}`,
      '{"saved":true',
    ),
  ).toBe(403);
  expect(
    await push(
      "arctic",
      `article/${identity(fresh)}`,
      sorted({ subtitle: "", title: "Renamed", url: fresh }),
    ),
  ).toBe(403);
  expect(
    await push(
      "arctic-annotations",
      "annotation/0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
      "{}",
    ),
  ).toBe(403);
  expect(
    await push(
      "arctic-reading",
      "session/0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
      "{}",
    ),
  ).toBe(403);
  expect(await ours.records()).toEqual(fromWb);
  await terminal.close();
});
