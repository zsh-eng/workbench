// The app icon's tiles, painted in bristle strokes (painter.js): the
// Mediterranean under a low sun (light) or a low moon (dark), under the
// Reflection mark. The website's paintings of the same sea are watercolours
// (watercolor-scenes.js). A scene gives the colour at (u, v), both 0 to 1
// with v down, and how strokes lie there.
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x, y) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const noise = (x, y) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y) =>
  noise(x, y) * 0.5 +
  noise(x * 2.1, y * 2.1) * 0.25 +
  noise(x * 4.3, y * 4.3) * 0.125 +
  noise(x * 8.7, y * 8.7) * 0.0625;

// The icon's tile: sky above the middle and sea below, where the mark's
// horizon is, with a glow behind the mark's sun. render-icons.mjs draws the
// mark on top.
function tile(P) {
  const horizon = 0.5;
  const sun = { u: 0.45, v: 0.42 };
  return {
    color(u, v) {
      const d = Math.hypot(u - sun.u, v - sun.v);
      if (v < horizon) {
        const c = mix(P.skyTop, P.skyLow, smooth(0, horizon, v));
        return mix(c, P.glow, P.glowStrength * Math.exp(-d * 6));
      }
      const depth = (v - horizon) / (1 - horizon);
      let c = mix(P.seaTop, P.seaLow, smooth(0, 1, depth));
      c = mix(c, P.seaShade, 0.25 * smooth(0.45, 0.8, fbm(u * 5, v * 40)));
      // The path of light under the reflection.
      const path = Math.exp(-((u - 0.55) ** 2) / 0.02) * (1 - depth * 0.6);
      return mix(c, P.glow, 0.5 * P.glowStrength * path);
    },
    angle: (u, v, rand) => (rand() - 0.5) * (v < horizon ? 0.25 : 0.08),
    detail: (u, v) => Math.min(1, 0.4 + 25 * Math.abs(v - horizon)),
    stretch: (u, v) => (v > horizon ? 2 : 1.2),
    passes: [
      { count: 1400, size: 34, stretch: 4, alpha: 0.7, jitter: 0.04, min: 0.5 },
      { count: 6000, size: 15, stretch: 4, alpha: 0.75, jitter: 0.045, min: 0 },
      { count: 14000, size: 7, stretch: 3.5, alpha: 0.8, jitter: 0.05, min: 0 },
    ],
  };
}

window.scenes = {
  dawnTile: () =>
    tile({
      skyTop: rgb("#a9aecb"),
      skyLow: rgb("#ecbfa2"),
      glow: rgb("#f8dcbc"),
      glowStrength: 0.7,
      seaTop: rgb("#cdb5ab"),
      seaLow: rgb("#7b98a3"),
      seaShade: rgb("#6c8a96"),
    }),
  nightTile: () =>
    tile({
      skyTop: rgb("#1b1d2b"),
      skyLow: rgb("#3e3850"),
      glow: rgb("#5d5568"),
      glowStrength: 0.8,
      seaTop: rgb("#34324a"),
      seaLow: rgb("#151923"),
      seaShade: rgb("#10141c"),
    }),
};
