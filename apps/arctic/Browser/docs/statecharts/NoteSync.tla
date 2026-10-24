------------------------------ MODULE NoteSync ------------------------------
(***************************************************************************)
(* One note on a highlight, edited on the phone and on the web. Highlights *)
(* and notes sync whole, in the arctic-annotations namespace. The phone's  *)
(* code is that of commit 9bb68715, before the fix.                       *)
(*                                                                         *)
(* A device that is offline is one whose sync steps wait. TLC tries every  *)
(* order of steps, so the model needs no network. Time is in whole        *)
(* minutes, and an edit takes one, so no two edits share a stamp. A       *)
(* hybrid clock's counter is folded into one number, and each device      *)
(* edits the note once.                                                    *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it. Paths start at the repository root.      *)
(***************************************************************************)
EXTENDS Naturals

\* The last minute that the model runs to. 4 is enough for every path here.
CONSTANT MaxTime

NoNote == [text |-> "none", at |-> 0]
NoRow == [note |-> NoNote, hlc |-> 0, by |-> "none"]

\* The server keeps the change with the higher stamp, then the higher device.
\* packages/local-sync/src/hono/d1.ts:72-81
Rank(device) == CASE device = "web" -> 2 [] device = "phone" -> 1 [] OTHER -> 0
Beats(hlc, device, row) ==
  \/ hlc > row.hlc
  \/ hlc = row.hlc /\ Rank(device) > Rank(row.by)

\* A hybrid clock stamps later than any stamp it has seen.
\* packages/local-sync/src/clock.ts:4-16, apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:230-234
Stamp(t, seen) == IF t > seen THEN t ELSE seen + 1

VARIABLES
  now,          \* the wall clock, in minutes
  webNote,      \* the note that the web shows: [text, at], at = updatedAt
  webHlc,       \* the web's stamp for that note
  webPending,   \* the web has not uploaded its edit
  webEdited,    \* model bound: one edit on the web
  server,       \* the account's copy: [note, hlc, by]
  phoneNote,    \* the note that the phone shows
  phoneRow,     \* the phone journal's row for the note
  outbox,       \* the phone journal's unsent change, or NoRow
  phase,        \* "idle", "pulled" or "reconciled": one phone sync pass
  phoneEdited,  \* model bound: one edit on the phone
  newest        \* history: the newest edit made so far

vars == <<now, webNote, webHlc, webPending, webEdited, server, phoneNote,
          phoneRow, outbox, phase, phoneEdited, newest>>

Init ==
  /\ now = 1
  /\ webNote = NoNote
  /\ webHlc = 0
  /\ webPending = FALSE
  /\ webEdited = FALSE
  /\ server = NoRow
  /\ phoneNote = NoNote
  /\ phoneRow = NoRow
  /\ outbox = NoRow
  /\ phase = "idle"
  /\ phoneEdited = FALSE
  /\ newest = NoNote

(***************************** The reader *********************************)

\* updatedAt has millisecond precision, so two edits rarely share an
\* instant. In the model an edit takes a minute.
WebEdit ==
  /\ ~webEdited
  /\ now < MaxTime
  /\ now' = now + 1
  /\ webNote' = [text |-> "web", at |-> now]  \* apps/arctic/Browser/src/annotations.ts:124
  /\ webHlc' = Stamp(now, webHlc)             \* apps/arctic/Browser/src/sync/storage.ts:172: stamped when written
  /\ webPending' = TRUE
  /\ webEdited' = TRUE
  /\ newest' = [text |-> "web", at |-> now]
  /\ UNCHANGED <<server, phoneNote, phoneRow, outbox, phase, phoneEdited>>

\* The edit is saved in the phone's files. The journal hears of it at the
\* next sync (apps/arctic/Sources/LibrarySync.swift:82).
PhoneEdit ==
  /\ ~phoneEdited
  /\ now < MaxTime
  /\ now' = now + 1
  /\ phoneNote' = [text |-> "phone", at |-> now] \* apps/arctic/Sources/AnnotationStore.swift:205
  /\ phoneEdited' = TRUE
  /\ newest' = [text |-> "phone", at |-> now]
  /\ UNCHANGED <<webNote, webHlc, webPending, webEdited, server, phoneRow,
                 outbox, phase>>

(****************************** The world *********************************)

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<webNote, webHlc, webPending, webEdited, server, phoneNote,
                 phoneRow, outbox, phase, phoneEdited, newest>>

(****************************** The web ***********************************)

\* A pulled record as late as the web's unsent edit wins the fields that
\* both changed; a note edit changes the note and updatedAt, so it wins all.
WebPull ==
  /\ server.hlc >= webHlc          \* apps/arctic/Browser/src/sync/storage.ts:231
  /\ server.note # webNote         \* packages/local-sync/src/client.ts:129, 173: rows past the cursor
  /\ webNote' = server.note
  /\ webHlc' = server.hlc
  /\ webPending' = FALSE           \* apps/arctic/Browser/src/sync/storage.ts:232-238
  /\ UNCHANGED <<now, webEdited, server, phoneNote, phoneRow, outbox, phase,
                 phoneEdited, newest>>

WebPush ==
  /\ webPending
  /\ webPending' = FALSE
  /\ IF Beats(webHlc, "web", server)  \* packages/local-sync/src/hono/d1.ts:72-81
       THEN /\ server' = [note |-> webNote, hlc |-> webHlc, by |-> "web"]
            /\ UNCHANGED <<webNote, webHlc>>
       ELSE /\ webNote' = server.note \* packages/local-sync/src/client.ts:212: the winner comes back
            /\ webHlc' = server.hlc
            /\ UNCHANGED server
  /\ UNCHANGED <<now, webEdited, phoneNote, phoneRow, outbox, phase,
                 phoneEdited, newest>>

(***************************** The phone **********************************)

\* The phone syncs after an edit, a launch or a return to the app. A pass
\* with nothing to pull or send changes nothing, so the model leaves it out.
\* apps/arctic/Sources/LibrarySync.swift:277-293
PhoneHasWork ==
  \/ server # phoneRow
  \/ phoneNote # phoneRow.note
  \/ outbox # NoRow

\* The server's row replaces an unsent change that it beats.
\* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:399-407
ServerTakes(row) ==
  \/ server.hlc > row.hlc
  \/ server.hlc = row.hlc /\ Rank(server.by) >= Rank("phone")

PhonePull ==
  /\ phase = "idle"
  /\ PhoneHasWork                 \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:306-308, apps/arctic/Sources/LibrarySync.swift:82
  /\ phase' = "pulled"             \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:290
  /\ IF outbox # NoRow /\ ~ServerTakes(outbox)
       THEN UNCHANGED <<phoneRow, outbox>>
       ELSE /\ phoneRow' = server
            /\ outbox' = NoRow
  /\ UNCHANGED <<now, webNote, webHlc, webPending, webEdited, server, phoneNote,
                 phoneEdited, newest>>

\* The newer updatedAt wins on the phone. A change committed here is
\* stamped now, when the phone syncs, and not when the note was edited.
PhoneReconcile ==
  /\ phase = "pulled"
  /\ phase' = "reconciled"         \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:291
  /\ IF phoneNote = phoneRow.note  \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:268
       THEN UNCHANGED <<phoneNote, phoneRow, outbox>>
       ELSE IF phoneNote = NoNote  \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:275
       THEN /\ phoneNote' = phoneRow.note
            /\ UNCHANGED <<phoneRow, outbox>>
       ELSE IF phoneRow.note = NoNote \/ phoneNote.at > phoneRow.note.at
            \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:264, apps/arctic/Sources/LibrarySync.swift:484
       THEN LET up == [note |-> phoneNote, hlc |-> Stamp(now, phoneRow.hlc), by |-> "phone"]
            IN /\ outbox' = up     \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:215, 278
               /\ phoneRow' = up
               /\ UNCHANGED phoneNote
       ELSE /\ phoneNote' = phoneRow.note \* apps/arctic/Sources/AnnotationStore.swift:236
            /\ UNCHANGED <<phoneRow, outbox>>
  /\ UNCHANGED <<now, webNote, webHlc, webPending, webEdited, server,
                 phoneEdited, newest>>

PhonePush ==
  /\ phase = "reconciled"
  /\ phase' = "idle"               \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:292
  /\ IF outbox = NoRow
       THEN UNCHANGED <<server, phoneRow, outbox>>
       ELSE /\ outbox' = NoRow
            /\ IF Beats(outbox.hlc, "phone", server) \* packages/local-sync/src/hono/d1.ts:72-81
                 THEN /\ server' = outbox
                      /\ phoneRow' = outbox
                 ELSE /\ phoneRow' = server \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:358-360
                      /\ UNCHANGED server
  /\ UNCHANGED <<now, webNote, webHlc, webPending, webEdited, phoneNote,
                 phoneEdited, newest>>

Reader == WebEdit \/ PhoneEdit

World == Tick

System == WebPull \/ WebPush \/ PhonePull \/ PhoneReconcile \/ PhonePush

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader or the clock.
Settled == ~ENABLED System

(******************************* The rules ********************************)

\* Once both devices are done syncing, they show the same note.
SameNote == Settled => webNote = phoneNote

\* Once both devices are done syncing, the note is its newest edit.
NewestNote == Settled => (webNote.at = newest.at /\ phoneNote.at = newest.at)

=============================================================================
