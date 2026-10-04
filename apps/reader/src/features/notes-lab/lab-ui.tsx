import {
  AnimatePresence,
  motion,
  useReducedMotionConfig,
  type Transition,
} from "motion/react";
import { Copy, NotebookText, PenLine } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useLabScreen } from "./frames";
import { BOOK, chapterOf, CURRENT_CHAPTER, CURRENT_PAGE } from "./lab-content";
import {
  colorVar,
  EASE,
  SPRING_SOFT,
  type LabColor,
  type LabToastState,
  type LocalRect,
} from "./lab-model";

export const DESKTOP_PAGE = {
  top: 76,
  height: 628,
  /** Two-page spread, as Reader shows on wide screens. */
  spread: { left: 168, width: 944, gap: 64 },
  /** One page offset left to leave a working margin. */
  single: { left: 140, width: 580 },
};

/**
 * Reader-like page geometry. Text is laid out in fixed-height CSS columns, so a
 * page ends on a whole line and inserted content re-paginates like Reader.
 */
export function ReaderSurface({
  children,
  topRight,
  layout = "spread",
  pageStyle,
  bottomInset = 44,
  pageNumber = true,
  chapterTitle = true,
}: {
  children: (pageStyle: CSSProperties) => ReactNode;
  topRight?: ReactNode;
  layout?: "spread" | "single";
  pageStyle?: CSSProperties;
  /** Phone: space kept below the text for bottom controls. */
  bottomInset?: number;
  pageNumber?: boolean;
  /** Phone: the lab's own running head. Off when real Reader chrome is shown. */
  chapterTitle?: boolean;
}) {
  const { device } = useLabScreen();
  if (device === "desktop") {
    const geometry =
      layout === "spread" ? DESKTOP_PAGE.spread : DESKTOP_PAGE.single;
    return (
      <div className="absolute inset-0">
        <header className="absolute inset-x-0 top-0 z-20 flex h-12 items-center px-4">
          <span className="w-32" />
          <span className="mx-auto text-[10px] font-medium uppercase tracking-[0.26em] text-muted-foreground">
            {BOOK.title}
          </span>
          <div className="flex w-32 items-center justify-end gap-1">
            {topRight}
          </div>
        </header>
        <div
          className="absolute overflow-hidden"
          style={{
            top: DESKTOP_PAGE.top,
            left: geometry.left,
            width: geometry.width,
            height: DESKTOP_PAGE.height,
          }}
        >
          {children({
            height: DESKTOP_PAGE.height,
            columnFill: "auto",
            fontSize: 17,
            lineHeight: 1.62,
            ...(layout === "spread"
              ? { columnCount: 2, columnGap: DESKTOP_PAGE.spread.gap }
              : { columnWidth: geometry.width, columnGap: 120 }),
            ...pageStyle,
          })}
        </div>
        <footer
          className="absolute bottom-4 flex justify-around text-[11px] text-muted-foreground font-numeric tabular-nums"
          style={{ left: geometry.left, width: geometry.width }}
        >
          <span>{CURRENT_PAGE}</span>
          {layout === "spread" && <span>{CURRENT_PAGE + 1}</span>}
        </footer>
      </div>
    );
  }
  return (
    <div className="absolute inset-0">
      {chapterTitle && (
        <header
          className="absolute inset-x-0 flex h-9 items-center justify-center text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground"
          style={{ top: "var(--safe-top)" }}
        >
          {chapterOf(CURRENT_CHAPTER).title}
        </header>
      )}
      <div
        className="absolute inset-x-[26px] overflow-hidden"
        style={{
          top: "calc(var(--safe-top) + 44px)",
          bottom: `calc(var(--safe-bottom) + ${bottomInset}px)`,
        }}
      >
        <PhoneColumns pageStyle={pageStyle}>{children}</PhoneColumns>
      </div>
      {pageNumber && (
        <footer
          className="absolute inset-x-0 text-center text-[11px] text-muted-foreground font-numeric tabular-nums"
          style={{ bottom: "calc(var(--safe-bottom) + 14px)" }}
        >
          {CURRENT_PAGE}
        </footer>
      )}
    </div>
  );
}

function PhoneColumns({
  children,
  pageStyle,
}: {
  children: (pageStyle: CSSProperties) => ReactNode;
  pageStyle?: CSSProperties;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 338, height: 640 });
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="size-full">
      {children({
        height: size.height,
        columnWidth: size.width,
        columnGap: 80,
        columnFill: "auto",
        fontSize: 17,
        lineHeight: 1.6,
        ...pageStyle,
      })}
    </div>
  );
}

export function Swatch({
  color,
  size = 24,
  selected,
  onSelect,
  label,
  fill,
}: {
  color: LabColor;
  size?: number;
  selected?: boolean;
  onSelect: () => void;
  label?: string;
  /** Overrides the theme colour, e.g. with a page colour on an inverted surface. */
  fill?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label ?? `Highlight ${color}`}
      aria-pressed={selected}
      whileHover={{ scale: 1.12 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", bounce: 0.4, duration: 0.3 }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
        color === "invisible" &&
          "border border-dashed border-muted-foreground/60",
      )}
      style={{
        width: size,
        height: size,
        backgroundColor:
          color === "invisible" ? "transparent" : (fill ?? colorVar(color)),
        boxShadow:
          color === "invisible"
            ? undefined
            : "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)",
      }}
    >
      <AnimatePresence>
        {selected && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18, ease: EASE }}
            className="absolute -inset-[4px] rounded-full border-[1.5px] border-foreground/70"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

/**
 * Floating selection tools: highlight colours, note and copy. Placement keeps
 * the pill inside the screen and flips below the passage near the top edge.
 */
export function SelectionPill({
  anchor,
  current,
  onColor,
  onNote,
  onCopy,
  className,
}: {
  anchor: LocalRect;
  current?: LabColor;
  onColor: (color: LabColor) => void;
  onNote: () => void;
  onCopy?: () => void;
  className?: string;
}) {
  const { device, screen } = useLabScreen();
  const pill = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{
    left: number;
    top: number;
    below: boolean;
  } | null>(null);
  const phone = device === "phone";
  useLayoutEffect(() => {
    const element = pill.current;
    const container = screen.current;
    if (!element || !container) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const safeTop = phone ? 64 : 56;
    const left = Math.min(
      Math.max(12, anchor.x + anchor.width / 2 - width / 2),
      container.offsetWidth - width - 12,
    );
    const above = anchor.y - height - 12;
    const below = above < safeTop;
    setPlacement({
      left,
      top: below ? anchor.y + anchor.height + 12 : above,
      below,
    });
  }, [anchor, phone, screen]);
  return (
    <motion.div
      ref={pill}
      role="toolbar"
      aria-label="Selection tools"
      initial={{ opacity: 0, scale: 0.94, y: 6, filter: "blur(4px)" }}
      animate={{
        opacity: placement ? 1 : 0,
        scale: 1,
        y: 0,
        filter: "blur(0px)",
      }}
      exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)" }}
      transition={{ duration: 0.2, ease: EASE }}
      className={cn(
        "absolute z-40 flex items-center rounded-full border border-border/80 bg-popover/95 text-popover-foreground shadow-[0_10px_30px_-8px_color-mix(in_srgb,var(--foreground)_22%,transparent)] backdrop-blur-xl",
        phone ? "gap-2.5 py-2 pr-2 pl-3" : "gap-2 py-1.5 pr-1.5 pl-2.5",
        className,
      )}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        transformOrigin: placement?.below ? "center top" : "center bottom",
      }}
    >
      {HIGHLIGHT_COLORS.map(({ name }) => (
        <Swatch
          key={name}
          color={name}
          size={phone ? 28 : 22}
          selected={current === name}
          onSelect={() => onColor(name)}
        />
      ))}
      <span className="mx-0.5 h-5 w-px bg-border" />
      {onCopy && (
        <PillButton label="Copy" onClick={onCopy}>
          <Copy className="size-4" />
        </PillButton>
      )}
      <PillButton label="Note" onClick={onNote} wide={phone}>
        <PenLine className="size-4" />
        {phone && <span className="text-[13px] font-medium">Note</span>}
      </PillButton>
    </motion.div>
  );
}

function PillButton({
  label,
  onClick,
  children,
  wide,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.94 }}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        wide ? "px-3" : "w-8",
      )}
    >
      {children}
    </motion.button>
  );
}

export function LabToast({
  toast,
  bottom = 24,
}: {
  toast: LabToastState | null;
  bottom?: number;
}) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          role="status"
          initial={{ opacity: 0, y: 14, scale: 0.96, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(2px)" }}
          transition={{ duration: 0.26, ease: EASE }}
          className="absolute left-1/2 z-[55] flex -translate-x-1/2 items-center gap-3 rounded-full bg-primary py-2 pr-2 pl-4 text-[13px] whitespace-nowrap text-primary-foreground shadow-lg"
          style={{ bottom: `calc(var(--safe-bottom) + ${bottom}px)` }}
        >
          {toast.message}
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.run}
              className="rounded-full bg-primary-foreground/15 px-3 py-1 font-medium hover:bg-primary-foreground/25"
            >
              {toast.action.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Notebook entry point whose count pops when a note lands. */
export function NotebookButton({
  count,
  onClick,
  bump,
  ref,
  className,
}: {
  count: number;
  onClick: () => void;
  bump?: number;
  ref?: RefObject<HTMLButtonElement | null>;
  className?: string;
}) {
  return (
    <motion.button
      ref={ref}
      type="button"
      aria-label={`Notebook, ${count} entries`}
      onClick={onClick}
      key={bump}
      initial={bump ? { scale: 1 } : false}
      animate={bump ? { scale: [1, 1.22, 0.96, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: EASE, times: [0, 0.35, 0.7, 1] }}
      className={cn(
        "relative flex h-9 items-center gap-1.5 rounded-full px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
    >
      <NotebookText className="size-[18px]" />
      <AnimatedNumber
        value={count}
        variant="pop"
        className="text-xs font-medium font-numeric tabular-nums"
      />
    </motion.button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[5px] border border-border bg-secondary/60 px-1 py-px font-sans text-[10px] text-muted-foreground">
      {children}
    </kbd>
  );
}

/**
 * A surface that animates its own size to the natural size of its current
 * layer, so one object can become a palette, a composer or a sheet in place.
 * Explicit width and height (not layout projection) keep the morph correct
 * inside a scaled device frame. The first size is applied without a morph:
 * a surface that appears never grows out of a previous shape.
 */
export function MorphSurface({
  layerKey,
  radius,
  anchor = "center",
  transition = SPRING_SOFT,
  className,
  children,
}: {
  layerKey: string;
  radius: number;
  /** Where the content stays pinned while the surface changes size. */
  anchor?: "center" | "right";
  transition?: Transition;
  className?: string;
  children: ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layerKey]);
  // Morph only after the first measured size has been applied.
  useEffect(() => {
    if (size && !settled) setSettled(true);
  }, [size, settled]);
  return (
    <motion.div
      className={cn("pointer-events-auto relative overflow-hidden", className)}
      initial={false}
      animate={
        size
          ? { width: size.width, height: size.height, borderRadius: radius }
          : { borderRadius: radius }
      }
      transition={!settled || reduced ? { duration: 0 } : transition}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={layerKey}
          ref={layer}
          className={cn(
            "absolute bottom-0 w-max",
            anchor === "center" ? "left-1/2 -translate-x-1/2" : "right-0",
          )}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{
            opacity: 0,
            filter: "blur(4px)",
            transition: { duration: 0.12, ease: EASE },
          }}
          transition={{ duration: 0.24, ease: EASE, delay: 0.05 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
