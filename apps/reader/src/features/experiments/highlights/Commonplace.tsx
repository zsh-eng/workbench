/**
 * Commonplace: highlights typeset as an anthology.
 *
 * Books become chapters and highlights become pull quotes. The hanging
 * quotation mark carries the highlight ink, and it is also the shared element
 * that flies into the broadside view when a passage is opened.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  LayoutGroup,
  animate,
  motion,
  useInView,
  useReducedMotion,
} from "motion/react";
import { ArrowLeft, ArrowRight, Check, Copy, Shuffle, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { StudioBook, StudioHighlight, StudioLibrary } from "../data/sample-library";
import {
  EASE_OUT,
  SNAPPY_SPRING,
  SOFT_SPRING,
  StageSurface,
  TypographicCover,
  inkColor,
  inkWash,
  useElementSize,
} from "../primitives";

interface BookChapter {
  book: StudioBook;
  highlights: StudioHighlight[];
  first: number;
  last: number;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];
const MONTH_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function wordCount(text: string) {
  return text.trim().split(/\s+/).length;
}

function quoteSize(text: string): string {
  if (wordCount(text) <= 3) return "text-[clamp(2.8rem,6vw,4.6rem)] italic leading-[0.95] tracking-[-0.02em]";
  if (text.length <= 90) return "text-[clamp(1.6rem,2.6vw,2.15rem)] leading-[1.18] tracking-[-0.01em]";
  if (text.length <= 220) return "text-[clamp(1.35rem,2vw,1.7rem)] leading-[1.28]";
  return "text-[1.25rem] leading-[1.42]";
}

function broadsideSize(text: string): string {
  if (wordCount(text) <= 3) return "text-[clamp(3.5rem,9vw,7.5rem)] italic leading-[0.92]";
  if (text.length <= 90) return "text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.08]";
  if (text.length <= 200) return "text-[clamp(1.8rem,3.4vw,3rem)] leading-[1.14]";
  return "text-[clamp(1.5rem,2.6vw,2.3rem)] leading-[1.22]";
}

function buildChapters(library: StudioLibrary): BookChapter[] {
  const booksById = new Map(library.books.map((book) => [book.id, book]));
  const groups = new Map<string, StudioHighlight[]>();
  for (const highlight of library.highlights) {
    const list = groups.get(highlight.bookId) ?? [];
    list.push(highlight);
    groups.set(highlight.bookId, list);
  }
  return [...groups.entries()]
    .flatMap(([bookId, highlights]) => {
      const book = booksById.get(bookId);
      if (!book) return [];
      const times = highlights.map((highlight) => highlight.createdAt);
      return [
        {
          book,
          highlights: [...highlights].sort((a, b) => a.locator - b.locator || a.createdAt - b.createdAt),
          first: Math.min(...times),
          last: Math.max(...times),
        },
      ];
    })
    .sort((a, b) => b.last - a.last);
}

function keptBetween(first: number, last: number): string {
  const a = MONTH_YEAR.format(first);
  const b = MONTH_YEAR.format(last);
  return a === b ? `kept in ${a}` : `kept between ${a} and ${b}`;
}

function Quote({
  highlight,
  index,
  scroller,
  flashing,
  hidden,
  onOpen,
}: {
  highlight: StudioHighlight;
  index: number;
  scroller: RefObject<HTMLDivElement | null>;
  flashing: boolean;
  hidden: boolean;
  onOpen: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const display = wordCount(highlight.text) <= 3;

  return (
    <motion.figure
      id={`cp-${highlight.id}`}
      initial={reducedMotion ? false : ({ "--reveal": "0%", y: 18, opacity: 0.001 } as Record<string, string | number>)}
      whileInView={{ "--reveal": "135%", y: 0, opacity: 1 } as Record<string, string | number>}
      viewport={{ root: scroller, once: true, amount: 0.25 }}
      transition={{ duration: 1.1, ease: EASE_OUT, delay: (index % 3) * 0.04 }}
      className="group relative grid grid-cols-[2.6rem_minmax(0,1fr)] gap-x-3 py-7 md:grid-cols-[3.4rem_minmax(0,1fr)] md:gap-x-4"
      style={{
        maskImage: "linear-gradient(to bottom, #000 calc(var(--reveal, 135%) - 35%), transparent var(--reveal, 135%))",
        WebkitMaskImage: "linear-gradient(to bottom, #000 calc(var(--reveal, 135%) - 35%), transparent var(--reveal, 135%))",
      }}
    >
      <motion.span
        layoutId={`cp-mark-${highlight.id}`}
        transition={SOFT_SPRING}
        aria-hidden="true"
        className={cn("xp-serif block text-right leading-none select-none", hidden && "opacity-0")}
        style={{ color: inkColor(highlight.color), fontSize: display ? "4.4rem" : "3.6rem", marginTop: display ? "-0.05em" : "-0.08em" }}
      >
        “
      </motion.span>
      <button
        type="button"
        onClick={onOpen}
        className="cursor-pointer text-left outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-ring"
      >
        <blockquote className={cn("xp-serif text-pretty text-foreground", quoteSize(highlight.text))}>
          <span
            className="xp-ink"
            style={{
              ["--xp-ink" as string]: inkWash(highlight.color),
              ["--xp-ink-size" as string]: flashing ? "100%" : "0%",
              color: "inherit",
            }}
          >
            {highlight.text}
          </span>
        </blockquote>
        <figcaption className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="xp-smcp text-[13px] text-foreground/70">{highlight.chapter}</span>
          <span className="opacity-40">·</span>
          <span className="xp-serif xp-onum text-sm italic">p. {highlight.locator}</span>
          <span className="opacity-40">·</span>
          <span>{SHORT_DATE.format(highlight.createdAt)}</span>
          <span className="ml-1 translate-x-[-4px] opacity-0 transition-[opacity,translate] duration-300 group-hover:translate-x-0 group-hover:opacity-100">
            Open as broadside →
          </span>
        </figcaption>
        {highlight.note && (
          <p className="xp-serif mt-3 border-l-2 pl-3 text-base text-foreground/70 italic" style={{ borderColor: inkColor(highlight.color) }}>
            {highlight.note}
          </p>
        )}
      </button>
    </motion.figure>
  );
}

function ChapterSection({
  chapter,
  index,
  scroller,
  onActive,
  flashId,
  openId,
  onOpen,
}: {
  chapter: BookChapter;
  index: number;
  scroller: RefObject<HTMLDivElement | null>;
  onActive: (bookId: string) => void;
  flashId: string | null;
  openId: string | null;
  onOpen: (highlight: StudioHighlight) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const active = useInView(ref, { root: scroller, margin: "-35% 0px -60% 0px" });
  const reducedMotion = useReducedMotion() ?? false;

  useEffect(() => {
    if (active) onActive(chapter.book.id);
  }, [active, chapter.book.id, onActive]);

  return (
    <section ref={ref} id={`cp-book-${chapter.book.id}`} className="scroll-mt-6 pb-16">
      <motion.header
        initial={reducedMotion ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ root: scroller, once: true, amount: 0.4 }}
        transition={{ duration: 0.9, ease: EASE_OUT }}
        className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-6 border-b pb-6"
      >
        <div>
          <p className="xp-serif xp-onum mb-3 text-lg text-muted-foreground italic">
            {ROMAN[index] ?? index + 1}.
          </p>
          <h3 className="xp-serif text-[clamp(2.6rem,5.5vw,4.8rem)] leading-[0.92] font-normal tracking-[-0.035em] text-balance">
            {chapter.book.title}
          </h3>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="xp-smcp text-sm tracking-[0.18em] text-foreground/75">{chapter.book.author}</span>
            <span className="xp-serif text-base text-muted-foreground italic">
              {chapter.highlights.length} {chapter.highlights.length === 1 ? "passage" : "passages"}, {keptBetween(chapter.first, chapter.last)}
            </span>
          </p>
        </div>
        <TypographicCover
          book={chapter.book}
          className="aspect-[2/3] w-16 rounded-r-md rounded-l-[3px] shadow-[0_10px_24px_-12px_rgba(0,0,0,0.5)] md:w-20"
        />
      </motion.header>
      {chapter.highlights.map((highlight, quoteIndex) => (
        <Quote
          key={highlight.id}
          highlight={highlight}
          index={quoteIndex}
          scroller={scroller}
          flashing={flashId === highlight.id}
          hidden={openId === highlight.id}
          onOpen={() => onOpen(highlight)}
        />
      ))}
    </section>
  );
}

function Broadside({
  highlight,
  book,
  position,
  total,
  onClose,
  onStep,
}: {
  highlight: StudioHighlight;
  book: StudioBook | undefined;
  position: number;
  total: number;
  onClose: () => void;
  onStep: (delta: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const words = highlight.text.split(/(\s+)/);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onStep(1);
      if (event.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  return (
    <motion.div
      className="absolute inset-0 z-30 flex flex-col bg-background"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      transition={{ duration: 0.3 }}
      role="dialog"
      aria-label="Passage"
    >
      <div className="flex items-center justify-between p-4 md:p-6">
        <p className="xp-serif xp-onum text-sm text-muted-foreground italic">
          {position + 1} of {total}
        </p>
        <div className="flex items-center gap-1">
          {[
            { label: "Previous passage", icon: ArrowLeft, onClick: () => onStep(-1) },
            { label: "Next passage", icon: ArrowRight, onClick: () => onStep(1) },
          ].map(({ label, icon: Icon, onClick }) => (
            <button
              key={label}
              type="button"
              aria-label={label}
              onClick={onClick}
              className="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button
            type="button"
            aria-label="Copy passage"
            onClick={() => {
              void navigator.clipboard?.writeText(`“${highlight.text}” — ${book?.author ?? ""}, ${book?.title ?? ""}`);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
            className="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={copied ? "done" : "copy"}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={SNAPPY_SPRING}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-9 cursor-pointer place-items-center rounded-full bg-foreground text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-10 md:px-16">
        <div className="relative w-full max-w-4xl">
          <motion.span
            layoutId={`cp-mark-${highlight.id}`}
            transition={SOFT_SPRING}
            aria-hidden="true"
            className="xp-serif absolute -top-[0.42em] -left-[0.08em] block leading-none select-none md:-left-[0.5em]"
            style={{ color: inkColor(highlight.color), fontSize: "clamp(7rem,14vw,12rem)" }}
          >
            “
          </motion.span>
          <AnimatePresence mode="wait">
            <motion.div key={highlight.id} exit={{ opacity: 0, y: -10, filter: "blur(6px)", transition: { duration: 0.2 } }}>
              <blockquote className={cn("xp-serif relative text-balance", broadsideSize(highlight.text))}>
                {words.map((word, index) =>
                  /^\s+$/.test(word) ? (
                    word
                  ) : (
                    <motion.span
                      key={index}
                      className="inline-block"
                      initial={{ opacity: 0, y: "0.35em", filter: "blur(8px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.12 + Math.min(index, 80) * 0.012 }}
                    >
                      {word}
                    </motion.span>
                  ),
                )}
              </blockquote>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.35, ease: EASE_OUT }}
                className="mt-10 flex items-center gap-4"
              >
                <span className="h-px w-12" style={{ background: inkColor(highlight.color) }} />
                <p>
                  <span className="xp-serif text-xl italic">{book?.title}</span>
                  <span className="xp-smcp ml-3 text-sm tracking-[0.18em] text-muted-foreground">{book?.author}</span>
                </p>
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export function Commonplace({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const chapters = useMemo(() => buildChapters(library), [library]);
  const ordered = useMemo(() => chapters.flatMap((chapter) => chapter.highlights), [chapters]);
  const booksById = useMemo(() => new Map(library.books.map((book) => [book.id, book])), [library.books]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeBook, setActiveBook] = useState<string | null>(chapters[0]?.book.id ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const wide = size.width >= 820;

  const scrollToElement = (id: string, offset = 24) => {
    const scroller = scrollerRef.current;
    const element = document.getElementById(id);
    if (!scroller || !element) return;
    const target =
      element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - offset;
    if (reducedMotion) {
      scroller.scrollTop = target;
      return;
    }
    void animate(scroller.scrollTop, target, {
      duration: 0.9,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (value) => {
        scroller.scrollTop = value;
      },
    });
  };

  const openRandom = () => {
    const pick = ordered[Math.floor(Math.random() * ordered.length)];
    if (!pick) return;
    scrollToElement(`cp-${pick.id}`, size.height * 0.3);
    setFlashId(null);
    window.setTimeout(() => setFlashId(pick.id), reducedMotion ? 0 : 700);
    window.setTimeout(() => setFlashId((current) => (current === pick.id ? null : current)), 2600);
  };

  const openIndex = ordered.findIndex((highlight) => highlight.id === openId);
  const openHighlight = openIndex >= 0 ? ordered[openIndex] : null;

  if (chapters.length === 0) {
    return (
      <StageSurface tone="inherit" className="grid size-full place-items-center">
        <p className="xp-serif text-2xl text-muted-foreground italic">Nothing kept yet.</p>
      </StageSurface>
    );
  }

  return (
    <StageSurface tone="inherit" className="relative size-full">
      <LayoutGroup id="commonplace">
        <div ref={sizeRef} className="absolute inset-0">
          <div ref={scrollerRef} className="xp-scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain">
            <div className={cn("mx-auto grid max-w-[1180px] gap-x-14 px-5 md:px-10", wide ? "grid-cols-[14rem_minmax(0,1fr)]" : "grid-cols-1")}>
              {wide && (
                <nav aria-label="Contents" className="sticky top-0 flex flex-col self-start pt-10 pb-6" style={{ height: size.height }}>
                  <p className="xp-smcp mb-5 text-xs tracking-[0.24em] text-muted-foreground">Contents</p>
                  <ol className="xp-scroll-quiet min-h-0 flex-1 space-y-0.5 overflow-y-auto">
                    {chapters.map((chapter, index) => {
                      const active = chapter.book.id === activeBook;
                      return (
                        <li key={chapter.book.id}>
                          <button
                            type="button"
                            onClick={() => scrollToElement(`cp-book-${chapter.book.id}`)}
                            className={cn(
                              "relative grid w-full cursor-pointer grid-cols-[1.6rem_minmax(0,1fr)_auto] items-baseline gap-x-1 rounded-lg py-1.5 pr-2 pl-2.5 text-left outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            {active && (
                              <motion.span
                                layoutId="cp-contents-active"
                                transition={SOFT_SPRING}
                                className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-foreground"
                              />
                            )}
                            <span className="xp-serif xp-onum text-sm italic opacity-70">{ROMAN[index] ?? index + 1}</span>
                            <span className="xp-serif truncate text-[17px] leading-tight">{chapter.book.title}</span>
                            <span className="xp-serif xp-onum text-sm opacity-60">{chapter.highlights.length}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <button
                    type="button"
                    onClick={openRandom}
                    className="group mt-4 flex cursor-pointer items-center gap-2 self-start rounded-full border px-3.5 py-2 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Shuffle className="size-3.5 transition-transform duration-500 group-hover:rotate-180" />
                    Open to a random page
                  </button>
                </nav>
              )}

              <div className="min-w-0 pt-10 pb-24">
                {!wide && (
                  <button
                    type="button"
                    onClick={openRandom}
                    className="mb-8 flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-medium"
                  >
                    <Shuffle className="size-3.5" /> Open to a random page
                  </button>
                )}
                {chapters.map((chapter, index) => (
                  <ChapterSection
                    key={chapter.book.id}
                    chapter={chapter}
                    index={index}
                    scroller={scrollerRef}
                    onActive={setActiveBook}
                    flashId={flashId}
                    openId={openId}
                    onOpen={(highlight) => setOpenId(highlight.id)}
                  />
                ))}
                <p className="xp-serif pt-4 text-center text-xl text-muted-foreground italic">
                  {ordered.length} passages from {chapters.length} books.
                </p>
              </div>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {openHighlight && (
            <Broadside
              key="broadside"
              highlight={openHighlight}
              book={booksById.get(openHighlight.bookId)}
              position={openIndex}
              total={ordered.length}
              onClose={() => setOpenId(null)}
              onStep={(delta) => {
                const next = ordered[(openIndex + delta + ordered.length) % ordered.length];
                setOpenId(next.id);
              }}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>
    </StageSurface>
  );
}
