import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { tokens } from "../../theme.stylex";
import { ChangeTotals } from "../ChangeTotals";
import { CommitCard } from "../CommitCard";
import { DiffStat } from "../DiffStat";
import { HistoryPanel } from "../HistoryPanel";
import { NoteCard } from "../NoteCard";
import { changedFiles, commitDetails, commits, loadCommitDetails, notes } from "./fixtures";
import { Section, Specimen } from "./Specimen";

function History() {
  const [selected, setSelected] = useState(commits[3]!.id);
  const [working, setWorking] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  return (
    // The panel takes 43% of the app's sidebar; this frame shows that share.
    <div {...stylex.props(styles.historyFrame)}>
      <div {...stylex.props(styles.history)}>
        <HistoryPanel
          commits={commits}
          selected={working ? undefined : selected}
          loading={false}
          hasMore={false}
          error={null}
          onSelect={(id) => {
            setWorking(false);
            setSelected(id);
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
      <Specimen title="Comment thread" note="A note with one reply" span="half">
        <NoteCard note={notes[0]!} replies={notes.slice(1)} onMutate={async () => {}} />
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
  cards: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 16 },
  // The same surface as the history tooltip.
  card: {
    backgroundColor: tokens.raised,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: 10,
    boxShadow: tokens.shadow,
  },
});
