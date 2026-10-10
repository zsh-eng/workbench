// A painterly renderer: a smooth ground, then thousands of tapered bristle
// strokes in passes from large to small. Each stroke takes its colour, angle,
// and size from a scene (scenes.js). Runs in a browser page; paint.ts drives it.
// Random numbers come from a seeded generator, so a scene paints the same
// picture each time.
window.paint = function paint({ width, height, seed = 7, scene }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d");
  let state = seed >>> 0;
  const rand = () =>
    (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const css = (color, alpha) =>
    `rgba(${color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(",")},${alpha})`;

  // The ground: the scene without strokes.
  const ground = g.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = scene.color(x / width, y / height);
      const i = (y * width + x) * 4;
      ground.data[i] = color[0] * 255;
      ground.data[i + 1] = color[1] * 255;
      ground.data[i + 2] = color[2] * 255;
      ground.data[i + 3] = 255;
    }
  }
  g.putImageData(ground, 0, 0);

  // Stroke sizes are for an 1800-pixel-wide canvas.
  const unit = width / 1800;
  g.lineCap = "round";
  for (const pass of scene.passes) {
    for (let n = 0; n < pass.count; n += 1) {
      const u = rand();
      const v = rand();
      // Detail is low near edges in the scene, where strokes must be small.
      const detail = scene.detail(u, v);
      if (detail < pass.min) continue;
      const radius =
        pass.size * unit * (0.6 + rand() * 0.8) * Math.min(detail, 1.4);
      const length =
        radius * pass.stretch * scene.stretch(u, v) * (0.6 + rand() * 0.8);
      // Each stroke is a little warmer or cooler, lighter or darker.
      const warm = (rand() - 0.5) * pass.jitter;
      const light = (rand() - 0.5) * pass.jitter;
      const tint = [
        warm,
        warm * 0.3 + (rand() - 0.5) * pass.jitter * 0.4,
        -warm + (rand() - 0.5) * pass.jitter * 0.4,
      ];
      const color = scene.color(u, v).map((c, k) => c + tint[k] + light);

      g.save();
      g.translate(u * width, v * height);
      g.rotate(scene.angle(u, v, rand));
      const bristles = 7;
      const bend = (rand() - 0.5) * radius * 0.8;
      g.lineWidth = (radius * 2) / bristles + 0.9 * unit;
      for (let b = 0; b < bristles; b += 1) {
        const across = (b + 0.5) / bristles - 0.5;
        const offset = across * radius * 2;
        // Outer bristles are shorter, so the stroke tapers.
        const reach =
          length * (1 - Math.abs(across) * 0.9) * (0.75 + rand() * 0.25);
        const shade = (rand() - 0.5) * 0.04;
        g.strokeStyle = css(
          color.map((c) => c + shade),
          pass.alpha * (0.45 + rand() * 0.55),
        );
        const start = -reach / 2 + (rand() - 0.5) * radius * 0.4;
        g.beginPath();
        g.moveTo(start, offset);
        g.quadraticCurveTo(0, offset + bend, reach / 2, offset + bend * 0.3);
        g.stroke();
      }
      g.restore();
    }
  }
  scene.finish?.(g, width, height, rand);
  return canvas.toDataURL("image/png");
};
