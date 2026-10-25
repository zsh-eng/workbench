/**
 * The phone's encodings: Swift's JSONEncoder with sorted keys, and Swift
 * reference dates, in seconds since 1 January 2001.
 */
const SWIFT_EPOCH_MS = 978_307_200_000;

export const toSwift = (ms: number) => (ms - SWIFT_EPOCH_MS) / 1000;

export const swiftNow = () => toSwift(Date.now());

/** A Swift date in milliseconds, or nothing when it is not a number. */
export const fromSwift = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value * 1000 + SWIFT_EPOCH_MS
    : undefined;

/** JSON with sorted keys, as the phone encodes its records. */
export function encodeSorted(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
