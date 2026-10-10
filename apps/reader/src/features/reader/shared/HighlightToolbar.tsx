import { MessageSquarePlus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { MOTION } from "@/lib/motion";
import {
  EPUB_HIGHLIGHT_CLASS,
  HIGHLIGHT_TOOLBAR_CLASS,
} from "@/types/reader.types";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Send } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface HighlightToolbarProps {
  position: { x: number; y: number };
  onColorSelect: (color: AnnotationColor) => void;
  onClose: () => void;
  currentColor?: AnnotationColor;
  onDelete?: () => void;
  onAddNote?: () => void;
  textToCopy?: string;
  /** Called when user submits a note (creates invisible annotation + note) */
  onNoteSubmit?: (content: string) => void;
}

export function HighlightToolbar({
  position,
  onColorSelect,
  onClose,
  currentColor,
  onDelete,
  onAddNote,
  textToCopy,
  onNoteSubmit,
}: HighlightToolbarProps) {
  const isMobile = useIsMobile();
  const prefersReducedMotion = useReducedMotion();
  const [noteText, setNoteText] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBareDesktopPicker = !isMobile && !onNoteSubmit;
  const hasCopyAction = Boolean(textToCopy?.trim());

  // Calculate position directly to avoid layout thrashing/jumping
  // Vertical layout: colors on top, input bar below
  // Desktop color-only mode follows the compact floating pill used by Papers.
  // A note composer keeps the wider two-row surface.
  // Mobile: ~260px width, ~120px height
  const toolbarWidth = isBareDesktopPicker
    ? hasCopyAction
      ? 228 + (onAddNote ? 40 : 0)
      : 172 + (onAddNote ? 40 : 0)
    : isMobile
      ? 260
      : 220;
  const toolbarHeight = isBareDesktopPicker ? 44 : isMobile ? 120 : 88;
  const padding = 12;

  let x = position.x - toolbarWidth / 2;
  let y = position.y - toolbarHeight - padding;

  // Keep toolbar within viewport
  if (typeof window !== "undefined") {
    const viewportWidth = window.innerWidth;

    // Adjust horizontal position
    if (x < padding) {
      x = padding;
    } else if (x + toolbarWidth > viewportWidth - padding) {
      x = viewportWidth - toolbarWidth - padding;
    }

    // Adjust vertical position (show below if not enough space above)
    if (y < padding) {
      y = position.y + padding;
    }
  }

  const opensBelowSelection = y > position.y;

  const handleCopy = useCallback(async () => {
    if (!textToCopy) return;
    if (!navigator.clipboard) {
      toast.error("Could not copy highlight.");
      return;
    }

    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        copyResetTimerRef.current = null;
        setCopied(false);
      }, 1500);
    } catch (error) {
      console.error("Failed to copy highlighted text:", error);
      toast.error("Could not copy highlight.");
    }
  }, [textToCopy]);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  // Close toolbar when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click is inside the toolbar or on an existing highlight (for edit mode)
      if (
        !target.closest(`.${HIGHLIGHT_TOOLBAR_CLASS}`) &&
        !target.closest(`.${EPUB_HIGHLIGHT_CLASS}`)
      ) {
        onClose();
      }
    };

    // Add a small delay to prevent immediate closing
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  useHotkey("Escape", onClose, {
    conflictBehavior: "allow",
    preventDefault: false,
    requireReset: true,
    stopPropagation: false,
    meta: {
      name: "Close highlight toolbar",
      description: "Dismiss the active highlight controls",
    },
  });

  useHotkey(
    "Mod+Shift+C",
    (event) => {
      if (!hasCopyAction) return;
      event.preventDefault();
      void handleCopy();
    },
    {
      requireReset: true,
      stopPropagation: false,
      meta: {
        name: "Copy highlighted text",
        description: "Copy the selected reader text",
      },
    },
  );

  const handleNoteSubmit = () => {
    if (noteText.trim() && onNoteSubmit) {
      onNoteSubmit(noteText.trim());
      setNoteText("");
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNoteSubmit();
    }
  };

  return (
    <motion.div
      className={cn(
        "highlight-toolbar fixed z-50 flex flex-col gap-2",
        isBareDesktopPicker
          ? "rounded-full border border-border bg-popover/95 px-3 py-2 shadow-[0_8px_28px_color-mix(in_srgb,var(--foreground)_14%,transparent)] backdrop-blur-sm"
          : "rounded-2xl border border-border bg-background p-2 shadow-xl",
      )}
      initial={false}
      animate={{ opacity: 1, transform: "scale(1)" }}
      exit={{
        opacity: 0,
        transform: prefersReducedMotion ? "scale(1)" : "scale(0.98)",
        transition: MOTION.exit,
      }}
      transition={MOTION.enter}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        width: `${toolbarWidth}px`,
        transformOrigin: opensBelowSelection ? "center top" : "center bottom",
      }}
    >
      {/* Color buttons row */}
      <div className="flex items-center justify-center gap-3">
        {HIGHLIGHT_COLORS.map((color) => {
          const handleColorSelect = () => {
            const isRemoveExistingHighlight =
              currentColor && color.name === currentColor && onDelete;
            if (isRemoveExistingHighlight) {
              onDelete();
              return;
            }

            onColorSelect(color.name);
          };

          return (
            <button
              key={color.name}
              onClick={handleColorSelect}
              className={cn(
                "cursor-pointer rounded-full transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-2",
                "[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110",
                isBareDesktopPicker
                  ? "size-7 shadow-inner shadow-foreground/10 focus-visible:ring-offset-popover"
                  : "size-10 border-2 border-background/80 shadow-[0_2px_10px_color-mix(in_srgb,var(--foreground)_18%,transparent)] focus-visible:ring-offset-background md:size-8",
                currentColor &&
                  color.name === currentColor &&
                  (isBareDesktopPicker
                    ? "ring-2 ring-foreground ring-offset-2 ring-offset-popover"
                    : "ring-2 ring-foreground ring-offset-2 ring-offset-background"),
              )}
              style={{ backgroundColor: `var(--${color.name}-secondary)` }}
              aria-label={
                currentColor && color.name === currentColor
                  ? "Delete highlight"
                  : `Highlight with ${color.name}`
              }
              title={
                currentColor && color.name === currentColor
                  ? "Delete highlight"
                  : `Highlight with ${color.name}`
              }
            />
          );
        })}

        {hasCopyAction && <div className="h-5 w-px bg-border/50" />}

        {hasCopyAction && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label="Copy highlighted text"
            title={copied ? "Copied" : "Copy text"}
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-muted-foreground",
              "transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/70 focus-visible:ring-offset-2 focus-visible:ring-offset-popover",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-muted",
              copied && "text-foreground",
            )}
          >
            <CopyFeedbackIcon copied={copied} className="size-5" />
          </button>
        )}
        {onAddNote && (
          <button
            type="button"
            aria-label="Note on highlight"
            title="Add note"
            onClick={onAddNote}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            <MessageSquarePlus size={19} />
          </button>
        )}
      </div>

      {/* Note input row */}
      {onNoteSubmit && (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Add a note..."
            className="flex-1 px-3 py-1.5 text-sm rounded-full bg-muted border-0 focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <button
            onClick={handleNoteSubmit}
            disabled={!noteText.trim()}
            className={cn(
              "rounded-full p-2 transition-[color,background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95",
              noteText.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed",
            )}
            aria-label="Send note"
            title="Add note (creates annotation)"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
