import type { FileRead } from "../../shared/local-file";

/**
 * The URL for a Markdown image: https and small data images as written, and
 * relative paths through the host, which reads them from the document's
 * source. Absolute paths and other schemes stay unloaded.
 */
export function markdownImageUrl(
  raw: string,
  source: FileRead["source"],
  path: string,
  vault = false,
) {
  if (vault && raw.startsWith("med-vault:wiki:"))
    return `/api/vault/image?${new URLSearchParams({ document: path, href: decodeURIComponent(raw.replace(/^med-vault:wiki:/, "")), syntax: "wiki" })}`;
  if (/^https?:\/\//i.test(raw)) {
    const url = new URL(raw);
    return url.origin !== location.origin ? url.href : undefined;
  }
  if (
    /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z\d+/=\s]+$/i.test(raw) &&
    raw.length < 2_000_000
  )
    return raw;
  if (source.kind === "drop" || /^(?:[a-z][\w+.-]*:|\/)/i.test(raw)) return;
  if (vault)
    return `/api/vault/image?${new URLSearchParams({ document: path, href: raw, syntax: "markdown" })}`;
  return `/api/markdown/image?${new URLSearchParams({ source: JSON.stringify(source), document: path, href: raw })}`;
}
