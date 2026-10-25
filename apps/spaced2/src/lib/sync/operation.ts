import { reviewSession } from "@/lib/review/session";
import { broadcastRecordsChanged } from "./broadcast";
import { STATE_NAME_TO_NUMBER, STATE_NUMBER_TO_NAME } from "@/lib/card-mapping";
import MemoryDB, { UndoGrade, memoryReady } from "@/lib/db/memory";
import { db, assertLocalWritesAllowed } from "@/lib/db/persistence";
import { gradeCard, reviewLogToReviewLogOperation } from "@/lib/review/review";
import { defaultCard, defaultDeck } from "@/lib/sync/default";
import { CardWithMetadata, Deck } from "@/lib/types";
import { createEmptyCard, Grade } from "ts-fsrs";

export * from "./schema";
import {
  type Operation,
  type CardOperation,
  type CardContentOperation,
  type CardDeletedOperation,
  type CardBookmarkedOperation,
  type CardSuspendedOperation,
  type CardMetadataOperation,
  type DeckOperation,
  type UpdateDeckCardOperation,
  type ReviewLogDeletedOperation,
} from "./schema";
import { toStoredOperation } from "./records";
import { withSyncLock } from "./lock";

function emptyCardToOperations(card: CardWithMetadata): Operation[] {
  const now = Date.now();
  const cardOperation: CardOperation = {
    type: "card",
    payload: {
      id: card.id,
      createdAt: card.createdAt || Date.now(),
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsed_days,
      scheduled_days: card.scheduled_days,
      learning_steps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: STATE_NUMBER_TO_NAME[card.state],
      last_review: card.last_review ?? null,
    },
    timestamp: now,
  };

  const cardContentOperation: CardContentOperation = {
    type: "cardContent",
    payload: {
      cardId: card.id,
      front: card.front,
      back: card.back,
    },
    timestamp: now,
  };

  return [cardOperation, cardContentOperation];
}

function cardDeckOperations(
  cardId: string,
  decks: string[],
): UpdateDeckCardOperation[] {
  return decks.map((deckId) => ({
    type: "updateDeckCard",
    payload: { deckId, cardId, present: true },
    timestamp: Date.now(),
  }));
}

/**
 * Creates a new card in the database
 *
 * Implementation is to merge the operations (without seqeuence number).
 * Doing so simplifies the implementation of the client side and ensures
 * consistency when updating the database.
 */
export async function createNewCard(
  front: string,
  back: string,
  decks: string[] = [],
  metadata?: { noteId: string; siblingTag: string },
) {
  const card: CardWithMetadata = {
    ...createEmptyCard(),
    id: crypto.randomUUID(),
    front,
    back,

    // CRDT metadata
    cardLastModified: 0,
    cardContentLastModified: 0,
    cardDeletedLastModified: 0,
  };

  const cardOperations = emptyCardToOperations(card);
  const deckOperations = cardDeckOperations(card.id, decks);
  const operations: Operation[] = [...cardOperations, ...deckOperations];

  if (metadata) {
    const metadataOp: CardMetadataOperation = {
      type: "cardMetadata",
      payload: {
        cardId: card.id,
        noteId: metadata.noteId,
        siblingTag: metadata.siblingTag,
      },
      timestamp: Date.now(),
    };
    operations.push(metadataOp);
  }

  await persistFormOperations(operations);

  return card.id;
}

export async function updateCardContentOperation(
  cardId: string,
  front: string,
  back: string,
) {
  const cardOperation: CardContentOperation = {
    type: "cardContent",
    payload: {
      cardId,
      front,
      back,
    },
    timestamp: Date.now(),
  };

  await persistFormOperations([cardOperation]);
}

const MAX_DURATION_PER_CARD_MS = 2 * 60 * 1000; // 2 minutes

export async function gradeCardOperation(
  card: CardWithMetadata,
  grade: Grade,
  providedDuration: number = 0,
) {
  const { nextCard, reviewLog } = gradeCard(card, grade);
  if (providedDuration > MAX_DURATION_PER_CARD_MS) {
    console.warn(
      `Duration for card ${card.id} was ${providedDuration}ms, clamping to ${MAX_DURATION_PER_CARD_MS}ms`,
    );
  }

  const duration = Math.min(providedDuration, MAX_DURATION_PER_CARD_MS);
  const cardOperation: CardOperation = {
    type: "card",
    payload: {
      id: card.id,
      createdAt: card.createdAt || Date.now(),
      due: nextCard.due,
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
      elapsed_days: nextCard.elapsed_days,
      scheduled_days: nextCard.scheduled_days,
      learning_steps: nextCard.learning_steps,
      reps: nextCard.reps,
      lapses: nextCard.lapses,
      state: STATE_NUMBER_TO_NAME[nextCard.state],
      last_review: nextCard.last_review ?? null,
    },
    timestamp: Date.now(),
  };

  const reviewLogOperation = reviewLogToReviewLogOperation(
    reviewLog,
    card.id,
    duration,
  );
  const undo: UndoGrade = {
    card,
    cardId: card.id,
    reviewLogId: reviewLogOperation.payload.id,
    siblingSuspensions: [],
  };

  // Bury sibling cards (same noteId) until tomorrow
  const siblingBuryOps: CardSuspendedOperation[] = [];
  const siblingIds = MemoryDB.getSiblingCardIds(card.id);
  if (siblingIds.length > 0) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    for (const siblingId of siblingIds) {
      const sibling = MemoryDB.getCardById(siblingId);
      if (!sibling || sibling.deleted) continue;
      // Don't bury if already suspended until tomorrow or later (e.g. permanently buried)
      if (sibling.suspended && sibling.suspended >= tomorrow) continue;

      const buryOp: CardSuspendedOperation = {
        type: "cardSuspended",
        payload: { cardId: siblingId, suspended: tomorrow },
        timestamp: Math.max(Date.now(), sibling.cardSuspendedLastModified + 1),
      };
      undo.siblingSuspensions.push({
        cardId: siblingId,
        previousSuspended: sibling.suspended,
        suspended: tomorrow,
        timestamp: buryOp.timestamp,
      });
      siblingBuryOps.push(buryOp);
    }
  }

  const allOperations: Operation[] = [
    cardOperation,
    reviewLogOperation,
    ...siblingBuryOps,
  ];
  await persistFormOperations(allOperations);
  MemoryDB.pushUndoGrade(undo);
  MemoryDB.notify();
  reviewSession.advance(card.id);
}

type UndoGradeResult = {
  applied: boolean;
};

/**
 * "Undoing" a grade is done by
 * 1. Marking the existing review log as deleted
 * 2. Writing the old version of the card
 * 3. Restoring sibling suspensions that this grade changed
 */
export async function undoGradeCard(): Promise<UndoGradeResult> {
  const undo = MemoryDB.getUndoStack().at(-1);
  if (!undo) {
    return { applied: false };
  }

  const card = MemoryDB.getCardById(undo.cardId);
  if (!card) {
    return { applied: false };
  }

  const now = Date.now();
  const reviewLogDeletedOperation: ReviewLogDeletedOperation = {
    type: "reviewLogDeleted",
    payload: {
      reviewLogId: undo.reviewLogId,
      deleted: true,
    },
    timestamp: now,
  };

  const cardOperation: CardOperation = {
    type: "card",
    payload: {
      id: undo.cardId,
      createdAt: card.createdAt,
      due: undo.card.due,
      stability: undo.card.stability,
      difficulty: undo.card.difficulty,
      elapsed_days: undo.card.elapsed_days,
      scheduled_days: undo.card.scheduled_days,
      learning_steps: undo.card.learning_steps,
      reps: undo.card.reps,
      lapses: undo.card.lapses,
      state: STATE_NUMBER_TO_NAME[undo.card.state],
      last_review: undo.card.last_review ?? null,
    },
    timestamp: now,
  };

  const siblingRestoreOps: CardSuspendedOperation[] = [];
  for (const change of undo.siblingSuspensions) {
    const sibling = MemoryDB.getCardById(change.cardId);
    // Keep any suspension changed after this grade, including manual changes.
    if (
      !sibling ||
      sibling.deleted ||
      sibling.cardSuspendedLastModified !== change.timestamp ||
      sibling.suspended?.getTime() !== change.suspended.getTime()
    )
      continue;

    const restoreOp: CardSuspendedOperation = {
      type: "cardSuspended",
      // Epoch is the existing wire representation of an unsuspended card.
      payload: {
        cardId: change.cardId,
        suspended: change.previousSuspended ?? new Date(0),
      },
      timestamp: Math.max(now, sibling.cardSuspendedLastModified + 1),
    };
    siblingRestoreOps.push(restoreOp);
  }

  const operations = [
    structuredClone(cardOperation),
    structuredClone(reviewLogDeletedOperation),
    ...siblingRestoreOps.map((op) => structuredClone(op)),
  ];

  await persistFormOperations(operations);
  MemoryDB.popUndoGrade();
  MemoryDB.notify();

  reviewSession.restore(MemoryDB.getCardById(undo.cardId));
  return { applied: true };
}

export async function createNewDeck(name: string, description: string) {
  const deckOperation: DeckOperation = {
    type: "deck",
    payload: {
      id: crypto.randomUUID(),
      name,
      description,
      deleted: false,
    },
    timestamp: Date.now(),
  };

  await persistFormOperations([deckOperation]);
}

// Commit the durable operation and sync queue together before publishing form
// changes. A storage failure must leave both the database and the UI unchanged.
async function persistFormOperations(operations: Operation[]) {
  await memoryReady;
  await withSyncLock(async () => {
    assertLocalWritesAllowed();
    const rows = operations.map(toStoredOperation);
    await db.transaction(
      "rw",
      db.operations,
      db.reviewLogOperations,
      db._sync_outbox,
      async () => {
        for (const row of rows) {
          const table =
            row.type === "reviewLog" || row.type === "reviewLogDeleted"
              ? db.reviewLogOperations
              : db.operations;
          await table.put(row);
        }
      },
    );
    for (const row of rows) handleClientOperation(row);
    MemoryDB.notify();
    broadcastRecordsChanged();
  });
}

type OperationResult = {
  applied: boolean;
};

function handleCardOperation(operation: CardOperation): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.id);

  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.id,
      due: operation.payload.due,
      stability: operation.payload.stability,
      difficulty: operation.payload.difficulty,
      elapsed_days: operation.payload.elapsed_days,
      scheduled_days: operation.payload.scheduled_days,
      learning_steps: operation.payload.learning_steps,
      reps: operation.payload.reps,
      lapses: operation.payload.lapses,
      state: STATE_NAME_TO_NUMBER[operation.payload.state],
      last_review: operation.payload.last_review ?? undefined,

      createdAt: operation.payload.createdAt ?? operation.timestamp,

      // CRDT metadata
      cardLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,

    due: operation.payload.due,
    stability: operation.payload.stability,
    difficulty: operation.payload.difficulty,
    elapsed_days: operation.payload.elapsed_days,
    scheduled_days: operation.payload.scheduled_days,
    learning_steps: operation.payload.learning_steps,
    reps: operation.payload.reps,
    lapses: operation.payload.lapses,
    state: STATE_NAME_TO_NUMBER[operation.payload.state],
    last_review: operation.payload.last_review ?? undefined,

    cardLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleCardContentOperation(
  operation: CardContentOperation,
): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.cardId);
  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.cardId,
      front: operation.payload.front,
      back: operation.payload.back,

      cardContentLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,
    front: operation.payload.front,
    back: operation.payload.back,
    cardContentLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleCardDeletedOperation(
  operation: CardDeletedOperation,
): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.cardId);

  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.cardId,
      deleted: operation.payload.deleted,

      cardDeletedLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,
    deleted: operation.payload.deleted,
    cardDeletedLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleCardBookmarkedOperation(
  operation: CardBookmarkedOperation,
): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.cardId);

  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.cardId,
      bookmarked: operation.payload.bookmarked,
      cardBookmarkedLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,
    bookmarked: operation.payload.bookmarked,
    cardBookmarkedLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleCardSuspendedOperation(
  operation: CardSuspendedOperation,
): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.cardId);

  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.cardId,
      suspended: operation.payload.suspended,
      cardSuspendedLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,
    suspended: operation.payload.suspended,
    cardSuspendedLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleCardMetadataOperation(
  operation: CardMetadataOperation,
): OperationResult {
  const card = MemoryDB.getCardById(operation.payload.cardId);

  if (!card) {
    MemoryDB.putCard({
      ...defaultCard,
      id: operation.payload.cardId,
      noteId: operation.payload.noteId,
      siblingTag: operation.payload.siblingTag,
      cardMetadataLastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedCard = {
    ...card,
    noteId: operation.payload.noteId,
    siblingTag: operation.payload.siblingTag,
    cardMetadataLastModified: operation.timestamp,
  };

  MemoryDB.putCard(updatedCard);
  return { applied: true };
}

function handleDeckOperation(operation: DeckOperation): OperationResult {
  const deck = MemoryDB.getDeckById(operation.payload.id);

  if (!deck) {
    MemoryDB.putDeck({
      ...defaultDeck,
      id: operation.payload.id,
      name: operation.payload.name,
      description: operation.payload.description,
      deleted: operation.payload.deleted,
      lastModified: operation.timestamp,
    });
    return { applied: true };
  }

  const updatedDeck: Deck = {
    ...deck,
    name: operation.payload.name,
    description: operation.payload.description,
    deleted: operation.payload.deleted,
    lastModified: operation.timestamp,
  };
  MemoryDB.putDeck(updatedDeck);
  return { applied: true };
}

function handleUpdateDeckCardOperation(
  operation: UpdateDeckCardOperation,
): OperationResult {
  const { deckId, cardId, present } = operation.payload;
  const cards = (MemoryDB._db.decksToCards[deckId] ??= {});
  cards[cardId] = present ? 1 : 0;
  return { applied: true };
}

export function handleClientOperation(operation: Operation): OperationResult {
  switch (operation.type) {
    case "card":
      return handleCardOperation(operation);
    case "cardContent":
      return handleCardContentOperation(operation);
    case "cardDeleted":
      return handleCardDeletedOperation(operation);
    case "cardBookmarked":
      return handleCardBookmarkedOperation(operation);
    case "cardSuspended":
      return handleCardSuspendedOperation(operation);
    case "cardMetadata":
      return handleCardMetadataOperation(operation);
    case "deck":
      return handleDeckOperation(operation);
    case "updateDeckCard":
      return handleUpdateDeckCardOperation(operation);
    case "reviewLog":
      return { applied: false };
    case "reviewLogDeleted":
      return { applied: false };
    default:
      throw new Error(`Unknown operation type: ${JSON.stringify(operation)}`);
  }
}

async function handleClientOperationWithPersistence(
  operation: Operation,
): Promise<OperationResult> {
  await persistFormOperations([operation]);
  return { applied: true };
}

export async function updateDeletedClientSide(
  cardId: string,
  deleted: boolean,
) {
  const card = MemoryDB.getCardById(cardId);
  if (!card) {
    return;
  }

  const cardOperation: CardDeletedOperation = {
    type: "cardDeleted",
    payload: {
      cardId,
      deleted,
    },
    timestamp: Date.now(),
  };
  await handleClientOperationWithPersistence(cardOperation);
}

export async function updateSuspendedClientSide(
  cardId: string,
  suspended: Date,
) {
  const card = MemoryDB.getCardById(cardId);
  if (!card) {
    return;
  }

  const cardOperation: CardSuspendedOperation = {
    type: "cardSuspended",
    payload: {
      cardId,
      suspended,
    },
    timestamp: Math.max(Date.now(), card.cardSuspendedLastModified + 1),
  };
  await handleClientOperationWithPersistence(cardOperation);
}

export async function updateBookmarkedClientSide(
  cardId: string,
  bookmarked: boolean,
) {
  const card = MemoryDB.getCardById(cardId);
  if (!card) {
    return;
  }

  const cardOperation: CardBookmarkedOperation = {
    type: "cardBookmarked",
    payload: {
      cardId,
      bookmarked,
    },
    timestamp: Date.now(),
  };
  await handleClientOperationWithPersistence(cardOperation);
}
