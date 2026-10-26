import { cn } from "@/lib/utils";
import { lazy, Suspense, useRef, useState, type ComponentType } from "react";
import type { ArrivalSheetProps } from "./ArrivalSheet";
import type { ArrivingCoverProps } from "./ArrivingCover";
import { useArrivalEnvironment } from "./arrival-store";

// The drawing and the sheet load with the first arrival, so the Library
// does not carry them. Once a chunk is here its component renders at once:
// React.lazy suspends on its first render even when the chunk is loaded,
// and React then holds the fallback for up to 300 ms. Under the arrival
// sheet's flight that fallback was a blank cover. Each place keeps the
// component it first rendered: a change of component would remount it.
let LoadedCover: ComponentType<ArrivingCoverProps> | null = null;
const loadCover = () =>
  import("./ArrivingCover").then((module) => {
    LoadedCover = module.ArrivingCover;
    return module;
  });
const LazyCover = lazy(() =>
  loadCover().then((module) => ({ default: module.ArrivingCover })),
);

let LoadedSheet: ComponentType<ArrivalSheetProps> | null = null;
const loadSheet = () =>
  import("./ArrivalSheet").then((module) => {
    LoadedSheet = module.ArrivalSheet;
    return module;
  });
const LazySheet = lazy(() =>
  loadSheet().then((module) => ({ default: module.ArrivalSheet })),
);

/** Start loading the drawing, and its engine, before the first book needs it. */
export function preloadArrivingCover() {
  void loadCover().then((module) => module.warmArrivingCover());
}

/**
 * Start loading the arrival sheet and the drawing while you choose files,
 * so a slow phone shows the sheet with the import, not after it.
 */
export function preloadArrivals() {
  void loadSheet();
  preloadArrivingCover();
}

/** The sheet one book on its own arrives in, loaded when it is first needed. */
export function LazyArrivalSheet(props: ArrivalSheetProps) {
  const [Sheet] = useState(() => LoadedSheet ?? LazySheet);
  return (
    <Suspense fallback={null}>
      <Sheet {...props} />
    </Suspense>
  );
}

/**
 * A cover while its book arrives, in the look of the page's arrival
 * environment; plain paper while the drawing loads.
 */
export function LazyArrivingCover(
  props: Omit<ArrivingCoverProps, "look" | "onSettled" | "relief">,
) {
  const { records, look, reliefFor } = useArrivalEnvironment();
  const cover = useRef<ComponentType<ArrivingCoverProps> | null>(null);
  // The arrival sheet shows this book: its place waits, empty, for the
  // cover to come down into it.
  if (props.arrival.presented)
    return (
      <span
        data-arrival-place={props.arrival.key}
        className={cn("block bg-secondary", props.className)}
      />
    );
  // Chosen when the cover first draws, which may be long after the place
  // mounted empty for the sheet.
  if (cover.current === null) cover.current = LoadedCover ?? LazyCover;
  const Cover = cover.current;
  return (
    <Suspense
      fallback={<span className={cn("block bg-secondary", props.className)} />}
    >
      <Cover
        {...props}
        look={look}
        relief={reliefFor(props.arrival.sourceFileId)}
        onSettled={() => records.settle(props.arrival.key)}
      />
    </Suspense>
  );
}
