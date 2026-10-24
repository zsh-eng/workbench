---------------------------- MODULE EditorDrafts ----------------------------
(***************************************************************************)
(* One working file that you edit in a workspace: its draft in the        *)
(* editor, the host's checked save, the workspace that keeps the draft,   *)
(* the page that can reload, and another program, such as an agent, that  *)
(* writes the same file.                                                   *)
(*                                                                         *)
(* The fix: a workspace that closes or leaves memory gives its unsaved    *)
(* drafts to the window, and the next editor that opens the file takes    *)
(* the draft back. Closing a workspace with an unsaved draft asks first.  *)
(* Unsaved drafts are in the browser's storage too, so a reload keeps     *)
(* them. The editor says when the file on disk is not the text that the   *)
(* draft started from, reads it, and shows the change with two choices:   *)
(* Keep my version and Use the file on disk. Med checks the file again    *)
(* after a save. The host's last check before the rename is the file's   *)
(* metadata, with no wait between them.                                    *)
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

\* web/data/editor-drafts.ts:4-20. base is savedText and file.identity.
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
  reading,     \* a read of the file after a refused save, not done yet
  asking,      \* the question before a close shows
  owed,        \* history: your newest unsaved text, until it reaches the disk or you discard it
  clobbered,   \* history: a save replaced a change that another program made
  unasked,     \* history: a close of a workspace with an unsaved draft did not ask
  otherWrote,  \* model bound: the other program writes once
  reloaded     \* model bound: you reload the page once

vars == <<disk, event, ws, draft, held, save, stale, read, recheck, reading, asking, owed,
          clobbered, unasked, otherWrote, reloaded>>

Unsaved == draft.dirty \/ draft.saving

\* The editor says that the file changed on disk: a refused save's error
\* (web/components/FileEditor.tsx:873-877), or, while no save runs, the
\* notice for a stale file or a read that differs from the draft's, with
\* the change and the two choices for an unsaved draft
\* (FileEditor.tsx:238-252, 878-900).
Banner ==
  /\ held = "store"
  /\ \/ draft.refused
     \/ ~draft.saving /\ (stale \/ read # draft.base)

\* An unsaved draft, and a read of the file that is not its text: the
\* editor shows the change on disk, Keep my version and Use the file on disk.
Conflict ==
  /\ held = "store"
  /\ draft.dirty                            \* web/components/FileEditor.tsx:252
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:249
  /\ read # None /\ read # draft.base       \* web/components/FileEditor.tsx:238-244

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
  /\ reading = FALSE
  /\ asking = FALSE
  /\ owed = None
  /\ clobbered = FALSE
  /\ unasked = FALSE
  /\ otherWrote = FALSE
  /\ reloaded = FALSE

(***************************** The reader *********************************)

\* The window gives a parked draft back. A clean one that the disk passed
\* is read again.
OpenFile ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229: the workspace on screen
  /\ held # "store"                         \* web/data/editor-drafts.ts:260-261: no unsaved draft in this App
  /\ IF held = "parked"                     \* web/data/editor-drafts.ts:263-265
       THEN /\ draft' = IF ~draft.dirty /\ ~draft.saving /\ draft.base # disk  \* editor-drafts.ts:273
                         THEN Fresh(disk) ELSE draft
            /\ UNCHANGED save
       ELSE /\ draft' = Fresh(disk)         \* web/data/editor-drafts.ts:273-285, from the host's read
            /\ save' = [save EXCEPT !.mine = FALSE]   \* an answer on its way goes to the draft that sent it
  /\ held' = "store"
  /\ read' = disk
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:270
  /\ UNCHANGED <<disk, event, ws, recheck, reading, asking, owed, clobbered, unasked,
                 otherWrote, reloaded>>

Type ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054: the editor shows the draft
  /\ \E text \in {"U", "V"} \ {draft.doc}:
       /\ draft' = [draft EXCEPT !.doc = text,
                      !.dirty = (text # draft.base)]   \* web/components/FileEditor.tsx:562
       \* Text that the file on disk has already is not owed.
       /\ owed' = IF text # draft.base /\ text # disk THEN text ELSE None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, read, recheck, reading, asking, clobbered,
                 unasked, otherWrote, reloaded>>

\* u back to the text that Med last read or saved.
Undo ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.doc # draft.base                 \* web/components/FileEditor.tsx:562
  /\ draft' = [draft EXCEPT !.doc = draft.base, !.dirty = FALSE]
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, read, recheck, reading, asking, clobbered,
                 unasked, otherWrote, reloaded>>

\* :w, Cmd+S or Save: over the file that the draft started from.
Save ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:427
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:427
  /\ save.at = "none"                       \* model bound: one save at a time
  /\ draft' = [draft EXCEPT !.saving = TRUE, !.refused = FALSE]   \* FileEditor.tsx:429
  /\ save' = [at |-> "sent", text |-> draft.doc,
              expected |-> draft.base, mine |-> TRUE]            \* FileEditor.tsx:432
  /\ UNCHANGED <<disk, event, ws, held, stale, read, recheck, reading, asking, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* Keep my version: the draft goes over the file as Med read it now.
KeepMine ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ Conflict                               \* web/components/FileEditor.tsx:878-882
  /\ save.at = "none"                       \* model bound: one save at a time
  /\ draft' = [draft EXCEPT !.saving = TRUE, !.refused = FALSE]   \* FileEditor.tsx:429
  /\ save' = [at |-> "sent", text |-> draft.doc,
              expected |-> read, mine |-> TRUE]                  \* FileEditor.tsx:432, 882
  /\ UNCHANGED <<disk, event, ws, held, stale, read, recheck, reading, asking, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* Use the file on disk: the draft goes, and a new one starts from the read.
UseDisk ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ Conflict                               \* web/components/FileEditor.tsx:878-883
  /\ draft' = Fresh(read)                   \* web/components/FileEditor.tsx:448-452
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, read, recheck, reading, asking, clobbered,
                 unasked, otherWrote, reloaded>>

\* Close file, then Discard draft.
Discard ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:457-459: Close asks only when unsaved
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:456
  /\ draft' = NoDraft                       \* web/components/FileEditor.tsx:917-921
  /\ held' = "none"
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, save, stale, read, recheck, reading, asking, clobbered,
                 unasked, otherWrote, reloaded>>

\* Refresh file reads the file again; a new read replaces a clean draft.
Refresh ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2229
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ ~draft.dirty                           \* web/components/FileEditor.tsx:861
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:861
  /\ disk # draft.base                      \* web/components/FullFileView.tsx:991
  /\ draft' = Fresh(disk)                   \* web/components/FullFileView.tsx:993
  /\ read' = disk
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:548, 270
  /\ UNCHANGED <<disk, event, ws, held, save, recheck, reading, asking, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* Show another workspace: this one stays mounted, hidden.
Hide ==
  /\ ws = "shown"
  /\ ws' = "hidden"                         \* web/components/Workspaces.tsx:2229
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

Show ==
  /\ ws = "hidden"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* x on the thread's row, Cmd+Opt+W, or Close workspace. With an unsaved
\* draft it asks first (web/components/Workspaces.tsx:1160-1163, 1230,
\* 643-645); without one it closes, and the App drops its saved drafts.
CloseWorkspace ==
  /\ ws # "closed"
  /\ ~asking                                \* model bound: one question at a time
  /\ IF held = "store" /\ Unsaved           \* web/components/Workspaces.tsx:1162-1163
       THEN /\ asking' = TRUE
            /\ UNCHANGED <<ws, held>>
       ELSE /\ ws' = "closed"
            /\ held' = IF held = "store" THEN "none" ELSE held
            /\ UNCHANGED asking
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, reading, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* Close in the question. The App gives its unsaved drafts to the window as
\* its workspace closes (web/App.tsx:527, web/data/editor-drafts.ts:308-314).
ConfirmClose ==
  /\ asking                                 \* web/components/Workspaces.tsx:1172-1176
  /\ asking' = FALSE
  /\ ws' = "closed"
  /\ held' = IF held = "store" /\ Unsaved THEN "parked"   \* editor-drafts.ts:313
             ELSE IF held = "store" THEN "none" ELSE held
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, reading, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* Cancel in the question.
CancelClose ==
  /\ asking                                 \* web/components/Workspaces.tsx:1178
  /\ asking' = FALSE
  /\ UNCHANGED <<disk, event, ws, draft, held, save, stale, read, recheck, reading, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* Open the thread or branch again: a new App, with an empty draft store.
Reopen ==
  /\ ws = "closed"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* Reload the page. The unsaved draft is in storage: it waits in the new
\* window, without its undo history, and its workspace takes it back
\* (web/data/editor-drafts.ts:96-112, 237-241). A save on its way finishes
\* on the host, but no page takes its answer.
Reload ==
  /\ ~reloaded
  /\ reloaded' = TRUE
  /\ ws' = IF ws = "closed" THEN "closed" ELSE "shown"
  /\ IF held # "none" /\ Unsaved             \* web/data/editor-drafts.ts:199-208: storage has each unsaved draft
       THEN /\ held' = "parked"
            /\ draft' = [draft EXCEPT !.saving = FALSE, !.refused = FALSE,
                           !.dirty = (draft.doc # draft.base)]   \* editor-drafts.ts:100-109
       ELSE /\ held' = "none"
            /\ draft' = NoDraft
  /\ save' = [save EXCEPT !.mine = FALSE]
  /\ event' = FALSE
  /\ stale' = FALSE
  /\ read' = None
  /\ recheck' = FALSE
  /\ reading' = FALSE
  /\ asking' = FALSE
  /\ UNCHANGED <<disk, owed, clobbered, unasked, otherWrote>>

(****************************** The world *********************************)

\* An agent or another editor writes the file.
OtherWrite ==
  /\ ~otherWrote
  /\ disk' = "O"
  /\ event' = TRUE
  /\ otherWrote' = TRUE
  /\ UNCHANGED <<ws, draft, held, save, stale, read, recheck, reading, asking, owed, clobbered,
                 unasked, reloaded>>

(******************************* The app **********************************)

\* After you show other workspaces, the least recent hidden one leaves
\* memory: past 16 tabs or 6 other workspaces
\* (web/components/Workspaces.tsx:1941-1945, 105, 108).
UnloadWorkspace ==
  /\ ws = "hidden"
  /\ ws' = "closed"
  /\ held' = IF held = "store" /\ Unsaved THEN "parked"   \* editor-drafts.ts:313
             ELSE IF held = "store" THEN "none" ELSE held
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* Med closes a tab whose work has landed once it has been off screen for a
\* while, but not one with unsaved drafts (web/components/Workspaces.tsx:1474-1498).
AutoClose ==
  /\ ws = "hidden"                          \* web/components/Workspaces.tsx:1493: not on screen
  /\ ~(held = "store" /\ Unsaved)           \* web/components/Workspaces.tsx:1490
  /\ ws' = "closed"
  /\ held' = IF held = "store" THEN "none" ELSE held
  /\ UNCHANGED <<disk, event, draft, save, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* Med compares the file on disk with the open file after a watch event.
Notice ==
  /\ event                                  \* web/App.tsx:663: a new source revision
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:1893-1898: only the workspace on screen listens
  /\ event' = FALSE
  /\ IF held = "store"                      \* web/data/file-workspace.ts:323-324: an open working file
       THEN stale' = (disk # read)          \* web/data/file-workspace.ts:334
       ELSE UNCHANGED stale
  /\ UNCHANGED <<disk, ws, draft, held, save, read, recheck, reading, asking, owed, clobbered,
                 unasked, otherWrote, reloaded>>

\* The editor reads the file to show the change: for a stale file with an
\* unsaved draft, or after a refused save. The read keeps the draft.
ReadDisk ==
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054: the editor shows the draft
  /\ \/ reading                             \* web/components/FileEditor.tsx:441
     \/ /\ ws = "shown"                     \* web/components/Workspaces.tsx:2229: the editor's effects run
        /\ stale /\ draft.dirty /\ ~draft.saving   \* web/components/FileEditor.tsx:255-258
  /\ read' = disk
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:270
  /\ reading' = FALSE
  /\ UNCHANGED <<disk, event, ws, draft, held, save, recheck, asking, owed, clobbered, unasked,
                 otherWrote, reloaded>>

\* The host's save (host/repository/browse.ts:396-484).
HostCheck ==
  /\ save.at = "sent"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "checked" ELSE "refused"]  \* browse.ts:435
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* After it writes and flushes the temporary file: the content and the
\* folder, then the file's metadata, last (browse.ts:451-464).
HostRecheck ==
  /\ save.at = "checked"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "rechecked" ELSE "refused"]  \* browse.ts:451-464
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, read, recheck, reading, asking, owed,
                 clobbered, unasked, otherWrote, reloaded>>

\* The access check runs at once, then rename replaces the file
\* (browse.ts:465-466). Another program's write between the last check and
\* the rename is lost; no lock can stop it.
HostRename ==
  /\ save.at = "rechecked"
  /\ disk' = save.text                      \* browse.ts:466
  /\ event' = TRUE
  /\ clobbered' = (clobbered \/ disk # save.expected)
  /\ owed' = IF owed = save.text THEN None ELSE owed
  /\ save' = [save EXCEPT !.at = "ok"]
  /\ UNCHANGED <<ws, draft, held, stale, read, recheck, reading, asking, unasked, otherWrote,
                 reloaded>>

\* The editor takes the host's answer (web/components/FileEditor.tsx:431-445).
\* A parked draft takes it too. The open workspace takes the saved file and
\* reads the disk again (web/App.tsx:3115, file-workspace.ts:531-543). A
\* refused save reads the file, to show the change (FileEditor.tsx:441).
Answer ==
  /\ save.at \in {"ok", "refused"}
  /\ save' = NoSave
  /\ IF save.mine /\ held # "none"
       THEN IF save.at = "ok"
              THEN /\ draft' = [draft EXCEPT !.base = save.text,
                                  !.dirty = (draft.doc # save.text),
                                  !.saving = FALSE]               \* FileEditor.tsx:433-437
                   /\ owed' = IF draft.doc # save.text THEN draft.doc ELSE None
                   /\ IF held = "store"
                        THEN /\ read' = save.text
                             /\ stale' = FALSE                    \* file-workspace.ts:539
                             /\ recheck' = TRUE                   \* file-workspace.ts:542
                        ELSE UNCHANGED <<read, stale, recheck>>
                   /\ UNCHANGED reading
              ELSE /\ draft' = [draft EXCEPT !.saving = FALSE,
                                  !.refused = TRUE]               \* FileEditor.tsx:438-441
                   /\ reading' = (held = "store")
                   /\ UNCHANGED <<owed, read, stale, recheck>>
       ELSE UNCHANGED <<draft, owed, read, stale, recheck, reading>>
  /\ UNCHANGED <<disk, event, ws, held, asking, clobbered, unasked, otherWrote, reloaded>>

\* The check after a save compares the disk with the saved file.
Recheck ==
  /\ recheck
  /\ recheck' = FALSE
  /\ IF held = "store"                      \* web/data/file-workspace.ts:323-324
       THEN stale' = (disk # read)          \* web/data/file-workspace.ts:334
       ELSE UNCHANGED stale
  /\ UNCHANGED <<disk, event, ws, draft, held, save, read, reading, asking, owed, clobbered,
                 unasked, otherWrote, reloaded>>

Reader ==
  \/ OpenFile \/ Type \/ Undo \/ Save \/ KeepMine \/ UseDisk \/ Discard \/ Refresh
  \/ Hide \/ Show \/ CloseWorkspace \/ ConfirmClose \/ CancelClose \/ Reopen \/ Reload

World == OtherWrite

System ==
  \/ UnloadWorkspace \/ AutoClose \/ Notice \/ ReadDisk \/ Recheck
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

\* Closing a workspace with an unsaved draft asks you first. Med does not
\* close one on its own.
CloseAsks == ~unasked

=============================================================================
