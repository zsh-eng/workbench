import BouncyButton from "@/components/bouncy-button";
import { RestoreIsland } from "@/components/sync-status";
import { useCards, useReviewCards } from "@/components/hooks/query";
import MemoryDB from "@/lib/db/memory";
import SyncEngine from "@/lib/sync/engine";
import { cn } from "@/lib/utils";
import { Telescope } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Link } from "react-router";

export function SpacedIcon() {
  const cards = useCards();
  const reviewCards = useReviewCards();
  // Until a new device has its cards, it does not know how many are due;
  // an empty library has no count, before or after it learns that.
  // Only the phase: the island beside it follows the restore's progress,
  // and this icon's due count is not cheap to render on every page.
  const restoring = useSyncExternalStore(
    SyncEngine.subscribe,
    () => SyncEngine.getSnapshot().restoring,
  );
  const known = restoring !== "cards" && cards.length > 0;

  return (
    <Link
      to="/"
      onClick={() => {
        MemoryDB.notify();
      }}
    >
      <div className="absolute top-4 md:top-4 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-4 w-16 h-12 z-sticky flex items-center justify-center cursor-pointer">
        {/* A new device's restore grows out of the icon and its count, and
            folds back into them when it is done. */}
        <RestoreIsland className="size-full md:[--ba-island-left:0] md:[--ba-island-shift:0]">
          <BouncyButton asButton>
            <Telescope
              className={cn("h-10 w-10 text-foreground")}
              strokeWidth={1.8}
            />
          </BouncyButton>

          <div
            data-due-count
            className="absolute -bottom-1 left-9 font-bold text-xs text-muted-foreground rounded-xl px-2 sm:hidden"
          >
            {known ? reviewCards.length : null}
          </div>
        </RestoreIsland>
      </div>
    </Link>
  );
}
