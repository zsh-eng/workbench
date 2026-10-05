/**
 * Elastic: the sidebar's width is its zoom.
 *
 * One sidebar, one drag handle, no modes. At a hairline it is a barcode of
 * the whole book: chapters, inks and your place. Wider, the chapters grow
 * numerals; wider still, the proportional bands even out into a contents
 * list; at full width it becomes an atlas with every passage. Release and it
 * settles on the nearest level, with your throw.
 */
import { cn } from "@/lib/utils";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { WALDEN_CHAPTER } from "../data/sample-texts";
import { EASE_OUT, inkColor, Kbd, SNAPPY_SPRING, StageSurface, useElementSize } from "../primitives";
import {
  BOOK_PAGES,
  BookPage,
  chapterEnd,
  chapterOfPage,
  CHAPTERS,
  clampTextPage,
  EDGE_HIGHLIGHTS,
  INITIAL_LAYOUT,
  pageOfHighlight,
  READING_PAGE,
  sameLayout,
  stepPage,
  TEXT_CHAPTER,
  type BookLayout,
  type EdgeHighlight,
  type InkFlash,
} from "../data/walden-book";

interface Level {
  id: "strip" | "index" | "contents" | "atlas";
  label: string;
  width: number;
}

const DESKTOP_LEVELS: Level[] = [
  { id: "strip", label: "Strip", width: 18 },
  { id: "index", label: "Index", width: 92 },
  { id: "contents", label: "Contents", width: 304 },
  { id: "atlas", label: "Atlas", width: 560 },
];

const HEADER = 60;
const SETTLE = { type: "spring", stiffness: 330, damping: 34, mass: 1 } as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smooth(from: number, to: number, value: number): number {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function chapterSpan(index: number): number {
  return chapterEnd(index) - CHAPTERS[index].page + 1;
}

/** Bands are proportional to chapter length when narrow and even out as the sidebar widens. */
function band(index: number, width: number, height: number): { top: number; height: number } {
  const start = CHAPTERS[index].page - 1;
  const t = smooth(120, 290, width);
  const row = height / CHAPTERS.length;
  return {
    top: lerp((start / BOOK_PAGES) * height, index * row, t),
    height: lerp((chapterSpan(index) / BOOK_PAGES) * height, row, t),
  };
}

function pageToY(page: number, width: number, height: number): number {
  const index = chapterOfPage(page);
  const geometry = band(index, width, height);
  return geometry.top + ((page - CHAPTERS[index].page + 0.5) / chapterSpan(index)) * geometry.height;
}

function yToPage(y: number, width: number, height: number): number {
  for (let index = 0; index < CHAPTERS.length; index += 1) {
    const geometry = band(index, width, height);
    if (y < geometry.top + geometry.height || index === CHAPTERS.length - 1) {
      const fraction = clamp((y - geometry.top) / geometry.height, 0, 0.999);
      return CHAPTERS[index].page + Math.floor(fraction * chapterSpan(index));
    }
  }
  return 1;
}

function minutesRead(index: number, page: number): number {
  const current = chapterOfPage(page);
  if (index < current) return Math.round(chapterSpan(index) * 2.2);
  if (index > current) return 0;
  return Math.round((page - CHAPTERS[index].page + 1) * 2.2);
}

function readFraction(index: number, page: number): number {
  const current = chapterOfPage(page);
  if (index < current) return 1;
  if (index > current) return 0;
  return (page - CHAPTERS[index].page + 1) / chapterSpan(index);
}

interface Preview {
  page: number;
  y: number;
}

export function Elastic() {
  const reducedMotion = useReducedMotion() ?? false;
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [page, setPage] = useState(READING_PAGE);
  const [layout, setLayout] = useState<BookLayout>(INITIAL_LAYOUT);
  const [flash, setFlash] = useState<InkFlash | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dragging, setDragging] = useState(false);
  const [levelId, setLevelId] = useState<Level["id"]>("index");
  const [labelVisible, setLabelVisible] = useState(false);
  const width = useMotionValue(DESKTOP_LEVELS[1].width);
  const needle = useMotionValue(READING_PAGE);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const labelTimer = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);

  const narrow = stage.width > 0 && stage.width < 760;
  const levels: Level[] = narrow
    ? [DESKTOP_LEVELS[0], { ...DESKTOP_LEVELS[1], width: 72 }, { ...DESKTOP_LEVELS[2], width: Math.max(0, stage.width) }]
    : DESKTOP_LEVELS;
  const maxWidth = levels[levels.length - 1].width;
  const bodyHeight = Math.max(200, stage.height - HEADER - 20);
  const footer = 48;
  const pageHeight = Math.max(320, Math.min(stage.height - HEADER - footer - 12, 700));
  const pageWidth = Math.round(pageHeight * 0.68);

  const pageX = useTransform(width, (value) => {
    const room = stage.width - value;
    const scale = clamp((room - 56) / pageWidth, 0.5, 1);
    return value + (room - pageWidth * scale) / 2;
  });
  const pageScale = useTransform(width, (value) => clamp((stage.width - value - 56) / pageWidth, 0.5, 1));
  // A page scaled down for room stays centred in the height it had.
  const pageY = useTransform(pageScale, (scale) => (pageHeight * (1 - scale)) / 2);
  const atlasOpacity = useTransform(width, (value) => smooth(390, 480, value));
  const bandsOpacity = useTransform(width, (value) => 1 - smooth(400, 470, value));
  const headerOpacity = useTransform(width, (value) => smooth(150, 230, value));
  const hintLeft = useTransform(width, (value) => value + 28);
  const labelLeft = useTransform(width, (value) => clamp(value, 90, Math.max(90, stage.width - 90)));

  useMotionValueEvent(width, "change", (value) => {
    const nearest = levels.reduce((best, level) =>
      Math.abs(level.width - value) < Math.abs(best.width - value) ? level : best,
    );
    if (nearest.id !== levelId) setLevelId(nearest.id);
  });

  useEffect(
    () => () => {
      window.clearTimeout(labelTimer.current);
      window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // A narrow stage starts on the strip so the page has room.
  useEffect(() => {
    if (narrow) width.set(72);
  }, [narrow, width]);

  const handleLayout = useCallback((next: BookLayout) => {
    setLayout((current) => (sameLayout(current, next) ? current : next));
  }, []);

  const showLabel = () => {
    window.clearTimeout(labelTimer.current);
    setLabelVisible(true);
    labelTimer.current = window.setTimeout(() => setLabelVisible(false), 1100);
  };

  const settleTo = (target: number, velocity = 0) => {
    void animate(width, target, reducedMotion ? { duration: 0 } : { ...SETTLE, velocity });
    showLabel();
  };

  const stepLevel = (direction: 1 | -1) => {
    const current = width.get();
    const index = levels.reduce(
      (best, level, levelIndex) =>
        Math.abs(level.width - current) < Math.abs(levels[best].width - current) ? levelIndex : best,
      0,
    );
    settleTo(levels[clamp(index + direction, 0, levels.length - 1)].width);
  };

  const goTo = (target: number, highlight?: EdgeHighlight) => {
    const next = clampTextPage(target, layout);
    window.clearTimeout(flashTimer.current);
    setFlash(null);
    setPage(next);
    void animate(needle, next, reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 160, damping: 24 });
    if (highlight) {
      flashTimer.current = window.setTimeout(() => setFlash({ id: highlight.id, key: Date.now() }), 320);
    }
    if (narrow && width.get() > 120) settleTo(levels[0].width);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "]") stepLevel(1);
    else if (event.key === "[") stepLevel(-1);
    else if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(stepPage(page, 1, layout));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(stepPage(page, -1, layout));
    }
  };

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
    width.stop();
    drag.current = { x: event.clientX, width: width.get() };
    setDragging(true);
    setPreview(null);
    window.clearTimeout(labelTimer.current);
    setLabelVisible(true);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const raw = current.width + event.clientX - current.x;
    // Past either end the edge resists, like pulling against a spring.
    const min = levels[0].width;
    const resisted = raw < min ? min - (min - raw) * 0.25 : raw > maxWidth ? maxWidth + (raw - maxWidth) * 0.25 : raw;
    width.set(Math.max(6, resisted));
  };

  const endDrag = () => {
    const current = drag.current;
    drag.current = null;
    setDragging(false);
    if (!current) return;
    const velocity = width.getVelocity();
    const projected = width.get() + velocity * 0.14;
    const target = levels.reduce((best, level) =>
      Math.abs(level.width - projected) < Math.abs(best.width - projected) ? level : best,
    );
    settleTo(target.width, velocity);
  };

  const ready = stage.width > 0;
  const level = levels.find((item) => item.id === levelId) ?? levels[1];
  const chapter = CHAPTERS[chapterOfPage(page)];

  return (
    <StageSurface tone="night" className="relative size-full overflow-hidden">
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 outline-none"
      >
        {ready && (
          <>
            <motion.div
              className="absolute"
              style={{
                top: HEADER - 4,
                left: 0,
                width: pageWidth,
                height: pageHeight,
                x: pageX,
                y: pageY,
                scale: pageScale,
                transformOrigin: "0% 0%",
              }}
            >
              <div className="relative size-full overflow-hidden rounded-[4px] shadow-[0_40px_90px_-40px_rgb(0_0_0/0.8),0_0_0_1px_color-mix(in_oklab,var(--foreground)_8%,transparent)]">
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.div
                    key={page}
                    className="absolute inset-0"
                    initial={{ opacity: 0, filter: "blur(6px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(6px)" }}
                    transition={{ duration: 0.35, ease: EASE_OUT }}
                  >
                    <BookPage page={page} flash={flash} onLayout={handleLayout} />
                  </motion.div>
                </AnimatePresence>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Next page"
                  onClick={() => goTo(stepPage(page, 1, layout))}
                  className="absolute inset-y-0 right-0 w-[18%] cursor-e-resize"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Previous page"
                  onClick={() => goTo(stepPage(page, -1, layout))}
                  className="absolute inset-y-0 left-0 w-[14%] cursor-w-resize"
                />
              </div>
            </motion.div>

            <Sidebar
              width={width}
              stageHeight={stage.height}
              bodyHeight={bodyHeight}
              page={page}
              needle={needle}
              layout={layout}
              bandsOpacity={bandsOpacity}
              atlasOpacity={atlasOpacity}
              headerOpacity={headerOpacity}
              levelId={levelId}
              dragging={dragging}
              preview={preview}
              onPreview={setPreview}
              onGo={goTo}
            />

            <AnimatePresence>
              {preview && (levelId === "strip" || levelId === "index") && !dragging && (
                <Loupe key="loupe" preview={preview} width={width} bodyHeight={bodyHeight} layout={layout} />
              )}
            </AnimatePresence>

            {/* The handle rides the sidebar's edge. */}
            <motion.div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Sidebar width: ${level.label}. Drag, or press [ and ]`}
              aria-valuenow={Math.round(width.get())}
              tabIndex={-1}
              onPointerDown={beginDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDoubleClick={() => stepLevel(level.id === levels[levels.length - 1].id ? -1 : 1)}
              className="group absolute top-0 bottom-0 z-30 w-4 -translate-x-1/2 cursor-col-resize touch-none"
              style={{ left: width }}
            >
              <span
                className={cn(
                  "absolute top-1/2 left-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/30 transition-[height,background-color,opacity] duration-200 group-hover:h-16 group-hover:bg-foreground/80",
                  dragging && "h-20 bg-foreground",
                )}
              />
            </motion.div>

            <AnimatePresence>
              {labelVisible && (
                <motion.div
                  key="label"
                  initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="pointer-events-none absolute bottom-5 z-40 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-foreground/10 bg-background/90 px-3.5 py-1.5 shadow-lg backdrop-blur-md"
                  style={{ left: labelLeft }}
                >
                  <span className="xp-serif text-sm italic">{level.label}</span>
                  <span className="flex gap-1">
                    {levels.map((item) => (
                      <span
                        key={item.id}
                        className={cn(
                          "size-1.5 rounded-full transition-colors",
                          item.id === level.id ? "bg-foreground" : "bg-foreground/25",
                        )}
                      />
                    ))}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.header
              className="pointer-events-none absolute top-0 right-0 z-10 flex items-center justify-end gap-4 px-5 md:px-7"
              style={{ height: HEADER - 4, left: width }}
            >
              <p className="xp-smcp truncate text-xs text-muted-foreground max-sm:hidden">
                {chapter.numeral} · {chapter.title}
              </p>
              <p className="xp-serif xp-onum shrink-0 text-sm text-foreground/80">
                {page} <span className="text-muted-foreground">/ {BOOK_PAGES}</span>
              </p>
            </motion.header>

            <motion.p
              className="pointer-events-none absolute bottom-4 z-10 text-xs text-muted-foreground max-md:hidden"
              style={{ left: hintLeft }}
              animate={{ opacity: dragging ? 0 : 1 }}
            >
              Drag the edge · <Kbd>[</Kbd> <Kbd>]</Kbd> to step
            </motion.p>
          </>
        )}
      </div>
    </StageSurface>
  );
}

function Sidebar({
  width,
  stageHeight,
  bodyHeight,
  page,
  needle,
  layout,
  bandsOpacity,
  atlasOpacity,
  headerOpacity,
  levelId,
  dragging,
  preview,
  onPreview,
  onGo,
}: {
  width: MotionValue<number>;
  stageHeight: number;
  bodyHeight: number;
  page: number;
  needle: MotionValue<number>;
  layout: BookLayout;
  bandsOpacity: MotionValue<number>;
  atlasOpacity: MotionValue<number>;
  headerOpacity: MotionValue<number>;
  levelId: Level["id"];
  dragging: boolean;
  preview: Preview | null;
  onPreview: (preview: Preview | null) => void;
  onGo: (page: number, highlight?: EdgeHighlight) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const needleY = useTransform([width, needle], ([w, p]: number[]) => pageToY(p, w, bodyHeight));
  const needleWidth = useTransform(width, (value) => value + 6);
  const needleOpacity = useTransform(width, (value) => 1 - smooth(140, 240, value) * 0.7 - smooth(400, 460, value) * 0.3);
  const atlasPointer = useTransform(atlasOpacity, (value) => (value > 0.6 ? "auto" : "none"));
  const bandsPointer = useTransform(atlasOpacity, (value) => (value > 0.6 ? "none" : "auto"));
  const previewEnabled = levelId === "strip" || levelId === "index";

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!previewEnabled || dragging || event.pointerType === "touch") return;
    const body = bodyRef.current;
    if (!body) return;
    const y = event.clientY - body.getBoundingClientRect().top;
    onPreview({ page: yToPage(y, width.get(), bodyHeight), y });
  };

  return (
    <motion.aside
      aria-label="Book sidebar"
      className="absolute top-0 left-0 z-20 overflow-hidden border-r border-foreground/[0.08]"
      style={{
        width,
        height: stageHeight,
        background: "color-mix(in oklab, var(--background) 90%, var(--foreground))",
      }}
    >
      <motion.div
        className="absolute inset-x-0 top-0 flex items-baseline justify-between gap-3 px-5 pt-5"
        style={{ opacity: headerOpacity, height: HEADER }}
      >
        <p className="xp-serif truncate text-xl italic">Walden</p>
        <p className="xp-smcp shrink-0 text-[11px] text-muted-foreground">
          {EDGE_HIGHLIGHTS.length} passages
        </p>
      </motion.div>

      <motion.div
        ref={bodyRef}
        className="absolute inset-x-0"
        style={{ top: HEADER, height: bodyHeight, opacity: bandsOpacity, pointerEvents: bandsPointer }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => onPreview(null)}
      >
        {CHAPTERS.map((chapter) => (
          <Band
            key={chapter.index}
            index={chapter.index}
            width={width}
            bodyHeight={bodyHeight}
            page={page}
            onGo={() => {
              // On the strip and the index, a click opens the page under the loupe.
              if (previewEnabled && preview) onGo(preview.page, previewText(preview.page).highlight);
              else onGo(chapter.page);
            }}
          />
        ))}
        {EDGE_HIGHLIGHTS.map((highlight) => (
          <Tick
            key={highlight.id}
            highlight={highlight}
            target={pageOfHighlight(highlight, layout)}
            width={width}
            bodyHeight={bodyHeight}
            onGo={onGo}
          />
        ))}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 h-0 -translate-y-1/2"
          style={{ top: needleY, width: needleWidth, opacity: needleOpacity }}
        >
          <span className="absolute inset-x-0 top-0 h-[2px] -translate-y-1/2 bg-foreground shadow-[0_0_10px_color-mix(in_oklab,var(--foreground)_60%,transparent)]" />
          <span className="absolute right-[-5px] top-0 size-0 -translate-y-1/2 border-y-[5px] border-l-[6px] border-y-transparent border-l-foreground" />
        </motion.div>
      </motion.div>

      <motion.div
        className="absolute inset-x-0 bottom-0"
        style={{ top: HEADER, opacity: atlasOpacity, pointerEvents: atlasPointer }}
      >
        <Atlas page={page} layout={layout} active={levelId === "atlas"} onGo={onGo} />
      </motion.div>

    </motion.aside>
  );
}

function Band({
  index,
  width,
  bodyHeight,
  page,
  onGo,
}: {
  index: number;
  width: MotionValue<number>;
  bodyHeight: number;
  page: number;
  onGo: () => void;
}) {
  const chapter = CHAPTERS[index];
  const current = chapterOfPage(page) === index;
  const read = readFraction(index, page);
  const top = useTransform(width, (w) => band(index, w, bodyHeight).top);
  const height = useTransform(width, (w) => band(index, w, bodyHeight).height);
  const fillOpacity = useTransform(width, (w) => 1 - smooth(130, 270, w) * 0.88);
  const numeralX = useTransform(width, (w) => lerp(w / 2, 22, smooth(130, 220, w)));
  const numeralShift = useTransform(width, (w) => `${-50 * (1 - smooth(130, 220, w))}%`);
  const numeralOrigin = useTransform(width, (w) => `${50 * (1 - smooth(130, 220, w))}% 50%`);
  const numeralScale = useTransform(width, (w) => {
    const h = band(index, w, bodyHeight).height;
    const big = clamp(h * 0.62, 9, 30) / 30;
    return lerp(big, 11 / 30, smooth(130, 240, w));
  });
  const numeralOpacity = useTransform(width, (w) => {
    const h = band(index, w, bodyHeight).height;
    const fits = w > 220 || h >= 14 ? 1 : 0;
    return smooth(30, 66, w) * fits;
  });
  const titleOpacity = useTransform(width, (w) => smooth(170, 250, w));
  const pageOpacity = useTransform(width, (w) => smooth(220, 280, w));
  const ruleOpacity = useTransform(width, (w) => smooth(200, 280, w));

  return (
    <motion.button
      type="button"
      onClick={onGo}
      aria-label={`Chapter ${chapter.numeral}, ${chapter.title}, page ${chapter.page}`}
      aria-current={current ? "true" : undefined}
      className="group absolute inset-x-0 cursor-pointer overflow-hidden text-left outline-none focus-visible:bg-foreground/10"
      style={{ top, height }}
    >
      <motion.span aria-hidden="true" className="absolute inset-0" style={{ opacity: fillOpacity }}>
        <span
          className="absolute inset-0"
          style={{ background: `color-mix(in oklab, var(--foreground) ${index % 2 ? 7 : 4}%, transparent)` }}
        />
        <span
          className="absolute inset-x-0 top-0"
          style={{
            height: `${read * 100}%`,
            background: `color-mix(in oklab, var(--foreground) ${current ? 30 : 17}%, transparent)`,
          }}
        />
      </motion.span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 transition-colors duration-200 group-hover:bg-foreground/[0.07]",
          current && "bg-foreground/[0.06]",
        )}
      />
      <motion.span
        aria-hidden="true"
        className="absolute inset-x-4 bottom-0 h-px bg-foreground/[0.07]"
        style={{ opacity: ruleOpacity }}
      />
      <motion.span
        className={cn(
          "xp-serif absolute top-1/2 left-0 text-[30px] leading-none whitespace-nowrap",
          current ? "text-foreground" : "text-muted-foreground",
        )}
        style={{ x: numeralX, y: "-50%", opacity: numeralOpacity }}
      >
        <motion.span
          className="inline-block"
          style={{ x: numeralShift, scale: numeralScale, transformOrigin: numeralOrigin }}
        >
          {chapter.numeral}
        </motion.span>
      </motion.span>
      <motion.span
        className={cn("xp-serif absolute top-1/2 left-[56px] right-[76px] -translate-y-1/2 truncate text-[15px]", current && "italic")}
        style={{ opacity: titleOpacity }}
      >
        {chapter.title}
      </motion.span>
      <motion.span
        className="xp-serif xp-onum absolute top-1/2 right-4 -translate-y-1/2 text-[14px] text-muted-foreground"
        style={{ opacity: pageOpacity }}
      >
        {chapter.page}
      </motion.span>
    </motion.button>
  );
}

function Tick({
  highlight,
  target,
  width,
  bodyHeight,
  onGo,
}: {
  highlight: EdgeHighlight;
  target: number;
  width: MotionValue<number>;
  bodyHeight: number;
  onGo: (page: number, highlight?: EdgeHighlight) => void;
}) {
  const y = useTransform(width, (w) => pageToY(target, w, bodyHeight));
  // A full-width tick on the strip becomes a dot as the sidebar widens.
  const dot = useTransform(width, (w) => smooth(26, 70, w));
  const left = useTransform(width, (w) => {
    const t = smooth(26, 70, w);
    return lerp(lerp(0, w - 15, t), w - 66, smooth(200, 290, w));
  });
  const tickWidth = useTransform([width, dot], ([w, t]: number[]) => lerp(w, 6, t));
  const tickHeight = useTransform(dot, (t) => lerp(2, 6, t));

  return (
    <motion.button
      type="button"
      aria-label={`${highlight.color} passage on page ${target}`}
      onClick={(event) => {
        event.stopPropagation();
        onGo(target, highlight);
      }}
      className="absolute z-10 -translate-y-1/2 cursor-pointer rounded-full outline-none before:absolute before:-inset-1.5 before:content-[''] focus-visible:ring-2 focus-visible:ring-foreground"
      style={{
        top: y,
        left,
        width: tickWidth,
        height: tickHeight,
        background: inkColor(highlight.color),
        boxShadow: `0 0 8px color-mix(in oklab, ${inkColor(highlight.color)} 70%, transparent)`,
      }}
      whileHover={{ scale: 1.6 }}
      transition={SNAPPY_SPRING}
    />
  );
}

function previewText(page: number): { kind: "text" | "passage" | "opener"; text: string; highlight?: EdgeHighlight } {
  const index = chapterOfPage(page);
  const nearby = EDGE_HIGHLIGHTS.filter((highlight) => highlight.page !== null && Math.abs(highlight.page - page) <= 2);
  if (nearby[0]) return { kind: "passage", text: nearby[0].text, highlight: nearby[0] };
  if (index === TEXT_CHAPTER) {
    const fraction = (page - CHAPTERS[index].page) / chapterSpan(index);
    const paragraph = WALDEN_CHAPTER.paragraphs[Math.min(WALDEN_CHAPTER.paragraphs.length - 1, Math.floor(fraction * WALDEN_CHAPTER.paragraphs.length))];
    return { kind: "text", text: `${paragraph.slice(0, 150)}…` };
  }
  return { kind: "opener", text: CHAPTERS[index].title };
}

function Loupe({
  preview,
  width,
  bodyHeight,
  layout,
}: {
  preview: Preview;
  width: MotionValue<number>;
  bodyHeight: number;
  layout: BookLayout;
}) {
  const index = chapterOfPage(preview.page);
  const chapter = CHAPTERS[index];
  const content = previewText(preview.page);
  const left = useTransform(width, (value) => value + 14);
  const top = clamp(HEADER + preview.y - 70, 12, HEADER + bodyHeight - 170);

  return (
    <motion.div
      initial={{ opacity: 0, x: -8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1, top }}
      exit={{ opacity: 0, x: -6, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ ...SNAPPY_SPRING, opacity: { duration: 0.15 } }}
      className="pointer-events-none absolute z-50 w-60 origin-left"
      style={{ left }}
    >
      <div className="flexoki-light rounded-lg bg-background p-4 text-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)]">
        <div className="flex items-baseline justify-between gap-3">
          <p className="xp-smcp truncate text-[10.5px] text-muted-foreground">
            {chapter.numeral} · {chapter.title}
          </p>
          <p className="xp-serif xp-onum text-lg leading-none">{preview.page}</p>
        </div>
        <p
          className={cn(
            "xp-serif mt-2.5 line-clamp-4 text-[14px] leading-[1.4]",
            content.kind === "opener" && "text-center text-xl italic",
          )}
        >
          {content.kind === "passage" && content.highlight ? (
            <span
              className="rounded-[2px] px-0.5"
              style={{ background: `color-mix(in oklab, var(--${content.highlight.color}-secondary) 80%, transparent)` }}
            >
              {content.text}
            </span>
          ) : (
            content.text
          )}
        </p>
        <p className="xp-smcp mt-2.5 text-[10px] text-muted-foreground">
          {content.highlight ? `Kept · p. ${pageOfHighlight(content.highlight, layout)}` : "Click to open"}
        </p>
      </div>
    </motion.div>
  );
}

function Atlas({
  page,
  layout,
  active,
  onGo,
}: {
  page: number;
  layout: BookLayout;
  active: boolean;
  onGo: (page: number, highlight?: EdgeHighlight) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const current = chapterOfPage(page);

  useEffect(() => {
    if (!active) return;
    const scroller = scrollRef.current;
    const section = scroller?.querySelector<HTMLElement>(`[data-chapter="${current}"]`);
    if (scroller && section) scroller.scrollTo({ top: Math.max(0, section.offsetTop - 12), behavior: "smooth" });
  }, [active, current]);

  return (
    <div
      ref={scrollRef}
      className="xp-scroll-quiet size-full overflow-y-auto overscroll-contain"
      style={{ minWidth: 420, width: 560 }}
    >
      <div className="px-3 pt-1 pb-24">
        {CHAPTERS.map((chapter) => {
          const kept = EDGE_HIGHLIGHTS.filter((highlight) => highlight.chapter === chapter.index);
          const minutes = minutesRead(chapter.index, page);
          const fraction = readFraction(chapter.index, page);
          const here = chapter.index === current;
          return (
            <section
              key={chapter.index}
              data-chapter={chapter.index}
              className={cn("rounded-2xl px-4 py-3.5", here && "bg-foreground/[0.06]")}
            >
              <button
                type="button"
                onClick={() => onGo(chapter.page)}
                className="group grid w-full cursor-pointer grid-cols-[3.2rem_minmax(0,1fr)_auto] items-baseline text-left outline-none"
              >
                <span className="xp-serif text-[1.6rem] leading-none text-muted-foreground">{chapter.numeral}</span>
                <span className="xp-serif truncate text-[1.25rem] leading-tight italic decoration-foreground/30 underline-offset-4 group-hover:underline">
                  {chapter.title}
                </span>
                <span className="xp-serif xp-onum pl-3 text-sm text-muted-foreground">
                  {chapter.page}–{chapterEnd(chapter.index)}
                </span>
              </button>
              <div className="mt-2 ml-[3.2rem] flex items-center gap-3">
                <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-foreground/10">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-foreground/70"
                    style={{ width: `${fraction * 100}%` }}
                  />
                </span>
                <span className="xp-lnum w-16 text-right text-[11px] text-muted-foreground">
                  {minutes > 0 ? `${minutes} min` : "ahead"}
                </span>
              </div>
              {kept.length > 0 && (
                <ul className="mt-2.5 ml-[3.2rem] space-y-1">
                  {kept.map((highlight) => (
                    <li key={highlight.id}>
                      <button
                        type="button"
                        onClick={() => onGo(pageOfHighlight(highlight, layout), highlight)}
                        className="group/passage grid w-full cursor-pointer grid-cols-[0.9rem_minmax(0,1fr)_auto] items-baseline gap-x-1.5 rounded-lg py-1 text-left outline-none"
                      >
                        <span
                          className="size-[7px] translate-y-[-1px] rounded-full"
                          style={{ background: inkColor(highlight.color), boxShadow: `0 0 8px ${inkColor(highlight.color)}` }}
                        />
                        <span className="xp-serif line-clamp-2 text-[14px] leading-[1.4] text-foreground/80 group-hover/passage:text-foreground">
                          {highlight.text}
                        </span>
                        <span className="xp-onum xp-serif pl-2 text-[13px] text-muted-foreground">
                          {pageOfHighlight(highlight, layout)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
