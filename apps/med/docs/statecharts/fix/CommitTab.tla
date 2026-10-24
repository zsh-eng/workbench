------------------------------ MODULE CommitTab ------------------------------
(***************************************************************************)
(* The Commit tab of one checkout: what it shows, what you stage, the     *)
(* commit that you press, and another program, such as an agent, that     *)
(* works in the same checkout. Files are names. Only a has content: a     *)
(* version, 0 at first and 1 after the other program writes a again.      *)
(*                                                                         *)
(* The fix: Commit all stages only the files that the dialog counted, in  *)
(* a copy of the index, as git commit -a does. A commit names its files   *)
(* and what the tab showed of each, and the host stops it when Git has    *)
(* other files staged or other content.                                    *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, on   *)
(* the branch agent/med-statecharts, after the fix.                        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

\* a and b are your changes. n is a new file that another program writes.
Files == {"a", "b", "n"}
None == 99

\* What the Commit tab knows of Git (web/components/CommitView.tsx:266, 325-326):
\* the changed files, the staged ones, and the index key, a hash of HEAD and
\* the staged entries with their blobs (host/repository/commit-flow.ts:86-92, 120).
Status(w, i, h, c) == [files |-> w, staged |-> i, key |-> <<h, i, IF "a" \in i THEN c ELSE None>>]

VARIABLES
  work,       \* files that differ from HEAD on disk, tracked or new
  index,      \* files that Git has staged
  head,       \* the number of commits made
  disk,       \* a's content on disk
  blob,       \* a's content in the index, while Git has a staged
  event,      \* a watch event: the tab has not read Git's status since
  due,        \* a watch event: the tab has not read the diff since
  view,       \* Git's last answer that the tab took (latest.current)
  shown,      \* a's change as the tab's diff shows it: the staged content
              \* when Git has a staged, else the content on disk
  stage,      \* your Space on one file: [at: "none", "sent", "done" or "failed", file]
  commit,     \* your Commit: [at, all, counted, key, saw, before]
  committed,  \* history: the files in the last commit
  counted,    \* history: the files that the dialog counted for that commit
  holds,      \* history: a's content in the last commit, or None
  saw,        \* history: a's content that the tab showed when you pressed that Commit
  left,       \* history: what a Commit all that did not commit left staged
  others,     \* history: the files that the other program staged
  message,    \* the commit message: "draft", or "none" after a commit clears it.
              \* Model bound: you write no second message, so one commit lands.
  otherNew,   \* model bound: the other program writes one new file
  otherAdd,   \* model bound: the other program stages one file
  otherEdit   \* model bound: the other program writes a once

vars == <<work, index, head, disk, blob, event, due, view, shown, stage, commit, committed,
          counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

Actual == Status(work, index, head, blob)
\* What a read of the diff shows of a.
Shows == IF "a" \in index THEN blob ELSE disk
NoStage == [at |-> "none", file |-> "none"]
NoCommit == [at |-> "none", all |-> FALSE, counted |-> {}, key |-> <<0, {}, None>>,
             saw |-> None, before |-> {}]

\* The staged files as the tab shows them: Git's answer, and your Space
\* before Git answers (web/components/CommitView.tsx:266, web/data/commit.ts:104-125).
ShownStaged == IF stage.at = "sent" THEN view.staged \cup {stage.file} ELSE view.staged
\* Nothing is staged: Commit all takes every file shown (CommitView.tsx:319-322).
CommitAll == ShownStaged = {} /\ view.files # {}
\* The files that the dialog counts in its title (CommitView.tsx:1046-1047).
DialogCount == IF CommitAll THEN view.files ELSE ShownStaged

\* A stage is on its way (web/components/CommitView.tsx:458-472).
Writing == stage.at # "none"

\* The index that the commit takes: for Commit all, a copy of the index with
\* the counted files added (host/repository/commit-flow.ts:338-349).
Taken == IF commit.all THEN index \cup (commit.counted \cap work) ELSE index
TakenA == IF commit.all /\ "a" \in commit.counted \cap work THEN disk ELSE blob
\* The host's checks: the index key, the files, and a's content as the tab
\* showed it (commit-flow.ts:327, 351, 450, 457-461, 352).
Passes ==
  /\ Actual.key = commit.key
  /\ Taken = commit.counted
  /\ ("a" \in Taken /\ commit.saw # None) => TakenA = commit.saw
  /\ Taken # {}

Init ==
  /\ work = {"a", "b"}
  /\ index = {}
  /\ head = 0
  /\ disk = 0
  /\ blob = 0
  /\ event = FALSE
  /\ due = FALSE
  /\ view = Status({"a", "b"}, {}, 0, 0)
  /\ shown = 0
  /\ stage = NoStage
  /\ commit = NoCommit
  /\ committed = {}
  /\ counted = {}
  /\ holds = None
  /\ saw = None
  /\ left = {}
  /\ others = {}
  /\ message = "draft"
  /\ otherNew = FALSE
  /\ otherAdd = FALSE
  /\ otherEdit = FALSE

(***************************** The reader *********************************)

\* Space on a file that is not staged.
Space ==
  /\ stage.at = "none"                      \* model bound: one stage at a time
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:1037-1038: the dialog stays while a commit runs
  /\ \E f \in view.files \ view.staged:     \* web/components/CommitView.tsx:474-477
       stage' = [at |-> "sent", file |-> f] \* web/components/CommitView.tsx:458-465
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* Cmd+Enter in the dialog, or its Commit button. The commit names what the
\* tab shows of each counted file (web/components/CommitView.tsx:497-502).
PressCommit ==
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:1133: Commit is off while busy
  /\ DialogCount # {}                       \* web/components/CommitView.tsx:490
  /\ message = "draft"                      \* web/components/CommitView.tsx:490: a summary
  /\ commit' = [at |-> "queued", all |-> CommitAll, counted |-> DialogCount,
                key |-> <<0, {}, None>>,
                saw |-> IF "a" \in DialogCount THEN shown ELSE None,
                before |-> index]           \* CommitView.tsx:491-494
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, stage, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

(****************************** The world *********************************)

\* An agent writes a new file in the checkout.
OtherNewFile ==
  /\ ~otherNew
  /\ work' = work \cup {"n"}
  /\ event' = TRUE
  /\ due' = TRUE
  /\ otherNew' = TRUE
  /\ UNCHANGED <<index, head, disk, blob, view, shown, stage, commit, committed, counted,
                 holds, saw, left, others, message, otherAdd, otherEdit>>

\* An agent writes a again.
OtherEdits ==
  /\ ~otherEdit
  /\ disk' = 1
  /\ work' = work \cup {"a"}
  /\ event' = TRUE
  /\ due' = TRUE
  /\ otherEdit' = TRUE
  /\ UNCHANGED <<index, head, blob, view, shown, stage, commit, committed, counted, holds,
                 saw, left, others, message, otherNew, otherAdd>>

\* An agent runs git add on one of your files: a file not staged, or a,
\* staged before the agent wrote it.
OtherStages ==
  /\ ~otherAdd
  /\ \E f \in work:
       /\ index' = index \cup {f}
       /\ blob' = IF f = "a" THEN disk ELSE blob
       /\ others' = others \cup {f}
  /\ <<index', blob'>> # <<index, blob>>    \* model bound: a stage that changes the index
  /\ event' = TRUE
  /\ due' = TRUE
  /\ otherAdd' = TRUE
  /\ UNCHANGED <<work, head, disk, view, shown, stage, commit, committed, counted, holds,
                 saw, left, message, otherNew, otherEdit>>

(******************************* The app **********************************)

\* A watch event reads Git's status. A read that overlaps a stage is
\* dropped, and the stage's answer is newer.
ReadStatus ==
  /\ event                                  \* web/components/CommitView.tsx:378: a new revision
  /\ ~Writing                               \* web/components/CommitView.tsx:371
  /\ event' = FALSE
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, disk, blob, due, shown, stage, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* A watch event reads the diff too, apart from the status
\* (web/components/CommitView.tsx:373-375).
ReadDiff ==
  /\ due
  /\ due' = FALSE
  /\ shown' = Shows
  /\ UNCHANGED <<work, index, head, disk, blob, event, view, stage, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* git add --all, with the path on standard input (host/repository/commit-flow.ts:271).
HostStage ==
  /\ stage.at = "sent"
  /\ index' = IF stage.file \in work THEN index \cup {stage.file} ELSE index
  /\ blob' = IF stage.file = "a" THEN disk ELSE blob
  /\ stage' = [stage EXCEPT !.at = "done"]
  /\ UNCHANGED <<work, head, disk, event, due, view, shown, commit, committed, counted,
                 holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* Git refuses, as when another git process holds index.lock.
HostStageFails ==
  /\ stage.at = "sent"
  /\ stage' = [stage EXCEPT !.at = "failed"]
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The tab takes the answer, or reads the status after the error
\* (web/components/CommitView.tsx:465, 448-449).
StageAnswer ==
  /\ stage.at \in {"done", "failed"}
  /\ stage' = NoStage
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, shown, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The commit waits for the stages before it (web/components/CommitView.tsx:442).
\* Commit all goes to the host; another commit stops when Git's staged files
\* are not the counted ones (CommitView.tsx:508-517).
CommitStart ==
  /\ commit.at = "queued"
  /\ stage.at = "none"                      \* web/components/CommitView.tsx:442
  /\ IF ~commit.all /\ view.staged # commit.counted  \* web/components/CommitView.tsx:508
       THEN commit' = [commit EXCEPT !.at = "stopped"]
       ELSE commit' = [commit EXCEPT !.at = "sent", !.key = view.key]  \* CommitView.tsx:512-517
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, stage, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* host/repository/commit-flow.ts:312-388. Commit all commits the copy, and
\* the index then takes its files as HEAD has them (commit-flow.ts:383).
HostCommit ==
  /\ commit.at = "sent"
  /\ IF ~Passes                             \* commit-flow.ts:327, 351, 352
       THEN /\ commit' = [commit EXCEPT !.at = "refused"]
            /\ UNCHANGED <<work, index, head, committed, counted, holds, saw>>
       ELSE /\ committed' = Taken           \* commit-flow.ts:354-367
            /\ counted' = commit.counted
            /\ holds' = IF "a" \in Taken THEN TakenA ELSE None
            /\ saw' = commit.saw
            /\ work' = (work \ Taken) \cup (IF "a" \in Taken /\ TakenA # disk THEN {"a"} ELSE {})
            /\ index' = index \ Taken
            /\ head' = head + 1
            /\ commit' = [commit EXCEPT !.at = "ok"]
  /\ UNCHANGED <<disk, blob, event, due, view, shown, stage, left, others, message,
                 otherNew, otherAdd, otherEdit>>

\* A hook stops the commit (host/repository/commit-flow.ts:368-378). For
\* Commit all, the copy of the index goes; the index is as it was.
HostHookFails ==
  /\ commit.at = "sent"
  /\ Passes                                 \* commit-flow.ts:327, 351, 352
  /\ commit' = [commit EXCEPT !.at = "failed"]
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, stage, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The tab reads the status after the commit or its error, and the diff
\* after a commit; the message stays after an error or a stop
\* (web/components/CommitView.tsx:518-525).
CommitAnswer ==
  /\ commit.at \in {"ok", "failed", "refused", "stopped"}
  /\ commit' = NoCommit
  /\ view' = Actual
  /\ shown' = IF commit.at = "ok" THEN Shows ELSE shown
  /\ message' = IF commit.at = "ok" THEN "none" ELSE message   \* CommitView.tsx:518
  /\ left' = IF commit.all /\ commit.at # "ok"
               THEN (index \ commit.before) \ others
               ELSE {}
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, stage, committed, counted,
                 holds, saw, others, otherNew, otherAdd, otherEdit>>

Reader == Space \/ PressCommit

World == OtherNewFile \/ OtherEdits \/ OtherStages

System ==
  \/ ReadStatus \/ ReadDiff
  \/ HostStage \/ HostStageFails \/ StageAnswer
  \/ CommitStart
  \/ HostCommit \/ HostHookFails \/ CommitAnswer

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

(******************************* The rules ********************************)

\* A commit holds exactly the files that the Commit dialog counted when you
\* pressed Commit.
CommitHoldsWhatYouCounted == head > 0 => committed = counted

\* A commit holds each file as the tab showed it when you pressed Commit.
CommitHoldsWhatYouSaw == holds # None => holds = saw

\* A Commit all that does not commit leaves nothing staged that was not
\* staged when you pressed Commit, apart from another program's stages.
CommitAllLeavesTheIndex == left = {}

\* Your commit message stays until a commit with it is made.
MessageKept == message = "none" => head > 0

=============================================================================
