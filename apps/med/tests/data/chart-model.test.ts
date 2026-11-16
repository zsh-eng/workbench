import { expect, test } from "vitest";
import {
  areaPath,
  extent,
  formatSpan,
  formatTick,
  formatValue,
  linearDomain,
  linePath,
  logDomain,
  nearestIndex,
  seriesCsv,
  timeTicks,
  type Point,
} from "../../src/web/components/chart/chart-model";

test("values read in their unit, shorter on an axis", () => {
  expect(formatValue(38.4, "ms")).toBe("38 ms");
  expect(formatValue(4.25, "ms")).toBe("4.3 ms");
  expect(formatValue(2160, "ms")).toBe("2.16 s");
  expect(formatValue(2160, "ms", true)).toBe("2.2 s");
  expect(formatValue(0, "ms", true)).toBe("0");
  expect(formatValue(1284, "req/s")).toBe("1.28k req/s");
  expect(formatValue(1500, "req/s", true)).toBe("1.5k");
  expect(formatValue(1_600_000, "", true)).toBe("1.6M");
  expect(formatValue(12.5, "%")).toBe("13%");
  expect(formatValue(1_500_000, "B")).toBe("1.5 MB");
});

test("a linear axis ends on round values and starts at zero for spread-out positives", () => {
  expect(linearDomain(30, 4120)).toEqual({
    min: 0,
    max: 5000,
    ticks: [0, 1000, 2000, 3000, 4000, 5000],
  });
  expect(linearDomain(310, 1350).ticks).toEqual([0, 500, 1000, 1500]);
  const near = linearDomain(96, 104);
  expect(near.min).toBeGreaterThan(0);
  expect(near.min).toBeLessThanOrEqual(96);
  expect(near.max).toBeGreaterThanOrEqual(104);
  // No data draws an axis rather than failing.
  expect(linearDomain(Infinity, -Infinity)).toEqual({ min: 0, max: 1, ticks: [0, 1] });
});

test("a log axis fits the values, with 1-2-5 ticks over a few decades and decades over many", () => {
  const latency = logDomain(30, 4120);
  expect(latency.min).toBeLessThan(Math.log10(30));
  expect(latency.max).toBeGreaterThan(Math.log10(4120));
  expect(latency.ticks).toEqual([50, 100, 200, 500, 1000, 2000, 5000]);
  expect(logDomain(40, 1_600_000).ticks).toEqual([100, 1000, 10_000, 100_000, 1_000_000]);
  expect(logDomain(Infinity, -Infinity).ticks).toEqual([1, 10]);
});

test("time ticks land on the local clock, about the given distance apart", () => {
  const nine = new Date(2026, 10, 16, 9, 0).getTime();
  const noon = new Date(2026, 10, 16, 12, 0).getTime();
  const { ticks, step } = timeTicks(nine, noon, 640);
  expect(step).toBe(30 * 60_000);
  expect(ticks.map((tick) => formatTick(tick, step))).toEqual([
    "09:00",
    "09:30",
    "10:00",
    "10:30",
    "11:00",
    "11:30",
    "12:00",
  ]);
  const day = timeTicks(nine - 24 * 3_600_000, nine, 640);
  expect(day.ticks.map((tick) => formatTick(tick, day.step))).toContain("Nov 16");
  expect(formatSpan(24 * 3_600_000)).toBe("Last 24 hours");
  expect(formatSpan(7 * 24 * 3_600_000)).toBe("Last 7 days");
});

test("a path breaks at a gap and keeps a spike when points crowd a pixel", () => {
  const points: Point[] = [
    [0, 1],
    [1, 2],
    [2, null],
    [3, 3],
    [4, 4],
  ];
  const path = linePath(
    points,
    (time) => time * 10,
    (value) => value,
  );
  expect(path).toBe("M0.0,1.0L10.0,2.0M30.0,3.0L40.0,4.0");
  expect(areaPath(path, 50)).toBe(
    "M0.0,50.0L0.0,1.0L10.0,2.0L10.0,50.0ZM30.0,50.0L30.0,3.0L40.0,4.0L40.0,50.0Z",
  );
  // A thousand points over ten pixels: the spike at 500 survives.
  const crowded: Point[] = Array.from({ length: 1000 }, (_, index) => [
    index,
    index === 500 ? 900 : 10,
  ]);
  const short = linePath(
    crowded,
    (time) => time / 100,
    (value) => value,
  );
  expect(short.length).toBeLessThan(800);
  expect(short).toContain(",900.0");
});

test("the nearest point and the extent between two times", () => {
  const points: Point[] = [
    [0, 5],
    [10, 50],
    [20, null],
    [30, 0.5],
  ];
  expect(nearestIndex(points, 4)).toBe(0);
  expect(nearestIndex(points, 6)).toBe(1);
  expect(nearestIndex(points, 99)).toBe(3);
  expect(extent([{ name: "a", points }], 0, 30)).toEqual({ min: 0.5, max: 50, positive: 0.5 });
});

test("CSV has a column for each series, on every time either has", () => {
  const csv = seriesCsv([
    { name: "p50", points: [[0, 1]] },
    {
      name: 'p99, "tail"',
      points: [
        [0, 9],
        [60_000, 8],
      ],
    },
  ]);
  expect(csv).toBe(
    'time,p50,"p99, ""tail"""\n1970-01-01T00:00:00.000Z,1,9\n1970-01-01T00:01:00.000Z,,8',
  );
});
