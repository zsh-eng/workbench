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
