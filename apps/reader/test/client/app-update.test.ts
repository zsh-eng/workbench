import {
  AWAY_FOR_CHECK_MS,
  AWAY_FOR_UPDATE_MS,
  LAUNCH_MS,
  updateMoment,
  updatePolicy,
  type UpdateMomentContext,
} from "@/lib/app-update";
import { describe, expect, it } from "vitest";

const library: UpdateMomentContext = {
  calm: true,
  pathname: "/",
  busy: false,
  pageAgeMs: 60_000,
};
const reading = { ...library, pathname: "/reader/emma" };
const ready = { status: "ready", takenOver: false } as const;
const idle = { status: "idle", takenOver: false } as const;
const away = (awayMs: number) => ({ type: "visible", awayMs }) as const;

describe("without Calm updates", () => {
  it("switches as soon as an update is ready, as the app always has", () => {
    expect(updatePolicy({ ...reading, calm: false })).toBe("now");
    expect(
      updateMoment(ready, away(AWAY_FOR_UPDATE_MS), {
        ...library,
        calm: false,
      }),
    ).toBeNull();
  });
});

describe("with Calm updates", () => {
  it("waits for a safe moment once the page is in use", () => {
    expect(updatePolicy(library)).toBe("wait");
  });

  it("switches at once on a page that has just started away from a book", () => {
    expect(updatePolicy({ ...library, pageAgeMs: LAUNCH_MS - 1 })).toBe("now");
    expect(updatePolicy({ ...reading, pageAgeMs: 0 })).toBe("wait");
  });

  it("switches when you come back after two minutes away", () => {
    expect(updateMoment(ready, away(AWAY_FOR_UPDATE_MS), library)).toBe(
      "apply",
    );
    expect(updateMoment(ready, away(AWAY_FOR_UPDATE_MS - 1), library)).toBe(
      null,
    );
  });

  it("never switches on a book", () => {
    expect(updateMoment(ready, away(AWAY_FOR_CHECK_MS), reading)).toBeNull();
    expect(
      updateMoment(
        { status: "ready", takenOver: true },
        { type: "route", from: "/" },
        reading,
      ),
    ).toBeNull();
  });

  it("holds while a download you asked for runs", () => {
    expect(
      updateMoment(ready, away(AWAY_FOR_UPDATE_MS), { ...library, busy: true }),
    ).toBeNull();
  });

  it("reloads at the first moment away from a book after another tab switched", () => {
    expect(
      updateMoment(
        { status: "ready", takenOver: true },
        { type: "route", from: "/reader/emma" },
        library,
      ),
    ).toBe("apply");
    expect(
      updateMoment(
        { status: "ready", takenOver: false },
        { type: "route", from: "/reader/emma" },
        library,
      ),
    ).toBeNull();
  });

  it("looks for a new version when you come back after a long time away", () => {
    expect(updateMoment(idle, away(AWAY_FOR_CHECK_MS), reading)).toBe("check");
    expect(updateMoment(idle, away(AWAY_FOR_CHECK_MS - 1), library)).toBeNull();
    expect(
      updateMoment(
        { status: "downloading", takenOver: false },
        away(AWAY_FOR_CHECK_MS),
        library,
      ),
    ).toBeNull();
  });
});
