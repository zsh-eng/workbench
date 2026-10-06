// Loopback data boundary for the moodboard.
// It serves the adopted snapshot, allowlisted source media, derived thumbnails,
// the built UI, and the user's favourites/tag edits. Nothing else is readable.

import { existsSync } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { gzipSync } from "bun";
import { TOPICS, type ItemDetail, type Topic, type UserEdit, type UserState } from "../shared/schema.ts";

export interface ServerOptions {
  libraryDir: string;
  distDir: string | null;
  port: number;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".vtt": "text/vtt; charset=utf-8",
  ".woff2": "font/woff2",
};
const IMMUTABLE = "private, max-age=31536000, immutable";

interface Snapshot {
  version: string;
  adoptedAt: string;
  library: Uint8Array<ArrayBuffer>;
  libraryGzip: Uint8Array<ArrayBuffer>;
  details: Record<string, ItemDetail>;
  postIds: Set<string>;
  sourcePath: string;
  allow: Record<string, { rev: string; bytes: number }>;
  report: unknown;
}

export function createApp(options: ServerOptions) {
  const { libraryDir, distDir, port } = options;
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  // The Vite dev server proxies to this server.
  for (const devPort of [5295]) {
    allowedOrigins.add(`http://127.0.0.1:${devPort}`);
    allowedOrigins.add(`http://localhost:${devPort}`);
  }

  // ------------------------------------------------------------ snapshot

  let snapshot: Snapshot | null = null;
  let pointerMtime = 0;
  let loading: Promise<Snapshot | null> | null = null;

  async function currentSnapshot(): Promise<Snapshot | null> {
    const pointer = join(libraryDir, "current.json");
    if (!existsSync(pointer)) return null;
    const info = await stat(pointer);
    if (snapshot && info.mtimeMs === pointerMtime) return snapshot;
    loading ??= (async () => {
      try {
        const { version, adoptedAt } = JSON.parse(await readFile(pointer, "utf8")) as { version: string; adoptedAt: string };
        if (snapshot?.version === version) {
          pointerMtime = info.mtimeMs;
          return snapshot;
        }
        const dir = join(libraryDir, "snapshots", version);
        const [library, details, media, report] = await Promise.all([
          readFile(join(dir, "library.json")),
          readFile(join(dir, "details.json"), "utf8"),
          readFile(join(dir, "media.json"), "utf8"),
          readFile(join(dir, "report.json"), "utf8"),
        ]);
        const parsedDetails = JSON.parse(details) as Record<string, ItemDetail>;
        const items = (JSON.parse(library.toString("utf8")) as { items: { postId: string }[] }).items;
        const { sourcePath, allow } = JSON.parse(media) as { sourcePath: string; allow: Snapshot["allow"] };
        const parsedReport = JSON.parse(report) as Record<string, unknown>;
        delete parsedReport.source; // absolute paths stay on the server
        snapshot = {
          version,
          adoptedAt,
          library: new Uint8Array(library),
          libraryGzip: gzipSync(new Uint8Array(library)) as Uint8Array<ArrayBuffer>,
          details: parsedDetails,
          postIds: new Set(items.map((i) => i.postId)),
          sourcePath,
          allow,
          report: parsedReport,
        };
        pointerMtime = info.mtimeMs;
        return snapshot;
      } catch (error) {
        console.error("Snapshot load failed; keeping the previous one.", error);
        return snapshot;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  // ------------------------------------------------------------ user state

  const statePath = join(libraryDir, "user-state.json");
  let state: UserState | null = null;
  let stateError: string | null = null;
  let writeChain: Promise<unknown> = Promise.resolve();

  async function loadState(): Promise<UserState> {
    if (state) return state;
    if (!existsSync(statePath)) {
      state = { revision: 0, favourites: {}, edits: {} };
      return state;
    }
    try {
      const parsed = JSON.parse(await readFile(statePath, "utf8")) as UserState;
      if (typeof parsed !== "object" || !parsed.favourites || !parsed.edits) throw new Error("Unexpected shape");
      state = parsed;
      stateError = null;
      return state;
    } catch (error) {
      // Never overwrite a file we cannot read: it may be the only copy.
      stateError = `user-state.json could not be read (${(error as Error).message}). Your edits were not changed.`;
      throw new Error(stateError);
    }
  }

  function mutate(change: (s: UserState) => void): Promise<UserState> {
    const next = writeChain.then(async () => {
      const current = await loadState();
      const draft = structuredClone(current);
      change(draft);
      draft.revision = current.revision + 1;
      const temp = `${statePath}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(draft, null, 1));
      await rename(temp, statePath);
      state = draft;
      return draft;
    });
    writeChain = next.catch(() => undefined);
    return next;
  }

  function cleanEdit(body: unknown): Omit<UserEdit, "editedAt"> | null {
    if (!body || typeof body !== "object") return null;
    const { topics, subtags } = body as { topics?: unknown; subtags?: unknown };
    if (!Array.isArray(topics)) return null;
    const validTopics = [...new Set(topics)].filter((t): t is Topic => (TOPICS as readonly string[]).includes(t as string));
    const cleanSubtags: Partial<Record<Topic, string[]>> = {};
    if (subtags && typeof subtags === "object") {
      for (const [topic, list] of Object.entries(subtags as Record<string, unknown>)) {
        if (!validTopics.includes(topic as Topic) || !Array.isArray(list)) continue;
        const tags = [...new Set(list.map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean))].slice(0, 12);
        if (tags.length) cleanSubtags[topic as Topic] = tags;
      }
    }
    return { topics: validTopics, subtags: cleanSubtags };
  }

  // ------------------------------------------------------------ responses

  const json = (data: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(data), {
      ...init,
      headers: { "content-type": TYPES[".json"], "cache-control": "no-store", ...(init.headers ?? {}) },
    });
  const problem = (status: number, message: string) => json({ error: message }, { status });

  function fileResponse(path: string, request: Request, headers: Record<string, string>) {
    const file = Bun.file(path);
    const size = file.size;
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const base = { ...headers, "content-type": type, "accept-ranges": "bytes" };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (match && (match[1] || match[2])) {
        const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start >= size || start > end) {
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        }
        return new Response(file.slice(start, end + 1), {
          status: 206,
          headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
        });
      }
    }
    if (request.method === "HEAD") return new Response(null, { headers: { ...base, "content-length": String(size) } });
    return new Response(file, { headers: base });
  }

  function insideRoot(root: string, relative: string): string | null {
    if (relative.includes("\0")) return null;
    const full = normalize(join(root, relative));
    return full.startsWith(normalize(root) + "/") ? full : null;
  }

  // ------------------------------------------------------------ routes

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? "";
    // Reject requests addressed to another name (DNS rebinding) and cross-site writes.
    if (!allowedHosts.has(host)) return problem(421, "Unknown host");
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && request.method !== "HEAD" && (!origin || !allowedOrigins.has(origin))) {
      return problem(403, "Cross-origin write refused");
    }
    const path = decodeURIComponent(url.pathname);

    if (path === "/api/version") {
      const snap = await currentSnapshot();
      if (!snap) return problem(503, "No library has been imported yet. Run: bun run import --source <folder>");
      return json({ version: snap.version, adoptedAt: snap.adoptedAt });
    }

    if (path === "/api/library") {
      const snap = await currentSnapshot();
      if (!snap) return problem(503, "No library has been imported yet. Run: bun run import --source <folder>");
      const etag = `"${snap.version}"`;
      const headers: Record<string, string> = {
        "content-type": TYPES[".json"],
        "cache-control": "no-cache",
        etag,
        vary: "accept-encoding",
      };
      if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
      if ((request.headers.get("accept-encoding") ?? "").includes("gzip")) {
        return new Response(snap.libraryGzip, { headers: { ...headers, "content-encoding": "gzip" } });
      }
      return new Response(snap.library, { headers });
    }

    if (path === "/api/info") {
      const snap = await currentSnapshot();
      if (!snap) return problem(503, "No library has been imported yet.");
      return json(snap.report);
    }

    const itemMatch = /^\/api\/items\/([a-zA-Z0-9_-]{1,64})$/.exec(path);
    if (itemMatch) {
      const snap = await currentSnapshot();
      const detail = snap?.details[itemMatch[1]];
      return detail ? json(detail, { headers: { "cache-control": "no-cache" } }) : problem(404, "Unknown item");
    }

    if (path === "/api/user-state") {
      try {
        return json(await loadState());
      } catch (error) {
        return problem(500, (error as Error).message);
      }
    }

    const favouriteMatch = /^\/api\/user-state\/favourites\/(\d{1,30})$/.exec(path);
    if (favouriteMatch && (request.method === "PUT" || request.method === "DELETE")) {
      const postId = favouriteMatch[1];
      try {
        const next = await mutate((s) => {
          if (request.method === "PUT") s.favourites[postId] = new Date().toISOString();
          else delete s.favourites[postId];
        });
        return json(next);
      } catch (error) {
        return problem(500, (error as Error).message);
      }
    }

    const editMatch = /^\/api\/user-state\/edits\/(\d{1,30})$/.exec(path);
    if (editMatch && (request.method === "PUT" || request.method === "DELETE")) {
      const postId = editMatch[1];
      let edit: Omit<UserEdit, "editedAt"> | null = null;
      if (request.method === "PUT") {
        edit = cleanEdit(await request.json().catch(() => null));
        if (!edit) return problem(400, "Expected { topics: string[], subtags: Record<topic, string[]> }");
      }
      try {
        const next = await mutate((s) => {
          if (edit) s.edits[postId] = { ...edit, editedAt: new Date().toISOString() };
          else delete s.edits[postId];
        });
        return json(next);
      } catch (error) {
        return problem(500, (error as Error).message);
      }
    }

    if (path.startsWith("/media/")) {
      const snap = await currentSnapshot();
      const relative = path.slice("/media/".length);
      const entry = snap?.allow[relative];
      if (!snap || !entry) return problem(404, "Not in the library");
      const full = insideRoot(snap.sourcePath, relative);
      if (!full || !existsSync(full)) return problem(404, "File not found in the archive");
      const cache = url.searchParams.get("v") === entry.rev ? IMMUTABLE : "no-cache";
      return fileResponse(full, request, { "cache-control": cache });
    }

    if (path.startsWith("/derived/")) {
      const name = path.slice("/derived/".length);
      if (!/^[a-f0-9]{16}-(?:\d{3,4}\.webp|frame\.jpg)$/.test(name)) return problem(404, "Unknown derivative");
      const full = join(libraryDir, "derived", name);
      if (!existsSync(full)) return problem(404, "Derivative missing; run the import again");
      return fileResponse(full, request, { "cache-control": IMMUTABLE });
    }

    if (path.startsWith("/api/")) return problem(404, "Unknown endpoint");

    // Built UI. Unknown paths fall back to index.html so /post/<id> deep links work.
    if (!distDir) return problem(404, "UI not built. Run: bun run build");
    const asset = path !== "/" ? insideRoot(distDir, path.slice(1)) : null;
    if (asset && existsSync(asset) && (await stat(asset)).isFile()) {
      const cache = path.startsWith("/assets/") ? IMMUTABLE : "no-cache";
      return fileResponse(asset, request, { "cache-control": cache });
    }
    const index = join(distDir, "index.html");
    if (!existsSync(index)) return problem(404, "UI not built. Run: bun run build");
    return fileResponse(index, request, { "cache-control": "no-cache" });
  };
}
