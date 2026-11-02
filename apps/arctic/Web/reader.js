import Defuddle from "defuddle";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { isChallengePage, isChallengeText } from "@workbench/arctic-links";

// Unwall renders the article in a child document. Extract that document, not
// the surrounding controls. Normal sites use their top-level document.
globalThis.extractArticle = (xPayload = null) => {
  let source = document;
  if (location.hostname === "unwall.app" || location.hostname.endsWith(".unwall.app") ||
      (location.protocol === "file:" && document.querySelector('iframe[title="Article content"]'))) {
    source = document.querySelector('iframe[title="Article content"]')?.contentDocument;
    if (!source?.body?.innerText.trim()) {
      throw new Error("The article is not ready. Wait for it to load, then try Reader again.");
    }
  }
  if (xPayload !== null) {
    const url = new URL(source.baseURI);
    if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(url.hostname)) {
      throw new Error("X extraction requires an X article URL.");
    }
    const payload = JSON.parse(xPayload);
    if (payload.code !== 200 || !payload.tweet || !(payload.tweet.article?.content?.blocks?.length || payload.tweet.text)) {
      throw new Error("This X post is unavailable. Try the original website.");
    }
    // Reuse Defuddle's maintained rich X renderer. Native code supplies one
    // bounded HTTPS response; the page cannot make arbitrary API requests.
    const detached = document.implementation.createHTMLDocument("");
    return new Defuddle(detached, {
      url: url.href, useAsync: true,
      fetch: async () => new Response(xPayload, { status: 200, headers: { "Content-Type": "application/json" } }),
    }).parseAsync().then(result => cleanArticle(source, result, true));
  }
  return cleanArticle(source, new Defuddle(source, { url: source.baseURI, useAsync: false }).parse());
};

function cleanArticle(source, result, isX = false) {
  const content = DOMPurify.sanitize(result.content, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "button", "iframe", "style"],
    FORBID_ATTR: ["style", "srcset"],
  });
  const parsed = new DOMParser().parseFromString(content, "text/html");
  if (!isX && (isChallengePage(source.documentElement.outerHTML) || isChallengeText(parsed.body.textContent))) {
    throw new Error("The site showed a browser check instead of the article. Try opening the original page.");
  }
  if (parsed.body.textContent.trim().length < (isX ? 1 : 80)) {
    throw new Error("There is not enough article text on this page. Try opening the original page.");
  }
  // Resolve URLs before moving the article into a separate local document.
  for (const element of parsed.querySelectorAll("[href], [src]")) {
    for (const attribute of ["href", "src"]) {
      const value = element.getAttribute(attribute);
      if (!value || value.startsWith("#")) continue;
      try {
        const url = new URL(value, source.baseURI);
        if (["https:", "http:"].includes(url.protocol) || (source.location?.protocol === "file:" && url.protocol === "file:")) element.setAttribute(attribute, url.href);
        else element.removeAttribute(attribute);
      } catch { element.removeAttribute(attribute); }
    }
  }
  for (const image of parsed.querySelectorAll("img:not([src])")) image.remove();
  // Defuddle standardizes code and preserves language labels, but removes colours.
  for (const code of parsed.querySelectorAll("pre code")) {
    const language = code.dataset.language || code.dataset.lang || [...code.classList].find(c => c.startsWith("language-"))?.slice(9);
    if (language && hljs.getLanguage(language) && code.textContent.length < 50000) {
      code.innerHTML = hljs.highlight(code.textContent, { language }).value;
    }
  }
  const assetURL = value => {
    if (!value || typeof value !== "string") return "";
    try {
      const url = new URL(value, source.baseURI);
      return ["https:", "http:"].includes(url.protocol) || (source.location?.protocol === "file:" && url.protocol === "file:") ? url.href : "";
    } catch { return ""; }
  };
  const originalContent = parsed.body.innerHTML;
  const candidateImage = assetURL(result.image);
  const firstImage = parsed.querySelector("img");
  let hasLeadImage = false;
  if (firstImage) {
    const before = parsed.createRange();
    before.setStart(parsed.body, 0); before.setEndBefore(firstImage);
    const words = before.toString().trim().split(/\s+/).filter(Boolean).length;
    const width = Number(firstImage.getAttribute("width"));
    const height = Number(firstImage.getAttribute("height"));
    const isSmall = (width > 0 && width < 120) || (height > 0 && height < 80);
    hasLeadImage = words < 80 && !isSmall;
  }
  // Preserve editorial placement and captions. Never prepend a social preview
  // when the article already opens with an image, even if its URL is different.
  const alreadyInBody = [...parsed.images].some(img => img.src === candidateImage);
  const image = hasLeadImage || alreadyInBody ? "" : candidateImage;
  const heroCaption = "";
  const sourceHero = [...source.images].find(candidate => candidate.currentSrc === image || candidate.src === image);
  const width = Number(sourceHero?.naturalWidth || source.querySelector('meta[property="og:image:width"]')?.content);
  const height = Number(sourceHero?.naturalHeight || source.querySelector('meta[property="og:image:height"]')?.content);
  const hasRatio = Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const heroWidth = String(hasRatio ? width : 16);
  const heroHeight = String(hasRatio ? height : 9);
  let authorImage = "";
  // Only accept an image attached to a declared author in structured metadata.
  const nodes = Array.isArray(result.schemaOrgData) ? result.schemaOrgData : [result.schemaOrgData];
  for (const node of nodes.flatMap(node => node?.["@graph"] || [node])) {
    const author = Array.isArray(node?.author) ? node.author[0] : node?.author;
    const image = author?.image;
    authorImage = assetURL(typeof image === "string" ? image : image?.url);
    if (authorImage) break;
  }
  return {
    title: result.title || source.title, author: result.author || "",
    description: result.description || "", favicon: assetURL(result.favicon),
    image, authorImage, heroCaption, heroWidth, heroHeight, originalContent, content: parsed.body.innerHTML
  };
};
