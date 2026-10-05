/**
 * Stack: the app sidebar is the pile on your nightstand.
 *
 * Books in progress lie on top of each other at the foot of the sidebar,
 * spines out, each as thick as it is long. Choose one: it slides out of the
 * pile, the books above drop into its place, and it turns in the air to show
 * its cover, lands on the desk and opens. Close it and it flies back to the
 * top of the pile. Choose a cover in the library to add it to the pile.
 */
import { cn } from "@/lib/utils";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Easing,
} from "motion/react";
import { Clock3, Highlighter, LibraryBig, Settings2, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { StudioBook, StudioInk, StudioLibrary } from "../data/sample-library";
import { MOBY_DICK_CHAPTER, SELF_RELIANCE_CHAPTER } from "../data/sample-texts";
import {
  EASE_OUT,
  getStableNumber,
  SNAPPY_SPRING,
  toneSurface,
  toneWash,
  TypographicCover,
  useElementSize,
} from "../primitives";
import { shelfBooks } from "../quiet";
import { BookPage, READING_PAGE } from "../data/walden-book";
import "./edge.css";

interface Pose {
  x: number;
  y: number;
  scale: number;
  /** Rotation in the page plane, degrees. */
  rotate: number;
  /** Turn about the vertical axis, degrees: 90 shows the spine, 0 the cover. */
  rotateY: number;
  /** Cover opening, 0 to 1. */
  open: number;
  /** Height of the arc flown on the way to this pose. */
  lift: number;
}

interface Flight {
  key: number;
  bookId: string;
  poses: Pose[];
  durations: number[];
  eases: Easing[];
  depth: number;
  end: "desk" | "pile";
}

interface SpineMetrics {
  length: number;
  thickness: number;
  jitter: number;
  tilt: number;
  ribbon: StudioInk;
}

const SIDEBAR = 256;
const RIBBON_INKS: StudioInk[] = ["magenta", "green", "blue", "yellow"];
const DROP = { type: "spring", stiffness: 560, damping: 22, mass: 0.9 } as const;
const PILE_LIMIT = 7;

function spineMetrics(book: StudioBook): SpineMetrics {
  const hash = getStableNumber(book.id);
  return {
    length: 176 + (hash % 28),
    thickness: 19 + ((hash >> 4) % 8),
    jitter: ((hash >> 8) % 15) - 7,
    tilt: (((hash >> 12) % 5) - 2) * 0.45,
    ribbon: RIBBON_INKS[(hash >> 16) % RIBBON_INKS.length],
  };
}

function surname(author: string): string {
  return author.split(" ").at(-1) ?? author;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function poseAt(poses: Pose[], value: number): Pose {
  const index = Math.max(0, Math.min(poses.length - 2, Math.floor(value)));
  const fraction = Math.max(0, Math.min(1, value - index));
  const from = poses[index];
  const to = poses[index + 1];
  return {
    x: lerp(from.x, to.x, fraction),
    y: lerp(from.y, to.y, fraction) - Math.sin(Math.PI * fraction) * to.lift,
    scale: lerp(from.scale, to.scale, fraction),
    rotate: lerp(from.rotate, to.rotate, fraction),
    rotateY: lerp(from.rotateY, to.rotateY, fraction),
    open: lerp(from.open, to.open, fraction),
    lift: 0,
  };
}

function initialPile(books: StudioBook[]): string[] {
  const reading = books
    .filter((book) => book.status === "reading")
    .sort((a, b) => (a.lastReadAt ?? 0) - (b.lastReadAt ?? 0));
  const next = books
    .filter((book) => book.status === "want-to-read")
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, Math.max(0, 4 - reading.length));
  // Bottom of the pile first; the most recent book lies on top.
  return [...next.reverse(), ...reading].slice(-PILE_LIMIT).map((book) => book.id);
}

export function Stack({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const books = shelfBooks(library);
  const byId = new Map(books.map((book) => [book.id, book]));
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const stageNode = useRef<HTMLDivElement | null>(null);
  const [pile, setPile] = useState<string[]>(() => initialPile(books));
  const [openId, setOpenId] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [hovered, setHovered] = useState<{ id: string; y: number } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [landedId, setLandedId] = useState<string | null>(null);

  const narrow = stage.width > 0 && stage.width < 760;
  const sidebarWidth = narrow ? 0 : SIDEBAR;
  const mainWidth = stage.width - sidebarWidth;
  const pageHeight = Math.max(320, Math.min(stage.height - 112, 700));
  const pageWidth = Math.min(Math.round(pageHeight * 0.68), mainWidth - 40);
  const desk = {
    x: sidebarWidth + mainWidth / 2,
    y: 64 + pageHeight / 2,
  };

  const setStageRef = (node: HTMLDivElement | null) => {
    stageNode.current = node;
    stageRef(node);
  };

  const rectOf = (selector: string) => {
    const root = stageNode.current;
    const element = root?.querySelector<HTMLElement>(selector);
    if (!root || !element) return null;
    const base = root.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { x: rect.left - base.left, y: rect.top - base.top, width: rect.width, height: rect.height };
  };

  const deskPose = (open: number): Pose => ({
    x: desk.x,
    y: desk.y,
    scale: 1,
    rotate: 0,
    rotateY: 0,
    open,
    lift: 0,
  });

  const spinePose = (rect: { x: number; y: number; width: number; height: number }, tilt: number, lift = 0): Pose => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    scale: rect.width / pageHeight,
    rotate: -90 + tilt,
    rotateY: 90,
    open: 0,
    lift,
  });

  /** Where a book lands on the pile: just above the current top book. */
  const pileTopRect = (book: StudioBook) => {
    const metrics = spineMetrics(book);
    const top = pile.length > 0 ? rectOf(`[data-spine="${pile[pile.length - 1]}"]`) : null;
    const base = rectOf("[data-pile-floor]");
    const button = rectOf("[data-nightstand-button]");
    if (narrow && button) {
      return { x: button.x + button.width / 2 - metrics.length * 0.15, y: button.y, width: metrics.length * 0.3, height: metrics.thickness * 0.3 };
    }
    const floorY = top ? top.y - 2 : (base?.y ?? stage.height - 80);
    const left = (base?.x ?? 24) + 6 + metrics.jitter;
    return { x: left, y: floorY - metrics.thickness, width: metrics.length, height: metrics.thickness };
  };

  const depthFor = (book: StudioBook) => {
    const metrics = spineMetrics(book);
    return (metrics.thickness / metrics.length) * pageHeight;
  };

  const startOpen = (id: string) => {
    const book = byId.get(id);
    const rect = rectOf(`[data-spine="${id}"]`);
    if (!book || !rect) return;
    setHovered(null);
    setDrawerOpen(false);
    setPile((current) => current.filter((value) => value !== id));
    if (reducedMotion) {
      setOpenId(id);
      return;
    }
    const metrics = spineMetrics(book);
    const out = { ...rect, x: rect.x + 46 };
    setFlight({
      key: Date.now(),
      bookId: id,
      depth: depthFor(book),
      end: "desk",
      poses: [spinePose(rect, metrics.tilt), spinePose(out, 0), { ...deskPose(0), lift: 70 }, deskPose(1)],
      durations: [0.2, 0.78, 0.62],
      eases: [EASE_OUT, [0.45, 0.05, 0.2, 1], [0.6, 0, 0.25, 1]],
    });
  };

  const startClose = (then: string | null) => {
    if (!openId) return;
    const book = byId.get(openId);
    if (!book) return;
    setQueued(then);
    if (reducedMotion) {
      setPile((current) => [...current, openId].slice(-PILE_LIMIT));
      setOpenId(null);
      if (then) window.setTimeout(() => startOpen(then), 0);
      return;
    }
    const target = pileTopRect(book);
    setFlight({
      key: Date.now(),
      bookId: openId,
      depth: depthFor(book),
      end: "pile",
      poses: [deskPose(1), deskPose(0), { ...spinePose(target, spineMetrics(book).tilt), lift: 90 }],
      durations: [0.5, 0.82],
      eases: [[0.5, 0, 0.3, 1], [0.45, 0.05, 0.25, 1]],
    });
    setOpenId(null);
  };

  const shelve = (id: string) => {
    const book = byId.get(id);
    const rect = rectOf(`[data-cover="${id}"]`);
    if (!book || !rect || flight) return;
    if (reducedMotion) {
      setPile((current) => [...current, id].slice(-PILE_LIMIT));
      return;
    }
    const target = pileTopRect(book);
    setFlight({
      key: Date.now(),
      bookId: id,
      depth: depthFor(book),
      end: "pile",
      poses: [
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, scale: rect.width / pageWidth, rotate: 0, rotateY: 0, open: 0, lift: 0 },
        { ...spinePose(target, spineMetrics(book).tilt), lift: 120 },
      ],
      durations: [0.9],
      eases: [[0.45, 0.05, 0.25, 1]],
    });
  };

  const chooseSpine = (id: string) => {
    if (flight) return;
    if (openId) startClose(id);
    else startOpen(id);
  };

  const finishFlight = (done: Flight) => {
    setFlight(null);
    if (done.end === "desk") {
      setOpenId(done.bookId);
      return;
    }
    setPile((current) => [...current.filter((id) => id !== done.bookId), done.bookId].slice(-PILE_LIMIT));
    setLandedId(done.bookId);
    if (queued) {
      const next = queued;
      setQueued(null);
      // Let the landing settle before the next book leaves.
      window.setTimeout(() => startOpenAfterLanding(next), 140);
    }
  };

  // The pile has re-rendered by now, so the spine can be measured.
  const startOpenAfterLanding = (id: string) => startOpen(id);

  useEffect(() => {
    if (!landedId) return;
    const timer = window.setTimeout(() => setLandedId(null), 700);
    return () => window.clearTimeout(timer);
  }, [landedId]);

  const flyingBook = flight ? byId.get(flight.bookId) : undefined;
  const openBook = openId ? byId.get(openId) : undefined;
  const shelfOnly = books.filter((book) => !pile.includes(book.id) && book.id !== openId && book.id !== flight?.bookId);
  const ready = stage.width > 0;
  const pileBooks = pile.map((id) => byId.get(id)).filter((book): book is StudioBook => Boolean(book));
  const hoveredBook = hovered ? byId.get(hovered.id) : undefined;

  const sidebar = (
    <Sidebar
      pileBooks={pileBooks}
      openBook={openBook}
      landedId={landedId}
      busy={flight !== null}
      onChoose={chooseSpine}
      onHover={(id, element) => {
        const root = stageNode.current;
        if (!id || !element || !root) {
          setHovered(null);
          return;
        }
        setHovered({ id, y: element.getBoundingClientRect().top - root.getBoundingClientRect().top });
      }}
      onLibrary={() => startClose(null)}
    />
  );

  return (
    <div ref={setStageRef} className="relative size-full overflow-hidden bg-background text-foreground">
      {ready && (
        <>
          {!narrow && (
            <aside className="absolute inset-y-0 left-0 z-20 border-r border-foreground/[0.07] bg-sidebar" style={{ width: SIDEBAR }}>
              {sidebar}
            </aside>
          )}

          <main className="absolute inset-y-0 right-0" style={{ left: sidebarWidth }}>
            <AnimatePresence initial={false}>
              {openBook ? (
                // The flying book hands over to the desk without a fade.
                <motion.div
                  key={`reader-${openBook.id}`}
                  className="absolute inset-0"
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                >
                  <ReaderDesk book={openBook} pageWidth={pageWidth} pageHeight={pageHeight} onClose={() => startClose(null)} />
                </motion.div>
              ) : flight?.end === "desk" ? null : (
                <motion.div
                  key="library"
                  className="absolute inset-0"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.4, delay: 0.45 } }}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                >
                  <LibraryShelf books={shelfOnly} busy={flight !== null} onShelve={shelve} />
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {narrow && (
            <>
              <button
                type="button"
                data-nightstand-button=""
                onClick={() => setDrawerOpen(true)}
                className="xp-smcp absolute bottom-4 left-4 z-30 flex h-10 items-center gap-2 rounded-full border bg-background/90 px-4 text-xs shadow-lg backdrop-blur-md"
              >
                <span className="flex flex-col gap-[2px]">
                  {pileBooks.slice(-3).reverse().map((book) => (
                    <span key={book.id} className="block h-[3px] w-4 rounded-full" style={{ background: toneSurface(book.tone) }} />
                  ))}
                </span>
                Nightstand · {pileBooks.length}
              </button>
              <AnimatePresence>
                {drawerOpen && (
                  <>
                    <motion.button
                      type="button"
                      aria-label="Close nightstand"
                      className="absolute inset-0 z-30 bg-black/30"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setDrawerOpen(false)}
                    />
                    <motion.aside
                      className="absolute inset-y-0 left-0 z-40 border-r bg-sidebar shadow-2xl"
                      style={{ width: SIDEBAR }}
                      initial={{ x: -SIDEBAR }}
                      animate={{ x: 0 }}
                      exit={{ x: -SIDEBAR }}
                      transition={SNAPPY_SPRING}
                    >
                      {sidebar}
                    </motion.aside>
                  </>
                )}
              </AnimatePresence>
            </>
          )}

          <AnimatePresence>
            {hoveredBook && !flight && !narrow && (
              <SpineCard key={hoveredBook.id} book={hoveredBook} top={hovered?.y ?? 0} />
            )}
          </AnimatePresence>

          {flight && flyingBook && (
            <FlyingBook
              key={flight.key}
              flight={flight}
              book={flyingBook}
              width={pageWidth}
              height={pageHeight}
              onDone={() => finishFlight(flight)}
            />
          )}
        </>
      )}
    </div>
  );
}

function Sidebar({
  pileBooks,
  openBook,
  landedId,
  busy,
  onChoose,
  onHover,
  onLibrary,
}: {
  pileBooks: StudioBook[];
  openBook: StudioBook | undefined;
  landedId: string | null;
  busy: boolean;
  onChoose: (id: string) => void;
  onHover: (id: string | null, element?: HTMLElement) => void;
  onLibrary: () => void;
}) {
  const nav: { label: string; icon: LucideIcon; active: boolean; onClick?: () => void }[] = [
    { label: "Library", icon: LibraryBig, active: !openBook, onClick: openBook ? onLibrary : undefined },
    { label: "Highlights", icon: Highlighter, active: false },
    { label: "Reading time", icon: Clock3, active: false },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <p className="xp-serif text-[1.45rem] italic">Reader</p>
      </div>

      <nav aria-label="Sections" className="px-3">
        {nav.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={cn(
              "flex h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              item.active ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <item.icon className="size-4" strokeWidth={1.6} />
            {item.label}
          </button>
        ))}
      </nav>

      <AnimatePresence initial={false}>
        {openBook && (
          <motion.section
            key={openBook.id}
            aria-label="On the desk"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className="overflow-hidden"
          >
            <div className="mx-3 mt-5 rounded-xl border border-foreground/[0.07] p-3">
              <p className="xp-smcp text-[10.5px] text-muted-foreground">On the desk</p>
              <div className="mt-2 flex gap-3">
                <TypographicCover book={openBook} compact className="h-14 w-10 shrink-0 rounded-[2px] shadow-sm" />
                <div className="min-w-0">
                  <p className="xp-serif truncate text-[15px] leading-tight italic">{openBook.title}</p>
                  <p className="xp-smcp mt-0.5 truncate text-[10.5px] text-muted-foreground">{openBook.author}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="relative h-[3px] w-20 overflow-hidden rounded-full bg-foreground/10">
                      <motion.span
                        className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.round(openBook.progress * 100)}%` }}
                        transition={{ duration: 0.8, delay: 0.2, ease: EASE_OUT }}
                      />
                    </span>
                    <span className="xp-lnum text-[10.5px] text-muted-foreground">{Math.round(openBook.progress * 100)}%</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onLibrary}
                className="xp-smcp mt-3 cursor-pointer text-[10.5px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                Put it back on the pile
              </button>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1" />

      <div className="px-5 pb-2">
        <p className="xp-smcp text-[10.5px] text-muted-foreground">
          On the nightstand · {pileBooks.length}
        </p>
      </div>
      <ul aria-label="On the nightstand" className="flex flex-col-reverse px-4 pb-1">
        <AnimatePresence initial={false}>
          {pileBooks.map((book) => (
            <PileSpine
              key={book.id}
              book={book}
              landed={landedId === book.id}
              disabled={busy}
              onChoose={() => onChoose(book.id)}
              onHover={onHover}
            />
          ))}
        </AnimatePresence>
      </ul>
      <div data-pile-floor="" className="mx-4 mb-3 h-[3px] rounded-full bg-foreground/[0.08]" />

      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-foreground/[0.06] px-5 text-[12px] text-muted-foreground">
        <Settings2 className="size-3.5" strokeWidth={1.6} />
        Settings
      </div>
    </div>
  );
}

function SpineFace({
  book,
  metrics,
  unit = 1,
  vertical = false,
  className,
  style,
}: {
  book: StudioBook;
  metrics: SpineMetrics;
  /** Size multiplier; the flying book draws its spine at full scale. */
  unit?: number;
  vertical?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const cloth = toneSurface(book.tone);
  const fontSize = Math.max(8.5, Math.min(11.5, metrics.thickness * 0.45)) * unit;
  return (
    <span
      className={cn("relative block overflow-hidden text-background", className)}
      style={{
        background: cloth,
        writingMode: vertical ? "vertical-rl" : undefined,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background: vertical
            ? "linear-gradient(to left, rgb(255 255 255 / 0.2), transparent 38%, rgb(0 0 0 / 0.22))"
            : "linear-gradient(to bottom, rgb(255 255 255 / 0.2), transparent 38%, rgb(0 0 0 / 0.22))",
        }}
      />
      {[10, 14].map((offset) => (
        <span
          key={offset}
          aria-hidden="true"
          className="absolute bg-background/35"
          style={
            vertical
              ? { left: 0, right: 0, height: unit, top: offset * unit }
              : { top: 0, bottom: 0, width: 1, left: offset }
          }
        />
      ))}
      {[10, 14].map((offset) => (
        <span
          key={`end-${offset}`}
          aria-hidden="true"
          className="absolute bg-background/35"
          style={
            vertical
              ? { left: 0, right: 0, height: unit, bottom: offset * unit }
              : { top: 0, bottom: 0, width: 1, right: offset }
          }
        />
      ))}
      <span
        className="xp-smcp absolute inset-0 flex items-center justify-between gap-2 whitespace-nowrap"
        style={{
          fontSize,
          padding: vertical ? `${22 * unit}px 0` : "0 22px",
        }}
      >
        <span className="truncate font-medium">{book.title}</span>
        <span className="shrink-0 opacity-70">{surname(book.author)}</span>
      </span>
    </span>
  );
}

function PileSpine({
  book,
  landed,
  disabled,
  onChoose,
  onHover,
}: {
  book: StudioBook;
  landed: boolean;
  disabled: boolean;
  onChoose: () => void;
  onHover: (id: string | null, element?: HTMLElement) => void;
}) {
  const metrics = spineMetrics(book);
  const [pointing, setPointing] = useState(false);

  return (
    <motion.li
      layout="position"
      initial={landed ? { y: -26 } : false}
      animate={{ y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0 } }}
      transition={{ layout: DROP, y: DROP }}
      className="relative"
      style={{ height: metrics.thickness, marginTop: 1 }}
    >
      <motion.button
        type="button"
        data-spine={book.id}
        disabled={disabled}
        onClick={onChoose}
        onPointerEnter={(event) => {
          setPointing(true);
          onHover(book.id, event.currentTarget);
        }}
        onPointerLeave={() => {
          setPointing(false);
          onHover(null);
        }}
        aria-label={`Open ${book.title}`}
        className="absolute top-0 left-0 block cursor-pointer rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        style={{ width: metrics.length, height: metrics.thickness, rotate: metrics.tilt }}
        animate={{ x: metrics.jitter + (pointing && !disabled ? 16 : 0) }}
        transition={SNAPPY_SPRING}
      >
        <SpineFace
          book={book}
          metrics={metrics}
          className="size-full rounded-[2px] shadow-[0_1px_0_rgb(0_0_0/0.15),0_3px_6px_-2px_rgb(0_0_0/0.25)]"
        />
        {/* A ribbon marker hangs out of the pages at the foot of the book. */}
        <span
          aria-hidden="true"
          className="xp-swallowtail absolute top-[55%] -right-[2px] h-4 w-[5px]"
          style={{ background: `var(--${metrics.ribbon}-primary, var(--${metrics.ribbon}-secondary))`, "--xp-notch": "3px" } as CSSProperties}
        />
      </motion.button>
    </motion.li>
  );
}

function SpineCard({ book, top }: { book: StudioBook; top: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -6, transition: { duration: 0.1 } }}
      transition={{ duration: 0.2, ease: EASE_OUT }}
      className="pointer-events-none absolute z-30 flex w-64 gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-[0_18px_40px_-18px_rgb(0_0_0/0.4)]"
      style={{ left: SIDEBAR + 10, top: Math.max(12, top - 34) }}
    >
      <TypographicCover book={book} className="h-[72px] w-12 shrink-0 rounded-[2px] shadow-sm" />
      <div className="min-w-0 py-0.5">
        <p className="xp-serif truncate text-[15px] leading-tight italic">{book.title}</p>
        <p className="xp-smcp mt-0.5 truncate text-[10.5px] text-muted-foreground">{book.author}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {book.progress > 0 ? `${Math.round(book.progress * 100)}% read · open where you stopped` : "Not started · open at the beginning"}
        </p>
      </div>
    </motion.div>
  );
}

function LibraryShelf({
  books,
  busy,
  onShelve,
}: {
  books: StudioBook[];
  busy: boolean;
  onShelve: (id: string) => void;
}) {
  return (
    <div className="xp-scroll-quiet size-full overflow-y-auto overscroll-contain px-6 pt-8 pb-20 md:px-10 md:pt-10">
      <div className="flex items-end justify-between gap-6">
        <div>
          <h3 className="xp-serif text-[2.6rem] leading-none tracking-[-0.02em] italic md:text-[3.4rem]">Library</h3>
          <p className="xp-smcp mt-2 text-xs text-muted-foreground">{books.length} books on the shelves</p>
        </div>
        <p className="max-w-56 text-right text-xs text-muted-foreground max-md:hidden">
          Choose a cover to put it on the nightstand. Choose a spine to read.
        </p>
      </div>
      <ul className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-6 gap-y-8">
        <AnimatePresence initial={false}>
          {books.map((book) => (
            <motion.li
              key={book.id}
              layout
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              transition={{ layout: SNAPPY_SPRING }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => onShelve(book.id)}
                aria-label={`Put ${book.title} on the nightstand`}
                className="group block w-full cursor-pointer text-left outline-none disabled:cursor-default"
              >
                <span
                  data-cover={book.id}
                  className="block aspect-[2/3] overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.12),0_10px_24px_-14px_rgb(0_0_0/0.4)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-1.5 group-focus-visible:-translate-y-1.5"
                >
                  <TypographicCover book={book} className="size-full" />
                </span>
                <span className="xp-serif mt-2.5 line-clamp-2 block text-[14px] leading-tight">{book.title}</span>
                <span className="xp-smcp mt-0.5 block truncate text-[10px] text-muted-foreground">{surname(book.author)}</span>
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function BookContent({ book }: { book: StudioBook }) {
  if (book.id === "walden") return <BookPage page={READING_PAGE} />;
  const chapter = book.id === "moby-dick" ? MOBY_DICK_CHAPTER : book.id === "essays" ? SELF_RELIANCE_CHAPTER : null;
  if (chapter) {
    return (
      <div className="relative flex size-full flex-col overflow-hidden bg-background px-[12%] pt-[10%] pb-[11%] text-foreground" style={{ fontSize: 18 }}>
        <p className="xp-smcp text-center text-[0.66em] tracking-[0.24em] text-muted-foreground">Chapter {chapter.number}</p>
        <h4 className="xp-serif mt-[0.35em] mb-[1.4em] text-center text-[1.42em] leading-[1.12] italic">{chapter.title}</h4>
        <div
          className="xp-book-text min-h-0 flex-1 overflow-hidden leading-[1.5]"
          style={{
            maskImage: "linear-gradient(to bottom, #000 calc(100% - 3em), transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 3em), transparent)",
          }}
        >
          {chapter.paragraphs.slice(0, 3).map((paragraph, index) => (
            <p key={index} className={index === 0 ? "xp-opening" : undefined}>
              {paragraph}
            </p>
          ))}
        </div>
        <p className="xp-onum absolute inset-x-0 bottom-[4%] text-center text-[0.68em] text-muted-foreground">1</p>
      </div>
    );
  }
  return (
    <div className="flex size-full flex-col items-center justify-center bg-background px-[14%] text-center text-foreground">
      <p className="xp-serif text-[2.1rem] leading-[1.08] text-balance italic">{book.title}</p>
      <span aria-hidden="true" className="my-6 h-px w-10 bg-foreground/25" />
      <p className="xp-smcp text-sm text-muted-foreground">{book.author}</p>
    </div>
  );
}

function ReaderDesk({
  book,
  pageWidth,
  pageHeight,
  onClose,
}: {
  book: StudioBook;
  pageWidth: number;
  pageHeight: number;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0">
      <header className="absolute inset-x-0 top-0 flex h-14 items-center justify-between gap-3 px-5">
        <button
          type="button"
          onClick={onClose}
          className="xp-smcp flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          ← Back to the pile
        </button>
        <p className="xp-serif truncate text-base italic">{book.title}</p>
        <span className="w-24" />
      </header>
      <div
        className="absolute left-1/2 overflow-hidden rounded-[3px] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.08)]"
        style={{ top: 64, width: pageWidth, height: pageHeight, marginLeft: -pageWidth / 2 }}
      >
        <BookContent book={book} />
      </div>
    </div>
  );
}

function FlyingBook({
  flight,
  book,
  width,
  height,
  onDone,
}: {
  flight: Flight;
  book: StudioBook;
  width: number;
  height: number;
  onDone: () => void;
}) {
  const progress = useMotionValue(0);
  const onDoneRef = useRef(onDone);
  const depth = flight.depth;
  const metrics = spineMetrics(book);
  const unit = height / metrics.length;

  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    const total = flight.durations.reduce((sum, value) => sum + value, 0);
    let elapsed = 0;
    const times = [0, ...flight.durations.map((value) => (elapsed += value) / total)];
    const controls = animate(progress, flight.poses.map((_, index) => index), {
      duration: total,
      times,
      ease: flight.eases,
      onComplete: () => onDoneRef.current(),
    });
    return () => controls.stop();
  }, [flight, progress]);

  const transform = useTransform(progress, (value) => {
    const pose = poseAt(flight.poses, value);
    return `translate3d(${pose.x - width / 2}px, ${pose.y - height / 2}px, 0) scale(${pose.scale}) rotate(${pose.rotate}deg) rotateY(${pose.rotateY}deg)`;
  });
  const cover = useTransform(progress, (value) => {
    const pose = poseAt(flight.poses, value);
    return `translateZ(${depth / 2}px) rotateY(${-170 * pose.open}deg)`;
  });
  const coverOpacity = useTransform(progress, (value) => {
    const open = poseAt(flight.poses, value).open;
    return open > 0.8 ? 1 - (open - 0.8) / 0.2 : 1;
  });
  const frontShade = useTransform(progress, (value) => (Math.abs(poseAt(flight.poses, value).rotateY) / 90) * 0.45);
  const spineShade = useTransform(progress, (value) => (1 - Math.abs(poseAt(flight.poses, value).rotateY) / 90) * 0.55);
  const shadow = useTransform(progress, (value) => {
    const pose = poseAt(flight.poses, value);
    return `translate(${pose.x - (width * pose.scale) / 2}px, ${pose.y + (height * pose.scale) / 2 - 10}px) scale(${pose.scale})`;
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-50" style={{ perspective: 2200 }}>
      <motion.div
        aria-hidden="true"
        className="absolute top-0 left-0 h-6 origin-top-left rounded-[50%] bg-black/25 blur-xl"
        style={{ width, transform: shadow }}
      />
      <motion.div
        className="absolute top-0 left-0"
        style={{ width, height, transform, transformStyle: "preserve-3d", transformOrigin: "50% 50%" }}
      >
        {/* Back board */}
        <div
          className="absolute inset-0 rounded-[3px] [backface-visibility:hidden]"
          style={{ background: toneSurface(book.tone), transform: `translateZ(${-depth / 2}px) rotateY(180deg)` }}
        />
        {/* Spine */}
        <div
          className="absolute top-0 [backface-visibility:hidden]"
          style={{ width: depth, height, left: (width - depth) / 2, transform: `rotateY(-90deg) translateZ(${width / 2}px)` }}
        >
          <SpineFace book={book} metrics={metrics} unit={unit} vertical className="size-full" />
          <motion.div className="absolute inset-0 bg-black" style={{ opacity: spineShade }} />
        </div>
        {/* Fore-edge, head and tail: the block of pages */}
        <div
          className="xp-fore-edge absolute top-0"
          style={{ width: depth, height: height - 6, top: 3, left: (width - depth) / 2, transform: `rotateY(90deg) translateZ(${width / 2 - 3}px)` }}
        />
        {[90, -90].map((angle) => (
          <div
            key={angle}
            className="absolute left-0"
            style={{
              width: width - 6,
              height: depth,
              top: (height - depth) / 2,
              transform: `rotateX(${angle}deg) translateZ(${height / 2 - 3}px)`,
              backgroundImage:
                "repeating-linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 16%, var(--card)) 0 1px, var(--card) 1px 2.5px)",
            }}
          />
        ))}
        {/* The first page, under the cover */}
        <div
          className="absolute overflow-hidden rounded-r-[3px]"
          style={{ inset: 0, transform: `translateZ(${depth / 2 - 1}px)` }}
        >
          <BookContent book={book} />
          <div
            className="absolute inset-y-0 left-0 w-[12%]"
            style={{ background: "linear-gradient(to right, rgb(0 0 0 / 0.12), transparent)" }}
          />
        </div>
        {/* Front board, which opens */}
        <motion.div
          className="absolute inset-0"
          style={{ transform: cover, transformOrigin: "0% 50%", transformStyle: "preserve-3d", opacity: coverOpacity }}
        >
          <div className="absolute inset-0 overflow-hidden rounded-r-[3px] [backface-visibility:hidden]">
            <TypographicCover book={book} className="size-full" />
            <motion.div className="absolute inset-0 bg-black" style={{ opacity: frontShade }} />
          </div>
          <div
            className="absolute inset-0 rounded-l-[3px] [backface-visibility:hidden]"
            style={{ transform: "rotateY(180deg)", background: toneWash(book.tone) }}
          />
        </motion.div>
      </motion.div>
    </div>
  );
}
