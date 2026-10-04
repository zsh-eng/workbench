import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, PenLine, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import {
  FauxKeyboard,
  KEYBOARD_HEIGHT,
  useLabScreen,
  useSampleSelection,
} from "../frames";
import { NotebookPanel, type JournalOrder } from "../JournalList";
import {
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  colorVar,
  EASE,
  EASE_SHEET,
  scaleOf,
  sentenceAtPoint,
  SPRING_SNAP,
  useLabNotes,
  useLabToast,
  type LabSelection,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { LabToast, NotebookButton, ReaderSurface } from "../lab-ui";

const HOLD_MS = 380;
const RADIUS = 82;
const DEAD_ZONE = 26;

type ItemId = (typeof HIGHLIGHT_COLORS)[number]["name"] | "note";
const ITEMS: ItemId[] = ["yellow", "green", "blue", "magenta", "note"];

interface Menu {
  selection: LabSelection;
  /** Menu centre in screen coordinates. */
  x: number;
  y: number;
  /** Arc opens downward near the top edge. */
  flip: boolean;
  /** Released without choosing: the menu waits for a tap. */
  sticky: boolean;
}

/**
 * Arc: press and hold a sentence. A marking menu opens around the thumb; drag
 * toward an action and release. Repeated use turns into a flick.
 */
export function Arc() {
  const { screen, bare } = useLabScreen();
  const { notes, add } = useLabNotes(seedNotes);
  const toast = useLabToast(2400);
  const [press, setPress] = useState<{
    x: number;
    y: number;
    key: number;
  } | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [hot, setHot] = useState<ItemId | null>(null);
  const [chosen, setChosen] = useState<ItemId | null>(null);
  const [composer, setComposer] = useState<{
    selection: LabSelection;
    text: string;
  } | null>(null);
  const [learned, setLearned] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [order, setOrder] = useState<JournalOrder>("book");
  const [bump, setBump] = useState(0);
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useSampleSelection((selection) => {
    setComposer(null);
    const geometry = document
      .querySelector(`[data-paragraph="${selection.range.paragraph}"]`)
      ?.getBoundingClientRect();
    const root = screen.current;
    if (!root || !geometry) return;
    const origin = root.getBoundingClientRect();
    const scale = scaleOf(root);
    openMenu(
      selection,
      (geometry.left + geometry.width / 2 - origin.left) / scale,
      (geometry.top + 40 - origin.top) / scale,
      true,
    );
  });

  const marks: PageMark[] = notes
    .filter((note) => note.range && note.range.end > note.range.start)
    .map((note) => ({ id: note.id, ...note.range!, color: note.color }));
  const pending = menu?.selection ?? composer?.selection;
  if (pending)
    marks.push({ id: "pending", color: "pending", ...pending.range });

  function local(clientX: number, clientY: number) {
    const root = screen.current!;
    const origin = root.getBoundingClientRect();
    const scale = scaleOf(root);
    return {
      x: (clientX - origin.left) / scale,
      y: (clientY - origin.top) / scale,
    };
  }

  function openMenu(
    selection: LabSelection,
    x: number,
    y: number,
    sticky: boolean,
  ) {
    const width = screen.current?.offsetWidth ?? 390;
    setMenu({
      selection,
      x: Math.min(Math.max(x, RADIUS + 24), width - RADIUS - 24),
      y,
      flip: y < 190,
      sticky,
    });
    setHot(null);
    setChosen(null);
    setLearned(true);
    navigator.vibrate?.(8);
  }

  function angleOf(index: number, flip: boolean) {
    // Five stops across the upper half circle, left to right.
    const degrees = 162 - index * 36;
    return ((flip ? -degrees : degrees) * Math.PI) / 180;
  }

  function itemAt(x: number, y: number) {
    if (!menu) return null;
    const dx = x - menu.x;
    const dy = menu.y - y;
    if (Math.hypot(dx, dy) < DEAD_ZONE) return null;
    const pointer = Math.atan2(dy, dx);
    let best: ItemId | null = null;
    let distance = Infinity;
    ITEMS.forEach((item, index) => {
      const angle = angleOf(index, menu.flip);
      const delta = Math.abs(
        Math.atan2(Math.sin(pointer - angle), Math.cos(pointer - angle)),
      );
      if (delta < distance) {
        distance = delta;
        best = item;
      }
    });
    return distance < 0.6 ? best : null;
  }

  function commit(item: ItemId) {
    if (!menu) return;
    setChosen(item);
    const selection = menu.selection;
    setTimeout(() => {
      setMenu(null);
      setHot(null);
      if (item === "note") {
        setComposer({ selection, text: "" });
        return;
      }
      add({
        chapter: CURRENT_CHAPTER,
        page: CURRENT_PAGE,
        color: item,
        quote: selection.text,
        text: "",
        range: selection.range,
      });
      setBump((value) => value + 1);
    }, 220);
  }

  function cancelPress() {
    if (gesture.current) clearTimeout(gesture.current.timer);
    gesture.current = null;
    setPress(null);
  }

  function send() {
    if (!composer?.text.trim()) return;
    add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color: "invisible",
      quote: composer.selection.text,
      text: composer.text.trim(),
      range: composer.selection.range,
    });
    setComposer(null);
    setBump((value) => value + 1);
    toast.show("Note saved");
  }

  const keyboard = composer && !bare ? KEYBOARD_HEIGHT : 0;

  return (
    <div className="absolute inset-0 [-webkit-touch-callout:none]">
      <div
        className="absolute inset-0 touch-pan-y"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          if (menu?.sticky) {
            setMenu(null);
            return;
          }
          if (composer) {
            setComposer(null);
            return;
          }
          const point = local(event.clientX, event.clientY);
          const { clientX, clientY, pointerId } = event;
          const target = event.currentTarget;
          setPress({ ...point, key: Date.now() });
          gesture.current = {
            id: pointerId,
            startX: clientX,
            startY: clientY,
            timer: setTimeout(() => {
              setPress(null);
              const selection = sentenceAtPoint(clientX, clientY, PARAGRAPHS);
              if (!selection) {
                gesture.current = null;
                return;
              }
              try {
                target.setPointerCapture(pointerId);
              } catch {
                // The pointer may already be gone; the menu then waits for a tap.
              }
              openMenu(selection, point.x, point.y, false);
            }, HOLD_MS),
          };
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          if (!menu) {
            if (
              Math.hypot(
                event.clientX - active.startX,
                event.clientY - active.startY,
              ) > 8
            )
              cancelPress();
            return;
          }
          const point = local(event.clientX, event.clientY);
          setHot(itemAt(point.x, point.y));
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (!active || active.id !== event.pointerId) return;
          cancelPress();
          if (!menu) return;
          const point = local(event.clientX, event.clientY);
          const item = itemAt(point.x, point.y);
          if (item) commit(item);
          else setMenu({ ...menu, sticky: true });
        }}
        onPointerCancel={() => {
          cancelPress();
          if (menu && !menu.sticky) setMenu(null);
        }}
      >
        <ReaderSurface>
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              marks={marks}
              style={pageStyle}
              selectable={false}
            />
          )}
        </ReaderSurface>
      </div>

      <div
        className="absolute right-2 z-20"
        style={{ top: "calc(var(--safe-top) - 2px)" }}
      >
        <NotebookButton
          count={notes.length}
          bump={bump}
          onClick={() => setNotebook(true)}
        />
      </div>

      {/* Hold progress under the finger. */}
      <AnimatePresence>
        {press && (
          <motion.svg
            key={press.key}
            aria-hidden
            viewBox="0 0 56 56"
            className="pointer-events-none absolute z-30 size-14 -rotate-90"
            style={{ left: press.x - 28, top: press.y - 28 }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.3, transition: { duration: 0.2 } }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            <circle
              cx="28"
              cy="28"
              r="22"
              className="fill-foreground/5 stroke-foreground/10"
              strokeWidth="3"
            />
            <motion.circle
              cx="28"
              cy="28"
              r="22"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              className="stroke-foreground/60"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: HOLD_MS / 1000, ease: "linear" }}
            />
          </motion.svg>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menu && (
          <motion.div
            key="menu"
            className="pointer-events-none absolute inset-0 z-40"
            exit={{ opacity: 0, transition: { duration: 0.2, delay: 0.05 } }}
          >
            <motion.div
              className="absolute size-3 rounded-full bg-foreground/25"
              style={{ left: menu.x - 6, top: menu.y - 6 }}
              initial={{ scale: 0 }}
              animate={{ scale: chosen ? 0 : 1 }}
              transition={SPRING_SNAP}
            />
            <svg
              aria-hidden
              className="absolute inset-0 size-full overflow-visible"
            >
              <motion.path
                d={describeArc(menu.x, menu.y, RADIUS, menu.flip)}
                fill="none"
                strokeWidth={46}
                strokeLinecap="round"
                className="stroke-background/85"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: chosen ? 0 : 1, opacity: 1 }}
                transition={{ duration: 0.32, ease: EASE }}
                style={{
                  filter:
                    "drop-shadow(0 8px 18px color-mix(in srgb, var(--foreground) 22%, transparent))",
                }}
              />
            </svg>
            {ITEMS.map((item, index) => {
              const angle = angleOf(index, menu.flip);
              const x = Math.cos(angle) * RADIUS;
              const y = -Math.sin(angle) * RADIUS;
              const isHot = hot === item;
              const isChosen = chosen === item;
              return (
                <motion.div
                  key={item}
                  className="pointer-events-auto absolute"
                  style={{ left: menu.x - 19, top: menu.y - 19 }}
                  initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                  animate={
                    chosen
                      ? isChosen
                        ? { x, y, scale: [1.25, 1.5], opacity: [1, 0] }
                        : { x: x * 0.6, y: y * 0.6, scale: 0.4, opacity: 0 }
                      : { x, y, scale: isHot ? 1.22 : 1, opacity: 1 }
                  }
                  transition={
                    chosen
                      ? { duration: 0.22, ease: EASE }
                      : { ...SPRING_SNAP, delay: hot ? 0 : index * 0.025 }
                  }
                >
                  <button
                    type="button"
                    aria-label={
                      item === "note" ? "Write a note" : `Highlight ${item}`
                    }
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => commit(item)}
                    className={cn(
                      "flex size-[38px] items-center justify-center rounded-full transition-shadow duration-150",
                      item === "note" && "bg-primary text-primary-foreground",
                      isHot &&
                        "shadow-[0_0_0_3px_var(--background),0_0_0_5px_var(--foreground)]",
                    )}
                    style={
                      item === "note"
                        ? undefined
                        : {
                            background: colorVar(item),
                            boxShadow: isHot
                              ? undefined
                              : "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent)",
                          }
                    }
                  >
                    {item === "note" && <PenLine className="size-4" />}
                  </button>
                  <AnimatePresence>
                    {isHot && (
                      <motion.span
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12 }}
                        className={cn(
                          "absolute left-1/2 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-primary-foreground capitalize",
                          menu.flip ? "top-11" : "-top-7",
                        )}
                      >
                        {item === "note" ? "Note" : item}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!learned && !menu && !composer && (
          <motion.div
            key="hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.3, ease: EASE, delay: 0.4 }}
            className="pointer-events-none absolute inset-x-0 z-20 flex justify-center"
            style={{ bottom: "calc(var(--safe-bottom) + 40px)" }}
          >
            <span className="flex items-center gap-2.5 rounded-full bg-primary py-2 pr-4 pl-2.5 text-[12.5px] text-primary-foreground shadow-lg">
              <span className="relative flex size-5 items-center justify-center">
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-primary-foreground/70"
                  animate={{ scale: [0.6, 1.25], opacity: [1, 0] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeOut",
                  }}
                />
                <span className="size-2 rounded-full bg-primary-foreground" />
              </span>
              Press and hold a sentence
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {composer && (
          <DockComposer
            key="composer"
            bottom={keyboard}
            quote={composer.selection.text}
            text={composer.text}
            onText={(text) => setComposer({ ...composer, text })}
            onSend={send}
            onClose={() => setComposer(null)}
          />
        )}
      </AnimatePresence>

      <NotebookPanel
        open={notebook}
        phone
        order={order}
        onOrder={setOrder}
        notes={notes}
        onClose={() => setNotebook(false)}
        onOpenEntry={(page) => {
          setNotebook(false);
          if (page !== CURRENT_PAGE) toast.show(`Opens page ${page}`);
        }}
      />
      <FauxKeyboard open={Boolean(composer)} />
      <LabToast toast={toast.toast} bottom={40} />
    </div>
  );
}

function describeArc(x: number, y: number, radius: number, flip: boolean) {
  const start = (162 * Math.PI) / 180;
  const end = (18 * Math.PI) / 180;
  const sign = flip ? 1 : -1;
  const sx = x + Math.cos(start) * radius;
  const sy = y + sign * Math.sin(start) * radius;
  const ex = x + Math.cos(end) * radius;
  const ey = y + sign * Math.sin(end) * radius;
  return `M ${sx} ${sy} A ${radius} ${radius} 0 0 ${flip ? 0 : 1} ${ex} ${ey}`;
}

/** The current mobile composer, refined: one quiet bar that rides the keyboard. */
function DockComposer({
  bottom,
  quote,
  text,
  onText,
  onSend,
  onClose,
}: {
  bottom: number;
  quote: string;
  text: string;
  onText: (text: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = text.trim().length > 0;
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }, [text]);
  return (
    <motion.div
      className="absolute inset-x-0 z-[51] border-t border-border/70 bg-background/92 px-3 pt-2 pb-2 backdrop-blur-xl"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1, bottom }}
      exit={{ y: 40, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ duration: 0.42, ease: EASE_SHEET }}
      style={{ bottom }}
    >
      <div className="mx-1 mb-1.5 flex items-center gap-2">
        <span className="h-7 w-[3px] rounded-full bg-muted-foreground/60" />
        <p
          className="line-clamp-2 flex-1 text-[12.5px] leading-snug text-muted-foreground italic"
          style={{ fontFamily: "Lora, serif" }}
        >
          {quote}
        </p>
        <button
          type="button"
          aria-label="Discard note"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-end gap-2 rounded-[22px] border border-border/80 bg-background py-1 pr-1 pl-3.5">
        <textarea
          ref={input}
          rows={1}
          aria-label="Write a note"
          value={text}
          placeholder="Write a note…"
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSend();
            }
          }}
          className="min-h-8 flex-1 resize-none bg-transparent py-1 text-[16px] leading-6 outline-none placeholder:text-muted-foreground"
        />
        <motion.button
          type="button"
          aria-label="Save note"
          disabled={!ready}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onSend}
          animate={{ scale: ready ? 1 : 0.7, opacity: ready ? 1 : 0 }}
          transition={SPRING_SNAP}
          className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <ArrowUp className="size-[18px]" strokeWidth={2.4} />
        </motion.button>
      </div>
    </motion.div>
  );
}
