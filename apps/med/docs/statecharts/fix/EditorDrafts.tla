---------------------------- MODULE EditorDrafts ----------------------------
(***************************************************************************)
(* One working file that you edit in a workspace: its draft in the        *)
(* editor, the host's checked save, the workspace that keeps the draft,   *)
(* and another program, such as an agent, that writes the same file.      *)
(*                                                                         *)
(* The fix: a workspace that closes or leaves memory gives its unsaved    *)
(* drafts to the window, and the next editor that opens the file takes    *)
(* the draft back. The editor says when the file on disk is not the text  *)
(* that the draft started from, and Med checks the file again after a     *)
(* save.                                                                   *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, on   *)
(* the branch agent/med-statecharts, after the fix.                        *)
(***************************************************************************)
EXTENDS Naturals

\* File contents. Med first reads "A". You type "U" or "V". Another program
\* writes "O". The host names a file by a hash of its bytes
\* (host/repository/browse.ts:382), so a content stands for its identity.
None == "none"

\* web/data/editor-drafts.ts:4-17. base is savedText and file.identity.
NoDraft == [base |-> None, doc |-> None, dirty |-> FALSE, saving |-> FALSE, refused |-> FALSE]
Fresh(text) == [base |-> text, doc |-> text, dirty |-> FALSE, saving |-> FALSE, refused |-> FALSE]
\* A save on its way. mine: its answer goes to the draft that is open now.
NoSave == [at |-> "none", text |-> None, expected |-> None, mine |-> FALSE]

VARIABLES
  disk,        \* the file's bytes on disk
  event,       \* a watch event that the workspace has not handled yet
  ws,          \* the workspace: "shown", "hidden" (still in memory), or "closed"
  draft,       \* the editor's draft of the file
  held,        \* who keeps the draft: "store" (the workspace's App), "parked" (the window), or "none"
  save,        \* at: "none", "sent", "checked", "rechecked", "ok" or "refused"
  stale,       \* web/data/file-workspace.ts:334: Med saw that the file changed
  read,        \* the file as the workspace last read or saved it (snapshot.file)
  recheck,     \* a check of the disk after a save, not done yet
  owed,        \* history: your newest unsaved text, until it reaches the disk or you discard it
  clobbered,   \* history: a save replaced a change that another program made
  otherWrote   \* model bound: the other program writes once

vars == <<disk, event, ws, draft, held, save, stale, read, recheck, owed, clobbered, otherWrote>>

\* The editor says that the file changed on disk: a refused save's error
\* (web/components/FileEditor.tsx:817-821), or, while no save runs, the
\* notice for a stale file or a read that differs from the draft's
\* (FileEditor.tsx:208-214, 822-833).
Banner ==
  /\ held = "store"
  /\ \/ draft.refused
     \/ ~draft.saving /\ (stale \/ read # draft.base)

Init ==
  /\ disk = "A"
  /\ event = FALSE
  /\ ws = "shown"
  /\ draft = NoDraft
  /\ held = "none"
  /\ save = NoSave
  /\ stale = FALSE
  /\ read = None
  /\ recheck = FALSE
  /\ owed = None
  /\ clobbered = FALSE
  /\ otherWrote = FALSE

(***************************** The reader *********************************)

\* The window gives a parked draft back. A clean one that the disk passed
\* is read again.
OpenFile ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172: the workspace on screen
  /\ held # "store"                         \* web/data/editor-drafts.ts:76-78: no unsaved draft in this App
  /\ IF held = "parked"                     \* web/data/editor-drafts.ts:79-84
       THEN /\ draft' = IF ~draft.dirty /\ ~draft.saving /\ draft.base # disk  \* editor-drafts.ts:86
                         THEN Fresh(disk) ELSE draft
            /\ UNCHANGED save
       ELSE /\ draft' = Fresh(disk)         \* web/data/editor-drafts.ts:88-98, from the host's read
            /\ save' = [save EXCEPT !.mine = FALSE]   \* an answer on its way goes to the draft that sent it
  /\ held' = "store"
  /\ read' = disk
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:270
  /\ UNCHANGED <<disk, event, ws, recheck, owed, clobbered, otherWrote>>

Type ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054: the editor shows the draft
  /\ \E text \in {"U", "V"} \ {draft.doc}:
       /\ draft' = [draft EXCEPT !.doc = text,
                      !.dirty = (text # draft.base)]   \* web/components/FileEditor.tsx:507
       \* Text that the file on disk has already is not owed.
       /\ owed' = IF text # draft.base /\ text # disk THEN text ELSE None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, read, recheck, clobbered, otherWrote>>

\* u back to the text that Med last read or saved.
Undo ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.doc # draft.base                 \* web/components/FileEditor.tsx:507
  /\ draft' = [draft EXCEPT !.doc = draft.base, !.dirty = FALSE]
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, read, recheck, clobbered, otherWrote>>

\* :w, Cmd+S or Save.
Save ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:381
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:381
  /\ save.at = "none"                       \* model bound: one save at a time
  /\ draft' = [draft EXCEPT !.saving = TRUE, !.refused = FALSE]   \* FileEditor.tsx:383
  /\ save' = [at |-> "sent", text |-> draft.doc,
              expected |-> draft.base, mine |-> TRUE]            \* FileEditor.tsx:386
  /\ UNCHANGED <<disk, event, ws, held, stale, read, recheck, owed, clobbered, otherWrote>>

\* Close file, then Discard draft.
Discard ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:402-405: Close asks only when unsaved
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:401
  /\ draft' = NoDraft                       \* web/components/FileEditor.tsx:849-853
  /\ held' = "none"
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, save, stale, read, recheck, clobbered, otherWrote>>

\* Refresh file reads the file again; a new read replaces a clean draft.
Refresh ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2172
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ ~draft.dirty                           \* web/components/FileEditor.tsx:805
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:805
  /\ disk # draft.base                      \* web/components/FullFileView.tsx:991
  /\ draft' = Fresh(disk)                   \* web/components/FullFileView.tsx:993
  /\ read' = disk
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:548, 270
  /\ UNCHANGED <<disk, event, ws, held, save, recheck, owed, clobbered, otherWrote>>

\* Show another workspace: this one stays mounted, hidden.
Hide ==
  /\ ws = "shown"
  /\ ws' = "hidden"                         \* web/components/Workspaces.tsx:2172
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, owed, clobbered, otherWrote>>

Show ==
  /\ ws = "hidden"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, owed, clobbered, otherWrote>>

\* x on the thread's row, Cmd+Opt+W, or Close workspace. The App gives its
\* unsaved drafts to the window as its workspace closes (web/App.tsx:524),
\* and drops the others (web/data/editor-drafts.ts:109-113).
CloseWorkspace ==
  /\ ws # "closed"
  /\ ws' = "closed"
  /\ held' = IF held = "store" /\ (draft.dirty \/ draft.saving) THEN "parked"  \* editor-drafts.ts:111
             ELSE IF held = "store" THEN "none" ELSE held
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, owed, clobbered, otherWrote>>

\* Open the thread or branch again: a new App, with an empty draft store.
Reopen ==
  /\ ws = "closed"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, owed, clobbered, otherWrote>>

(****************************** The world *********************************)

\* An agent or another editor writes the file.
OtherWrite ==
  /\ ~otherWrote
  /\ disk' = "O"
  /\ event' = TRUE
  /\ otherWrote' = TRUE
  /\ UNCHANGED <<ws, draft, held, save, stale, read, recheck, owed, clobbered>>

(******************************* The app **********************************)

\* After you show other workspaces, the least recent hidden one leaves
\* memory: past 16 tabs or 6 other workspaces
\* (web/components/Workspaces.tsx:1872-1876, 105, 108).
UnloadWorkspace ==
  /\ ws = "hidden"
  /\ ws' = "closed"
  /\ held' = IF held = "store" /\ (draft.dirty \/ draft.saving) THEN "parked"  \* editor-drafts.ts:111
             ELSE IF held = "store" THEN "none" ELSE held
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, owed, clobbered, otherWrote>>

\* Med compares the file on disk with the open file after a watch event.
Notice ==
  /\ event                                  \* web/App.tsx:655-658: a new source revision
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:1824-1829: only the workspace on screen listens
  /\ event' = FALSE
  /\ IF held = "store"                      \* web/data/file-workspace.ts:323-324: an open working file
       THEN stale' = (disk # read)          \* web/data/file-workspace.ts:334
       ELSE UNCHANGED stale
  /\ UNCHANGED <<disk, ws, draft, held, save, read, recheck, owed, clobbered, otherWrote>>

\* The host's save (host/repository/browse.ts:396-479).
HostCheck ==
  /\ save.at = "sent"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "checked" ELSE "refused"]  \* browse.ts:435
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, read, recheck, owed, clobbered, otherWrote>>

\* After it writes and flushes the temporary file.
HostRecheck ==
  /\ save.at = "checked"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "rechecked" ELSE "refused"]  \* browse.ts:452-460
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, read, recheck, owed, clobbered, otherWrote>>

\* parentSafe and the access check wait (browse.ts:461-462), then rename
\* replaces the file.
HostRename ==
  /\ save.at = "rechecked"
  /\ disk' = save.text                      \* browse.ts:463
  /\ event' = TRUE
  /\ clobbered' = (clobbered \/ disk # save.expected)
  /\ owed' = IF owed = save.text THEN None ELSE owed
  /\ save' = [save EXCEPT !.at = "ok"]
  /\ UNCHANGED <<ws, draft, held, stale, read, recheck, otherWrote>>

\* The editor takes the host's answer (web/components/FileEditor.tsx:385-397).
\* A parked draft takes it too. The open workspace takes the saved file and
\* reads the disk again (web/App.tsx:3109, file-workspace.ts:531-543).
Answer ==
  /\ save.at \in {"ok", "refused"}
  /\ save' = NoSave
  /\ IF save.mine /\ held # "none"
       THEN IF save.at = "ok"
              THEN /\ draft' = [draft EXCEPT !.base = save.text,
                                  !.dirty = (draft.doc # save.text),
                                  !.saving = FALSE]               \* FileEditor.tsx:387-391
                   /\ owed' = IF draft.doc # save.text THEN draft.doc ELSE None
                   /\ IF held = "store"
                        THEN /\ read' = save.text
                             /\ stale' = FALSE                    \* file-workspace.ts:539
                             /\ recheck' = TRUE                   \* file-workspace.ts:542
                        ELSE UNCHANGED <<read, stale, recheck>>
              ELSE /\ draft' = [draft EXCEPT !.saving = FALSE,
                                  !.refused = TRUE]               \* FileEditor.tsx:392-396
                   /\ UNCHANGED <<owed, read, stale, recheck>>
       ELSE UNCHANGED <<draft, owed, read, stale, recheck>>
  /\ UNCHANGED <<disk, event, ws, held, clobbered, otherWrote>>

\* The check after a save compares the disk with the saved file.
Recheck ==
  /\ recheck
  /\ recheck' = FALSE
  /\ IF held = "store"                      \* web/data/file-workspace.ts:323-324
       THEN stale' = (disk # read)          \* web/data/file-workspace.ts:334
       ELSE UNCHANGED stale
  /\ UNCHANGED <<disk, event, ws, draft, held, save, read, owed, clobbered, otherWrote>>

Reader ==
  \/ OpenFile \/ Type \/ Undo \/ Save \/ Discard \/ Refresh
  \/ Hide \/ Show \/ CloseWorkspace \/ Reopen

World == OtherWrite

System ==
  \/ UnloadWorkspace \/ Notice \/ Recheck
  \/ HostCheck \/ HostRecheck \/ HostRename \/ Answer

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader or another program.
Settled == ~ENABLED System

\* Your unsaved text is in memory, or on its way to the disk.
Kept ==
  \/ owed = None
  \/ held # "none" /\ draft.doc = owed
  \/ save.at \in {"sent", "checked", "rechecked"} /\ save.text = owed

(******************************* The rules ********************************)

\* Your unsaved text stays until you choose Discard draft.
UnsavedTextKept == Kept

\* A save never replaces a change that another program made to the file.
SaveKeepsOtherChanges == ~clobbered

\* When no save runs, the dot shows unsaved exactly when your text differs
\* from the file as Med last read or saved it.
DotTellsTruth ==
  (held # "none" /\ draft.base # None /\ ~draft.saving) => (draft.dirty <=> draft.doc # draft.base)

\* Once Med has caught up, the editor tells you when the file on disk is not
\* the text that it opened or saved.
ChangeShown == (Settled /\ ws = "shown" /\ held = "store" /\ disk # draft.base) => Banner

=============================================================================
