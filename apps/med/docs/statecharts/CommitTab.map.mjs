// Chart labels for CommitTab, for statechart.mjs. The labels say what the
// reader sees on the Commit tab and in its dialog.

// The steps that the reader takes. Another program's work is not Med's.
export const readerActions = ["Space", "PressCommit", "OtherNewFile", "OtherEdits", "OtherStages"];

const NONE = 99;
const names = (set) => (set.length ? [...set].sort().join(", ") : "nothing");
const same = (x, y) => x.length === y.length && x.every((item) => y.includes(item));
const version = (content) => (content === 0 ? "a as you wrote it" : "a as the agent wrote it");

// The label for one model state.
export function state(v) {
  const notes = [];
  let label;
  if (v.head > 0) {
    label = `Committed ${names(v.committed)}`;
    if (!same(v.committed, v.counted)) notes.push(`the dialog counted ${names(v.counted)}`);
    if (v.holds !== NONE && v.holds !== v.saw) notes.push(`the commit has ${version(v.holds)}`);
    return notes.length ? `${label} (${notes.join(", ")})` : label;
  } else if (v.commit.at === "none") {
    const staged =
      v.stage.at === "sent" ? [...new Set([...v.view.staged, v.stage.file])] : v.view.staged;
    label = staged.length
      ? `Shows ${names(staged)} staged`
      : `Shows ${names(v.view.files)}, nothing staged`;
    if (v.stage.at !== "none") notes.push("staging");
    if (v.left.length) notes.push(`Commit all left ${names(v.left)} staged`);
  } else if (v.commit.at === "refused") {
    label = "The host refused the commit";
  } else if (v.commit.at === "failed") {
    label = "A hook stopped the commit";
  } else if (v.commit.at === "stopped") {
    label = "The commit stopped: Git's staged files are not the counted ones";
  } else {
    label = `Committing ${names(v.commit.counted)}${v.commit.all ? " (Commit all)" : ""}`;
  }
  const unseen = v.work.filter((file) => !v.view.files.includes(file));
  if (unseen.length) notes.push(`${names(unseen)} new on disk`);
  if (!same(v.index, v.view.staged)) notes.push(`Git has ${names(v.index)} staged`);
  const takes = v.index.includes("a") ? v.blob : v.disk;
  if (takes !== v.shown) notes.push("a changed after the tab showed it");
  return notes.length ? `${label} (${notes.join(", ")})` : label;
}

// The group of one model state, for the chart's colours.
export function group(v) {
  if (v.head > 0)
    return same(v.committed, v.counted) && (v.holds === NONE || v.holds === v.saw)
      ? "Committed what you counted"
      : "Committed something else";
  return "Before the commit";
}
export const groupColors = {
  "Before the commit": "#e8eef7",
  "Committed what you counted": "#dff3e4",
};

const STEPS = {
  Space: "You press Space on a file",
  PressCommit: "You press Commit",
  OtherNewFile: "An agent writes a new file",
  OtherEdits: "An agent writes a again",
  OtherStages: "An agent stages a file",
  ReadStatus: "The tab reads Git's status",
  ReadDiff: "The tab reads the diff",
  HostStage: "Git stages the file",
  HostStageFails: "Git refuses the stage",
  StageAnswer: "The tab takes Git's answer",
  CommitStart: "The commit starts",
  HostStageAll: "Med stages the files for Commit all",
  StageAllAnswer: "The tab sends the commit",
  HostCommit: "Git commits",
  HostHookFails: "A hook stops the commit",
  CommitAnswer: "The tab reads Git's status after the commit",
};
export function step(action, before, after) {
  if (action === "Space") return `You press Space on ${after.stage.file}`;
  if (action === "OtherStages") {
    const file = after.others.find((name) => !before.others.includes(name));
    return `An agent stages ${file}`;
  }
  if (action === "HostCommit" && after.commit.at === "refused")
    return "The host refuses the commit";
  return STEPS[action] ?? action;
}

// Why a bad state is bad.
export function cause(v, facts, invariant) {
  if (invariant === "CommitHoldsWhatYouSaw")
    return "an agent changed a after the tab showed it, and the commit took the new content";
  if (invariant === "CommitAllLeavesTheIndex")
    return "Commit all staged the files in the index, and they stayed staged when the commit did not complete";
  if (invariant !== "CommitHoldsWhatYouCounted") return null;
  const extra = v.committed.filter((file) => !v.counted.includes(file));
  if (!extra.length) return "a stage failed, and the commit went on with fewer files";
  return v.commit.all
    ? "Commit all staged a file that the dialog did not count"
    : "another program staged a file while the commit waited for your stage, and the commit took what Git had staged";
}
