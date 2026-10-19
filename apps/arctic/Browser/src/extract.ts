/** Reader text from a whole page, with the same Defuddle version as the phone app. Loads on demand. */
export async function extractPage(html: string, url: string) {
  const { default: Defuddle } = await import("defuddle");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const base = doc.createElement("base");
  base.href = url;
  doc.head.prepend(base);
  const result = new Defuddle(doc, { url }).parse();
  return {
    body: result.content,
    byline: result.author || undefined,
    title: result.title,
  };
}
