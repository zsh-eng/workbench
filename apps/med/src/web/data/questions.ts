import type { FileDiffMetadata } from "@pierre/diffs";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_QUESTION_LINES,
  questionRoutes,
  questionStateSchema,
  type QuestionExcerpt,
  type QuestionState,
} from "../../shared/questions";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { patchRows } from "./brief";
import { browserFetch } from "./live";
import { readServerEvents } from "./sse";

/** The lines of one side of a file, as the review shows them, with their
 * numbers and marks. Lines outside the diff's hunks are not in it. */
export function questionExcerpt(
  path: string,
  metadata: FileDiffMetadata | null | undefined,
  side: "old" | "new",
  start: number,
  end: number,
): QuestionExcerpt {
  const lines = (metadata ? patchRows(metadata) : [])
    .filter((row) =>
      side === "new"
        ? row.kind !== "-" && row.new >= start && row.new <= end
        : row.kind !== "+" && row.old >= start && row.old <= end,
    )
    .slice(0, MAX_QUESTION_LINES)
    .map((row) => ({
      number: side === "new" ? row.new : row.old,
      mark: row.kind,
      text: row.text.replace(/\r?\n$/, "").slice(0, 4000),
    }));
  return { path, side, start, end, lines };
}

/** What a question is about, and where its answer can go as a comment. */
export interface QuestionTarget {
  /** The thread, for the host: a saved review's ID or a found thread's. */
  thread: string;
  /** The agent's name, such as Claude or Codex. */
  agent: string;
  /** The review whose comments Keep adds to. */
  reviewId: string | undefined;
  note: { path: string; side: "old" | "new"; line: number; endLine: number };
  excerpt: QuestionExcerpt;
}

export interface QuestionView {
  /** A new number for each Ask, so the box starts empty. */
  key: number;
  target: QuestionTarget;
  /** The question as sent; none while the box is unsent. */
  asked?: string;
  /** The host's state of the question, as it streams. */
  state?: QuestionState;
  /** A request that failed, such as the ask itself. */
  error?: string;
  sending?: boolean;
}

/** Whether a question's answer is still coming. */
export const answering = (view: QuestionView | null) =>
  !!view &&
  (!!view.sending || view.state?.status === "starting" || view.state?.status === "answering");

let sequence = 0;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * One question for a workspace: the box, the answer as it streams, Stop, and
 * Close. A new Ask replaces a question whose answer has ended or that was not
 * sent; while an answer streams, Ask waits.
 */
export function useQuestion(fetcher: typeof fetch = browserFetch) {
  const [view, setView] = useState<QuestionView | null>(null);
  const current = useRef(view);
  useEffect(() => {
    current.current = view;
  }, [view]);
  const api = useCallback(() => createApi(fetcher, readBrowserToken()), [fetcher]);
  const id = view?.state?.id;

  // The answer streams while the workspace shows; a hidden one reads it again.
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void (async () => {
      const response = await api().stream(`/api/questions/${id}/events`, controller.signal);
      // A question that the host closed keeps what it showed.
      if (!response.ok || !response.body) return;
      await readServerEvents(
        response.body,
        (event) => {
          if (event.event !== "state") return;
          const parsed = questionStateSchema.safeParse(JSON.parse(event.data));
          if (parsed.success)
            setView((value) =>
              value?.state?.id === parsed.data.id ? { ...value, state: parsed.data } : value,
            );
        },
        controller.signal,
        1024 * 1024,
      );
    })().catch(() => {});
    return () => controller.abort();
  }, [id, api]);

  /** Opens the box for a target. False while an answer streams. */
  const open = useCallback(
    (target: QuestionTarget) => {
      const before = current.current;
      if (answering(before)) return false;
      const old = before?.state?.id;
      if (old)
        void api()
          .call(questionRoutes.close, { id: old })
          .catch(() => {});
      setView({ key: ++sequence, target });
      return true;
    },
    [api],
  );

  const send = useCallback(
    async (question: string) => {
      const value = current.current;
      if (!value || value.asked || value.sending || !question.trim()) return;
      const { key, target } = value;
      setView({ ...value, sending: true, error: undefined });
      try {
        const state = await api().call(questionRoutes.ask, {
          thread: target.thread,
          question,
          excerpt: target.excerpt,
        });
        setView((latest) =>
          latest?.key === key
            ? { ...latest, asked: question.trim(), state, sending: false }
            : latest,
        );
      } catch (error) {
        setView((latest) =>
          latest?.key === key ? { ...latest, sending: false, error: message(error) } : latest,
        );
      }
    },
    [api],
  );

  const stop = useCallback(async () => {
    const state = current.current?.state;
    if (!state) return;
    try {
      const stopped = await api().call(questionRoutes.stop, { id: state.id });
      setView((latest) =>
        latest?.state?.id === stopped.id ? { ...latest, state: stopped } : latest,
      );
    } catch (error) {
      setView((latest) => (latest ? { ...latest, error: message(error) } : latest));
    }
  }, [api]);

  /** Discards the question: the host forgets it and removes its fork. */
  const discard = useCallback(() => {
    const old = current.current?.state?.id;
    if (old)
      void api()
        .call(questionRoutes.close, { id: old })
        .catch(() => {});
    current.current = null;
    setView(null);
  }, [api]);

  const fail = useCallback(
    (error: string) => setView((latest) => (latest ? { ...latest, error } : latest)),
    [],
  );

  return { view, busy: answering(view), open, send, stop, discard, fail };
}
export type QuestionControls = ReturnType<typeof useQuestion>;
