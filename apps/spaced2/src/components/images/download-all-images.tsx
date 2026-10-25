import BouncyButton from "@/components/bouncy-button";
import { Progress } from "@/components/ui/progress";
import type { downloadImageLocally } from "@/lib/images/db";
import type { searchForLinks } from "@/lib/images/download-all";
import {
  ALL_IMAGES_JOB,
  createImagesActivity,
  imagesActivity,
  type ImagesActivity,
} from "@/lib/images/images-activity";
import { useJob } from "@workbench/background-activity/react";
import {
  CheckCircle,
  CircleX,
  CloudOff,
  DownloadIcon,
  Loader2,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";

/**
 * The row for "Download all images" on the Images page. The download is a
 * background job: it keeps going when you leave the page, and the pill
 * shows it elsewhere. `download` and `findLinks` are for tests.
 */
export default function DownloadAllImages({
  download,
  findLinks,
}: {
  download?: typeof downloadImageLocally;
  findLinks?: typeof searchForLinks;
} = {}) {
  const [activity] = useState<ImagesActivity>(() =>
    download || findLinks
      ? createImagesActivity({ download, findLinks })
      : imagesActivity,
  );
  const job = useJob(activity.manager, ALL_IMAGES_JOB);
  const outcome = useSyncExternalStore(
    activity.subscribe,
    activity.outcome,
    activity.outcome,
  );
  const done = job?.progress.done ?? 0;
  const total = job?.progress.total ?? null;
  const waiting = job?.state === "waiting";
  const active =
    waiting ||
    job?.state === "queued" ||
    job?.state === "running" ||
    job?.state === "retrying";

  return (
    <div className="bg-background dark:bg-muted/50 rounded-xl px-2 py-2 sm:w-full mb-6 flex justify-between items-center mt-4 h-14">
      {!active && !outcome && (
        <>
          <div className="text-sm ml-2">Make all images available offline</div>
          <BouncyButton
            asButton
            className="flex justify-center items-center gap-2 bg-primary p-2 rounded-md text-background font-semibold px-4 dark:text-foreground"
            onClick={activity.start}
          >
            <DownloadIcon className="w-4 h-4" strokeWidth={2.5} />
            <span className="text-sm">Start</span>
          </BouncyButton>
        </>
      )}

      {active && total === null && !waiting && (
        <>
          <div className="text-sm ml-2 animate-fade-in">
            Searching for links...
          </div>
          <Loader2 className="w-5 h-5 text-primary animate-spin mr-4" />
        </>
      )}

      {active && (total !== null || waiting) && (
        <>
          <div className="text-sm ml-2 w-full mr-6 animate-fade-in">
            {waiting
              ? `Waiting for a connection (${done} / ${total ?? 0})`
              : `Downloading (${done} / ${total})...`}
            <Progress
              key={"progress"}
              className="mt-1"
              progressColour={waiting ? "bg-muted-foreground/50" : undefined}
              value={(done / (total || 1)) * 100}
            />
          </div>
          {waiting && (
            <CloudOff className="w-5 h-5 text-muted-foreground mr-2 shrink-0" />
          )}
          <button
            type="button"
            aria-label="Cancel image downloads"
            onClick={activity.cancel}
          >
            <CircleX className="w-5 h-5 text-muted-foreground mr-2" />
          </button>
        </>
      )}

      {!active && outcome?.state === "finished" && (
        <>
          <div className="text-sm ml-2 animate-fade-in">
            Downloaded {outcome.downloaded} new images
            {outcome.failed > 0 ? `; ${outcome.failed} failed` : ""}
          </div>
          <CheckCircle className="w-5 h-5 text-primary mr-4 cursor-pointer" />
        </>
      )}

      {!active && outcome?.state === "cancelled" && (
        <>
          <div className="text-sm ml-2 w-full mr-12">
            Download cancelled ({outcome.done} / {outcome.total})
            <Progress
              key={"progress"}
              className="mt-1"
              progressColour="bg-muted-foreground/50"
              value={(outcome.done / (outcome.total || 1)) * 100}
            />
          </div>
        </>
      )}
    </div>
  );
}
