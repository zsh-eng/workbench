import { env } from "cloudflare:test";
import { afterEach, beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { fetchPreview, LIMITS, network, publicAddress } from "../src/preview";
import { credential, signedIn } from "./accounts";

const origin = "http://localhost:8792";
const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), env);

/**
 * A small internet for the Worker: Cloudflare's DNS over HTTPS, answering
 * from `dns` (a function answers each query again, as a rebinding name
 * does), and sites answering from `pages` by host and path. It records
 * every page request, so a test sees which addresses the Worker reached.
 */
let dns: Record<string, string[] | (() => string[])> = {};
let pages: Record<string, (request: Request) => Response> = {};
let visited: string[] = [];
const real = network.fetch;
beforeEach(() => {
  dns = {};
  pages = {};
  visited = [];
  network.fetch = async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "cloudflare-dns.com") {
      const name = url.searchParams.get("name")!;
      const type = url.searchParams.get("type");
      const entry = dns[name];
      const addresses = typeof entry === "function" ? entry() : entry;
      return Response.json({
        Status: addresses ? 0 : 3,
        Answer: (addresses ?? [])
          .filter((address) => address.includes(":") === (type === "AAAA"))
          .map((data) => ({ name, type: type === "AAAA" ? 28 : 1, data })),
      });
    }
    visited.push(`${url.host}${url.pathname}`);
    const handler = pages[`${url.host}${url.pathname}`];
    return handler ? handler(request) : new Response("Not found", { status: 404 });
  };
});
afterEach(() => {
  network.fetch = real;
});

const html = (body: string, type = "text/html; charset=utf-8") => () =>
  new Response(body, { headers: { "Content-Type": type } });
const redirect = (location: string, status = 301) => () =>
  new Response(null, { status, headers: { Location: location } });
const article = `<!doctype html><html><head><title>Sea ice</title>
  <meta property="og:description" content="Ice keeps time.">
  <meta property="og:image" content="/images/ice.jpg">
  <link rel="icon" href="icon.png"></head><body><p>Text</p></body></html>`;

/** The error a preview is refused with, and its status. */
const refusal = (url: string) =>
  fetchPreview(url, false).then(
    () => undefined,
    (error) => [error.status, error.message],
  );

it("follows redirects to a public page and reads it relative to its final URL", async () => {
  dns["news.example"] = ["93.184.216.34", "2606:2800:220:1::248"];
  dns["www.news.example"] = ["93.184.216.35"];
  pages["news.example/s/1"] = redirect("https://www.news.example/2026/sea-ice");
  pages["www.news.example/2026/sea-ice"] = html(article);
  expect(await fetchPreview("https://news.example/s/1", false)).toEqual({
    title: "Sea ice",
    subtitle: "Ice keeps time.",
    imageURL: "https://www.news.example/images/ice.jpg",
    faviconURL: "https://www.news.example/2026/icon.png",
  });
});

it("refuses private, loopback and link-local addresses, by name and as literals, on every hop", async () => {
  dns["intranet.example"] = ["10.1.2.3"];
  dns["mixed.example"] = ["93.184.216.34", "127.0.0.1"];
  dns["v6.example"] = ["fd00::1"];
  dns["public.example"] = ["93.184.216.34"];
  pages["public.example/to-literal"] = redirect("http://169.254.169.254/latest");
  pages["public.example/to-name"] = redirect("https://intranet.example/admin");
  pages["public.example/to-v6"] = redirect("http://[::ffff:7f00:1]/");
  for (const url of [
    "https://intranet.example/",
    "https://mixed.example/",
    "https://v6.example/",
    "http://127.0.0.1:8080/",
    "http://[::1]/",
    "https://public.example/to-literal",
    "https://public.example/to-name",
    "https://public.example/to-v6",
  ])
    expect(await refusal(url), url).toEqual([
      403,
      "Only public pages have previews.",
    ]);
  // Only the public redirects were fetched; no private address was reached.
  expect(visited).toEqual([
    "public.example/to-literal",
    "public.example/to-name",
    "public.example/to-v6",
  ]);
  expect(await refusal("https://nowhere.example/")).toEqual([
    422,
    "The site's name does not resolve.",
  ]);
  expect(await refusal("ftp://public.example/")).toEqual([
    400,
    "Only http and https pages have previews.",
  ]);
});

it("checks the name again on each hop, so a name that turns private is refused", async () => {
  // A rebinding name: public for the first check, loopback for the next.
  let asked = 0;
  dns["rebind.example"] = () => (asked++ < 2 ? ["93.184.216.34"] : ["127.0.0.1"]);
  pages["rebind.example/start"] = redirect("/again");
  pages["rebind.example/again"] = html(article);
  expect(await refusal("https://rebind.example/start")).toEqual([
    403,
    "Only public pages have previews.",
  ]);
  expect(visited).toEqual(["rebind.example/start"]);
});

it("stops after five redirects, and at pages that are not HTML or not there", async () => {
  dns["loop.example"] = ["93.184.216.34"];
  for (let hop = 0; hop < 7; hop++)
    pages[`loop.example/${hop}`] = redirect(`/${hop + 1}`, 302);
  expect(await refusal("https://loop.example/0")).toEqual([
    422,
    "The page redirects too many times.",
  ]);
  expect(visited).toHaveLength(6);

  let read = false;
  const body = new ReadableStream(
    {
      pull() {
        read = true;
      },
    },
    { highWaterMark: 0 },
  );
  pages["loop.example/paper.pdf"] = () =>
    new Response(body, { headers: { "Content-Type": "application/pdf" } });
  pages["loop.example/image"] = html("\x89PNG", "image/png");
  pages["loop.example/gone"] = () => new Response(article, { status: 410 });
  expect(await refusal("https://loop.example/paper.pdf")).toEqual([
    422,
    "This link is not a web page.",
  ]);
  expect(read).toBe(false);
  expect(await refusal("https://loop.example/image")).toEqual([
    422,
    "This link is not a web page.",
  ]);
  expect(await refusal("https://loop.example/gone")).toEqual([
    422,
    "The page answered HTTP 410.",
  ]);
});

it("reads at most 1 MiB of a huge page, and no further than its head", async () => {
  dns["huge.example"] = ["93.184.216.34"];
  // An endless page: a head without </head>, then filler for ever.
  let sent = 0;
  pages["huge.example/endless"] = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          const chunk =
            sent === 0
              ? `<meta property="og:image" content="/lead.jpg">`
              : "x".repeat(64 * 1024);
          sent += chunk.length;
          controller.enqueue(new TextEncoder().encode(chunk));
        },
      }),
      { headers: { "Content-Type": "text/html" } },
    );
  expect(await fetchPreview("https://huge.example/endless", false)).toEqual({
    imageURL: "https://huge.example/lead.jpg",
    faviconURL: "https://huge.example/favicon.ico",
  });
  expect(sent).toBeLessThan(LIMITS.bytes + 3 * 64 * 1024);

  // A head that ends early: the body is not read.
  let chunks = 0;
  pages["huge.example/short-head"] = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          chunks++;
          controller.enqueue(
            new TextEncoder().encode(
              chunks === 1
                ? `<head><meta name="description" content="Short"></HEAD >`
                : "<p>body</p>".repeat(10_000),
            ),
          );
        },
      }),
      { headers: { "Content-Type": "text/html" } },
    );
  expect(
    (await fetchPreview("https://huge.example/short-head", false)).subtitle,
  ).toBe("Short");
  expect(chunks).toBeLessThanOrEqual(2);
});

it("gives up on a page that takes too long", async () => {
  dns["slow.example"] = ["93.184.216.34"];
  pages["slow.example/"] = () =>
    new Response(new ReadableStream({ pull: () => new Promise(() => {}) }), {
      headers: { "Content-Type": "text/html" },
    });
  const timeout = LIMITS.timeoutMs;
  LIMITS.timeoutMs = 200;
  try {
    expect(await refusal("https://slow.example/")).toEqual([
      504,
      "The page took too long to answer.",
    ]);
  } finally {
    LIMITS.timeoutMs = timeout;
  }
});

it("knows public addresses", () => {
  for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700::1111"])
    expect(publicAddress(address), address).toBe(true);
  for (const address of [
    "10.0.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "2002:7f00:1::",
    "2001::1",
    "not an address",
    "1.2.3",
  ])
    expect(publicAddress(address), address).toBe(false);
});

it("answers a signed-in browser, refuses others, and limits each account", async () => {
  const preview = (
    body: unknown,
    headers: Record<string, string>,
    bindings = env,
  ) =>
    worker.fetch(
      new Request(`${origin}/api/arctic/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      bindings,
    );
  const session = await signedIn(call, origin);
  const cookie = { Cookie: session };
  const story = { url: "https://preview.localhost/story" };
  pages["preview.localhost/story"] = html(article);

  // A signed-in browser only: not a stranger, and not a wb credential.
  expect((await preview(story, {})).status).toBe(401);
  const token = await credential(call, session, origin);
  expect(
    (await preview(story, { Authorization: `Bearer ${token}` })).status,
  ).toBe(403);
  expect((await preview({ url: "not a link" }, cookie)).status).toBe(400);
  expect((await preview("{", cookie)).status).toBe(400);
  expect((await preview({ url: "x".repeat(5000) }, cookie)).status).toBe(413);

  // Local development previews only *.localhost pages: tests stay offline.
  const local = await preview({ url: `${story.url}#top` }, cookie);
  expect(local.status).toBe(200);
  expect(await local.json()).toEqual({
    title: "Sea ice",
    subtitle: "Ice keeps time.",
    imageURL: "https://preview.localhost/images/ice.jpg",
    faviconURL: "https://preview.localhost/icon.png",
  });
  expect(
    (await preview({ url: "https://news.example/story" }, cookie)).status,
  ).toBe(403);
  expect(visited).toEqual(["preview.localhost/story"]);

  // Production checks every address instead.
  const production = { ...env, LOCAL_DEVELOPMENT: "false" };
  dns["news.example"] = ["93.184.216.34"];
  pages["news.example/story"] = html(article);
  const answer = await preview(
    { url: "https://news.example/story" },
    cookie,
    production,
  );
  expect(answer.status).toBe(200);
  expect(await answer.json()).toMatchObject({
    imageURL: "https://news.example/images/ice.jpg",
  });
  expect((await preview(story, cookie, production)).status).toBe(422);

  // At most 60 previews a minute for each account (a minute that turns
  // during the loop starts a new count, so it may take a second round).
  let status = 200;
  for (let tries = 0; tries <= 2 * LIMITS.perMinute && status !== 429; tries++)
    status = (await preview(story, cookie)).status;
  expect(status).toBe(429);
  const other = { Cookie: await signedIn(call, origin) };
  expect((await preview(story, other)).status).toBe(200);
}, 60_000);
