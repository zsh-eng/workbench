----------------------------- MODULE TextSheet -----------------------------
(***************************************************************************)
(* The reader's Text and theme sheet in Arctic for the web on a phone, and *)
(* the network. The sheet's code is a separate chunk that loads on the     *)
(* first sheet, or at idle before it. The Notes and More sheets share it.  *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it; paths are relative to apps/arctic/Browser.*)
(***************************************************************************)

VARIABLES
  screen,      \* "library" or "reader"
  net,         \* "online" or "offline"
  sheetCode,   \* "absent", "loading", "loaded" or "failed": the sheet's code
  cached,      \* the service worker holds the sheet's code
  sheetAsked   \* Text and theme was tapped, and its sheet was not closed

vars == <<screen, net, sheetCode, cached, sheetAsked>>

Init ==
  /\ screen = "library"
  /\ net \in {"online", "offline"}
  /\ sheetCode = "absent"
  /\ cached = FALSE
  /\ sheetAsked = FALSE

(***************************** The reader *********************************)

OpenArticle ==
  /\ screen = "library"
  /\ screen' = "reader"
  /\ UNCHANGED <<net, sheetCode, cached, sheetAsked>>

Back ==
  /\ screen = "reader"
  /\ screen' = "library"
  /\ sheetAsked' = FALSE       \* src/Reader.tsx:547: the panel's state leaves with the page
  /\ UNCHANGED <<net, sheetCode, cached>>

TapTextAndTheme ==
  /\ screen = "reader"
  /\ ~sheetAsked               \* src/Reader.tsx:553: a second tap changes nothing
  /\ sheetAsked' = TRUE
  /\ sheetCode' = IF sheetCode = "absent" THEN "loading" ELSE sheetCode \* src/surface.tsx:94
  /\ UNCHANGED <<screen, net, cached>>

CloseSheet ==
  /\ sheetAsked
  /\ sheetCode = "loaded"      \* src/surface.tsx:99: only loaded code draws a sheet
  /\ sheetAsked' = FALSE
  /\ UNCHANGED <<screen, net, sheetCode, cached>>

(****************************** The world *********************************)

GoOffline ==
  /\ net = "online"
  /\ net' = "offline"
  /\ UNCHANGED <<screen, sheetCode, cached, sheetAsked>>

GoOnline ==
  /\ net = "offline"
  /\ net' = "online"
  /\ UNCHANGED <<screen, sheetCode, cached, sheetAsked>>

(******************************* The app **********************************)

\* At idle, a phone loads the sheet's code before the first sheet.
PreloadSheet ==
  /\ sheetCode = "absent"      \* src/surface.tsx:81-85
  /\ sheetCode' = "loading"
  /\ UNCHANGED <<screen, net, cached, sheetAsked>>

SheetLoads ==
  /\ sheetCode = "loading"
  /\ net = "online" \/ cached  \* public/sw.js:78-81
  /\ sheetCode' = "loaded"
  /\ cached' = TRUE            \* public/sw.js:83-84
  /\ UNCHANGED <<screen, net, sheetAsked>>

\* The service worker installs only what index.html names, so the sheet's
\* chunk is cached after its first online load (public/sw.js:11-13).
\* No step leaves "failed": src/surface.tsx:73 keeps the rejected import,
\* and src/surface.tsx:94 asks the same promise again.
SheetFails ==
  /\ sheetCode = "loading"
  /\ net = "offline"           \* public/sw.js:81
  /\ ~cached                   \* public/sw.js:78-80
  /\ sheetCode' = "failed"
  /\ UNCHANGED <<screen, net, cached, sheetAsked>>

Reader == OpenArticle \/ Back \/ TapTextAndTheme \/ CloseSheet

World == GoOffline \/ GoOnline

System == PreloadSheet \/ SheetLoads \/ SheetFails

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader or the network.
Settled == ~ENABLED System

(******************************* The rules ********************************)

\* Once things settle while online, the Text and theme sheet you tapped is on screen.
SheetShowsOnline == (Settled /\ sheetAsked /\ net = "online") => sheetCode = "loaded"

=============================================================================
