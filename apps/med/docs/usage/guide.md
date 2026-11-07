# The Guide

When an agent attaches a guide, the **Review** tab opens on the Guide. A guide
splits the change into segments that you check one at a time, like a pull
request split into small ones.

- **Overview.** The agent's summary and the segments with their area, file
  count, and comment count. Line counts and hashes show only in each file's
  own header. **Needs care** marks a segment that the agent flagged as
  risky. **Start reviewing** opens the first segment, and **All files** shows
  the version's whole diff.
  A summary is Markdown: `mermaid` diagrams show, and images load from the
  review's checkout, with paths from the repository root.
- **A segment.** Its title, summary, and only its files, with the agent's
  comments on their lines. Comments on whole files, and on lines the diff does
  not show, follow the summary. **Reply** on a comment on lines adds your note
  under it, in its card, on a line down the card's side. The agent gets your
  reply with the words that it answers.
- **The rail.** The Guide's parts are in the rail at the left, which hides in
  a narrow window. **Next** at the end of a segment, or `j`, opens the next
  one.
- **Commits.** They are not in the Guide. With two or more commits in the
  range, the rail of **All files** lists them: each one opens on its own, with
  its message, and **Whole range** goes back to the whole range.
  The version's comments, yours and the agent's, show on the commit's lines
  where the commit shows the same line; the commit's head says how many it
  cannot show. A comment that you add on a commit belongs to the version when
  the version still has that line, so the whole range shows it too. On a line
  that a later commit changed, it stays with that commit.
- **New since you looked.** After the first hand-off, a row under
  **Overview** shows only what changed since your last review (see
  [later hand-offs](#proof-findings-and-later-hand-offs)). The diff goes from
  that hand-off's text to this one's, so your comments keep their lines; a
  comment on a removed line is not possible there. In the file rail, a dot
  marks the commits that are new since then.
- **Move.** `j` and `k` step through the Overview, New since you looked, and
  the segments.

A review with nothing for the Overview (no guide, proof, or findings) opens on
its whole diff.
Agents pass a guide with [`--guide`](../AGENT_INTEGRATION.md#attach-a-guide).

## Proof, findings, and later hand-offs

The Overview also shows what a version's notes and guide summary say about
it, in whatever format the agent or your own review skills wrote it
([review practices](../PRACTICES.md#b-read-review-output-from-any-source)). A
Review opens on the Overview when its hand-off has a guide, proof, or
findings. A later hand-off opens on what is new since you looked, with the
Overview a click away in the rail. Med shows no version numbers: it keeps
each hand-off's snapshot underneath, so comments stay on their lines and a
rebase still diffs cleanly. Each part shows only when the hand-off has it.

- **Proof.** First, under the title: each check with its result, the media,
  and **Not covered**, what the checks miss. A proof written as a table shows
  as that table: its columns share the width, long commands and paths break at
  their `/`, `:`, `-` and `.`, and only a table too wide for whole words
  scrolls sideways in its own box. When the guide summary holds the proof and
  this part shows it whole (its tables, and lines whose only markup is code),
  it shows here only; a proof with a fence's output, nested items, links or a
  long paragraph stays in the summary too. Without written proof, the checks
  that the session ran in the turn that made the latest version show, marked
  "from the session's last turn".
- **New since you looked.** After the first hand-off: the files that changed
  since your last review, the last earlier hand-off that you commented on or
  opened, or else the one before. **Show only these changes**, or a file,
  opens them as **New since you looked** in the rail, which the
  **Pull request** tab offers too. Med compares the text that each hand-off
  saved, not Git history, so a rebase or a force push does not matter. When
  the base also moved, as after a rebase, Med replays the earlier change on
  the new base first: a file that changed only with its base is listed as
  such and not shown, and where the replay conflicts, the diff says that it
  can show the base's changes too. Commits that a rebase gave new IDs keep
  their author time and subject, so they do not count as new.
- **Findings.** Items tagged Important, Nit, or Pre-existing, with the ones
  closed as Fixed, Intentional, or Won't fix and their reasons. The start row
  counts the open ones. Click a finding to open its line.
- **Practices.** Where one would help, the Overview offers a review practice:
  **Ask the agent to explain** when there is no explanation, which puts the
  request in the session's message box for you to send; the proof-first skill
  to copy when there is no proof; the round-limit skill from the fourth round. One
  shows at a time, and **Dismiss** hides it for good in this browser.
  `med skills suggest` lists all of them.

A thread's diff has a rail of its changed files as a tree. In **Review**, the
rail also lists the range's commits when it has two or more. A commit shows on
its own; **Whole range** goes back. In **Changes**, the rail lists the
branch's commits, or the Review's range, and **All changes** goes back. The
Guide's list takes the same place in the Guide. The two are one nested
sidebar: it shows by itself when the review pane has room, and the button at
the end of the review's row, `⌘⌥B`, or **Hide the guide** or **Show files
and commits** in `⌘K` hides or shows it in any width. A narrow row keeps its
room for the comparison, so the button shows there only while the rail does. Med keeps that choice
for both, so a hidden rail stays hidden between the Guide and the diff. With the
**Changed files** pane open, as for a pull request, the pane lists the files
and the commits instead. Med reads the commits ahead while the review is idle,
so each one shows at once, in **Review** and in **Changes**.

Drag the right edge of the rail, the Guide's list, or the Commit tab's list to
make it wider, or focus the edge and press `←` or `→`. Double-click the edge
for the first width. Med keeps the width of each kind of list. Hover a cut file
name or title to see all of it.
