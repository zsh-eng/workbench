import { expect, it } from "bun:test";
import {
  decodeArcticSession,
  encodeArcticSession,
  fromReaderSession,
  fromSpacedReview,
  localDay,
  summarizeTime,
  toReaderSession,
  type ActivitySession,
} from "../src";

const day = (date: number, hour: number) =>
  new Date(2026, 9, date, hour).getTime();

function session(fields: Partial<ActivitySession>): ActivitySession {
  return {
    v: 1,
    id: "A1B2C3D4-0000-4000-8000-000000000001",
    app: "arctic",
    subject: { kind: "article", id: "https://example.com/ice" },
    device: null,
    startedAt: day(20, 9),
    lastActiveAt: day(20, 9) + 70_123,
    endedAt: null,
    activeMs: 70_123,
    gapMs: 120_000,
    position: null,
    ...fields,
  };
}

it("writes the phone's bytes for an Arctic session and reads them back", () => {
  const visit = session({});
  const value = encodeArcticSession(visit)!;
  const record = JSON.parse(value);
  // Sorted keys and Swift reference dates, as JSONEncoder writes them.
  expect(Object.keys(record)).toEqual([
    "articleURL",
    "id",
    "seconds",
    "startedAt",
    "updatedAt",
  ]);
  expect(record).toEqual({
    articleURL: "https://example.com/ice",
    id: visit.id,
    seconds: 70.123,
    startedAt: (visit.startedAt - 978_307_200_000) / 1000,
    updatedAt: (visit.lastActiveAt - 978_307_200_000) / 1000,
  });
  expect(decodeArcticSession(value, "other")).toEqual(visit);
  // The phone keeps no empty visits; damaged records are skipped.
  expect(encodeArcticSession(session({ activeMs: 0 }))).toBeNull();
  expect(decodeArcticSession("{", "x")).toBeNull();
  expect(
    decodeArcticSession(JSON.stringify({ ...record, seconds: -1 }), "x"),
  ).toBeNull();
});

it("maps a Reader row to a session and back without loss", () => {
  const row = {
    id: "reader-session",
    bookId: "alice",
    deviceId: "laptop",
    readerInstanceId: "reader-1",
    startedAt: day(21, 20),
    endedAt: null,
    lastActiveAt: day(21, 21),
    activeMs: 1_800_000,
    startSpineIndex: 2,
    startScrollProgress: 10,
    endSpineIndex: 4,
    endScrollProgress: 55,
  };
  const visit = fromReaderSession(row);
  expect(visit).toMatchObject({
    app: "reader",
    subject: { kind: "book", id: "alice" },
    device: "laptop",
    gapMs: 600_000,
    position: {
      start: { spineIndex: 2, progress: 10 },
      end: { spineIndex: 4, progress: 55 },
    },
  });
  const { deviceId: _device, ...rest } = row;
  expect(toReaderSession(visit, "reader-1")).toEqual(rest);
});

it("sums time from every app in one summary by start day and subject", () => {
  const now = day(22, 12);
  const sessions = [
    fromReaderSession({
      id: "r1",
      bookId: "alice",
      deviceId: "laptop",
      readerInstanceId: "i",
      startedAt: day(21, 23),
      endedAt: day(22, 1),
      lastActiveAt: day(22, 1),
      activeMs: 90 * 60_000,
      startSpineIndex: 0,
      startScrollProgress: 0,
      endSpineIndex: 1,
      endScrollProgress: 0,
    }),
    session({ id: "a1", startedAt: day(22, 8), activeMs: 30_000 }),
    session({ id: "a2", startedAt: day(22, 9), activeMs: 45_000 }),
    fromSpacedReview({
      id: "s1",
      cardId: "card-1",
      duration: 12_000,
      review: new Date(day(22, 10)).toISOString(),
    }),
    // No time, and a device clock ahead of this one: neither counts.
    session({ id: "empty", startedAt: day(22, 10), activeMs: 0 }),
    session({ id: "ahead", startedAt: day(22, 13), activeMs: 60_000 }),
  ];
  const summary = summarizeTime(sessions, { from: day(21, 0), to: now });
  expect(summary.activeMs).toBe(90 * 60_000 + 87_000);
  expect(summary.days).toBe(2);
  // A session belongs to the day it started, even when it ran past midnight.
  expect(Object.fromEntries(summary.buckets)).toEqual({
    [localDay(day(21, 0))]: 90 * 60_000,
    [localDay(day(22, 0))]: 87_000,
  });
  expect(
    summary.subjects.map(({ subject, activeMs, sessions }) => [
      subject.kind,
      activeMs,
      sessions,
    ]),
  ).toEqual([
    ["book", 90 * 60_000, 1],
    ["article", 75_000, 2],
    ["card", 12_000, 1],
  ]);
  expect(summary.sessions.map((visit) => visit.id)).toEqual([
    "s1",
    "a2",
    "a1",
    "r1",
  ]);
});
