import { expect, test } from "bun:test";
import {
  canonicalURL,
  cleanPreview,
  encodeSorted,
  readPreview,
  withPreview,
} from "./index";

const page = "https://news.example/2026/10/sea-ice?ref=feed";

test("reads the phone's tags in the phone's order, relative to the final URL", () => {
  const html = `<!doctype html><html><head>
    <meta charset="utf-8">
    <title>Fallback title</title>
    <meta name="twitter:title" content="Twitter title">
    <META PROPERTY="og:title" CONTENT="How sea ice keeps time">
    <meta name="description" content="The page's own description.">
    <meta property="og:description" content="  Ice   records
      the seasons.  ">
    <meta name="twitter:image" content="https://cdn.example/twitter.jpg">
    <meta property="og:image" content="../images/ice.jpg?w=1200&amp;h=630#crop">
    <link rel="stylesheet" href="/site.css">
    <link rel="apple-touch-icon" href="//static.example/touch.png">
    <link rel="icon" href="/favicon.png">
  </head><body><meta property="og:image" content="/body.jpg"></body></html>`;
  expect(readPreview(html, page)).toEqual({
    title: "How sea ice keeps time",
    subtitle: "Ice records the seasons.",
    imageURL: "https://news.example/2026/images/ice.jpg?w=1200&h=630",
    faviconURL: "https://static.example/touch.png",
  });
});

test("falls back tag by tag, and to /favicon.ico when the page names no icon", () => {
  const html = `<head><title>The &lsquo;Polar&rsquo; night &amp; day</title>
    <meta name="description" content="">
    <meta name="twitter:description" content="From Twitter&#8217;s card &#x2014; caf&eacute;">
    <meta name="twitter:image" content="/card.png">
    <link rel="icon" href="data:image/svg+xml,<svg/>">
    <link rel="shortcut icon" href="">`;
  expect(readPreview(html, "http://Example.org:8080/a/b")).toEqual({
    title: "The ‘Polar’ night & day",
    subtitle: "From Twitter’s card — café",
    imageURL: "http://example.org:8080/card.png",
    faviconURL: "http://example.org:8080/favicon.ico",
  });
});

test("names that are not character references stay as written", () => {
  expect(
    readPreview(
      "<title>Ice &constructor; &toString; &hasOwnProperty; &copy=1 &amp news</title>",
      page,
    ).title,
  ).toBe("Ice &constructor; &toString; &hasOwnProperty; &copy=1 & news");
});

test("a page without tags has only its fallback icon; markup in scripts and comments is not read", () => {
  const html = `<html><head>
    <!-- <meta property="og:image" content="/commented.jpg"> -->
    <script>document.write('<meta property="og:image" content="/scripted.jpg">');
      const s = "</head><body>";</script>
    <style>meta{}</style>
    <noscript><link rel="icon" href="/noscript.ico"></noscript>
  </head>`;
  expect(readPreview(html, page)).toEqual({
    faviconURL: "https://news.example/noscript.ico",
  });
  expect(readPreview("", page)).toEqual({
    faviconURL: "https://news.example/favicon.ico",
  });
  expect(readPreview("not html at all \u0000 %PDF-1.7", page)).toEqual({
    faviconURL: "https://news.example/favicon.ico",
  });
});

test("keeps only addresses the phone can decode, and text the phone can read", () => {
  const long = "https://cdn.example/" + "a".repeat(2100);
  const html = `<head>
    <meta property="og:title" content="Just a moment...">
    <meta property="og:description" content="\ud800${"ice".repeat(300)}">
    <meta property="og:image" content="javascript:alert(1)">
    <meta name="twitter:image" content="${long}">
    <link rel="icon" href="https://user:secret@cdn.example/icon.png">
    <link rel="icon" href="http://10.0.0.1/icon.png">
    <link rel="icon" href="https://cdn.example/a b|c.png">`;
  const preview = readPreview(html, page);
  // A challenge page's title is not the article's.
  expect(preview.title).toBeUndefined();
  expect(preview.imageURL).toBeUndefined();
  expect([...preview.subtitle!].length).toBe(500);
  expect(preview.subtitle).not.toMatch(/\p{Surrogate}/u);
  // Credentials and address literals are refused; spaces and | are escaped.
  expect(preview.faviconURL).toBe("https://cdn.example/a%20b%7Cc.png");
  expect(canonicalURL(preview.faviconURL!)).toBe(preview.faviconURL!);
});

test("reads a huge page's head and stops at the body", () => {
  const html =
    `<head><meta property="og:image" content="/lead.jpg">` +
    `<script>${"x".repeat(5_000_000)}</script></head><body>` +
    `<p>${"Sea ice. ".repeat(500_000)}</p><meta property="og:description" content="late">`;
  const started = performance.now();
  expect(readPreview(html, page)).toEqual({
    imageURL: "https://news.example/lead.jpg",
    faviconURL: "https://news.example/favicon.ico",
  });
  expect(performance.now() - started).toBeLessThan(500);
});

test("fills only empty preview fields of a record, and keeps every other field", () => {
  const url = "https://news.example/sea-ice";
  const preview = {
    title: "Ignored",
    subtitle: "Ice records the seasons.",
    imageURL: "https://news.example/ice.jpg",
    faviconURL: "https://news.example/favicon.ico",
  };
  // A web or wb link: no image, icon or description yet.
  expect(
    withPreview(encodeSorted({ subtitle: "", title: "Sea ice", url }), preview),
  ).toBe(
    encodeSorted({
      faviconURL: preview.faviconURL,
      imageURL: preview.imageURL,
      subtitle: preview.subtitle,
      title: "Sea ice",
      url,
    }),
  );
  // The phone's own fields stay, taggingText included.
  const phone = encodeSorted({
    imageURL: "https://phone.example/ice.jpg",
    subtitle: "The phone's description",
    taggingText: "Article excerpt: ...",
    title: "Sea ice",
    url,
  });
  expect(withPreview(phone, preview)).toBe(
    encodeSorted({ ...JSON.parse(phone), faviconURL: preview.faviconURL }),
  );
  expect(
    withPreview(
      encodeSorted({ ...JSON.parse(phone), faviconURL: "https://a.example/i" }),
      preview,
    ),
  ).toBeUndefined();
  expect(withPreview("[]", preview)).toBeUndefined();
});

test("an answer from elsewhere keeps only fields in the form readPreview writes", () => {
  expect(
    cleanPreview({
      title: "A\nB",
      subtitle: "One line",
      imageURL: "https://EXAMPLE.com/a.jpg",
      faviconURL: "https://example.com/i.png",
      extra: true,
    }),
  ).toEqual({ subtitle: "One line", faviconURL: "https://example.com/i.png" });
  expect(cleanPreview("nothing")).toEqual({});
});
