import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionSummary } from "../../../shared/session-summary";
import { useAgentInbox } from "../../data/agent-inbox";
import { useSessionSummaries } from "../../data/agent-status";
import { useDocumentTitle } from "../../data/document-title";
import { sendOwnedAction } from "../../data/owned-session";
import { visibleElement } from "../../data/palette-focus";
import { useTitleBarOverlay } from "../../data/title-bar";
import { SESSIONS_PATH } from "../../data/workspaces";
import { useHostFetch, useWorkspaceActions } from "../Workspaces";
import { OpenReviewButton, SessionsView, sortSessions } from "./SessionsView";

const SessionPanel = lazy(() =>
  import("../session/SessionPanel").then((module) => ({ default: module.SessionPanel })),
);

const route = () => ({
  shown: location.pathname === SESSIONS_PATH,
  review: new URLSearchParams(location.search).get("review"),
});

/**
 * The Sessions page at /sessions, over the workspaces. They stay mounted
 * beneath it, so a review keeps its place, and one that never showed loads
 * once the page leaves.
 */
export function SessionsRoute({ children }: { children: ReactNode }) {
  const [state, setState] = useState(route);
  const [mounted, setMounted] = useState(() => !route().shown);
  if (!state.shown && !mounted) setMounted(true);
  useEffect(() => {
    const follow = () => setState(route());
    window.addEventListener("popstate", follow);
    window.addEventListener("med:location", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("med:location", follow);
    };
  }, []);
  return (
    <>
      {mounted && (
        <div
          inert={state.shown}
          style={{ height: "100%", display: state.shown ? "none" : undefined }}
        >
          {children}
        </div>
      )}
      {/* The review's own shortcuts stand down under the page, as under Sources. */}
      {state.shown && (
        <div
          data-standalone-files
          style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
          <SessionsPage selected={state.review} />
        </div>
      )}
    </>
  );
}

/** The window's agent sessions: one for each saved review in its workspace list. */
function SessionsPage({ selected }: { selected: string | null }) {
  const actions = useWorkspaceActions();
  const fetcher = useHostFetch();
  const tab = useTitleBarOverlay();
  useDocumentTitle("Sessions", 2);
  const [snapshot, setSnapshot] = useState(() => actions?.getSnapshot());
  useEffect(() => actions?.subscribe(() => setSnapshot(actions.getSnapshot())), [actions]);
  const reviews = useMemo(
    () => snapshot?.workspaces.flatMap((entry) => (entry.kind === "review" ? [entry] : [])) ?? [],
    [snapshot],
  );
  const { summaries, loaded } = useSessionSummaries(
    useMemo(() => reviews.map((entry) => entry.reviewId), [reviews]),
    fetcher,
  );
  const sessions = useMemo(() => sortSessions([...summaries.values()]), [summaries]);
  const unread = useMemo(
    () => new Set(reviews.filter((entry) => entry.unread).map((entry) => entry.reviewId)),
    [reviews],
  );
  // Ages and turn times move while the page shows.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const select = useCallback((review: string | null) => {
    const url = review ? `${SESSIONS_PATH}?${new URLSearchParams({ review })}` : SESSIONS_PATH;
    if (location.pathname + location.search === url) return;
    // The Desk is a step of its own in history; leaving it goes back to the Board.
    const fromDesk = new URLSearchParams(location.search).has("review");
    if (!review && fromDesk && (history.state as { desk?: boolean } | null)?.desk) history.back();
    else if (review && fromDesk) history.replaceState({ desk: true }, "", url);
    else history.pushState(review ? { desk: true } : null, "", url);
    window.dispatchEvent(new Event("med:location"));
  }, []);
  const back = useCallback(() => {
    const active = actions?.getSnapshot().active;
    if (actions && active) actions.activate(active);
    else location.assign("/");
  }, [actions]);
  const openReview = useCallback(
    (reviewId: string) => {
      if (!actions) return location.assign(`/review/${encodeURIComponent(reviewId)}`);
      const title = summaries.get(reviewId)?.title;
      actions.open({ kind: "review", reviewId, ...(title && { title }) });
    },
    [actions, summaries],
  );
  // Escape leaves the Desk for the Board, then the page, as it closes other overlays.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (visibleElement('[role="dialog"], [role="menu"]')) return;
      if ((event.target as HTMLElement).closest?.("textarea, input, [contenteditable]")) return;
      event.preventDefault();
      if (selected) select(null);
      else back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, select, back]);

  return (
    <SessionsView
      sessions={sessions}
      loaded={loaded}
      now={now}
      unread={unread}
      tab={tab}
      selected={selected}
      onSelect={select}
      onBack={back}
      onOpenReview={openReview}
      onAnswer={(summary, option) => {
        if (summary.ask?.kind !== "permission") return;
        void sendOwnedAction(
          summary.reviewId,
          summary.sessionId,
          { action: "permission", id: summary.ask.permission.id, option },
          fetcher,
        ).catch(() => {});
      }}
      renderSession={(summary) => (
        <DeskSession
          key={summary.reviewId}
          summary={summary}
          fetcher={fetcher}
          onOpenReview={() => openReview(summary.reviewId)}
          onClose={() => select(null)}
        />
      )}
    />
  );
}

/** The chosen session in the Desk: the review's Session pane, with its replies. */
function DeskSession({
  summary,
  fetcher,
  onOpenReview,
  onClose,
}: {
  summary: SessionSummary;
  fetcher: typeof fetch;
  onOpenReview(): void;
  onClose(): void;
}) {
  const inbox = useAgentInbox(summary.reviewId, fetcher);
  return (
    <Suspense fallback={null}>
      <SessionPanel
        reviewId={summary.reviewId}
        sessions={summary.sessions}
        root={summary.root}
        fetcher={fetcher}
        inbox={inbox}
        // A file link opens the review, where its files are.
        onOpenPath={onOpenReview}
        onClose={onClose}
        controls={<OpenReviewButton onClick={onOpenReview} />}
      />
    </Suspense>
  );
}
