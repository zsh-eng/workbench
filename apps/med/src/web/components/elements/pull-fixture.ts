import type { PullJob, PullStep } from "../../../shared/pull-workspace";

export const DEMO_PULL_URL = "https://github.com/acme/trail-notes/pull/42";
const TITLE = "Show durations as minutes";
const WORKTREE = "~/.local/state/med/worktrees/trail-notes-5f1c2a9e/pr-42";
const MISSING = "Add a clone of acme/trail-notes to Med, then open the link again.";

function steps(agent?: string): PullStep[] {
  return [
    { id: "repository", label: "Find acme/trail-notes", state: "pending" },
    { id: "pull", label: "Read pull request #42", state: "pending" },
    { id: "worktree", label: "Make a worktree", state: "pending" },
    { id: "checkout", label: "Check out the branch", state: "pending" },
    { id: "base", label: "Fetch the base branch", state: "pending" },
    { id: "review", label: "Save the review", state: "pending" },
    ...(agent
      ? [{ id: "agent" as const, label: `Start ${agent}`, state: "pending" as const }]
      : []),
  ];
}

type Change = { step?: PullStep["id"]; patch?: Partial<PullStep>; job?: Partial<PullJob> };

/** The job's state after each change, timed by the clock at `now`. */
function apply(job: PullJob, changes: Change[], now: number): PullJob {
  return changes.reduce<PullJob>((current, { step, patch, job: jobPatch }) => {
    const next = { ...current, ...jobPatch };
    if (!step || !patch) return next;
    return {
      ...next,
      steps: next.steps.map((entry) =>
        entry.id === step
          ? {
              ...entry,
              ...patch,
              ...(patch.state === "running" ? { startedAt: now } : {}),
              ...(patch.state && patch.state !== "running" ? { endedAt: now } : {}),
            }
          : entry,
      ),
    };
  }, job);
}

/** Opening the pull request, step by step, with the time each change comes. */
function script(agent?: string, fail?: boolean): [number, Change[]][] {
  if (fail)
    return [
      [0, [{ step: "repository", patch: { state: "running" } }]],
      [
        900,
        [
          { step: "repository", patch: { state: "failed" } },
          { job: { status: "failed", error: MISSING } },
        ],
      ],
    ];
  return [
    [0, [{ step: "repository", patch: { state: "running" } }]],
    [
      600,
      [
        { step: "repository", patch: { state: "done", detail: "~/work/trail-notes" } },
        { step: "pull", patch: { state: "running" } },
      ],
    ],
    [
      1400,
      [
        { step: "pull", patch: { state: "done", detail: TITLE } },
        { job: { title: TITLE } },
        { step: "checkout", patch: { label: "Check out durations" } },
        { step: "base", patch: { label: "Fetch main" } },
        { step: "worktree", patch: { state: "running" } },
      ],
    ],
    [
      2200,
      [
        { step: "worktree", patch: { state: "done", detail: WORKTREE } },
        { step: "checkout", patch: { state: "running" } },
      ],
    ],
    [
      3800,
      [
        { step: "checkout", patch: { state: "done", detail: "durations" } },
        { step: "base", patch: { state: "skipped", detail: "Already here" } },
        { step: "review", patch: { state: "running" } },
      ],
    ],
    [
      4700,
      [
        { step: "review", patch: { state: "done" } },
        { job: { reviewId: "r_demo42", worktree: WORKTREE } },
        ...(agent ? [{ step: "agent" as const, patch: { state: "running" as const } }] : []),
      ],
    ],
    ...(agent
      ? ([[5500, [{ step: "agent", patch: { state: "done" } }, { job: { status: "done" } }]]] as [
          number,
          Change[],
        ][])
      : ([[4700, [{ job: { status: "done" } }]]] as [number, Change[]][])),
  ];
}

/** A pull request's state at one moment, for still specimens. */
export function demoPullJob(stage: "checkout" | "failed", now: number): PullJob {
  const base: PullJob = {
    id: `still-${stage}`,
    url: DEMO_PULL_URL,
    slug: "acme/trail-notes",
    number: 42,
    status: "running",
    steps: steps("Claude Code"),
  };
  const timeline = script("Claude Code", stage === "failed");
  const until = stage === "failed" ? Infinity : 2200;
  return timeline
    .filter(([at]) => at <= until)
    .reduce((job, [at, changes]) => apply(job, changes, now - 5000 + at), base);
}

/**
 * A scripted pull request job behind a fake host: the Elements page shows the
 * real workspace row and progress while the job's steps advance.
 */
export function createDemoPull() {
  let job: PullJob | undefined;
  let count = 0;
  let current: { jobId?: string; agent: boolean } = { agent: true };
  const runListeners = new Set<() => void>();
  const listeners = new Set<() => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const encoder = new TextEncoder();
  const publish = (next: PullJob) => {
    job = next;
    for (const listener of listeners) listener();
  };
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input), location.origin).pathname;
    const id = /^\/api\/pulls\/([^/]+)\/events$/.exec(path)?.[1];
    if (!id || id !== job?.id)
      return Response.json({ error: { message: "Not in the demo." } }, { status: 404 });
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const push = () => {
          if (job?.id === id)
            controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify(job)}\n\n`));
        };
        stop = () => {
          listeners.delete(push);
          try {
            controller.close();
          } catch {
            /* The reader cancelled the stream. */
          }
        };
        listeners.add(push);
        push();
        init?.signal?.addEventListener("abort", stop, { once: true });
      },
      cancel: () => stop(),
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  };
  const dispose = () => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  };
  return {
    fetcher,
    /** The job that runs now, and whether it starts an agent. */
    getRun: () => current,
    subscribeRun(listener: () => void) {
      runListeners.add(listener);
      return () => void runListeners.delete(listener);
    },
    /** Starts the job again. */
    run(agent?: string, fail?: boolean) {
      dispose();
      const id = `demo-${++count}`;
      let state: PullJob = {
        id,
        url: DEMO_PULL_URL,
        slug: "acme/trail-notes",
        number: 42,
        status: "running",
        steps: steps(agent),
      };
      publish(state);
      current = { jobId: id, agent: !!agent };
      for (const listener of runListeners) listener();
      for (const [at, changes] of script(agent, fail))
        timers.add(
          setTimeout(() => {
            state = apply(state, changes, Date.now());
            publish(state);
          }, at),
        );
    },
    dispose,
  };
}
