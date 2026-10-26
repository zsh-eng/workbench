import {
  carriedEdge,
  creaseUnder,
  Leaf,
  LEAF_NODES,
  LEAF_WIDTH,
} from "@/features/reader/paper/leaf-physics";
import { resolvePaper } from "@/features/reader/paper/paper-preference";
import { describe, expect, it } from "vitest";

const ROLL = 0.25 * LEAF_WIDTH;

/** Gravity leaning away from a hilltop 9° up, as the Reader's turn sets it. */
function hill(leaf: Leaf) {
  leaf.tilt =
    (Math.PI / 3) *
    Math.tanh((leaf.angle() - (9 * Math.PI) / 180) / ((6 * Math.PI) / 180));
}

/** Carries the edge `fraction` of the page leftward over `seconds`. */
function carry(fraction: number, seconds: number): Leaf {
  const leaf = new Leaf("right");
  const frames = Math.round(seconds * 60);
  for (let frame = 1; frame <= frames; frame++) {
    const travel = 1.6 * fraction * LEAF_WIDTH * (frame / frames);
    const [x, z, angle] = carriedEdge(
      creaseUnder(LEAF_WIDTH - travel, ROLL),
      ROLL,
    );
    leaf.holdAt(LEAF_NODES, x, z + 0.0005, angle);
    hill(leaf);
    leaf.advance(1 / 60);
  }
  return leaf;
}

/** Lets the leaf fall; where it lands, and its fastest point on the way. */
function fall(leaf: Leaf): { side: "left" | "right" | "none"; peak: number } {
  let peak = 0;
  for (let elapsed = 0; elapsed < 4; elapsed += 1 / 60) {
    hill(leaf);
    leaf.advance(1 / 60);
    peak = Math.max(peak, leaf.maxSpeed());
    if (leaf.goneLeft()) return { side: "left", peak };
    if (leaf.landedRight()) return { side: "right", peak };
  }
  return { side: "none", peak };
}

describe("leaf physics", () => {
  it("leaves a page alone on its stack", () => {
    const leaf = new Leaf("right");
    for (let frame = 0; frame < 60; frame++) {
      hill(leaf);
      leaf.advance(1 / 60);
    }
    expect(leaf.landedRight()).toBe(true);
    expect(leaf.reach()).toBeCloseTo(LEAF_WIDTH, 3);
  });

  it("lets a short carry fall back and a long one fall over", () => {
    for (const fraction of [0.1, 0.2, 0.3]) {
      const leaf = carry(fraction, 0.5);
      leaf.release();
      expect(fall(leaf).side).toBe("right");
    }
    for (const fraction of [0.4, 0.5, 0.6]) {
      const leaf = carry(fraction, 0.5);
      leaf.release();
      expect(fall(leaf).side).toBe("left");
    }
  });

  it("sends a short carry over when it is flicked", () => {
    const leaf = carry(0.2, 0.1);
    leaf.release();
    leaf.spin(2);
    expect(fall(leaf).side).toBe("left");
  });

  it("knows where a page let go will land", () => {
    for (const fraction of [0.15, 0.3, 0.45, 0.6]) {
      const leaf = carry(fraction, 0.5);
      leaf.release();
      const forecast = leaf.predict(hill);
      expect(fall(leaf).side).toBe(forecast);
    }
  });

  it("does not snap open when a curled page is let go", () => {
    const leaf = carry(0.3, 0.5);
    leaf.release();
    expect(fall(leaf).peak).toBeLessThan(2);
  });
});

describe("paper preference", () => {
  it("previews where the ink sits from the address", () => {
    const saved = {
      pageTurn: "curl" as const,
      grain: "fine" as const,
      ink: "in" as const,
      marks: "marker" as const,
      grip: "anywhere" as const,
      bookBlock: true,
      showThrough: true,
      haptics: true,
      sound: false,
    };
    expect(resolvePaper(true, saved, new URLSearchParams("ink=gl")).ink).toBe(
      "gl",
    );
    expect(resolvePaper(true, saved, new URLSearchParams("ink=x")).ink).toBe(
      "in",
    );
    expect(
      resolvePaper(false, saved, new URLSearchParams("ink=gl")).grain,
    ).toBe("off");
  });

  it("previews the hold, the highlights and the book from the address", () => {
    const saved = {
      pageTurn: "curl" as const,
      grain: "fine" as const,
      ink: "in" as const,
      marks: "marker" as const,
      grip: "anywhere" as const,
      bookBlock: true,
      showThrough: true,
      haptics: true,
      sound: false,
    };
    const preview = resolvePaper(
      true,
      saved,
      new URLSearchParams("grip=edge&marks=flat&block=off"),
    );
    expect([preview.grip, preview.marks, preview.bookBlock]).toEqual([
      "edge",
      "flat",
      false,
    ]);
    // The wash was folded into the marker; an old link keeps the marker.
    const washed = resolvePaper(true, saved, new URLSearchParams("marks=wash"));
    expect(washed.marks).toBe("marker");
    const kept = resolvePaper(true, saved, new URLSearchParams("grip=x"));
    expect([kept.grip, kept.marks, kept.bookBlock]).toEqual([
      "anywhere",
      "marker",
      true,
    ]);
  });
});
