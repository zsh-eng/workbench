import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  articleId,
  canonicalURL,
  encodeSorted,
  newLinkRecords,
  savedLibrary,
  toSwift,
} from "@workbench/arctic-links";
import worker from "../src/index";
import { digest } from "../src/cli-auth";
import { signedIn } from "./accounts";

const origin = "http://localhost:8792";
const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), env);

/** A Workbench Backup credential for the account, through the device flow. */
async function credential(cookie: string) {
  const json = { "Content-Type": "application/json" };
  const grant = (await (
    await call("/api/cli/device", { method: "POST", headers: json, body: "{}" })
  ).json()) as { device_code: string; user_code: string };
  const approved = await call("/api/cli/approve", {
    method: "POST",
    headers: { ...json, Cookie: cookie, Origin: origin },
    body: JSON.stringify({ user_code: grant.user_code }),
  });
  expect(approved.status).toBe(200);
  await env.DATABASE.prepare(
    "UPDATE cli_device_grants SET last_poll=0 WHERE device_hash=?",
  )
    .bind(await digest(grant.device_code))
    .run();
  const token = await call("/api/cli/token", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ device_code: grant.device_code }),
  });
  return ((await token.json()) as { access_token: string }).access_token;
}

type Change = { key: string; value: string; isDeleted?: boolean };
let wallTimeMs = Date.now();

/** Pushes to a namespace as the phone (a browser cookie) or as wb (a bearer credential). */
async function push(
  auth: Record<string, string>,
  namespace: string,
  changes: Change[],
  options: { schemaVersion?: number; body?: string } = {},
) {
  const scope = await (
    await call(`/api/apps/${namespace}/sync/v3/state`, { headers: auth })
  ).text();
  wallTimeMs = Math.max(wallTimeMs + 1, Date.now());
  return call(`/api/apps/${namespace}/sync/v3/push`, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Type": "application/json",
      "X-Device-ID": "wb-arctic",
      "X-Sync-Scope": scope,
    },
    body:
      options.body ??
      JSON.stringify({
        changes: changes.map((change, counter) => ({
          key: change.key,
          value: change.value,
          isDeleted: change.isDeleted ?? false,
          schemaVersion: options.schemaVersion ?? 1,
          hlc: { wallTimeMs, counter },
        })),
      }),
  });
}

/** The phone's latest record of each key. */
async function records(cookie: string) {
  const scope = await (
    await call("/api/apps/arctic/sync/v3/state", {
      headers: { Cookie: cookie },
    })
  ).text();
  const page = (await (
    await call(
      "/api/apps/arctic/sync/v3/pull?cursor=0&excludeOwnDevice=false",
      {
        headers: {
          Cookie: cookie,
          "X-Device-ID": "iphone",
          "X-Sync-Scope": scope,
        },
      },
    )
  ).json()) as {
    records: { key: string; value: string; isDeleted: boolean }[];
  };
  return new Map(page.records.map((record) => [record.key, record]));
}

/** An article as the phone keeps it, with the library fields given. */
async function phoneArticle(url: string, library: Record<string, unknown>) {
  const id = await articleId(url);
  return {
    id,
    records: [
      {
        key: `article/${id}`,
        value: encodeSorted({ subtitle: "From the phone", title: "Kept", url }),
      },
      {
        key: `library/${id}`,
        value: encodeSorted({ archived: false, read: true, url, ...library }),
      },
      {
        key: `tags/${id}`,
        value: encodeSorted({
          automatic: ["ice"],
          generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
          manual: [],
          names: ["ice"],
          rejected: [],
          url,
        }),
      },
    ],
  };
}

it("lets a backup credential create and restore Arctic links in the phone's records, and nothing else", async () => {
  const cookie = await signedIn(call, origin);
  const phone = { Cookie: cookie };
  const wb = { Authorization: `Bearer ${await credential(cookie)}` };
  const now = toSwift(Date.now());

  const saved = await phoneArticle("https://example.com/saved", {
    saved: true,
    savedAt: now - 100,
  });
  const visited = await phoneArticle("https://example.com/visited", {
    saved: false,
    lastVisitedAt: now - 50,
    favourite: true,
    favouritedAt: now - 60,
  });
  const other = await phoneArticle("https://example.com/other-visit", {
    saved: false,
    lastVisitedAt: now - 40,
  });
  expect(
    (
      await push(phone, "arctic", [
        ...saved.records,
        ...visited.records,
        ...other.records,
      ])
    ).status,
  ).toBe(200);

  // A new link: the three records that the web writes, with the page's title.
  const url = canonicalURL("HTTPS://Example.com:443/notes/sea-ice#top")!;
  expect(url).toBe("https://example.com/notes/sea-ice");
  const id = await articleId(url);
  const created = newLinkRecords(url, id, {
    title: "How sea ice keeps time",
    savedAt: now,
  });
  const response = await push(wb, "arctic", created);
  expect(response.status).toBe(200);
  const result = (await response.json()) as {
    results: { accepted: boolean }[];
  };
  expect(result.results.every((item) => item.accepted)).toBe(true);

  // A link from History: saved again as a field edit; its other fields stay.
  const before = (await records(cookie)).get(`library/${visited.id}`)!.value;
  const restore = {
    key: `library/${visited.id}`,
    value: savedLibrary(before, now),
  };
  expect((await push(wb, "arctic", [restore])).status).toBe(200);
  expect(JSON.parse(restore.value)).toEqual({
    ...JSON.parse(before),
    saved: true,
    savedAt: now,
  });

  const stored = await records(cookie);
  for (const record of [...created, restore])
    expect(stored.get(record.key)!.value).toBe(record.value);
  const snapshot = JSON.stringify(
    [...stored.values()].map((record) => [
      record.key,
      record.value,
      record.isDeleted,
    ]),
  );

  // Every other write to `arctic` is refused before it is stored.
  const refused = async (
    changes: Change[],
    options?: { schemaVersion?: number; body?: string },
  ) => {
    const answer = await push(wb, "arctic", changes, options);
    expect(answer.status).toBe(403);
    return ((await answer.json()) as { error: string }).error;
  };
  const record = (key: string) => stored.get(key)!;
  const otherURL = "https://example.com/another";
  const otherID = await articleId(otherURL);
  const fresh = newLinkRecords(otherURL, otherID, {
    title: "Another",
    savedAt: now,
  });
  const swap = (index: number, value: unknown) =>
    fresh.map((item, at) =>
      at === index ? { ...item, value: encodeSorted(value) } : item,
    );

  expect(
    await refused(
      newLinkRecords("https://example.com/saved", saved.id, {
        title: "Again",
        savedAt: now,
      }),
    ),
  ).toContain("already in the library");
  expect(
    await refused(
      swap(0, {
        imageURL: "https://example.com/i.png",
        subtitle: "",
        title: "Another",
        url: otherURL,
      }),
    ),
  ).toContain("phone's format");
  expect(
    await refused(
      swap(0, { subtitle: "A description", title: "Another", url: otherURL }),
    ),
  ).toContain("phone's format");
  expect(
    await refused(
      swap(1, {
        archived: true,
        read: false,
        saved: true,
        savedAt: now,
        url: otherURL,
      }),
    ),
  ).toContain("phone's format");
  expect(
    await refused(
      swap(2, {
        automatic: [],
        generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
        manual: [],
        names: [],
        rejected: [],
        url: otherURL,
      }),
    ),
  ).toContain("phone's format");
  expect(
    await refused(
      swap(0, { subtitle: "", title: "Broken \ud800 title", url: otherURL }),
    ),
  ).toContain("well-formed");
  expect(
    await refused(
      swap(1, {
        archived: false,
        read: false,
        saved: true,
        savedAt: now + 10 * 86_400,
        url: otherURL,
      }),
    ),
  ).toContain("Swift date");
  expect(await refused(swap(1, "not an object"))).toContain("Swift date");
  // Not the canonical URL of the id, or another URL's id.
  const loud = "https://EXAMPLE.com/another";
  expect(
    await refused(
      newLinkRecords(loud, await articleId(loud), { title: "", savedAt: now }),
    ),
  ).toContain("canonical URL");
  expect(
    await refused(newLinkRecords(otherURL, id, { title: "", savedAt: now })),
  ).toContain("already in the library");
  expect(
    await refused(
      newLinkRecords(otherURL, "0".repeat(64), { title: "", savedAt: now }),
    ),
  ).toContain("canonical URL");
  expect(await refused(fresh.slice(0, 2))).toContain("a new link writes");
  expect(await refused(fresh, { schemaVersion: 2 })).toContain(
    "schema version",
  );
  // Removals, other families and other fields of a known article.
  expect(
    await refused([{ ...record(`library/${saved.id}`), isDeleted: true }]),
  ).toContain("removing");
  expect(
    await refused([
      { key: "annotation/0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10", value: "{}" },
    ]),
  ).toContain("not a link record");
  expect(
    await refused([
      {
        key: `library/${saved.id}`,
        value: savedLibrary(record(`library/${saved.id}`).value, now),
      },
    ]),
  ).toContain("already saved");
  expect(
    await refused([
      {
        key: `article/${visited.id}`,
        value: encodeSorted({
          subtitle: "",
          title: "Renamed",
          url: "https://example.com/visited",
        }),
      },
    ]),
  ).toContain("a new link writes");
  const otherLibrary = record(`library/${other.id}`).value;
  expect(
    await refused([
      {
        key: `library/${other.id}`,
        value: encodeSorted({
          ...JSON.parse(savedLibrary(otherLibrary, now)),
          favourite: true,
        }),
      },
    ]),
  ).toContain("changes only saved");
  expect(
    await refused([
      {
        key: `library/${other.id}`,
        value: encodeSorted({
          ...JSON.parse(savedLibrary(otherLibrary, now)),
          lastVisitedAt: null,
        }),
      },
    ]),
  ).toContain("changes only saved");
  expect(
    await refused([
      { key: `tags/${other.id}`, value: record(`tags/${other.id}`).value },
    ]),
  ).toContain("a new link writes");
  expect(await refused([], { body: "{not json" })).toContain("not JSON");
  expect(
    await refused([], { body: JSON.stringify({ changes: [], extra: true }) }),
  ).toContain("not a sync push");
  expect(await refused([], { body: " ".repeat(1024 * 1024 + 1) })).toContain(
    "too large",
  );

  const after = await records(cookie);
  expect(
    JSON.stringify(
      [...after.values()].map((item) => [item.key, item.value, item.isDeleted]),
    ),
  ).toBe(snapshot);

  // Other Arctic routes and every other namespace stay read-only for wb.
  const blocked = { key: "x", value: "{}" };
  for (const namespace of [
    "reader",
    "spaced",
    "arctic-annotations",
    "arctic-reading",
  ])
    expect((await push(wb, namespace, [blocked])).status).toBe(403);
  expect(
    (
      await call("/api/apps/arctic/files/xxh64:0000000000000000", {
        method: "PUT",
        headers: wb,
        body: "x",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        "/api/apps/arctic/sync/v3/pull-stream?cursor=0&excludeOwnDevice=false",
        { method: "DELETE", headers: wb },
      )
    ).status,
  ).toBe(403);

  // The phone's own session still writes what it likes, removals included.
  expect(
    (
      await push(phone, "arctic", [
        { ...record(`library/${saved.id}`), isDeleted: true },
      ])
    ).status,
  ).toBe(200);
}, 60_000);
