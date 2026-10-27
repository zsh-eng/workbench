import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  articleId,
  canonicalURL,
  encodeSorted,
  newLinkRecords,
  savedLibrary,
  toSwift,
  withPreview,
} from "@workbench/arctic-links";
import worker from "../src/index";
import { credential, signedIn } from "./accounts";

const origin = "http://localhost:8792";
const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), env);

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
  const wb = { Authorization: `Bearer ${await credential(call, cookie, origin)}` };
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
  // Addresses that the WHATWG parser takes but the phone's URL decoder does not.
  for (const odd of ["http://site.fr/r%E9sum%E9.html", "https://a{b.com/x"])
    expect(
      await refused(
        newLinkRecords(odd, await articleId(odd), { title: "", savedAt: now }),
      ),
    ).toContain("canonical URL");
  expect(await refused(fresh.slice(0, 2))).toContain("a new link writes");
  const bigCounter = JSON.stringify({
    changes: fresh.map((change, index) => ({
      ...change,
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: Date.now(), counter: 2 ** 40 + index },
    })),
  });
  expect(await refused([], { body: bigCounter })).toContain("version counter");
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
  ).toContain("a preview sets only imageURL, faviconURL and subtitle");
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

it("lets a backup credential fill only the empty preview fields of a link in the library", async () => {
  const cookie = await signedIn(call, origin);
  const phone = { Cookie: cookie };
  const wb = { Authorization: `Bearer ${await credential(call, cookie, origin)}` };
  const now = toSwift(Date.now());
  const preview = {
    title: "Not written",
    subtitle: "Ice keeps time.",
    imageURL: "https://news.example/ice.jpg",
    faviconURL: "https://news.example/favicon.ico",
  };

  // A link from the web or wb: no description, image or icon. One from the
  // phone: its own image, description and tagging text, but no icon. And
  // one the phone removed.
  const bare = await phoneArticle("https://example.com/bare", {
    saved: true,
    savedAt: now,
  });
  bare.records[0]!.value = encodeSorted({
    subtitle: "",
    title: "Bare",
    url: "https://example.com/bare",
  });
  const fromPhone = await phoneArticle("https://example.com/phone", {
    saved: true,
    savedAt: now,
  });
  fromPhone.records[0]!.value = encodeSorted({
    imageURL: "https://phone.example/own.jpg",
    subtitle: "The phone's description",
    taggingText: "Article excerpt: ice",
    title: "From the phone",
    url: "https://example.com/phone",
  });
  const removed = await phoneArticle("https://example.com/removed", {
    saved: true,
    savedAt: now,
  });
  expect(
    (
      await push(phone, "arctic", [
        ...bare.records,
        ...fromPhone.records,
        ...removed.records,
      ])
    ).status,
  ).toBe(200);
  expect(
    (
      await push(phone, "arctic", [
        { ...removed.records[1]!, isDeleted: true },
      ])
    ).status,
  ).toBe(200);

  const before = await records(cookie);
  const article = (id: string) => before.get(`article/${id}`)!.value;
  const refused = async (key: string, value: string) => {
    const answer = await push(wb, "arctic", [{ key, value }]);
    expect(answer.status).toBe(403);
    return ((await answer.json()) as { error: string }).error;
  };
  const edited = (id: string, fields: Record<string, unknown>) =>
    encodeSorted({ ...JSON.parse(article(id)), ...fields });

  // Every other change to an article record is refused, and stores nothing.
  const onlyEmpty = "a preview sets only imageURL, faviconURL and subtitle";
  expect(
    await refused(`article/${fromPhone.id}`, edited(fromPhone.id, {
      imageURL: preview.imageURL,
    })),
  ).toContain(onlyEmpty);
  expect(
    await refused(`article/${fromPhone.id}`, edited(fromPhone.id, {
      faviconURL: preview.faviconURL,
      subtitle: "Another description",
    })),
  ).toContain(onlyEmpty);
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, {
      imageURL: preview.imageURL,
      title: "Renamed",
    })),
  ).toContain(onlyEmpty);
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, {
      imageURL: preview.imageURL,
      taggingText: "Article excerpt: ice",
    })),
  ).toContain(onlyEmpty);
  expect(
    await refused(`article/${fromPhone.id}`, edited(fromPhone.id, {
      imageURL: null,
    })),
  ).toContain(onlyEmpty);
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, {
      imageURL: "javascript:alert(1)",
    })),
  ).toContain("imageURL must be a canonical http or https URL");
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, {
      faviconURL: "https://NEWS.example/favicon.ico",
    })),
  ).toContain("faviconURL must be a canonical");
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, {
      subtitle: "Two\nlines",
    })),
  ).toContain("subtitle must be one line");
  expect(
    await refused(`article/${bare.id}`, edited(bare.id, { subtitle: 7 })),
  ).toContain("subtitle must be one line");
  expect(
    await refused(
      `article/${removed.id}`,
      withPreview(article(removed.id), preview)!,
    ),
  ).toContain("not in the library");
  expect(
    await refused(
      `article/${bare.id}`,
      encodeSorted({ ...JSON.parse(article(bare.id)), url: "https://example.com/x" }),
    ),
  ).toContain(onlyEmpty);
  expect(JSON.stringify([...(await records(cookie)).entries()])).toBe(
    JSON.stringify([...before.entries()]),
  );

  // Filling: every empty field of the bare link, and only the icon of the
  // phone's, whose image, description and tagging text stay its own.
  const fills = [
    { key: `article/${bare.id}`, value: withPreview(article(bare.id), preview)! },
    {
      key: `article/${fromPhone.id}`,
      value: withPreview(article(fromPhone.id), preview)!,
    },
  ];
  expect((await push(wb, "arctic", fills)).status).toBe(200);
  const after = await records(cookie);
  expect(JSON.parse(after.get(`article/${bare.id}`)!.value)).toEqual({
    faviconURL: preview.faviconURL,
    imageURL: preview.imageURL,
    subtitle: preview.subtitle,
    title: "Bare",
    url: "https://example.com/bare",
  });
  expect(JSON.parse(after.get(`article/${fromPhone.id}`)!.value)).toEqual({
    ...JSON.parse(article(fromPhone.id)),
    faviconURL: preview.faviconURL,
  });
  // Once filled, nothing is empty: the same fill again is refused.
  expect(
    await refused(`article/${bare.id}`, fills[0]!.value),
  ).toContain(onlyEmpty);
}, 60_000);
