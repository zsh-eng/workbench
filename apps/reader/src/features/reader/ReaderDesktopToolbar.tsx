import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The container width, rather than the window width, also governs the preview.
 * Prompts take priority over the title in compact desktop layouts. */
export function ReaderDesktopToolbar({
  bookTitle,
  subtitle,
  navigation,
  accessory,
  actions,
}: {
  bookTitle: string;
  /** The chapter, set after the title in normal case. Without it the title is set in small capitals. */
  subtitle?: string;
  navigation: ReactNode;
  accessory?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="@container/desktop-chrome">
      <div
        className={cn(
          "grid h-14 items-center px-4",
          accessory
            ? "grid-cols-[auto_minmax(0,1fr)_auto] @min-[1024px]/desktop-chrome:grid-cols-[minmax(19rem,1fr)_minmax(0,36rem)_minmax(19rem,1fr)]"
            : "grid-cols-[minmax(4.75rem,1fr)_minmax(0,36rem)_minmax(4.75rem,1fr)]",
        )}
      >
        <div className="flex items-center">{navigation}</div>
        <p
          data-reader-header-title=""
          title={bookTitle}
          className={cn(
            "min-w-0 truncate px-4 text-muted-foreground",
            subtitle === undefined
              ? "text-[11px] font-medium uppercase tracking-[0.18em]"
              : "text-[13px]",
            accessory
              ? "text-left @min-[1024px]/desktop-chrome:text-center"
              : "text-center",
          )}
        >
          {bookTitle}
          {subtitle && (
            <span className="text-muted-foreground/60"> · {subtitle}</span>
          )}
        </p>
        <div className="flex items-center justify-end gap-1">
          {accessory}
          {actions}
        </div>
      </div>
    </div>
  );
}
