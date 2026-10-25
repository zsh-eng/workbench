import {
  RATING_NAME_TO_NUMBER,
  RATING_NUMBER_TO_NAME,
  STATE_NAME_TO_NUMBER,
  STATE_NUMBER_TO_NAME,
} from "@/lib/card-mapping";
import {
  Operation,
  ReviewLogDeletedOperation,
  ReviewLogOperation,
} from "@/lib/sync/operation";
import { Card, fsrs, generatorParameters, Grade, ReviewLog } from "ts-fsrs";

import { FSRS6_PERSONAL_PARAMETERS } from "./fsrs6-personal-parameters";
const params = generatorParameters(FSRS6_PERSONAL_PARAMETERS);
const f = fsrs(params);

export function previewGradeSchedule(card: Card, now = new Date()) {
  return f.repeat(card, now);
}

export function gradeCard(
  card: Card,
  grade: Grade,
  now = new Date(),
): {
  nextCard: Card;
  reviewLog: ReviewLog;
} {
  const recordLog = f.repeat(card, now, (recordLog) => {
    const recordLogItem = recordLog[grade];

    const nextCard = {
      ...card,
      ...recordLogItem.card,
    };

    return {
      nextCard,
      reviewLog: recordLogItem.log,
    };
  });

  return recordLog;
}

/**
 * Converts a review log operation to a review log.
 */
function reviewLogOperationToReviewLog(
  operation: ReviewLogOperation,
): ReviewLog & { duration: number } {
  return {
    ...operation.payload,
    rating: RATING_NAME_TO_NUMBER[operation.payload.grade],
    state: STATE_NAME_TO_NUMBER[operation.payload.state],
  };
}

export function reviewLogToReviewLogOperation(
  reviewLog: ReviewLog,
  cardId: string,
  duration: number = 0,
): ReviewLogOperation {
  return {
    type: "reviewLog",
    payload: {
      ...reviewLog,
      cardId,
      id: crypto.randomUUID(),
      grade: RATING_NUMBER_TO_NAME[reviewLog.rating],
      state: STATE_NUMBER_TO_NAME[reviewLog.state],
      duration,
      createdAt: new Date(),
    },
    timestamp: Date.now(),
  };
}

/**
 * Processes review log operations and returns a list of review logs.
 */
export function processReviewLogOperations(
  operations: Operation[],
): (ReviewLog & { duration: number })[] {
  const reviewLogMap: Record<string, ReviewLog & { duration: number }> = {};

  const reviewLogOperations = operations.filter(
    (op): op is ReviewLogOperation => op.type === "reviewLog",
  );

  reviewLogOperations.forEach((op) => {
    reviewLogMap[op.payload.id] = reviewLogOperationToReviewLog(op);
  });

  const reviewLogDeletedOperations = operations.filter(
    (op): op is ReviewLogDeletedOperation => op.type === "reviewLogDeleted",
  );
  const reviewLogsToDeleteSet = new Set<string>();
  reviewLogDeletedOperations.forEach((op) => {
    if (op.payload.deleted) {
      reviewLogsToDeleteSet.add(op.payload.reviewLogId);
    } else {
      reviewLogsToDeleteSet.delete(op.payload.reviewLogId);
    }
  });

  const reviewLogs = Object.entries(reviewLogMap)
    .filter(([id]) => !reviewLogsToDeleteSet.has(id))
    .map(([, log]) => ({
      ...log,
      duration: log.duration,
    }));

  return reviewLogs;
}
