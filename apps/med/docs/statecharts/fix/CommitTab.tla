------------------------------ MODULE CommitTab ------------------------------
(***************************************************************************)
(* The Commit tab of one checkout: what it shows, what you stage, the     *)
(* commit that you press, and another program, such as an agent, that     *)
(* works in the same checkout. Files are names; their contents are left   *)
(* out.                                                                    *)
(*                                                                         *)
(* The fix: Commit all stages only the files that the dialog counted, and *)
(* the commit stops when Git's staged files are not the counted ones.     *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, on   *)
(* the branch agent/med-statecharts, after the fix.                        *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

\* a and b are your changes. n is a new file that another program writes.
Files == {"a", "b", "n"}

\* What the Commit tab knows of Git (web/components/CommitView.tsx:220-224):
\* the changed files, the staged ones, and the index key, a hash of HEAD and
\* the staged entries (host/repository/commit-flow.ts:45-48, 109).
Status(w, i, h) == [files |-> w, staged |-> i, key |-> <<h, i>>]

VARIABLES
  work,       \* files that differ from HEAD on disk, tracked or new
  index,      \* files that Git has staged
  head,       \* the number of commits made
  event,      \* a watch event that the tab has not read yet
  view,       \* Git's last answer that the tab took (latest.current)
  stage,      \* your Space on one file: [at: "none", "sent", "done" or "failed", file]
  commit,     \* your Commit: [at, all, counted, key]
  committed,  \* history: the files in the last commit
  counted,    \* history: the files that the dialog counted for that commit
  message,    \* the commit message: "draft", or "none" after a commit clears it.
              \* Model bound: you write no second message, so one commit lands.
  otherNew,   \* model bound: the other program writes one new file
  otherAdd    \* model bound: the other program stages one file

vars == <<work, index, head, event, view, stage, commit, committed, counted, message,
          otherNew, otherAdd>>

Actual == Status(work, index, head)
NoStage == [at |-> "none", file |-> "none"]
NoCommit == [at |-> "none", all |-> FALSE, counted |-> {}, key |-> <<0, {}>>]

\* The staged files as the tab shows them: Git's answer, and your Space
\* before Git answers (web/components/CommitView.tsx:222, web/data/commit.ts:98-119).
ShownStaged == IF stage.at = "sent" THEN view.staged \cup {stage.file} ELSE view.staged
\* Nothing is staged: Commit all takes every file shown (CommitView.tsx:275-279).
CommitAll == ShownStaged = {} /\ view.files # {}
\* The files that the dialog counts in its title (CommitView.tsx:991-992).
DialogCount == IF CommitAll THEN view.files ELSE ShownStaged

\* A stage or a stage-all is on its way (web/components/CommitView.tsx:410-417, 450-455).
Writing == stage.at # "none" \/ commit.at \in {"staging", "staged"}

Init ==
  /\ work = {"a", "b"}
  /\ index = {}
  /\ head = 0
  /\ event = FALSE
  /\ view = Status({"a", "b"}, {}, 0)
  /\ stage = NoStage
  /\ commit = NoCommit
  /\ committed = {}
  /\ counted = {}
  /\ message = "draft"
  /\ otherNew = FALSE
  /\ otherAdd = FALSE

(***************************** The reader *********************************)

\* Space on a file that is not staged.
Space ==
  /\ stage.at = "none"                      \* model bound: one stage at a time
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:983-984: the dialog stays while a commit runs
  /\ \E f \in view.files \ view.staged:     \* web/components/CommitView.tsx:427-430
       stage' = [at |-> "sent", file |-> f] \* web/components/CommitView.tsx:410-417
  /\ UNCHANGED <<work, index, head, event, view, commit, committed, counted, message,
                 otherNew, otherAdd>>

\* Cmd+Enter in the dialog, or its Commit button.
PressCommit ==
  /\ commit.at = "none"                     \* web/components/CommitView.tsx:1078: Commit is off while busy
  /\ DialogCount # {}                       \* web/components/CommitView.tsx:442
  /\ message = "draft"                      \* web/components/CommitView.tsx:442: a summary
  /\ commit' = [at |-> "queued", all |-> CommitAll,
                counted |-> DialogCount, key |-> <<0, {}>>]   \* CommitView.tsx:443-446
  /\ UNCHANGED <<work, index, head, event, view, stage, committed, counted, message,
                 otherNew, otherAdd>>

(****************************** The world *********************************)

\* An agent writes a new file in the checkout.
OtherNewFile ==
  /\ ~otherNew
  /\ work' = work \cup {"n"}
  /\ event' = TRUE
  /\ otherNew' = TRUE
  /\ UNCHANGED <<index, head, view, stage, commit, committed, counted, message, otherAdd>>

\* An agent runs git add on one of your files.
OtherStages ==
  /\ ~otherAdd
  /\ \E f \in work \ index:
       index' = index \cup {f}
  /\ event' = TRUE
  /\ otherAdd' = TRUE
  /\ UNCHANGED <<work, head, view, stage, commit, committed, counted, message, otherNew>>

(******************************* The app **********************************)

\* A watch event reads Git's status. A read that overlaps a stage is
\* dropped, and the stage's answer is newer.
ReadStatus ==
  /\ event                                  \* web/components/CommitView.tsx:334: a new revision
  /\ ~Writing                               \* web/components/CommitView.tsx:327
  /\ event' = FALSE
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, stage, commit, committed, counted, message,
                 otherNew, otherAdd>>

\* git add --all -- the file (host/repository/commit-flow.ts:252).
HostStage ==
  /\ stage.at = "sent"
  /\ index' = IF stage.file \in work THEN index \cup {stage.file} ELSE index
  /\ stage' = [stage EXCEPT !.at = "done"]
  /\ UNCHANGED <<work, head, event, view, commit, committed, counted, message,
                 otherNew, otherAdd>>

\* Git refuses, as when another git process holds index.lock.
HostStageFails ==
  /\ stage.at = "sent"
  /\ stage' = [stage EXCEPT !.at = "failed"]
  /\ UNCHANGED <<work, index, head, event, view, commit, committed, counted, message,
                 otherNew, otherAdd>>

\* The tab takes the answer, or reads the status after the error
\* (web/components/CommitView.tsx:414-417, 399-401).
StageAnswer ==
  /\ stage.at \in {"done", "failed"}
  /\ stage' = NoStage
  /\ view' = Actual
  /\ UNCHANGED <<work, index, head, event, commit, committed, counted, message,
                 otherNew, otherAdd>>

\* The commit waits for the stages before it (web/components/CommitView.tsx:394).
CommitStart ==
  /\ commit.at = "queued"
  /\ stage.at = "none"                      \* web/components/CommitView.tsx:394
  /\ IF commit.all                          \* web/components/CommitView.tsx:450
       THEN commit' = [commit EXCEPT !.at = "staging"]
       ELSE IF view.staged # commit.counted  \* web/components/CommitView.tsx:458-461
       THEN commit' = [commit EXCEPT !.at = "stopped"]
       ELSE commit' = [commit EXCEPT !.at = "sent", !.key = view.key]  \* CommitView.tsx:462
  /\ UNCHANGED <<work, index, head, event, view, stage, committed, counted, message,
                 otherNew, otherAdd>>

\* Commit all stages the counted files: git add --all -- those paths
\* (web/components/CommitView.tsx:446, 453, host/repository/commit-flow.ts:252).
HostStageAll ==
  /\ commit.at = "staging"
  /\ index' = index \cup (commit.counted \cap work)
  /\ commit' = [commit EXCEPT !.at = "staged"]
  /\ UNCHANGED <<work, head, event, view, stage, committed, counted, message,
                 otherNew, otherAdd>>

\* The tab takes Git's answer and sends the commit with its index key,
\* or stops (web/components/CommitView.tsx:453, 458-462).
StageAllAnswer ==
  /\ commit.at = "staged"
  /\ view' = Actual
  /\ commit' = IF Actual.staged # commit.counted  \* web/components/CommitView.tsx:458-461
                 THEN [commit EXCEPT !.at = "stopped"]
                 ELSE [commit EXCEPT !.at = "sent", !.key = Actual.key]
  /\ UNCHANGED <<work, index, head, event, stage, committed, counted, message,
                 otherNew, otherAdd>>

\* host/repository/commit-flow.ts:284-333.
HostCommit ==
  /\ commit.at = "sent"
  /\ IF Actual.key # commit.key             \* commit-flow.ts:296
       THEN /\ commit' = [commit EXCEPT !.at = "refused"]
            /\ UNCHANGED <<work, index, head, committed, counted>>
       ELSE IF index = {}                   \* commit-flow.ts:302
       THEN /\ commit' = [commit EXCEPT !.at = "refused"]
            /\ UNCHANGED <<work, index, head, committed, counted>>
       ELSE /\ committed' = index           \* commit-flow.ts:304-317
            /\ counted' = commit.counted
            /\ work' = work \ index
            /\ index' = {}
            /\ head' = head + 1
            /\ commit' = [commit EXCEPT !.at = "ok"]
  /\ UNCHANGED <<event, view, stage, message, otherNew, otherAdd>>

\* A hook stops the commit (host/repository/commit-flow.ts:318-327).
HostHookFails ==
  /\ commit.at = "sent"
  /\ Actual.key = commit.key                \* commit-flow.ts:296
  /\ index # {}                             \* commit-flow.ts:302
  /\ commit' = [commit EXCEPT !.at = "failed"]
  /\ UNCHANGED <<work, index, head, event, view, stage, committed, counted, message,
                 otherNew, otherAdd>>

\* The tab reads the status after the commit or its error; the message
\* stays after an error or a stop (web/components/CommitView.tsx:463-471).
CommitAnswer ==
  /\ commit.at \in {"ok", "failed", "refused", "stopped"}
  /\ commit' = NoCommit
  /\ view' = Actual
  /\ message' = IF commit.at = "ok" THEN "none" ELSE message   \* CommitView.tsx:463
  /\ UNCHANGED <<work, index, head, event, stage, committed, counted, otherNew, otherAdd>>

Reader == Space \/ PressCommit

World == OtherNewFile \/ OtherStages

System ==
  \/ ReadStatus
  \/ HostStage \/ HostStageFails \/ StageAnswer
  \/ CommitStart \/ HostStageAll \/ StageAllAnswer
  \/ HostCommit \/ HostHookFails \/ CommitAnswer

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

(******************************* The rules ********************************)

\* A commit holds exactly the files that the Commit dialog counted when you
\* pressed Commit.
CommitHoldsWhatYouCounted == head > 0 => committed = counted

\* Your commit message stays until a commit with it is made.
MessageKept == message = "none" => head > 0

=============================================================================
