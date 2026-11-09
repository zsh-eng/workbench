import { DetentSheet } from "@/components/ui/detent-sheet";
import { db } from "@/data/database";
import { createReadingCheckpointId } from "@/data/reading-checkpoints";
import { useActivityEnvironment } from "@/features/background-activity/ActivityContext";
import { ActivitySheetBody } from "@/features/background-activity/ActivitySheet";
import { LibraryCover } from "@/features/background-activity/JobLook";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover } from "@base-ui/react/popover";
import type { Job } from "@workbench/background-activity";
import { useActivity } from "@workbench/background-activity/react";
import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useMemo, type ReactNode, type RefObject } from "react";
import { BookActivityList } from "./BookActivityList";
import { useSyncDeviceNames } from "./device-names";
import { useReaderSyncHistory } from "./use-reader-sync-history";

const NUMBER_WORDS = [
  "no",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const books = (count: number) =>
  `${NUMBER_WORDS[count] ?? count.toLocaleString()} ${count === 1 ? "book" : "books"}`;

const underway = (job: Job) =>
  job.state === "queued" ||
  job.state === "running" ||
  job.state === "retrying" ||
  job.state === "waiting";

/**
 * How things stand, in a few words beside the title, or nothing when
 * there's nothing to say: "Offline", "Adding three books".
 */
function useStatus(): { words: string | null; offline: boolean } {
  const { source } = useActivityEnvironment();
  const snapshot = useActivity(source);
  if (!snapshot.online) return { words: "Offline", offline: true };
  const active = snapshot.jobs.filter(underway);
  const adding = active.filter((job) => job.kind === "book-import").length;
  const downloading = active.filter(
    (job) => job.kind === "book-download",
  ).length;
  return {
    offline: false,
    words: adding
      ? `Adding ${books(adding)}`
      : downloading
        ? `Downloading ${books(downloading)}`
        : null,
  };
}

/**
 * The background jobs while there are any (the activity glyph's sheet
 * lists the same), then this device's sync history by book. `recent`
 * replaces the live history, as Design ideas does with sample data.
 */
export function ActivityHistoryBody({
  recent,
}: {
  recent?: (offline: boolean) => ReactNode;
}) {
  const { offline } = useStatus();
  return (
    <div data-activity-history="">
      <ActivitySheetBody empty={null} offlineNote={false} />
      <div className="px-1 pb-2">
        {recent ? recent(offline) : <LiveBooks offline={offline} />}
      </div>
    </div>
  );
}

/** Where each device's place is in each book, from its reading checkpoint. */
function usePlaces(localId: string) {
  const checkpoints = useLiveQuery(() => db.readingCheckpoints.toArray(), []);
  const places = useMemo(
    () =>
      new Map(
        (checkpoints ?? []).flatMap((checkpoint) =>
          checkpoint.isDeleted || checkpoint.bookProgress === undefined
            ? []
            : [[checkpoint.id, checkpoint.bookProgress] as const],
        ),
      ),
    [checkpoints],
  );
  return useCallback(
    (deviceId: string | null, bookId: string) =>
      places.get(createReadingCheckpointId(bookId, deviceId ?? localId)),
    [places, localId],
  );
}

function LiveBooks({ offline }: { offline: boolean }) {
  const history = useReaderSyncHistory();
  const names = useSyncDeviceNames();
  const placeOf = usePlaces(names.localId);
  // Nothing until the journal and its books are read, so titles don't change under you.
  if (!history.loaded) return null;
  return (
    <BookActivityList
      history={history}
      names={names}
      renderCover={(bookId) => <LibraryCover bookId={bookId} />}
      placeOf={placeOf}
      offline={offline}
    />
  );
}

/**
 * Account → Activity: a sheet on a phone, a popover under the account
 * button on a larger screen. Its title says how things stand only when
 * there's something to say. The activity glyph keeps its own sheet and
 * its rule for when it shows.
 */
export function ActivityHistory({
  open,
  onOpenChange,
  anchor,
  recent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the popover hangs from and returns focus to. */
  anchor: RefObject<HTMLElement | null>;
  recent?: (offline: boolean) => ReactNode;
}) {
  const isMobile = useIsMobile();
  const { words } = useStatus();
  const status = words && (
    <span
      className="font-serif text-[15px] text-muted-foreground italic"
      data-activity-status=""
    >
      {words}
    </span>
  );
  if (isMobile)
    return (
      // The sheet fits its books, up to the screen's height.
      <DetentSheet isOpen={open} onOpenChange={onOpenChange} title="Activity">
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {status && <p className="-mt-1 pb-1 text-center">{status}</p>}
          <ActivityHistoryBody recent={recent} />
        </div>
      </DetentSheet>
    );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          align="end"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup
            finalFocus={anchor}
            className="max-h-[min(78vh,720px)] w-[380px] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-2xl border bg-popover px-4 pt-5 pb-2 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
          >
            <div className="mb-1 flex items-baseline justify-between gap-3 px-1">
              <Popover.Title className="font-serif text-[26px] leading-none font-normal text-foreground">
                Activity
              </Popover.Title>
              {status}
            </div>
            <ActivityHistoryBody recent={recent} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
