import { Button } from "@/components/ui/button";
import { ChevronLeft, MoreHorizontal, PanelRight } from "lucide-react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ReaderChromeSurfaceProps } from "./chrome";
import { MOTION } from "@/lib/motion";
import { ReaderDesktopHeader } from "./ReaderDesktopHeader";

const HEADER_HEIGHT_PX = 56;
const BOOKMARK_RIBBON_WIDTH_PX = 28;
const BOOKMARK_RIBBON_RIGHT_PX = 16;
const BOOKMARK_RIBBON_HEIGHT_PX = 52;
const BOOKMARK_RIBBON_TUCKED_OVERLAP_PX = 18;
const BOOKMARK_RIBBON_LOWERED_OVERLAP_PX = 10;
const BOOKMARK_RIBBON_PEEK_OFFSET_PX = 18;
const HEADER_BORDER_JOIN_OVERLAP_PX = 1;
const HEADER_BORDER_GAP_WIDTH_PX =
  BOOKMARK_RIBBON_WIDTH_PX - HEADER_BORDER_JOIN_OVERLAP_PX * 2;
const HEADER_BORDER_GAP_RIGHT_PX =
  BOOKMARK_RIBBON_RIGHT_PX + HEADER_BORDER_JOIN_OVERLAP_PX;

const BOOKMARK_RIBBON_BASE_TOP_PX =
  HEADER_HEIGHT_PX - BOOKMARK_RIBBON_TUCKED_OVERLAP_PX;
const BOOKMARK_RIBBON_ACTIVE_DROP_PX =
  BOOKMARK_RIBBON_TUCKED_OVERLAP_PX - BOOKMARK_RIBBON_LOWERED_OVERLAP_PX;
const CHROME_SHELL_HEIGHT_PX =
  BOOKMARK_RIBBON_BASE_TOP_PX +
  BOOKMARK_RIBBON_ACTIVE_DROP_PX +
  BOOKMARK_RIBBON_HEIGHT_PX;
const CHROME_BUTTON_CLASS_NAME =
  "size-8 rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-background hover:text-foreground active:scale-95 motion-reduce:active:scale-100";

export interface ReaderHeaderProps {
  chromeVisible: boolean;
  accessory?: ReactNode;
  chromeSurfaceProps?: ReaderChromeSurfaceProps;
  bookTitle: string;
  isMobile: boolean;
  onBackToLibrary: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  isMenuOpen: boolean;
  onOpenMenu: () => void;
}

export function ReaderHeader({
  chromeVisible,
  accessory,
  chromeSurfaceProps,
  bookTitle,
  isMobile,
  onBackToLibrary,
  isBookmarked,
  onToggleBookmark,
  isMenuOpen,
  onOpenMenu,
}: ReaderHeaderProps) {
  if (!isMobile) {
    return (
      <ReaderDesktopHeader
        chromeVisible={chromeVisible}
        accessory={accessory}
        chromeSurfaceProps={chromeSurfaceProps}
        bookTitle={bookTitle}
        isBookmarked={isBookmarked}
        onToggleBookmark={onToggleBookmark}
        isMenuOpen={isMenuOpen}
        onOpenMenu={onOpenMenu}
      />
    );
  }

  const chromeShellY = chromeVisible
    ? "0px"
    : isBookmarked
      ? `calc(-100% + ${BOOKMARK_RIBBON_PEEK_OFFSET_PX}px)`
      : "-100%";
  const chromeShellTransition = chromeVisible
    ? MOTION.chromeEnter
    : MOTION.chromeExit;
  const bookmarkRibbonYTransition = isBookmarked
    ? MOTION.chromeEnter
    : MOTION.chromeExit;
  const bookmarkRibbonOpacityTransition =
    chromeVisible || isBookmarked ? MOTION.chromeFadeIn : MOTION.chromeFadeOut;

  return (
    <>
      <motion.div
        data-reader-header="mobile"
        className="absolute inset-x-0 top-0 z-20 overflow-visible"
        animate={{ y: chromeShellY }}
        transition={{ y: chromeShellTransition }}
        {...chromeSurfaceProps}
        style={{
          height: `calc(env(safe-area-inset-top) + ${CHROME_SHELL_HEIGHT_PX}px)`,
        }}
      >
        <motion.button
          type="button"
          className="absolute right-4 top-0 z-10 w-7 cursor-pointer overflow-hidden bg-background/95 backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          animate={{
            y: isBookmarked ? BOOKMARK_RIBBON_ACTIVE_DROP_PX : 0,
            opacity: chromeVisible || isBookmarked ? 1 : 0,
          }}
          transition={{
            y: bookmarkRibbonYTransition,
            opacity: bookmarkRibbonOpacityTransition,
          }}
          style={{
            top: `calc(env(safe-area-inset-top) + ${BOOKMARK_RIBBON_BASE_TOP_PX}px)`,
            right: `${BOOKMARK_RIBBON_RIGHT_PX}px`,
            width: `${BOOKMARK_RIBBON_WIDTH_PX}px`,
            height: `${BOOKMARK_RIBBON_HEIGHT_PX}px`,
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 12px), 50% 100%, 0 calc(100% - 12px))",
            pointerEvents: chromeVisible || isBookmarked ? "auto" : "none",
          }}
          onClick={onToggleBookmark}
          aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
          aria-pressed={isBookmarked}
        >
          <svg
            viewBox="0 0 28 52"
            className="block size-full"
            aria-hidden="true"
            focusable="false"
          >
            <polygon
              points="0.75,0.75 27.25,0.75 27.25,40 14,51.25 0.75,40"
              fill={isBookmarked ? "var(--secondary)" : "none"}
              stroke={
                isBookmarked ? "var(--muted-foreground)" : "var(--border)"
              }
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              style={{
                transition: "fill 180ms ease, stroke 180ms ease",
              }}
            />
          </svg>
        </motion.button>

        <header
          className="absolute inset-x-0 top-0 z-20 bg-background/88 backdrop-blur-xl"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            pointerEvents: chromeVisible ? "auto" : "none",
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border/70"
            aria-hidden="true"
          />
          <div
            className="pointer-events-none absolute bottom-0 h-px bg-background/88"
            aria-hidden="true"
            style={{
              right: `${HEADER_BORDER_GAP_RIGHT_PX}px`,
              width: `${HEADER_BORDER_GAP_WIDTH_PX}px`,
            }}
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

            {/* Zone 2 — Center: Book title, under the prompt while one shows */}
            <p
              className={`max-w-[min(64vw,36rem)] truncate px-4 text-center text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground transition-opacity duration-150 ${accessory ? "opacity-0" : ""}`}
            >
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
        </header>
      </motion.div>

      {/* A prompt keeps one place at the top edge: it does not ride the
          sliding chrome, so a tap that toggles the chrome cannot move it. */}
      <AnimatePresence initial={false}>
        {accessory && (
          <motion.div
            key="top-prompt"
            className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-14 *:pointer-events-auto"
            style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0, transition: MOTION.enter }}
            exit={{ opacity: 0, transition: MOTION.exit }}
          >
            {accessory}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
