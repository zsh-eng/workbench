import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_DEVICES,
  launchScreens,
  solidPng,
} from "../../scripts/launch-screens";

const html = readFileSync(
  join(import.meta.dirname, "../../index.html"),
  "utf8",
);
const links = [
  ...new DOMParser()
    .parseFromString(html, "text/html")
    .querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-startup-image"]'),
].map((link) => ({
  href: link.getAttribute("href")!,
  media: link.getAttribute("media")!,
}));

describe("launch screens", () => {
  it("links a light and a dark image, in each orientation, for every declared screen", () => {
    for (const { width, height, scale } of LAUNCH_DEVICES)
      for (const orientation of ["portrait", "landscape"])
        for (const scheme of ["light", "dark"]) {
          const [pixelWidth, pixelHeight] =
            orientation === "portrait"
              ? [width * scale, height * scale]
              : [height * scale, width * scale];
          expect(links).toContainEqual({
            href: `/launch/${scheme}-${pixelWidth}x${pixelHeight}.png`,
            media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
          });
        }
    expect(links).toHaveLength(LAUNCH_DEVICES.length * 4);
  });

  it("makes each linked image at its screen's size in the Library's page colour", () => {
    const screens = new Map(
      launchScreens().map((screen) => [screen.href, screen]),
    );
    const colours = { light: "#ffffff", dark: "#0a0a0a" };
    for (const { href } of links) {
      const screen = screens.get(href)!;
      const png = solidPng(
        screen.pixelWidth,
        screen.pixelHeight,
        screen.colour,
      );
      const view = new DataView(png.buffer);
      // IHDR's width and height, then PLTE's one colour.
      expect([view.getUint32(16), view.getUint32(20)]).toEqual([
        screen.pixelWidth,
        screen.pixelHeight,
      ]);
      const palette = [...png.slice(41, 44)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      expect(`#${palette}`).toBe(colours[screen.scheme]);
      expect(png.length).toBeLessThan(1024);
    }
  });
});
