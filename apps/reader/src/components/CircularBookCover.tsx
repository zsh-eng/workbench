import { cn } from "@/lib/utils";
import { BookOpenText } from "lucide-react";

interface CircularBookCoverProps {
  coverUrl: string | undefined;
  className?: string;
}

/** Shared circular treatment for book-focused mobile surfaces. */
export function CircularBookCover({
  coverUrl,
  className,
}: CircularBookCoverProps) {
  return (
    <span
      className={cn(
        "relative flex size-24 items-center justify-center overflow-hidden rounded-full border-[5px] border-background bg-secondary shadow-sm ring-1 ring-border/70",
        className,
      )}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="image-outline pointer-events-none size-full select-none object-cover"
        />
      ) : (
        <BookOpenText
          className="size-7 text-muted-foreground/60"
          aria-hidden="true"
        />
      )}
    </span>
  );
}
