/**
 * The phone's encodings: Swift's JSONEncoder with sorted keys, and Swift
 * reference dates, in seconds since 1 January 2001. `encodeSorted` and
 * `toSwift` live in @workbench/arctic-links, which the shared API and
 * `wb arctic save` use too.
 */
import { toSwift } from "@workbench/arctic-links";

export { encodeSorted, toSwift } from "@workbench/arctic-links";

const SWIFT_EPOCH_MS = 978_307_200_000;

export const swiftNow = () => toSwift(Date.now());

/** A Swift date in milliseconds, or nothing when it is not a number. */
export const fromSwift = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? value * 1000 + SWIFT_EPOCH_MS
    : undefined;
