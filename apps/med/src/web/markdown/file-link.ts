/** Resolve against the displayed document, never the browser's /review URL. */
export function relativeFileLink(document: string, href: string): { path: string; line?: number } {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href))
    throw new Error("Choose a relative file link.");
  const [pathname] = href.split(/[?#]/);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname!);
  } catch {
    throw new Error("This file link contains invalid URL encoding.");
  }
  // Reject control bytes in paths, including encoded NUL.
  // oxlint-disable-next-line no-control-regex
  if (!decoded || /[\\\u0000-\u001f]/.test(decoded) || decoded.startsWith("/"))
    throw new Error("This file link is not valid.");
  const absolute = document.startsWith("/");
  const parts = document.split("/").filter(Boolean);
  parts.pop();
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error("This link leaves the current file source.");
      parts.pop();
    } else parts.push(part);
  }
  if (!parts.length) throw new Error("Choose a file, not the source root.");
  const fragment = href.split("#")[1] ?? "";
  const match = /^L([1-9]\d*)(?:-L?[1-9]\d*)?$/i.exec(fragment);
  const line = match ? Number(match[1]) : undefined;
  return {
    path: `${absolute ? "/" : ""}${parts.join("/")}`,
    ...(line && Number.isSafeInteger(line) ? { line } : {}),
  };
}
