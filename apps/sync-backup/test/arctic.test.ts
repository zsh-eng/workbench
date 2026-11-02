import { expect, setSystemTime, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  articleId,
  encodeSorted,
  linkChangesProblem,
  newLinkRecords,
  savedLibrary,
  toSwift,
  withPreview,
  type LinkPreview,
} from "@workbench/arctic-links";
import {
  compareSyncHlc,
  createSyncPullStream,
  type SyncPushChange,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import {
  arctic,
  arcticFetch,
  backfillPreviews,
  fetchMissingText,
  type LinkResult,
  type PreviewResult,
} from "../src/arctic";

/**
 * A shared API in miniature for `arctic` and `arctic-content`: scoped
 * state, a pull stream, pushes that keep the newer version, and text files.
 * A push to `arctic` passes the server's own check of wb's writes
 * (`linkChangesProblem`) first. It records every request, so a test sees
 * all that wb sent.
 */
function fakeAPI() {
  const stores = new Map<string, Map<string, SyncRecord>>([
    ["arctic", new Map()],
    ["arctic-content", new Map()],
  ]);
  const files = new Map<string, Uint8Array>();
  const requests: string[] = [];
  let serverSeq = 0;
  const put = (namespace: string, change: SyncPushChange, deviceId: string) => {
    const record = { ...change, deviceId, serverSeq: ++serverSeq };
    stores.get(namespace)!.set(change.key, record);
    return record;
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}`);
      if (request.headers.get("Authorization") !== "Bearer fixture")
        return new Response("", { status: 401 });
      const namespace = /^\/api\/apps\/([^/]+)\//.exec(url.pathname)?.[1] ?? "";
      const store = stores.get(namespace);
      if (!store)
        return Response.json({ error: "Unknown app" }, { status: 404 });
      const scope = {
        origin: url.origin,
        userId: "user",
        namespace,
        epoch: "one",
      };
      const headers = { "X-Sync-Scope": JSON.stringify(scope) };
      if (url.pathname.endsWith("/sync/v3/state"))
        return Response.json(scope, { headers });
      if (url.pathname.endsWith("/pull-stream")) {
        const records = [...store.values()].sort(
          (a, b) => a.serverSeq - b.serverSeq,
        );
        async function* pages() {
          yield { records, cursor: serverSeq, head: serverSeq, hasMore: false };
        }
        return new Response(createSyncPullStream(pages()), {
          headers: { ...headers, "Content-Type": "application/x-ndjson" },
        });
      }
      if (url.pathname.endsWith("/sync/v3/push")) {
        const { changes } = (await request.json()) as {
          changes: SyncPushChange[];
        };
        const problem =
          namespace === "arctic" &&
          (await linkChangesProblem(changes, new Map(store)));
        if (problem)
          return Response.json(
            { error: `Not allowed for a CLI credential: ${problem}` },
            { status: 403 },
          );
        const device = request.headers.get("X-Device-ID")!;
        return Response.json(
          {
            results: changes.map((change) => {
              const stored = store.get(change.key);
              const newer =
                !stored || compareSyncHlc(change.hlc, stored.hlc) > 0;
              return {
                accepted: newer,
                winner: newer ? put(namespace, change, device) : stored,
              };
            }),
          },
          { headers },
        );
      }
      const file = /\/files\/(xxh64:[a-f0-9]{16})$/.exec(url.pathname)?.[1];
      if (file && request.method === "PUT") {
        files.set(file, new Uint8Array(await request.arrayBuffer()));
        return Response.json({ id: file }, { headers });
      }
      return new Response("", { status: 404 });
    },
  });
  return { server, stores, files, requests, put };
}

const identity = (url: string) =>
  createHash("sha256").update(url).digest("hex");
const words = (count: number) =>
  `<p>${Array.from({ length: count }, (_, index) => `word${index}`).join(" ")}</p>`;
const value = (record: SyncRecord | undefined) => JSON.parse(record!.value);

/** The phone's three records for an article, as it keeps them. */
async function phoneArticle(url: string, library: Record<string, unknown>) {
  const id = await articleId(url);
  return [
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
        automatic: [],
        generation: "0F8B2E0C-6E44-4A55-9B3C-0D6D5C6B7A10",
        manual: [],
        names: [],
        rejected: [],
        url,
      }),
    },
  ];
}

test("wb arctic save writes the web's records, restores History, keeps saved links, and uploads text by the copy rules", async () => {
  const api = fakeAPI();
  const origin = api.server.url.origin;
  const now = toSwift(Date.now());
  const seed = (
    namespace: string,
    records: { key: string; value: string; isDeleted?: boolean }[],
  ) =>
    records.forEach((record, counter) =>
      api.put(
        namespace,
        {
          ...record,
          isDeleted: record.isDeleted ?? false,
          schemaVersion: 1,
          hlc: { wallTimeMs: Date.now() - 60_000, counter },
        },
        "iphone",
      ),
    );
  const saved = "https://example.com/saved";
  const visited = "https://example.com/visited";
  const removed = "https://example.com/removed";
  seed("arctic", [
    ...(await phoneArticle(saved, { saved: true, savedAt: now - 100 })),
    ...(await phoneArticle(visited, { saved: false, lastVisitedAt: now - 50 })),
    ...(await phoneArticle(removed, { saved: true, savedAt: now - 80 })).map(
      (record) => ({ ...record, isDeleted: true }),
    ),
  ]);
  seed("arctic-content", [
    {
      key: `content/${await articleId(saved)}`,
      value: encodeSorted({ url: saved, words: 500 }),
    },
  ]);

  // Arctic's extractor, replaced: what each page gives.
  const pages: Record<
    string,
    {
      title: string;
      html?: string;
      words?: number;
      byline?: string;
      problem?: string;
      preview?: LinkPreview;
    }
  > = {
    "https://example.com/notes/sea-ice": {
      title: "  How sea ice\n keeps time ",
      html: words(300),
      words: 300,
      byline: "Ada Reader",
      preview: {
        title: "How sea ice keeps time",
        subtitle: "Ice keeps time.",
        imageURL: "https://example.com/ice.jpg",
        faviconURL: "https://example.com/favicon.ico",
      },
    },
    [visited]: {
      title: "Visited",
      html: words(50),
      words: 50,
      preview: {
        subtitle: "Not the phone's",
        imageURL: "https://example.com/visited.jpg",
      },
    },
    [removed]: { title: "", problem: "PDF" },
    "https://www.nytimes.com/2026/10/26/ice.html": {
      title: "Ice, Paywalled",
      words: 210,
      problem: "paywall preview",
      preview: { imageURL: "https://static01.nyt.com/ice.jpg" },
    },
  };
  const read: string[] = [];
  const reader = {
    read: async (url: string) => (read.push(url), pages[url]!),
    close: async () => {},
  };
  const results: LinkResult[] = [];
  try {
    await arctic({
      command: "save",
      origin,
      token: "fixture",
      text: true,
      read: reader,
      onResult: (result) => results.push(result),
      inputs: [
        "HTTPS://Example.com:443/notes/sea-ice#top",
        visited,
        saved,
        removed,
        "https://www.nytimes.com/2026/10/26/ice.html",
        "not a link",
        "example.com/notes/sea-ice",
      ],
    });
    expect(
      results.map((result) => [
        result.status,
        result.text,
        result.reason ?? null,
        result.words ?? null,
      ]),
    ).toEqual([
      ["saved", "uploaded", null, 300],
      ["restored", "none", "too short", 50],
      ["already saved", "kept", "has text", 500],
      ["saved", "none", "PDF", null],
      ["saved", "none", "paywall preview", 210],
      ["invalid", "skipped", null, null],
      ["already saved", "kept", "has text", 300],
    ]);
    // The page's preview fills what each link lacks; a link the phone
    // described keeps its description.
    expect(results.map((result) => result.preview ?? null)).toEqual([
      ["image", "icon", "description"],
      ["image"],
      null,
      null,
      ["image"],
      null,
      null,
    ]);
    // A saved link with text, and a repeat, are not read again.
    expect(read).toEqual([
      "https://example.com/notes/sea-ice",
      visited,
      removed,
      "https://www.nytimes.com/2026/10/26/ice.html",
    ]);

    // A new link: the web's three records, with the page's title, or its host.
    const arcticRecords = api.stores.get("arctic")!;
    for (const [url, title] of [
      ["https://example.com/notes/sea-ice", "How sea ice keeps time"],
      [removed, "example.com"],
      ["https://www.nytimes.com/2026/10/26/ice.html", "Ice, Paywalled"],
    ] as const) {
      const id = await articleId(url);
      const savedAt = value(arcticRecords.get(`library/${id}`)).savedAt;
      expect(savedAt).toBeGreaterThanOrEqual(now);
      for (const record of newLinkRecords(url, id, { title, savedAt })) {
        const preview = pages[url]?.preview;
        expect(arcticRecords.get(record.key)!.value).toBe(
          (record.key.startsWith("article/") &&
            preview &&
            withPreview(record.value, preview)) ||
            record.value,
        );
        expect(arcticRecords.get(record.key)!.isDeleted).toBe(false);
      }
    }
    // A link from History: saved again as a field edit; nothing else changes.
    const visitedId = await articleId(visited);
    const original = (
      await phoneArticle(visited, { saved: false, lastVisitedAt: now - 50 })
    )[1]!.value;
    const restored = arcticRecords.get(`library/${visitedId}`)!;
    expect(restored.value).toBe(
      savedLibrary(original, value(restored).savedAt),
    );
    expect(value(arcticRecords.get(`article/${visitedId}`))).toEqual({
      imageURL: "https://example.com/visited.jpg",
      subtitle: "From the phone",
      title: "Kept",
      url: visited,
    });
    expect(
      value(arcticRecords.get(`library/${await articleId(saved)}`)).savedAt,
    ).toBe(now - 100);

    // Only the copy that passed the rules was uploaded, file first.
    const contentRecords = api.stores.get("arctic-content")!;
    const copy = value(
      contentRecords.get(
        `content/${await articleId("https://example.com/notes/sea-ice")}`,
      ),
    );
    expect(copy).toMatchObject({
      url: "https://example.com/notes/sea-ice",
      words: 300,
      byline: "Ada Reader",
      format: "html",
      source: "extractor",
    });
    expect(new TextDecoder().decode(api.files.get(copy.file))).toBe(words(300));
    expect(api.files.size).toBe(1);
    expect(contentRecords.size).toBe(2);
    expect(
      api.requests.indexOf(`PUT /api/apps/arctic-content/files/${copy.file}`),
    ).toBeLessThan(
      api.requests.lastIndexOf("POST /api/apps/arctic-content/sync/v3/push"),
    );

    // wb arctic text looks again, and replaces a copy only when it is 30% longer.
    pages[saved] = { title: "Saved", html: words(600), words: 600 };
    pages[visited] = { title: "Visited", html: words(800), words: 800 };
    const text = await arctic({
      command: "text",
      origin,
      token: "fixture",
      text: true,
      read: reader,
      inputs: [saved, visited, "https://example.com/never-saved"],
    });
    expect(
      text.map((result) => [result.status, result.text, result.words ?? null]),
    ).toEqual([
      ["already saved", "kept", 500],
      ["already saved", "uploaded", 800],
      ["not in library", "skipped", null],
    ]);
    expect(text[2]!.error).toContain("wb arctic save");

    // Every request was one of the few that wb arctic may make.
    for (const line of api.requests)
      expect(line).toMatch(
        /^(GET \/api\/apps\/(arctic|arctic-content)\/sync\/v3\/(state|pull-stream)|POST \/api\/apps\/(arctic|arctic-content)\/sync\/v3\/push|PUT \/api\/apps\/arctic-content\/files\/xxh64:[a-f0-9]{16})$/,
      );
    const send = arcticFetch(origin, "fixture");
    for (const [path, method] of [
      ["/api/apps/reader/sync/v3/push", "POST"],
      ["/api/apps/arctic-annotations/sync/v3/push", "POST"],
      ["/api/apps/arctic-content/files/xxh64:0000000000000000", "DELETE"],
      ["/api/cli/revoke", "POST"],
    ])
      await expect(send(origin + path, { method })).rejects.toThrow("refused");
    await expect(
      send("https://api.zsheng.app/api/apps/arctic/sync/v3/state"),
    ).rejects.toThrow("refused");
  } finally {
    api.server.stop(true);
  }
});

test("the wb command reads links from stdin, saves without text, and prints JSON", async () => {
  const api = fakeAPI();
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-cli-"));
  try {
    const child = Bun.spawn(
      [
        "bun",
        join(import.meta.dirname, "../src/cli.ts"),
        "arctic",
        "save",
        "--no-text",
        "--json",
        "--origin",
        api.server.url.origin,
        "--data-dir",
        directory,
      ],
      {
        stdin: new TextEncoder().encode(
          "https://example.com/one\n\nnot-a-link https://example.com/two\n",
        ),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WORKBENCH_TOKEN: "fixture" },
      },
    );
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(1);
    const results = JSON.parse(output) as LinkResult[];
    expect(
      results.map((result) => [
        result.input,
        result.status,
        result.text,
        result.title ?? null,
      ]),
    ).toEqual([
      ["https://example.com/one", "saved", "skipped", "example.com"],
      ["not-a-link", "invalid", "skipped", null],
      ["https://example.com/two", "saved", "skipped", "example.com"],
    ]);
    expect(api.files.size).toBe(0);
    expect(api.stores.get("arctic")!.size).toBe(6);
    // An expired or revoked credential says what to do.
    const expired = Bun.spawn(
      [
        "bun",
        join(import.meta.dirname, "../src/cli.ts"),
        "arctic",
        "save",
        "https://example.com/three",
        "--origin",
        api.server.url.origin,
        "--data-dir",
        directory,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WORKBENCH_TOKEN: "revoked" },
      },
    );
    expect(await expired.exited).toBe(1);
    expect(await new Response(expired.stderr).text()).toContain(
      "Run wb auth login",
    );
    // WORKBENCH_TOKEN stands in for the Keychain only on a loopback origin.
    const remote = Bun.spawn(
      [
        "bun",
        join(import.meta.dirname, "../src/cli.ts"),
        "arctic",
        "save",
        "https://example.com/three",
        "--origin",
        "https://sync.example.org",
        "--data-dir",
        directory,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, WORKBENCH_TOKEN: "fixture" },
      },
    );
    expect(await remote.exited).toBe(1);
    expect(await new Response(remote.stderr).text()).toContain("Not signed in");
  } finally {
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic backfill-previews reads saved links without a preview, reports, fills only with --apply, and resumes", async () => {
  const api = fakeAPI();
  const origin = api.server.url.origin;
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-previews-"));
  const now = toSwift(Date.now());
  // Newest first: two links from the web or wb, a page with nothing to
  // give, a page that fails; and links the backfill leaves alone: one with
  // the phone's image, one in History only, one removed.
  const link = async (
    url: string,
    library: Record<string, unknown>,
    article: Record<string, unknown> = {},
  ) => {
    const records = await phoneArticle(url, library);
    records[0]!.value = encodeSorted({ subtitle: "", title: "T", url, ...article });
    return records;
  };
  const urls = [1, 2, 3, 4, 5, 6, 7].map((n) => `https://example.com/${n}`);
  const seeded = [
    ...(await link(urls[0]!, { saved: true, savedAt: now - 1 })),
    ...(await link(urls[1]!, { saved: true, savedAt: now - 2 }, { subtitle: "The phone's" })),
    ...(await link(urls[2]!, { saved: true, savedAt: now - 3 })),
    ...(await link(urls[3]!, { saved: true, savedAt: now - 4 })),
    ...(await link(urls[4]!, { saved: true, savedAt: now - 5 }, { imageURL: "https://phone.example/5.jpg" })),
    ...(await link(urls[5]!, { saved: false, lastVisitedAt: now - 6 })),
    ...(await link(urls[6]!, { saved: true, savedAt: now - 7 })).map((record) => ({ ...record, isDeleted: true })),
  ];
  seeded.forEach((record, counter) =>
    api.put(
      "arctic",
      {
        ...record,
        isDeleted: (record as { isDeleted?: boolean }).isDeleted ?? false,
        schemaVersion: 1,
        hlc: { wallTimeMs: Date.now() - 60_000, counter },
      },
      "iphone",
    ),
  );
  const previews: Record<string, LinkPreview> = {
    [urls[0]!]: {
      title: "Ignored",
      subtitle: "One",
      imageURL: "https://example.com/1.jpg",
      faviconURL: "https://example.com/favicon.ico",
    },
    [urls[1]!]: { subtitle: "Not the phone's", imageURL: "https://example.com/2.jpg" },
    [urls[2]!]: {},
  };
  const asked: string[] = [];
  // The phone fetches its own preview while wb reads this link's page.
  let phoneMeanwhile: string | undefined;
  const read = {
    preview: async (url: string) => {
      asked.push(url);
      if (url === phoneMeanwhile) {
        const key = `article/${identity(url)}`;
        api.put(
          "arctic",
          {
            key,
            value: encodeSorted({
              ...JSON.parse(seeded.find((record) => record.key === key)!.value),
              imageURL: "https://phone.example/4.jpg",
            }),
            isDeleted: false,
            schemaVersion: 1,
            hlc: { wallTimeMs: Date.now(), counter: 0 },
          },
          "iphone",
        );
      }
      if (!previews[url]) throw Error("The publisher returned HTTP 503.");
      return previews[url]!;
    },
    close: async () => {},
  };
  const run = (apply: boolean, limit?: number) =>
    backfillPreviews({ origin, token: "fixture", directory, apply, limit, gapMs: 0, read });
  const statuses = (results: PreviewResult[]) =>
    results.map((result) => [result.url, result.status]);
  try {
    const before = JSON.stringify([...api.stores.get("arctic")!.entries()]);

    // A dry run reads the pages and writes nothing, on the server or here.
    const dry = await run(false);
    expect(dry.candidates).toBe(4);
    expect(statuses(dry.results)).toEqual([
      [urls[0], "would fill"],
      [urls[1], "would fill"],
      [urls[2], "nothing to fill"],
      [urls[3], "unreadable"],
    ]);
    expect(dry.results[0]!.fields).toEqual({
      image: "https://example.com/1.jpg",
      description: "One",
      icon: "https://example.com/favicon.ico",
    });
    expect(dry.results[1]!.fields).toEqual({ image: "https://example.com/2.jpg" });
    expect(dry.results[3]!.error).toBe("The publisher returned HTTP 503.");
    expect(JSON.stringify([...api.stores.get("arctic")!.entries()])).toBe(before);
    expect(api.requests.some((line) => line.startsWith("POST"))).toBe(false);
    expect(existsSync(join(directory, "arctic-previews.json"))).toBe(false);

    // --limit takes the newest; --apply fills them and notes each one.
    expect(statuses((await run(true, 1)).results)).toEqual([[urls[0], "filled"]]);
    expect(statuses((await run(true)).results)).toEqual([
      [urls[1], "filled"],
      [urls[2], "nothing to fill"],
      [urls[3], "unreadable"],
    ]);
    const stored = (url: string) =>
      articleId(url).then((id) => value(api.stores.get("arctic")!.get(`article/${id}`)));
    expect(await stored(urls[0]!)).toEqual({
      faviconURL: "https://example.com/favicon.ico",
      imageURL: "https://example.com/1.jpg",
      subtitle: "One",
      title: "T",
      url: urls[0],
    });
    expect(await stored(urls[1]!)).toMatchObject({
      imageURL: "https://example.com/2.jpg",
      subtitle: "The phone's",
    });
    // The rest keep their records: nothing to fill, a failure, the phone's
    // image, a link in History, and a removed one.
    for (const url of urls.slice(2)) {
      const key = `article/${identity(url)}`;
      expect(api.stores.get("arctic")!.get(key)!.value).toBe(
        seeded.find((record) => record.key === key)!.value,
      );
    }

    // A later run resumes: only the page that failed is read again. The
    // phone sets its own image meanwhile, so the server refuses wb's write,
    // made from the record before it, and the phone's image stays.
    asked.length = 0;
    previews[urls[3]!] = { imageURL: "https://example.com/4.jpg" };
    phoneMeanwhile = urls[3];
    const raced = await run(true);
    expect(statuses(raced.results)).toEqual([[urls[3], "refused"]]);
    expect(raced.results[0]!.error).toContain("a preview sets only");
    expect(asked).toEqual([urls[3]]);
    expect((await stored(urls[3]!)).imageURL).toBe("https://phone.example/4.jpg");
    // Now every saved link has a picture.
    expect((await run(false)).candidates).toBe(0);
  } finally {
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

const DAY = 24 * 60 * 60 * 1000;
/** What Arctic's extractor gives for a page (apps/arctic/Browser/scripts/text.ts). */
type Page = { title: string; html?: string; words?: number; problem?: string };

/** Puts the phone's records for each link in the fake API. */
async function seedLinks(
  api: ReturnType<typeof fakeAPI>,
  links: { url: string; library: Record<string, unknown>; removed?: boolean }[],
) {
  let counter = 0;
  for (const { url, library, removed = false } of links)
    for (const record of await phoneArticle(url, library))
      api.put(
        "arctic",
        {
          ...record,
          isDeleted: removed,
          schemaVersion: 1,
          hlc: { wallTimeMs: Date.now() - 60_000, counter: counter++ },
        },
        "iphone",
      );
}

test("wb arctic text --missing reads the newest saved links without text, up to the limit; a link that gives none doesn't stop the run", async () => {
  const api = fakeAPI();
  const origin = api.server.url.origin;
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-missing-"));
  const now = toSwift(Date.now());
  const link = (name: string) => `https://example.com/${name}`;
  // Oldest first, so the order read is the command's own.
  await seedLinks(api, [
    { url: link("over-limit"), library: { saved: true, savedAt: now - 6 } },
    { url: link("unwall"), library: { saved: true, savedAt: now - 5 } },
    { url: link("x-sign-in"), library: { saved: true, savedAt: now - 4 } },
    { url: link("bot-check"), library: { saved: true, savedAt: now - 3 } },
    { url: link("offline"), library: { saved: true, savedAt: now - 2 } },
    { url: link("article"), library: { saved: true, savedAt: now - 1 } },
    // Left alone: a link with text, a link in History, a removed link.
    { url: link("has-text"), library: { saved: true, savedAt: now } },
    { url: link("history"), library: { saved: false, lastVisitedAt: now } },
    {
      url: link("removed"),
      library: { saved: true, savedAt: now },
      removed: true,
    },
  ]);
  const content = async (name: string) =>
    `content/${await articleId(link(name))}`;
  api.put(
    "arctic-content",
    {
      key: await content("has-text"),
      value: encodeSorted({ url: link("has-text"), words: 500 }),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: Date.now() - 60_000, counter: 0 },
    },
    "iphone",
  );
  const pages: Record<string, Page> = {
    [link("article")]: { title: "Article", html: words(300), words: 300 },
    [link("bot-check")]: { title: "", problem: "browser check" },
    [link("x-sign-in")]: { title: "", problem: "X asks to sign in" },
    // Unwall could not open a listed site: the publisher's teaser.
    [link("unwall")]: { title: "", words: 210, problem: "paywall preview" },
  };
  const read: string[] = [];
  const reader = {
    read: async (url: string) => {
      read.push(url);
      if (!pages[url]) throw Error("Unable to connect");
      return pages[url];
    },
    close: async () => {},
  };
  try {
    const run = await fetchMissingText({
      origin,
      token: "fixture",
      directory,
      limit: 5,
      gapMs: 0,
      read: reader,
    });
    const chosen = ["article", "offline", "bot-check", "x-sign-in", "unwall"];
    expect(read).toEqual(chosen.map(link));
    expect(run.links).toEqual(chosen.map(link));
    expect(run.missing).toBe(6);
    const result = async (name: string, rest: Partial<LinkResult>) => ({
      input: link(name),
      url: link(name),
      id: await articleId(link(name)),
      status: "already saved",
      ...rest,
    });
    expect(run.results).toEqual([
      await result("article", { text: "uploaded", words: 300 }),
      await result("offline", {
        status: "failed",
        text: "skipped",
        error: "Unable to connect",
      }),
      await result("bot-check", { text: "none", reason: "browser check" }),
      await result("x-sign-in", { text: "none", reason: "X asks to sign in" }),
      await result("unwall", {
        text: "none",
        reason: "paywall preview",
        words: 210,
      }),
    ]);
    // Only the article's text was uploaded, and no link changed.
    expect(api.files.size).toBe(1);
    expect([...api.stores.get("arctic-content")!.keys()]).toEqual([
      await content("has-text"),
      await content("article"),
    ]);
    expect(api.requests).not.toContain("POST /api/apps/arctic/sync/v3/push");
    // The links that gave no text wait for their next try.
    expect(run.waiting).toBe(4);
    const state = JSON.parse(
      readFileSync(join(directory, "arctic-text.json"), "utf8"),
    );
    expect(Object.keys(state)).toEqual([origin]);
    expect(Object.keys(state[origin]).sort()).toEqual(
      (await Promise.all(chosen.slice(1).map((name) => articleId(link(name))))).sort(),
    );
  } finally {
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic text --missing: a link without text waits 1, 2, 4… up to 30 days, across runs and per API origin, until it gives text", async () => {
  const first = fakeAPI();
  const second = fakeAPI();
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-backoff-"));
  const url = "https://example.com/paper.pdf";
  const id = await articleId(url);
  for (const api of [first, second])
    await seedLinks(api, [
      { url, library: { saved: true, savedAt: toSwift(Date.now()) } },
    ]);
  let page: Page = { title: "", problem: "PDF" };
  let reads = 0;
  const read = { read: async () => (reads++, page), close: async () => {} };
  // Each run reads arctic-text.json afresh, as a new process does.
  const run = async (api: ReturnType<typeof fakeAPI>, at: number) => {
    setSystemTime(at);
    reads = 0;
    const { waiting } = await fetchMissingText({
      origin: api.server.url.origin,
      token: "fixture",
      directory,
      gapMs: 0,
      read,
    });
    return { reads, waiting };
  };
  const waiting = (api: ReturnType<typeof fakeAPI>) =>
    JSON.parse(readFileSync(join(directory, "arctic-text.json"), "utf8"))[
      api.server.url.origin
    ]?.[id];
  try {
    let at = Date.now();
    for (const [index, days] of [1, 2, 4, 8, 16, 30, 30].entries()) {
      expect(await run(first, at)).toEqual({ reads: 1, waiting: 1 });
      expect(waiting(first)).toEqual({
        tries: index + 1,
        retryAt: at + days * DAY,
      });
      // Until then, later runs leave it alone.
      expect(await run(first, at + days * DAY - 1)).toEqual({
        reads: 0,
        waiting: 1,
      });
      at += days * DAY;
    }
    // Another account's links have their own state.
    expect(await run(second, at - 1)).toEqual({ reads: 1, waiting: 1 });
    expect(waiting(second)).toEqual({ tries: 1, retryAt: at - 1 + DAY });
    // Text clears the wait.
    page = { title: "Paper", html: words(300), words: 300 };
    expect(await run(first, at)).toEqual({ reads: 1, waiting: 0 });
    expect(waiting(first)).toBeUndefined();
    expect(first.files.size).toBe(1);
    expect(waiting(second)).toEqual({ tries: 1, retryAt: at - 1 + DAY });
  } finally {
    setSystemTime();
    first.server.stop(true);
    second.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic text --missing reads one page a second", async () => {
  const api = fakeAPI();
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-gap-"));
  const now = toSwift(Date.now());
  await seedLinks(
    api,
    [1, 2].map((n) => ({
      url: `https://example.com/${n}`,
      library: { saved: true, savedAt: now - n },
    })),
  );
  const times: number[] = [];
  const read = {
    read: async () => (times.push(performance.now()), { title: "", problem: "PDF" }),
    close: async () => {},
  };
  try {
    await fetchMissingText({
      origin: api.server.url.origin,
      token: "fixture",
      directory,
      read,
    });
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(995);
  } finally {
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic text --missing keeps the process alive while a page is read, as while Playwright starts its browser", async () => {
  const api = fakeAPI();
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-awake-"));
  await seedLinks(api, [
    {
      url: "https://example.com/slow",
      library: { saved: true, savedAt: toSwift(Date.now()) },
    },
  ]);
  // Playwright's pipes don't keep Bun running; nor does an unref'd timer.
  // A top-level await would keep it running, so the run is a promise, as in
  // cli.ts.
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { fetchMissingText } from ${JSON.stringify(join(import.meta.dirname, "../src/arctic.ts"))};
const read = {
  read: () => new Promise((resolve) => setTimeout(() => resolve({ title: "", problem: "PDF" }), 200).unref()),
  close: async () => {},
};
fetchMissingText({ origin: process.argv[1], token: "fixture", directory: process.argv[2], read })
  .then((run) => console.log(run.results.map((result) => result.reason).join()));`,
      api.server.url.origin,
      directory,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  try {
    expect(await new Response(child.stdout).text()).toBe("PDF\n");
    expect(await child.exited).toBe(0);
  } finally {
    child.kill();
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic text --missing --dry-run --json lists the 25 links it would read, and reads and writes nothing", async () => {
  const api = fakeAPI();
  const origin = api.server.url.origin;
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-dry-"));
  const now = toSwift(Date.now());
  const urls = Array.from(
    { length: 27 },
    (_, n) => `https://example.com/${n}`,
  );
  await seedLinks(
    api,
    urls.map((url, n) => ({ url, library: { saved: true, savedAt: now - n } })),
  );
  // The newest waits for its next try, from an earlier run.
  const state = JSON.stringify({
    [origin]: {
      [await articleId(urls[0]!)]: { tries: 2, retryAt: Date.now() + DAY },
    },
  });
  writeFileSync(join(directory, "arctic-text.json"), state);
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dirname, "../src/cli.ts"),
      "arctic",
      "text",
      "--missing",
      "--dry-run",
      "--json",
      "--origin",
      origin,
      "--data-dir",
      directory,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WORKBENCH_TOKEN: "fixture" },
    },
  );
  try {
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    expect(JSON.parse(output)).toEqual({
      missing: 26,
      waiting: 1,
      links: urls.slice(1, 26),
      results: [],
    });
    expect(api.requests.filter((line) => !line.startsWith("GET "))).toEqual([]);
    expect(readFileSync(join(directory, "arctic-text.json"), "utf8")).toBe(state);
  } finally {
    child.kill();
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("wb arctic text --missing: the run's deadline stops a page that hangs and leaves the rest not tried; the read timeout fails it", async () => {
  const api = fakeAPI();
  const origin = api.server.url.origin;
  const directory = mkdtempSync(join(tmpdir(), "wb-arctic-deadline-"));
  const now = toSwift(Date.now());
  const link = (name: string) => `https://example.com/${name}`;
  await seedLinks(
    api,
    ["hangs", "pdf", "hangs-too"].map((name, n) => ({
      url: link(name),
      library: { saved: true, savedAt: now - n },
    })),
  );
  const read: string[] = [];
  const reader = {
    read: (url: string) => {
      read.push(url);
      return url === link("pdf")
        ? Promise.resolve({ title: "", problem: "PDF" })
        : new Promise<never>(() => {});
    },
    close: async () => {},
  };
  const outcomes = (results: LinkResult[]) =>
    results.map((result) => [
      result.input,
      result.status,
      result.error ?? result.reason ?? null,
    ]);
  const stateFile = join(directory, "arctic-text.json");
  try {
    // The deadline stops the page being read; no link is marked to wait.
    const started = performance.now();
    const stopped = await fetchMissingText({
      origin,
      token: "fixture",
      directory,
      gapMs: 0,
      deadlineMs: 300,
      read: reader,
    });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(read).toEqual([link("hangs")]);
    expect(outcomes(stopped.results)).toEqual([
      [link("hangs"), "not tried", null],
      [link("pdf"), "not tried", null],
      [link("hangs-too"), "not tried", null],
    ]);
    expect(existsSync(stateFile)).toBe(false);

    // A page that hangs fails at the read timeout and waits like any other.
    const timedOut = await fetchMissingText({
      origin,
      token: "fixture",
      directory,
      gapMs: 0,
      readTimeoutMs: 100,
      read: reader,
    });
    expect(outcomes(timedOut.results)).toEqual([
      [link("hangs"), "failed", "the page took over 0.1 s"],
      [link("pdf"), "already saved", "PDF"],
      [link("hangs-too"), "failed", "the page took over 0.1 s"],
    ]);
    expect(timedOut.waiting).toBe(3);
  } finally {
    api.server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  }
});
