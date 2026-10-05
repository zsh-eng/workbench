/**
 * Ribbons: the sidebar hangs from a bookmark.
 *
 * Silk ribbons hang from the head of the page, one for your place and one
 * for each highlight ink. They sway when you pass. Pull one down and it
 * opens the book where it lies, then unrolls into a banner that lists every
 * passage in its ink. Flick the banner up and it rolls back into the ribbon.
 */
import { cn } from "@/lib/utils";
import {
  animate,
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
  type Variants,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { StudioInk } from "../data/sample-library";
import { EASE_OUT, inkColor, Kbd, useElementSize, useIsDarkAppearance } from "../primitives";
import {
  BOOK_PAGES,
  BookPage,
  CHAPTERS,
  chapterOfPage,
  clampTextPage,
  EDGE_HIGHLIGHTS,
  INITIAL_LAYOUT,
  pageOfHighlight,
  READING_PAGE,
  sameLayout,
  stepPage,
  type BookLayout,
  type EdgeHighlight,
  type InkFlash,
} from "../data/walden-book";
import "./edge.css";

type RibbonId = "place" | StudioInk;

interface RibbonDefinition {
  id: RibbonId;
  label: string;
  color: string;
}

const RIBBONS: RibbonDefinition[] = [
  { id: "place", label: "Your place", color: "var(--foreground)" },
  { id: "yellow", label: "Yellow", color: inkColor("yellow") },
  { id: "green", label: "Green", color: inkColor("green") },
  { id: "blue", label: "Blue", color: inkColor("blue") },
  { id: "magenta", label: "Magenta", color: inkColor("magenta") },
];

const RIBBON_WIDTH = 20;
const RIBBON_GAP = 7;
const PULL_TO_OPEN = 64;
const BANNER_WIDTH = 348;
const PAGE_VARIANTS: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 18 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -18 }),
};

const FABRIC = { type: "spring", stiffness: 340, damping: 30, mass: 1 } as const;
const UNROLL = { type: "spring", stiffness: 210, damping: 26, mass: 1 } as const;

function passagesFor(id: RibbonId): EdgeHighlight[] {
  if (id === "place") return [];
  return EDGE_HIGHLIGHTS.filter((highlight) => highlight.color === id);
}

function ribbonLength(id: RibbonId): number {
  if (id === "place") return 124;
  return Math.min(116, 62 + passagesFor(id).length * 8);
}

/** The page a ribbon lies in: your place, or the latest passage in its ink. */
function ribbonTarget(id: RibbonId, layout: BookLayout): { page: number; highlight?: EdgeHighlight } {
  if (id === "place") return { page: READING_PAGE };
  const latest = [...passagesFor(id)].sort((a, b) => a.daysAgo - b.daysAgo)[0];
  return latest ? { page: pageOfHighlight(latest, layout), highlight: latest } : { page: READING_PAGE };
}

export function Ribbons() {
  const appIsDark = useIsDarkAppearance();
  const reducedMotion = useReducedMotion() ?? false;
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [openId, setOpenId] = useState<RibbonId | null>(null);
  const [page, setPage] = useState(READING_PAGE);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [layout, setLayout] = useState<BookLayout>(INITIAL_LAYOUT);
  const [flash, setFlash] = useState<InkFlash | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const lastPointer = useRef<{ x: number; t: number } | null>(null);
  const swayTargets = useRef<Record<string, MotionValue<number>>>({});

  const narrow = stage.width > 0 && stage.width < 760;
  const padding = narrow ? 16 : 36;
  const footerHeight = 44;
  const pageHeight = Math.max(360, Math.min(stage.height - padding * 2 - footerHeight + 12, 820));
  const pageWidth = narrow
    ? Math.max(260, stage.width - padding * 2)
    : Math.min(Math.round(pageHeight * 0.72), stage.width - BANNER_WIDTH - 140);
  const pageTop = padding;
  const bannerOpen = openId !== null;
  const groupWidth = narrow ? pageWidth : pageWidth + (bannerOpen ? BANNER_WIDTH + 40 : 0);
  const groupLeft = (stage.width - groupWidth) / 2;
  const pageLeft = narrow ? padding : groupLeft + (bannerOpen ? BANNER_WIDTH + 40 : 0);
  const bannerLeft = narrow ? padding : groupLeft;
  const ribbonLeft = pageLeft + Math.round(pageWidth * 0.07);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const handleLayout = useCallback((next: BookLayout) => {
    setLayout((current) => (sameLayout(current, next) ? current : next));
  }, []);

  const goTo = (target: number, highlight?: EdgeHighlight) => {
    const next = clampTextPage(target, layout);
    window.clearTimeout(flashTimer.current);
    setFlash(null);
    if (next !== page) {
      setDirection(next > page ? 1 : -1);
      setPage(next);
    }
    if (highlight) {
      flashTimer.current = window.setTimeout(
        () => setFlash({ id: highlight.id, key: Date.now() }),
        next !== page ? 380 : 0,
      );
    }
  };

  const unroll = (id: RibbonId) => {
    const target = ribbonTarget(id, layout);
    goTo(target.page, target.highlight);
    setOpenId(id);
  };

  const rollUp = () => setOpenId(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (["1", "2", "3", "4", "5"].includes(event.key)) {
      const id = RIBBONS[Number(event.key) - 1].id;
      if (openId === id) rollUp();
      else unroll(id);
    } else if (event.key === "Escape") {
      rollUp();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(stepPage(page, 1, layout));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(stepPage(page, -1, layout));
    }
  };

  // Passing over the ribbons sets them swinging, more for a faster pass.
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const now = performance.now();
    const previous = lastPointer.current;
    lastPointer.current = { x, t: now };
    if (!previous || y > pageTop + 150 || y < pageTop - 30) return;
    const velocity = (x - previous.x) / Math.max(8, now - previous.t);
    RIBBONS.forEach((ribbon, index) => {
      const target = swayTargets.current[ribbon.id];
      if (!target || openId === ribbon.id) return;
      const center = ribbonLeft + index * (RIBBON_WIDTH + RIBBON_GAP) + RIBBON_WIDTH / 2;
      const falloff = Math.max(0, 1 - Math.abs(center - x) / 90);
      if (falloff <= 0) return;
      target.set(Math.max(-14, Math.min(14, -velocity * 9 * falloff)));
      window.setTimeout(() => target.set(0), 70);
    });
  };

  const registerSway = useCallback((id: string, value: MotionValue<number>) => {
    swayTargets.current[id] = value;
  }, []);

  const chapter = CHAPTERS[chapterOfPage(page)];
  const openRibbon = RIBBONS.find((ribbon) => ribbon.id === openId) ?? null;
  const ready = stage.width > 0;

  return (
    <div
      ref={stageRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      className={cn(
        "relative size-full overflow-hidden bg-background text-foreground outline-none",
        appIsDark ? "flexoki-dark" : "flexoki-light",
      )}
      style={{
        colorScheme: appIsDark ? "dark" : "light",
        backgroundImage:
          "radial-gradient(110% 90% at 50% 30%, var(--background) 0%, color-mix(in oklab, var(--muted) 85%, var(--foreground)) 100%)",
      }}
    >
      {ready && (
        <LayoutGroup id="xp-ribbons">
          <motion.div
            className="absolute"
            initial={false}
            animate={{ x: pageLeft }}
            transition={UNROLL}
            style={{ top: pageTop, left: 0, width: pageWidth, height: pageHeight }}
          >
            <div className="relative size-full overflow-hidden rounded-[3px] shadow-[0_40px_80px_-40px_rgb(0_0_0/0.55),0_2px_6px_rgb(0_0_0/0.08)]">
              <AnimatePresence initial={false} custom={direction} mode="popLayout">
                <motion.div
                  key={page}
                  custom={direction}
                  variants={PAGE_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="absolute inset-0"
                  transition={{ duration: 0.32, ease: EASE_OUT }}
                >
                  <BookPage
                    page={page}
                    flash={flash}
                    hoveredId={hoveredId}
                    onLayout={handleLayout}
                    showRunningHead={false}
                    topMargin={0.19}
                  />
                </motion.div>
              </AnimatePresence>
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 w-[7%]"
                style={{ background: "linear-gradient(to right, rgb(0 0 0 / 0.09), transparent)" }}
              />
              {!narrow && (
                <p className="xp-smcp pointer-events-none absolute right-[9%] top-[4.5%] max-w-[46%] truncate text-right text-[11px] text-muted-foreground">
                  {chapter.title}
                </p>
              )}
              <button
                type="button"
                tabIndex={-1}
                aria-label="Next page"
                onClick={() => goTo(stepPage(page, 1, layout))}
                className="absolute inset-y-[20%] right-0 w-[16%] cursor-e-resize"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-label="Previous page"
                onClick={() => goTo(stepPage(page, -1, layout))}
                className="absolute inset-y-[20%] left-0 w-[12%] cursor-w-resize"
              />
            </div>
          </motion.div>

          {/* The headband: ribbons come out from under the head of the page. */}
          <motion.div
            className="pointer-events-none absolute z-10"
            initial={false}
            animate={{ x: ribbonLeft - 6 }}
            transition={UNROLL}
            style={{ top: pageTop - 3, left: 0, width: RIBBONS.length * (RIBBON_WIDTH + RIBBON_GAP) + 5, height: 6 }}
          >
            <div className="size-full rounded-full bg-gradient-to-b from-black/25 to-transparent opacity-60" />
          </motion.div>

          {RIBBONS.map((ribbon, index) =>
            openId === ribbon.id ? null : (
              <Ribbon
                key={ribbon.id}
                ribbon={ribbon}
                left={ribbonLeft + index * (RIBBON_WIDTH + RIBBON_GAP)}
                top={pageTop - 2}
                count={ribbon.id === "place" ? null : passagesFor(ribbon.id).length}
                shortcut={index + 1}
                reducedMotion={reducedMotion}
                onRegisterSway={registerSway}
                onUnroll={() => unroll(ribbon.id)}
              />
            ),
          )}

          <AnimatePresence>
            {openRibbon && (
              <Banner
                key={openRibbon.id}
                ribbon={openRibbon}
                left={bannerLeft}
                top={pageTop - 2}
                width={narrow ? pageWidth : BANNER_WIDTH}
                height={pageHeight + 2}
                page={page}
                layout={layout}
                onGo={(target, highlight) => {
                  goTo(target, highlight);
                  // On a phone the banner covers the page; roll it away to show the passage.
                  if (narrow) rollUp();
                }}
                onHover={setHoveredId}
                onRollUp={rollUp}
              />
            )}
          </AnimatePresence>
        </LayoutGroup>
      )}

      <footer
        className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 px-5 text-xs text-muted-foreground"
        style={{ height: footerHeight }}
      >
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => goTo(stepPage(page, -1, layout))}
          className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          ‹
        </button>
        <span className="xp-serif xp-onum min-w-20 text-center text-sm text-foreground/80">
          {page} <span className="text-muted-foreground">of {BOOK_PAGES}</span>
        </span>
        <button
          type="button"
          aria-label="Next page"
          onClick={() => goTo(stepPage(page, 1, layout))}
          className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          ›
        </button>
        <span className="absolute right-5 max-md:hidden">
          Pull a ribbon, or press <Kbd>1</Kbd>–<Kbd>5</Kbd>
        </span>
      </footer>
    </div>
  );
}

function Ribbon({
  ribbon,
  left,
  top,
  count,
  shortcut,
  reducedMotion,
  onRegisterSway,
  onUnroll,
}: {
  ribbon: RibbonDefinition;
  left: number;
  top: number;
  count: number | null;
  shortcut: number;
  reducedMotion: boolean;
  onRegisterSway: (id: string, value: MotionValue<number>) => void;
  onUnroll: () => void;
}) {
  const base = ribbonLength(ribbon.id);
  const swayTarget = useMotionValue(0);
  const sway = useSpring(swayTarget, { stiffness: 120, damping: 5, mass: 0.6 });
  const pull = useMotionValue(0);
  const tilt = useMotionValue(0);
  const height = useTransform(pull, (value) => base + value);
  const rotate = useTransform([sway, tilt], ([swing, lean]: number[]) => swing + lean);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useEffect(() => onRegisterSway(ribbon.id, swayTarget), [onRegisterSway, ribbon.id, swayTarget]);

  useEffect(() => {
    if (drag.current) return;
    void animate(pull, hovered ? 12 : 0, reducedMotion ? { duration: 0 } : FABRIC);
  }, [hovered, pull, reducedMotion]);

  const release = (open: boolean) => {
    drag.current = null;
    void animate(tilt, 0, { type: "spring", stiffness: 200, damping: 8 });
    if (open) {
      onUnroll();
      return;
    }
    // A released ribbon springs back and bounces like cloth.
    void animate(pull, hovered ? 12 : 0, reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 11 });
  };

  return (
    <motion.div
      layoutId={`xp-ribbon-${ribbon.id}`}
      className="absolute z-20 [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.28))_drop-shadow(0_5px_7px_rgb(0_0_0/0.14))]"
      style={{ left, top, width: RIBBON_WIDTH, transformOrigin: "50% 0%", rotate }}
      transition={UNROLL}
    >
      <motion.button
        type="button"
        aria-label={`${ribbon.label}${count !== null ? `, ${count} passages` : ""}. Pull to unroll (${shortcut})`}
        className="xp-swallowtail xp-silk block w-full cursor-grab touch-none outline-none [--xp-notch:9px] active:cursor-grabbing focus-visible:brightness-110"
        style={{ height, background: ribbon.color }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Synthetic pointers cannot be captured.
          }
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          const dy = Math.max(0, event.clientY - current.y);
          const dx = event.clientX - current.x;
          if (Math.abs(dy) > 3 || Math.abs(dx) > 3) current.moved = true;
          // Free for the first stretch, then the silk resists.
          const stretched = dy < 90 ? dy : 90 + (dy - 90) * 0.35;
          pull.set(12 + stretched);
          tilt.set(Math.max(-10, Math.min(10, -dx * 0.12)));
        }}
        onPointerUp={() => {
          const current = drag.current;
          if (!current) return;
          if (!current.moved) {
            release(true);
            return;
          }
          release(pull.get() - 12 > PULL_TO_OPEN || pull.getVelocity() > 500);
        }}
        onPointerCancel={() => release(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onUnroll();
          }
        }}
      >
        {count !== null && (
          <span className="xp-lnum pointer-events-none absolute inset-x-0 bottom-[13px] text-center text-[9px] font-medium text-background/90">
            {count}
          </span>
        )}
      </motion.button>
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: 0.18 }}
            className="xp-smcp pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[10px] text-background"
            style={{ top: base - 16 }}
          >
            {ribbon.label}
            {count !== null && ` · ${count}`}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Banner({
  ribbon,
  left,
  top,
  width,
  height,
  page,
  layout,
  onGo,
  onHover,
  onRollUp,
}: {
  ribbon: RibbonDefinition;
  left: number;
  top: number;
  width: number;
  height: number;
  page: number;
  layout: BookLayout;
  onGo: (page: number, highlight?: EdgeHighlight) => void;
  onHover: (id: string | null) => void;
  onRollUp: () => void;
}) {
  const lift = useMotionValue(0);
  const drag = useRef<{ y: number } | null>(null);
  const passages = passagesFor(ribbon.id);
  const notes = passages.filter((passage) => passage.note).length;
  const currentChapter = chapterOfPage(page);

  return (
    <motion.div
      layoutId={`xp-ribbon-${ribbon.id}`}
      className="absolute z-30 [filter:drop-shadow(0_2px_2px_rgb(0_0_0/0.22))_drop-shadow(0_24px_30px_rgb(0_0_0/0.22))]"
      style={{ left, top, width, height, transformOrigin: "50% 0%" }}
      transition={UNROLL}
    >
      <motion.div
        className="xp-swallowtail relative flex size-full flex-col overflow-hidden text-background [--xp-notch:26px]"
        style={{ background: ribbon.color, y: lift }}
      >
        <div aria-hidden="true" className="xp-silk pointer-events-none absolute inset-0 opacity-40" />
        <motion.div
          className="relative flex min-h-0 flex-1 flex-col"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 0.22, duration: 0.4, ease: EASE_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
        >
          <div className="shrink-0 px-7 pt-7 pb-4">
            <p className="xp-smcp text-[11px] text-background/70">
              {ribbon.id === "place" ? "Ribbon · where you stopped" : `Ribbon · ${passages.length} passages · ${notes} notes`}
            </p>
            <h3 className="xp-serif mt-1.5 text-[2.6rem] leading-none tracking-[-0.02em] italic">
              {ribbon.id === "place" ? "Contents" : ribbon.label}
            </h3>
          </div>

          <div
            className="xp-scroll-quiet min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-16"
            style={{
              maskImage: "linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 64px), transparent calc(100% - 24px))",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 14px, #000 calc(100% - 64px), transparent calc(100% - 24px))",
            }}
          >
            {ribbon.id === "place" ? (
              <ol className="py-2">
                {CHAPTERS.map((chapter, index) => {
                  const here = chapter.index === currentChapter;
                  return (
                    <motion.li
                      key={chapter.index}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + index * 0.018, duration: 0.3, ease: EASE_OUT }}
                    >
                      <button
                        type="button"
                        onClick={() => onGo(chapter.page)}
                        className={cn(
                          "xp-serif flex w-full cursor-pointer items-baseline gap-3 rounded-lg px-3 py-[5px] text-left text-[15px] outline-none transition-colors hover:bg-background/12 focus-visible:bg-background/15",
                          here && "bg-background/15",
                        )}
                      >
                        <span className="xp-smcp w-7 shrink-0 text-right text-[11px] text-background/60">{chapter.numeral}</span>
                        <span className={cn("min-w-0 flex-1 truncate", here && "italic")}>{chapter.title}</span>
                        <span className="xp-onum shrink-0 text-background/60">{chapter.page}</span>
                      </button>
                    </motion.li>
                  );
                })}
              </ol>
            ) : (
              <ul className="py-2">
                {passages.map((passage, index) => {
                  const target = pageOfHighlight(passage, layout);
                  const here = target === page;
                  return (
                    <motion.li
                      key={passage.id}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.25 + index * 0.04, duration: 0.35, ease: EASE_OUT }}
                    >
                      <button
                        type="button"
                        onClick={() => onGo(target, passage)}
                        onPointerEnter={() => onHover(passage.id)}
                        onPointerLeave={() => onHover(null)}
                        className={cn(
                          "block w-full cursor-pointer rounded-xl px-3 py-3 text-left outline-none transition-colors hover:bg-background/12 focus-visible:bg-background/15",
                          here && "bg-background/15",
                        )}
                      >
                        <span className="xp-serif block text-[16px] leading-[1.38] text-pretty">{passage.text}</span>
                        {passage.note && (
                          <span className="xp-serif mt-1.5 block text-[14px] leading-snug text-background/75 italic">
                            — {passage.note}
                          </span>
                        )}
                        <span className="xp-smcp mt-1.5 block text-[10.5px] text-background/60">
                          {CHAPTERS[passage.chapter].numeral} · {CHAPTERS[passage.chapter].title} · p. {target}
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </ul>
            )}
          </div>
        </motion.div>

        {/* The tail is the handle: pull it up to roll the banner away. */}
        <motion.button
          type="button"
          aria-label="Roll up"
          onClick={onRollUp}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              // Synthetic pointers cannot be captured.
            }
            drag.current = { y: event.clientY };
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            const dy = event.clientY - drag.current.y;
            lift.set(dy < 0 ? dy : dy * 0.2);
          }}
          onPointerUp={(event) => {
            if (!drag.current) return;
            const dy = event.clientY - drag.current.y;
            drag.current = null;
            if (dy < -70 || lift.getVelocity() < -600) {
              event.preventDefault();
              onRollUp();
              return;
            }
            void animate(lift, 0, { type: "spring", stiffness: 500, damping: 18 });
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.4 } }}
          exit={{ opacity: 0, transition: { duration: 0.05 } }}
          className="xp-smcp absolute inset-x-0 bottom-0 flex h-16 cursor-n-resize touch-none items-start justify-center pt-2 text-[10.5px] text-background/70 outline-none hover:text-background focus-visible:text-background"
        >
          ↑ Roll up
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
