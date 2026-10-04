/**
 * Lumen: continuous scroll with a reading lamp.
 *
 * The reading line sits at 40% of the viewport. Each paragraph derives its
 * light from its own scroll progress through that line, so there is no
 * scroll-handler state per frame. Line focus uses one fixed mask on the
 * scroller. The pacer advances scroll position at the chosen reading speed.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import { Minus, Pause, Play, Plus } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { MOBY_DICK_CHAPTER, countWords } from "../data/sample-texts";
import { SNAPPY_SPRING, StageSurface } from "../primitives";

const READING_LINE = 0.4;
const FONT_SIZE = 21;
const LINE_HEIGHT = 34;
const WPM_STEPS = [160, 200, 240, 280, 320, 380, 450];

type FocusMode = "paragraph" | "line";

const PARAGRAPH_WORDS = MOBY_DICK_CHAPTER.paragraphs.map(countWords);
const TOTAL_WORDS = PARAGRAPH_WORDS.reduce((sum, count) => sum + count, 0);

function LitParagraph({
  text,
  index,
  scroller,
  mode,
  paragraphRef,
}: {
  text: string;
  index: number;
  scroller: RefObject<HTMLDivElement | null>;
  mode: FocusMode;
  paragraphRef: (node: HTMLParagraphElement | null) => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    container: scroller,
    target: ref,
    offset: [`start ${READING_LINE + 0.22}`, `end ${READING_LINE - 0.1}`],
  });
  const opacity = useTransform(scrollYProgress, [0, 0.1, 0.9, 1], [0.34, 1, 1, 0.2]);
  const blur = useTransform(scrollYProgress, [0, 0.1, 0.9, 1], [0.4, 0, 0, 1.1]);
  const filter = useTransform(blur, (value) => `blur(${value}px)`);
  const lineMode = mode === "line";

  return (
    <motion.p
      ref={(node) => {
        ref.current = node;
        paragraphRef(node);
      }}
      style={lineMode ? { opacity: 1 } : { opacity, filter }}
      className={cn(
        "transition-[opacity] duration-500",
        index === 0 && "xp-opening",
        index > 0 && "indent-[1.5em]",
      )}
    >
      {text}
    </motion.p>
  );
}

function RollingNumber({ value }: { value: number }) {
  return (
    <span className="relative inline-flex overflow-hidden tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          initial={{ y: "-100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={SNAPPY_SPRING}
          className="inline-block"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function ProgressFilament({
  progress,
  ticks,
  onJump,
}: {
  progress: MotionValue<number>;
  ticks: number[];
  onJump: (index: number) => void;
}) {
  return (
    <div className="absolute top-[18%] right-5 bottom-[18%] w-6 max-sm:hidden" aria-hidden="true">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/12" />
      <motion.div
        className="absolute inset-x-0 top-0 mx-auto h-full w-px origin-top bg-foreground/70"
        style={{ scaleY: progress }}
      />
      {ticks.map((tick, index) => (
        <button
          key={index}
          type="button"
          tabIndex={-1}
          onClick={() => onJump(index)}
          className="group absolute left-1/2 grid h-3 w-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center"
          style={{ top: `${tick * 100}%` }}
        >
          <span className="block h-px w-2 bg-foreground/40 transition-all group-hover:w-4 group-hover:bg-foreground" />
        </button>
      ))}
    </div>
  );
}

export function LumenReader() {
  const reducedMotion = useReducedMotion() ?? false;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const [mode, setMode] = useState<FocusMode>("paragraph");
  const [playing, setPlaying] = useState(false);
  const [wpmIndex, setWpmIndex] = useState(2);
  const [activeIndex, setActiveIndex] = useState(0);
  const [minutesLeft, setMinutesLeft] = useState(Math.ceil(TOTAL_WORDS / WPM_STEPS[2]));
  const [ticks, setTicks] = useState<number[]>([]);
  const [viewportH, setViewportH] = useState(640);
  const wpm = WPM_STEPS[wpmIndex];
  const { scrollY, scrollYProgress } = useScroll({ container: scrollerRef });

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const observer = new ResizeObserver(() => setViewportH(scroller.clientHeight));
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Paragraph positions as fractions of the scrollable range, for ticks.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const range = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const line = scroller.clientHeight * READING_LINE;
    setTicks(
      paragraphRefs.current.map((node) =>
        node ? Math.min(1, Math.max(0, (node.offsetTop - line) / range)) : 0,
      ),
    );
  }, [viewportH]);

  const updateReadingPosition = (top: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const line = top + scroller.clientHeight * READING_LINE;
    let index = 0;
    let wordsRead = 0;
    paragraphRefs.current.forEach((node, nodeIndex) => {
      if (!node) return;
      if (node.offsetTop <= line) index = nodeIndex;
      const within = (line - node.offsetTop) / Math.max(1, node.offsetHeight);
      wordsRead += PARAGRAPH_WORDS[nodeIndex] * Math.min(1, Math.max(0, within));
    });
    setActiveIndex(index);
    setMinutesLeft(Math.max(0, Math.ceil((TOTAL_WORDS - wordsRead) / wpm)));
  };

  useMotionValueEvent(scrollY, "change", updateReadingPosition);
  useEffect(() => {
    updateReadingPosition(scrollerRef.current?.scrollTop ?? 0);
    // Recalculate when the speed changes the time estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wpm]);

  // Pacer: advance by measured words-per-pixel at the chosen reading speed.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!playing || !scroller) return;
    const first = paragraphRefs.current[0];
    const last = paragraphRefs.current[paragraphRefs.current.length - 1];
    const textHeight = first && last ? last.offsetTop + last.offsetHeight - first.offsetTop : 1;
    const pixelsPerSecond = (wpm / 60) * (textHeight / TOTAL_WORDS);
    let position = scroller.scrollTop;
    let previous = performance.now();
    let frame = 0;

    const step = (now: number) => {
      const dt = Math.min(64, now - previous) / 1000;
      previous = now;
      position += pixelsPerSecond * dt;
      scroller.scrollTop = position;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, wpm]);

  const scrollToParagraph = (index: number) => {
    const scroller = scrollerRef.current;
    const node = paragraphRefs.current[index];
    if (!scroller || !node) return;
    const target = node.offsetTop - scroller.clientHeight * READING_LINE + 4;
    if (reducedMotion) {
      scroller.scrollTop = target;
      return;
    }
    void animate(scroller.scrollTop, target, {
      duration: 0.7,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (value) => {
        scroller.scrollTop = value;
      },
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (event.key === " " || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setPlaying(false);
      const back = event.shiftKey || event.key === "ArrowUp";
      if (mode === "paragraph" && event.key === " ") {
        scrollToParagraph(Math.max(0, Math.min(MOBY_DICK_CHAPTER.paragraphs.length - 1, activeIndex + (back ? -1 : 1))));
        return;
      }
      scroller.scrollBy({ top: back ? -LINE_HEIGHT : LINE_HEIGHT, behavior: reducedMotion ? "auto" : "smooth" });
    }
  };

  const band = mode === "line" ? LINE_HEIGHT * 1.15 : 2400;

  return (
    <StageSurface tone="night" className="relative size-full overflow-hidden">
      {/* The lamp: a soft pool of light on the reading line. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 h-[46%] -translate-y-1/2"
        style={{
          top: `${READING_LINE * 100}%`,
          background:
            "radial-gradient(60% 50% at 50% 50%, color-mix(in oklab, var(--yellow-primary) 9%, transparent), transparent 70%)",
        }}
      />

      <motion.div
        ref={scrollerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onWheel={() => setPlaying(false)}
        onPointerDown={() => setPlaying(false)}
        aria-label={`${MOBY_DICK_CHAPTER.book}, chapter ${MOBY_DICK_CHAPTER.number}`}
        className="xp-scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain outline-none"
        initial={false}
        animate={{ "--xp-band": `${band}px` } as Record<string, string>}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        style={{
          maskImage: `linear-gradient(to bottom, rgba(0,0,0,0.13) calc(${READING_LINE * 100}% - var(--xp-band) - 28px), #000 calc(${READING_LINE * 100}% - var(--xp-band)), #000 calc(${READING_LINE * 100}% + var(--xp-band)), rgba(0,0,0,0.13) calc(${READING_LINE * 100}% + var(--xp-band) + 36px))`,
          WebkitMaskImage: `linear-gradient(to bottom, rgba(0,0,0,0.13) calc(${READING_LINE * 100}% - var(--xp-band) - 28px), #000 calc(${READING_LINE * 100}% - var(--xp-band)), #000 calc(${READING_LINE * 100}% + var(--xp-band)), rgba(0,0,0,0.13) calc(${READING_LINE * 100}% + var(--xp-band) + 36px))`,
        }}
      >
        <article
          className="xp-book-text mx-auto max-w-[34rem] px-6 text-left"
          style={{
            fontSize: FONT_SIZE,
            lineHeight: `${LINE_HEIGHT}px`,
            // Let the first and last lines reach the reading line.
            paddingTop: viewportH * READING_LINE - LINE_HEIGHT * 0.5,
            paddingBottom: viewportH * (1 - READING_LINE),
            textAlign: "left",
          }}
        >
          <header className="mb-14 text-center">
            <p className="xp-smcp text-sm tracking-[0.3em] text-muted-foreground">
              Chapter {MOBY_DICK_CHAPTER.number}
            </p>
            <h4 className="mt-3 text-6xl leading-none italic tracking-[-0.02em]">
              {MOBY_DICK_CHAPTER.title}.
            </h4>
          </header>
          {MOBY_DICK_CHAPTER.paragraphs.map((paragraph, index) => (
            <LitParagraph
              key={index}
              text={paragraph}
              index={index}
              scroller={scrollerRef}
              mode={mode}
              paragraphRef={(node) => {
                paragraphRefs.current[index] = node;
              }}
            />
          ))}
          <p className="mt-16 text-center text-muted-foreground italic" style={{ textIndent: 0 }}>
            — End of chapter —
          </p>
        </article>
      </motion.div>

      {/* Reading line marker in the margin */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-5 flex -translate-y-1/2 items-center gap-2 font-mono text-[11px] text-muted-foreground md:left-8"
        style={{ top: `${READING_LINE * 100}%` }}
      >
        <span>¶</span>
        <RollingNumber value={activeIndex + 1} />
        <span className="h-px w-6 bg-foreground/30 md:w-14" />
      </div>

      <ProgressFilament progress={scrollYProgress} ticks={ticks} onJump={scrollToParagraph} />

      {/* Chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-background via-background/80 to-transparent p-4 pb-10 md:p-6 md:pb-12">
        <p className="xp-smcp pointer-events-auto pt-1.5 text-xs text-muted-foreground">
          {MOBY_DICK_CHAPTER.book}
          <span className="mx-2 opacity-50">/</span>
          {MOBY_DICK_CHAPTER.title}
        </p>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          <div className="relative flex rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5 text-[11px] font-medium">
            {(["paragraph", "line"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "relative isolate cursor-pointer rounded-full px-3 py-1 capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  mode === option ? "text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {mode === option && (
                  <motion.span
                    layoutId="lumen-mode"
                    transition={SNAPPY_SPRING}
                    className="absolute inset-0 -z-10 rounded-full bg-foreground"
                  />
                )}
                {option}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5">
            <button
              type="button"
              aria-label={playing ? "Pause pacer" : "Start pacer"}
              onClick={() => {
                setPlaying((value) => !value);
                scrollerRef.current?.focus({ preventScroll: true });
              }}
              className="grid size-7 cursor-pointer place-items-center rounded-full bg-foreground text-background outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={playing ? "pause" : "play"}
                  initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  exit={{ scale: 0.4, opacity: 0, rotate: 30 }}
                  transition={SNAPPY_SPRING}
                >
                  {playing ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5 translate-x-px" fill="currentColor" />}
                </motion.span>
              </AnimatePresence>
            </button>
            <button
              type="button"
              aria-label="Slower"
              disabled={wpmIndex === 0}
              onClick={() => setWpmIndex((value) => Math.max(0, value - 1))}
              className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground disabled:opacity-30"
            >
              <Minus className="size-3" />
            </button>
            <span className="min-w-[4.5rem] text-center font-mono text-[11px] text-foreground/80">
              <RollingNumber value={wpm} /> wpm
            </span>
            <button
              type="button"
              aria-label="Faster"
              disabled={wpmIndex === WPM_STEPS.length - 1}
              onClick={() => setWpmIndex((value) => Math.min(WPM_STEPS.length - 1, value + 1))}
              className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground disabled:opacity-30"
            >
              <Plus className="size-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-background via-background/80 to-transparent px-4 pt-12 pb-5">
        <p className="xp-serif text-base text-muted-foreground italic">
          {minutesLeft === 0 ? (
            "Chapter finished"
          ) : (
            <>
              <span className="not-italic text-foreground/85">
                <RollingNumber value={minutesLeft} />
              </span>{" "}
              {minutesLeft === 1 ? "minute" : "minutes"} left in chapter
            </>
          )}
        </p>
      </div>
    </StageSurface>
  );
}
