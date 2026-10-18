import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import { ChevronLeft } from "lucide-react";
import { BottomSheet } from "./ui/bottom-sheet";
import { Button } from "./ui/button";

function SheetPage({
  children,
  direction,
}: {
  children: ReactNode;
  direction: number;
}) {
  const present = useIsPresent();
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!present) return;
    // A page can name the control that should take focus, such as a field.
    const target =
      ref.current?.querySelector<HTMLElement>("[data-sheet-autofocus]") ??
      ref.current;
    target?.focus({ preventScroll: true });
  }, [present]);
  return (
    <motion.div
      data-sheet-page=""
      ref={ref}
      custom={direction}
      tabIndex={-1}
      inert={!present}
      aria-hidden={!present || undefined}
      className="absolute inset-0 flex min-h-0 flex-col outline-none"
      variants={{
        enter: (direction: number) => ({
          opacity: 0,
          transform: `translateX(${reduceMotion ? 0 : direction * 8}px)`,
        }),
        active: { opacity: 1, transform: "translateX(0px)" },
        exit: (direction: number) => ({
          opacity: 0,
          transform: `translateX(${reduceMotion ? 0 : -direction * 8}px)`,
        }),
      }}
      initial="enter"
      animate="active"
      exit="exit"
      transition={{
        duration: reduceMotion ? 0.12 : 0.2,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

/** One drawer owns focus and dismissal while its pages move together. Closing
 * retains the last page, so the launcher does not flash during the drawer exit. */
export function SlidingSheet({
  open,
  onClose,
  page,
  rootPage,
  title,
  onBack,
  children,
}: {
  open: boolean;
  onClose: () => void;
  page: string;
  rootPage: string;
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const [display, setDisplay] = useState({ page, title, children });
  if (
    open &&
    (display.page !== page ||
      display.children !== children ||
      display.title !== title)
  ) {
    setDisplay({ page, title, children });
  }
  const current = open ? { page, title, children } : display;
  const direction = current.page === rootPage ? -1 : 1;
  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={current.title}
      showHeader={false}
      panelClassName="max-w-md h-[min(36rem,80dvh)]"
      bodyClassName="relative overflow-hidden"
    >
      <AnimatePresence initial={false} custom={direction}>
        <SheetPage key={current.page} direction={direction}>
          <div className="grid h-10 shrink-0 grid-cols-[2rem_1fr_2rem] items-center gap-3 px-4">
            {current.page !== rootPage ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onBack}
                aria-label={
                  rootPage === "tools"
                    ? "Back to reader tools"
                    : "Back to navigation"
                }
                className="size-8 rounded-full border border-border/60 bg-secondary/20"
              >
                <ChevronLeft className="size-4" />
              </Button>
            ) : (
              <div />
            )}
            <p className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {current.title}
            </p>
            <div />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)]">
            {current.children}
          </div>
        </SheetPage>
      </AnimatePresence>
    </BottomSheet>
  );
}
