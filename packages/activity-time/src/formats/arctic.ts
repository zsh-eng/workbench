import { DEFAULT_GAP_MS } from "../active-time";
import { ACTIVITY_SESSION_VERSION, type ActivitySession } from "../session";

/**
 * Arctic counts with 180 seconds, on iPhone too (`ReadingSessions.swift`).
 * The records keep no gap, so one counted with 120 seconds before 28
 * October 2026 reads back with this one.
 */
export const ARCTIC_GAP_MS = DEFAULT_GAP_MS;

/** Swift's reference date, 1 January 2001, in Unix milliseconds. */
const SWIFT_EPOCH_MS = 978_307_200_000;

/**
 * The phone's `ArticleReadingSession`, the value of `session/<UUID>` in
 * `arctic-reading`. Dates are seconds since 2001 (Swift's default encoding),
 * and `updatedAt` orders copies of a record on the phone.
 */
export interface ArcticSessionValue {
  articleURL: string;
  id: string;
  seconds: number;
  startedAt: number;
  updatedAt: number;
}

const toSwift = (ms: number) => (ms - SWIFT_EPOCH_MS) / 1000;
const fromSwift = (seconds: number) =>
  Math.round(seconds * 1000 + SWIFT_EPOCH_MS);

/**
 * The phone's bytes for a session: its five keys in sorted order, so both
 * apps write equal values. Null for a session without time, which the phone
 * neither keeps nor uploads.
 */
export function encodeArcticSession(session: ActivitySession): string | null {
  if (session.activeMs <= 0) return null;
  const value: ArcticSessionValue = {
    articleURL: session.subject.id,
    id: session.id,
    seconds: session.activeMs / 1000,
    startedAt: toSwift(session.startedAt),
    updatedAt: toSwift(session.lastActiveAt),
  };
  return JSON.stringify(value);
}

/**
 * A phone or web record as a session, or null when it cannot be read. The
 * phone's format has no device and no end; `id` stands in for a missing one.
 */
export function decodeArcticSession(
  value: string,
  id: string,
): ActivitySession<null> | null {
  let record: Partial<Record<keyof ArcticSessionValue, unknown>>;
  try {
    record = JSON.parse(value);
  } catch {
    return null;
  }
  const { articleURL, seconds, startedAt, updatedAt } = record;
  if (
    typeof articleURL !== "string" ||
    typeof seconds !== "number" ||
    !Number.isFinite(seconds) ||
    seconds < 0 ||
    typeof startedAt !== "number" ||
    !Number.isFinite(startedAt)
  ) {
    return null;
  }
  return {
    v: ACTIVITY_SESSION_VERSION,
    id: typeof record.id === "string" ? record.id : id,
    app: "arctic",
    subject: { kind: "article", id: articleURL },
    device: null,
    startedAt: fromSwift(startedAt),
    lastActiveAt: fromSwift(
      typeof updatedAt === "number" && Number.isFinite(updatedAt)
        ? updatedAt
        : startedAt,
    ),
    endedAt: null,
    activeMs: Math.round(seconds * 1000),
    gapMs: ARCTIC_GAP_MS,
    position: null,
  };
}
