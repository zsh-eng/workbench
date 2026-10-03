import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, MessageSquarePlus } from "lucide-react";
import type { AnnotationColor } from "./model";

export type PassageRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
const colors: AnnotationColor[] = ["yellow", "green", "blue", "magenta"];

// Adapted from ~/papers/src/components/highlight-toolbar.tsx.
export function HighlightToolbar({
  open,
  rect,
  currentColor,
  text,
  busy,
  onColor,
  onNote,
  onClose,
  notify,
}: {
  open: boolean;
  rect: PassageRect;
  currentColor?: AnnotationColor;
  text: string;
  busy: boolean;
  onColor: (color: AnnotationColor) => void;
  onNote: () => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      notify("Could not copy the passage.");
    }
  }, [text, notify]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        void copy();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !(event.target as Element).closest(
          "[data-highlight-toolbar], .article-highlight",
        )
      )
        onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [copy, onClose, open]);
  const width = 276;
  const left = Math.max(
    12,
    Math.min(
      (rect.left + rect.right - width) / 2,
      window.innerWidth - width - 12,
    ),
  );
  const top = Math.max(
    12,
    Math.min(
      rect.top >= 68 ? rect.top - 56 : rect.bottom + 12,
      window.innerHeight - 60,
    ),
  );
  return (
    <div
      data-highlight-toolbar
      data-exiting={!open || undefined}
      aria-hidden={!open || undefined}
      inert={!open}
      className="highlight-toolbar"
      role="toolbar"
      aria-label="Selected passage actions"
      style={{ left, top, width }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {colors.map((color) => {
        const label =
          currentColor === color
            ? `Remove ${color} highlight`
            : currentColor
              ? `Change to ${color}`
              : `Highlight ${color}`;
        return (
          <button
            key={color}
            className="highlight-swatch"
            data-color={color}
            aria-label={label}
            title={label}
            aria-pressed={currentColor === color}
            disabled={busy}
            onClick={() => onColor(color)}
          />
        );
      })}
      <span className="highlight-divider" />
      <button
        aria-label="Copy text"
        title={copied ? "Copied!" : "Copy text (⌘⇧C)"}
        onClick={() => void copy()}
      >
        {copied ? <Check size={18} className="copied" /> : <Copy size={18} />}
      </button>
      <button
        aria-label="Add note"
        title="Add note"
        disabled={busy}
        onClick={onNote}
      >
        <MessageSquarePlus size={18} />
      </button>
      <span className="sr-only" role="status">
        {copied ? "Copied!" : ""}
      </span>
    </div>
  );
}
