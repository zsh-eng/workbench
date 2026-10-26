import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  articleId,
  encodeSorted,
  newLinkRecords,
  savedLibrary,
  toSwift,
} from "@workbench/arctic-links";
import {
  compareSyncHlc,
  createSyncPullStream,
  type SyncPushChange,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { arctic, arcticFetch, type LinkResult } from "../src/arctic";

/**
 * A shared API in miniature for `arctic` and `arctic-content`: scoped
 * state, a pull stream, pushes that keep the newer version, and text files.
 * It records every request, so a test sees all that wb sent.
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
    }
  > = {
    "https://example.com/notes/sea-ice": {
      title: "  How sea ice\n keeps time ",
      html: words(300),
      words: 300,
      byline: "Ada Reader",
    },
    [visited]: { title: "Visited", html: words(50), words: 50 },
    [removed]: { title: "", problem: "PDF" },
    "https://www.nytimes.com/2026/10/26/ice.html": {
      title: "Ice, Paywalled",
      words: 210,
      problem: "paywall preview",
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
        expect(arcticRecords.get(record.key)!.value).toBe(record.value);
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
    expect(value(arcticRecords.get(`article/${visitedId}`)).title).toBe("Kept");
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
