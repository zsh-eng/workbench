import { APP_HEADER_BUTTON } from "@/components/app-header-styles";
import { DetentSheet } from "@/components/ui/detent-sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Popover } from "@base-ui/react/popover";
import type { Job } from "@workbench/background-activity";
import { useActivitySummary } from "@workbench/background-activity/react";
import { CircleAlert, CloudOff } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useActivityEnvironment, useUpdateState } from "./ActivityContext";
import { ActivitySheetBody } from "./ActivitySheet";
import { DrawnCheck, ProgressRing } from "./marks";

type GlyphKind = "attention" | "progress" | "update" | "waiting" | "done";

/**
 * Jobs the glyph speaks for. Sync has the account menu, and an update that
 * waits for you has its chip, so neither shows twice. A file that could not
 * be added says so on its own place in the Library, where you just added
 * it, with Try again: the glyph does not raise it a second time. The sheet
 * still lists it.
 */
function forGlyph(job: Job, updateChipShown: boolean): boolean {
  if (job.kind === "sync") return false;
  if (job.kind === "app-update") return !updateChipShown;
  if (job.kind === "book-import" && job.state === "failed") return false;
  return true;
}

const books = (count: number) => `${count} ${count === 1 ? "book" : "books"}`;

function glyphLabel(kind: GlyphKind, jobs: readonly Job[]): string {
  if (kind === "attention") return "Activity: something needs you";
  if (kind === "done") return "Activity: done";
  if (kind === "update") return "Activity: an update is ready";
  const active = jobs.filter(
    (job) => job.state !== "done" && job.state !== "failed",
  );
  const downloads = active.filter((job) => job.kind === "book-download");
  const imports = active.filter((job) => job.kind === "book-import");
  const others = active.length - downloads.length - imports.length;
  if (kind === "waiting")
    return `Activity: ${downloads.length ? books(downloads.length) : `${active.length} items`} waiting for a connection`;
  const parts = [
    downloads.length > 0 && `downloading ${books(downloads.length)}`,
    imports.length > 0 && `adding ${books(imports.length)}`,
    others > 0 && `${others} ${others === 1 ? "item" : "items"} in progress`,
  ].filter(Boolean);
  return `Activity: ${parts.join(", ") || "in progress"}`;
}

/**
 * A glyph beside the account button that shows only while work you asked
 * for runs or something needs you: a ring for downloads together, a cloud
 * for a wait, an alert for a failure, a check once. Tap for the sheet.
 */
export function ActivityGlyph({
  className,
  includeUpdate = false,
}: {
  className?: string;
  /** No update chip on this page: the glyph carries a waiting update too. */
  includeUpdate?: boolean;
}) {
  const { source } = useActivityEnvironment();
  const update = useUpdateState();
  const summary = useActivitySummary(source);
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const chip = update.status === "ready" || update.status === "applying";
  const shown = summary.shown.filter((job) =>
    forGlyph(job, chip && !includeUpdate),
  );
  const updateWaits = shown.some(
    (job) => job.kind === "app-update" && job.state === "waiting",
  );
  const work = shown.filter(
    (job) => job.kind !== "app-update" || job.state !== "waiting",
  );
  const active = work.filter(
    (job) => job.state !== "done" && job.state !== "failed",
  );
  const kind: GlyphKind | null = shown.some(
    (job) => job.state === "failed" || job.attention,
  )
    ? "attention"
    : active.some((job) => job.state !== "waiting")
      ? "progress"
      : updateWaits
        ? "update"
        : active.length > 0
          ? "waiting"
          : work.length > 0
            ? "done"
            : null;
  // The glyph stays while its sheet is open, so the sheet has a place to
  // close back to.
  const visible = kind !== null || open;

  const mark =
    kind === "attention" ? (
      <CircleAlert
        className="size-[18px] text-[oklch(0.62_0.16_55)]"
        strokeWidth={1.8}
      />
    ) : kind === "waiting" ? (
      <CloudOff className="size-[18px]" strokeWidth={1.7} />
    ) : kind === "done" ? (
      <DrawnCheck size={18} />
    ) : kind === "update" ? (
      <span className="size-2 rounded-full bg-[oklch(0.62_0.15_250)]" />
    ) : (
      <ProgressRing fraction={summary.fraction} size={18} />
    );

  const button = (props: Record<string, unknown> = {}) => (
    <motion.button
      key="glyph"
      type="button"
      aria-label={kind ? glyphLabel(kind, shown) : "Activity"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.18 } }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      className={cn(APP_HEADER_BUTTON, "text-foreground", className)}
      data-activity-glyph={kind ?? "idle"}
      {...props}
    >
      {/* The meaning changes in place: a 150 ms cross-fade, no movement. */}
      <span className="relative grid size-[18px] place-items-center">
        <AnimatePresence initial={false}>
          <motion.span
            key={kind ?? "idle"}
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.15 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            {mark}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );

  if (isMobile)
    return (
      <>
        <AnimatePresence initial={false}>
          {visible && button({ onClick: () => setOpen(true) })}
        </AnimatePresence>
        {/* The sheet fits its rows: it follows a row that joins, and holds
            while one leaves, then settles once (MOTION.md, "Sheet
            behaviour"). */}
        <DetentSheet isOpen={open} onOpenChange={setOpen} title="Activity">
          <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <ActivitySheetBody />
          </div>
        </DetentSheet>
      </>
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence initial={false}>
        {visible && (
          <Popover.Trigger
            key="glyph"
            render={(props) => button(props as Record<string, unknown>)}
          />
        )}
      </AnimatePresence>
      <Popover.Portal>
        <Popover.Positioner align="end" sideOffset={6} className="z-50">
          <Popover.Popup className="w-[340px] origin-(--transform-origin) rounded-2xl border bg-popover p-3 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none">
            <Popover.Title className="mb-2 px-1 text-[13px] font-medium">
              Activity
            </Popover.Title>
            <ActivitySheetBody />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
