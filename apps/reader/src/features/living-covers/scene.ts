/**
 * A cover scene: the hand-made description of one cover as a lit object.
 *
 * The maps are authored per cover, at the cover's aspect ratio:
 *
 * - `depth`: R is parallax height (white is the cover surface, black is the
 *   deepest point behind it). G is relief for lighting only: emboss, deboss,
 *   ridges and grain, with 50% gray as flat.
 * - `materials`: R is foil, G is spot gloss (a clear varnish), B is glow.
 * - `life` (optional): R is shimmer (water), G is mist, B is a slow pulse.
 *
 * A scene is keyed by the cover's file id, the xxh64 of the cover file the
 * Library already shows, so a synced book finds its scene on every device.
 */

export interface CoverGlint {
  /** Position on the cover, 0 to 1 from the top left. */
  x: number;
  y: number;
  /** Radius as a share of the cover width. */
  size: number;
  /** Seconds of offset in the twinkle cycle. */
  phase: number;
  color: [number, number, number];
}

export interface CoverScene {
  id: string;
  title: string;
  /** Cover file ids (`xxh64:…`) that this scene was drawn for. */
  covers: string[];
  maps: { depth: string; materials: string | null; life: string | null };
  /** Deepest parallax, in cover widths. */
  parallax: number;
  /** Relief height for lighting, in cover widths. */
  relief: number;
  /** Lamination over the whole cover. */
  paper: { gloss: number; roughness: number; grain: number; weave: number };
  foil: {
    roughness: number;
    /** 0 for gold or silver, up to 1 for a holographic foil. */
    iridescence: number;
    /** How much the foil's grain breaks a highlight into sparkle. */
    grain: number;
    /** Extra brightness of the foil in reflection. */
    strength: number;
  };
  glow: { strength: number };
  /** How much the painted art responds to the light, 0 to 1. */
  shading: number;
  life: {
    shimmer: { amount: number; speed: number } | null;
    mist: {
      color: [number, number, number];
      opacity: number;
      speed: number;
    } | null;
    pulse: { amount: number; speed: number } | null;
    glints: CoverGlint[];
  };
  /** The book as an object: page count sets the page block thickness. */
  object: { pages: number | null; edge: [number, number, number] | null };
}

/** The scene file as authored; missing fields take the defaults. */
export type CoverSceneFile = Partial<Omit<CoverScene, "maps" | "id">> & {
  version: 1;
  maps: { depth: string; materials?: string; life?: string };
};

export const DEFAULT_SCENE: CoverScene = {
  id: "default",
  title: "Default",
  covers: [],
  maps: { depth: "", materials: null, life: null },
  parallax: 0,
  relief: 0,
  // A soft laminate: a broad sheen that moves with the light.
  paper: { gloss: 0.55, roughness: 0.42, grain: 0.35, weave: 0 },
  foil: { roughness: 0.22, iridescence: 0, grain: 0.5, strength: 1 },
  glow: { strength: 0 },
  shading: 0.25,
  life: { shimmer: null, mist: null, pulse: null, glints: [] },
  object: { pages: null, edge: null },
};

/** Resolve a scene file against the defaults; map paths become URLs. */
export function resolveScene(
  id: string,
  file: CoverSceneFile,
  baseUrl: string,
): CoverScene {
  const url = (path: string | undefined) =>
    path ? new URL(path, baseUrl).toString() : null;
  return {
    ...DEFAULT_SCENE,
    ...file,
    id,
    title: file.title ?? id,
    covers: file.covers ?? [],
    maps: {
      depth: url(file.maps.depth)!,
      materials: url(file.maps.materials),
      life: url(file.maps.life),
    },
    paper: { ...DEFAULT_SCENE.paper, ...file.paper },
    foil: { ...DEFAULT_SCENE.foil, ...file.foil },
    glow: { ...DEFAULT_SCENE.glow, ...file.glow },
    life: { ...DEFAULT_SCENE.life, ...file.life },
    object: { ...DEFAULT_SCENE.object, ...file.object },
  };
}
