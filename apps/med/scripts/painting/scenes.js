// Med's paintings: the Mediterranean under a low sun (light) or a low moon
// (dark), with its reflection on the water. The website shows the sea behind
// the product window; the app icon is a square tile of the same sea under the
// Reflection mark. A scene gives the colour at (u, v), both 0 to 1 with v
// down, and how strokes lie there.
const mix = (a, b, t) =>
  a.map((x, i) => x + (b[i] - x) * Math.max(0, Math.min(1, t)));
const rgb = (hex) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
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

// The sea seen from a little above: a high horizon, so the product window can
// float on the water with the sun above it.
function seascape(aspect, P, { horizon, sun }) {
  // An island at the left, low on the horizon.
  const ridge = (u) =>
    horizon -
    (0.005 +
      0.024 * smooth(0.02, 0.13, u) * (1 - smooth(0.15, 0.3, u)) +
      0.007 * fbm(u * 22, 3));
  const island = (u, v) => u < 0.31 && v > ridge(u) && v < horizon;

  function color(u, v) {
    const dx = (u - sun.u) * aspect;
    const d = Math.hypot(dx, v - sun.v);
    if (v < horizon) {
      const t = v / horizon;
      let c =
        t < 0.55
          ? mix(P.skyTop, P.skyMid, t / 0.55)
          : mix(P.skyMid, P.skyLow, (t - 0.55) / 0.45);
      c = mix(
        c,
        P.cloud,
        0.35 * smooth(0.52, 0.78, fbm(u * 4 + 7, v * 30)) * smooth(0.1, 0.6, t),
      );
      c = mix(c, P.glow, 0.9 * Math.exp(-d * 11));
      if (d < sun.r) c = mix(c, P.sun, 0.92);
      if (island(u, v)) c = mix(c, P.haze, 0.85);
      return c;
    }
    const depth = (v - horizon) / (1 - horizon);
    let c =
      depth < 0.18
        ? mix(P.seaTop, P.seaMid, depth / 0.18)
        : mix(P.seaMid, P.seaLow, (depth - 0.18) / 0.82);
    // Long swells.
    c = mix(c, P.seaShade, 0.28 * smooth(0.45, 0.8, fbm(u * 6, v * 70)));
    // The sun's path on the water, wider toward the viewer.
    const width = 0.012 + 0.11 * Math.sqrt(depth);
    const path = Math.exp(-((u - sun.u) ** 2) / (width * width));
    const glint = smooth(0.42, 0.72, fbm(u * 55 + 3, v * 260));
    c = mix(c, P.glitter, path * (0.25 + 0.75 * glint) * (1 - depth * 0.5));
    c = mix(
      c,
      P.glow,
      0.45 * Math.exp(-Math.abs(dx) * 3) * (1 - smooth(0, 0.08, depth)),
    );
    return c;
  }

  return {
    color,
    angle(u, v, rand) {
      if (v < horizon)
        return (rand() - 0.5) * 0.22 + Math.sin(u * 4 + v * 7) * 0.1;
      return (rand() - 0.5) * 0.07;
    },
    // Smaller strokes at the sun, the horizon, the island, and far water.
    detail(u, v) {
      const d = Math.hypot((u - sun.u) * aspect, v - sun.v);
      let k = Math.min(1, 0.25 + 3 * Math.max(0, d - sun.r));
      k = Math.min(k, 0.3 + 30 * Math.abs(v - horizon));
      if (u < 0.33 && v < horizon)
        k = Math.min(k, 0.3 + 40 * Math.abs(v - ridge(u)));
      if (v > horizon)
        k = Math.min(k, 0.35 + 1.1 * Math.sqrt((v - horizon) / (1 - horizon)));
      return k;
    },
    // Water lies in long, flat strokes.
    stretch: (u, v) => (v > horizon ? 2.2 : 1.2),
    passes: [
      { count: 2200, size: 30, stretch: 5, alpha: 0.7, jitter: 0.04, min: 0.6 },
      {
        count: 12000,
        size: 14,
        stretch: 4.5,
        alpha: 0.75,
        jitter: 0.045,
        min: 0.35,
      },
      { count: 36000, size: 6.5, stretch: 4, alpha: 0.8, jitter: 0.05, min: 0 },
      {
        count: 30000,
        size: 3,
        stretch: 3.5,
        alpha: 0.85,
        jitter: 0.045,
        min: 0,
      },
    ],
    finish(g, width, height, rand) {
      // The sun: a halo, then a soft disc of small dabs.
      const cx = sun.u * width;
      const cy = sun.v * height;
      const r = sun.r * height;
      const halo = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 3.2);
      const light = P.sun.map((c) => Math.round(c * 255)).join(",");
      halo.addColorStop(0, `rgba(${light},0.55)`);
      halo.addColorStop(1, `rgba(${light},0)`);
      g.fillStyle = halo;
      g.fillRect(cx - r * 4, cy - r * 4, r * 8, r * 8);
      for (let i = 0; i < 900; i += 1) {
        const a = rand() * Math.PI * 2;
        const q = Math.sqrt(rand()) * r;
        const dab = mix(P.sun, P.glow, rand() * 0.3);
        g.fillStyle = `rgba(${dab.map((c) => Math.round(c * 255)).join(",")},0.5)`;
        g.beginPath();
        g.ellipse(
          cx + Math.cos(a) * q,
          cy + Math.sin(a) * q,
          r * 0.16,
          r * 0.08,
          (rand() - 0.5) * 0.4,
          0,
          Math.PI * 2,
        );
        g.fill();
      }
      // A faint canvas weave.
      const image = g.getImageData(0, 0, width, height);
      for (let i = 0; i < image.data.length; i += 4) {
        const p = i / 4;
        const x = p % width;
        const y = (p / width) | 0;
        const weave =
          Math.sin(x * 0.9) * Math.sin(y * 0.9) * 2.2 + (hash(x, y) - 0.5) * 5;
        image.data[i] += weave;
        image.data[i + 1] += weave;
        image.data[i + 2] += weave;
      }
      g.putImageData(image, 0, 0);
    },
  };
}

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

const place = { horizon: 0.125, sun: { u: 0.63, v: 0.07, r: 0.028 } };

window.scenes = {
  dawn: (aspect) =>
    seascape(
      aspect,
      {
        skyTop: rgb("#c3c8d9"),
        skyMid: rgb("#e2cdd0"),
        skyLow: rgb("#f4d6b8"),
        cloud: rgb("#ecd9da"),
        glow: rgb("#fbe6c6"),
        sun: rgb("#fff6e2"),
        haze: rgb("#c7b7c4"),
        seaTop: rgb("#e6cdbd"),
        seaMid: rgb("#b8c7ca"),
        seaLow: rgb("#8eaab3"),
        seaShade: rgb("#7f9ba7"),
        glitter: rgb("#fff2d6"),
      },
      place,
    ),
  night: (aspect) =>
    seascape(
      aspect,
      {
        skyTop: rgb("#1c1e2c"),
        skyMid: rgb("#2b2b3f"),
        skyLow: rgb("#4a4257"),
        cloud: rgb("#332f45"),
        glow: rgb("#6b6273"),
        sun: rgb("#efe6d2"),
        haze: rgb("#2a2838"),
        seaTop: rgb("#3c3a4c"),
        seaMid: rgb("#252a38"),
        seaLow: rgb("#171b25"),
        seaShade: rgb("#121620"),
        glitter: rgb("#b9b4ae"),
      },
      { ...place, sun: { ...place.sun, r: 0.021 } },
    ),
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
