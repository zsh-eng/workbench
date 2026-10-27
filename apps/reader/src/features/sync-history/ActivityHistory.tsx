import { DetentSheet } from "@/components/ui/detent-sheet";
import {
  ActivitySheetBody,
  SECTION_HEADING,
} from "@/features/background-activity/ActivitySheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover } from "@base-ui/react/popover";
import type { ReactNode, RefObject } from "react";
import { useSyncDeviceNames } from "./device-names";
import { RecentHistory } from "./RecentHistory";
import { useReaderSyncHistory } from "./use-reader-sync-history";

/**
 * Now (the background jobs, as the activity glyph's sheet lists them) and
 * Recent (this device's sync history). `recent` replaces the live history,
 * as Design ideas does with sample data.
 */
export function ActivityHistoryBody({ recent }: { recent?: ReactNode }) {
  return (
    <div data-activity-history="">
      <ActivitySheetBody
        empty={
          <>
            <h3 className={SECTION_HEADING}>Now</h3>
            <p className="pb-2 text-[13px] text-muted-foreground">
              Nothing in the background right now.
            </p>
          </>
        }
      />
      <div className="px-1 pb-2">{recent ?? <LiveRecent />}</div>
    </div>
  );
}

function LiveRecent() {
  const history = useReaderSyncHistory();
  const names = useSyncDeviceNames();
  if (!history.loaded)
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        Reading this device's sync history…
      </p>
    );
  return <RecentHistory history={history} names={names} />;
}

/**
 * Account → Activity, behind Debug: a sheet on a phone, a popover under
 * the account button on a larger screen. The activity glyph keeps its own
 * sheet and its rule for when it shows.
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
  recent?: ReactNode;
}) {
  const isMobile = useIsMobile();
  if (isMobile)
    return (
      <DetentSheet
        isOpen={open}
        onOpenChange={onOpenChange}
        title="Activity"
        snapPoints={["62%"]}
        fit
      >
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
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
            className="max-h-[min(78vh,720px)] w-[380px] origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-2xl border bg-popover p-3 text-popover-foreground shadow-md transition-[opacity,transform] duration-150 ease-out outline-none data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 motion-reduce:transition-none"
          >
            <Popover.Title className="mb-2 px-1 text-[13px] font-medium">
              Activity
            </Popover.Title>
            <ActivityHistoryBody recent={recent} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
