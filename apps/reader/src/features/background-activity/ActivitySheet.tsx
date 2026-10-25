import { cn } from "@/lib/utils";
import {
  describeJob,
  jobFraction,
  type Job,
} from "@workbench/background-activity";
import { useActivity, useNow } from "@workbench/background-activity/react";
import { SPRINGS, springTransition } from "@workbench/elements/spring";
import {
  CircleAlert,
  CircleFadingArrowUp,
  CloudOff,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useActivityEnvironment, useUpdateState } from "./ActivityContext";
import { DrawnCheck, ProgressRing } from "./marks";
import {
  arrangeOnOpen,
  arrangeWhileOpen,
  SECTION_TITLES,
  sectionsOf,
  type SheetRow,
} from "./sheet-rows";

/** Every row is this tall, whatever it says, so nothing shifts as it changes. */
const ROW_HEIGHT = 56;
const HEADING_HEIGHT = 30;

/**
 * Rows that join or leave: UITableView's insert and delete spring
 * (response 0.30 s, critical), every row of one change together. A row
 * whose words or mark change does not move.
 */
const ROW_SPRING = springTransition({ ...SPRINGS.sheet, response: 0.3 });

/** The id of the book a job downloads, if it is a book's. */
export function bookIdOf(job: Job): string | null {
  const input = job.input as { bookId?: unknown } | null | undefined;
  return typeof input?.bookId === "string" ? input.bookId : null;
}

/**
 * The rows while this sheet is open (sheet-rows.ts). The sheet mounts its
 * body each time it opens, so each opening groups the rows again.
 */
export function useSheetRows(jobs: readonly Job[]) {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [held, setHeld] = useState(() => ({
    jobs,
    removed,
    rows: arrangeOnOpen(jobs),
  }));
  let rows = held.rows;
  if (held.jobs !== jobs || held.removed !== removed) {
    rows = arrangeWhileOpen(held.rows, jobs, removed);
    setHeld({ jobs, removed, rows });
  }
  const remove = (id: string) =>
    setRemoved((current) => new Set(current).add(id));
  return { rows, remove };
}

const ACTION =
  "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** App Store's download button: the ring fills, and a tap on it stops it. */
function StopRing({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const held = job.state === "queued" || job.state === "waiting";
  return (
    <button
      type="button"
      aria-label={`Cancel ${job.title}`}
      onClick={onCancel}
      className={cn(ACTION, "text-foreground")}
    >
      <span className="relative grid place-items-center">
        <ProgressRing
          fraction={job.state === "queued" ? 0 : jobFraction(job)}
          size={24}
          className={held ? "opacity-45" : undefined}
        />
        <span className="absolute size-[7px] rounded-[1.5px] bg-current" />
      </span>
    </button>
  );
}

/**
 * The left of a row: the book's cover, the only picture of the book on
 * screen while the sheet covers the shelf; or what the app's work is.
 */
function Leading({ job }: { job: Job }) {
  const { renderCover } = useActivityEnvironment();
  const bookId = bookIdOf(job);
  if (bookId)
    return (
      <span
        className="block h-9 w-6 shrink-0 overflow-hidden rounded-[2px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_1px_2px_rgb(0_0_0/0.12)]"
        data-sheet-cover={bookId}
      >
        {renderCover?.(job) ?? (
          <span className="block size-full bg-secondary" />
        )}
      </span>
    );
  const Icon = job.kind === "app-update" ? CircleFadingArrowUp : RefreshCw;
  return (
    <span className="grid h-9 w-6 shrink-0 place-items-center text-muted-foreground">
      <Icon className="size-[18px]" strokeWidth={1.7} />
    </span>
  );
}

/** The right of a row: its state, and what you can do about it. */
function Trailing({
  row,
  onRemove,
}: {
  row: SheetRow;
  onRemove: (id: string) => void;
}) {
  const { source, restart } = useActivityEnvironment();
  const update = useUpdateState();
  const { job, gone } = row;
  if (job.state === "done" || (gone && job.tracked && job.state !== "failed"))
    return <DrawnCheck size={18} animate={!row.settled} />;
  if (gone || job.state === "cancelled") return null;
  if (job.kind === "app-update") {
    if (update.status === "ready")
      return (
        <button
          type="button"
          data-activity-restart=""
          onClick={restart}
          className="h-8 shrink-0 rounded-full bg-foreground px-3 text-[13px] font-medium text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Restart
        </button>
      );
    return (
      <ProgressRing
        fraction={job.progress.phase === "restarting" ? null : jobFraction(job)}
        size={18}
      />
    );
  }
  if (job.tracked) {
    if (job.state === "failed" || job.attention)
      return (
        <CircleAlert
          className="size-[18px] text-[oklch(0.62_0.16_55)]"
          strokeWidth={1.8}
        />
      );
    if (job.state === "waiting")
      return (
        <CloudOff
          className="size-[18px] text-muted-foreground"
          strokeWidth={1.8}
        />
      );
    return <ProgressRing fraction={jobFraction(job)} size={18} />;
  }
  if (job.state === "failed")
    return (
      <>
        <button
          type="button"
          aria-label={`Retry ${job.title}`}
          onClick={() => source.retry(job.id)}
          className={ACTION}
        >
          <RotateCcw className="size-4" strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={`Dismiss ${job.title}`}
          onClick={() => {
            onRemove(job.id);
            source.dismiss(job.id);
          }}
          className={ACTION}
        >
          <X className="size-4" strokeWidth={1.8} />
        </button>
      </>
    );
  return (
    <StopRing
      job={job}
      onCancel={() => {
        onRemove(job.id);
        source.cancel(job.id);
      }}
    />
  );
}

function subtitle({ job, gone }: SheetRow, now: number): string {
  if (bookIdOf(job)) {
    if (job.state === "done") return "On this device";
    // Started, before its first bytes: the request is out.
    if (job.state === "running" && !job.progress.phase) return "Downloading";
  }
  if (gone && job.kind === "sync") return "Synced";
  if (gone && job.tracked) return "Done";
  return describeJob(job, now);
}

function Row({
  row,
  now,
  onRemove,
}: {
  row: SheetRow;
  now: number;
  onRemove: (id: string) => void;
}) {
  const { job } = row;
  const warn = !row.gone && (job.state === "failed" || job.attention);
  return (
    <div
      className="flex items-center gap-3"
      style={{ height: ROW_HEIGHT }}
      data-sheet-row={job.id}
      data-sheet-row-state={row.gone ? "gone" : job.state}
    >
      <Leading job={job} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-foreground">
          {job.title}
        </span>
        <span
          className={cn(
            "block truncate font-numeric text-[12.5px] text-muted-foreground tabular-nums",
            warn && "text-[oklch(0.55_0.14_55)]",
          )}
        >
          {subtitle(row, now)}
        </span>
      </span>
      {/* One width for every state, so the words never reflow. */}
      <span className="flex w-[4.5rem] shrink-0 items-center justify-end gap-0.5">
        <Trailing row={row} onRemove={onRemove} />
      </span>
    </div>
  );
}

/** A row or a heading that joins or leaves by opening or closing its height. */
function Collapse({
  height,
  className,
  children,
}: {
  height: number;
  className: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={cn("overflow-hidden", className)}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={reduce ? { duration: 0 } : ROW_SPRING}
    >
      {children}
    </motion.div>
  );
}

/**
 * Everything in the background, in words, with each book's cover: Now,
 * Waiting, Couldn't finish, Done, and This app (sync's exceptions and the
 * update). Rows hold still while the sheet is open (sheet-rows.ts).
 */
export function ActivitySheetBody() {
  const { source } = useActivityEnvironment();
  const snapshot = useActivity(source);
  const now = useNow(true, 1_000);
  const { rows, remove } = useSheetRows(snapshot.jobs);
  const groups = sectionsOf(rows);
  return (
    <div className="px-1 pb-2" data-activity-sheet="">
      {!snapshot.online && (
        <p className="mb-3 rounded-xl bg-foreground/[0.04] px-3 py-2 text-[12.5px] text-muted-foreground">
          Offline. Downloads continue when you are back online.
        </p>
      )}
      {groups.length === 0 && (
        <p className="py-8 text-center text-[13px] text-muted-foreground">
          Nothing in the background. Everything is on this device and synced.
        </p>
      )}
      <AnimatePresence initial={false}>
        {groups.flatMap(({ section, rows }) => [
          <Collapse
            key={`section:${section}`}
            height={HEADING_HEIGHT}
            className="ba-sheet-heading"
          >
            <h3 className="flex h-[30px] items-end pb-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              {SECTION_TITLES[section]}
            </h3>
          </Collapse>,
          ...rows.map((row) => (
            <Collapse
              key={row.job.id}
              height={ROW_HEIGHT}
              className="ba-sheet-row"
            >
              <Row row={row} now={now} onRemove={remove} />
            </Collapse>
          )),
        ])}
      </AnimatePresence>
    </div>
  );
}
