import { APP_PAGE_FRAME, APP_TITLE_TYPE } from "@/components/app-header-styles";
import {
  ActivityEnvironmentProvider,
  type ActivityEnvironment,
} from "@/features/background-activity/ActivityContext";
import { SAMPLE_BOOKS } from "@/features/background-activity/ideas/sample-books";
import { SimCover } from "@/features/background-activity/ideas/SimCover";
import {
  createSimulation,
  type Simulation,
} from "@/features/background-activity/ideas/simulation";
import { cn } from "@/lib/utils";
import { useSyncHistory } from "@zsh-eng/local-sync/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ActivityHistory } from "../ActivityHistory";
import type { RecentArrangement } from "../history-rows";
import { describeReaderRecord } from "../reader-describe";
import { RecentHistory } from "../RecentHistory";
import { createSample, SAMPLE_NAMES } from "./sync-history-fixture";

const ARRANGEMENTS: readonly RecentArrangement[] = [
  "sections",
  "timeline",
  "devices",
];

/**
 * Design ideas → Sync history. A sample Library with Account → Activity
 * open: Now runs the background engine on simulated downloads (Try →
 * Download 5), and Recent shows six days of sample sync history, arranged
 * as `?variant=` says (`sections`, the choice; `timeline`; `devices`).
 * Three seconds in, the iPhone sends one more highlight, and its row says
 * so in place.
 */
export function SyncHistoryIdea() {
  const [params] = useSearchParams();
  const raw = params.get("variant") as RecentArrangement | null;
  const arrange = raw && ARRANGEMENTS.includes(raw) ? raw : "sections";
  // Reset starts a new sample, and a new page so Recent arranges afresh.
  const [{ sample, round }, setSample] = useState(() => ({
    sample: createSample(),
    round: 0,
  }));
  const [sim, setSim] = useState<Simulation | null>(null);
  useEffect(() => {
    const next = createSimulation(SAMPLE_BOOKS);
    setSim(next);
    return () => next.dispose();
  }, []);
  // The iPhone syncs while you look.
  useEffect(() => {
    const timer = window.setTimeout(() => sample.iPhoneSyncs(), 3_000);
    return () => window.clearTimeout(timer);
  }, [sample]);

  const environment = useMemo(
    (): ActivityEnvironment | null =>
      sim && {
        ...sim.environment,
        renderCover(job) {
          const bookId = (job.input as { bookId?: string } | null)?.bookId;
          const book = SAMPLE_BOOKS.find((entry) => entry.id === bookId);
          return book ? (
            <SimCover {...book} compact className="size-full" />
          ) : null;
        },
      },
    [sim],
  );
  if (!sim || !environment) return null;
  return (
    <ActivityEnvironmentProvider value={environment}>
      <IdeaPage
        key={round}
        sample={sample}
        sim={sim}
        arrange={arrange}
        onReset={() => {
          sim.reset();
          setSample({ sample: createSample(), round: round + 1 });
        }}
      />
    </ActivityEnvironmentProvider>
  );
}

function IdeaPage({
  sample,
  sim,
  arrange,
  onReset,
}: {
  sample: ReturnType<typeof createSample>;
  sim: Simulation;
  arrange: RecentArrangement;
  onReset(): void;
}) {
  const [open, setOpen] = useState(true);
  const account = useRef<HTMLButtonElement>(null);
  const describe = useMemo(() => describeReaderRecord(sample.lookup), [sample]);
  const history = useSyncHistory(sample.journal, {
    describe,
    pending: sample.pending,
  });
  return (
    <div className="min-h-dvh bg-background pb-28">
      <div className="sticky top-0 z-40 border-b border-dashed border-border bg-background/92 backdrop-blur">
        <div
          className={cn(
            APP_PAGE_FRAME,
            "flex items-center gap-1.5 overflow-x-auto py-2 [scrollbar-width:none]",
          )}
          role="group"
          aria-label="Scenarios"
        >
          <span className="mr-1 shrink-0 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Try
          </span>
          {[
            { label: "Download 5", run: () => sim.run("download") },
            { label: "iPhone syncs", run: () => sample.iPhoneSyncs() },
            { label: "Reset", run: onReset },
          ].map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                action.run();
                setOpen(true);
              }}
              className="h-7 shrink-0 rounded-full bg-foreground/[0.06] px-2.5 text-[12px] whitespace-nowrap text-foreground outline-none hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
      <header className={cn(APP_PAGE_FRAME, "pt-4 pb-2")}>
        <div className="flex h-10 items-center justify-between gap-3">
          <h1 className={cn(APP_TITLE_TYPE, "text-foreground")}>Library</h1>
          <button
            ref={account}
            type="button"
            aria-label="Account: Activity"
            onClick={() => setOpen(true)}
            className="grid size-8 place-items-center rounded-full bg-secondary text-[12px] font-medium text-secondary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            R
          </button>
        </div>
      </header>
      <ul
        className={cn(
          APP_PAGE_FRAME,
          "mt-3 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:gap-x-8",
        )}
      >
        {SAMPLE_BOOKS.map((book) => (
          <li key={book.id} className="min-w-0">
            <span className="block aspect-[2/3] w-full overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.1),0_10px_22px_-14px_rgb(0_0_0/0.4)]">
              <SimCover {...book} className="size-full" />
            </span>
            <h3 className="mt-3 line-clamp-2 text-[13px] leading-snug font-normal">
              {book.title}
            </h3>
            <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
              {book.author}
            </span>
          </li>
        ))}
      </ul>
      <ActivityHistory
        open={open}
        onOpenChange={setOpen}
        anchor={account}
        recent={
          <RecentHistory
            history={history}
            names={SAMPLE_NAMES}
            arrange={arrange}
          />
        }
      />
    </div>
  );
}
