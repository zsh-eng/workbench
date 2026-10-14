import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useState } from "react";
import { attemptLetter, type Attempt, type AttemptKept } from "../../../shared/attempts";
import type { Thread } from "../../../shared/threads";
import {
  attemptsOpenedHere,
  openAttempts,
  undoKeep,
  useAttemptsAddress,
  useAttemptsProblem,
} from "../../data/attempts";
import { browserFetch } from "../../data/live";
import type { WorkspaceInput } from "../../data/workspaces";
import { tokens } from "../../theme.stylex";
import { AttemptsPage } from "./AttemptsPage";

type Toast =
  | { kind: "kept"; result: AttemptKept; undoing?: boolean }
  | { kind: "message"; text: string; error?: boolean };

/** "A", "A and C". */
const letters = (attempts: { attempt: number }[]) => {
  const names = attempts.map((entry) => attemptLetter(entry.attempt));
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]!;
};

/** What Keep did, in one sentence after "Kept B." */
export function keptText(result: AttemptKept) {
  const others = letters(result.archived);
  const stopped = result.archived.filter((entry) => entry.stopped);
  const removed = result.archived.filter((entry) => entry.removed);
  const one = result.archived.length === 1;
  const parts = [
    stopped.length ? `Stopped ${letters(stopped)}, archived ${others}` : `Archived ${others}`,
  ];
  if (removed.length === result.archived.length)
    parts.push(one ? "and removed its worktree" : "and removed their worktrees");
  else if (removed.length) parts.push(`and removed the worktree of ${letters(removed)}`);
  return `${parts.join(" ")}.`;
}

/**
 * The Attempts page over the workspaces while the address names a group, and
 * the notice after Keep, which offers Undo.
 */
export function AttemptsHost({
  threads,
  fetcher = browserFetch,
  actions,
  onLeave,
}: {
  threads: readonly Thread[];
  fetcher?: typeof fetch;
  actions: { open(input: WorkspaceInput): void };
  /** Shows the workspace under the page, when no history entry is before it. */
  onLeave(): void;
}) {
  const group = useAttemptsAddress();
  const notice = useAttemptsProblem();
  const [toast, setToast] = useState<Toast | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!toast || held || (toast.kind === "kept" && toast.undoing)) return;
    const timer = setTimeout(
      () => setToast(null),
      toast.kind === "kept" ? 10_000 : toast.error ? 12_000 : 6000,
    );
    return () => clearTimeout(timer);
  }, [toast, held]);
  const back = useCallback(() => {
    if (attemptsOpenedHere()) history.back();
    else onLeave();
  }, [onLeave]);
  const open = (attempt: Attempt) =>
    actions.open({ kind: "review", reviewId: attempt.threadId, title: attempt.title });
  const kept = (result: AttemptKept) => {
    actions.open({ kind: "review", reviewId: result.threadId, title: result.title });
    setToast({ kind: "kept", result });
  };
  const undo = (result: AttemptKept) => {
    setToast({ kind: "kept", result, undoing: true });
    undoKeep(result.group, fetcher).then(
      (undone) => {
        setToast({ kind: "message", text: `Brought back ${undone.restored.join(", ")}.` });
        openAttempts(result.group);
      },
      (error: unknown) =>
        setToast({
          kind: "message",
          error: true,
          text: error instanceof Error ? error.message : "Undo did not complete.",
        }),
    );
  };
  return (
    <>
      {group && (
        <AttemptsPage
          key={group}
          group={group}
          threads={threads}
          fetcher={fetcher}
          {...(notice ? { notice } : {})}
          onBack={back}
          onOpen={open}
          onKept={kept}
          // The notice's Undo has nothing left to undo.
          onUndone={() => setToast((shown) => (shown?.kind === "kept" ? null : shown))}
        />
      )}
      {toast && (
        <div
          role={toast.kind === "message" && toast.error ? "alert" : "status"}
          onPointerEnter={() => setHeld(true)}
          onPointerLeave={() => setHeld(false)}
          {...stylex.props(
            styles.toast,
            toast.kind === "kept" && toast.result.notes.length > 0 && styles.wide,
          )}
        >
          {toast.kind === "kept" ? (
            <>
              <span {...stylex.props(styles.text)}>
                Kept {attemptLetter(toast.result.attempt)}. {keptText(toast.result)}
                {toast.result.notes.map((note) => (
                  <span key={note} {...stylex.props(styles.note)}>
                    {note}
                  </span>
                ))}
              </span>
              <button
                type="button"
                disabled={toast.undoing}
                onClick={() => undo(toast.result)}
                {...stylex.props(styles.action)}
              >
                {toast.undoing ? "Undoing…" : "Undo"}
              </button>
            </>
          ) : (
            <span {...stylex.props(styles.text)}>{toast.text}</span>
          )}
        </div>
      )}
    </>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translate(-50%, 6px)" },
  to: { opacity: 1, transform: "translate(-50%, 0)" },
});
const fade = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  toast: {
    position: "fixed",
    left: "50%",
    bottom: 44,
    zIndex: 120,
    display: "flex",
    alignItems: "center",
    gap: 8,
    maxWidth: "calc(100vw - 32px)",
    minHeight: 34,
    boxSizing: "border-box",
    paddingBlock: 5,
    paddingInlineStart: 13,
    paddingInlineEnd: 6,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 12px 32px -14px rgb(0 0 0 / 0.5)`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    transform: "translateX(-50%)",
    animationName: { default: rise, [reduced]: fade },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
  wide: { width: "min(560px, calc(100vw - 32px))" },
  text: { flex: "1", minWidth: 0, marginInlineEnd: 4, lineHeight: 1.45 },
  note: { display: "block", color: tokens.muted },
  action: {
    flexShrink: 0,
    height: 24,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: tokens.fill, ":hover:not(:disabled)": tokens.fillStrong },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    opacity: { default: 1, ":disabled": 0.6 },
  },
});
