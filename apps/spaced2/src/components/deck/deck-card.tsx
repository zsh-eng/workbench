import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { BookIcon, Clock } from "lucide-react";
import { Link } from "react-router";

export type DeckCardProps = {
  id: string;
  name: string;
  description: string;
  lastModified: Date;
  cardCount: number;
};

/**
 * Small UI card to represent a deck
 */
export default function DeckCard({
  id,
  name,
  description,
  lastModified,
  cardCount,
}: DeckCardProps) {
  return (
    // isolate keeps the -z-10 border div above the page but below the card
    <Link to={`/decks/${id}`} className="isolate w-full sm:w-max">
      <Card className="group relative flex h-full w-full cursor-pointer flex-col items-start justify-start gap-y-1 border-background bg-muted px-4 py-3 pb-10 text-background shadow-sm sm:shadow-md transition duration-300 hover:shadow-sm sm:h-36 sm:w-72 sm:gap-y-2 sm:py-6 sm:pb-6">
        <div className="-z-10 absolute inset-0 -right-[0.65rem] -top-2 h-[103%] scale-[98%] rounded-xl border border-background bg-muted/70 transition duration-200 ease-in group-hover:border group-hover:border-primary"></div>
        <CardTitle className="text-lg text-foreground sm:text-xl">
          {name}
        </CardTitle>
        <CardDescription className="line-clamp-1">
          {description}
        </CardDescription>
        <>
          <div className="absolute bottom-3 left-4 flex items-center text-muted-foreground">
            <Clock className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
            <span className="text-xs sm:text-sm">
              {format(lastModified, "MMM d")}
            </span>
          </div>

          <span className="absolute bottom-3 right-4 ml-auto mt-4 flex w-max items-center justify-center rounded-md text-xs text-muted-foreground sm:text-sm">
            <BookIcon className="mr-1 h-3 w-3 sm:h-4 sm:w-4" />
            {cardCount}
          </span>
        </>
      </Card>
    </Link>
  );
}
