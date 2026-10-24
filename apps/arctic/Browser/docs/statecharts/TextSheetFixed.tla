----------------------------- MODULE TextSheetFixed -----------------------------
(***************************************************************************)
(* The reader's Text and theme sheet in Arctic for the web on a phone, and *)
(* the network. The sheet's code is a separate chunk that loads on the     *)
(* first sheet, or at idle before it. The Notes and More sheets share it.  *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it; paths are relative to apps/arctic/Browser.*)
(* This copy models the code after agent/arctic-sheets-toast: the service  *)
(* worker installs the sheet's code, and a failed load closes the sheet,   *)
(* says so, and is forgotten, so the next tap tries again.                 *)
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
  /\ sheetAsked' = FALSE       \* src/Reader.tsx:549: the panel's state leaves with the page
  /\ UNCHANGED <<net, sheetCode, cached>>

TapTextAndTheme ==
  /\ screen = "reader"         \* src/Reader.tsx:554-555: the reader's toolbar has the button
  /\ ~sheetAsked               \* src/Reader.tsx:555: a second tap changes nothing
  /\ sheetAsked' = TRUE
  /\ sheetCode' = IF sheetCode = "absent" THEN "loading" ELSE sheetCode \* src/surface.tsx:88, 122-124
  /\ UNCHANGED <<screen, net, cached>>

CloseSheet ==
  /\ sheetAsked
  /\ sheetCode = "loaded"      \* src/surface.tsx:142: only loaded code draws a sheet
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

\* The service worker installs while online and keeps the sheet's code.
ShellInstalls ==
  /\ net = "online"            \* public/sw.js:9: the install fetches the page
  /\ ~cached
  /\ cached' = TRUE            \* public/sw.js:19-30
  /\ UNCHANGED <<screen, net, sheetCode, sheetAsked>>

\* At idle, a phone loads the sheet's code before the first sheet.
PreloadSheet ==
  /\ sheetCode = "absent"      \* src/surface.tsx:107-112
  /\ sheetCode' = "loading"
  /\ UNCHANGED <<screen, net, cached, sheetAsked>>

SheetLoads ==
  /\ sheetCode = "loading"
  /\ net = "online" \/ cached  \* public/sw.js:92-96
  /\ sheetCode' = "loaded"
  /\ cached' = TRUE            \* public/sw.js:97-101
  /\ UNCHANGED <<screen, net, sheetAsked>>

\* A failed load is forgotten (src/surface.tsx:93), and the sheet closes
\* with a toast that says so (src/surface.tsx:126-133), so the next tap
\* tries again, at a new address (src/surface.tsx:94-95).
SheetFails ==
  /\ sheetCode = "loading"
  /\ net = "offline"           \* public/sw.js:96
  /\ ~cached                   \* public/sw.js:93-95
  /\ sheetCode' = "absent"
  /\ sheetAsked' = FALSE
  /\ UNCHANGED <<screen, net, cached>>

Reader == OpenArticle \/ Back \/ TapTextAndTheme \/ CloseSheet

World == GoOffline \/ GoOnline

System == ShellInstalls \/ PreloadSheet \/ SheetLoads \/ SheetFails

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader or the network.
Settled == ~ENABLED System

(******************************* The rules ********************************)

\* Once things settle while online, the Text and theme sheet you tapped is on screen.
SheetShowsOnline == (Settled /\ sheetAsked /\ net = "online") => sheetCode = "loaded"

=============================================================================
