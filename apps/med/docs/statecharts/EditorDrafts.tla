---------------------------- MODULE EditorDrafts ----------------------------
(***************************************************************************)
(* One working file that you edit in a workspace: its draft in the        *)
(* editor, the host's checked save, the workspace that keeps the draft,   *)
(* and another program, such as an agent, that writes the same file.      *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, at   *)
(* main d53abaa8, before the fix.                                          *)
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
  held,        \* who keeps the draft: "store" (the workspace's App) or "none"
  save,        \* at: "none", "sent", "checked", "rechecked", "ok" or "refused"
  stale,       \* web/data/file-workspace.ts:530: Med saw that the file changed
  owed,        \* history: your newest unsaved text, until it reaches the disk or you discard it
  clobbered,   \* history: a save replaced a change that another program made
  otherWrote   \* model bound: the other program writes once

vars == <<disk, event, ws, draft, held, save, stale, owed, clobbered, otherWrote>>

\* The editor says that the file changed on disk only in a refused save's
\* error (web/components/FileEditor.tsx:806-810). Its other messages
\* (FileEditor.tsx:811-837) are the clipboard, syntax and discard ones;
\* nothing shows context.stale. Only the read-only view has that notice
\* (web/components/FullFileView.tsx:546-553), and a working file opens in
\* the editor (web/components/FullFileView.tsx:996-1002).
Banner == held = "store" /\ draft.refused

Init ==
  /\ disk = "A"
  /\ event = FALSE
  /\ ws = "shown"
  /\ draft = NoDraft
  /\ held = "none"
  /\ save = NoSave
  /\ stale = FALSE
  /\ owed = None
  /\ clobbered = FALSE
  /\ otherWrote = FALSE

(***************************** The reader *********************************)

OpenFile ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150: the workspace on screen
  /\ held # "store"                         \* web/data/editor-drafts.ts:38-39: no draft in this App
  /\ draft' = Fresh(disk)                   \* web/data/editor-drafts.ts:51-61, from the host's read
  /\ held' = "store"
  /\ save' = [save EXCEPT !.mine = FALSE]   \* an answer on its way goes to the draft that sent it
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:268
  /\ UNCHANGED <<disk, event, ws, owed, clobbered, otherWrote>>

Type ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054: the editor shows the draft
  /\ \E text \in {"U", "V"} \ {draft.doc}:
       /\ draft' = [draft EXCEPT !.doc = text,
                      !.dirty = (text # draft.base)]   \* web/components/FileEditor.tsx:496
       \* Text that the file on disk has already is not owed.
       /\ owed' = IF text # draft.base /\ text # disk THEN text ELSE None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, clobbered, otherWrote>>

\* u back to the text that Med last read or saved.
Undo ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.doc # draft.base                 \* web/components/FileEditor.tsx:496
  /\ draft' = [draft EXCEPT !.doc = draft.base, !.dirty = FALSE]
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, held, save, stale, clobbered, otherWrote>>

\* :w, Cmd+S or Save.
Save ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:370
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:370
  /\ save.at = "none"                       \* model bound: one save at a time
  /\ draft' = [draft EXCEPT !.saving = TRUE, !.refused = FALSE]   \* FileEditor.tsx:372
  /\ save' = [at |-> "sent", text |-> draft.doc,
              expected |-> draft.base, mine |-> TRUE]            \* FileEditor.tsx:375
  /\ UNCHANGED <<disk, event, ws, held, stale, owed, clobbered, otherWrote>>

\* Close file, then Discard draft.
Discard ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ draft.dirty                            \* web/components/FileEditor.tsx:391-394: Close asks only when unsaved
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:390
  /\ draft' = NoDraft                       \* web/components/FileEditor.tsx:826-830
  /\ held' = "none"
  /\ owed' = None
  /\ UNCHANGED <<disk, event, ws, save, stale, clobbered, otherWrote>>

\* Refresh file reads the file again; a new read replaces a clean draft.
Refresh ==
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:2150
  /\ held = "store"                         \* web/components/FullFileView.tsx:1054
  /\ ~draft.dirty                           \* web/components/FileEditor.tsx:794
  /\ ~draft.saving                          \* web/components/FileEditor.tsx:794
  /\ disk # draft.base                      \* web/components/FullFileView.tsx:991
  /\ draft' = Fresh(disk)                   \* web/components/FullFileView.tsx:993
  /\ stale' = FALSE                         \* web/data/file-workspace.ts:538, 268
  /\ UNCHANGED <<disk, event, ws, held, save, owed, clobbered, otherWrote>>

\* Show another workspace: this one stays mounted, hidden.
Hide ==
  /\ ws = "shown"
  /\ ws' = "hidden"                         \* web/components/Workspaces.tsx:2150
  /\ UNCHANGED <<disk, event, draft, held, save, stale, owed, clobbered, otherWrote>>

Show ==
  /\ ws = "hidden"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, owed, clobbered, otherWrote>>

\* x on the thread's row, Cmd+Opt+W, or Close workspace. The drafts live in
\* the App (web/App.tsx:520), which unmounts with its workspace. Close checks
\* nothing (web/components/Workspaces.tsx:608-611, web/data/workspaces.ts:340-345).
CloseWorkspace ==
  /\ ws # "closed"
  /\ ws' = "closed"
  /\ held' = "none"
  /\ UNCHANGED <<disk, event, draft, save, stale, owed, clobbered, otherWrote>>

\* Open the thread or branch again: a new App, with an empty draft store.
Reopen ==
  /\ ws = "closed"
  /\ ws' = "shown"
  /\ UNCHANGED <<disk, event, draft, held, save, stale, owed, clobbered, otherWrote>>

(****************************** The world *********************************)

\* An agent or another editor writes the file.
OtherWrite ==
  /\ ~otherWrote
  /\ disk' = "O"
  /\ event' = TRUE
  /\ otherWrote' = TRUE
  /\ UNCHANGED <<ws, draft, held, save, stale, owed, clobbered>>

(******************************* The app **********************************)

\* After you show other workspaces, the least recent hidden one leaves
\* memory: past 16 tabs or 6 other workspaces
\* (web/components/Workspaces.tsx:1862-1866, 104, 107).
UnloadWorkspace ==
  /\ ws = "hidden"
  /\ ws' = "closed"
  /\ held' = "none"
  /\ UNCHANGED <<disk, event, draft, save, stale, owed, clobbered, otherWrote>>

\* Med compares the file on disk with the open file after a watch event.
Notice ==
  /\ event                                  \* web/App.tsx:651-654: a new source revision
  /\ ws = "shown"                           \* web/components/Workspaces.tsx:1813-1818: only the workspace on screen listens
  /\ event' = FALSE
  /\ IF held = "store"                      \* web/data/file-workspace.ts:519: an open working file
       THEN stale' = (disk # draft.base)    \* web/data/file-workspace.ts:530
       ELSE UNCHANGED stale
  /\ UNCHANGED <<disk, ws, draft, held, save, owed, clobbered, otherWrote>>

\* The host's save (host/repository/browse.ts:396-479).
HostCheck ==
  /\ save.at = "sent"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "checked" ELSE "refused"]  \* browse.ts:435
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, owed, clobbered, otherWrote>>

\* After it writes and flushes the temporary file.
HostRecheck ==
  /\ save.at = "checked"
  /\ save' = [save EXCEPT !.at = IF disk = save.expected THEN "rechecked" ELSE "refused"]  \* browse.ts:452-460
  /\ UNCHANGED <<disk, event, ws, draft, held, stale, owed, clobbered, otherWrote>>

\* parentSafe and the access check wait (browse.ts:461-462), then rename
\* replaces the file.
HostRename ==
  /\ save.at = "rechecked"
  /\ disk' = save.text                      \* browse.ts:463
  /\ event' = TRUE
  /\ clobbered' = (clobbered \/ disk # save.expected)
  /\ owed' = IF owed = save.text THEN None ELSE owed
  /\ save' = [save EXCEPT !.at = "ok"]
  /\ UNCHANGED <<ws, draft, held, stale, otherWrote>>

\* The editor takes the host's answer (web/components/FileEditor.tsx:374-386).
\* A draft that no store keeps still takes it, but nothing shows it.
Answer ==
  /\ save.at \in {"ok", "refused"}
  /\ save' = NoSave
  /\ IF save.mine /\ held # "none"
       THEN IF save.at = "ok"
              THEN /\ draft' = [draft EXCEPT !.base = save.text,
                                  !.dirty = (draft.doc # save.text),
                                  !.saving = FALSE]               \* FileEditor.tsx:376-380
                   /\ owed' = IF draft.doc # save.text THEN draft.doc ELSE None
                   /\ stale' = FALSE                              \* web/App.tsx:3105, file-workspace.ts:514
              ELSE /\ draft' = [draft EXCEPT !.saving = FALSE,
                                  !.refused = TRUE]               \* FileEditor.tsx:381-385
                   /\ UNCHANGED <<owed, stale>>
       ELSE UNCHANGED <<draft, owed, stale>>
  /\ UNCHANGED <<disk, event, ws, held, clobbered, otherWrote>>

Reader ==
  \/ OpenFile \/ Type \/ Undo \/ Save \/ Discard \/ Refresh
  \/ Hide \/ Show \/ CloseWorkspace \/ Reopen

World == OtherWrite

System ==
  \/ UnloadWorkspace \/ Notice
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
