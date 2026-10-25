/**
 * Procedural paper grain. Each level is one SVG tile of `feTurbulence`
 * noise, used as a CSS mask over a theme colour, so it stays crisp at any
 * zoom (the browser rasterises the filter at the scale it draws), tiles
 * without seams (`stitchTiles`) and is cached by the browser after the
 * first paint. The tile holds only alpha; App.css picks the fibre colour
 * for each theme.
 *
 * - `fine`: the tooth of uncoated book paper.
 * - `rich`: tooth, faint cloudy formation and a few wisps of fibre, as in
 *   a laid or recycled sheet, with a faint vignette.
 */

export type PaperGrain = "off" | "fine" | "rich";

export const PAPER_GRAINS: readonly PaperGrain[] = ["off", "fine", "rich"];

export function isPaperGrain(value: unknown): value is PaperGrain {
  return value === "off" || value === "fine" || value === "rich";
}

/** Tooth: high-frequency noise, its alpha spread around a quarter. */
const TOOTH = `<feTurbulence type='fractalNoise' baseFrequency='0.92' numOctaves='2' seed='11' stitchTiles='stitch' result='t'/><feColorMatrix in='t' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.4 0 0 0 -0.95' result='tooth'/>`;

const TILES: Record<
  Exclude<PaperGrain, "off">,
  { size: number; filter: string }
> = {
  fine: { size: 200, filter: TOOTH },
  rich: {
    size: 360,
    filter:
      TOOTH +
      // Formation: the cloudy unevenness of a sheet held to the light.
      `<feTurbulence type='fractalNoise' baseFrequency='0.011' numOctaves='3' seed='4' stitchTiles='stitch' result='m'/><feColorMatrix in='m' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 2.2 0 0 0 -0.85' result='mottle'/>` +
      // Fibres: the thin ridges of turbulence, kept only where a second
      // noise is dense, so they gather in a few places.
      `<feTurbulence type='turbulence' baseFrequency='0.045' numOctaves='1' seed='9' stitchTiles='stitch' result='f'/><feColorMatrix in='f' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -16 0 0 0 1' result='ridges'/><feTurbulence type='fractalNoise' baseFrequency='0.02' numOctaves='2' seed='31' stitchTiles='stitch' result='d'/><feColorMatrix in='d' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 9 0 0 0 -5.2' result='density'/><feComposite in='ridges' in2='density' operator='in' result='fibre'/>` +
      `<feComposite in='tooth' in2='mottle' operator='arithmetic' k2='0.75' k3='0.45' result='a'/><feComposite in='a' in2='fibre' operator='arithmetic' k2='1' k3='0.55'/>`,
  },
};

function tileSvg(grain: Exclude<PaperGrain, "off">): string {
  const { size, filter } = TILES[grain];
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>${filter}</filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`;
}

const urls = new Map<PaperGrain, string>();

/** The tile as a data URL, built once per level. */
export function paperGrainDataUrl(grain: Exclude<PaperGrain, "off">): string {
  let url = urls.get(grain);
  if (!url) {
    url = `data:image/svg+xml,${encodeURIComponent(tileSvg(grain))}`;
    urls.set(grain, url);
  }
  return url;
}

/** The tile's size in CSS pixels. */
export function paperGrainTileSize(grain: Exclude<PaperGrain, "off">): number {
  return TILES[grain].size;
}

/** CSS custom properties that the page's grain layer reads. */
export function paperGrainStyle(
  grain: PaperGrain,
): Record<string, string> | undefined {
  if (grain === "off") return undefined;
  return {
    "--paper-grain": `url("${paperGrainDataUrl(grain)}")`,
    "--paper-tile": `${paperGrainTileSize(grain)}px`,
  };
}

const images = new Map<PaperGrain, Promise<HTMLImageElement | null>>();

/**
 * The tile as a decoded image at `scale`, for drawing the grain into a page
 * raster. Resolves to null where the image cannot be drawn into a canvas
 * without tainting it; the curled page then goes without grain.
 */
export function loadPaperGrainImage(
  grain: Exclude<PaperGrain, "off">,
): Promise<HTMLImageElement | null> {
  let image = images.get(grain);
  if (!image) {
    image = new Promise((resolve) => {
      const element = new Image();
      element.decoding = "async";
      element.onload = () => resolve(element);
      element.onerror = () => resolve(null);
      element.src = paperGrainDataUrl(grain);
    });
    images.set(grain, image);
  }
  return image;
}
