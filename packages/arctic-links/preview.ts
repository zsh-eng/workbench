/**
 * A saved link's preview, read from its page as Arctic on iPhone reads it
 * (`ArticleMetadata.parse` in apps/arctic/Shared/ArticleMetadata.swift), in
 * the fields of its `article/<id>` record: `subtitle`, `imageURL` and
 * `faviconURL`, and the page's title. Arctic for the web (through the shared
 * API's preview route), `wb arctic save` and `wb arctic backfill-previews`
 * use this one copy, and the shared API checks wb's writes with it.
 *
 * The phone decodes `imageURL` and `faviconURL` as URLs and stops its whole
 * pull at a record it cannot read, so both are kept in `canonicalURL` form,
 * which Swift's URL decoder takes.
 */
import { canonicalURL, encodeSorted, linkTitle } from "./links";

export type LinkPreview = {
  /** og:title, twitter:title, then <title>. */
  title?: string;
  /** og:description, description, then twitter:description. */
  subtitle?: string;
  /** og:image, then twitter:image. */
  imageURL?: string;
  /** The first <link> whose rel has `icon` or `apple-touch-icon`, else /favicon.ico. */
  faviconURL?: string;
};

/** The record fields that a preview fills, and only when they are empty. */
export const PREVIEW_FIELDS = ["imageURL", "faviconURL", "subtitle"] as const;
export type PreviewField = (typeof PREVIEW_FIELDS)[number];

/** The longest image or icon address kept, in characters. */
export const MAX_PREVIEW_URL_LENGTH = 2048;
/** The longest description kept, in characters (code points). */
export const MAX_DESCRIPTION_CHARACTERS = 500;

/**
 * A page's description as a link's subtitle: one line of well-formed text,
 * without control characters, at most 500 characters.
 */
export function linkDescription(text: string) {
  return [
    ...text
      .replace(/\p{Surrogate}/gu, "")
      .replace(/\p{Cc}/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ]
    .slice(0, MAX_DESCRIPTION_CHARACTERS)
    .join("")
    .trim();
}

/**
 * An image or icon address from a page, resolved against the page's final
 * URL (after redirects), in the phone's canonical form. Undefined when it is
 * not a public http or https address the phone can decode.
 */
export function previewURL(value: string, pageURL: string) {
  let url: URL;
  try {
    url = new URL(value.trim(), pageURL);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const canonical = canonicalURL(url.href);
  return canonical && canonical.length <= MAX_PREVIEW_URL_LENGTH
    ? canonical
    : undefined;
}

// A challenge or sign-in page names itself, not the article.
const NOT_A_TITLE =
  /^(just a moment|access denied|attention required|sign in|log in|verify you are human)/i;

/**
 * The preview of a page: its title, description, image and icon, from the
 * tags in its head, by the phone's rules. A field the page lacks is absent.
 */
export function readPreview(html: string, pageURL: string): LinkPreview {
  const head = scanHead(html);
  const meta = (names: string[]) => {
    for (const name of names) {
      const tag = head.metas.find(
        (attributes) =>
          attributes.get("property")?.toLowerCase() === name ||
          attributes.get("name")?.toLowerCase() === name,
      );
      const value = clean(decodeEntities(tag?.get("content") ?? ""));
      if (value) return value;
    }
    return "";
  };
  const preview: LinkPreview = {};
  const title = linkTitle(
    meta(["og:title", "twitter:title"]) || decodeEntities(head.title ?? ""),
  );
  if (title && !NOT_A_TITLE.test(title)) preview.title = title;
  const subtitle = linkDescription(
    meta(["og:description", "description", "twitter:description"]),
  );
  if (subtitle) preview.subtitle = subtitle;
  const image = meta(["og:image", "twitter:image"]);
  const imageURL = image ? previewURL(image, pageURL) : undefined;
  if (imageURL) preview.imageURL = imageURL;
  let faviconURL: string | undefined;
  for (const link of head.links) {
    const roles = (link.get("rel") ?? "").toLowerCase().split(/\s+/);
    const href = decodeEntities(link.get("href") ?? "");
    if (
      !href ||
      !(roles.includes("icon") || roles.includes("apple-touch-icon"))
    )
      continue;
    faviconURL = previewURL(href, pageURL);
    if (faviconURL) break;
  }
  faviconURL ??= previewURL("/favicon.ico", pageURL);
  if (faviconURL) preview.faviconURL = faviconURL;
  return preview;
}

const empty = (value: unknown) =>
  value === undefined ||
  value === null ||
  (typeof value === "string" && value.trim() === "");

/**
 * The preview fields that an article record lacks (absent, null or blank)
 * and the preview has. Fields the record has, such as the phone's own, are
 * never in it. Undefined when there is nothing to fill.
 */
export function previewPatch(
  article: Readonly<Record<string, unknown>>,
  preview: LinkPreview,
) {
  const patch: Partial<Record<PreviewField, string>> = {};
  for (const field of PREVIEW_FIELDS)
    if (empty(article[field]) && preview[field]) patch[field] = preview[field];
  return Object.keys(patch).length ? patch : undefined;
}

/**
 * An `article/<id>` record with its empty preview fields filled, in sorted
 * keys; every other field keeps its value. Undefined when nothing is empty
 * or the record is not an object.
 */
export function withPreview(value: string, preview: LinkPreview) {
  let article: unknown;
  try {
    article = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!article || typeof article !== "object" || Array.isArray(article))
    return undefined;
  const patch = previewPatch(article as Record<string, unknown>, preview);
  return patch && encodeSorted({ ...article, ...patch });
}

/** Why a preview field's value is not one this code writes, or undefined. */
export function previewFieldProblem(field: PreviewField, value: unknown) {
  if (field === "subtitle")
    return typeof value === "string" &&
      value &&
      linkDescription(value) === value
      ? undefined
      : `subtitle must be one line of well-formed text of at most ${MAX_DESCRIPTION_CHARACTERS} characters`;
  return typeof value === "string" &&
    value.length <= MAX_PREVIEW_URL_LENGTH &&
    canonicalURL(value) === value
    ? undefined
    : `${field} must be a canonical http or https URL of at most ${MAX_PREVIEW_URL_LENGTH} characters`;
}

/** The valid fields of a preview from elsewhere, such as the shared API's answer. */
export function cleanPreview(value: unknown): LinkPreview {
  if (!value || typeof value !== "object") return {};
  const input = value as Record<string, unknown>;
  const preview: LinkPreview = {};
  if (typeof input.title === "string" && linkTitle(input.title) === input.title)
    preview.title = input.title || undefined;
  for (const field of PREVIEW_FIELDS)
    if (!previewFieldProblem(field, input[field]))
      preview[field] = input[field] as string;
  return preview;
}

// ——— A head of HTML, as far as a preview needs it ———

/** Elements whose text is not markup: a "<meta" inside a script is not a tag. */
const RAW_TEXT = [
  "script",
  "style",
  "title",
  "textarea",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
];
const RAW_END = new Map(
  RAW_TEXT.map((name) => [
    name,
    new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi"),
  ]),
);
const TAG_NAME = /[A-Za-z][^\t\n\f\r />]*/y;
const ATTRIBUTE =
  /[\t\n\f\r /]*([^\t\n\f\r />=]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/y;

type Attributes = Map<string, string>;

/**
 * The <meta> and <link> tags and the <title> text of a document's head, in
 * order. It skips comments, doctypes and the text of raw-text elements, and
 * stops at </head> or <body>, as the head ends there.
 */
function scanHead(html: string) {
  const metas: Attributes[] = [];
  const links: Attributes[] = [];
  let title: string | undefined;
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open < 0) break;
    const next = html.charAt(open + 1);
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const end = html.indexOf(">", open);
      at = end < 0 ? html.length : end + 1;
      continue;
    }
    const closing = next === "/";
    TAG_NAME.lastIndex = open + (closing ? 2 : 1);
    const name = TAG_NAME.exec(html)?.[0].toLowerCase();
    if (!name) {
      at = open + 1;
      continue;
    }
    let position = TAG_NAME.lastIndex;
    if (closing) {
      if (name === "head") break;
      const end = html.indexOf(">", position);
      at = end < 0 ? html.length : end + 1;
      continue;
    }
    if (name === "body") break;
    const attributes: Attributes = new Map();
    for (;;) {
      ATTRIBUTE.lastIndex = position;
      const match = ATTRIBUTE.exec(html);
      if (!match || !match[0]) break;
      position = ATTRIBUTE.lastIndex;
      const key = match[1]!.toLowerCase();
      // The first of two equal attributes counts, as in a browser.
      if (!attributes.has(key))
        attributes.set(key, match[2] ?? match[3] ?? match[4] ?? "");
    }
    const end = html.indexOf(">", position);
    at = end < 0 ? html.length : end + 1;
    if (name === "meta") metas.push(attributes);
    else if (name === "link") links.push(attributes);
    const raw = RAW_END.get(name);
    if (raw) {
      raw.lastIndex = at;
      const close = raw.exec(html);
      const text = html.slice(at, close ? close.index : html.length);
      if (name === "title") title ??= text;
      at = close ? close.index : html.length;
    }
  }
  return { metas, links, title };
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** Character references that pages use in titles and descriptions. */
const NAMED = (): Record<string, string> => ({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  hellip: "…",
  bull: "•",
  prime: "′",
  Prime: "″",
  lsaquo: "‹",
  rsaquo: "›",
  trade: "™",
  euro: "€",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  OElig: "Œ",
  oelig: "œ",
  Scaron: "Š",
  scaron: "š",
  Yuml: "Ÿ",
  fnof: "ƒ",
  circ: "ˆ",
  tilde: "˜",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  zwnj: "‌",
  zwj: "‍",
  lrm: "‎",
  rlm: "‏",
  minus: "−",
  times: "×",
  divide: "÷",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  hearts: "♥",
  // Latin-1, U+00A0 to U+00FF, in order (HTML 4's names).
  ...Object.fromEntries(
    "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml"
      .split(" ")
      .map((name, index) => [name, String.fromCharCode(0xa0 + index)]),
  ),
});
let named: Record<string, string> | undefined;

// Windows-1252 for C1 references, as browsers read &#146; and the like.
const WINDOWS_1252 =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function codePoint(code: number) {
  if (code >= 0x80 && code <= 0x9f) return WINDOWS_1252[code - 0x80]!;
  if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
    return "�";
  return String.fromCodePoint(code);
}

/**
 * Decodes character references: numeric ones, and the named ones above. A
 * name without its semicolon is read only for the four that browsers read
 * so in attributes (`&amp`, `&lt`, `&gt`, `&quot`), and not before `=` or a
 * letter or digit, so a URL's `&copy=1` stays as written.
 */
export function decodeEntities(text: string) {
  if (!text.includes("&")) return text;
  const names = (named ??= NAMED());
  return text.replace(
    /&(?:#(\d{1,8});?|#[xX]([0-9a-fA-F]{1,7});?|([A-Za-z][A-Za-z0-9]{1,31})(;?))/g,
    (whole, decimal, hex, name, semicolon, offset: number, all: string) => {
      if (decimal) return codePoint(Number(decimal));
      if (hex) return codePoint(parseInt(hex, 16));
      if (semicolon) return Object.hasOwn(names, name) ? names[name]! : whole;
      const after = all.charAt(offset + whole.length);
      return ["amp", "lt", "gt", "quot"].includes(name) &&
        !/[=A-Za-z0-9]/.test(after)
        ? names[name]!
        : whole;
    },
  );
}
