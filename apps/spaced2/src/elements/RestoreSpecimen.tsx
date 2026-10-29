import NavBar from "@/components/nav/nav-bar";
import {
  RestoreFrame,
  RestoreIsland,
  type RestoreSync,
  type SyncStatusSource,
} from "@/components/sync-status";
import type { Status } from "@/lib/sync/engine";
import { cn } from "@/lib/utils";
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
 * ("subject-*", "ring-*"). Reader and Arctic show the same island in their
 * own Libraries. See docs/FIRST_REVIEW.md, "The restore island".
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
  const sync: RestoreSync = {
    connection: state === "offline" ? "offline" : "online",
    auth: { status: "signed-in" },
    failure: null,
  };

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
          <RestoreIsland source={source} sync={sync} className="size-full">
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
