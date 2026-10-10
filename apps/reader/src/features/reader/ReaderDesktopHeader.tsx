import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Bookmark, PanelRight } from "lucide-react";
import { motion } from "motion/react";
import { ReaderDesktopToolbar } from "./ReaderDesktopToolbar";
import { MOTION } from "@/lib/motion";
import type { ReaderHeaderProps } from "./ReaderHeader";

const CHROME_BUTTON_CLASS_NAME =
  "size-9 rounded-xl text-muted-foreground transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary/70 hover:text-foreground active:scale-95 motion-reduce:active:scale-100 aria-pressed:bg-secondary/70 aria-pressed:text-foreground";

type ReaderDesktopHeaderProps = Omit<
  ReaderHeaderProps,
  "isMobile" | "onBackToLibrary"
>;

/** Desktop controls fade in place. Mobile keeps its sliding header and ribbon. */
export function ReaderDesktopHeader({
  chromeVisible,
  accessory,
  chromeSurfaceProps,
  bookTitle,
  isBookmarked,
  onToggleBookmark,
  isMenuOpen,
  onOpenMenu,
}: ReaderDesktopHeaderProps) {
  const visible = chromeVisible || Boolean(accessory);
  return (
    <motion.header
      data-reader-header="desktop"
      className="absolute inset-x-0 top-0 z-20 bg-background/88 backdrop-blur-xl"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={MOTION.desktopChromeFade}
      inert={!visible}
      aria-hidden={!visible}
      {...chromeSurfaceProps}
      style={{
        paddingTop: "env(safe-area-inset-top)",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <ReaderDesktopToolbar
        bookTitle={bookTitle}
        navigation={<SidebarTrigger className={CHROME_BUTTON_CLASS_NAME} />}
        accessory={accessory}
        actions={
          <>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleBookmark}
              aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
              aria-pressed={isBookmarked}
              className={CHROME_BUTTON_CLASS_NAME}
            >
              <Bookmark
                className="size-[1.15rem]"
                fill={isBookmarked ? "currentColor" : "none"}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMenu}
              aria-label="Open reader tools"
              aria-expanded={isMenuOpen}
              aria-pressed={isMenuOpen}
              className={CHROME_BUTTON_CLASS_NAME}
            >
              <PanelRight className="size-[1.15rem]" />
            </Button>
          </>
        }
      />
    </motion.header>
  );
}
