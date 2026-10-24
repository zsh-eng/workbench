import BouncyButton from "@/components/bouncy-button";
import { useReviewCards } from "@/components/hooks/query";
import MemoryDB from "@/lib/db/memory";
import { cn } from "@/lib/utils";
import { Telescope } from "lucide-react";
import { Link } from "react-router";

export function SpacedIcon() {
  const reviewCards = useReviewCards();

  return (
    <Link
      to="/"
      onClick={() => {
        MemoryDB.notify();
      }}
    >
      <div className="absolute top-4 md:top-4 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-4 w-16 h-12 z-sticky flex items-center justify-center cursor-pointer">
        <BouncyButton asButton>
          <Telescope
            className={cn("h-10 w-10 text-foreground")}
            strokeWidth={1.8}
          />
        </BouncyButton>

        <div className="absolute -bottom-1 left-9 font-bold text-xs text-muted-foreground rounded-xl px-2 sm:hidden">
          {reviewCards.length}
        </div>
      </div>
    </Link>
  );
}
