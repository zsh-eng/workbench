import { describe, expect, it } from "vitest";
import {
  computeCurlFold,
  creaseDistance,
  flatPartPolygon,
  turnProgress,
  type CurlFold,
} from "@/features/reader/paper/curl-geometry";

const WIDTH = 390;
const HEIGHT = 760;

function fold(progress: number, grabY = HEIGHT / 2, dragY = 0): CurlFold {
  return computeCurlFold({
    width: WIDTH,
    height: HEIGHT,
    progress,
    grabY,
    dragY,
  });
}

/** Where a point of the page lands on screen, as the shader places it. */
function landing(curl: CurlFold, x: number, y: number): [number, number] {
  const depth = creaseDistance(curl, x, y);
  if (depth <= 0) return [x, y];
  const halfTurn = Math.PI * curl.radius;
  const travel =
    depth < halfTurn
      ? depth - curl.radius * Math.sin(depth / curl.radius)
      : 2 * depth - halfTurn;
  return [x - curl.normalX * travel, y - curl.normalY * travel];
}

describe("page curl geometry", () => {
  it("lies flat at rest and lays the page over the spine at the end", () => {
    expect(turnProgress(0, WIDTH)).toBeNull();
    expect(fold(0).originX).toBe(WIDTH);

    const done = fold(1);
    for (const [x, y] of [
      [0, 0],
      [WIDTH, 0],
      [0, HEIGHT],
      [WIDTH, HEIGHT],
    ] as const) {
      expect(creaseDistance(done, x, y)).toBeGreaterThan(0);
    }
    expect(landing(done, WIDTH, HEIGHT / 2)[0]).toBeLessThanOrEqual(-WIDTH);
  });

  it("keeps the lifted edge under the finger early in a turn", () => {
    const pulled = 30;
    const grabY = HEIGHT / 2;
    const curl = fold(pulled / WIDTH, grabY, -12);
    const [x, y] = landing(curl, WIDTH, grabY);
    expect(Math.abs(x - (WIDTH - pulled))).toBeLessThan(3);
    expect(Math.abs(y - (grabY - 12))).toBeLessThan(1);
  });

  it("moves the crease steadily across the page", () => {
    let previous = WIDTH;
    for (let step = 1; step <= 10; step++) {
      const curl = fold(step / 10);
      expect(curl.originX).toBeLessThan(previous);
      previous = curl.originX;
    }
  });

  it("lifts the corner nearest a low grab first", () => {
    const curl = fold(0.3, HEIGHT * 0.9);
    expect(creaseDistance(curl, WIDTH, HEIGHT)).toBeGreaterThan(
      creaseDistance(curl, WIDTH, 0),
    );
  });

  it("keeps the same shape when the turning page is promoted mid-turn", () => {
    const forward = turnProgress(-0.6 * WIDTH, WIDTH);
    const backward = turnProgress(0.4 * WIDTH, WIDTH);
    expect(forward?.side).toBe("next");
    expect(backward?.side).toBe("previous");
    expect(forward?.progress).toBeCloseTo(backward!.progress, 10);
  });

  it("keeps the spine side of the page flat and gives up the held edge", () => {
    const polygon = flatPartPolygon(fold(0.25), WIDTH, HEIGHT);
    expect(polygon).toContain("0.00px 0.00px");
    expect(polygon).toContain(`0.00px ${HEIGHT}.00px`);
    expect(polygon).not.toContain(`${WIDTH}.00px ${HEIGHT}.00px`);
  });
});
