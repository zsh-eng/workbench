import { cn } from "@/lib/utils";
import { lazy, Suspense } from "react";
import type { ArrivingCoverProps } from "./ArrivingCover";
import { useArrivalEnvironment } from "./arrival-store";

// The drawing loads with the first arrival, so the Library does not carry it.
const ArrivingCover = lazy(() =>
  import("./ArrivingCover").then((module) => ({
    default: module.ArrivingCover,
  })),
);

/** Start loading the drawing, and its engine, before the first book needs it. */
export function preloadArrivingCover() {
  void import("./ArrivingCover").then((module) => module.warmArrivingCover());
}

/** The sheet one book on its own arrives in, loaded when it is first needed. */
export const LazyArrivalSheet = lazy(() =>
  import("./ArrivalSheet").then((module) => ({
    default: module.ArrivalSheet,
  })),
);

/**
 * A cover while its book arrives, in the look of the page's arrival
 * environment; plain paper while the drawing loads.
 */
export function LazyArrivingCover(
  props: Omit<ArrivingCoverProps, "look" | "onSettled" | "relief">,
) {
  const { records, look, reliefFor } = useArrivalEnvironment();
  // The arrival sheet shows this book: its place waits, empty, for the
  // cover to come down into it.
  if (props.arrival.presented)
    return (
      <span
        data-arrival-place={props.arrival.key}
        className={cn("block bg-secondary", props.className)}
      />
    );
  return (
    <Suspense
      fallback={<span className={cn("block bg-secondary", props.className)} />}
    >
      <ArrivingCover
        {...props}
        look={look}
        relief={reliefFor(props.arrival.sourceFileId)}
        onSettled={() => records.settle(props.arrival.key)}
      />
    </Suspense>
  );
}
