----------------------------- MODULE PhoneSync -----------------------------
(***************************************************************************)
(* One note on a highlight, edited on the phone and on the web, and the    *)
(* text of a link saved on the web. Highlights and notes sync whole, in    *)
(* the arctic-annotations namespace.                                       *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it. Paths start at the repository root.      *)
(* Written by hand on 24 October 2026 and not yet checked by TLC: see      *)
(* FINDINGS.md.                                                            *)
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

\* A hybrid clock stamps later than any stamp it has seen. Its counter is
\* folded into the one number here.
\* packages/local-sync/src/clock.ts:4-16, apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:230-234
Stamp(t, seen) == IF t > seen THEN t ELSE seen + 1

VARIABLES
  now,          \* the wall clock, in minutes
  webOnline,
  phoneOnline,
  webNote,      \* the note that the web shows: [text, at], at = updatedAt
  webHlc,       \* the web's stamp for that note
  webPending,   \* the web has not uploaded its edit
  webEdited,    \* model bound: one edit on the web
  server,       \* the account's copy: [note, hlc, by]
  phoneNote,    \* the note that the phone shows
  phoneRow,     \* the phone journal's copy of the server's row
  outbox,       \* the phone's upload, or NoRow
  phase,        \* "idle", "pulled" or "reconciled": one phone sync pass
  phoneEdited,  \* model bound: one edit on the phone
  newest,       \* history: the newest edit made so far
  phoneHasLink, \* the phone has the link saved on the web
  phoneText,    \* the phone keeps the article's text
  accountText   \* the account has the article's text, which the web shows

noteVars == <<webNote, webHlc, webPending, webEdited, server, phoneNote,
              phoneRow, outbox, phase, phoneEdited, newest>>
textVars == <<phoneHasLink, phoneText, accountText>>
vars == <<now, webOnline, phoneOnline, noteVars, textVars>>

Init ==
  /\ now = 1
  /\ webOnline = TRUE
  /\ phoneOnline = TRUE
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
  \* A link was just saved on the web: the account has its records, no text.
  /\ phoneHasLink = FALSE
  /\ phoneText = FALSE
  /\ accountText = FALSE

(***************************** The reader *********************************)

\* updatedAt has sub-millisecond precision, so two devices never stamp the
\* same instant. The model gives each minute one edit.
WebEdit ==
  /\ ~webEdited
  /\ newest.at # now
  /\ webNote' = [text |-> "web", at |-> now]  \* apps/arctic/Browser/src/annotations.ts:124
  /\ webHlc' = Stamp(now, webHlc)             \* apps/arctic/Browser/src/sync/storage.ts:172: stamped when written
  /\ webPending' = TRUE
  /\ webEdited' = TRUE
  /\ newest' = [text |-> "web", at |-> now]
  /\ UNCHANGED <<now, webOnline, phoneOnline, server, phoneNote, phoneRow,
                 outbox, phase, phoneEdited>>
  /\ UNCHANGED textVars

PhoneEdit ==
  /\ ~phoneEdited
  /\ newest.at # now
  /\ phoneNote' = [text |-> "phone", at |-> now] \* apps/arctic/Sources/AnnotationStore.swift:205
  /\ phoneEdited' = TRUE
  /\ newest' = [text |-> "phone", at |-> now]
  /\ UNCHANGED <<now, webOnline, phoneOnline, webNote, webHlc, webPending,
                 webEdited, server, phoneRow, outbox, phase>>
  /\ UNCHANGED textVars

\* Keep a copy on the web: the bookmarklet or a file (apps/arctic/Browser/src/Copies.tsx).
WebKeepsCopy ==
  /\ ~accountText
  /\ accountText' = TRUE
  /\ UNCHANGED <<now, webOnline, phoneOnline, phoneHasLink, phoneText>>
  /\ UNCHANGED noteVars

(****************************** The world *********************************)

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<webOnline, phoneOnline>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED textVars

WebNetwork ==
  /\ webOnline' = ~webOnline
  /\ UNCHANGED <<now, phoneOnline>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED textVars

PhoneNetwork ==
  /\ phoneOnline' = ~phoneOnline
  /\ UNCHANGED <<now, webOnline>>
  /\ UNCHANGED noteVars
  /\ UNCHANGED textVars

(****************************** The web ***********************************)

\* A pulled record as late as the web's unsent edit wins the fields that
\* both changed; a note edit changes the note and updatedAt, so it wins all.
WebPull ==
  /\ webOnline
  /\ server.hlc >= webHlc          \* apps/arctic/Browser/src/sync/storage.ts:231
  /\ server.note # webNote
  /\ webNote' = server.note
  /\ webHlc' = server.hlc
  /\ webPending' = FALSE           \* apps/arctic/Browser/src/sync/storage.ts:232-238
  /\ UNCHANGED <<now, webOnline, phoneOnline, webEdited, server, phoneNote,
                 phoneRow, outbox, phase, phoneEdited, newest>>
  /\ UNCHANGED textVars

WebPush ==
  /\ webOnline
  /\ webPending
  /\ webPending' = FALSE
  /\ IF Beats(webHlc, "web", server)  \* packages/local-sync/src/hono/d1.ts:72-81
       THEN /\ server' = [note |-> webNote, hlc |-> webHlc, by |-> "web"]
            /\ UNCHANGED <<webNote, webHlc>>
       ELSE /\ webNote' = server.note \* packages/local-sync/src/client.ts:212: the winner comes back
            /\ webHlc' = server.hlc
            /\ UNCHANGED server
  /\ UNCHANGED <<now, webOnline, phoneOnline, webEdited, phoneNote, phoneRow,
                 outbox, phase, phoneEdited, newest>>
  /\ UNCHANGED textVars

(***************************** The phone **********************************)

\* After an edit, a launch, or a return to the app.
\* apps/arctic/Sources/LibrarySync.swift:277-293
PhoneHasWork ==
  \/ server # phoneRow
  \/ phoneNote # phoneRow.note
  \/ outbox # NoRow

\* The server's row replaces an unsent upload that it beats.
\* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:405
ServerTakes(row) ==
  \/ server.hlc > row.hlc
  \/ server.hlc = row.hlc /\ Rank(server.by) >= Rank("phone")

PhonePull ==
  /\ phoneOnline
  /\ phase = "idle"
  /\ PhoneHasWork
  /\ phase' = "pulled"             \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:290
  /\ IF outbox # NoRow /\ ~ServerTakes(outbox)
       THEN UNCHANGED <<phoneRow, outbox>>
       ELSE /\ phoneRow' = server
            /\ outbox' = NoRow
  /\ UNCHANGED <<now, webOnline, phoneOnline, webNote, webHlc, webPending,
                 webEdited, server, phoneNote, phoneEdited, newest>>
  /\ UNCHANGED textVars

\* The newer updatedAt wins on the phone. An upload is stamped now, when the
\* phone syncs, and not when the note was edited.
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
            IN /\ outbox' = up     \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:216-222
               /\ phoneRow' = up
               /\ UNCHANGED phoneNote
       ELSE /\ phoneNote' = phoneRow.note \* apps/arctic/Sources/AnnotationStore.swift:235-240
            /\ UNCHANGED <<phoneRow, outbox>>
  /\ UNCHANGED <<now, webOnline, phoneOnline, webNote, webHlc, webPending,
                 webEdited, server, phoneEdited, newest>>
  /\ UNCHANGED textVars

PhonePush ==
  /\ phase = "reconciled"
  /\ phoneOnline \/ outbox = NoRow \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:292
  /\ phase' = "idle"
  /\ IF outbox = NoRow
       THEN UNCHANGED <<server, phoneRow, outbox>>
       ELSE /\ outbox' = NoRow
            /\ IF Beats(outbox.hlc, "phone", server) \* packages/local-sync/src/hono/d1.ts:72-81
                 THEN /\ server' = outbox
                      /\ phoneRow' = outbox
                 ELSE /\ phoneRow' = server \* apps/arctic/Sync/Sources/ArcticSync/SyncStore.swift:358-360
                      /\ UNCHANGED server
  /\ UNCHANGED <<now, webOnline, phoneOnline, webNote, webHlc, webPending,
                 webEdited, phoneNote, phoneEdited, newest>>
  /\ UNCHANGED textVars

\* Offline in the middle of a pass: the pass ends, and the outbox stays.
PhoneStops ==
  /\ phase # "idle"
  /\ ~phoneOnline                  \* apps/arctic/Sources/LibrarySync.swift:396
  /\ phase' = "idle"
  /\ UNCHANGED <<now, webOnline, phoneOnline, webNote, webHlc, webPending,
                 webEdited, server, phoneNote, phoneRow, outbox, phoneEdited, newest>>
  /\ UNCHANGED textVars

\* The library syncs before highlights and notes.
PhoneGetsLink ==
  /\ phoneOnline
  /\ ~phoneHasLink                 \* apps/arctic/Sources/LibrarySync.swift:277
  /\ phoneHasLink' = TRUE
  /\ UNCHANGED <<now, webOnline, phoneOnline, phoneText, accountText>>
  /\ UNCHANGED noteVars

\* A saved link is at the top of Saved, so the phone preloads its page, or
\* the reader opens it. The Reader copy stays on the phone.
PhoneKeepsText ==
  /\ phoneHasLink
  /\ ~phoneText                    \* apps/arctic/Sources/ArticleBrowser.swift:2119
  /\ phoneText' = TRUE             \* apps/arctic/Sources/ArticleBrowser.swift:1246
  /\ UNCHANGED <<now, webOnline, phoneOnline, phoneHasLink, accountText>>
  /\ UNCHANGED noteVars

Reader == WebEdit \/ PhoneEdit \/ WebKeepsCopy

World == Tick \/ WebNetwork \/ PhoneNetwork

System ==
  \/ WebPull \/ WebPush
  \/ PhonePull \/ PhoneReconcile \/ PhonePush \/ PhoneStops
  \/ PhoneGetsLink \/ PhoneKeepsText

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader, the clock or the network.
Settled == ~ENABLED System

BothOnline == webOnline /\ phoneOnline

(******************************* The rules ********************************)

\* Once both devices are online and done syncing, they show the same note.
SameNote == (Settled /\ BothOnline) => webNote = phoneNote

\* Once both devices are online and done syncing, the note is its newest edit.
NewestNote ==
  (Settled /\ BothOnline) => (webNote.at = newest.at /\ phoneNote.at = newest.at)

\* Once the phone has an article's text, the web can show it too.
TextReachesWeb == (Settled /\ phoneText) => accountText

=============================================================================
