import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface BackToLibraryProps {
  className?: string;
}

/**
 * The way back from a secondary page such as Settings. A round button on a
 * phone; a "Library" link above the title with a pointer.
 */
export function BackToLibrary({ className }: BackToLibraryProps) {
  return (
    <Button
      render={<Link to="/" />}
      variant="ghost"
      size="icon-sm"
      aria-label="Back to library"
      className={cn(
        "size-8 rounded-full border border-border/70 bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground",
        "md:mb-4 md:-ml-2 md:h-8 md:w-auto md:gap-1 md:rounded-lg md:border-0 md:bg-transparent md:pr-2.5 md:pl-1.5 md:text-[13px] md:font-normal",
        className,
      )}
    >
      <ChevronLeft className="size-4" />
      <span className="max-md:sr-only">Library</span>
    </Button>
  );
}
