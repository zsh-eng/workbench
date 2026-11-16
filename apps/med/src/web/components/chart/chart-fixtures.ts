// Invented but lifelike data for the Elements page: the same numbers on each
// load, so a screenshot or a recording repeats.
import type { Bar, Point, Series } from "./chart-model";

const MINUTE = 60_000;

/** A seeded random number between 0 and 1 (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Noise that drifts rather than jumps: each step leans on the last. */
function drift(seed: number, keep = 0.82) {
  const next = random(seed);
  let level = 0;
  return () => {
    const kick = next() + next() + next() - 1.5;
    level = level * keep + kick * (1 - keep) * 2.2;
    return level;
  };
}

/** Today at `hours` o'clock, local time. */
export function today(hours: number, minutes = 0) {
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

/** Checkout latency from 09:00 to 12:00: a deploy at 10:42 sends p99 past
 * two seconds until the rollback at 11:05. */
export function checkoutLatency(): Series[] {
  const start = today(9);
  const deploy = today(10, 42);
  const rollback = today(11, 5);
  const noise = [drift(3), drift(5), drift(8)];
  const spikes = random(13);
  const p50: Point[] = [];
  const p95: Point[] = [];
  const p99: Point[] = [];
  for (let time = start; time <= today(12); time += 15_000) {
    const minutes = (time - start) / MINUTE;
    const day = 1 + 0.14 * Math.sin((minutes / 180) * Math.PI);
    const severity =
      time < deploy
        ? 0
        : time < rollback
          ? Math.min(1, (time - deploy) / (4 * MINUTE)) * (0.85 + 0.15 * Math.sin(minutes / 2.3))
          : Math.exp(-(time - rollback) / (7 * MINUTE));
    const spike = spikes() < 0.012 ? 1.9 : 1;
    p50.push([time, round(38 * day * (1 + 0.45 * severity) * (1 + 0.07 * noise[0]!()))]);
    p95.push([time, round(118 * day * (1 + 2.6 * severity) * (1 + 0.12 * noise[1]!()))]);
    p99.push([time, round(265 * day * (1 + 8.4 * severity) * (1 + 0.2 * noise[2]!()) * spike)]);
  }
  return [
    { name: "p50", points: p50 },
    { name: "p95", points: p95 },
    { name: "p99", points: p99 },
  ];
}

/** Requests over the last day, every 5 minutes, busiest in the afternoon. */
export function requestRate(now = Date.now()): Series[] {
  const noise = drift(21, 0.9);
  const points: Point[] = [];
  const end = Math.floor(now / (5 * MINUTE)) * 5 * MINUTE;
  for (let time = end - 24 * 60 * MINUTE; time <= end; time += 5 * MINUTE) {
    const hour = new Date(time).getHours() + new Date(time).getMinutes() / 60;
    const shape = Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI)) ** 1.4;
    points.push([time, round(310 + 1040 * shape + 70 * noise())]);
  }
  return [{ name: "checkout-api", points }];
}

/** The ingest backlog: steady, then ten thousand times larger in 45 minutes,
 * then drained. On a log scale the growth is a straight line. */
export function ingestBacklog(): Series[] {
  const start = today(13);
  const noise = drift(34);
  const points: Point[] = [];
  for (let time = start; time <= today(15); time += 30_000) {
    const minutes = (time - start) / MINUTE;
    const level =
      minutes < 38
        ? 140
        : minutes < 84
          ? 140 * 1.225 ** (minutes - 38)
          : 140 * 1.225 ** 46 * 0.74 ** (minutes - 84);
    points.push([time, Math.max(40, round(level * (1 + 0.16 * noise())))]);
  }
  return [{ name: "messages", points }];
}

/** How long a thread takes to open, by release. */
export const openTimes: Bar[] = [
  { label: "v0.14.5 (this build)", value: 182, highlight: true },
  { label: "v0.14.4", value: 241 },
  { label: "v0.14.0", value: 236 },
  { label: "v0.13.0", value: 318 },
  { label: "v0.12.0", value: 405 },
];

function round(value: number) {
  return value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
}
