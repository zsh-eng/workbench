import { showUndoToast } from "@/components/UndoToast";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { Button } from "@/components/ui/button";
import {
  ISLAND_SURFACE,
  IslandNotice,
  type IslandNoticeState,
} from "@/features/reader/NotesIsland";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SamplePage } from "./SamplePage";

export const TOAST_STATES = [
  { id: "undo", label: "Undo toast" },
  { id: "status", label: "Status saved" },
  { id: "finished", label: "Finished" },
  { id: "error", label: "Error" },
  { id: "island-undo", label: "Island Undo" },
  { id: "island-saved", label: "Island saved" },
] as const;

const NOTICE_MS = 1300;
const UNDO_NOTICE_MS = 8000;

/**
 * Feedback after an action: toasts on both devices, and the Notes Island
 * notice on phones. Each choice plays once; "Show again" replays it.
 */
export function ToastSpecimen({
  state,
  nonce,
}: {
  state: string;
  nonce: number;
}) {
  const isMobile = useIsMobile() ?? false;
  const [replays, setReplays] = useState(0);
  const [notice, setNotice] = useState<IslandNoticeState | null>(null);
  const island = state.startsWith("island-");

  useEffect(() => {
    toast.dismiss();
    setNotice(null);
    if (state === "undo") {
      return showUndoToast({
        message: "Note deleted",
        onUndo: () => toast.success("Note restored"),
      });
    }
    if (state === "status")
      toast.success(
        <ReadingStatusChangeMessage previousStatus={null} status="reading" />,
      );
    if (state === "finished")
      toast.success(
        <ReadingStatusChangeMessage
          previousStatus="reading"
          status="finished"
        />,
        {
          duration: 8000,
          action: { label: "Back to library", onClick: () => {} },
        },
      );
    if (state === "error") toast.error("Could not copy the text.");
    if (!island) return;
    const undo = state === "island-undo";
    setNotice({
      key: Date.now(),
      label: undo ? "Note deleted" : "Note saved",
      color: undo ? undefined : "green",
      undo: undo ? () => setNotice(null) : undefined,
    });
    const timer = window.setTimeout(
      () => setNotice(null),
      undo ? UNDO_NOTICE_MS : NOTICE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [state, nonce, replays, island]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <SamplePage />
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-background via-background/90 to-transparent px-6 pt-16 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        {island && !isMobile && (
          <p className="text-center text-sm text-muted-foreground">
            The Notes Island is on phones only. Desktop shows a toast.
          </p>
        )}
        {notice && isMobile && (
          <div className={cn("rounded-full", ISLAND_SURFACE)}>
            <IslandNotice notice={notice} onUndo={() => notice.undo?.()} />
          </div>
        )}
        <Button
          variant="secondary"
          className="rounded-full"
          onClick={() => setReplays((count) => count + 1)}
        >
          Show again
        </Button>
      </div>
    </div>
  );
}
