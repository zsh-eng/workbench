import { describe, expect, test } from "bun:test";
import {
  AWAY_FOR_CHECK_MS,
  AWAY_FOR_UPDATE_MS,
  updateMoment,
  updatePolicy,
  type UpdateContext,
} from "./update-policy";

const context = (extra: Partial<UpdateContext> = {}): UpdateContext => ({
  reviewing: false,
  busy: false,
  pageAgeMs: 60_000,
  touched: true,
  required: false,
  ...extra,
});
const ready = { status: "ready" as const, takenOver: false };
const back = (awayMs: number) => ({ type: "visible" as const, awayMs });

describe("updatePolicy", () => {
  test("switches at a launch, before the first tap, even with a card shown", () => {
    expect(
      updatePolicy(
        context({ pageAgeMs: 1_000, touched: false, reviewing: true }),
      ),
    ).toBe("now");
  });

  test("waits once you have touched the page, or after five seconds", () => {
    expect(updatePolicy(context({ pageAgeMs: 1_000, touched: true }))).toBe(
      "wait",
    );
    expect(updatePolicy(context({ pageAgeMs: 6_000, touched: false }))).toBe(
      "wait",
    );
  });

  test("waits at a launch that restored a download", () => {
    expect(
      updatePolicy(context({ pageAgeMs: 1_000, touched: false, busy: true })),
    ).toBe("wait");
  });
});

describe("updateMoment", () => {
  test("never switches while a card is on the review screen", () => {
    const reviewing = context({ reviewing: true });
    expect(updateMoment(ready, back(60 * 60_000), reviewing)).toBeNull();
    expect(
      updateMoment({ ...ready, takenOver: true }, { type: "route" }, reviewing),
    ).toBeNull();
    expect(
      updateMoment(
        ready,
        { type: "route" },
        context({ reviewing: true, required: true }),
      ),
    ).toBeNull();
  });

  test("switches when you come back after two minutes away from a review", () => {
    expect(updateMoment(ready, back(AWAY_FOR_UPDATE_MS), context())).toBe(
      "apply",
    );
    expect(
      updateMoment(ready, back(AWAY_FOR_UPDATE_MS - 1), context()),
    ).toBeNull();
    expect(updateMoment(ready, { type: "route" }, context())).toBeNull();
  });

  test("waits while busy", () => {
    expect(
      updateMoment(ready, back(AWAY_FOR_UPDATE_MS), context({ busy: true })),
    ).toBeNull();
  });

  test("a switch in another tab, or a 410, applies at the next moment", () => {
    expect(
      updateMoment({ ...ready, takenOver: true }, { type: "route" }, context()),
    ).toBe("apply");
    expect(
      updateMoment(ready, { type: "route" }, context({ required: true })),
    ).toBe("apply");
  });

  test("checks for a version after a long time away, or when sync needs one", () => {
    const idle = { status: "idle" as const, takenOver: false };
    expect(updateMoment(idle, back(AWAY_FOR_CHECK_MS), context())).toBe(
      "check",
    );
    expect(updateMoment(idle, back(AWAY_FOR_UPDATE_MS), context())).toBeNull();
    expect(
      updateMoment(idle, { type: "route" }, context({ required: true })),
    ).toBe("check");
  });
});
