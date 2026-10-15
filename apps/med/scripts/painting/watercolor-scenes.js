// Med's sea in watercolour (watercolor.js), after two painters. Each paints
// the dawn and the night; the website shows Turner's dawn and Cézanne's night
// (apps/med-site/scripts/painting/paint.ts).
//
// - Cézanne's late watercolours: a pencil drawing, then groups of flat,
//   parallel strokes of thin colour that build the forms, with white paper
//   between them. Where strokes cross, the colour deepens. At night the light
//   comes back as strokes lifted out of a dark wash.
// - Turner's colour beginnings: wide wet washes that run into each other,
//   with the light kept as bare paper.
//
// The composition is the oil painting's (scenes.js): a high horizon, the sun or
// moon right of centre, and land low on the left, so the product window can
// float on the water. Sizes are in pixels of the sheet; `unit` is one pixel of
// an 1800-pixel-wide sheet.

const place = { horizon: 0.125, sun: { u: 0.63, v: 0.07, r: 0.026 } };

/** The land across the water: a long, low headland at the left, whose point
 * sinks into the sea. */
function headland({ W, H, unit, fbm, smooth }, horizon) {
  return (x) =>
    horizon -
    H *
      (1 - smooth(0.3 * W, 0.4 * W, x)) *
      (0.004 +
        0.034 * smooth(0.0, 0.11 * W, x) * (1 - smooth(0.16 * W, 0.36 * W, x)) +
        0.012 * smooth(0.0, 0.05 * W, x) * (1 - smooth(0.1 * W, 0.2 * W, x)) +
        0.008 * fbm((x * 0.004) / unit, 3.3, 3));
}

/** Points along y = f(x) from x0 to x1. */
const along = (x0, x1, f, step) => {
  const points = [];
  for (let x = x0; x <= x1; x += step) points.push([x, f(x)]);
  return points;
};

/** The sun's path on the water, 1 on its line and 0 far from it; it widens
 * toward the viewer. */
const pathOf = (W, H, horizon, sun) => (x, y) => {
  const depth = Math.max(0, (y - horizon) / (H - horizon));
  const width = (0.012 + 0.075 * Math.sqrt(depth)) * W;
  return Math.exp(-(((x - sun.x) / width) ** 2));
};

/** Cuts the sun's path out of what is drawn so far, at `alpha`. */
function cutPath(ctx, { W, H, unit, bleed, shapes }, horizon, sun, alpha, spread = 1) {
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = alpha;
  const left = [];
  const right = [];
  for (let y = horizon; y < H + bleed; y += 8 * unit) {
    const depth = (y - horizon) / (H - horizon);
    const width = (0.01 + 0.07 * Math.sqrt(depth)) * W * spread;
    left.push([sun.x - width, y]);
    right.push([sun.x + width, y]);
  }
  shapes.outline(ctx, [...left, ...right.reverse()], 30);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function cezanne(night) {
  return {
    paper: night ? [0.95, 0.94, 0.91] : [0.961, 0.957, 0.945],
    paint(api) {
      const { W, H, unit, rand, fbm, smooth, wash, pencil, protect, lift, shapes } = api;
      const horizon = place.horizon * H;
      const sun = {
        x: place.sun.u * W,
        y: place.sun.v * H,
        r: place.sun.r * H * (night ? 0.8 : 1),
      };
      const ridge = headland(api, horizon);
      const path = pathOf(W, H, horizon, sun);
      const pick = (list) => list[Math.floor(rand() * list.length)];
      // Strokes gather where the forms are, and leave paper elsewhere.
      const cluster = (x, y, k = 1) =>
        smooth(0.36, 0.6, fbm((x * 0.003) / unit + k, (y * 0.008) / unit + k));
      const nearSun = (x, y) => Math.hypot(x - sun.x, (y - sun.y) * 1.3) / sun.r;
      // The sky's strokes: steep up high, flatter toward the horizon.
      const slant = (x, y) =>
        -0.7 +
        0.5 * smooth(0.3, 1, y / horizon) +
        0.5 * (fbm((x * 0.002) / unit + 3, (y * 0.01) / unit) - 0.5);
      // Above the land and the horizon.
      const sky = (ctx) => {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(W, 0);
        ctx.lineTo(W, horizon - 1.5 * unit);
        for (let x = W; x >= 0; x -= 6 * unit)
          ctx.lineTo(x, Math.min(horizon, ridge(x)) - 1.5 * unit);
        ctx.closePath();
        ctx.clip();
      };

      // The drawing: the horizon, the headland, the sun, and a few swells.
      pencil({
        strength: night ? 0.16 : 0.26,
        draw(ctx) {
          shapes.line(
            ctx,
            along(
              0.02 * W,
              0.98 * W,
              (x) => horizon + (fbm(x * 0.01, 1) - 0.5) * 2 * unit,
              14 * unit,
            ),
          );
          shapes.line(ctx, along(0.005 * W, 0.4 * W, ridge, 9 * unit));
          shapes.line(
            ctx,
            along(
              0.03 * W,
              0.2 * W,
              (x) => ridge(x) + 0.01 * H + (fbm(x * 0.006, 4) - 0.5) * 8 * unit,
              12 * unit,
            ),
          );
          const arc = [];
          for (let a = -2.7; a < 1.1; a += 0.12)
            arc.push([sun.x + Math.cos(a) * sun.r * 1.06, sun.y + Math.sin(a) * sun.r * 1.06]);
          shapes.line(ctx, arc, 1);
          for (let n = 0; n < 9; n += 1) {
            const y = horizon + (0.03 + rand() ** 1.5 * 0.55) * H;
            const x = rand() * W;
            const length = (0.06 + rand() * 0.18) * W;
            shapes.line(
              ctx,
              along(x, x + length, (t) => y + Math.sin((t - x) * 0.01) * 3 * unit, 16 * unit),
              0.9,
            );
          }
        },
      });

      protect({ wet: 1.5, draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r, sun.r, 0.05) });

      // A first, light wash of the light around the sun and along the horizon.
      wash({
        color: night ? "#a8a6be" : "#f4d8bb",
        density: night ? 0.9 : 0.5,
        wet: 60,
        edge: 0.1,
        granulation: 0.04,
        draw(ctx) {
          shapes.blob(ctx, sun.x, sun.y + 0.02 * H, 0.2 * W, 0.06 * H, 0.35);
          shapes.band(
            ctx,
            0.1 * W,
            0.95 * W,
            () => horizon - 0.03 * H,
            () => horizon + 0.01 * H,
            30,
          );
        },
      });
      if (night) {
        // The night: one dark wash over the sheet, the moon's glow left out.
        wash({
          color: "#3b4468",
          density: 0.95,
          wet: 30,
          edge: 0.2,
          granulation: 0.06,
          bloom: 0.3,
          draw: (ctx) => {
            ctx.fillRect(-api.bleed, -api.bleed, W + 2 * api.bleed, H + 2 * api.bleed);
            ctx.globalCompositeOperation = "destination-out";
            shapes.blob(ctx, sun.x, sun.y, sun.r * 3.2, sun.r * 2.8, 0.3);
            cutPath(ctx, api, horizon, sun, 0.35, 0.8);
            ctx.globalCompositeOperation = "source-over";
          },
        });
      }

      // The sky: groups of parallel strokes, cool above and warm near the sun,
      // leaving paper around it. Each layer has fewer groups, so colour builds
      // where they cross.
      const warmSky = night ? ["#9c98ad", "#a8a196"] : ["#f4d9c0", "#f0cdc4", "#f1dfb9"];
      const coolSky = night
        ? ["#6f78a8", "#7b74a6", "#5f7a9c", "#77809f"]
        : ["#a9bcdc", "#bab2d6", "#a3c4d7", "#b9cfc4", "#9fb2d6"];
      for (let layer = 0; layer < 4; layer += 1)
        wash({
          density: night ? 0.32 : 0.55,
          wet: 0.8,
          edge: 0.32,
          granulation: 0.22,
          bloom: 0.25,
          box: [0, 0, W, horizon + 4 * unit],
          draw(ctx) {
            ctx.save();
            sky(ctx);
            for (let g = 0; g < 36 - layer * 6; g += 1) {
              const gx = rand() * W;
              const gy = rand() ** 0.9 * horizon;
              const keep = cluster(gx, gy, layer * 3) * smooth(2.2, 5.5, nearSun(gx, gy));
              if (rand() > 0.15 + 0.85 * keep) continue;
              const turn = slant(gx, gy) + (rand() - 0.5) * 0.2;
              const t = gy / horizon;
              const warm = Math.min(
                0.9,
                smooth(0.55, 1, t) * 0.6 + (1 - smooth(4, 9, nearSun(gx, gy))) * 0.8,
              );
              let color = pick(rand() < warm ? warmSky : coolSky);
              const count = 2 + Math.floor(rand() * 5);
              const length = (34 + rand() * 60) * unit;
              const width = (6 + rand() * 10) * unit;
              for (let n = 0; n < count; n += 1) {
                if (rand() < 0.25) color = pick(rand() < warm ? warmSky : coolSky);
                const across = (n - count / 2) * width * (0.8 + rand() * 0.35);
                const shift = (rand() - 0.5) * 0.45 * length;
                const x = gx - Math.sin(turn) * across + Math.cos(turn) * shift;
                const y = gy + Math.cos(turn) * across + Math.sin(turn) * shift;
                ctx.fillStyle = color;
                shapes.flat(
                  ctx,
                  x,
                  y,
                  length * (0.7 + rand() * 0.5),
                  width * (0.85 + rand() * 0.3),
                  turn + (rand() - 0.5) * 0.08,
                  {
                    dry: 0.2 + rand() * 0.5,
                    fade: 0.65,
                  },
                );
              }
            }
            ctx.restore();
          },
        });

      // The headland: a violet wash, then strokes down its slopes, warmer on
      // the side toward the sun.
      wash({
        color: night ? "#2c2e44" : "#c3b4ca",
        density: night ? 0.75 : 0.7,
        edge: 0.7,
        granulation: 0.2,
        box: [0, 0, 0.42 * W, horizon + 0.02 * H],
        draw: (ctx) => shapes.band(ctx, 0, 0.4 * W, ridge, () => horizon + 0.002 * H, 3),
      });
      wash({
        density: night ? 0.35 : 0.6,
        wet: 0.6,
        edge: 0.6,
        granulation: 0.25,
        box: [0, 0, 0.42 * W, horizon + 0.02 * H],
        draw(ctx) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(0, horizon);
          for (let x = 0; x <= 0.38 * W; x += 6 * unit) ctx.lineTo(x, ridge(x) - unit);
          ctx.lineTo(0.38 * W, horizon + unit);
          ctx.closePath();
          ctx.clip();
          for (let n = 0; n < 60; n += 1) {
            const x = rand() * 0.36 * W;
            const top = ridge(x);
            if (horizon - top < 3 * unit) continue;
            const y = top + rand() ** 0.8 * (horizon - top);
            const slope = (ridge(x + 4 * unit) - ridge(x - 4 * unit)) / (8 * unit);
            const sunward = slope > 0;
            ctx.fillStyle = night
              ? pick(["#24273a", "#2e3047", "#262c3c"])
              : pick(
                  sunward ? ["#d8c4a0", "#b7bfa0", "#c5b2c4"] : ["#a7b5a2", "#ac9fc0", "#9fae9a"],
                );
            const length = (12 + rand() * 26) * unit;
            shapes.flat(
              ctx,
              x,
              y,
              length,
              length * (0.25 + rand() * 0.15),
              Math.atan(slope) * 0.8 + (rand() - 0.5) * 0.3,
              {
                dry: 0.3,
                fade: 0.75,
              },
            );
          }
          ctx.restore();
        },
      });

      // The far water: a line of small strokes along the horizon.
      wash({
        density: night ? 0.4 : 0.7,
        wet: 0.6,
        edge: 0.5,
        granulation: 0.2,
        box: [0, horizon - 4 * unit, W, horizon + 0.03 * H],
        draw(ctx) {
          for (let x = -20 * unit; x < W;) {
            const length = (24 + rand() * 80) * unit;
            const y = horizon + (1 + rand() * 6) * unit;
            if (path(x, y + 20 * unit) < 0.4 && rand() < 0.85) {
              ctx.fillStyle = night
                ? pick(["#2a3354", "#353a5e"])
                : pick(["#9fadd0", "#a7b4cc", "#aba6cc"]);
              shapes.flat(
                ctx,
                x + length / 2,
                y,
                length,
                (2.5 + rand() * 3) * unit,
                (rand() - 0.5) * 0.02,
                { dry: 0.4, tilt: 0.2 },
              );
            }
            x += length * (1 + rand() * 0.4);
          }
        },
      });

      // The sea: a thin wash with the sun's path left pale, then rows of flat
      // strokes, longer and wider toward the viewer.
      wash({
        color: night ? "#323b5c" : "#d4e3e3",
        density: night ? 0.25 : 0.6,
        wet: 30,
        edge: 0.15,
        granulation: 0.06,
        streaks: 0.4,
        box: [0, horizon - 0.01 * H, W, H],
        draw(ctx) {
          ctx.fillRect(-api.bleed, horizon, W + 2 * api.bleed, H + api.bleed);
          cutPath(ctx, api, horizon, sun, 0.8);
        },
      });
      const seaColors = night
        ? ["#4f5a85", "#465479", "#5a5a88", "#405a72", "#525e7c"]
        : ["#a1c4cf", "#93b7c6", "#a8c9bd", "#9bb0d0", "#a6bfd6", "#b4cfd0", "#adaed0"];
      const glow = night ? ["#8f8c9e", "#9a968e"] : ["#f1d2ad", "#ecd9b6", "#f0c8b0"];
      for (let layer = 0; layer < 3; layer += 1)
        wash({
          density: night ? 0.3 : 0.55,
          wet: 0.7,
          edge: 0.42,
          granulation: 0.2,
          bloom: 0.25,
          box: [0, horizon, W, H],
          draw(ctx) {
            let y = horizon + (5 + rand() * 6) * unit;
            while (y < H + 20 * unit) {
              const depth = (y - horizon) / (H - horizon);
              const reach = (0.35 + 1.5 * depth) * unit;
              for (let x = -60 * unit - rand() * 80 * unit; x < W;) {
                const length = (30 + rand() * 80) * reach;
                const width = (5 + rand() * 8) * reach;
                const mid = x + length / 2;
                const lit = path(mid, y);
                const keep = (0.62 - layer * 0.16) * (0.1 + 0.9 * cluster(mid, y, layer + 9));
                if (lit > 0.45) {
                  if (rand() < 0.22) {
                    ctx.fillStyle = pick(glow);
                    shapes.flat(ctx, mid, y, length * 0.5, width * 0.6, (rand() - 0.5) * 0.03, {
                      dry: 0.8,
                      tilt: 0.15,
                    });
                  }
                } else if (rand() < keep) {
                  ctx.fillStyle = rand() < lit * 1.6 ? pick(glow) : pick(seaColors);
                  shapes.flat(
                    ctx,
                    mid,
                    y + (rand() - 0.5) * 3 * reach,
                    length,
                    width,
                    (rand() - 0.5) * 0.04,
                    {
                      bow: 0.02,
                      tilt: 0.2,
                      dry: 0.2 + rand() * 0.5,
                    },
                  );
                }
                x += length * (1.1 + rand() * 0.7);
              }
              y += (10 + rand() * 8) * reach;
            }
          },
        });

      // At night the light comes back as strokes lifted out: on the moon's
      // path, and a few in the sky near it.
      if (night)
        lift({
          amount: 0.3,
          draw(ctx) {
            for (let n = 0; n < 200; n += 1) {
              const y = horizon + 3 * unit + rand() ** 1.4 * (H - horizon);
              const depth = (y - horizon) / (H - horizon);
              const x = sun.x + (rand() - 0.5) * 2.2 * (0.01 + 0.07 * Math.sqrt(depth)) * W;
              const length = (20 + rand() * 60) * unit * (0.35 + depth * 1.5);
              shapes.flat(
                ctx,
                x,
                y,
                length,
                length * (0.1 + rand() * 0.06),
                (rand() - 0.5) * 0.03,
                { tilt: 0.2, dry: 0.5, fade: 1 },
              );
            }
            for (let n = 0; n < 22; n += 1) {
              const a = rand() * Math.PI * 2;
              const r = sun.r * (2.5 + rand() * 6);
              const x = sun.x + Math.cos(a) * r * 1.6;
              const y = sun.y + Math.sin(a) * r * 0.6;
              if (y > horizon - 3 * unit) continue;
              shapes.flat(
                ctx,
                x,
                y,
                (24 + rand() * 40) * unit,
                (6 + rand() * 6) * unit,
                slant(x, y),
                { dry: 0.4, fade: 0.4 },
              );
            }
          },
        });
      // The sun, and at night the moon's halo, lifted out.
      if (night)
        lift({
          amount: 0.3,
          wet: 40,
          draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r * 2.4, sun.r * 2.2, 0.2),
        });
      wash({
        color: night ? "#efe6cf" : "#fbe9c4",
        density: 0.5,
        wet: 3,
        edge: 0.6,
        granulation: 0.02,
        draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r * 1.02, sun.r * 1.02, 0.05),
      });
    },
  };
}

function turner(night) {
  return {
    paper: night ? [0.95, 0.94, 0.91] : [0.961, 0.957, 0.945],
    paint(api) {
      const { W, H, unit, rand, wash, protect, lift, shapes } = api;
      const horizon = place.horizon * H;
      const sun = {
        x: place.sun.u * W,
        y: place.sun.v * H,
        r: place.sun.r * H * (night ? 0.8 : 1),
      };
      const ridge = headland(api, horizon);
      const path = pathOf(W, H, horizon, sun);

      protect({ wet: 3, draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r, sun.r, 0.04) });

      // One wide wash of light: yellow at the sun, rose at the horizon.
      wash({
        color: night ? "#c9c2b6" : "#f8dfa6",
        density: night ? 0.5 : 0.9,
        wet: 110,
        edge: 0.08,
        granulation: 0.02,
        bloom: 0.5,
        draw: (ctx) => shapes.blob(ctx, sun.x, sun.y + 0.03 * H, 0.32 * W, 0.12 * H, 0.4),
      });
      wash({
        color: night ? "#7d7a98" : "#f0bfb2",
        density: night ? 0.45 : 0.6,
        wet: 60,
        edge: 0.15,
        bloom: 0.5,
        granulation: 0.03,
        box: [0, 0, W, horizon + 0.08 * H],
        draw: (ctx) =>
          shapes.band(
            ctx,
            -api.bleed,
            W + api.bleed,
            () => horizon - 0.06 * H,
            () => horizon + 0.012 * H,
            50,
          ),
      });
      // The sky above, cool, running into the warm wash, with a bloom where
      // it met the damp.
      wash({
        color: night ? "#2e3654" : "#b4c4de",
        density: night ? 0.55 : 0.85,
        wet: 70,
        edge: 0.12,
        granulation: 0.05,
        bloom: 0.55,
        draw(ctx) {
          shapes.band(
            ctx,
            -api.bleed,
            W + api.bleed,
            () => -api.bleed,
            (x) => (0.045 + 0.03 * Math.sin(x * 0.002)) * H,
            60,
          );
          ctx.globalCompositeOperation = "destination-out";
          shapes.blob(ctx, sun.x, sun.y, sun.r * 4.5, sun.r * 3, 0.35);
          ctx.globalCompositeOperation = "source-over";
        },
      });
      // Soft streaks of cloud, laid wet across the upper sky.
      wash({
        color: night ? "#4a4f72" : "#cbbfd6",
        density: night ? 0.35 : 0.4,
        wet: 16,
        edge: 0.2,
        granulation: 0.04,
        bloom: 0.4,
        box: [0, 0, W, horizon],
        draw(ctx) {
          for (let n = 0; n < 9; n += 1) {
            const y = (0.012 + rand() * 0.07) * H;
            const x = rand() * W;
            if (Math.abs(x - sun.x) < 0.12 * W && Math.abs(y - sun.y) < 0.05 * H) continue;
            const length = (0.12 + rand() * 0.22) * W;
            const points = [];
            for (let t = 0; t <= 1; t += 0.1)
              points.push([x + (t - 0.5) * length, y + Math.sin(t * 3 + n) * 3 * unit]);
            shapes.stroke(ctx, points, (6 + rand() * 12) * unit);
          }
        },
      });
      if (night)
        wash({
          color: "#3a4062",
          density: 0.5,
          wet: 60,
          edge: 0.1,
          bloom: 0.5,
          granulation: 0.04,
          draw(ctx) {
            ctx.fillRect(-api.bleed, -api.bleed, W + 2 * api.bleed, H + 2 * api.bleed);
            ctx.globalCompositeOperation = "destination-out";
            shapes.blob(ctx, sun.x, sun.y, sun.r * 3.6, sun.r * 3, 0.3);
            ctx.globalCompositeOperation = "source-over";
          },
        });

      // The headland, soft in the haze, with a firmer foot at the water.
      wash({
        color: night ? "#262838" : "#b8a8c0",
        density: night ? 0.75 : 0.75,
        wet: 6,
        edge: 0.5,
        granulation: 0.1,
        box: [0, 0, 0.45 * W, horizon + 0.03 * H],
        draw: (ctx) => shapes.band(ctx, -10, 0.4 * W, ridge, () => horizon + 0.003 * H, 4),
      });

      // The sea: wide horizontal washes, wet into wet, darker below, with the
      // path of light left pale.
      wash({
        color: night ? "#2a3150" : "#c4dade",
        density: night ? 0.5 : 0.7,
        wet: 40,
        edge: 0.2,
        granulation: 0.06,
        bloom: night ? 0.2 : 0.35,
        streaks: 0.6,
        box: [0, horizon - 0.02 * H, W, H],
        draw(ctx) {
          shapes.band(
            ctx,
            -api.bleed,
            W + api.bleed,
            () => horizon,
            () => H + api.bleed,
            20,
          );
          cutPath(ctx, api, horizon, sun, 0.75, 1.07);
        },
      });
      wash({
        color: night ? "#1f2640" : "#a0bfc9",
        density: night ? 0.22 : 0.6,
        wet: 50,
        edge: 0.15,
        granulation: 0.08,
        bloom: night ? 0.2 : 0.35,
        streaks: 0.7,
        box: [0, horizon, W, H],
        draw(ctx) {
          shapes.band(
            ctx,
            -api.bleed,
            W + api.bleed,
            (x) => horizon + (0.12 + 0.05 * Math.sin(x * 0.0015)) * H,
            () => H + api.bleed,
            60,
          );
          cutPath(ctx, api, horizon, sun, 0.9, 1.07);
        },
      });
      // Swells: long, thin strokes laid flat on the dry wash, crisp at their
      // edges and broken where the brush ran dry.
      wash({
        color: night ? "#262d49" : "#9dbac6",
        density: night ? 0.12 : 0.32,
        wet: 2.5,
        edge: 0.3,
        granulation: 0.08,
        bloom: 0.4,
        box: [0, horizon, W, H],
        draw(ctx) {
          for (let n = 0; n < 90; n += 1) {
            const y = horizon + 8 * unit + rand() ** 1.1 * (H - horizon);
            const depth = (y - horizon) / (H - horizon);
            const x = rand() * W;
            if (path(x, y) > 0.3) continue;
            const length = (0.04 + rand() * 0.12) * W * (0.5 + depth);
            shapes.flat(
              ctx,
              x,
              y,
              length,
              (4 + depth * 24) * unit * (0.6 + rand() * 0.8),
              (rand() - 0.5) * 0.02,
              {
                bow: 0.015,
                tilt: 0.15,
                dry: 0.3 + rand() * 0.6,
                fade: 0.55,
              },
            );
          }
        },
      });
      // Light on the water: a dry brush of the sea's colour dragged across the
      // path, so the paper sparkles through, and streaks lifted out.
      wash({
        color: night ? "#4a5274" : "#b3cdd4",
        density: night ? 0.35 : 0.55,
        dry: 0.52,
        edge: 0.2,
        granulation: 0.04,
        box: [0, horizon, W, H],
        draw(ctx) {
          for (let n = 0; n < 120; n += 1) {
            const y = horizon + 4 * unit + rand() ** 1.2 * (H - horizon);
            const depth = (y - horizon) / (H - horizon);
            const x = sun.x + (rand() - 0.5) * 2.4 * (0.012 + 0.075 * Math.sqrt(depth)) * W;
            const length = (30 + rand() * 90) * unit * (0.3 + depth * 1.4);
            shapes.flat(ctx, x, y, length, (2 + depth * 9) * unit, 0, {
              bow: 0,
              tilt: 0.1,
              dry: 0.6,
              fade: 0.8,
            });
          }
        },
      });
      lift({
        amount: night ? 0.5 : 0.35,
        draw(ctx) {
          for (let n = 0; n < 90; n += 1) {
            const y = horizon + 3 * unit + rand() ** 1.3 * (H - horizon);
            const depth = (y - horizon) / (H - horizon);
            const x = sun.x + (rand() - 0.5) * 2 * (0.008 + 0.06 * Math.sqrt(depth)) * W;
            const length = (14 + rand() * 40) * unit * (0.3 + depth);
            shapes.flat(ctx, x, y, length, Math.max(1.5 * unit, length * 0.07), 0, {
              bow: 0,
              tilt: 0.1,
              dry: 0.4,
              fade: 1,
            });
          }
        },
      });
      if (night)
        lift({
          amount: 0.3,
          wet: 50,
          draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r * 2.6, sun.r * 2.4, 0.2),
        });
      wash({
        color: night ? "#efe6cf" : "#fbe8bd",
        density: 0.45,
        wet: 4,
        edge: 0.5,
        granulation: 0.02,
        draw: (ctx) => shapes.blob(ctx, sun.x, sun.y, sun.r, sun.r, 0.04),
      });
    },
  };
}

window.watercolorScenes = {
  cezanneDawn: cezanne(false),
  cezanneNight: cezanne(true),
  turnerDawn: turner(false),
  turnerNight: turner(true),
};
