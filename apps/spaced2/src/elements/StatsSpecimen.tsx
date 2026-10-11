import { BasicStats } from "@/components/stats/basic";
import EmptyStats from "@/components/stats/empty";
import { Heatmap } from "@/components/stats/heatmap";
import { TimeOfDayChart } from "@/components/stats/radial-time-of-day";
import { RatingPieChart } from "@/components/stats/rating-pie-chart";
import { ReviewChart } from "@/components/stats/review-chart";
import { TimeBarChart } from "@/components/stats/time-bar-chart";
import { useState } from "react";
import type { FrameSpecimenProps } from "./selection";
import { sampleReviewLogs } from "./stats-fixture";

const DAYS: Record<string, number> = { quarter: 90, week: 7, none: 0 };

/**
 * The Stats page's charts on sample review history. The route reads the
 * review log from IndexedDB, so this frame arranges the same charts with the
 * route's classes.
 */
export function StatsSpecimen({ state }: FrameSpecimenProps) {
  const [reviewLogs] = useState(() => sampleReviewLogs(DAYS[state] ?? 90));
  return (
    <div className="min-h-svh bg-muted px-2 pt-20 pb-12 dark:bg-background md:px-0 md:pt-8">
      <div className="mx-auto flex h-full w-full flex-col gap-2 pb-6 md:px-24 xl:w-2/3">
        {reviewLogs.length > 0 ? (
          <>
            <BasicStats reviewLogs={reviewLogs} />
            <Heatmap reviewLogs={reviewLogs} />
            <TimeBarChart reviewLogs={reviewLogs} />
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <RatingPieChart reviewLogs={reviewLogs} />
              <TimeOfDayChart reviewLogs={reviewLogs} />
            </div>
            <ReviewChart reviewLogs={reviewLogs} />
          </>
        ) : (
          <EmptyStats />
        )}
      </div>
    </div>
  );
}
