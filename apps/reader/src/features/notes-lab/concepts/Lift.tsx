import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { FauxKeyboard, useLabScreen, useSampleSelection } from "../frames";
import { NotebookPanel, splitQuote, type JournalOrder } from "../JournalList";
import {
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  colorVar,
  EASE,
  SPRING_SOFT,
  toLocal,
  useLabNotes,
  useLabToast,
  useMarkGeometry,
  type LabColor,
  type LabSelection,
  type LocalRect,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import {
  Kbd,
  LabToast,
  NotebookButton,
  ReaderSurface,
  SelectionPill,
  Swatch,
} from "../lab-ui";

interface LiftState {
  selection: LabSelection;
  origin: LocalRect;
  color: LabColor;
  phase: "open" | "fly" | "return";
}

/**
 * Lift: the chosen passage rises off the page into a writing card while the
 * page recedes. Saving sends the card into the notebook along an arc.
 */
export function Lift() {
  const { device, screen } = useLabScreen();
  const phone = device === "phone";
  const { notes, add } = useLabNotes(seedNotes);
  const toast = useLabToast(2400);
  const [selection, setSelection] = useState<LabSelection | null>(null);
  const [lift, setLift] = useState<LiftState | null>(null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<LocalRect | null>(null);
  const [landed, setLanded] = useState(false);
  const [bump, setBump] = useState(0);
  const [notebook, setNotebook] = useState(false);
  const [order, setOrder] = useState<JournalOrder>("book");
  const [flight, setFlight] = useState<{ x: number; y: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Exit animations also report completion; only the flight itself may land.
  const inFlight = useRef(false);
  // Reduced motion keeps the focus change but drops travel: no lift, no flight.
  const reduced = useReducedMotionConfig();
  const geometry = useMarkGeometry(
    screen,
    selection ? "pending" : null,
    selection,
  );
  useSampleSelection((sample) => {
    if (lift) return;
    setNotebook(false);
    setSelection(sample);
  });

  const marks: PageMark[] = notes
    .filter((note) => note.range && note.range.end > note.range.start)
    .map((note) => ({ id: note.id, ...note.range!, color: note.color }));
  if (selection)
    marks.push({ id: "pending", color: "pending", ...selection.range });
  if (lift)
    marks.push({ id: "lifted", color: "pending", ...lift.selection.range });

  function highlight(color: LabColor) {
    if (!selection) return;
    add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color,
      quote: selection.text,
      text: "",
      range: selection.range,
    });
    setSelection(null);
  }

  function startLift() {
    if (!selection || !geometry) return;
    setLift({
      selection,
      origin: geometry.box,
      color: "yellow",
      phase: "open",
    });
    setSelection(null);
    setText("");
    setTarget(null);
    setLanded(Boolean(reduced));
  }

  function save() {
    if (
      !lift ||
      !text.trim() ||
      !card.current ||
      !button.current ||
      !screen.current
    )
      return;
    const cardRect = toLocal(
      card.current.getBoundingClientRect(),
      screen.current,
    );
    const buttonRect = toLocal(
      button.current.getBoundingClientRect(),
      screen.current,
    );
    setFlight({
      x:
        buttonRect.x + buttonRect.width / 2 - (cardRect.x + cardRect.width / 2),
      y:
        buttonRect.y +
        buttonRect.height / 2 -
        (cardRect.y + cardRect.height / 2),
    });
    inFlight.current = true;
    if (reduced) {
      land();
      return;
    }
    setLift({ ...lift, phase: "fly" });
  }

  function land() {
    if (!lift || !inFlight.current) return;
    inFlight.current = false;
    add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color: lift.color,
      quote: lift.selection.text,
      text: text.trim(),
      range: lift.selection.range,
    });
    setBump((value) => value + 1);
    setLift(null);
    setFlight(null);
  }

  const open = lift?.phase === "open";
  const ghostRect =
    lift?.phase === "return" || !target || !open ? lift?.origin : target;

  function putBack() {
    if (!lift) return;
    if (reduced) {
      setLift(null);
      return;
    }
    setLanded(false);
    setLift({ ...lift, phase: "return" });
  }
  const accent = (color: LabColor) =>
    color === "invisible"
      ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
      : `color-mix(in srgb, ${colorVar(color)} 70%, transparent)`;

  const notebookButton = (
    <NotebookButton
      ref={button}
      count={notes.length}
      bump={bump}
      onClick={() => setNotebook(true)}
    />
  );

  return (
    <div className="absolute inset-0">
      <motion.div
        className="absolute inset-0 origin-[50%_40%]"
        animate={
          open
            ? {
                scale: phone ? 0.94 : 0.975,
                opacity: 0.38,
                filter: "blur(1.5px)",
              }
            : { scale: 1, opacity: 1, filter: "blur(0px)" }
        }
        transition={{ duration: 0.5, ease: EASE }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("[role=toolbar]")) return;
          if (selection && !(event.target as HTMLElement).closest("mark"))
            setSelection(null);
        }}
      >
        <ReaderSurface topRight={notebookButton}>
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              marks={marks}
              style={pageStyle}
              selectable={!lift}
              onSelect={(next) => {
                if (lift) return;
                setSelection(next);
              }}
            />
          )}
        </ReaderSurface>
      </motion.div>
      {phone && (
        <div
          className="absolute right-2 z-20"
          style={{ top: "calc(var(--safe-top) - 2px)" }}
        >
          {notebookButton}
        </div>
      )}

      {/* Captures taps on the receded page while writing. */}
      {open && (
        <button
          type="button"
          aria-label="Put the passage back"
          className="absolute inset-0 z-30 cursor-default"
          onClick={putBack}
        />
      )}

      <AnimatePresence>
        {selection && geometry && !lift && (
          <SelectionPill
            anchor={geometry.box}
            onColor={highlight}
            onNote={startLift}
          />
        )}
      </AnimatePresence>

      {/* The lifted highlight travels between the page and the card. */}
      <AnimatePresence>
        {lift && ghostRect && lift.phase !== "fly" && (
          <motion.div
            key="ghost"
            aria-hidden
            className="pointer-events-none absolute z-40 rounded-[6px]"
            initial={{
              left: lift.origin.x - 2,
              top: lift.origin.y - 2,
              width: lift.origin.width + 4,
              height: lift.origin.height + 4,
              opacity: 1,
            }}
            animate={{
              left: ghostRect.x,
              top: ghostRect.y,
              width: ghostRect.width,
              height: ghostRect.height,
              opacity: landed ? 0 : 1,
              boxShadow:
                lift.phase === "return" || landed
                  ? "0 0px 0px -12px color-mix(in srgb, var(--foreground) 0%, transparent)"
                  : "0 18px 30px -12px color-mix(in srgb, var(--foreground) 35%, transparent)",
            }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{
              ...SPRING_SOFT,
              opacity: { duration: 0.22, ease: EASE },
            }}
            style={{ background: accent(lift.color) }}
            onAnimationComplete={() => {
              if (lift.phase === "return") {
                setLift(null);
                return;
              }
              if (target && !landed) setLanded(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lift && lift.phase !== "return" && (
          <motion.div
            key="card"
            ref={card}
            role="dialog"
            aria-label="Write a note"
            className={cn(
              "absolute z-40 rounded-[26px] border border-border/70 bg-background p-4 shadow-[0_30px_60px_-20px_color-mix(in_srgb,var(--foreground)_35%,transparent)]",
              phone ? "inset-x-4" : "w-[560px]",
            )}
            style={{
              top: phone ? "calc(var(--safe-top) + 44px)" : 104,
              left: phone ? undefined : "calc(50% - 280px)",
            }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={
              lift.phase === "fly" && flight
                ? {
                    x: [0, flight.x * 0.35, flight.x],
                    y: [0, flight.y * 0.2 - 60, flight.y],
                    scale: [1, 0.82, 0.05],
                    rotate: [0, -3, -8],
                    opacity: [1, 1, 0],
                  }
                : { opacity: 1, y: 0, scale: 1 }
            }
            exit={{
              opacity: 0,
              y: 10,
              scale: 0.98,
              transition: { duration: 0.2 },
            }}
            transition={
              lift.phase === "fly"
                ? {
                    duration: 0.68,
                    ease: [0.45, 0, 0.2, 1],
                    times: [0, 0.4, 1],
                  }
                : { duration: 0.36, ease: EASE, delay: 0.08 }
            }
            onAnimationComplete={() => {
              if (lift.phase === "fly") land();
            }}
          >
            <LiftCard
              phone={phone}
              quote={lift.selection.text}
              color={lift.color}
              landed={landed}
              text={text}
              onText={setText}
              onColor={(color) => setLift({ ...lift, color })}
              onMeasureQuote={(rect) => setTarget(rect)}
              onSave={save}
              onCancel={putBack}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <NotebookPanel
        open={notebook}
        phone={phone}
        order={order}
        onOrder={setOrder}
        notes={notes}
        onClose={() => setNotebook(false)}
        onOpenEntry={(page) => {
          setNotebook(false);
          if (page !== CURRENT_PAGE) toast.show(`Opens page ${page}`);
        }}
      />
      {phone && <FauxKeyboard open={open} />}
      <LabToast toast={toast.toast} bottom={phone ? 30 : 24} />
    </div>
  );
}

function LiftCard({
  phone,
  quote,
  color,
  landed,
  text,
  onText,
  onColor,
  onMeasureQuote,
  onSave,
  onCancel,
}: {
  phone: boolean;
  quote: string;
  color: LabColor;
  landed: boolean;
  text: string;
  onText: (text: string) => void;
  onColor: (color: LabColor) => void;
  onMeasureQuote: (rect: LocalRect) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const quoteBox = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const { mark, body } = splitQuote(quote);

  // Offsets ignore the card's entrance transform, so this is the resting
  // position the lifted passage should land on.
  const measureQuote = useEffectEvent(() => {
    const quote = quoteBox.current;
    const card = quote?.offsetParent as HTMLElement | null;
    if (!quote || !card) return;
    onMeasureQuote({
      x: card.offsetLeft + card.clientLeft + quote.offsetLeft,
      y: card.offsetTop + card.clientTop + quote.offsetTop,
      width: quote.offsetWidth,
      height: quote.offsetHeight,
    });
  });
  useLayoutEffect(() => {
    // The quote position is fixed for the life of this card.
    measureQuote();
    input.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(phone ? 72 : 88, element.scrollHeight)}px`;
  }, [text, phone]);

  const tint =
    color === "invisible"
      ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
      : `color-mix(in srgb, ${colorVar(color)} 70%, transparent)`;

  return (
    <div>
      <div
        ref={quoteBox}
        className="relative rounded-[6px] px-3 py-2.5 transition-colors duration-300"
        style={{ background: landed ? tint : "transparent" }}
      >
        <motion.blockquote
          initial={{ opacity: 0 }}
          animate={{ opacity: landed ? 1 : 0 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="relative pl-[0.7em] text-[16px] leading-[1.5] text-foreground"
          style={{ fontFamily: "Lora, serif" }}
        >
          <span aria-hidden className="absolute top-0 left-[-0.15em]">
            {mark}
          </span>
          {body}
        </motion.blockquote>
      </div>
      <textarea
        ref={input}
        aria-label="Your thought"
        value={text}
        placeholder="What does this make you think?"
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onSave();
          }
        }}
        className="mt-3 block w-full resize-none bg-transparent px-1 text-[16px] leading-[1.5] text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex items-center gap-2">
        {[
          ...HIGHLIGHT_COLORS.map(({ name }) => name),
          "invisible" as const,
        ].map((value) => (
          <Swatch
            key={value}
            color={value}
            size={18}
            selected={color === value}
            label={value === "invisible" ? "No highlight" : undefined}
            onSelect={() => onColor(value)}
          />
        ))}
        {!phone && (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <Kbd>esc</Kbd> puts it back
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "h-8 rounded-full px-3 text-[13px] text-muted-foreground hover:bg-secondary",
            phone && "ml-auto",
          )}
        >
          Cancel
        </button>
        <motion.button
          type="button"
          disabled={!text.trim()}
          onClick={onSave}
          animate={{ opacity: text.trim() ? 1 : 0.4 }}
          whileTap={{ scale: 0.95 }}
          className="h-8 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground"
        >
          Save
        </motion.button>
      </div>
    </div>
  );
}
