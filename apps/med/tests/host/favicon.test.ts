import { expect, test } from "vitest";
import { createFavicons } from "../../src/host/favicon";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A small web: each URL's response, and the address of each name. */
function web(pages: Record<string, () => Response>, addresses: Record<string, string>) {
  const requested: string[] = [];
  const favicons = createFavicons({
    fetch: (async (input: URL) => {
      requested.push(input.href);
      return pages[input.href]?.() ?? new Response("Not found", { status: 404 });
    }) as typeof fetch,
    lookup: async (host) => {
      if (!addresses[host]) throw new Error("No such host");
      return [{ address: addresses[host] }];
    },
  });
  return { favicons, requested };
}

test("a site's icon comes from its favicon.ico, or from the icon its home page names", async () => {
  const { favicons, requested } = web(
    {
      "https://plain.dev/favicon.ico": () => new Response(PNG),
      "https://named.dev/": () =>
        new Response(
          '<html><head><link rel="mask-icon" href="/mask.svg"><link rel="icon" href="/static/icon.png?v=1&amp;x=2"></head></html>',
        ),
      "https://cdn.named.dev/static/icon.png?v=1&x=2": () => new Response(PNG),
      "https://named.dev/static/icon.png?v=1&x=2": () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.named.dev/static/icon.png?v=1&x=2" },
        }),
    },
    {
      "plain.dev": "93.184.216.34",
      "named.dev": "93.184.216.35",
      "cdn.named.dev": "93.184.216.36",
    },
  );
  expect(await favicons.get("https://plain.dev/some/page")).toEqual({
    type: "image/png",
    bytes: PNG,
  });
  expect(await favicons.get("https://named.dev/docs")).toEqual({ type: "image/png", bytes: PNG });
  // Each host's icon is fetched once.
  await favicons.get("https://plain.dev/other");
  expect(requested.filter((url) => url === "https://plain.dev/favicon.ico")).toHaveLength(1);
});

test("the host never asks an address, a local name, or a name on a private network", async () => {
  const { favicons, requested } = web(
    {
      "https://public.dev/favicon.ico": () =>
        new Response(null, {
          status: 301,
          headers: { location: "https://router.public.dev/favicon.ico" },
        }),
      "https://text.dev/favicon.ico": () => new Response("<html>not an icon</html>"),
    },
    {
      "public.dev": "93.184.216.34",
      "router.public.dev": "192.168.1.1",
      "intranet.corp.dev": "10.0.0.5",
      "mapped.dev": "::ffff:127.0.0.1",
      "text.dev": "93.184.216.37",
    },
  );
  for (const origin of [
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost:3000",
    "https://printer.local",
    "https://intranet.corp.dev",
    "https://mapped.dev",
    "file:///etc/passwd",
  ])
    expect(await favicons.get(origin)).toBeUndefined();
  expect(requested).toEqual([]);
  // A redirect to a private address stops there; a page that is not an icon is no icon.
  expect(await favicons.get("https://public.dev")).toBeUndefined();
  expect(await favicons.get("https://text.dev")).toBeUndefined();
  expect(requested.some((url) => url.includes("router.public.dev"))).toBe(false);
});
