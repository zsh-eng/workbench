import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ServerResponse } from "node:http";
import type { BrowseSource } from "../shared/browse";
import { readBrowse } from "./repository/browse";
import { HostError } from "./runtime/errors";

export const mediaHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
};

/** Single byte ranges keep native video seeking bounded. No full-file buffer. */
export async function serveMedia(
  response: ServerResponse,
  source: BrowseSource,
  path: string,
  identity: string | null,
  range: string | undefined,
  head: boolean,
  signal: AbortSignal,
  assertAccess: () => void,
) {
  const file = await readBrowse(source, path, signal);
  if (!file.media)
    throw new HostError("unsupported-media", file.reason ?? "This file has no media preview.", 422);
  if (identity && identity !== file.identity)
    throw new HostError("file-changed", "Refresh this file to view its latest media.", 409);
  let start = 0,
    end = file.size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      response.writeHead(416, { ...mediaHeaders, "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
    start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= file.size
    ) {
      response.writeHead(416, { ...mediaHeaders, "Content-Range": `bytes */${file.size}` });
      response.end();
      return;
    }
  }
  let stream: Readable | undefined;
  let close: (() => void) | undefined;
  if (!head && file.size) {
    if (source.kind === "worktree") {
      const handle = await open(
        resolve(source.repo, path),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await handle.stat();
        const current = await readBrowse(source, path, signal);
        if (
          !stat.isFile() ||
          current.identity !== file.identity ||
          !file.identity.endsWith(
            `:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`,
          )
        )
          throw new HostError(
            "file-changed",
            "The media changed while opening. Refresh the file.",
            409,
          );
        stream = handle.createReadStream({ start, end, autoClose: true, highWaterMark: 64 * 1024 });
      } catch (error) {
        await handle.close();
        throw error;
      }
    } else {
      const oid = file.identity.split(":").at(-1)!;
      const child = spawn(
        "git",
        ["--no-optional-locks", "-c", "core.fsmonitor=false", "cat-file", "blob", oid],
        {
          cwd: source.repo,
          stdio: ["ignore", "pipe", "ignore"],
          env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        },
      );
      const exited = new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      void exited.catch(() => {});
      const timer = setTimeout(() => child.kill(), 120_000);
      timer.unref();
      close = () => {
        clearTimeout(timer);
        child.kill();
      };
      stream = Readable.from(
        (async function* () {
          let offset = 0;
          try {
            for await (const chunk of child.stdout) {
              const bytes = chunk as Buffer;
              const left = Math.max(0, start - offset),
                right = Math.min(bytes.length, end + 1 - offset);
              offset += bytes.length;
              if (right > left) yield bytes.subarray(left, right);
              if (offset > end) return;
            }
            if ((await exited) !== 0 || offset < end + 1)
              throw new Error("Incomplete Git media stream");
          } finally {
            close?.();
          }
        })(),
      );
    }
  }
  try {
    assertAccess();
    response.writeHead(range ? 206 : 200, {
      ...mediaHeaders,
      "Content-Type": file.media.mime,
      "Content-Length": Math.max(0, end - start + 1),
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${file.size}` } : {}),
    });
    if (stream)
      await pipeline(
        stream,
        new Transform({
          transform(chunk, _encoding, done) {
            try {
              assertAccess();
              done(null, chunk);
            } catch (error) {
              done(error as Error);
            }
          },
        }),
        response,
        { signal },
      );
    else response.end();
  } finally {
    close?.();
    stream?.destroy();
  }
}
