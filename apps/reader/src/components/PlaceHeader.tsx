import { AccountMenu } from "@/components/AccountMenu";
import { PlaceNav, type AppPlace } from "@/components/AppNavigation";
import {
  APP_HEADER_BUTTON,
  APP_HEADER_TOP,
  APP_PAGE_FRAME,
  APP_TITLE_TYPE,
} from "@/components/app-header-styles";
import { MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: MOTION.enter },
  exit: { opacity: 0, transition: MOTION.exit },
};

const GLYPH_FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

/** Keys typed here belong to a field or an open menu, not to the search. */
const KEYBOARD_OWNERS =
  "input, textarea, select, [contenteditable='true'], [role='menu'], [role='dialog'], [role='listbox']";

export interface PlaceSearch {
  /** The query, or null while the search is closed. */
  search: string | null;
  setSearch: (search: string | null) => void;
  /** The trimmed query; empty while closed. */
  terms: string;
  openSearch: (typed?: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * Search for a place. The button, /, Cmd-F, or a letter typed on the page
 * opens it; Escape clears it, then closes it. Results start at the top of
 * the page.
 */
export function usePlaceSearch(): PlaceSearch {
  const [search, setSearch] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const terms = search?.trim() ?? "";

  const openSearch = useCallback((typed = "") => {
    setSearch((current) => (current ?? "") + typed);
    setFocusKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input || focusKey === 0) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }, [focusKey]);

  const searchedTerms = useRef(terms);
  useEffect(() => {
    if (searchedTerms.current === terms) return;
    searchedTerms.current = terms;
    window.scrollTo({ top: 0 });
  }, [terms]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.target as Element | null)?.closest?.(KEYBOARD_OWNERS)) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
        return;
      }
      if (modifier || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        openSearch();
      } else if (event.key === "Escape") {
        setSearch(null);
      } else if (event.key.length === 1 && /[\p{L}\p{N}]/u.test(event.key)) {
        event.preventDefault();
        openSearch(event.key);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [openSearch]);

  return { search, setSearch, terms, openSearch, inputRef };
}

/**
 * The header of a place that can be searched. The search replaces the
 * titles and keeps the row in view while you search. A page puts its own
 * controls before the account menu.
 */
export function PlaceHeader({
  current,
  search: { search, setSearch, terms, openSearch, inputRef },
  label,
  placeholder,
  count,
  onSubmit,
  actions,
}: {
  current: AppPlace;
  search: PlaceSearch;
  /** The search field's accessible name. */
  label: string;
  placeholder: string;
  /** Shown beside the query, for example "3 of 40". */
  count?: string;
  /** Enter in the field, for example to open the first result. */
  onSubmit?: () => void;
  actions?: ReactNode;
}) {
  const searching = search !== null;
  return (
    <header
      className={cn(
        APP_PAGE_FRAME,
        APP_HEADER_TOP,
        "pb-3",
        searching &&
          "sticky top-[-0.5rem] z-30 bg-background md:top-[-2.25rem]",
      )}
    >
      <div className="flex h-10 items-center justify-between gap-3">
        <div className="relative h-10 min-w-0 flex-1">
          <AnimatePresence initial={false}>
            {searching ? (
              <motion.div
                key="search"
                role="search"
                className="absolute inset-0 flex items-center gap-2.5"
                {...FADE}
              >
                <Search
                  className="size-4 shrink-0 text-muted-foreground md:size-[18px]"
                  strokeWidth={1.7}
                  aria-hidden="true"
                />
                <input
                  ref={inputRef}
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSearch(search ? "" : null);
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      onSubmit?.();
                    }
                  }}
                  aria-label={label}
                  placeholder={placeholder}
                  enterKeyHint="search"
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(
                    APP_TITLE_TYPE,
                    "min-w-0 flex-1 appearance-none bg-transparent text-foreground outline-none placeholder:text-muted-foreground/50 [&::-webkit-search-cancel-button]:hidden",
                  )}
                />
                {terms && count && (
                  <span
                    aria-live="polite"
                    className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums"
                  >
                    {count}
                  </span>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="places"
                className="absolute inset-0 flex items-center"
                {...FADE}
              >
                <PlaceNav current={current} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* One button opens and closes the search and keeps its place, so
              the row beside it does not move. Its meaning changes in place:
              a 150 ms cross-fade of the glyph, no movement. */}
          <button
            type="button"
            aria-label={searching ? "Close search" : "Search"}
            title={searching ? "Close search (Esc)" : "Search (/)"}
            onClick={() => (searching ? setSearch(null) : openSearch())}
            className={APP_HEADER_BUTTON}
          >
            <span className="relative grid size-4 place-items-center">
              <AnimatePresence initial={false}>
                <motion.span
                  key={searching ? "close" : "search"}
                  className="absolute inset-0 grid place-items-center"
                  {...GLYPH_FADE}
                >
                  {searching ? (
                    <X className="size-4" strokeWidth={1.6} />
                  ) : (
                    <Search className="size-4" strokeWidth={1.7} />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
          </button>
          {actions}
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
