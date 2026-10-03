import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { Extractor, type ExtractedArticle } from "./extractor";
import { DownloadError } from "./fetch";

export class DownloadService {
  private extractor: Extractor;
  private pending = new Map<string, Promise<ExtractedArticle>>();
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(
    private cacheDir: string,
    testOrigin?: string,
  ) {
    this.extractor = new Extractor(testOrigin);
  }
  async download(input: string) {
    const url = new URL(input);
    url.hash = "";
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      input.length > 8192
    )
      throw new DownloadError("Use a public http:// or https:// URL.", 400);
    const key = url.href;
    const filename = join(
      this.cacheDir,
      createHash("sha256").update(`defuddle-0.19.4-v1:${key}`).digest("hex") +
        ".json",
    );
    const start = performance.now();
    try {
      const cached = JSON.parse(
        await readFile(filename, "utf8"),
      ) as ExtractedArticle;
      if (
        typeof cached.html === "string" &&
        cached.downloadedAt > Date.now() - 7 * 86400000
      )
        return {
          ...cached,
          cacheHit: true,
          elapsedMs: Math.round(performance.now() - start),
        };
    } catch {
      /* Cold or expired cache. */
    }
    let work = this.pending.get(key);
    if (!work) {
      if (this.pending.size >= 32)
        throw new DownloadError(
          "The download queue is full. Try again shortly.",
          503,
        );
      work = (async () => {
        if (this.active >= 3)
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        else this.active++;
        try {
          const result = await this.extractor.extract(key);
          await mkdir(this.cacheDir, { recursive: true, mode: 0o700 });
          const temporary = filename + "." + randomUUID() + ".tmp";
          try {
            await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
            await rename(temporary, filename);
          } finally {
            await unlink(temporary).catch(() => {});
          }
          await this.prune().catch(() => {});
          return result;
        } finally {
          const next = this.waiters.shift();
          if (next) next();
          else this.active--;
        }
      })();
      this.pending.set(key, work);
      void work.finally(() => this.pending.delete(key)).catch(() => {});
    }
    return {
      ...(await work),
      cacheHit: false,
      elapsedMs: Math.round(performance.now() - start),
    };
  }
  private async prune() {
    const entries = await Promise.all(
      (await readdir(this.cacheDir))
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => ({
          name,
          ...(await stat(join(this.cacheDir, name))),
        })),
    );
    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let bytes = 0;
    for (const [index, entry] of entries.entries()) {
      bytes += entry.size;
      if (index >= 128 || bytes > 128 * 1024 * 1024)
        await unlink(join(this.cacheDir, entry.name)).catch(() => {});
    }
  }
  async close() {
    await this.extractor.close();
  }
}

export function createHandler(service: DownloadService, origins: string[]) {
  const allowed = new Set(origins);
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (!allowed.has(url.origin) || (origin && !allowed.has(origin)))
      return Response.json(
        { error: "Use the local Arctic app." },
        { status: 403 },
      );
    if (url.pathname === "/api/health" && request.method === "GET")
      return Response.json({ ok: true });
    if (url.pathname !== "/api/extract" || request.method !== "POST")
      return new Response("Not found", { status: 404 });
    if (
      request.headers.get("x-arctic-request") !== "1" ||
      !request.headers.get("content-type")?.startsWith("application/json")
    )
      return Response.json(
        { error: "Expected an Arctic JSON request." },
        { status: 400 },
      );
    try {
      const body = await request.text();
      if (body.length > 10000)
        throw new DownloadError("Request is too large.", 413);
      const { url: articleURL } = JSON.parse(body);
      if (typeof articleURL !== "string")
        throw new DownloadError("An article URL is required.", 400);
      const result = await service.download(articleURL);
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      const status =
        error instanceof DownloadError
          ? error.status
          : error instanceof TypeError || error instanceof SyntaxError
            ? 400
            : 502;
      return Response.json(
        {
          error:
            error instanceof DownloadError
              ? error.message
              : "The article could not be downloaded. Try again.",
        },
        { status },
      );
    }
  };
}
