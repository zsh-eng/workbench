import NavBar from "@/components/nav/nav-bar";
import {
  RestoreFrame,
  RestoreIsland,
  type RestoreConnection,
  type SyncStatusSource,
} from "@/components/sync-status";
import type { Status } from "@/lib/sync/engine";
import { cn } from "@/lib/utils";
import { ActivityIsland } from "@workbench/background-activity/island";
import { Telescope } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ReviewScreen } from "./ReviewSpecimen";
import type { FrameSpecimenProps } from "./selection";

type Sample = Pick<Status, "restoring" | "fraction">;

/** A sync status that never changes, so nothing syncs. */
function sampleSource(sample: Sample): SyncStatusSource {
  const snapshot = {
    syncing: sample.restoring !== false,
    error: null,
    ...sample,
  };
  return { subscribe: () => () => {}, getSnapshot: () => snapshot };
}

const CARDS: Sample = { restoring: "cards", fraction: null };
const HISTORY: Sample = { restoring: "history", fraction: 0.42 };
const RESTORED: Sample = { restoring: false, fraction: null };

/**
 * The first restore on a phone, in the island that the app ships ("cards",
 * "history", "done", "offline"), and the two directions it was chosen over
 * ("subject-*", "ring-*"), with the island as Reader and Arctic would show
 * it ("reader", "arctic"). See docs/FIRST_REVIEW.md, "The restore island".
 */
export function RestoreSpecimen({ state }: FrameSpecimenProps) {
  const [sample, setSample] = useState<Sample>(
    state === "done" ? HISTORY : state.endsWith("cards") ? CARDS : HISTORY,
  );
  // "Done" plays the end of a restore: the island confirms, then folds.
  useEffect(() => {
    if (state !== "done") return;
    const timer = setTimeout(() => setSample(RESTORED), 900);
    return () => clearTimeout(timer);
  }, [state]);
  const source = useMemo(() => sampleSource(sample), [sample]);
  const connection: RestoreConnection =
    state === "offline" ? "offline" : "online";

  if (state === "reader") return <ReaderMock />;
  if (state === "arctic") return <ArcticMock />;
  const direction = state.startsWith("subject")
    ? "subject"
    : state.startsWith("ring")
      ? "ring"
      : "island";
  const cardsPhase = sample.restoring === "cards";
  return (
    <div className="relative min-h-svh bg-muted dark:bg-background">
      <div className="absolute top-4 left-1/2 z-30 flex h-12 w-16 -translate-x-1/2 items-center justify-center">
        {direction === "island" ? (
          <RestoreIsland
            source={source}
            connection={connection}
            className="size-full"
          >
            <Telescope className="size-10 text-foreground" strokeWidth={1.8} />
            <Count>{cardsPhase ? null : 593}</Count>
          </RestoreIsland>
        ) : (
          <>
            <Telescope className="size-10 text-foreground" strokeWidth={1.8} />
            <Count>
              {direction === "ring" ? (
                <MiniRing fraction={cardsPhase ? null : 0.42} />
              ) : cardsPhase ? null : (
                593
              )}
            </Count>
          </>
        )}
      </div>
      {cardsPhase ? (
        <div className="grid grid-cols-12 gap-x-6 px-2 pt-20">
          {direction === "subject" ? (
            <ArrivingCard />
          ) : (
            <RestoreFrame page="review" />
          )}
        </div>
      ) : (
        <div className="relative">
          <ReviewScreen state="question" />
          {direction === "subject" && (
            <span className="absolute top-[5.6rem] left-6 z-30 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
              <MiniRing fraction={0.42} /> History 42%
            </span>
          )}
        </div>
      )}
      <NavBar />
    </div>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -bottom-1 left-9 rounded-xl px-2 text-xs font-bold text-muted-foreground">
      {children}
    </div>
  );
}

/** The ring direction's mark, and the subject direction's corner. */
function MiniRing({ fraction }: { fraction: number | null }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-3.5 -rotate-90", fraction === null && "animate-spin")}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        strokeWidth="3"
        className="stroke-current opacity-25"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={fraction === null ? 0.75 : 1 - fraction}
        className="stroke-current"
      />
    </svg>
  );
}

/** The subject direction: the review card itself says the cards are arriving. */
function ArrivingCard() {
  return (
    <div className="relative col-span-12 flex h-[min(68svh,560px)] flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl bg-background/60 text-center dark:border dark:bg-muted/30">
      <span className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
        <span className="block h-full w-1/4 animate-pulse bg-primary/60" />
      </span>
      <p className="text-sm">Your cards are arriving</p>
      <p className="text-xs text-muted-foreground tabular-nums">1,204 cards</p>
    </div>
  );
}

/*
 * The mock-ups drop Spaced's island colours (initial falls back to the
 * shared defaults), so they show what an app without its own gets.
 */

/**
 * Reader's Library on a phone, as the island would show its restore: it
 * grows out of the activity glyph in the filter row, and the covers
 * arrive in place. A mock-up in Spaced's styles, not Reader's code.
 */
function ReaderMock() {
  const covers = [
    "#8a5a44",
    "#2f4858",
    "#c9a227",
    "#5b7553",
    "#7d3c58",
    "#3d5a80",
  ];
  return (
    <div className="min-h-svh bg-[#f6f3ee] px-4 pt-14 text-[#2b2620] dark:bg-[#161412] dark:text-[#ece6dc]">
      <p className="font-serif text-[28px] leading-tight">Library</p>
      <div className="mt-4 flex items-center gap-2">
        <ActivityIsland
          content={{
            mark: "progress",
            fraction: null,
            label: "Restoring library",
            detail: "12 books",
          }}
          className="h-9 w-9 [--ba-island-left:0] [--ba-island-shift:0] [--ba-island-surface:initial] [--ba-island-text:initial] [--ba-island-edge:initial]"
        >
          <span className="grid size-9 place-items-center rounded-full border border-current/15">
            <MiniRing fraction={null} />
          </span>
        </ActivityIsland>
        <span className="ml-auto text-sm opacity-60">Recent · Grid</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3">
        {Array.from({ length: 9 }, (_, index) => (
          <div
            key={index}
            className="aspect-[2/3] rounded-sm"
            style={{
              background:
                index < covers.length
                  ? covers[index]
                  : "color-mix(in oklab, currentColor 8%, transparent)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Arctic's Saved list on a phone, as the island would show its first
 * sync: it grows out of the header's place for the count, over the quiet
 * cards. A mock-up in Spaced's styles, not Arctic's code.
 */
function ArcticMock() {
  return (
    <div className="min-h-svh bg-white px-4 pt-6 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="flex h-12 items-center justify-center">
        <ActivityIsland
          content={{
            mark: "progress",
            fraction: null,
            label: "Getting your library",
            detail: "340 links",
          }}
          className="h-10 w-24 [--ba-island-surface:initial] [--ba-island-text:initial] [--ba-island-edge:initial]"
        >
          <span className="text-[17px] font-semibold">Saved</span>
        </ActivityIsland>
      </div>
      <div className="mt-4 grid gap-4">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="flex gap-3">
            <span className="size-16 flex-none rounded-lg bg-current/6" />
            <span className="grid flex-1 content-center gap-2">
              <span className="h-3 w-1/3 rounded bg-current/8" />
              <span className="h-3.5 rounded bg-current/10" />
              <span className="h-3.5 w-4/5 rounded bg-current/10" />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
