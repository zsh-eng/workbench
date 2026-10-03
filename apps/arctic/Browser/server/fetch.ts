import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
denied.addSubnet("2001::", 23, "ipv6");
denied.addSubnet("2001:db8::", 32, "ipv6");
denied.addSubnet("2002::", 16, "ipv6");
const publicAddress = (address: string, family: number) =>
  family === 4
    ? !denied.check(address, "ipv4")
    : globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
export const MAX_BYTES = 4 * 1024 * 1024;
export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
export type PageResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

// Pin every connection to a validated address. Redirects and browser subrequests
// use this same path, rather than doing a second unvalidated DNS lookup.
export async function fetchPage(
  input: string,
  signal: AbortSignal,
  testOrigin?: string,
): Promise<PageResponse> {
  let url = new URL(input);
  for (let redirects = 0; redirects <= 5; redirects++) {
    signal.throwIfAborted();
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      input.length > 8192
    )
      throw new DownloadError(
        "Use a public http:// or https:// article URL.",
        400,
      );
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await lookup(host, { all: true });
    signal.throwIfAborted();
    if (
      !addresses.length ||
      (url.origin !== testOrigin &&
        addresses.some((a) => !publicAddress(a.address, a.family)))
    )
      throw new DownloadError(
        "Only public article URLs can be downloaded.",
        400,
      );
    const address = addresses[0];
    const response = await new Promise<PageResponse>((resolve, reject) => {
      const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
        url,
        {
          signal,
          family: address.family,
          servername: host,
          lookup: (_host, options, done) => {
            if (options.all) done(null, [address]);
            else done(null, address.address, address.family);
          },
          headers: {
            Host: url.host,
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
            "Accept-Encoding": "identity",
          },
        },
        async (response) => {
          const status = response.statusCode ?? 502;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers))
            if (typeof value === "string") headers[key] = value;
          if (status >= 300 && status < 400 && headers.location) {
            response.destroy();
            resolve({ url: url.href, status, headers, body: Buffer.alloc(0) });
            return;
          }
          if (Number(headers["content-length"]) > MAX_BYTES) {
            response.destroy();
            reject(new DownloadError("This page is too large to download."));
            return;
          }
          const decoder =
            headers["content-encoding"] === "gzip"
              ? createGunzip()
              : headers["content-encoding"] === "br"
                ? createBrotliDecompress()
                : headers["content-encoding"] === "deflate"
                  ? createInflate()
                  : null;
          if (decoder) response.on("error", (error) => decoder.destroy(error));
          const stream = decoder ? response.pipe(decoder) : response;
          try {
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
              size += chunk.length;
              if (size > MAX_BYTES)
                throw new DownloadError("This page is too large to download.");
              chunks.push(Buffer.from(chunk));
            }
            delete headers["content-encoding"];
            delete headers["content-length"];
            delete headers["transfer-encoding"];
            delete headers["set-cookie"];
            resolve({
              url: url.href,
              status,
              headers,
              body: Buffer.concat(chunks),
            });
          } catch (error) {
            response.destroy();
            reject(error);
          }
        },
      );
      request.on("error", reject);
      request.end();
    });
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.location
    ) {
      url = new URL(response.headers.location, url);
      continue;
    }
    return response;
  }
  throw new DownloadError("The article redirected too many times.");
}
