import { Button } from "@/components/ui/button";
import { ChevronLeft, MoreHorizontal, PanelRight } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { motion } from "motion/react";
import type { ReaderChromeSurfaceProps } from "./chrome";
import { MOTION } from "@/lib/motion";
import { ReaderDesktopHeader } from "./ReaderDesktopHeader";

const CHROME_BUTTON_CLASS_NAME =
  "size-8 rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-background hover:text-foreground active:scale-95 motion-reduce:active:scale-100";

export interface ReaderHeaderProps {
  chromeVisible: boolean;
  accessory?: ReactNode;
  chromeSurfaceProps?: ReaderChromeSurfaceProps;
  bookTitle: string;
  isMobile: boolean;
  onBackToLibrary: () => void;
  isMenuOpen: boolean;
  onOpenMenu: () => void;
  /** The desktop tools trigger, where closing the tools sidebar returns focus. */
  toolsTriggerRef?: Ref<HTMLButtonElement>;
}

export function ReaderHeader({
  chromeVisible,
  accessory,
  chromeSurfaceProps,
  bookTitle,
  isMobile,
  onBackToLibrary,
  isMenuOpen,
  onOpenMenu,
  toolsTriggerRef,
}: ReaderHeaderProps) {
  if (!isMobile) {
    return (
      <ReaderDesktopHeader
        chromeVisible={chromeVisible}
        accessory={accessory}
        chromeSurfaceProps={chromeSurfaceProps}
        bookTitle={bookTitle}
        isMenuOpen={isMenuOpen}
        onOpenMenu={onOpenMenu}
        toolsTriggerRef={toolsTriggerRef}
      />
    );
  }

  return (
    <motion.header
      data-reader-header="mobile"
      className="absolute inset-x-0 top-0 z-20 bg-background/88 backdrop-blur-xl"
      animate={{ y: chromeVisible ? "0px" : "-100%" }}
      transition={{
        y: chromeVisible ? MOTION.chromeEnter : MOTION.chromeExit,
      }}
      {...chromeSurfaceProps}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        pointerEvents: chromeVisible ? "auto" : "none",
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/70"
        aria-hidden="true"
      />
      <div className="relative z-10 mx-auto grid h-14 max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-3 sm:px-4">
        {/* Zone 1 — Left: mobile reader navigation or desktop sidebar space. */}
        <div className="flex items-center">
          {isMobile && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onBackToLibrary}
              aria-label="Back to library"
              className={CHROME_BUTTON_CLASS_NAME}
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
        </div>

        {/* Zone 2 — Center: Book title */}
        <p className="max-w-[min(64vw,36rem)] truncate px-4 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {bookTitle}
        </p>

        {/* Zone 3 — Right: mobile launcher or desktop sidebar trigger. */}
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenMenu}
            aria-label="Open reader tools"
            aria-expanded={isMenuOpen}
            aria-pressed={isMobile ? undefined : isMenuOpen}
            className={`${CHROME_BUTTON_CLASS_NAME} aria-pressed:bg-secondary/70 aria-pressed:text-foreground`}
          >
            <MoreHorizontal className="size-4 md:hidden" />
            <PanelRight className="hidden size-4 md:block" />
          </Button>
        </div>
      </div>
    </motion.header>
  );
}
