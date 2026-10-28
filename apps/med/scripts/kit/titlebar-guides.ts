/**
 * `bun run kit shot … --steps apps/med/scripts/kit/titlebar-guides.ts`:
 * measures, in a screenshot, where the ink of each part of the window's top
 * row is, and draws its centre line over the page before the kit's shot.
 *
 * The parts: the traffic lights (with titlebar.ts), Med's controls, and the
 * title text. A part's centre line is the middle of its ink, the pixels that
 * differ from the part's background, so text is measured as it shows, not by
 * its line box. The lines: red across the window for the strip's centre,
 * where macOS centres the traffic lights, and cyan across each part for its
 * own. The numbers print as JSON, in CSS pixels.
 */
import type { Page } from "playwright";

/** The parts to measure, by selector; a part that is not on screen is left out. */
const PARTS: [string, string][] = [
  ["traffic lights", "[data-kit-titlebar] > div:first-child"],
  ["Chrome buttons", "[data-kit-titlebar] > div:last-child"],
  ["Hide sidebar", 'nav[aria-label="Threads"] .med-title-row button'],
  ["Show sidebar", 'header[aria-label="Workspace"] button[aria-label^="Show sidebar"]'],
  ["thread title", 'header[aria-label="Workspace"] [data-thread-title]'],
  ["checkout", 'header[aria-label="Workspace"] button[aria-label$="Copy path"]'],
  ["card tab button", ".med-card-tab + * button"],
  ["card tab title", ".med-card-tab + * :is(h1, h2)"],
];
const BAND = 64;

export default async function guides({ page }: { page: Page }) {
  // MED_KIT_KEYS: keys to press first, such as "Meta+b" to hide the sidebar.
  for (const key of (process.env.MED_KIT_KEYS ?? "").split(" ").filter(Boolean)) {
    await page.keyboard.press(key);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(300);
  const boxes = await page.evaluate((parts) => {
    const found: { name: string; x: number; width: number; top: number; bottom: number }[] = [];
    for (const [name, selector] of parts) {
      const element = [...document.querySelectorAll(selector)].find(
        (node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().top < 64,
      );
      if (!element) continue;
      const box = element.getBoundingClientRect();
      found.push({ name, x: box.x, width: box.width, top: box.top, bottom: box.bottom });
    }
    return found;
  }, PARTS);
  const width = await page.evaluate(() => innerWidth);
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width, height: BAND } });
  const measured = await page.evaluate(
    async ({ png, boxes, band }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const scale = image.width / innerWidth;
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const at = (x: number, y: number) => {
        const index = (y * image.width + x) * 4;
        return [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!];
      };
      return boxes.map((box) => {
        // A part's background is the commonest colour in its box.
        const x0 = Math.max(0, Math.round(box.x * scale) + 1);
        const x1 = Math.min(image.width, Math.round((box.x + box.width) * scale) - 1);
        const y1 = Math.min(image.height, Math.round(Math.min(box.bottom, band) * scale));
        const y0 = Math.max(0, Math.round(box.top * scale));
        const counts = new Map<string, number>();
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const key = at(x, y).join();
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        const background = [...counts]
          .sort((a, b) => b[1] - a[1])[0]![0]
          .split(",")
          .map(Number);
        let top = -1;
        let bottom = -1;
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const [r, g, b] = at(x, y);
            const differs =
              Math.abs(r! - background[0]!) +
                Math.abs(g! - background[1]!) +
                Math.abs(b! - background[2]!) >
              60;
            if (!differs) continue;
            if (top < 0) top = y;
            bottom = y + 1;
            break;
          }
        const round = (value: number) => Math.round(value * 100) / 100;
        return {
          name: box.name,
          x: round(box.x),
          width: round(box.width),
          box: [round(box.top), round(box.bottom)],
          boxCentre: round((box.top + box.bottom) / 2),
          ink: top < 0 ? null : [round(top / scale), round(bottom / scale)],
          inkCentre: top < 0 ? null : round((top + bottom) / 2 / scale),
        };
      });
    },
    { png: shot.toString("base64"), boxes, band: BAND },
  );
  const strip = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--med-titlebar-height"),
    ),
  );
  console.log(
    JSON.stringify({
      strip: strip || 0,
      dpr: await page.evaluate(() => devicePixelRatio),
      measured,
    }),
  );
  await page.evaluate(
    ({ measured, strip }) => {
      const layer = document.createElement("div");
      layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      const line = (y: number, color: string, x: number, width: number | string) => {
        const rule = document.createElement("div");
        rule.style.cssText = `position:absolute;left:${x}px;width:${typeof width === "number" ? `${width}px` : width};top:${y - 0.5}px;height:1px;background:${color}`;
        layer.append(rule);
      };
      if (strip) line(strip / 2, "rgba(255,64,64,0.9)", 0, "100%");
      for (const part of measured)
        if (part.inkCentre !== null && part.name !== "traffic lights")
          line(part.inkCentre, "rgba(0,220,255,0.95)", part.x - 6, part.width + 12);
      document.documentElement.append(layer);
    },
    { measured, strip },
  );
}
