import { lookup as resolveHost } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Site icons for the web links in an agent's replies. The page loads images
 * only from Med, so the host fetches each site's icon and keeps it while it
 * runs. It fetches only from public HTTPS hosts: never an address, a local
 * name, or a name that resolves to a loopback or private network. Each hop of
 * a redirect is checked the same way. The address can still change between
 * the check and the request; the icon only shows as an image.
 */
export interface Favicon {
  type: string;
  bytes: Buffer;
}
type Lookup = (host: string) => Promise<{ address: string }[]>;

const MAX_ICON = 128 * 1024;
const MAX_PAGE = 512 * 1024;
const TIMEOUT = 4000;
const MAX_REDIRECTS = 3;
const MAX_ENTRIES = 512;
/** A site without an icon is asked again after this long. */
const RETRY = 60 * 60 * 1000;
const LOCAL = /(?:^|\.)(?:localhost|local|internal|intranet|lan|home\.arpa|test|example|invalid)$/i;

export function createFavicons({
  fetch: request = fetch,
  lookup = (host) => resolveHost(host, { all: true }),
}: { fetch?: typeof fetch; lookup?: Lookup } = {}) {
  const kept = new Map<string, { icon?: Favicon; at: number }>();
  const running = new Map<string, Promise<Favicon | undefined>>();

  const allowed = async (host: string) => {
    if (!host.includes(".") || host.startsWith("[") || isIP(host) || LOCAL.test(host)) return false;
    try {
      const addresses = await lookup(host);
      return addresses.length > 0 && addresses.every(({ address }) => isPublic(address));
    } catch {
      return false;
    }
  };

  /** A response body up to `limit` bytes, after redirects to allowed hosts. */
  const read = async (start: URL, limit: number) => {
    let url = start;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== "https:" || url.username || url.password) return;
      if (!(await allowed(url.hostname))) return;
      const response = await request(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { accept: "image/*, text/html;q=0.9, */*;q=0.5" },
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        return;
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > limit) {
        await response.body.cancel();
        return;
      }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > limit) return;
        chunks.push(chunk);
      }
      return { url, bytes: Buffer.concat(chunks) };
    }
  };

  const image = async (url: URL): Promise<Favicon | undefined> => {
    const body = await read(url, MAX_ICON);
    const type = body && imageType(body.bytes);
    return type ? { type, bytes: body.bytes } : undefined;
  };

  const find = async (host: string) => {
    // The usual path first, then the icons that the home page names.
    const icon = await image(new URL(`https://${host}/favicon.ico`)).catch(() => undefined);
    if (icon) return icon;
    const page = await read(new URL(`https://${host}/`), MAX_PAGE).catch(() => undefined);
    if (!page) return;
    for (const href of iconLinks(page.bytes.toString("utf8"))) {
      let url: URL;
      try {
        url = new URL(href, page.url);
      } catch {
        continue;
      }
      const found = await image(url).catch(() => undefined);
      if (found) return found;
    }
  };

  return {
    /** The icon of a web origin's host, or nothing for a host Med does not ask. */
    get(origin: string): Promise<Favicon | undefined> {
      let host: string;
      try {
        const url = new URL(origin);
        if (url.protocol !== "https:" && url.protocol !== "http:")
          return Promise.resolve(undefined);
        host = url.hostname.toLowerCase();
      } catch {
        return Promise.resolve(undefined);
      }
      const known = kept.get(host);
      if (known && (known.icon || Date.now() - known.at < RETRY))
        return Promise.resolve(known.icon);
      const current = running.get(host);
      if (current) return current;
      const next = find(host)
        .catch(() => undefined)
        .then((icon) => {
          kept.delete(host);
          kept.set(host, { icon, at: Date.now() });
          while (kept.size > MAX_ENTRIES) kept.delete(kept.keys().next().value!);
          return icon;
        })
        .finally(() => running.delete(host));
      running.set(host, next);
      return next;
    },
  };
}

/** The type of an icon from its first bytes; anything else is not an icon. */
function imageType(bytes: Buffer) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x52, 0x49, 0x46, 0x46) && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return "image/webp";
  const head = bytes.subarray(0, 1024).toString("utf8").trimStart();
  if (/^(?:﻿)?(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head))
    return "image/svg+xml";
}

/** The icons that a page names, in its order. A mask icon is one color only. */
function iconLinks(html: string) {
  const links: string[] = [];
  for (const [tag] of html.slice(0, MAX_PAGE).matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    if (!/\bicon\b/.test(rel) || /mask-icon/.test(rel) || !href) continue;
    links.push((href[1] ?? href[2] ?? href[3]!).replaceAll("&amp;", "&"));
    if (links.length === 4) break;
  }
  return links;
}

/** A public unicast address: not loopback, private, link-local, shared, or reserved. */
function isPublic(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const value = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) return isPublic(mapped[1]!);
  return !(
    value === "::" ||
    value === "::1" ||
    /^f[cd]/.test(value) ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("ff") ||
    value.startsWith("64:ff9b:") ||
    value.startsWith("2001:db8:")
  );
}
