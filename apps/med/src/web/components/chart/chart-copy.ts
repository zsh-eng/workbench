import { resolveColor, standaloneSvg, svgPng } from "../../markdown/copy";

const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** An SVG text element in the look of `element` on the page. */
function textLike(element: Element | null, x: number, y: number, text = element?.textContent) {
  if (!element || !text) return "";
  const style = getComputedStyle(element);
  return `<text x="${x}" y="${y}" fill="${style.color}" font-family="${escape(style.fontFamily)}" font-size="${style.fontSize}" font-weight="${style.fontWeight}" dominant-baseline="hanging">${escape(text)}</text>`;
}

/**
 * The chart as a picture to paste elsewhere: its title, its key with the
 * values it shows, the plot, and where the data came from, on the chart's
 * surface at twice its size.
 */
export async function copyChart(frame: HTMLElement) {
  const plot = frame.querySelector<SVGSVGElement>("svg[data-chart-plot]");
  if (!plot) throw new Error("The chart has not drawn yet.");
  const drawn = standaloneSvg(plot);
  const pad = 20;
  const width = Math.round(drawn.width + 2 * pad);
  const parts: string[] = [];
  let y = pad;
  const title = frame.querySelector("[data-chart-title]");
  parts.push(textLike(title, pad, y));
  y += 22;
  const subtitle = frame.querySelector("[data-chart-subtitle]");
  if (subtitle?.textContent) {
    parts.push(textLike(subtitle, pad, y));
    y += 20;
  }
  y += 8;
  let x = pad;
  for (const item of frame.querySelectorAll<HTMLElement>("[data-chart-key]")) {
    if (item.dataset.hidden !== undefined) continue;
    const name = item.querySelector("[data-key-name]");
    const value = item.querySelector("[data-key-value]");
    const color = getComputedStyle(item).getPropertyValue("--series").trim();
    parts.push(
      `<circle cx="${x + 3.5}" cy="${y + 7}" r="3.5" fill="${resolveColor(color, item)}"/>`,
    );
    x += 12;
    parts.push(textLike(name, x, y));
    x += (name?.getBoundingClientRect().width ?? 0) + 6;
    parts.push(textLike(value, x, y));
    x += (value?.getBoundingClientRect().width ?? 0) + 16;
  }
  y += 26;
  const nested = drawn.text.replace("<svg", `<svg x="${pad}" y="${y}"`);
  y += drawn.height + 10;
  parts.push(nested);
  // The footer's parts, which sit apart by layout, with their dots.
  const source = frame.querySelector("[data-chart-source]");
  const said = [...(source?.children ?? [])]
    .map((part) => part.textContent?.replace(/^·\s*/, "").trim())
    .filter((part) => part && part !== "·")
    .join(" · ");
  parts.push(textLike(source, pad, y, said));
  const height = Math.round(y + 16 + pad);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
  const background = resolveColor(getComputedStyle(frame).backgroundColor, frame);
  const png = svgPng(svg, width, height, background);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
