import { SURFACE_TITLE_TYPE } from "@/components/type-voices";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import {
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

type BottomSheetSnapPoint = number | string;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  modal?: boolean | "trap-focus";
  header?: ReactNode;
  showHeader?: boolean;
  children: ReactNode;
  contentClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  snapPoints?: readonly BottomSheetSnapPoint[];
  activeSnapPoint?: BottomSheetSnapPoint | null;
  setActiveSnapPoint?: (snapPoint: BottomSheetSnapPoint | null) => void;
}

/**
 * Shared bottom-sheet shell for peer-level application destinations.
 *
 * It owns the rounded material, safe-area behavior, and drag surface so each
 * feature only supplies its header and content hierarchy.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  modal = true,
  header,
  showHeader = true,
  children,
  contentClassName,
  panelClassName,
  bodyClassName,
  snapPoints,
  activeSnapPoint,
  setActiveSnapPoint,
}: BottomSheetProps) {
  // Base UI can report an upward over-drag as a swipe dismiss after release.
  // Keep the total displacement so only a downward gesture can close the sheet.
  const swipeStartYRef = useRef<number | null>(null);
  const swipeDeltaYRef = useRef(0);
  // A full-height snap point is clamped to auto-height content by Base UI. Its
  // presence also enables damped upward over-drag and settle-back.
  const resolvedSnapPoints = snapPoints ?? [1];
  const mutableSnapPoints = [...resolvedSnapPoints];
  const snapPointProps = mutableSnapPoints
    ? {
        snapPoints: mutableSnapPoints,
        snapPoint: activeSnapPoint,
        onSnapPointChange: setActiveSnapPoint,
      }
    : {};

  return (
    <Drawer
      direction="bottom"
      open={open}
      modal={modal}
      onOpenChange={(nextOpen, eventDetails) => {
        const isUpwardSwipeDismiss =
          !nextOpen &&
          eventDetails.reason === "swipe" &&
          swipeDeltaYRef.current < 0;

        if (isUpwardSwipeDismiss) {
          eventDetails.cancel();
          return;
        }

        if (!nextOpen) {
          swipeStartYRef.current = null;
          swipeDeltaYRef.current = 0;
        }
        onOpenChange(nextOpen);
      }}
      {...snapPointProps}
    >
      <DrawerContent
        overlayClassName="bg-transparent"
        className={cn(
          "border-none bg-transparent shadow-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-dvh after:bg-background after:content-['']",
          "data-[drawer-direction=bottom]:mt-12",
          "data-[drawer-direction=bottom]:max-h-[88vh]",
          "[&>div:first-child]:hidden",
          contentClassName,
        )}
        onPointerDownCapture={(event: ReactPointerEvent<HTMLDivElement>) => {
          swipeStartYRef.current = event.clientY;
          swipeDeltaYRef.current = 0;
        }}
        onPointerMoveCapture={(event: ReactPointerEvent<HTMLDivElement>) => {
          if (swipeStartYRef.current === null) return;
          swipeDeltaYRef.current = event.clientY - swipeStartYRef.current;
        }}
      >
        <div
          className={cn(
            "mx-auto flex max-h-full min-h-0 w-full max-w-3xl select-none flex-col overflow-hidden [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]",
            "rounded-t-[1.9rem] border-x border-t border-border/70 bg-background",
            "shadow-[0_-24px_60px_color-mix(in_srgb,var(--foreground)_8%,transparent)]",
            panelClassName,
          )}
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>

          <div className="flex justify-center pt-3 pb-2">
            <div className="h-1 w-10 rounded-full bg-border/80" />
          </div>

          {showHeader && (
            <div className="px-4">
              {header ?? (
                <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3">
                  <div className="size-8" aria-hidden="true" />
                  <p className={cn("truncate text-center", SURFACE_TITLE_TYPE)}>
                    {title}
                  </p>
                  <div className="size-8" aria-hidden="true" />
                </div>
              )}
            </div>
          )}

          <div className={cn("min-h-0 flex-1", bodyClassName)}>{children}</div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
