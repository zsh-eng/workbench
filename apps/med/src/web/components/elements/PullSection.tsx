import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePullJob } from "../../data/pull-jobs";
import { tokens, ui } from "../../theme.stylex";
import { BranchPicker } from "../BranchPicker";
import { Icon } from "../Icon";
import { PullProgress } from "../PullWorkspace";
import { createDemoPull, DEMO_PULL_URL, demoPullJob } from "./pull-fixture";
import { Section, Specimen } from "./Specimen";

const AGENTS = [
  { id: "claude", name: "Claude Code" },
  { id: "opencode", name: "OpenCode" },
];
const STILL_NOW = Date.UTC(2026, 9, 10, 12);

/** The real progress, driven by a scripted host job. */
function OpeningDemo() {
  const [demo] = useState(createDemoPull);
  const run = useSyncExternalStore(demo.subscribeRun, demo.getRun);
  useEffect(() => {
    demo.run("Claude Code");
    return () => demo.dispose();
  }, [demo]);
  const job = usePullJob(run.jobId, demo.fetcher);
  const known = job && job !== "lost" ? job : undefined;
  const [picker, setPicker] = useState(false);
  const replay = (agent: boolean, fail = false) =>
    demo.run(agent ? "Claude Code" : undefined, fail);
  return (
    <div {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.controls)}>
        <button
          type="button"
          onClick={() => setPicker(true)}
          {...stylex.props(ui.button, ui.outlined)}
        >
          <Icon name="plus" size={13} />
          New workspace…
        </button>
        <button type="button" onClick={() => replay(true)} {...stylex.props(ui.button)}>
          Replay with Claude Code
        </button>
        <button type="button" onClick={() => replay(false)} {...stylex.props(ui.button)}>
          Replay without an agent
        </button>
        <button type="button" onClick={() => replay(false, true)} {...stylex.props(ui.button)}>
          Replay a failure
        </button>
      </div>
      <div {...stylex.props(styles.frame)}>
        <div {...stylex.props(styles.main)}>
          <PullProgress
            url={DEMO_PULL_URL}
            state={{ job: known }}
            onRetry={() => replay(run.agent)}
          />
        </div>
      </div>
      <BranchPicker
        repositories={[]}
        entries={[]}
        open={picker}
        onOpenChange={setPicker}
        onSelect={() => {}}
        onAddRepository={async () => {}}
        onRemoveRepository={async () => {}}
        onRefresh={async () => {}}
        workspaces="new"
        agents={AGENTS}
        initialQuery={DEMO_PULL_URL}
        onPullRequest={(_, agent) => replay(!!agent)}
      />
    </div>
  );
}

/**
 * A GitHub pull request link opens a workspace at once. The host finds the
 * repository by its remotes, checks the pull request out in a worktree of its
 * own, saves the review, and can start an agent there to review it.
 */
export function PullSection() {
  return (
    <Section
      id="pull-requests"
      title="Pull request workspaces"
      lede="Paste a GitHub pull request link in New workspace. The workspace appears at once with a placeholder title; the host checks the pull request out in a worktree of its own, so your checkout stays as it is. It becomes a thread when the review is saved, and an agent can start there to review it."
    >
      <Specimen
        title="Opening a pull request"
        note="The real progress, with a scripted host. New workspace… opens the picker with a link pasted."
        padded={false}
        zoomable={false}
      >
        <OpeningDemo />
      </Specimen>
      <Specimen title="Checking out" note="A step that takes time shows how long." span="half">
        <PullProgress
          url={DEMO_PULL_URL}
          state={{ job: demoPullJob("checkout", STILL_NOW) }}
          now={STILL_NOW}
        />
      </Specimen>
      <Specimen
        title="Could not open it"
        note="The failed step, what to do, and Retry."
        span="half"
      >
        <PullProgress
          url={DEMO_PULL_URL}
          state={{ job: demoPullJob("failed", STILL_NOW) }}
          now={STILL_NOW}
          onRetry={() => {}}
        />
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column" },
  controls: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    padding: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  frame: {
    display: "flex",
    gap: 6,
    height: 440,
    padding: 6,
    backgroundColor: tokens.panel,
  },
  main: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "auto",
    paddingBlock: 36,
    paddingInline: 24,
    backgroundColor: tokens.canvas,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
  },
});
