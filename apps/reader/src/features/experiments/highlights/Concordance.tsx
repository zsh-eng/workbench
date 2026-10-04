/**
 * Concordance: a back-of-book index of everything highlighted.
 *
 * Terms are extracted from highlight text, filtered with a stopword list and
 * listed with book sigla and page locators. Selecting a term shows every
 * occurrence in key-word-in-context form, aligned on the word.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, animate, motion, useReducedMotion } from "motion/react";
import { Search } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { StudioBook, StudioHighlight, StudioLibrary } from "../data/sample-library";
import { EASE_OUT, SOFT_SPRING, StageSurface, inkColor, inkWash, useElementSize } from "../primitives";

const STOPWORDS = new Set(
  "about above after again against all also although among another any are aren't because been before being below between both but cannot could couldn't did didn't does doesn't doing done down during each else even ever every few for from further had hadn't has hasn't have haven't having he'd he'll her here here's hers herself him himself his how how's i'd i'll i'm i've into isn't it's its itself just let's like made make many may might more most much must mustn't myself never nor not now off once one only other ought our ours ourselves out over own same say said shall shan't she she'd she'll she's should shouldn't since some still such than that that's the their theirs them themselves then there there's these they they'd they'll they're they've this those though through thus till too under until upon very was wasn't we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom whose why why's will with within without won't would wouldn't yet you you'd you'll you're you've your yours yourself yourselves thee thou thy thine hath doth unto shall".split(
    " ",
  ),
);
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const CONTEXT_CHARS = 46;

interface Occurrence {
  highlight: StudioHighlight;
  start: number;
  end: number;
}

interface IndexEntry {
  term: string;
  occurrences: Occurrence[];
  highlightIds: Set<string>;
}

function normalize(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .replace(/'s$/, "");
}

function buildIndex(highlights: StudioHighlight[]): IndexEntry[] {
  const entries = new Map<string, IndexEntry>();
  for (const highlight of highlights) {
    const pattern = /[\p{L}’'-]+/gu;
    for (const match of highlight.text.matchAll(pattern)) {
      const term = normalize(match[0]);
      if (term.length < 4 || STOPWORDS.has(term) || (term.includes("-") && term.length < 6)) continue;
      const entry = entries.get(term) ?? { term, occurrences: [], highlightIds: new Set<string>() };
      entry.occurrences.push({ highlight, start: match.index, end: match.index + match[0].length });
      entry.highlightIds.add(highlight.id);
      entries.set(term, entry);
    }
  }
  const all = [...entries.values()];
  // Large libraries keep the index readable by listing only repeated terms.
  const list = highlights.length > 60 ? all.filter((entry) => entry.highlightIds.size > 1) : all;
  return list.sort((a, b) => a.term.localeCompare(b.term));
}

function trimLeft(text: string): string {
  if (text.length <= CONTEXT_CHARS) return text;
  const slice = text.slice(-CONTEXT_CHARS);
  return `…${slice.slice(slice.indexOf(" ") + 1)}`;
}

function trimRight(text: string): string {
  if (text.length <= CONTEXT_CHARS) return text;
  const slice = text.slice(0, CONTEXT_CHARS);
  return `${slice.slice(0, slice.lastIndexOf(" "))}…`;
}

function Locators({ entry, booksById }: { entry: IndexEntry; booksById: Map<string, StudioBook> }) {
  const byBook = new Map<string, Set<number>>();
  for (const occurrence of entry.occurrences) {
    const pages = byBook.get(occurrence.highlight.bookId) ?? new Set<number>();
    pages.add(occurrence.highlight.locator);
    byBook.set(occurrence.highlight.bookId, pages);
  }
  return (
    <span className="text-muted-foreground">
      {[...byBook.entries()].map(([bookId, pages], index) => (
        <span key={bookId}>
          {index > 0 && "; "}
          <span className="xp-smcp text-[0.82em] text-foreground/60">{booksById.get(bookId)?.siglum}</span>{" "}
          <span className="xp-onum">{[...pages].sort((a, b) => a - b).join(", ")}</span>
        </span>
      ))}
    </span>
  );
}

function ConcordanceLine({
  occurrence,
  index,
  book,
  open,
  onToggle,
}: {
  occurrence: Occurrence;
  index: number;
  book: StudioBook | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const { highlight, start, end } = occurrence;
  const left = trimLeft(highlight.text.slice(0, start));
  const keyword = highlight.text.slice(start, end);
  const right = trimRight(highlight.text.slice(end));

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.55, ease: EASE_OUT, delay: Math.min(index, 14) * 0.035 }}
      className="border-b border-border/60 last:border-0"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline py-2.5 text-left whitespace-pre outline-none focus-visible:bg-muted/60"
      >
        <span className="xp-serif overflow-hidden text-right text-ellipsis text-[17px] text-foreground/60 transition-colors group-hover:text-foreground/85" dir="ltr">
          {left}
        </span>
        <span
          className="xp-serif text-[17px] font-medium text-foreground underline decoration-2 underline-offset-[5px]"
          style={{ textDecorationColor: inkColor(highlight.color) }}
        >
          {keyword}
        </span>
        <span className="xp-serif overflow-hidden text-ellipsis text-[17px] text-foreground/60 transition-colors group-hover:text-foreground/85">
          {right}
          <span className="xp-smcp ml-3 text-[12px] text-muted-foreground">
            {book?.siglum} <span className="xp-onum">{highlight.locator}</span>
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="mx-auto max-w-xl pt-1 pb-5 text-center">
              <p className="xp-serif text-xl leading-snug text-pretty">
                {highlight.text.slice(0, start)}
                <span className="xp-ink" style={{ ["--xp-ink" as string]: inkWash(highlight.color), color: "inherit" } as CSSProperties}>
                  {keyword}
                </span>
                {highlight.text.slice(end)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="xp-serif text-sm italic">{book?.title}</span> · {highlight.chapter}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export function Concordance({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const index = useMemo(() => buildIndex(library.highlights), [library.highlights]);
  const booksById = useMemo(() => new Map(library.books.map((book) => [book.id, book])), [library.books]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const indexScrollRef = useRef<HTMLDivElement>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const wide = size.width >= 860;

  const mostFrequent = useMemo(
    () => [...index].sort((a, b) => b.highlightIds.size - a.highlightIds.size || b.occurrences.length - a.occurrences.length)[0],
    [index],
  );
  const selectedEntry = index.find((entry) => entry.term === selected) ?? mostFrequent;

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return index;
    return index.filter((entry) => entry.term.includes(needle));
  }, [index, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, IndexEntry[]>();
    for (const entry of filtered) {
      const letter = entry.term[0].toUpperCase();
      const list = groups.get(letter) ?? [];
      list.push(entry);
      groups.set(letter, list);
    }
    return groups;
  }, [filtered]);

  // Terms that share passages with the selection ("see also").
  const seeAlso = useMemo(() => {
    if (!selectedEntry) return [];
    return index
      .filter((entry) => entry.term !== selectedEntry.term)
      .map((entry) => ({
        term: entry.term,
        shared: [...entry.highlightIds].filter((id) => selectedEntry.highlightIds.has(id)).length,
        weight: entry.highlightIds.size,
      }))
      .filter((item) => item.shared > 0)
      .sort((a, b) => b.shared - a.shared || b.weight - a.weight)
      .slice(0, 7);
  }, [index, selectedEntry]);

  const jumpToLetter = (letter: string) => {
    const scroller = indexScrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(`[data-letter="${letter}"]`);
    if (!scroller || !target) return;
    const top = target.offsetTop - 8;
    if (reducedMotion) {
      scroller.scrollTop = top;
      return;
    }
    void animate(scroller.scrollTop, top, {
      duration: 0.6,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (value) => {
        scroller.scrollTop = value;
      },
    });
  };

  const select = (term: string) => {
    setSelected(term);
    setOpenLine(null);
  };

  const bookCount = selectedEntry
    ? new Set(selectedEntry.occurrences.map((occurrence) => occurrence.highlight.bookId)).size
    : 0;

  return (
    <StageSurface tone="inherit" className="relative size-full">
      <div ref={sizeRef} className={cn("absolute inset-0 grid", wide ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)]" : "grid-rows-[minmax(0,0.9fr)_minmax(0,1.1fr)]")}>
        {/* Index */}
        <div className={cn("flex min-h-0 flex-col", wide ? "border-r" : "border-b")}>
          <div className="px-5 pt-6 md:px-8 md:pt-8">
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="xp-serif text-4xl tracking-[-0.02em]">Index</h4>
              <p className="xp-serif xp-onum text-sm text-muted-foreground italic">{index.length} entries</p>
            </div>
            <label className="mt-4 flex items-center gap-2.5 border-b border-foreground/25 pb-2 focus-within:border-foreground">
              <Search className="size-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && filtered[0]) select(filtered[0].term);
                }}
                placeholder="Look up a word"
                aria-label="Look up a word"
                className="xp-serif w-full bg-transparent text-2xl italic outline-none placeholder:text-muted-foreground/50"
              />
            </label>
            <div className="xp-scroll-quiet mt-3 -mx-1 flex gap-px overflow-x-auto pb-1" role="group" aria-label="Letters">
              {LETTERS.map((letter) => {
                const enabled = grouped.has(letter);
                return (
                  <button
                    key={letter}
                    type="button"
                    disabled={!enabled}
                    onClick={() => jumpToLetter(letter)}
                    className="xp-serif grid h-7 min-w-6 cursor-pointer place-items-center rounded-md text-sm outline-none transition-colors enabled:hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-25"
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          </div>

          <div ref={indexScrollRef} className="xp-scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-10 md:px-8">
            {filtered.length === 0 ? (
              <p className="xp-serif pt-8 text-lg text-muted-foreground italic">No entry for “{query}”.</p>
            ) : (
              <div className="gap-8 [column-fill:balance]" style={{ columnWidth: "13rem" }}>
                {[...grouped.entries()].map(([letter, entries]) => (
                  <div key={letter} data-letter={letter} className="mb-5">
                    <p className="xp-serif mb-1 text-3xl leading-none text-muted-foreground/60 [break-after:avoid]">{letter}</p>
                    <ul>
                      {entries.map((entry) => {
                        const active = entry.term === selectedEntry?.term;
                        return (
                          <li key={entry.term} className="break-inside-avoid">
                            <button
                              type="button"
                              onClick={() => select(entry.term)}
                              className="w-full cursor-pointer py-[3px] text-left text-[15px] leading-snug outline-none focus-visible:underline"
                            >
                              <span
                                className={cn("xp-serif xp-ink pr-0.5", active ? "text-foreground" : "text-foreground/85 hover:text-foreground")}
                                style={{
                                  ["--xp-ink" as string]: inkWash(entry.occurrences[0].highlight.color),
                                  ["--xp-ink-size" as string]: active ? "100%" : "0%",
                                  color: "inherit",
                                }}
                              >
                                {entry.term}
                              </span>
                              <span className="text-[13px]">
                                {", "}
                                <Locators entry={entry} booksById={booksById} />
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Concordance */}
        <div className="xp-scroll-quiet min-h-0 overflow-y-auto px-5 pt-6 pb-10 md:px-10 md:pt-8">
          {selectedEntry && (
            <>
              <div className="mb-6 text-center">
                <p className="xp-smcp text-xs tracking-[0.24em] text-muted-foreground">Concordance</p>
                <div className="relative h-[clamp(3.6rem,7vw,5.6rem)] overflow-hidden">
                  <AnimatePresence initial={false} mode="popLayout">
                    <motion.h5
                      key={selectedEntry.term}
                      initial={{ y: "70%", opacity: 0, filter: "blur(10px)" }}
                      animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
                      exit={{ y: "-70%", opacity: 0, filter: "blur(10px)" }}
                      transition={SOFT_SPRING}
                      className="xp-serif absolute inset-x-0 text-[clamp(3rem,6vw,4.8rem)] leading-[1.1] tracking-[-0.03em] italic"
                    >
                      {selectedEntry.term}
                    </motion.h5>
                  </AnimatePresence>
                </div>
                <p className="xp-serif text-base text-muted-foreground italic">
                  {selectedEntry.occurrences.length} {selectedEntry.occurrences.length === 1 ? "occurrence" : "occurrences"} in{" "}
                  {bookCount} {bookCount === 1 ? "book" : "books"}
                </p>
              </div>

              <ol key={selectedEntry.term}>
                {selectedEntry.occurrences.map((occurrence, lineIndex) => {
                  const id = `${occurrence.highlight.id}-${occurrence.start}`;
                  return (
                    <ConcordanceLine
                      key={id}
                      occurrence={occurrence}
                      index={lineIndex}
                      book={booksById.get(occurrence.highlight.bookId)}
                      open={openLine === id}
                      onToggle={() => setOpenLine((current) => (current === id ? null : id))}
                    />
                  );
                })}
              </ol>

              {seeAlso.length > 0 && (
                <motion.p
                  key={`see-${selectedEntry.term}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className="xp-serif mt-8 text-center text-base text-muted-foreground"
                >
                  <span className="italic">See also</span>{" "}
                  {seeAlso.map((item, seeIndex) => (
                    <span key={item.term}>
                      {seeIndex > 0 && ", "}
                      <button
                        type="button"
                        onClick={() => select(item.term)}
                        className="cursor-pointer text-foreground/85 underline decoration-foreground/20 underline-offset-4 outline-none hover:decoration-foreground focus-visible:decoration-foreground"
                      >
                        {item.term}
                      </button>
                    </span>
                  ))}
                  .
                </motion.p>
              )}
            </>
          )}
        </div>
      </div>
    </StageSurface>
  );
}
