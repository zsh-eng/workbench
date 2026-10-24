------------------------------ MODULE CommitTab ------------------------------
(***************************************************************************)
(* The Commit tab of one checkout: what it shows, what you stage, the     *)
(* commit that you press, and another program, such as an agent, that     *)
(* works in the same checkout. Files are names. Only a has content: a     *)
(* version, 0 at first and 1 after the other program writes a again.      *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, at   *)
(* main d53abaa8, before the fix.                                          *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

\* a and b are your changes. n is a new file that another program writes.
Files == {"a", "b", "n"}
None == 99

\* What the Commit tab knows of Git (web/components/CommitView.tsx:219-223):
\* the changed files, the staged ones, and the index key, a hash of HEAD and
\* the staged entries with their blobs (host/repository/commit-flow.ts:80-93, 109).
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
\* before Git answers (web/components/CommitView.tsx:221, web/data/commit.ts:91-112).
ShownStaged == IF stage.at = "sent" THEN view.staged \cup {stage.file} ELSE view.staged
\* Nothing is staged: Commit all takes every file shown (CommitView.tsx:274-278).
CommitAll == ShownStaged = {} /\ view.files # {}
\* The files that the dialog counts in its title (CommitView.tsx:982-983).
DialogCount == IF CommitAll THEN view.files ELSE ShownStaged

\* A stage or a stage-all is on its way (web/components/CommitView.tsx:409-416, 447-451).
Writing == stage.at # "none" \/ commit.at \in {"staging", "staged"}

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
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:974-975: the dialog stays while a commit runs
  /\ \E f \in view.files \ view.staged:     \* web/components/CommitView.tsx:426-429
       stage' = [at |-> "sent", file |-> f] \* web/components/CommitView.tsx:409-416
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* Cmd+Enter in the dialog, or its Commit button. `saw` is a history of
\* what the tab showed; this code does not send it.
PressCommit ==
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:1069: Commit is off while busy
  /\ DialogCount # {}                       \* web/components/CommitView.tsx:441
  /\ message = "draft"                      \* web/components/CommitView.tsx:441: a summary
  /\ commit' = [at |-> "queued", all |-> CommitAll, counted |-> DialogCount,
                key |-> <<0, {}, None>>,
                saw |-> IF "a" \in DialogCount THEN shown ELSE None,
                before |-> index]           \* CommitView.tsx:442-444
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
  /\ event                                  \* web/components/CommitView.tsx:333: a new revision
  /\ ~Writing                               \* web/components/CommitView.tsx:326
  /\ event' = FALSE
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, disk, blob, due, shown, stage, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* A watch event reads the diff too, apart from the status
\* (web/components/CommitView.tsx:328-330).
ReadDiff ==
  /\ due
  /\ due' = FALSE
  /\ shown' = Shows
  /\ UNCHANGED <<work, index, head, disk, blob, event, view, stage, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* git add --all -- the file (host/repository/commit-flow.ts:252).
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
\* (web/components/CommitView.tsx:413-416, 398-400).
StageAnswer ==
  /\ stage.at \in {"done", "failed"}
  /\ stage' = NoStage
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, shown, commit, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The commit waits for the stages before it (web/components/CommitView.tsx:393).
CommitStart ==
  /\ commit.at = "queued"
  /\ stage.at = "none"                      \* web/components/CommitView.tsx:393
  /\ IF commit.all                          \* web/components/CommitView.tsx:447
       THEN commit' = [commit EXCEPT !.at = "staging"]
       ELSE commit' = [commit EXCEPT !.at = "sent", !.key = view.key]  \* CommitView.tsx:453
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, stage, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* Commit all stages every change in the index: git add --all with no path
\* (web/components/CommitView.tsx:449, host/repository/commit-flow.ts:252).
HostStageAll ==
  /\ commit.at = "staging"
  /\ index' = work
  /\ blob' = IF "a" \in work THEN disk ELSE blob
  /\ commit' = [commit EXCEPT !.at = "staged"]
  /\ UNCHANGED <<work, head, disk, event, due, view, shown, stage, committed, counted, holds,
                 saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The tab takes Git's answer and sends the commit with its index key
\* (web/components/CommitView.tsx:449, 453).
StageAllAnswer ==
  /\ commit.at = "staged"
  /\ view' = Actual
  /\ commit' = [commit EXCEPT !.at = "sent", !.key = Actual.key]
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, shown, stage, committed, counted,
                 holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* host/repository/commit-flow.ts:284-333. The commit takes the index.
HostCommit ==
  /\ commit.at = "sent"
  /\ IF Actual.key # commit.key \/ index = {}  \* commit-flow.ts:296, 302
       THEN /\ commit' = [commit EXCEPT !.at = "refused"]
            /\ UNCHANGED <<work, index, head, committed, counted, holds, saw>>
       ELSE /\ committed' = index           \* commit-flow.ts:304-317
            /\ counted' = commit.counted
            /\ holds' = IF "a" \in index THEN blob ELSE None
            /\ saw' = commit.saw
            /\ work' = (work \ index) \cup (IF "a" \in index /\ blob # disk THEN {"a"} ELSE {})
            /\ index' = {}
            /\ head' = head + 1
            /\ commit' = [commit EXCEPT !.at = "ok"]
  /\ UNCHANGED <<disk, blob, event, due, view, shown, stage, left, others, message,
                 otherNew, otherAdd, otherEdit>>

\* A hook stops the commit (host/repository/commit-flow.ts:318-327). What
\* Commit all staged stays staged.
HostHookFails ==
  /\ commit.at = "sent"
  /\ Actual.key = commit.key                \* commit-flow.ts:296
  /\ index # {}                             \* commit-flow.ts:302
  /\ commit' = [commit EXCEPT !.at = "failed"]
  /\ UNCHANGED <<work, index, head, disk, blob, event, due, view, shown, stage, committed,
                 counted, holds, saw, left, others, message, otherNew, otherAdd, otherEdit>>

\* The tab reads the status after the commit or its error, and the diff
\* after a commit; the message stays after an error
\* (web/components/CommitView.tsx:454-462).
CommitAnswer ==
  /\ commit.at \in {"ok", "failed", "refused"}
  /\ commit' = NoCommit
  /\ view' = Actual
  /\ shown' = IF commit.at = "ok" THEN Shows ELSE shown
  /\ message' = IF commit.at = "ok" THEN "none" ELSE message   \* CommitView.tsx:454
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
  \/ CommitStart \/ HostStageAll \/ StageAllAnswer
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
