import type { Context } from "hono";
import {
  canonicalURL,
  readPreview,
  type LinkPreview,
} from "@workbench/arctic-links";
import { digest } from "./cli-auth";
import type { AppEnv } from "./env";

/**
 * `POST /api/arctic/preview`: a saved link's title, description, image and
 * icon, for Arctic for the web, which cannot fetch another site. The Worker
 * fetches the page, reads its head with `readPreview` (the phone's rules,
 * shared with `wb arctic save`) and answers the fields; the web writes them
 * into its own record. Nothing is stored here.
 *
 * Only public pages: http or https, and for every hop (the link and each
 * redirect) every address of the host, from Cloudflare's DNS over HTTPS,
 * must be public. At most 5 redirects, 8 seconds and 1 MiB of HTML, read up
 * to `</head>`. A Worker cannot pin its connection to the checked address,
 * so a name that changes its answer between the check and the fetch could
 * still reach another address; Cloudflare does not route a Worker's
 * subrequests to private networks, which covers that gap.
 */

export const LIMITS = {
  bytes: 1024 * 1024,
  redirects: 5,
  timeoutMs: 8000,
  /** Previews per account per minute. */
  perMinute: 60,
};

export class PreviewError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 422 | 502 | 504,
  ) {
    super(message);
  }
}

/**
 * How the route reaches the network: page requests and DNS-over-HTTPS
 * queries. Tests replace it with local fixtures.
 */
export const network = {
  fetch: (request: Request) => fetch(request),
};

/** The phone's user agent (ArticleMetadata.fetch), so sites serve the same page. */
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

/** Every IPv4 and IPv6 address of a host name, from Cloudflare's DNS over HTTPS. */
async function resolve(host: string, signal: AbortSignal) {
  const ask = async (type: "A" | "AAAA") => {
    const response = await network.fetch(
      new Request(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { Accept: "application/dns-json" }, signal },
      ),
    );
    const answer = response.ok
      ? ((await response.json()) as {
          Status?: number;
          Answer?: { type?: number; data?: string }[];
        })
      : undefined;
    // 0 is an answer, 3 a name that does not exist.
    if (answer?.Status !== 0 && answer?.Status !== 3)
      throw new PreviewError("The site's address could not be checked.", 502);
    return (answer.Answer ?? [])
      .filter((record) => record.type === (type === "A" ? 1 : 28))
      .map((record) => String(record.data));
  };
  return (await Promise.all([ask("A"), ask("AAAA")])).flat();
}

function ipv4(text: string) {
  const parts = text.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part)))
    return undefined;
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255)
    ? ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>>
        0
    : undefined;
}

/** The eight groups of an IPv6 address, or undefined. */
function ipv6(text: string) {
  if (!/^[0-9a-f:.]+$/i.test(text)) return undefined;
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groups = (half: string) => {
    if (!half) return [];
    const parts = half.split(":");
    const last = parts.at(-1)!;
    const tail: number[] = [];
    if (last.includes(".")) {
      const v4 = ipv4(last);
      if (v4 === undefined) return undefined;
      parts.pop();
      tail.push(v4 >>> 16, v4 & 0xffff);
    }
    if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return undefined;
    return [...parts.map((part) => parseInt(part, 16)), ...tail];
  };
  const head = groups(halves[0]!);
  const tail = halves.length === 2 ? groups(halves[1]!) : [];
  if (!head || !tail) return undefined;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

// Not the public internet: this network, private, shared, loopback,
// link-local, protocol, documentation, benchmarking, 6to4 relay, multicast
// and reserved addresses. The same list as apps/arctic/Browser/server/fetch.ts.
const DENIED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Whether an address is on the public internet. IPv6 must be global
 * unicast (2000::/3), and not Teredo or other protocol space (2001::/23),
 * documentation (2001:db8::/32, 3fff::/20) or 6to4 (2002::/16), so mapped
 * and translated IPv4 addresses, unique local and link-local are refused.
 */
export function publicAddress(address: string) {
  const v4 = ipv4(address);
  if (v4 !== undefined)
    return !DENIED_V4.some(([network, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return ((v4 & mask) >>> 0) === ((ipv4(network)! & mask) >>> 0);
    });
  const v6 = ipv6(address);
  if (!v6) return false;
  const [first, second] = v6 as [number, number];
  return (
    (first & 0xe000) === 0x2000 &&
    !(first === 0x2001 && second < 0x0200) &&
    !(first === 0x2001 && second === 0x0db8) &&
    first !== 0x2002 &&
    !(first === 0x3fff && second < 0x1000)
  );
}

/**
 * Refuses a URL that is not a public http or https page. In local
 * development (`local`), only `localhost` and `*.localhost` pages are
 * fetched, so a local stack and its tests never reach the internet.
 */
async function checkHop(url: URL, local: boolean, signal: AbortSignal) {
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  )
    throw new PreviewError("Only http and https pages have previews.", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (local) {
    if (host === "localhost" || host.endsWith(".localhost")) return;
    throw new PreviewError(
      "Local development previews only *.localhost pages.",
      403,
    );
  }
  const literal = ipv4(host) !== undefined || host.includes(":");
  const addresses = literal ? [host] : await resolve(host, signal);
  if (!addresses.length)
    throw new PreviewError("The site's name does not resolve.", 422);
  if (!addresses.every(publicAddress))
    throw new PreviewError("Only public pages have previews.", 403);
}

/** The page's charset: the header's, then a <meta> in its first 1,024 bytes, then UTF-8. */
function decode(bytes: Uint8Array, contentType: string) {
  const sniffed = new TextDecoder().decode(bytes.subarray(0, 1024));
  const label =
    /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(sniffed)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** The start of the body, up to `</head>` or the byte limit, within the time limit. */
async function readHead(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  const stop = () => void reader?.cancel().catch(() => {});
  signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  // ASCII is enough to find the tag in any charset this reads.
  const scanner = new TextDecoder();
  let tail = "";
  try {
    while (reader && size < LIMITS.bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, LIMITS.bytes - size);
      chunks.push(part);
      size += part.byteLength;
      const text = tail + scanner.decode(part, { stream: true });
      if (/<\/head[\t\n\f\r />]/i.test(text)) break;
      tail = text.slice(-7);
    }
  } finally {
    signal.removeEventListener("abort", stop);
    await reader?.cancel().catch(() => {});
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decode(bytes, response.headers.get("Content-Type") ?? "");
}

/** Fetches a public page within the limits and reads its preview. */
export async function fetchPreview(
  input: string,
  local: boolean,
): Promise<LinkPreview> {
  const signal = AbortSignal.timeout(LIMITS.timeoutMs);
  let url = new URL(input);
  try {
    for (let redirects = 0; ; redirects++) {
      await checkHop(url, local, signal);
      const response = await network.fetch(
        new Request(url, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          },
        }),
      );
      const location = response.headers.get("Location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => {});
        if (redirects === LIMITS.redirects)
          throw new PreviewError("The page redirects too many times.", 422);
        url = new URL(location, url);
        continue;
      }
      const type = response.headers.get("Content-Type") ?? "";
      if (!response.ok || (type && !/^\s*(text\/html|application\/xhtml\+xml)\b/i.test(type))) {
        await response.body?.cancel().catch(() => {});
        throw new PreviewError(
          response.ok
            ? "This link is not a web page."
            : `The page answered HTTP ${response.status}.`,
          422,
        );
      }
      return readPreview(await readHead(response, signal), url.href);
    }
  } catch (error) {
    if (error instanceof PreviewError) throw error;
    if (signal.aborted)
      throw new PreviewError("The page took too long to answer.", 504);
    throw new PreviewError("The page could not be loaded.", 502);
  }
}

/**
 * The route, for a signed-in browser (`requireUser` refuses a wb
 * credential here). The body is `{"url": "<a link>"}`; the answer is the
 * preview's fields, any of which may be missing.
 */
export async function previewRoute(c: Context<AppEnv>) {
  const declared = Number(c.req.header("Content-Length") ?? 0);
  if (!(declared <= 4096))
    return c.json({ error: "The request is too large." }, 413);
  const text = await c.req.text();
  if (text.length > 4096)
    return c.json({ error: "The request is too large." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const input = (body as { url?: unknown } | undefined)?.url;
  const url = typeof input === "string" ? canonicalURL(input) : null;
  if (!url || url.length > 8192)
    return c.json({ error: "Send the link as {\"url\": \"https://…\"}." }, 400);
  // Per account and minute, in the rate-limit table the CLI routes use.
  const key = await digest(
    `preview:${c.get("user").id}:${Math.floor(Date.now() / 60_000)}`,
  );
  const row = await c.env.DATABASE.prepare(
    "INSERT INTO cli_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, Date.now() + 120_000)
    .first<{ count: number }>();
  if (row!.count === 1)
    await c.env.DATABASE.prepare("DELETE FROM cli_rate_limits WHERE expires_at < ?")
      .bind(Date.now())
      .run();
  if (row!.count > LIMITS.perMinute) {
    c.header("Retry-After", "60");
    return c.json({ error: "Too many previews. Try again in a minute." }, 429);
  }
  try {
    return c.json(
      await fetchPreview(url, c.env.LOCAL_DEVELOPMENT === "true"),
    );
  } catch (error) {
    if (error instanceof PreviewError)
      return c.json({ error: error.message }, error.status);
    throw error;
  }
}
