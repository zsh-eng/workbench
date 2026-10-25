import { foreEdgeWidth } from "@/features/reader/paper/BookBlock";
import {
  apexY,
  gripFrame,
  holdAngle,
  rollFrame,
  sectionAt,
  toSection,
} from "@/features/reader/paper/sheet-frame";
import { describe, expect, it } from "vitest";

const WIDTH = 380;
const HEIGHT = 760;

describe("sheet frame", () => {
  it("finds every page point again from its place on the section", () => {
    for (const frame of [
      rollFrame(400, 0.1, WIDTH),
      gripFrame(360, 740, 0.5, WIDTH),
      gripFrame(300, 20, -0.4, WIDTH),
    ]) {
      for (const [x, y] of [
        [0, 0],
        [WIDTH, HEIGHT],
        [120, 400],
        [WIDTH, 10],
      ] as const) {
        const [s, w] = toSection(frame, x, y);
        const point = sectionAt(frame, s);
        expect(point.x + point.ux * w).toBeCloseTo(x, 6);
        expect(point.y + point.uy * w).toBeCloseTo(y, 6);
      }
    }
  });

  it("keeps the spine a ruling, so the spine side stays flat", () => {
    const frame = gripFrame(360, 740, 0.5, WIDTH);
    const top = toSection(frame, 0, 0)[0];
    const foot = toSection(frame, 0, HEIGHT)[0];
    expect(top).toBeCloseTo(0, 6);
    expect(foot).toBeCloseTo(0, 6);
  });

  it("lets a corner fold steeply but the middle of the edge hardly", () => {
    const corner = holdAngle(360, HEIGHT - 10, 0.6, WIDTH, HEIGHT);
    const middle = holdAngle(360, HEIGHT / 2, 0.6, WIDTH, HEIGHT);
    expect(corner).toBeGreaterThan(0.3);
    expect(middle).toBeLessThan(0.1);
    // Either way, the apex stays off the page.
    for (const [y, angle] of [
      [HEIGHT - 10, corner],
      [HEIGHT / 2, middle],
    ] as const) {
      const apex = apexY(gripFrame(360, y, angle, WIDTH));
      if (apex !== null) expect(apex < 0 || apex > HEIGHT).toBe(true);
    }
  });
});

describe("book block", () => {
  it("narrows the fore-edge as pages are read, and ends with the book", () => {
    expect(foreEdgeWidth(400)).toBeGreaterThan(foreEdgeWidth(100));
    expect(foreEdgeWidth(100)).toBeGreaterThan(foreEdgeWidth(10));
    expect(foreEdgeWidth(5000)).toBeLessThanOrEqual(7);
    expect(foreEdgeWidth(0)).toBe(0);
  });
});
