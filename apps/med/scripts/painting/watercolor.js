// A watercolour renderer: washes of pigment on textured paper. A scene
// (watercolor-scenes.js) paints with the functions below, in order, as a
// painter would: pencil first, then light washes, then darker ones on top.
//
// - Paper is a height field. Pigment settles in its hollows and in clumps
//   (granulation), and a dry brush touches only its peaks.
// - A wash is a set of shapes on a canvas, each in its own colour. Wet washes
//   have soft edges and their colours run together. Every wash dries a little
//   darker at its edge, most at the lower edge, where the water ran.
// - A wash that is touched while damp blooms: water pushes the pigment out
//   and leaves a pale patch with a frilled, dark rim.
// - Washes glaze: each one multiplies the colour under it, so overlaps
//   darken, and paper that no wash touches stays white.
//
// Runs in a browser page (a canvas draws the shapes); the caller writes the
// result. Random numbers come from a seeded generator, so a scene paints the
// same picture each time.
window.watercolor = function watercolor({ width: W, height: H, seed = 7, scene }) {
  const N = W * H;
  // Sizes in a scene are for an 1800-pixel-wide sheet.
  const unit = W / 1800;
  let state = seed >>> 0;
  const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;

  // Value noise from a seeded lattice.
  const lattice = new Float32Array(4096);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rand();
  const at = (x, y) => lattice[((x * 73856093) ^ (y * 19349663)) & 4095];
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, octaves = 4) => {
    let sum = 0;
    let amp = 0.5;
    let total = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += noise(x, y) * amp;
      total += amp;
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 9.7;
      amp *= 0.5;
    }
    return sum / total;
  };

  // The paper and the fields that make pigment uneven:
  // - paper: the tooth's height, for dry brush and pencil;
  // - settle: where granulating pigment collects, in the hollows and in
  //   clumps a few teeth across;
  // - blotch and streak: soft unevenness in a wash, round and horizontal;
  // - drag: the tooth as a brush dragged sideways meets it, for dry brush;
  // - frill: a warped field whose level lines have a bloom's frilled edge.
  const paper = new Float32Array(N);
  const drag = new Float32Array(N);
  const settle = new Float32Array(N);
  const blotch = new Float32Array(N);
  const streak = new Float32Array(N);
  const frill = new Float32Array(N);
  {
    // Cold-pressed paper: a tooth about 7 pixels across, a little finer
    // grain, and a soft mottle.
    const tooth = 0.14 / unit;
    const grain = 0.38 / unit;
    const mottle = 0.03 / unit;
    const clump = 0.06 / unit;
    const warp = 0.0035 / unit;
    for (let y = 0, i = 0; y < H; y += 1)
      for (let x = 0; x < W; x += 1, i += 1) {
        // Two lattices at an angle, so the tooth has no grid in it.
        const round =
          (noise(x * tooth, y * tooth) +
            noise((x * 0.8 - y * 0.6) * tooth + 31, (x * 0.6 + y * 0.8) * tooth + 7)) /
          2;
        paper[i] =
          0.6 * (0.5 + (round - 0.5) * 1.6) +
          0.15 * noise(x * grain + 5, y * grain) +
          0.25 * noise(x * mottle, y * mottle);
        settle[i] =
          0.4 * paper[i] +
          0.6 * (0.65 * noise(x * clump + 11, y * clump + 3) + 0.35 * noise(x * clump * 2.3 + 2, y * clump * 2.3 + 9));
        drag[i] = 0.55 * noise(x * 0.04 / unit + 3, y * 0.22 / unit + 1) + 0.45 * paper[i];
        blotch[i] = fbm(x * 0.006 / unit, y * 0.006 / unit, 3);
        streak[i] = fbm(x * 0.0025 / unit + 40, y * 0.02 / unit, 3);
        const wx = x * warp;
        const wy = y * warp;
        frill[i] = fbm(wx * 1.7 + 2.4 * noise(wx + 1.7, wy + 9.2), wy * 1.7 + 2.4 * noise(wx + 8.3, wy + 2.8), 5);
      }
  }
  // The level of `frill` above which a share `p` of the sheet lies.
  const frillLevel = (() => {
    const sample = [];
    for (let n = 0; n < 4000; n += 1) sample.push(frill[Math.floor(rand() * N)]);
    sample.sort((a, b) => b - a);
    return (p) => sample[Math.min(sample.length - 1, Math.max(0, Math.floor(p * sample.length)))];
  })();

  const sheet = scene.paper;
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i += 1) {
    const light = 0.985 + 0.03 * paper[i];
    out[i * 3] = sheet[0] * light;
    out[i * 3 + 1] = sheet[1] * light;
    out[i * 3 + 2] = sheet[2] * light;
  }

  const canvas = (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  };
  // Shapes are drawn with a margin around the sheet, so a wash that runs off
  // the sheet blurs as if the paper went on.
  const bleed = Math.ceil(320 * unit);
  const shape = canvas(W + 2 * bleed, H + 2 * bleed);
  const soft = canvas(W + 2 * bleed, H + 2 * bleed);
  const sctx = shape.getContext("2d", { willReadFrequently: true });
  const softCtx = soft.getContext("2d", { willReadFrequently: true });
  /** Clears the shape canvas and sets it up for drawing in sheet pixels. */
  const fresh = () => {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, shape.width, shape.height);
    sctx.setTransform(1, 0, 0, 1, bleed, bleed);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = "source-over";
  };
  const pixels = (ctx, [x0, y0, x1, y1]) => ctx.getImageData(x0 + bleed, y0 + bleed, x1 - x0, y1 - y0).data;
  const alpha = (ctx, box) => {
    const data = pixels(ctx, box);
    const a = new Float32Array(data.length / 4);
    for (let i = 0; i < a.length; i += 1) a[i] = data[i * 4 + 3] / 255;
    return a;
  };
  /** Draws `source` blurred by `radius` and moved down by `dy` on the soft
   * canvas. */
  const blur = (source, radius, dy = 0) => {
    softCtx.clearRect(0, 0, soft.width, soft.height);
    softCtx.filter = `blur(${radius}px)`;
    softCtx.drawImage(source, 0, dy);
    softCtx.filter = "none";
  };
  const clampBox = (box) => {
    const [x0, y0, x1, y1] = box ?? [0, 0, W, H];
    return [
      Math.max(0, Math.floor(x0)),
      Math.max(0, Math.floor(y0)),
      Math.min(W, Math.ceil(x1)),
      Math.min(H, Math.ceil(y1)),
    ];
  };
  // A reserve, as masking fluid: washes leave it white.
  const reserve = new Float32Array(N);

  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  // The pigment of each 8-bit channel value: a full wash multiplies by it.
  const logs = new Float32Array(256);
  for (let v = 0; v < 256; v += 1) logs[v] = Math.log(Math.max(0.02, v / 255));
  const fold = (v, n) => (v < n ? v : 2 * n - 1 - v);

  /** Draws shapes with `draw(ctx)`, then lays them as one wash. Each shape is
   * in its fill colour (the colour of a full wash on white paper), or all in
   * `color`. */
  function wash({
    color,
    density = 1,
    draw,
    box,
    wet = 0,
    edge = 0.5,
    granulation = 0.12,
    bloom = 0.35,
    streaks = 0,
    blooms = 0,
    dry = 0,
  }) {
    const area = clampBox(box);
    const [x0, y0, x1, y1] = area;
    fresh();
    sctx.fillStyle = color ?? "#fff";
    sctx.strokeStyle = color ?? "#fff";
    draw(sctx);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    if (wet > 0) {
      // Wet shapes run: their colours spread and mix.
      blur(shape, wet * unit);
      sctx.clearRect(0, 0, shape.width, shape.height);
      sctx.drawImage(soft, 0, 0);
    }
    const data = pixels(sctx, area);
    // Pigment gathers where the wash meets dry paper, and more at the lower
    // edge: the shape, blurred and moved up a little, is what is around.
    blur(shape, 3 * unit, -1.5 * unit);
    const around = alpha(softCtx, area);
    const fixed = color ? hex(color).map((c) => Math.log(Math.max(0.02, c))) : null;
    const sx = Math.floor(rand() * W);
    const sy = Math.floor(rand() * H);
    const level = blooms > 0 ? frillLevel(blooms) : 2;
    const bw = x1 - x0;
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) {
        const j = (y - y0) * bw + (x - x0);
        const m = data[j * 4 + 3] / 255;
        if (m < 0.003) continue;
        const i = y * W + x;
        let d = m * density;
        d *= 1 + edge * 3.2 * Math.max(0, m - around[j]);
        const k = fold((y + sy) % (2 * H), H) * W + fold((x + sx) % (2 * W), W);
        d *= 1 + bloom * (blotch[k] - 0.5) * 2.4;
        if (streaks) d *= 1 + streaks * (streak[k] - 0.5) * 2.6;
        if (blooms) {
          // Inside a bloom the pigment thins; at its edge it piles up.
          const f = frill[k] - level;
          if (f > 0) d *= 1 - 0.42 * smooth(0, 0.035, f);
          d *= 1 + 0.75 * Math.exp(-((f / 0.0045) ** 2));
        }
        d *= 1 + granulation * (0.5 - settle[i]) * 2.4;
        if (dry) d *= smooth(dry - 0.06, dry + 0.06, drag[i] + 0.3 * (blotch[k] - 0.5));
        d *= 1 - reserve[i];
        if (d <= 0) continue;
        const p0 = fixed ? fixed[0] : logs[data[j * 4]];
        const p1 = fixed ? fixed[1] : logs[data[j * 4 + 1]];
        const p2 = fixed ? fixed[2] : logs[data[j * 4 + 2]];
        out[i * 3] *= Math.exp(p0 * d);
        out[i * 3 + 1] *= Math.exp(p1 * d);
        out[i * 3 + 2] *= Math.exp(p2 * d);
      }
  }

  /** Graphite lines from `draw(ctx)`: they catch on the paper's peaks. */
  function pencil({ draw, strength = 0.35, color = "#4d4c55" }) {
    fresh();
    sctx.strokeStyle = "#fff";
    sctx.fillStyle = "#fff";
    sctx.lineCap = "round";
    sctx.lineJoin = "round";
    draw(sctx);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    const mask = alpha(sctx, [0, 0, W, H]);
    const tone = hex(color);
    for (let i = 0; i < N; i += 1) {
      const m = mask[i];
      if (m < 0.01) continue;
      const k = m * strength * (0.3 + 0.9 * paper[i]);
      for (let c = 0; c < 3; c += 1) out[i * 3 + c] *= 1 - k * (1 - tone[c]);
    }
  }

  /** The shapes from `draw(ctx)` as a mask, soft by `wet`. */
  const maskOf = (draw, wet) => {
    fresh();
    sctx.fillStyle = "#fff";
    sctx.strokeStyle = "#fff";
    draw(sctx);
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!(wet > 0)) return alpha(sctx, [0, 0, W, H]);
    blur(shape, wet * unit);
    return alpha(softCtx, [0, 0, W, H]);
  };

  /** Masking fluid: later washes leave these shapes white. */
  function protect({ draw, wet = 0 }) {
    const mask = maskOf(draw, wet);
    for (let i = 0; i < N; i += 1) reserve[i] = Math.max(reserve[i], mask[i]);
  }

  /** Takes pigment back off, as a damp brush or tissue does. */
  function lift({ draw, amount = 0.6, wet = 0 }) {
    const mask = maskOf(draw, wet);
    for (let i = 0; i < N; i += 1) {
      const a = mask[i] * amount * (0.75 + 0.5 * paper[i]);
      if (a < 0.003) continue;
      for (let c = 0; c < 3; c += 1) out[i * 3 + c] += (sheet[c] - out[i * 3 + c]) * a;
    }
  }

  // Shapes, in pixels. Rough edges come from noise along the outline.
  const shapes = {
    /** A closed outline through points, with each point pushed in or out. */
    outline(ctx, points, rough = 0) {
      ctx.beginPath();
      points.forEach(([x, y], n) => {
        const jx = rough ? (noise(x * 0.02 + n, y * 0.02) - 0.5) * rough * unit : 0;
        const jy = rough ? (noise(y * 0.02, x * 0.02 + n) - 0.5) * rough * unit : 0;
        if (n === 0) ctx.moveTo(x + jx, y + jy);
        else ctx.lineTo(x + jx, y + jy);
      });
      ctx.closePath();
      ctx.fill();
    },
    /** A blob around (cx, cy) with radii rx and ry. */
    blob(ctx, cx, cy, rx, ry, rough = 0.25, turn = 0) {
      const points = [];
      const offset = rand() * 100;
      for (let n = 0; n < 72; n += 1) {
        const a = (n / 72) * Math.PI * 2;
        const r = 1 + rough * (fbm(Math.cos(a) * 1.6 + offset, Math.sin(a) * 1.6, 3) - 0.5) * 2;
        const x = Math.cos(a) * rx * r;
        const y = Math.sin(a) * ry * r;
        points.push([cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)]);
      }
      shapes.outline(ctx, points);
    },
    /** A band between top(x) and bottom(x), from x0 to x1, with ragged ends. */
    band(ctx, x0, x1, top, bottom, rough = 12) {
      const points = [];
      const steps = Math.max(8, Math.round((x1 - x0) / (6 * unit)));
      for (let n = 0; n <= steps; n += 1) {
        const x = x0 + ((x1 - x0) * n) / steps;
        points.push([x, top(x) + (noise(x * 0.03 / unit, 3) - 0.5) * rough * unit]);
      }
      for (let n = steps; n >= 0; n -= 1) {
        const x = x0 + ((x1 - x0) * n) / steps;
        points.push([x, bottom(x) + (noise(x * 0.03 / unit, 9) - 0.5) * rough * unit]);
      }
      shapes.outline(ctx, points, rough * 0.4);
    },
    /** A flat brush's mark, centred on (cx, cy): the brush, `width` wide and
     * held at `tilt` from square, drawn `length` along `turn`, bowing a
     * little. It is full where it starts and thins as the brush runs dry,
     * where the bristles leave gaps. */
    flat(ctx, cx, cy, length, width, turn = 0, { bow = 0.06, tilt = 0.35, dry = 0.5, fade = 0.7 } = {}) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const to = (a, b) => [cx + a * c - b * s, cy + a * s + b * c];
      const offset = rand() * 100;
      const curve = (rand() - 0.5) * 2 * bow * length;
      const lean = tilt * width * (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.4);
      const top = [];
      const bottom = [];
      const steps = 14;
      for (let n = 0; n <= steps; n += 1) {
        const t = n / steps;
        const a = (t - 0.5) * length;
        const b = curve * 4 * t * (1 - t);
        // Pressure: the sides waver, and the end narrows as the paint runs out.
        const narrow = 1 - dry * 0.35 * smooth(0.6, 1, t);
        const wt = (width / 2) * narrow * (1 + 0.16 * (noise(offset + t * 3.1, 1) - 0.5) * 2);
        const wb = (width / 2) * narrow * (1 + 0.16 * (noise(offset + t * 3.1, 7) - 0.5) * 2);
        top.push(to(a - lean / 2, b - wt));
        bottom.push(to(a + lean / 2, b + wb));
      }
      // The blunt start bulges a little; the end is ragged.
      const start = [to(-length / 2 - width * 0.12, 0)];
      const end = [];
      for (let n = 1; n < 4; n += 1) {
        const t = n / 4;
        end.push(to(length / 2 + (rand() - 0.3) * width * 0.35 * dry + lean * (t - 0.5), (t - 0.5) * width * 0.9));
      }
      const fill = ctx.fillStyle;
      if (typeof fill === "string" && fill.startsWith("#") && fade < 1) {
        const [r, g, b] = hex(fill).map((v) => Math.round(v * 255));
        const [ax, ay] = to(-length / 2, 0);
        const [bx, by] = to(length / 2, 0);
        const gradient = ctx.createLinearGradient(ax, ay, bx, by);
        gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
        gradient.addColorStop(1, `rgba(${r},${g},${b},${fade})`);
        ctx.fillStyle = gradient;
      }
      ctx.beginPath();
      [...start, ...top, ...end, ...bottom.reverse()].forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fill;
      // Gaps between the bristles toward the end.
      if (dry > 0) {
        const op = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = "destination-out";
        const gaps = Math.round(dry * (1 + rand() * 3));
        for (let n = 0; n < gaps; n += 1) {
          const b = (rand() - 0.5) * width * 0.8;
          const from = length * (0.05 + rand() * 0.35);
          const thick = (0.5 + rand() * 1.2) * unit;
          ctx.beginPath();
          ctx.moveTo(...to(from, b));
          ctx.lineTo(...to(length * 0.6, b - thick));
          ctx.lineTo(...to(length * 0.6, b + thick));
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalCompositeOperation = op;
      }
    },
    /** A brush stroke along points, `width` wide, thinning at its ends. */
    stroke(ctx, points, width) {
      const left = [];
      const right = [];
      for (let n = 0; n < points.length; n += 1) {
        const [x, y] = points[n];
        const [px, py] = points[Math.max(0, n - 1)];
        const [nx, ny] = points[Math.min(points.length - 1, n + 1)];
        const dx = nx - px;
        const dy = ny - py;
        const len = Math.hypot(dx, dy) || 1;
        const t = n / (points.length - 1);
        const w = (width / 2) * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.88)) ** 0.6;
        left.push([x - (dy / len) * w, y + (dx / len) * w]);
        right.push([x + (dy / len) * w, y - (dx / len) * w]);
      }
      shapes.outline(ctx, [...left, ...right.reverse()]);
    },
    /** A pencil line that wavers and breaks. */
    line(ctx, points, width = 1.1) {
      ctx.lineWidth = width * unit;
      for (let n = 1; n < points.length; n += 1) {
        if (rand() < 0.12) continue;
        const [ax, ay] = points[n - 1];
        const [bx, by] = points[n];
        ctx.globalAlpha = 0.45 + rand() * 0.55;
        ctx.beginPath();
        ctx.moveTo(ax + (rand() - 0.5) * unit, ay + (rand() - 0.5) * unit);
        ctx.lineTo(bx + (rand() - 0.5) * unit, by + (rand() - 0.5) * unit);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  };

  scene.paint({ W, H, unit, bleed, rand, noise, fbm, smooth, wash, pencil, protect, lift, shapes });

  const result = canvas(W, H);
  const rctx = result.getContext("2d");
  const image = rctx.createImageData(W, H);
  for (let i = 0; i < N; i += 1) {
    image.data[i * 4] = Math.round(Math.max(0, Math.min(1, out[i * 3])) * 255);
    image.data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, out[i * 3 + 1])) * 255);
    image.data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, out[i * 3 + 2])) * 255);
    image.data[i * 4 + 3] = 255;
  }
  rctx.putImageData(image, 0, 0);
  return result.toDataURL("image/png");
};
