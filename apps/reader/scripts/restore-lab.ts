/**
 * Restore lab: a new device signs in to a large library over a slow link.
 *
 * A local sync-server (`wrangler dev` in apps/sync-server, with BASE_URL set
 * to LAB_API and LAB_APP_ORIGIN among APP_ORIGINS) holds the accounts. This
 * script serves it and a Reader build over HTTPS and HTTP/2, as production
 * does, with latency and a shared bandwidth on the API, and seeds one account
 * per library size. A Reader build with `VITE_SHARED_API_URL=$LAB_API` then
 * runs the production path: the namespaced client, the pull stream and the
 * file API.
 *
 *   node scripts/restore-lab.ts proxy         # 5522 -> 5521 API, 5523 -> 5526 app
 *   bun scripts/restore-lab.ts seed large     # small | medium | large
 *
 * The proxy runs in Node: Bun's HTTP/2 server does not fall back to
 * HTTP/1.1, which the agent kit's server check uses.
 *
 * The API proxy delays every request by LAB_RTT_MS (40), each authenticated
 * request by LAB_SERVER_MS more (150), and shares LAB_MBPS (50) across all
 * responses. These are estimates, not measurements: production reads the
 * session, the scope and D1 for each request. For scale, the first pull of
 * Reader's 1,115 records from production took 0.585 s on the user's
 * connection (apps/sync-backup/BENCHMARKS.md). The pull stream's pages come
 * as fast as local D1 reads them. The certificate is self-signed: the browser
 * must ignore certificate errors (`test/e2e/kit/restore-lab-device.ts`).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import path from "node:path";
import { encode as encodeBlurHash } from "blurhash";
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import xxhash from "xxhash-wasm";

export const LAB_APP_ORIGIN = "https://localhost:5523";
export const LAB_API = "https://localhost:5522";
const API_UPSTREAM = process.env.LAB_API_UPSTREAM ?? "http://127.0.0.1:5521";
const APP_UPSTREAM = process.env.LAB_APP_UPSTREAM ?? "http://127.0.0.1:5526";
const CACHE = path.resolve(
  import.meta.dirname,
  "../node_modules/.cache/restore-lab",
);
const SAMPLE_EPUB = path.resolve(
  import.meta.dirname,
  "../test/fixtures/sample.epub",
);

/** A local test account per size; the password is for the local server only. */
export const labAccount = (size: LabSize) => ({
  email: `${size}@restore-lab.test`,
  password: "restore-lab-password",
  name: `Restore lab (${size})`,
});

/**
 * Library sizes. `medium` has the shape of a real library: about 40 books,
 * 12 of them being read, with EPUBs of about 10 MB. `large` has hundreds of
 * books and thousands of highlights and sessions.
 */
export const LAB_SIZES = {
  small: { books: 8, highlights: 40, sessions: 30, notes: 2, reading: 2 },
  medium: { books: 40, highlights: 600, sessions: 500, notes: 11, reading: 12 },
  large: {
    books: 300,
    highlights: 5000,
    sessions: 3000,
    notes: 100,
    reading: 20,
  },
} as const;
export type LabSize = keyof typeof LAB_SIZES;
const EPUB_BYTES = 10_000_000;

/** Every eighth book has no cover, as some EPUBs have none. */
export const hasCover = (index: number) => index % 8 !== 7;

if (import.meta.main) {
  const [command, size] = process.argv.slice(2);
  if (command === "proxy") proxy();
  else if (command === "seed" && size && size in LAB_SIZES)
    await seed(size as LabSize);
  else {
    console.error("usage: restore-lab.ts proxy | seed small|medium|large");
    process.exit(64);
  }
}

function certificate() {
  mkdirSync(CACHE, { recursive: true });
  const key = path.join(CACHE, "key.pem");
  const cert = path.join(CACHE, "cert.pem");
  if (!existsSync(cert))
    spawnSync("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "365",
      "-keyout",
      key,
      "-out",
      cert,
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ]);
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

function proxy() {
  const rttMs = Number(process.env.LAB_RTT_MS ?? 40);
  const serverMs = Number(process.env.LAB_SERVER_MS ?? 150);
  const mbps = Number(process.env.LAB_MBPS ?? 50);
  const bytesPerMs = (mbps * 1e6) / 8 / 1000;
  // One link: API responses share its bandwidth in the order their bytes arrive.
  let linkFreeAt = 0;
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  const tls = { ...certificate(), allowHTTP1: true };

  const forwardTo =
    (upstream: URL, shaped: boolean) =>
    async (
      request: http2.Http2ServerRequest,
      response: http2.Http2ServerResponse,
    ) => {
      const url = new URL(request.url, upstream);
      const body: Buffer[] = [];
      for await (const chunk of request as AsyncIterable<Buffer>)
        body.push(chunk);
      if (shaped) {
        const authenticated =
          request.method !== "OPTIONS" &&
          url.pathname.startsWith("/api/") &&
          url.pathname !== "/health";
        await sleep(rttMs + (authenticated ? serverMs : 0));
      }
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(
          ([name]) => !name.startsWith(":"),
        ),
      );
      const forward = http.request(
        url,
        {
          method: request.method,
          headers: { ...headers, host: upstream.host },
        },
        async (answer) => {
          // HTTP/2 has no connection-level headers.
          const {
            "transfer-encoding": _,
            connection: __,
            "keep-alive": ___,
            ...responseHeaders
          } = answer.headers;
          response.writeHead(answer.statusCode ?? 502, responseHeaders);
          try {
            for await (const chunk of answer as AsyncIterable<Buffer>) {
              if (shaped) {
                const now = performance.now();
                linkFreeAt =
                  Math.max(now, linkFreeAt) + chunk.length / bytesPerMs;
                await sleep(linkFreeAt - now);
              }
              if (response.destroyed) break;
              response.write(chunk);
            }
            response.end();
          } catch {
            // The browser stopped reading, as it does at a stream's end.
            response.destroy();
          }
        },
      );
      forward.on("error", () => response.destroy());
      response.on("close", () => forward.destroy());
      forward.end(Buffer.concat(body));
    };

  // `localhost` can resolve to either loopback address.
  for (const host of ["127.0.0.1", "::1"]) {
    http2
      .createSecureServer(tls, forwardTo(new URL(API_UPSTREAM), true))
      .listen(5522, host);
    http2
      .createSecureServer(tls, forwardTo(new URL(APP_UPSTREAM), false))
      .listen(5523, host);
  }
  console.log(
    `Restore lab: API ${LAB_API} -> ${API_UPSTREAM} (${rttMs} ms + ` +
      `${serverMs} ms per request, ${mbps} Mbit/s); app ${LAB_APP_ORIGIN} -> ${APP_UPSTREAM}`,
  );
}

/**
 * Seeds one account, unless it already has records, straight to the server.
 */
async function seed(size: LabSize) {
  const profile = LAB_SIZES[size];
  const account = labAccount(size);
  const headers = {
    Origin: LAB_APP_ORIGIN,
    "Content-Type": "application/json",
  };
  let auth = await fetch(`${API_UPSTREAM}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body: JSON.stringify(account),
  });
  if (!auth.ok)
    auth = await fetch(`${API_UPSTREAM}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify(account),
    });
  if (!auth.ok)
    throw new Error(`Sign-in failed: ${auth.status} ${await auth.text()}`);
  const cookie = auth.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const api = `${API_UPSTREAM}/api/apps/reader`;
  const base = { Origin: LAB_APP_ORIGIN, Cookie: cookie };
  const scope = JSON.stringify(
    await (await fetch(`${api}/sync/v3/state`, { headers: base })).json(),
  );
  const device = "restore-lab-phone";
  const syncHeaders = { ...base, "X-Sync-Scope": scope, "X-Device-ID": device };
  const existing = await (
    await fetch(`${api}/sync/v3/pull?cursor=0&limit=1&excludeOwnDevice=false`, {
      headers: syncHeaders,
    })
  ).json();
  if (existing.records.length > 0) {
    console.log(`${account.email} already has records; nothing to seed.`);
    return;
  }

  const hasher = await xxhash();
  const upload = async (bytes: Uint8Array, mediaType: string) => {
    const fileId = `xxh64:${hasher.h64Raw(bytes).toString(16).padStart(16, "0")}`;
    const response = await fetch(`${api}/files/${fileId}`, {
      method: "PUT",
      headers: { ...base, "X-Sync-Scope": scope, "Content-Type": mediaType },
      body: bytes,
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    return fileId;
  };
  const covers = await makeCovers(profile.books);
  const coverRefs: ({ fileId: string; blurHash: string } | null)[] = [];
  for (let index = 0; index < profile.books; index++)
    coverRefs.push(
      hasCover(index)
        ? {
            fileId: await upload(
              readFileSync(covers[index]!.file),
              "image/webp",
            ),
            blurHash: covers[index]!.blurHash,
          }
        : null,
    );
  // The books being read have their EPUBs on the server: the Library
  // prefetches them. Other books' files are never fetched here.
  const sourceFileIds: string[] = [];
  for (let index = 0; index < profile.books; index++)
    sourceFileIds.push(
      index < profile.reading
        ? await upload(epubOfSize(`${size}-${index}`), "application/epub+zip")
        : `xxh64:${(0xb00c0000 + index).toString(16).padStart(16, "0")}`,
    );

  const now = Date.now();
  const day = 86_400_000;
  // A year of reading, oldest first, so every clock is in the past.
  let clock = now - 365 * day;
  const changes: object[] = [];
  const add = (table: string, row: { id: string }) => {
    clock += 1_000;
    changes.push({
      key: JSON.stringify([table, row.id]),
      value: JSON.stringify({ ...row, isDeleted: false }),
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: clock, counter: 0 },
    });
  };
  const bookId = (index: number) => `restore-lab-book-${index}`;
  const chapters = (index: number) => 12 + (index % 40);
  const words =
    "the of and a to in is was he for it with as his on be at by".split(" ");
  const text = (seed: number, length: number) =>
    Array.from(
      { length },
      (_, i) => words[(seed * 7 + i * 13) % words.length],
    ).join(" ");

  // The order of a real account moved to the shared server: highlights,
  // progress, sessions, statuses, then the books, so books arrive last.
  for (let index = 0; index < profile.highlights; index++) {
    const book = index % profile.books;
    add("highlights", {
      id: `restore-lab-highlight-${index}`,
      bookId: bookId(book),
      spineItemId: `chapter-${index % chapters(book)}`,
      startOffset: index * 31,
      endOffset: index * 31 + 120,
      selectedText: text(index, 24),
      textBefore: text(index + 1, 9),
      textAfter: text(index + 2, 9),
      color: ["yellow", "green", "blue", "pink"][index % 4],
      createdAt: clock,
    });
  }
  for (let index = 0; index < profile.books; index++) {
    if (index % 3 === 2) continue;
    add("readingCheckpoints", {
      id: `resume:${device}:${bookId(index)}`,
      bookId: bookId(index),
      deviceId: device,
      currentSpineIndex: 0,
      scrollProgress: (index * 17) % 100,
      lastRead: clock,
    });
  }
  for (let index = 0; index < profile.sessions; index++) {
    add("readingSessions", {
      id: `restore-lab-session-${index}`,
      bookId: bookId(index % profile.books),
      deviceId: device,
      readerInstanceId: `restore-lab-reader-${index}`,
      startedAt: clock - 1_200_000,
      endedAt: clock,
      lastActiveAt: clock,
      activeMs: 600_000 + (index % 20) * 30_000,
      startSpineIndex: 0,
      startScrollProgress: 10,
      endSpineIndex: 0,
      endScrollProgress: 40,
    });
  }
  for (let index = 0; index < profile.books; index++) {
    const status =
      index < profile.reading
        ? "reading"
        : index % 4 === 0
          ? "finished"
          : "want-to-read";
    add("readingState", {
      id: `restore-lab-state-${index}`,
      bookId: bookId(index),
      status,
      timestamp: clock,
      createdAt: clock,
    });
  }
  const sample = sampleStructure();
  for (let index = 0; index < profile.books; index++) {
    // The books being read are the sample EPUB, with its structure, so they open.
    const manifest =
      index < profile.reading
        ? sample.manifest
        : Array.from({ length: chapters(index) }, (_, chapter) => ({
            id: `chapter-${chapter}`,
            href: `OEBPS/Text/chapter-${String(chapter).padStart(3, "0")}.xhtml`,
            mediaType: "application/xhtml+xml",
          }));
    add("books", {
      id: bookId(index),
      sourceFileId: sourceFileIds[index],
      title: `${text(index, 2 + (index % 3)).replace(/^./, (c) => c.toUpperCase())} ${index + 1}`,
      author: `Author ${index % 57}`,
      fileSize: index < profile.reading ? EPUB_BYTES : 400_000 + index * 9_000,
      dateAdded: now - (profile.books - index) * day,
      metadata: {
        language: "en",
        publisher: "Restore Lab",
        description: text(index, 80),
      },
      manifest,
      spine:
        index < profile.reading
          ? sample.spine
          : manifest.map((item) => ({ idref: item.id })),
      toc: manifest.map((item, chapter) => ({
        label: `Chapter ${chapter + 1}: ${text(index + chapter, 5)}`,
        href: item.href,
      })),
      cover: coverRefs[index],
    });
  }
  for (let index = 0; index < profile.notes; index++) {
    add("notes", {
      id: `restore-lab-note-${index}`,
      bookId: bookId(index % profile.books),
      kind: "note",
      content: text(index, 30),
      anchor: {
        spineItemId: "chapter-1",
        startOffset: index * 40,
        endOffset: index * 40 + 30,
        textBefore: "",
        textAfter: "",
      },
      createdAt: clock,
      updatedAt: clock,
    });
  }

  // Pushes within the server's limits: 500 changes and 1 MiB per request.
  let batch: object[] = [];
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const response = await fetch(`${api}/sync/v3/push`, {
      method: "POST",
      headers: { ...syncHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ changes: batch }),
    });
    if (!response.ok)
      throw new Error(
        `Push failed: ${response.status} ${await response.text()}`,
      );
    batch = [];
    bytes = 0;
  };
  for (const change of changes) {
    const size = JSON.stringify(change).length + 1;
    if (batch.length === 500 || bytes + size > 900_000) await flush();
    batch.push(change);
    bytes += size;
  }
  await flush();
  console.log(
    `Seeded ${account.email}: ${changes.length} records, ` +
      `${coverRefs.filter(Boolean).length} covers, ${profile.reading} EPUBs.`,
  );
}

/** The sample EPUB's manifest and spine, as the importer stores them. */
function sampleStructure() {
  const opf = new TextDecoder().decode(
    unzipSync(readFileSync(SAMPLE_EPUB))["OEBPS/content.opf"],
  );
  const manifest = [
    ...opf.matchAll(
      /<item href="([^"]+)" id="([^"]+)" media-type="([^"]+)"(?: properties="([^"]+)")?\/>/g,
    ),
  ].map(([, href, id, mediaType, properties]) => ({
    id: id!,
    href: `OEBPS/${href}`,
    mediaType: mediaType!,
    ...(properties ? { properties } : {}),
  }));
  const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(
    ([, idref]) => ({ idref: idref! }),
  );
  return { manifest, spine };
}

/** The sample EPUB under its own identifier, padded to a typical size. */
function epubOfSize(name: string): Uint8Array {
  const entries = unzipSync(readFileSync(SAMPLE_EPUB));
  const opf = "OEBPS/content.opf";
  entries[opf] = strToU8(
    new TextDecoder()
      .decode(entries[opf])
      .replace(
        /<dc:identifier id="id">[^<]*</,
        `<dc:identifier id="id">urn:restore-lab:${name}<`,
      ),
  );
  // Images make most of a real EPUB's bytes; random bytes do not compress.
  const padding = new Uint8Array(EPUB_BYTES);
  for (let offset = 0; offset < padding.length; offset += 65_536)
    crypto.getRandomValues(padding.subarray(offset, offset + 65_536));
  const { mimetype, ...rest } = entries;
  const zip: Zippable = { mimetype: [mimetype!, { level: 0 }] };
  for (const [entry, content] of Object.entries(rest)) zip[entry] = content;
  zip["OEBPS/images/plates.bin"] = [padding, { level: 0 }];
  return zipSync(zip);
}

/** 480 px WebP covers of about 40 KB, like the importer's, made once. */
async function makeCovers(count: number) {
  mkdirSync(CACHE, { recursive: true });
  const run = (args: string[]) =>
    new Promise<Buffer>((resolve, reject) => {
      const child = spawn("magick", args);
      const chunks: Buffer[] = [];
      child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks))
          : reject(new Error(`magick exited ${code}`)),
      );
    });
  const covers: { file: string; blurHash: string }[] = [];
  const pending = Array.from({ length: count }, (_, index) => index);
  const work = async () => {
    for (
      let index = pending.shift();
      index !== undefined;
      index = pending.shift()
    ) {
      const file = path.join(CACHE, `cover-${index}.webp`);
      const hue = (index * 47) % 360;
      if (!existsSync(file))
        await run([
          "-seed",
          String(index),
          "-size",
          "480x720",
          `gradient:hsl(${hue},55%,35%)-hsl(${(hue + 60) % 360},45%,20%)`,
          "(",
          "-size",
          "480x720",
          "plasma:fractal",
          ")",
          "-compose",
          "overlay",
          "-composite",
          "-attenuate",
          "0.3",
          "+noise",
          "Gaussian",
          "-fill",
          "white",
          "-pointsize",
          "44",
          "-gravity",
          "north",
          "-annotate",
          "+0+120",
          `Book ${index + 1}`,
          "-quality",
          "80",
          file,
        ]);
      const pixels = await run([
        file,
        "-resize",
        "32x48!",
        "-depth",
        "8",
        "rgba:-",
      ]);
      covers[index] = {
        file,
        blurHash: encodeBlurHash(new Uint8ClampedArray(pixels), 32, 48, 4, 3),
      };
    }
  };
  await Promise.all(Array.from({ length: 8 }, work));
  return covers;
}
