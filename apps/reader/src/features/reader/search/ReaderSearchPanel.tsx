import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ReaderSearch,
  ReaderSearchAnnotation,
  ReaderSearchResult,
} from "./use-reader-search";

const DOT_COLORS: Record<string, string> = {
  yellow: "bg-yellow-secondary",
  green: "bg-green-secondary",
  blue: "bg-blue-secondary",
  magenta: "bg-magenta-secondary",
};

const ROW_CLASS =
  "group relative block w-full rounded-xl px-3 py-2.5 text-left outline-none transition-[background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:bg-accent/60 active:[transform:scale(0.98)] motion-reduce:active:transform-none focus-visible:ring-2 focus-visible:ring-ring/50 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent/45";

function formatCount(count: number) {
  return count.toLocaleString();
}

function StatusLine({ search }: { search: ReaderSearch }) {
  const { state } = search;
  let text: string;
  // Until the new query's first results arrive, the last query's stay, and
  // so does their count.
  if (state.pending)
    text = state.results.length
      ? `${formatCount(state.results.length)} ${state.results.length === 1 ? "match" : "matches"}`
      : "";
  else if (state.status === "waiting") text = "Loading the book’s text…";
  else if (state.status === "searching")
    text = state.results.length
      ? `${formatCount(state.results.length)} so far · searching ${state.searchedChapters} of ${state.totalChapters} chapters`
      : `Searching ${state.searchedChapters} of ${state.totalChapters} chapters…`;
  else if (!state.results.length) text = "No matches in the book";
  // A search starts at the reader's page, so the limit keeps the nearest.
  else if (state.truncated)
    text = `Next ${formatCount(state.results.length)} matches · try more words`;
  else
    text = `${formatCount(state.results.length)} ${state.results.length === 1 ? "match" : "matches"}`;

  return (
    <div className="flex min-h-8 items-center gap-2 px-4 text-xs text-muted-foreground">
      <p
        role="status"
        aria-live="polite"
        data-search-status={state.status}
        className="min-w-0 flex-1 truncate font-numeric tabular-nums"
      >
        {text}
      </p>
      {state.status === "searching" && !state.pending && (
        <button
          type="button"
          onClick={search.cancel}
          className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Stop
        </button>
      )}
    </div>
  );
}

function ResultRow({
  result,
  index,
  page,
  active,
  onOpen,
}: {
  result: ReaderSearchResult;
  index: number;
  page: number | null | undefined;
  active: boolean;
  onOpen: (index: number) => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-search-result={index}
        aria-current={active ? "true" : undefined}
        onClick={() => onOpen(index)}
        className={cn(ROW_CLASS, active && "bg-accent/60")}
      >
        <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
          <span className="text-[0.9rem] leading-snug text-foreground/80">
            {result.snippet.before}
            <strong className="font-semibold text-foreground">
              {result.snippet.match}
            </strong>
            {result.snippet.after}
          </span>
          <span
            className="font-numeric text-xs text-muted-foreground tabular-nums"
            aria-label={page ? `Page ${page}` : undefined}
          >
            {page ?? ""}
          </span>
        </span>
      </button>
    </li>
  );
}

function AnnotationRow({
  annotation,
  onOpen,
}: {
  annotation: ReaderSearchAnnotation;
  onOpen: (annotation: ReaderSearchAnnotation) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(annotation)}
        className={ROW_CLASS}
      >
        <span className="flex items-baseline gap-2.5">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 translate-y-[-1px] rounded-full",
              (annotation.color && DOT_COLORS[annotation.color]) ||
                "bg-muted-foreground/50",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-[0.9rem] leading-snug text-foreground">
              {annotation.text}
            </span>
            {annotation.quote && (
              <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                {annotation.quote}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {annotation.kind === "note" ? "Note" : "Highlight"}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Draws more results as the list nears its end, or on a tap. */
function MoreResults({
  remaining,
  enabled,
  onShowMore,
}: {
  remaining: number;
  /** A closed panel draws nothing more. */
  enabled: boolean;
  onShowMore: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const button = ref.current;
    if (!button || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onShowMore();
      },
      { rootMargin: "0px 0px 400px 0px" },
    );
    observer.observe(button);
    return () => observer.disconnect();
  }, [enabled, onShowMore, remaining]);
  return (
    <div className="px-4 py-3">
      <button
        ref={ref}
        type="button"
        onClick={onShowMore}
        className="w-full rounded-xl py-2 text-xs font-medium text-muted-foreground hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Show more ({formatCount(remaining)} left)
      </button>
    </div>
  );
}

const SECTION_HEADING =
  "sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-background/95 px-4 pt-3 pb-1.5 text-[10px] font-medium tracking-[0.16em] text-muted-foreground uppercase backdrop-blur";

/**
 * Book search: a field, then matches in the reader's own highlights and
 * notes, then every match in the book grouped by chapter, each with its
 * page. Choosing one opens its page; nothing moves until then.
 */
export function ReaderSearchPanel({
  search,
  isOpen,
  autoFocus,
  focusRequest = 0,
  onResultOpened,
  className,
}: {
  search: ReaderSearch;
  isOpen: boolean;
  /** Phones focus the field only when it is empty. */
  autoFocus: "always" | "when-empty";
  /** Changes when the field should take focus again, as on Cmd-F. */
  focusRequest?: number;
  /** Called after a result opens, so a phone sheet can close. */
  onResultOpened?: () => void;
  className?: string;
}) {
  const { state } = search;
  const [value, setValue] = useState(state.query);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setQuery = search.setQuery;

  // Opening search focuses the field. On a phone, the keyboard would cover
  // results already waiting below it.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!isOpen || !input) return;
    if (autoFocus === "when-empty" && input.value) return;
    input.focus({ preventScroll: true });
    input.select();
  }, [autoFocus, isOpen]);
  useLayoutEffect(() => {
    if (!focusRequest) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [focusRequest]);

  // Keep the active result in view while stepping.
  useEffect(() => {
    if (state.activeIndex === null) return;
    listRef.current
      ?.querySelector(`[data-search-result="${state.activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [state.activeIndex]);

  const pendingStep = useRef<"next" | "previous" | null>(null);
  const stepIfDone = () => {
    const step = pendingStep.current;
    if (!step || state.status !== "done" || value !== state.query) return;
    pendingStep.current = null;
    if (!state.results.length) return;
    search[step]();
    onResultOpened?.();
  };
  // A step asked for while the search ran happens when it ends.
  useEffect(stepIfDone);

  const openResult = (index: number) => {
    search.open(index);
    onResultOpened?.();
  };

  const settled = value === state.query;
  const hasQuery = !!state.query.trim();

  return (
    <div
      role="search"
      data-reader-search-panel=""
      className={cn("flex min-h-0 flex-1 flex-col", className)}
    >
      <div className="shrink-0 px-3 pb-1">
        <div className="flex h-11 items-center gap-2.5 rounded-full border border-border/70 bg-secondary/35 pr-1 pl-3.5 focus-within:border-ring">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            data-sheet-autofocus={
              autoFocus === "always" || !value ? "" : undefined
            }
            // Not type="search": Escape there clears the field, and here
            // it closes search.
            type="text"
            role="searchbox"
            inputMode="search"
            value={value}
            onChange={(event) => {
              // Every keystroke searches: a search takes a few
              // milliseconds, and a newer query stops the one running.
              setValue(event.target.value);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              // A phone's Search key puts the keyboard away to show results.
              if (autoFocus === "when-empty") {
                if (!settled) setQuery(value);
                event.currentTarget.blur();
                return;
              }
              // Enter goes to the nearest match, once the search is done.
              pendingStep.current = event.shiftKey ? "previous" : "next";
              if (!settled) setQuery(value);
              else stepIfDone();
            }}
            aria-label="Search this book"
            placeholder="Search this book"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 appearance-none bg-transparent text-[0.95rem] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setValue("");
                setQuery("");
                inputRef.current?.focus();
              }}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {hasQuery && <StatusLine search={search} />}

      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {hasQuery && state.annotations.length > 0 && (
          <section aria-label="Your highlights and notes">
            <h3 className={SECTION_HEADING}>
              <span>Your highlights and notes</span>
              <span className="font-numeric tabular-nums">
                {state.annotations.length}
              </span>
            </h3>
            <ul className="px-1">
              {state.annotations.map((annotation) => (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  onOpen={(target) => {
                    search.openAnnotation(target);
                    onResultOpened?.();
                  }}
                />
              ))}
            </ul>
          </section>
        )}
        {hasQuery &&
          state.groups
            .filter((group) => group.firstIndex < state.shown)
            .map((group) => (
              <section key={group.key} aria-label={group.title}>
                <h3 className={SECTION_HEADING}>
                  <span className="min-w-0 truncate text-xs tracking-normal normal-case">
                    {group.title}
                  </span>
                  <span className="shrink-0 font-numeric tabular-nums">
                    {group.results.length}
                  </span>
                </h3>
                <ul className="px-1">
                  {group.results
                    .slice(0, state.shown - group.firstIndex)
                    .map((result, offset) => {
                      const index = group.firstIndex + offset;
                      return (
                        <ResultRow
                          key={result.id}
                          result={result}
                          index={index}
                          page={state.pages[result.id]}
                          active={state.activeIndex === index}
                          onOpen={openResult}
                        />
                      );
                    })}
                </ul>
              </section>
            ))}
        {hasQuery && state.shown < state.results.length && (
          <MoreResults
            remaining={state.results.length - state.shown}
            enabled={isOpen}
            onShowMore={search.showMore}
          />
        )}
        {!hasQuery && (
          <p className="px-6 pt-6 text-center text-sm leading-relaxed text-muted-foreground">
            Find words anywhere in the book, and in your highlights and notes.
          </p>
        )}
      </div>
    </div>
  );
}
