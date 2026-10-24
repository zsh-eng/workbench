import { expect, it } from "bun:test";
import { ActiveTime } from "../src";

it("counts short intervals between inputs and nothing for a long one", () => {
  // The worked example in READING_TIME.md.
  const time = new ActiveTime(120_000);
  time.resume(0);
  time.input(40_000);
  time.input(75_000);
  time.input(240_000);
  expect(time.activeMs).toBe(75_000);
  time.input(250_000);
  expect(time.activeMs).toBe(85_000);
});

it("counts an interval of exactly the gap, and none a millisecond longer", () => {
  const time = new ActiveTime(120_000);
  time.resume(0);
  time.input(120_000);
  expect(time.activeMs).toBe(120_000);
  time.input(240_001);
  expect(time.activeMs).toBe(120_000);
});

it("counts up to a pause and nothing until the interval opens again", () => {
  const time = new ActiveTime(120_000);
  time.resume(0);
  time.pause(30_000);
  time.pause(60_000);
  expect(time.running).toBe(false);
  time.resume(500_000);
  time.input(510_000);
  expect(time.activeMs).toBe(40_000);
});

it("starts a fresh boundary when the clock runs backwards", () => {
  const time = new ActiveTime(120_000);
  time.resume(100_000);
  time.input(40_000);
  time.input(50_000);
  expect(time.activeMs).toBe(10_000);
});
