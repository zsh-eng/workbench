/**
 * Verso: the sidebar is the facing page.
 *
 * The book shows one page. The left leaf stands up at the spine; drag it
 * down, or choose a matter, and the book opens into a spread. The left page
 * holds the contents, the marginalia and the colophon, typeset as front
 * matter. A colophon value is a control: drag a figure or click a word, and
 * the right page resets while you watch.
 */
import { cn } from "@/lib/utils";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type Variants,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  EASE_OUT,
  inkColor,
  Kbd,
  SNAPPY_SPRING,
  useElementSize,
  useIsDarkAppearance,
} from "../primitives";
import {
  BOOK_PAGES,
  BOOK_TYPOGRAPHY,
  BookPage,
  CHAPTERS,
  chapterOfPage,
  clampTextPage,
  EDGE_HIGHLIGHTS,
  INITIAL_LAYOUT,
  pageOfHighlight,
  READING_PAGE,
  remapTextPage,
  sameLayout,
  stepPage,
  TEXT_CHAPTER,
  type BookLayout,
  type BookTypography,
  type InkFlash,
} from "../data/walden-book";

type Matter = "contents" | "marginalia" | "colophon";

const MATTERS: { id: Matter; label: string; folio: string }[] = [
  { id: "contents", label: "Contents", folio: "v" },
  { id: "marginalia", label: "Marginalia", folio: "vi" },
  { id: "colophon", label: "Colophon", folio: "vii" },
];

/** The left leaf stands nearly upright at the spine when the book is closed. */
const STANDING = 76;
const LEAF_SPRING = { type: "spring", stiffness: 150, damping: 20, mass: 1 } as const;
const LEAF_TURN = 0.34;
const LEAF_STAGGER = 0.07;

type Paper = "cream" | "charcoal";

interface Riffle {
  key: number;
  direction: 1 | -1;
  count: number;
  from: number;
}

interface ThumbTarget {
  page: number;
  label: string;
}

const TYPEFACES = [
  { label: "EB Garamond", family: '"EB Garamond", "Garamond", serif' },
  { label: "Lora", family: '"Lora", Georgia, serif' },
  { label: "DM Sans", family: '"DM Sans", system-ui, sans-serif' },
  { label: "Inter", family: '"Inter", system-ui, sans-serif' },
];

const MARGINS = [
  { label: "generous", value: 0.14 },
  { label: "moderate", value: 0.11 },
  { label: "narrow", value: 0.075 },
];

const lineVariants: Variants = {
  hidden: { opacity: 0, y: 7, filter: "blur(3px)" },
  shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.42, ease: EASE_OUT } },
};

const matterVariants: Variants = {
  hidden: { opacity: 1 },
  shown: { opacity: 1, transition: { staggerChildren: 0.022, delayChildren: 0.05 } },
  exit: { opacity: 0, transition: { duration: 0.12 } },
};

export function Verso() {
  const appIsDark = useIsDarkAppearance();
  const reducedMotion = useReducedMotion() ?? false;
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const focusRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const [matter, setMatter] = useState<Matter>("contents");
  const [page, setPage] = useState(READING_PAGE);
  const [layout, setLayout] = useState<BookLayout>(INITIAL_LAYOUT);
  const layoutRef = useRef<BookLayout>(INITIAL_LAYOUT);
  const [typography, setTypography] = useState<BookTypography>(BOOK_TYPOGRAPHY);
  const [paperChoice, setPaperChoice] = useState<Paper | null>(null);
  const [flash, setFlash] = useState<InkFlash | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [thumb, setThumb] = useState<ThumbTarget | null>(null);
  const [riffle, setRiffle] = useState<Riffle | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const angle = useMotionValue(STANDING);
  const drag = useRef<{ x: number; angle: number; moved: boolean } | null>(null);

  const paper: Paper = paperChoice ?? (appIsDark ? "charcoal" : "cream");
  const narrow = stage.width > 0 && stage.width < 760;
  const headerHeight = 60;
  const footerHeight = 52;
  const availableHeight = Math.max(320, stage.height - headerHeight - footerHeight - 16);
  const availableWidth = Math.max(280, stage.width - 56);
  let pageHeight = Math.min(availableHeight, 680);
  let pageWidth = Math.round(pageHeight * 0.68);
  if (narrow) {
    pageWidth = Math.min(stage.width - 32, pageWidth);
    pageHeight = Math.min(availableHeight, Math.round(pageWidth / 0.66));
  } else if (pageWidth * 2 + 48 > availableWidth) {
    pageWidth = Math.floor((availableWidth - 48) / 2);
    pageHeight = Math.round(pageWidth / 0.68);
  }
  const spreadWidth = narrow ? pageWidth : pageWidth * 2;
  const bookTop = headerHeight + Math.max(0, (availableHeight - pageHeight) / 2);
  const remaining = Math.max(0, BOOK_PAGES - page) / BOOK_PAGES;
  const foreRight = Math.round(3 + remaining * 9);
  const foreLeft = Math.round(3 + (page / BOOK_PAGES) * 9);

  // On a phone the leaf covers the page instead of opening beside it.
  const leafRotate = useTransform(angle, (value) => (narrow ? -value * 1.2 : value));
  const spreadX = useTransform(angle, (value) =>
    narrow ? 0 : -(pageWidth / 2) * Math.min(1, Math.max(0, value / STANDING)),
  );
  const leafShade = useTransform(angle, [0, STANDING], [0, 0.3]);
  const castShade = useTransform(angle, [0, 30, STANDING], [0, 0.04, 0.16]);
  const leftEdgeOpacity = useTransform(angle, [0, 40], [1, 0]);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const settle = (next: boolean, velocity = 0) => {
    if (next && !open) setOpenCount((count) => count + 1);
    setOpen(next);
    if (!next) setThumb(null);
    void animate(
      angle,
      next ? 0 : STANDING,
      reducedMotion ? { duration: 0 } : { ...LEAF_SPRING, velocity },
    );
  };

  const openMatter = (next: Matter) => {
    if (open && next === matter) {
      settle(false);
      return;
    }
    setMatter(next);
    if (!open) settle(true);
  };

  const handleLayout = useCallback((next: BookLayout) => {
    const previous = layoutRef.current;
    if (sameLayout(previous, next)) return;
    layoutRef.current = next;
    setLayout(next);
    setPage((current) => remapTextPage(current, previous, next));
  }, []);

  const goTo = (target: number, highlightId?: string) => {
    const next = clampTextPage(target, layout);
    window.clearTimeout(flashTimer.current);
    if (next === page) {
      if (highlightId) setFlash({ id: highlightId, key: Date.now() });
      return;
    }
    const direction = next > page ? 1 : -1;
    const count = reducedMotion ? 0 : Math.min(6, 1 + Math.floor(Math.log2(Math.abs(next - page) + 1)));
    if (count > 0) setRiffle({ key: Date.now(), direction, count, from: page });
    setPage(next);
    setFlash(null);
    if (highlightId) {
      const wait = count > 0 ? (LEAF_TURN + LEAF_STAGGER * (count - 1)) * 1000 : 0;
      flashTimer.current = window.setTimeout(
        () => setFlash({ id: highlightId, key: Date.now() }),
        wait,
      );
    }
  };

  const turn = (direction: 1 | -1) => goTo(stepPage(page, direction, layout));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-scrub]")) return;
    if (event.key === "\\") {
      event.preventDefault();
      settle(!open);
    } else if (event.key === "Escape" && open) {
      settle(false);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      turn(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      turn(-1);
    } else if (["1", "2", "3"].includes(event.key)) {
      const next = MATTERS[Number(event.key) - 1].id;
      setMatter(next);
      if (!open) settle(true);
    }
  };

  const beginLeafDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured; the drag still works inside the target.
    }
    drag.current = { x: event.clientX, angle: angle.get(), moved: false };
  };

  const moveLeafDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    if (Math.abs(dx) > 3) current.moved = true;
    const travel = narrow ? pageWidth : pageWidth * 0.5;
    const sign = narrow ? -1 : 1;
    const next = current.angle + ((sign * dx) / travel) * STANDING;
    angle.set(Math.min(STANDING + 4, Math.max(-4, next)));
  };

  const endLeafDrag = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    if (!current.moved) {
      settle(!open);
      return;
    }
    const velocity = angle.getVelocity();
    const next = Math.abs(velocity) > 140 ? velocity < 0 : angle.get() < STANDING * 0.7;
    settle(next, velocity);
  };

  const leafDragHandlers = {
    onPointerDown: beginLeafDrag,
    onPointerMove: moveLeafDrag,
    onPointerUp: endLeafDrag,
    onPointerCancel: endLeafDrag,
  };

  const currentChapter = chapterOfPage(page);
  const thumbTop = thumb
    ? 18 + (Math.min(thumb.page, BOOK_PAGES) / BOOK_PAGES) * (pageHeight - 36 - 48)
    : 0;
  const ready = stage.width > 0;

  return (
    <div
      ref={stageRef}
      className={cn(
        "relative size-full overflow-hidden bg-background text-foreground outline-none",
        paper === "cream" ? "flexoki-light" : "flexoki-dark",
      )}
      style={{
        colorScheme: paper === "charcoal" ? "dark" : "light",
        backgroundImage:
          "radial-gradient(120% 95% at 50% 42%, var(--background) 0%, color-mix(in oklab, var(--muted) 88%, var(--foreground)) 100%)",
        transition: "background-color 0.4s ease, color 0.4s ease",
      }}
    >
      <div
        ref={focusRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={() => focusRef.current?.focus({ preventScroll: true })}
        className="absolute inset-0 outline-none"
      >
        <header
          className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-5 md:px-7"
          style={{ height: headerHeight }}
        >
          <div className="flex min-w-0 items-baseline gap-3">
            <p className="xp-serif text-lg italic sm:text-xl">Walden</p>
            <p className="xp-smcp truncate text-xs text-muted-foreground max-sm:hidden">
              Henry David Thoreau · second reading
            </p>
          </div>
          <nav aria-label="Front matter" className="flex items-center sm:gap-1">
            {MATTERS.map((item) => {
              const active = open && matter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => openMatter(item.id)}
                  className={cn(
                    "xp-smcp relative cursor-pointer rounded-full px-2 py-1.5 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-[13px]",
                    active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  {active && (
                    <motion.span
                      layoutId="xp-verso-header-mark"
                      transition={SNAPPY_SPRING}
                      className="absolute inset-x-2 -bottom-0.5 h-px bg-foreground sm:inset-x-3"
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </header>

        {ready && (
          <div
            className="absolute left-1/2"
            style={{
              top: bookTop,
              width: spreadWidth,
              height: pageHeight,
              marginLeft: -spreadWidth / 2,
              perspective: 3600,
            }}
          >
            <motion.div
              className="relative size-full"
              style={{ x: spreadX, transformStyle: "preserve-3d" }}
            >
              {/* Recto: the page being read. */}
              <div
                className="absolute top-0"
                style={{
                  left: narrow ? 0 : pageWidth,
                  width: pageWidth,
                  height: pageHeight,
                  perspective: 1800,
                  perspectiveOrigin: "0% 50%",
                }}
              >
                <div
                  aria-hidden="true"
                  className="xp-fore-edge absolute rounded-r-[3px]"
                  style={{
                    left: pageWidth - 2,
                    width: foreRight + 2,
                    top: 4,
                    bottom: 2,
                    boxShadow: "0 18px 40px -22px rgb(0 0 0 / 0.45)",
                    transition: "width 0.5s ease",
                  }}
                />
                <div
                  className="relative size-full overflow-hidden rounded-r-[3px] shadow-[0_34px_70px_-34px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.07)]"
                >
                  <BookPage
                    page={page}
                    typography={typography}
                    flash={flash}
                    hoveredId={hoveredId}
                    onLayout={handleLayout}
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-[14%]"
                    style={{ background: "linear-gradient(to right, rgb(0 0 0 / 0.1), transparent)" }}
                  />
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-black to-transparent"
                    style={{ opacity: narrow ? 0 : castShade }}
                  />
                </div>

                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Next page"
                  onClick={() => turn(1)}
                  className="absolute inset-y-0 right-0 w-[18%] cursor-e-resize"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Previous page"
                  onClick={() => turn(-1)}
                  className="absolute inset-y-0 left-[22px] w-[14%] cursor-w-resize"
                />

                <RiffleLeaves
                  riffle={riffle}
                  typography={typography}
                  onDone={() => setRiffle(null)}
                />

                <AnimatePresence>
                  {thumb && open && !narrow && (
                    <motion.div
                      key="thumb"
                      aria-hidden="true"
                      initial={{ opacity: 0, x: -10, y: thumbTop }}
                      animate={{ opacity: 1, x: 0, y: thumbTop }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={SNAPPY_SPRING}
                      className="absolute top-0 z-10 flex h-12 w-[26px] items-center justify-center rounded-r-[7px] bg-foreground text-background shadow-[2px_4px_12px_rgb(0_0_0/0.2)]"
                      style={{ left: pageWidth + foreRight - 1 }}
                    >
                      <span className="xp-smcp xp-vertical text-[11px] leading-none">{thumb.label}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!narrow && (
                  <div
                    {...leafDragHandlers}
                    role="button"
                    tabIndex={-1}
                    aria-label={open ? "Close the facing page" : "Open the facing page"}
                    className="absolute inset-y-0 -left-3 z-10 w-6 cursor-grab touch-none active:cursor-grabbing"
                  />
                )}
              </div>

              {/* Verso: front matter on the facing page. */}
              <motion.div
                className="absolute top-0 [backface-visibility:hidden]"
                inert={!open}
                aria-hidden={!open}
                style={{
                  left: 0,
                  width: pageWidth,
                  height: pageHeight,
                  rotateY: leafRotate,
                  transformOrigin: narrow ? "0% 50%" : "100% 50%",
                  zIndex: narrow ? 20 : undefined,
                }}
              >
                <motion.div
                  aria-hidden="true"
                  className="xp-fore-edge absolute rounded-l-[3px]"
                  style={{
                    right: pageWidth - 2,
                    width: foreLeft + 2,
                    top: 4,
                    bottom: 2,
                    opacity: narrow ? 0 : leftEdgeOpacity,
                  }}
                />
                <div className="relative size-full overflow-hidden rounded-l-[3px] bg-background shadow-[0_34px_70px_-34px_rgb(0_0_0/0.5),0_2px_6px_rgb(0_0_0/0.07)]">
                  <VersoPage
                    key={openCount}
                    matter={matter}
                    onMatter={setMatter}
                    pageWidth={pageWidth}
                    currentChapter={currentChapter}
                    page={page}
                    layout={layout}
                    typography={typography}
                    onTypography={setTypography}
                    paper={paper}
                    onPaper={setPaperChoice}
                    onGo={goTo}
                    onThumb={setThumb}
                    onHover={setHoveredId}
                    onClose={narrow ? () => settle(false) : undefined}
                  />
                  <div
                    aria-hidden="true"
                    className={cn("pointer-events-none absolute inset-y-0 w-[14%]", narrow ? "left-0" : "right-0")}
                    style={{
                      background: `linear-gradient(to ${narrow ? "right" : "left"}, rgb(0 0 0 / 0.1), transparent)`,
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 bg-black"
                    style={{ opacity: leafShade }}
                  />
                </div>
                {!open && !narrow && (
                  <div
                    {...leafDragHandlers}
                    role="button"
                    tabIndex={-1}
                    aria-label="Open the facing page"
                    className="absolute inset-0 cursor-grab touch-none"
                  />
                )}
              </motion.div>
            </motion.div>
          </div>
        )}

        <footer
          className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-4 px-5 text-xs text-muted-foreground md:px-7"
          style={{ height: footerHeight }}
        >
          <p className="max-md:hidden">
            {open ? (
              <>
                <Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> to change the matter, <Kbd>Esc</Kbd> to close
              </>
            ) : (
              <>Drag the standing page down, or press <Kbd>\</Kbd></>
            )}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => turn(-1)}
              className="grid size-8 cursor-pointer place-items-center rounded-full text-base outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              ‹
            </button>
            <p className="xp-serif xp-onum min-w-24 text-center text-sm text-foreground/80">
              {page} <span className="text-muted-foreground">of {BOOK_PAGES}</span>
            </p>
            <button
              type="button"
              aria-label="Next page"
              onClick={() => turn(1)}
              className="grid size-8 cursor-pointer place-items-center rounded-full text-base outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              ›
            </button>
          </div>
          <p className="xp-smcp max-w-56 truncate text-right max-md:hidden">
            {CHAPTERS[currentChapter].numeral}. {CHAPTERS[currentChapter].title}
          </p>
        </footer>
      </div>
    </div>
  );
}

function RiffleLeaves({
  riffle,
  typography,
  onDone,
}: {
  riffle: Riffle | null;
  typography: BookTypography;
  onDone: () => void;
}) {
  return (
    <AnimatePresence>
      {riffle && (
        <motion.div key={riffle.key} className="pointer-events-none absolute inset-0" exit={{ opacity: 0, transition: { duration: 0 } }}>
          {Array.from({ length: riffle.count }, (_, index) => {
            const forward = riffle.direction > 0;
            const last = index === riffle.count - 1;
            return (
              <motion.div
                key={index}
                className="absolute inset-0 overflow-hidden rounded-r-[3px] bg-background [backface-visibility:hidden]"
                style={{ transformOrigin: "0% 50%", zIndex: riffle.count - index }}
                initial={forward ? { rotateY: 0 } : { rotateY: -90, opacity: 1 }}
                animate={forward ? { rotateY: -90 } : { rotateY: 0, opacity: [1, 1, 0] }}
                transition={{
                  rotateY: {
                    duration: LEAF_TURN,
                    delay: index * LEAF_STAGGER,
                    ease: forward ? [0.5, 0, 0.75, 0.4] : [0.2, 0.6, 0.4, 1],
                  },
                  opacity: { duration: LEAF_TURN + 0.12, delay: index * LEAF_STAGGER, times: [0, 0.75, 1] },
                }}
                onAnimationComplete={last ? onDone : undefined}
              >
                {forward && index === 0 ? (
                  <BookPage page={riffle.from} typography={typography} />
                ) : (
                  <div className="absolute inset-x-[12%] top-[10%] bottom-[12%] xp-ghost-lines" style={{ fontSize: typography.fontSize }} />
                )}
                <motion.div
                  className="absolute inset-0 bg-gradient-to-l from-black/30 to-transparent"
                  initial={{ opacity: forward ? 0 : 0.8 }}
                  animate={{ opacity: forward ? 0.9 : 0 }}
                  transition={{ duration: LEAF_TURN, delay: index * LEAF_STAGGER }}
                />
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function VersoPage({
  matter,
  onMatter,
  pageWidth,
  currentChapter,
  page,
  layout,
  typography,
  onTypography,
  paper,
  onPaper,
  onGo,
  onThumb,
  onHover,
  onClose,
}: {
  matter: Matter;
  onMatter: (matter: Matter) => void;
  pageWidth: number;
  currentChapter: number;
  page: number;
  layout: BookLayout;
  typography: BookTypography;
  onTypography: (typography: BookTypography) => void;
  paper: Paper;
  onPaper: (paper: Paper) => void;
  onGo: (page: number, highlightId?: string) => void;
  onThumb: (target: ThumbTarget | null) => void;
  onHover: (id: string | null) => void;
  onClose?: () => void;
}) {
  const fontSize = Math.min(16, Math.max(12, pageWidth / 30));
  const folio = MATTERS.find((item) => item.id === matter)?.folio ?? "v";

  return (
    <div className="xp-serif absolute inset-0 flex flex-col px-[11%] pt-[6.5%] pb-[7%]" style={{ fontSize }}>
      <nav aria-label="Matter" className="relative flex shrink-0 items-center justify-center gap-[1.1em]">
        {MATTERS.map((item) => {
          const active = item.id === matter;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onMatter(item.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "xp-smcp relative cursor-pointer pb-[0.35em] text-[0.74em] outline-none transition-colors focus-visible:underline",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
              {active && (
                <motion.span
                  layoutId="xp-verso-matter"
                  transition={SNAPPY_SPRING}
                  className="absolute left-1/2 bottom-0 size-[3px] -translate-x-1/2 rounded-full bg-foreground"
                />
              )}
            </button>
          );
        })}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-0 cursor-pointer text-[1.1em] text-muted-foreground"
          >
            ×
          </button>
        )}
      </nav>

      <div className="relative mt-[1.4em] min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={matter}
            variants={matterVariants}
            initial="hidden"
            animate="shown"
            exit="exit"
            className="absolute inset-0 flex flex-col"
            onPointerLeave={() => {
              onThumb(null);
              onHover(null);
            }}
          >
            {matter === "contents" && (
              <ContentsMatter currentChapter={currentChapter} page={page} onGo={onGo} onThumb={onThumb} />
            )}
            {matter === "marginalia" && (
              <MarginaliaMatter layout={layout} onGo={onGo} onThumb={onThumb} onHover={onHover} />
            )}
            {matter === "colophon" && (
              <ColophonMatter
                typography={typography}
                onTypography={onTypography}
                paper={paper}
                onPaper={onPaper}
                textPages={layout.textPages}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <p className="xp-onum mt-[0.8em] shrink-0 text-center text-[0.72em] text-muted-foreground italic">{folio}</p>
    </div>
  );
}

function MatterTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <motion.div variants={lineVariants} className="mb-[0.7em] flex shrink-0 items-baseline justify-between gap-3">
      <h3 className="text-[2em] leading-none font-normal tracking-[-0.01em] italic">{children}</h3>
      {aside && <p className="xp-smcp text-[0.68em] text-muted-foreground">{aside}</p>}
    </motion.div>
  );
}

function ContentsMatter({
  currentChapter,
  page,
  onGo,
  onThumb,
}: {
  currentChapter: number;
  page: number;
  onGo: (page: number) => void;
  onThumb: (target: ThumbTarget | null) => void;
}) {
  return (
    <>
      <MatterTitle aside={`p. ${page}`}>Contents</MatterTitle>
      <ol className="flex min-h-0 flex-1 flex-col justify-between">
        {CHAPTERS.map((chapter) => {
          const here = chapter.index === currentChapter;
          const kept = EDGE_HIGHLIGHTS.filter((highlight) => highlight.chapter === chapter.index);
          return (
            <motion.li key={chapter.index} variants={lineVariants} className="relative">
              {here && (
                <motion.span
                  layoutId="xp-verso-here"
                  transition={SNAPPY_SPRING}
                  aria-hidden="true"
                  className="absolute top-1/2 -left-[1.1em] size-[5px] -translate-y-1/2 rounded-full bg-foreground"
                />
              )}
              <button
                type="button"
                onClick={() => onGo(chapter.page)}
                onPointerEnter={() => onThumb({ page: chapter.page, label: chapter.numeral })}
                onFocus={() => onThumb({ page: chapter.page, label: chapter.numeral })}
                aria-current={here ? "true" : undefined}
                className="group flex w-full cursor-pointer items-baseline text-left text-[0.95em] leading-[1.25] outline-none focus-visible:underline"
              >
                <span className="xp-smcp w-[2.3em] shrink-0 pr-[0.6em] text-right text-[0.78em] text-muted-foreground">
                  {chapter.numeral}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-[0.25em]",
                    here && "italic",
                  )}
                >
                  {chapter.title}
                </span>
                {kept.length > 0 && (
                  <span aria-label={`${kept.length} kept`} className="ml-[0.4em] flex shrink-0 translate-y-[-0.15em] gap-[2px]">
                    {kept.slice(0, 4).map((highlight) => (
                      <span key={highlight.id} className="size-[4px] rounded-full" style={{ background: inkColor(highlight.color) }} />
                    ))}
                  </span>
                )}
                <span className="xp-leader transition-colors group-hover:border-foreground/50" />
                <span className="xp-onum shrink-0 text-muted-foreground group-hover:text-foreground">{chapter.page}</span>
              </button>
            </motion.li>
          );
        })}
      </ol>
    </>
  );
}

function MarginaliaMatter({
  layout,
  onGo,
  onThumb,
  onHover,
}: {
  layout: BookLayout;
  onGo: (page: number, highlightId: string) => void;
  onThumb: (target: ThumbTarget | null) => void;
  onHover: (id: string | null) => void;
}) {
  const notes = EDGE_HIGHLIGHTS.filter((highlight) => highlight.note).length;
  const groups = CHAPTERS.map((chapter) => ({
    chapter,
    highlights: EDGE_HIGHLIGHTS.filter((highlight) => highlight.chapter === chapter.index),
  })).filter((group) => group.highlights.length > 0);
  let number = 0;

  return (
    <>
      <MatterTitle aside={`${EDGE_HIGHLIGHTS.length} passages · ${notes} notes`}>Marginalia</MatterTitle>
      <div
        className="xp-scroll-quiet -mx-[0.5em] min-h-0 flex-1 overflow-y-auto overscroll-contain px-[0.5em]"
        style={{
          maskImage: "linear-gradient(to bottom, transparent, #000 1.2em, #000 calc(100% - 2em), transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 1.2em, #000 calc(100% - 2em), transparent)",
        }}
      >
        <div className="pt-[0.8em] pb-[2.4em]">
          {groups.map((group) => (
            <section key={group.chapter.index} className="mb-[1em]">
              <motion.p variants={lineVariants} className="xp-smcp mb-[0.35em] flex items-baseline gap-[0.5em] text-[0.7em] text-muted-foreground">
                <span>{group.chapter.numeral}</span>
                <span className="truncate">{group.chapter.title}</span>
                <span aria-hidden="true" className="h-px flex-1 translate-y-[-0.25em] bg-foreground/15" />
              </motion.p>
              {group.highlights.map((highlight) => {
                number += 1;
                const target = pageOfHighlight(highlight, layout);
                const thumb = { page: target, label: group.chapter.numeral };
                return (
                  <motion.button
                    key={highlight.id}
                    type="button"
                    variants={lineVariants}
                    onClick={() => onGo(target, highlight.id)}
                    onPointerEnter={() => {
                      onThumb(thumb);
                      onHover(highlight.id);
                    }}
                    onFocus={() => onThumb(thumb)}
                    className="group grid w-full cursor-pointer grid-cols-[1.5em_minmax(0,1fr)] gap-x-[0.3em] rounded-[4px] py-[0.3em] text-left outline-none focus-visible:bg-foreground/5"
                  >
                    <span className="xp-onum pt-[0.05em] text-right text-[0.78em] font-medium" style={{ color: inkColor(highlight.color) }}>
                      {number}
                    </span>
                    <span className="min-w-0">
                      <span className="text-[0.9em] leading-[1.35] italic decoration-foreground/30 underline-offset-[0.2em] group-hover:underline">
                        {highlight.text}
                      </span>
                      <span className="xp-onum ml-[0.4em] text-[0.8em] text-muted-foreground">{target}</span>
                      {highlight.note && (
                        <span className="mt-[0.15em] block text-[0.82em] leading-[1.35] text-foreground/70">
                          — {highlight.note}
                        </span>
                      )}
                    </span>
                  </motion.button>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function ColophonMatter({
  typography,
  onTypography,
  paper,
  onPaper,
  textPages,
}: {
  typography: BookTypography;
  onTypography: (typography: BookTypography) => void;
  paper: Paper;
  onPaper: (paper: Paper) => void;
  textPages: number;
}) {
  const typefaceIndex = Math.max(0, TYPEFACES.findIndex((face) => face.family === typography.fontFamily));
  const marginIndex = Math.max(0, MARGINS.findIndex((margin) => margin.value === typography.margin));
  const update = (patch: Partial<BookTypography>) => onTypography({ ...typography, ...patch });

  return (
    <>
      <MatterTitle>Colophon</MatterTitle>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-[1.5em] text-center">
      <motion.span
        variants={lineVariants}
        aria-hidden="true"
        className="mb-[1.3em] grid size-[2.7em] place-items-center rounded-full border border-foreground/25 text-[1.05em] italic"
      >
        W
      </motion.span>
      <motion.p variants={lineVariants} className="max-w-[19em] text-[1.08em] leading-[1.95] text-balance">
        This copy of <i>Walden</i> is set in{" "}
        <CycleToken
          label="Typeface"
          value={TYPEFACES[typefaceIndex].label}
          style={{ fontFamily: TYPEFACES[typefaceIndex].family }}
          onNext={() => update({ fontFamily: TYPEFACES[(typefaceIndex + 1) % TYPEFACES.length].family })}
        />{" "}
        at{" "}
        <ScrubToken
          label="Type size in points"
          value={typography.fontSize}
          min={14}
          max={26}
          step={1}
          format={(value) => String(value)}
          onChange={(fontSize) => update({ fontSize })}
        />{" "}
        points on a{" "}
        <ScrubToken
          label="Line height"
          value={typography.lineHeight}
          min={1.2}
          max={2}
          step={0.05}
          format={(value) => value.toFixed(2)}
          onChange={(lineHeight) => update({ lineHeight })}
        />{" "}
        line,{" "}
        <CycleToken
          label="Alignment"
          value={typography.justify ? "justified" : "ragged right"}
          onNext={() => update({ justify: !typography.justify })}
        />
        , with{" "}
        <CycleToken
          label="Margins"
          value={MARGINS[marginIndex].label}
          onNext={() => update({ margin: MARGINS[(marginIndex + 1) % MARGINS.length].value })}
        />{" "}
        margins, and printed on{" "}
        <CycleToken
          label="Paper"
          value={paper === "cream" ? "cream laid" : "charcoal"}
          onNext={() => onPaper(paper === "cream" ? "charcoal" : "cream")}
        />{" "}
        paper.
      </motion.p>
      <motion.span variants={lineVariants} aria-hidden="true" className="my-[1.2em] h-px w-[2.2em] bg-foreground/25" />
      <motion.p variants={lineVariants} className="text-[0.86em] leading-[1.5] text-muted-foreground italic">
        At this setting, chapter {CHAPTERS[TEXT_CHAPTER].numeral} runs to{" "}
        <motion.span
          key={textPages}
          initial={{ opacity: 0.2, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          className="xp-onum inline-block text-foreground not-italic"
        >
          {textPages}
        </motion.span>{" "}
        pages.
      </motion.p>
      </div>
      <motion.div variants={lineVariants} className="flex shrink-0 items-end justify-between gap-4">
        <p className="xp-smcp text-[0.66em] text-muted-foreground">Drag a figure · click a word</p>
        <button
          type="button"
          onClick={() => onTypography(BOOK_TYPOGRAPHY)}
          className="xp-smcp cursor-pointer text-[0.66em] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          Reset
        </button>
      </motion.div>
    </>
  );
}

const TOKEN_CLASS =
  "relative inline-flex cursor-pointer items-baseline whitespace-nowrap rounded-[3px] px-[0.15em] outline-none transition-colors [text-decoration:underline_dotted] decoration-foreground/40 underline-offset-[0.22em] hover:bg-foreground/[0.06] focus-visible:bg-foreground/[0.08]";

function CycleToken({
  label,
  value,
  style,
  onNext,
}: {
  label: string;
  value: string;
  style?: CSSProperties;
  onNext: () => void;
}) {
  return (
    <motion.button
      layout
      type="button"
      aria-label={`${label}: ${value}. Change`}
      onClick={onNext}
      transition={SNAPPY_SPRING}
      className={cn(TOKEN_CLASS, "overflow-hidden align-baseline")}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "70%", opacity: 0, filter: "blur(2px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: "-70%", opacity: 0, filter: "blur(2px)" }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
          className="inline-block"
          style={style}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

const PX_PER_STEP = 9;

function ScrubToken({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; value: number; moved: boolean } | null>(null);
  const clampValue = (next: number) =>
    Math.min(max, Math.max(min, Math.round(next / step) * step));
  const steps = Math.round((value - min) / step);

  return (
    <span
      role="slider"
      tabIndex={0}
      data-scrub=""
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointers cannot be captured.
        }
        start.current = { x: event.clientX, value, moved: false };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = start.current;
        if (!current) return;
        const delta = Math.round((event.clientX - current.x) / PX_PER_STEP);
        if (delta !== 0) current.moved = true;
        const next = clampValue(current.value + delta * step);
        if (next !== value) onChange(Number(next.toFixed(2)));
      }}
      onPointerUp={(event) => {
        const current = start.current;
        start.current = null;
        setDragging(false);
        if (current && !current.moved) {
          const next = clampValue(value + (event.shiftKey ? -step : step));
          onChange(Number((next >= max && value >= max ? min : next).toFixed(2)));
        }
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        const direction =
          event.key === "ArrowRight" || event.key === "ArrowUp"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowDown"
              ? -1
              : 0;
        if (!direction) return;
        event.preventDefault();
        event.stopPropagation();
        onChange(Number(clampValue(value + direction * step).toFixed(2)));
      }}
      className={cn(TOKEN_CLASS, "cursor-ew-resize touch-none select-none", dragging && "bg-foreground/[0.08]")}
    >
      <span className="xp-lnum">{format(value)}</span>
      <AnimatePresence>
        {dragging && (
          <motion.span
            aria-hidden="true"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="pointer-events-none absolute top-full left-1/2 mt-[0.15em] h-[0.55em] w-[5.5em] -translate-x-1/2 overflow-hidden"
            style={{
              maskImage: "linear-gradient(to right, transparent, #000 30%, #000 70%, transparent)",
              WebkitMaskImage: "linear-gradient(to right, transparent, #000 30%, #000 70%, transparent)",
            }}
          >
            <span
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to right, color-mix(in oklab, var(--foreground) 45%, transparent) 0 1px, transparent 1px 6px)",
                backgroundPositionX: `calc(50% - ${steps * 6}px)`,
                transition: "background-position 0.12s ease-out",
              }}
            />
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
