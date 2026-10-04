/**
 * Deck: a daily stack of highlights to sort by hand.
 *
 * The top card follows the pointer, tilts with its offset and reveals a
 * stamp for the decision it is heading toward. Releasing past a distance or
 * with enough velocity throws it out; flicking it up tucks it under the
 * stack. Tapping flips the card to show the passage around the highlight.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
  type PanInfo,
} from "motion/react";
import { ArrowUp, RotateCcw, Star, X } from "lucide-react";
import { useMemo, useState, type KeyboardEvent } from "react";
import { mulberry32, type StudioBook, type StudioHighlight, type StudioLibrary } from "../data/sample-library";
import {
  EASE_OUT,
  SNAPPY_SPRING,
  SOFT_SPRING,
  StageSurface,
  getStableNumber,
  inkColor,
  inkWash,
  useElementSize,
} from "../primitives";

const DAILY_COUNT = 7;
const THROW_DISTANCE = 120;
const THROW_VELOCITY = 550;
const VISIBLE_DEPTH = 4;

type Decision = "keep" | "release" | "later";

function dailySelection(highlights: StudioHighlight[]): StudioHighlight[] {
  const day = Math.floor(Date.now() / 86_400_000);
  const random = mulberry32(day);
  const pool = [...highlights];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  return pool.slice(0, DAILY_COUNT);
}

function cardTextSize(text: string): string {
  if (text.length < 40) return "text-[2rem] leading-[1.1]";
  if (text.length < 110) return "text-[1.55rem] leading-[1.22]";
  if (text.length < 190) return "text-[1.3rem] leading-[1.3]";
  return "text-[1.1rem] leading-[1.38]";
}

function Tape({ color, seed }: { color: StudioHighlight["color"]; seed: number }) {
  const rotate = ((seed % 9) - 4) * 0.9;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-3 left-1/2 h-7 w-24 -translate-x-1/2 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
      style={{
        rotate: `${rotate}deg`,
        background: `color-mix(in oklab, ${inkWash(color)} 78%, transparent)`,
        clipPath:
          "polygon(0 8%, 4% 0, 8% 10%, 12% 0, 88% 0, 92% 10%, 96% 0, 100% 8%, 100% 92%, 96% 100%, 92% 90%, 88% 100%, 12% 100%, 8% 90%, 4% 100%, 0 92%)",
      }}
    />
  );
}

function CardFace({
  highlight,
  book,
  number,
  side,
}: {
  highlight: StudioHighlight;
  book: StudioBook | undefined;
  number: number;
  side: "front" | "back";
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden rounded-[6px] bg-card px-7 pt-8 pb-5 text-card-foreground"
      style={{
        backfaceVisibility: "hidden",
        transform: side === "back" ? "rotateY(180deg)" : undefined,
        boxShadow:
          "0 1px 0 rgba(0,0,0,0.04), 0 2px 4px rgba(0,0,0,0.04), 0 18px 40px -18px rgba(0,0,0,0.35)",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-[66px] h-px"
        style={{ background: `color-mix(in oklab, ${inkColor(highlight.color)} 55%, transparent)` }}
      />
      <div className="flex items-center justify-between font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
        <span>No. {String(number).padStart(2, "0")}</span>
        <span>{side === "front" ? highlight.chapter : "Context"}</span>
      </div>

      {side === "front" ? (
        <blockquote className={cn("xp-serif my-auto pt-6 text-pretty", cardTextSize(highlight.text))}>
          {highlight.text}
        </blockquote>
      ) : (
        <div className="my-auto pt-6">
          <p className="xp-serif text-[1.05rem] leading-[1.5] text-foreground/60">
            {highlight.before && <>…{highlight.before}</>}
            <span
              className="xp-ink text-foreground"
              style={{ ["--xp-ink" as string]: inkWash(highlight.color), color: "inherit" }}
            >
              {highlight.text}
            </span>
            {highlight.after && <>{highlight.after}…</>}
          </p>
          {highlight.note && (
            <p className="mt-4 text-sm text-foreground/80">
              <span className="xp-smcp mr-2 text-xs text-muted-foreground">Note</span>
              {highlight.note}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between gap-4">
        <p className="min-w-0 truncate">
          <span className="xp-serif text-base italic">{book?.title}</span>
          <span className="xp-smcp ml-2 text-xs text-muted-foreground">{book?.author}</span>
        </p>
        <span className="xp-serif xp-onum shrink-0 text-sm text-muted-foreground italic">p. {highlight.locator}</span>
      </div>
    </div>
  );
}

function Stamp({ label, className, opacity, color }: { label: string; className: string; opacity: MotionValue<number>; color: string }) {
  return (
    <motion.span
      aria-hidden="true"
      className={cn("xp-smcp pointer-events-none absolute z-10 rounded-md border-[2.5px] px-3 py-1 text-lg font-semibold tracking-[0.2em]", className)}
      style={{ opacity, color, borderColor: color }}
    >
      {label}
    </motion.span>
  );
}

function TopCard({
  highlight,
  book,
  number,
  flipped,
  cardW,
  cardH,
  onDecide,
  onFlip,
}: {
  highlight: StudioHighlight;
  book: StudioBook | undefined;
  number: number;
  flipped: boolean;
  cardW: number;
  cardH: number;
  onDecide: (decision: Decision) => void;
  onFlip: () => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-320, 320], [-16, 16]);
  const keepOpacity = useTransform(x, [24, THROW_DISTANCE], [0, 1]);
  const releaseOpacity = useTransform(x, [-THROW_DISTANCE, -24], [1, 0]);
  const laterOpacity = useTransform(y, [-THROW_DISTANCE, -30], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    const { offset, velocity } = info;
    if (offset.y < -THROW_DISTANCE * 0.9 || velocity.y < -THROW_VELOCITY * 1.1) {
      onDecide("later");
      return;
    }
    if (offset.x > THROW_DISTANCE || velocity.x > THROW_VELOCITY) {
      onDecide("keep");
      return;
    }
    if (offset.x < -THROW_DISTANCE || velocity.x < -THROW_VELOCITY) {
      onDecide("release");
      return;
    }
    void animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
    void animate(y, 0, { type: "spring", stiffness: 500, damping: 30 });
  };

  return (
    <motion.div
      className="absolute top-1/2 left-1/2 cursor-grab touch-none active:cursor-grabbing"
      style={{ x, y, rotate, width: cardW, height: cardH, marginLeft: -cardW / 2, marginTop: -cardH / 2, zIndex: 20, perspective: 1600 }}
      drag
      dragElastic={0.85}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      onTap={onFlip}
      whileDrag={{ scale: 1.03 }}
      initial={false}
      animate={{ scale: 1 }}
      transition={SNAPPY_SPRING}
    >
      <Tape color={highlight.color} seed={getStableNumber(highlight.id)} />
      <Stamp label="Keep" className="top-10 left-7 -rotate-12" opacity={keepOpacity} color={inkColor("green")} />
      <Stamp label="Let go" className="top-10 right-7 rotate-12" opacity={releaseOpacity} color="var(--muted-foreground)" />
      <Stamp label="Later" className="bottom-16 left-1/2 -translate-x-1/2" opacity={laterOpacity} color={inkColor("blue")} />
      <motion.div
        className="relative size-full"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 22 }}
      >
        <CardFace highlight={highlight} book={book} number={number} side="front" />
        <CardFace highlight={highlight} book={book} number={number} side="back" />
      </motion.div>
    </motion.div>
  );
}

export function HighlightDeck({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const deck = useMemo(() => dailySelection(library.highlights), [library.highlights]);
  const numbers = useMemo(() => new Map(deck.map((highlight, index) => [highlight.id, index + 1])), [deck]);
  const booksById = useMemo(() => new Map(library.books.map((book) => [book.id, book])), [library.books]);
  const [queue, setQueue] = useState<string[]>(() => deck.map((highlight) => highlight.id));
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [flipped, setFlipped] = useState(false);
  const [exit, setExit] = useState<{ x: number; y: number; rotate: number }>({ x: 0, y: 0, rotate: 0 });
  const [tucking, setTucking] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const cardW = Math.min(520, Math.max(260, size.width - 56));
  const cardH = Math.round(cardW * 0.62);

  const byId = useMemo(() => new Map(deck.map((highlight) => [highlight.id, highlight])), [deck]);
  const doneCount = Object.values(decisions).filter((decision) => decision !== "later").length;
  const kept = Object.values(decisions).filter((decision) => decision === "keep").length;
  const released = Object.values(decisions).filter((decision) => decision === "release").length;

  const decide = (decision: Decision) => {
    const top = queue[0];
    if (!top || tucking) return;
    setFlipped(false);
    if (decision === "later") {
      // Lift the card off the stack, then slide it in underneath.
      setTucking(top);
      setDecisions((current) => ({ ...current, [top]: "later" }));
      window.setTimeout(
        () => {
          // Slide it under the visible pile so the tuck is seen.
          setQueue((current) => {
            const rest = current.slice(1);
            const slot = Math.min(VISIBLE_DEPTH - 1, rest.length);
            return [...rest.slice(0, slot), current[0], ...rest.slice(slot)];
          });
          setTucking(null);
        },
        reducedMotion ? 0 : 260,
      );
      return;
    }
    const direction = decision === "keep" ? 1 : -1;
    setExit({ x: direction * (size.width / 2 + cardW), y: 40, rotate: direction * 28 });
    setDecisions((current) => ({ ...current, [top]: decision }));
    setQueue((current) => current.slice(1));
  };

  const reset = () => {
    setQueue(deck.map((highlight) => highlight.id));
    setDecisions({});
    setFlipped(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => decide("keep"),
      ArrowLeft: () => decide("release"),
      ArrowUp: () => decide("later"),
      " ": () => setFlipped((value) => !value),
    };
    const action = keys[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  };

  const visible = queue.slice(0, VISIBLE_DEPTH);
  const finished = queue.length === 0;

  return (
    <StageSurface tone="paper" className="relative size-full">
      <div
        ref={sizeRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="xp-desk absolute inset-0 overflow-hidden outline-none"
      >
        <div className="absolute inset-x-0 top-0 flex items-baseline justify-between p-5 md:p-7">
          <div>
            <p className="xp-smcp text-xs tracking-[0.22em] text-muted-foreground">Today’s seven</p>
            <p className="xp-serif mt-1 text-2xl italic">
              {new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
            </p>
          </div>
          <div className="flex items-center gap-1.5" aria-label={`${doneCount} of ${deck.length} sorted`}>
            {deck.map((highlight) => {
              const decision = decisions[highlight.id];
              return (
                <motion.span
                  key={highlight.id}
                  className="block h-1.5 rounded-full"
                  animate={{
                    width: queue[0] === highlight.id ? 16 : 6,
                    backgroundColor:
                      decision === "keep"
                        ? inkColor("green")
                        : decision === "release"
                          ? "var(--muted-foreground)"
                          : "var(--foreground)",
                    opacity: decision && decision !== "later" ? 0.9 : queue[0] === highlight.id ? 0.8 : 0.18,
                  }}
                  transition={SNAPPY_SPRING}
                />
              );
            })}
          </div>
        </div>

        <div className="absolute inset-x-0 top-[96px] bottom-[96px]">
          <AnimatePresence custom={exit}>
            {!finished &&
              visible
                .map((id, depth) => ({ id, depth }))
                .reverse()
                .map(({ id, depth }) => {
                  const highlight = byId.get(id);
                  if (!highlight) return null;
                  const seed = getStableNumber(id);
                  const restingRotate = ((seed % 7) - 3) * 1.6;
                  if (depth === 0 && tucking !== id) {
                    return (
                      <motion.div
                        key={id}
                        className="absolute inset-0"
                        style={{ zIndex: 20 }}
                        initial={{ y: 12, scale: 0.955, rotate: restingRotate }}
                        animate={{ y: 0, scale: 1, rotate: 0 }}
                        transition={SOFT_SPRING}
                        custom={exit}
                        exit="gone"
                        variants={{
                          gone: (target: typeof exit) => ({
                            x: target.x,
                            y: target.y,
                            rotate: target.rotate,
                            opacity: 0,
                            transition: { duration: reducedMotion ? 0 : 0.45, ease: [0.3, 0.6, 0.4, 1] },
                          }),
                        }}
                      >
                        <TopCard
                          highlight={highlight}
                          book={booksById.get(highlight.bookId)}
                          number={numbers.get(id) ?? 0}
                          flipped={flipped}
                          cardW={cardW}
                          cardH={cardH}
                          onDecide={decide}
                          onFlip={() => setFlipped((value) => !value)}
                        />
                      </motion.div>
                    );
                  }
                  const isTucking = tucking === id;
                  return (
                    <motion.div
                      key={id}
                      className="pointer-events-none absolute top-1/2 left-1/2"
                      style={{ width: cardW, height: cardH, marginLeft: -cardW / 2, marginTop: -cardH / 2, zIndex: isTucking ? 30 : 10 - depth }}
                      initial={{ opacity: 0, y: depth * 12 + 30, scale: 1 - depth * 0.045 }}
                      animate={
                        isTucking
                          ? { y: -cardH * 0.9, rotate: -4, scale: 0.98, opacity: 1 }
                          : { opacity: 1, y: depth * 12, scale: 1 - depth * 0.045, rotate: depth === 0 ? 0 : restingRotate }
                      }
                      exit={{ opacity: 0 }}
                      transition={isTucking ? { duration: 0.26, ease: EASE_OUT } : SOFT_SPRING}
                    >
                      <Tape color={highlight.color} seed={seed} />
                      <CardFace highlight={highlight} book={booksById.get(highlight.bookId)} number={numbers.get(id) ?? 0} side="front" />
                    </motion.div>
                  );
                })}
          </AnimatePresence>

          <AnimatePresence>
            {finished && (
              <motion.div
                key="done"
                className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
                initial={{ opacity: 0, scale: 0.96, filter: "blur(8px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.25 }}
              >
                <p className="xp-serif text-[clamp(2.4rem,6vw,4rem)] leading-none tracking-[-0.02em] italic">
                  That was today’s seven.
                </p>
                <p className="xp-serif mt-4 text-lg text-muted-foreground">
                  {kept} kept, {released} let go. They will come back in a few days.
                </p>
                <button
                  type="button"
                  onClick={reset}
                  className="mt-7 flex cursor-pointer items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background outline-none transition-transform active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <RotateCcw className="size-3.5" /> Deal again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!finished && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 p-6">
            {[
              { decision: "release" as const, label: "Let go", icon: X, hint: "←" },
              { decision: "later" as const, label: "Later", icon: ArrowUp, hint: "↑" },
              { decision: "keep" as const, label: "Keep", icon: Star, hint: "→" },
            ].map(({ decision, label, icon: Icon, hint }) => (
              <motion.button
                key={decision}
                type="button"
                onClick={() => decide(decision)}
                whileTap={{ scale: 0.9 }}
                whileHover={{ y: -2 }}
                transition={SNAPPY_SPRING}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border bg-background px-4 py-2.5 text-sm font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  decision === "keep" && "border-transparent bg-foreground text-background",
                )}
              >
                <Icon className="size-4" fill={decision === "keep" ? "currentColor" : "none"} />
                {label}
                <span className="font-mono text-[10px] opacity-50">{hint}</span>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </StageSurface>
  );
}
