import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Heading } from "react-aria-components/Dialog";
import {
  Sheet as AriaSheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components/Sheet";
import "./sheet.css";

export type SheetProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Names the sheet for assistive technology; shown when `heading` is set. */
  title: string;
  heading?: boolean;
  /**
   * Visible heights where the sheet rests, smallest first: pixels, or a
   * percentage of the sheet. It opens at the first and can always be dragged
   * to full height. Omit them for a sheet that fits its content.
   *
   * The phone keyboard would cover a lower detent, so a sheet with detents
   * opens at full height when its content names a field to focus
   * (`data-sheet-autofocus`), rises to full height when a field takes focus,
   * and puts the keyboard away when it is dragged lower.
   */
  snapPoints?: (number | string)[];
  /** Dims the page. A sheet that changes the page, as Text does, leaves it in view. */
  dim?: boolean;
  /** Takes the screen below the status bar, for a field the keyboard would cover. */
  tall?: boolean;
  children: ReactNode;
};

/**
 * A bottom sheet on React Aria's Sheet, after the EPUB Reader's
 * (apps/reader/src/components/ui/detent-sheet.tsx). The browser's own
 * scrolling moves it, so a drag follows the finger, keeps its momentum, and
 * rests on detents. It is modal: the page turns inert, focus stays inside,
 * and a press outside or Escape closes it.
 */
export function Sheet({
  isOpen,
  onOpenChange,
  title,
  heading = false,
  snapPoints,
  dim = true,
  tall = false,
  children,
}: SheetProps) {
  const hasDetents = !!snapPoints?.length;
  // React Aria opens a sheet at its first detent. Full height goes first
  // when the content will focus a field.
  const [opensFull, setOpensFull] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setOpensFull(false);
  }
  const detents =
    hasDetents && opensFull ? ["100%", ...snapPoints] : snapPoints;
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={detents}
      className="sheet-overlay"
    >
      {({ isExpanded, isExiting }) => (
        <>
          {dim && (
            <SheetBackdrop
              className="sheet-backdrop"
              swipeAnimation="sheet-backdrop"
              swipeAnimationRange={
                detents?.length ? { start: detents.length - 1 } : undefined
              }
            />
          )}
          <AriaSheet
            className="sheet"
            data-tall={tall || undefined}
            stackAnimation="sheet-recede"
            overscrollPadding
          >
            <SheetContent className="sheet-content">
              <div className="sheet-handle" aria-hidden="true" />
              <Heading
                slot="title"
                className={heading ? "sheet-title" : "visually-hidden"}
              >
                {title}
              </Heading>
              <SheetBody
                hasDetents={hasDetents}
                isExpanded={isExpanded}
                isExiting={isExiting}
                setOpensFull={setOpensFull}
              >
                {children}
              </SheetBody>
            </SheetContent>
          </AriaSheet>
        </>
      )}
    </SheetOverlay>
  );
}

/** Fields that open the phone keyboard. */
const TEXT_FIELD =
  "input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=file],[type=color]), textarea, [contenteditable]:not([contenteditable=false])";

function isTextField(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(TEXT_FIELD);
}

/**
 * The sheet's content. With detents, it keeps the keyboard and the detents
 * apart: the keyboard covers the lower screen without resizing the page, so
 * a field below full height would sit under it.
 */
function SheetBody({
  hasDetents,
  isExpanded,
  isExiting,
  setOpensFull,
  children,
}: {
  hasDetents: boolean;
  isExpanded: boolean;
  isExiting: boolean;
  setOpensFull: (opensFull: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // A closing sheet scrolls out of view, and React Aria unmounts it once it
  // is gone. React puts back scroll offsets when a commit moves focus, which
  // can stop that scroll; scroll it out again.
  useEffect(() => {
    if (!isExiting) return;
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller) return;
    const leave = () => {
      if (scroller.scrollTop > 0)
        scroller.scrollTo({ top: 0, behavior: "smooth" });
    };
    scroller.addEventListener("scrollend", leave);
    return () => scroller.removeEventListener("scrollend", leave);
  }, [isExiting]);

  // The body mounts each time the sheet opens, before React Aria scrolls the
  // sheet to its first detent, so this runs once per opening.
  useLayoutEffect(() => {
    if (hasDetents && ref.current?.querySelector("[data-sheet-autofocus]"))
      setOpensFull(true);
  }, [hasDetents, setOpensFull]);

  // Dragged below full height, the sheet puts the keyboard away.
  const wasExpanded = useRef(isExpanded);
  useEffect(() => {
    const collapsed = wasExpanded.current && !isExpanded;
    wasExpanded.current = isExpanded;
    const field = document.activeElement;
    if (
      collapsed &&
      hasDetents &&
      isTextField(field) &&
      ref.current?.contains(field)
    )
      field.blur();
  }, [hasDetents, isExpanded]);

  return (
    <div
      ref={ref}
      className="sheet-body"
      onFocus={(event) => {
        if (!hasDetents || isExpanded || !isTextField(event.target)) return;
        const sheet = event.currentTarget.closest<HTMLElement>(".sheet");
        const scroller = event.currentTarget.closest<HTMLElement>(
          "[data-sheet-scroll]",
        );
        // A sheet still below the screen is entering; it settles itself.
        if (
          !sheet ||
          !scroller ||
          sheet.getBoundingClientRect().top >= innerHeight
        )
          return;
        scroller.scrollTo({
          top: scroller.scrollHeight - scroller.clientHeight,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }}
    >
      {children}
    </div>
  );
}
