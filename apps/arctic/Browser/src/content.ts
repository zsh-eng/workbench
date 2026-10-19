import DOMPurify from "dompurify";
// Publisher HTML is untrusted, even when copied from a native Reader cache.
export function cleanArticle(html: string, source: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const root =
    doc.querySelector("#reader-content") ??
    doc.querySelector("article") ??
    doc.body;
  root
    .querySelectorAll(
      "script,style,iframe,form,button,input,textarea,select,object,embed,link,meta,base,svg,math",
    )
    .forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    node.removeAttribute("style");
    node.removeAttribute("class");
    node.removeAttribute("srcset");
    for (const attr of ["href", "src", "poster"]) {
      const value = node.getAttribute(attr);
      if (!value) continue;
      try {
        const resolved = new URL(value, source);
        if (
          ["https:", "http:"].includes(resolved.protocol) ||
          (attr === "src" && /^data:image\/(png|jpeg|webp|gif);/i.test(value))
        )
          node.setAttribute(attr, resolved.href);
        else node.removeAttribute(attr);
      } catch {
        node.removeAttribute(attr);
      }
    }
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
  return DOMPurify.sanitize(root.innerHTML, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["iframe", "form", "input", "button"],
    FORBID_ATTR: ["style", "srcset"],
  });
}

/** Native bylines run the author into the date: "Ann Lee15 September 2026 · 8 min". */
export function cleanByline(value: string | undefined) {
  const text = (value ?? "")
    .replace(/\s*[·•|]\s*\d+\s*min.*$/i, "")
    .replace(
      /\s*(?:\d{1,2}\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{1,2},?)?\s+\d{4}.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 1 && text.length <= 200 ? text : undefined;
}

export function countWords(html: string) {
  const text =
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return text.split(/\s+/).filter(Boolean).length;
}

/** Normalized form shared by the copy files and the collect script. */
export function readCopyFile(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const root = doc.querySelector("article[data-arctic-url]");
  if (root)
    return {
      url: root.getAttribute("data-arctic-url")!,
      byline: root.getAttribute("data-arctic-byline") || undefined,
      body: root.innerHTML,
      extracted: true,
    };
  const link =
    doc
      .querySelector<HTMLLinkElement>('link[rel="canonical"]')
      ?.getAttribute("href") ||
    doc.querySelector('meta[property="og:url"]')?.getAttribute("content");
  return link ? { url: link, body: text, extracted: false } : null;
}
