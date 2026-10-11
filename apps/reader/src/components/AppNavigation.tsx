import { AccountMenu } from "@/components/AccountMenu";
import {
  APP_HEADER_TOP,
  APP_PAGE_FRAME,
  APP_TITLE_TYPE,
} from "@/components/app-header-styles";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * Navigation without a sidebar. The page titles are the places: the one you
 * are on is darker. The account menu holds everything else. Library,
 * Highlights and Sessions share the frame, so the titles stay in place
 * between them.
 */
export type AppPlace = "library" | "highlights" | "sessions";

const PLACES: { place: AppPlace; label: string; to: string }[] = [
  { place: "library", label: "Library", to: "/" },
  { place: "highlights", label: "Highlights", to: "/highlights" },
  { place: "sessions", label: "Sessions", to: "/reading-sessions" },
];

export function PlaceNav({ current }: { current: AppPlace }) {
  return (
    <nav
      aria-label="Places"
      className="flex min-w-0 items-baseline gap-3.5 md:gap-5"
    >
      {PLACES.map(({ place, label, to }) => {
        const active = place === current;
        return (
          <Link
            key={place}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn(
              APP_TITLE_TYPE,
              "rounded-sm whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The header of a place. A page can put its own controls before the account
 * menu; the Library also replaces the titles with its search.
 */
export function AppHeader({
  current,
  actions,
  className,
}: {
  current: AppPlace;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn(APP_PAGE_FRAME, APP_HEADER_TOP, className)}>
      <div className="flex h-10 items-center justify-between gap-3">
        <PlaceNav current={current} />
        <div className="flex shrink-0 items-center gap-0.5">
          {actions}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
