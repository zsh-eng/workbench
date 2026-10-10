import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { tokens } from "../../theme.stylex";
import { ChangeTotals } from "../ChangeTotals";
import { CommitCard } from "../CommitCard";
import { DiffStat } from "../DiffStat";
import { HistoryPanel } from "../HistoryPanel";
import { NoteCard } from "../NoteCard";
import {
  CodexFindingCard,
  CodexPanelContent,
  PanelContent,
  PullRequestThreadCard,
} from "../PullRequestComments";
import type { CodexFinding } from "../../../shared/codex-review";
import type { Note, PullRequestThread } from "../../../shared/protocol";
import { Diff } from "./CodeSection";
import {
  changedFiles,
  codexReview,
  commitDetails,
  commits,
  loadCommitDetails,
  notes,
  pullRequest,
  relativeTimePatch,
} from "./fixtures";
import { Section, Specimen } from "./Specimen";

function History() {
  const [selected, setSelected] = useState(commits[3]!.id);
  const [range, setRange] = useState<{ base: string; head: string }>();
  const [working, setWorking] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    // The panel takes 43% of the app's sidebar; this frame shows that share.
    <div {...stylex.props(styles.historyFrame)}>
      <div {...stylex.props(styles.history)}>
        <HistoryPanel
          commits={commits}
          selected={working ? undefined : selected}
          selectedRange={working ? undefined : range}
          loading={false}
          hasMore={false}
          error={null}
          onSelect={(id) => {
            setWorking(false);
            setRange(undefined);
            setSelected(id);
          }}
          onSelectRange={(base, head) => {
            setWorking(false);
            setRange({ base, head });
          }}
          onLoadMore={() => {}}
          onWorking={() => setWorking(true)}
          working={working}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          loadDetails={loadCommitDetails}
        />
      </div>
    </div>
  );
}

export function ReviewSection() {
  const [now] = useState(Date.now);
  return (
    <Section
      id="review"
      title="Review parts"
      lede="History, comments, and change totals with sample data. They are the components the review uses, so changes here show in the app."
    >
      <Specimen
        title="History"
        note="Hover a commit for its card. Shift-click selects a range."
        surface="panel"
        span="half"
        padded={false}
      >
        <History />
      </Specimen>
      <Specimen
        title="Commit card"
        note="Opens on a history row. The avatar and type chip take the commit's graph-lane color."
        surface="panel"
        span="half"
      >
        <div {...stylex.props(styles.cards)}>
          {[
            { commit: commits[3]!, color: tokens.accent },
            { commit: commits[2]!, color: `color-mix(in oklch, ${tokens.accent} 45%, #43c6b4)` },
            { commit: commits[1]!, color: tokens.accent },
          ].map(({ commit, color }) => (
            <div key={commit.id} {...stylex.props(styles.card)}>
              <CommitCard
                commit={commit}
                color={color}
                details={commitDetails(commit.id)}
                now={now}
              />
            </div>
          ))}
          <div {...stylex.props(styles.card)}>
            <CommitCard commit={commits[0]!} color={tokens.accent} now={now} />
          </div>
        </div>
      </Specimen>
      <Specimen title="Local note" note="A note with one reply. Notes stay in Med." span="half">
        <NoteCard note={notes[0]!} replies={notes.slice(1)} onMutate={async () => {}} />
      </Specimen>
      <Specimen
        title="GitHub thread"
        note="Read-only. Copy it, or open it on GitHub to reply."
        span="half"
      >
        <PullRequestThreadCard thread={pullRequest.threads[0]!} now={now} />
      </Specimen>
      <Specimen
        title="Comments in the diff"
        note="A GitHub thread, a Codex finding, and a local note on the same change, as the review shows them."
        padded={false}
      >
        <Diff<{ note?: Note; thread?: PullRequestThread; finding?: CodexFinding }>
          patch={relativeTimePatch}
          header
          annotations={[
            { side: "additions", lineNumber: notes[0]!.line, metadata: { note: notes[0]! } },
            {
              side: "additions",
              lineNumber: codexReview.findings[0]!.endLine,
              metadata: { finding: codexReview.findings[0]! },
            },
            {
              side: "additions",
              lineNumber: pullRequest.threads[0]!.line!,
              metadata: { thread: pullRequest.threads[0]! },
            },
          ]}
          renderAnnotation={({ metadata }) =>
            metadata?.thread ? (
              <PullRequestThreadCard thread={metadata.thread} now={now} />
            ) : metadata?.finding ? (
              <CodexFindingCard finding={metadata.finding} run={codexReview} now={now} />
            ) : metadata?.note ? (
              <NoteCard note={metadata.note} replies={notes.slice(1)} onMutate={async () => {}} />
            ) : null
          }
        />
      </Specimen>
      <Specimen
        title="Pull request panel"
        note="Opens from the count beside the pull request link: reviews, conversation, and threads the diff cannot show."
        span="half"
      >
        <div {...stylex.props(styles.card, styles.panel)}>
          <PanelContent
            data={pullRequest}
            error={null}
            loading={false}
            placement={{ kind: "inline", ids: new Set([pullRequest.threads[0]!.id]) }}
            now={now}
            onRefresh={() => {}}
          />
        </div>
      </Specimen>
      <Specimen
        title="Codex finding"
        note="From codex review or /review in the review's checkout. Read-only, with its priority."
        span="half"
      >
        <CodexFindingCard finding={codexReview.findings[0]!} run={codexReview} now={now} />
      </Specimen>
      <Specimen
        title="Codex review panel"
        note="Opens from the Codex count in the review header: each verdict, and findings the diff cannot show."
        span="half"
      >
        <div {...stylex.props(styles.card, styles.panel)}>
          <CodexPanelContent
            runs={[codexReview]}
            error={null}
            placement={{ inline: new Set([codexReview.findings[0]!.id]), reasons: new Map() }}
            now={now}
          />
        </div>
      </Specimen>
      <Specimen title="Pull request panel without gh" note="Med reads GitHub with gh." span="half">
        <div {...stylex.props(styles.card, styles.panel)}>
          <PanelContent
            data={null}
            error="Install the GitHub CLI (gh) and run gh auth login to show pull request comments."
            loading={false}
            placement={{ kind: "inline", ids: new Set() }}
            now={now}
            onRefresh={() => {}}
          />
        </div>
      </Specimen>
      <Specimen title="Change totals" note="Hover for the split by kind of file" span="half">
        <div {...stylex.props(styles.row)}>
          <ChangeTotals files={changedFiles} range="ab41597 → working" />
        </div>
      </Specimen>
      <Specimen title="Line counts" note="File rows and headers" span="half">
        <div {...stylex.props(styles.row)}>
          <DiffStat additions={184} deletions={22} />
          <DiffStat additions={12} deletions={0} />
          <DiffStat additions={0} deletions={41} />
        </div>
      </Specimen>
    </Section>
  );
}

const styles = stylex.create({
  historyFrame: { height: 420, overflow: "hidden" },
  history: {
    display: "flex",
    flexDirection: "column",
    height: 977,
    paddingTop: 4,
    backgroundColor: tokens.panel,
  },
  row: { display: "flex", alignItems: "center", gap: 16 },
  panel: { width: "min(460px, 100%)" },
  cards: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16 },
  // The same surface as the history tooltip.
  card: {
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: tokens.shadow,
  },
});
