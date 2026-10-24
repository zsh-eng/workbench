----------------------------- MODULE ArcticWeb -----------------------------
(***************************************************************************)
(* What a reader sees in Arctic for the web on a phone (720 px and         *)
(* narrower): the library and its bottom bar, the link bar that saves a    *)
(* link, the reader's Text and theme sheet, and the network.               *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it; paths are relative to apps/arctic/Browser.*)
(* Written by hand on 24 October 2026 and not yet checked by TLC: see      *)
(* FINDINGS.md.                                                            *)
(***************************************************************************)

VARIABLES
  screen,      \* "library" or "reader"
  bar,         \* "closed" or "open": the link bar in the bottom bar
  field,       \* "empty", "link" or "prose": what the link field holds
  clipboard,   \* "idle" or "reading": Paste waits for the clipboard
  ask,         \* "none", "save" or "cancel": the reader's last word in the bar
  saving,      \* a save runs; the bar closed when it began
  saveAsk,     \* the reader's last word in the bar when that save began
  savedBy,     \* "none", "save" or "cancel": saveAsk when a save finished
  justSaved,   \* a save finished, and the reader has done nothing since
  filtered,    \* a search or a topic filters the library
  newMatches,  \* the new link passes that filter
  net,         \* "online" or "offline"
  sheetCode,   \* "absent", "loading", "loaded" or "failed": the sheet's code
  cached,      \* the service worker holds the sheet's code
  sheetAsked   \* Text and theme was tapped, and its sheet was not closed

vars == <<screen, bar, field, clipboard, ask, saving, saveAsk, savedBy,
          justSaved, filtered, newMatches, net, sheetCode, cached, sheetAsked>>

saveVars == <<saving, saveAsk, savedBy>>
sheetVars == <<net, sheetCode, cached, sheetAsked>>

Init ==
  /\ screen = "library"
  /\ bar = "closed"
  /\ field = "empty"
  /\ clipboard = "idle"
  /\ ask = "none"
  /\ saving = FALSE
  /\ saveAsk = "none"
  /\ savedBy = "none"
  /\ justSaved = FALSE
  /\ filtered = FALSE
  /\ newMatches \in BOOLEAN
  /\ net \in {"online", "offline"}
  /\ sheetCode = "absent"
  /\ cached = FALSE
  /\ sheetAsked = FALSE

\* Any step the reader takes ends the moment just after a save.
Moved == justSaved' = FALSE

(***************************** The reader *********************************)

OpenBar ==
  /\ screen = "library"
  /\ bar = "closed"            \* src/AddLink.tsx:367
  /\ bar' = "open"             \* src/AddLink.tsx:258
  /\ field' = "empty"
  /\ ask' = "none"
  /\ Moved
  /\ UNCHANGED <<screen, clipboard, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

Type ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field' \in {"link", "prose"}
  /\ Moved
  /\ UNCHANGED <<screen, bar, clipboard, ask, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

\* Save, or Return on the keyboard. Prose shows "That is not a web address".
PressSave ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field # "empty"           \* src/AddLink.tsx:163
  /\ IF field = "link"         \* src/AddLink.tsx:164
       THEN /\ bar' = "closed" \* src/AddLink.tsx:169-170
            /\ field' = "empty"
            /\ saving' = TRUE  \* src/AddLink.tsx:171
            /\ saveAsk' = "save"
            /\ ask' = "save"
       ELSE UNCHANGED <<bar, field, saving, saveAsk, ask>>
  /\ Moved
  /\ UNCHANGED <<screen, clipboard, savedBy, filtered, newMatches>>
  /\ UNCHANGED sheetVars

PressPaste ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field = "empty"           \* src/AddLink.tsx:328
  /\ clipboard' = "reading"    \* src/AddLink.tsx:344
  /\ ask' = "save"
  /\ Moved
  /\ UNCHANGED <<screen, bar, field, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

\* The x button, a tap on the list, Escape, or an empty field that loses focus. A
\* clipboard read in flight goes on.
Cancel ==
  /\ bar = "open"              \* src/AddLink.tsx:276, 319, 325, 367
  /\ bar' = "closed"           \* src/AddLink.tsx:261-265
  /\ field' = "empty"
  /\ ask' = "cancel"
  /\ Moved
  /\ UNCHANGED <<screen, clipboard, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

\* Type in the search field, clear it, or pick a topic.
Filter ==
  /\ screen = "library"
  /\ bar = "closed"            \* src/AddLink.tsx:276: the scrim covers the page
  /\ filtered' = ~filtered     \* src/Library.tsx:61-62
  /\ Moved
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

OpenArticle ==
  /\ screen = "library"
  /\ bar = "closed"            \* src/AddLink.tsx:276: the scrim covers the list
  /\ screen' = "reader"
  /\ Moved
  /\ UNCHANGED <<bar, field, clipboard, ask, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

Back ==
  /\ screen = "reader"
  /\ screen' = "library"
  /\ sheetAsked' = FALSE       \* src/Reader.tsx:547: the panel's state leaves with the page
  /\ Moved
  /\ UNCHANGED <<bar, field, clipboard, ask, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, sheetCode, cached>>

TapTextAndTheme ==
  /\ screen = "reader"
  /\ ~sheetAsked               \* src/Reader.tsx:553: a second tap changes nothing
  /\ sheetAsked' = TRUE
  /\ sheetCode' = IF sheetCode = "absent" THEN "loading" ELSE sheetCode \* src/surface.tsx:94
  /\ Moved
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, cached>>

CloseSheet ==
  /\ sheetAsked
  /\ sheetCode = "loaded"      \* src/surface.tsx:99: only loaded code draws a sheet
  /\ sheetAsked' = FALSE
  /\ Moved
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, sheetCode, cached>>

(****************************** The world *********************************)

GoOffline ==
  /\ net = "online"
  /\ net' = "offline"
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<sheetCode, cached, sheetAsked>>

GoOnline ==
  /\ net = "offline"
  /\ net' = "online"
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<sheetCode, cached, sheetAsked>>

(******************************* The app **********************************)

\* The clipboard holds a link. The result saves it, open bar or not.
ClipboardGivesLink ==
  /\ clipboard = "reading"
  /\ clipboard' = "idle"
  /\ bar' = "closed"           \* src/AddLink.tsx:346-347, then src/AddLink.tsx:169-170
  /\ field' = "empty"
  /\ saving' = TRUE            \* src/AddLink.tsx:171: no check that the bar is still open
  /\ saveAsk' = ask
  /\ UNCHANGED <<screen, ask, savedBy, justSaved, filtered, newMatches>>
  /\ UNCHANGED sheetVars

\* The browser refuses, or the reader dismisses its Paste button.
ClipboardRefused ==
  /\ clipboard = "reading"
  /\ clipboard' = "idle"       \* src/AddLink.tsx:350
  /\ UNCHANGED <<screen, bar, field, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED sheetVars

\* The records are written, and show() goes to the top of Saved. It drops
\* ?q= and ?topic= from the address, but the library keeps its filter in
\* state and writes it back.
FinishSave ==
  /\ saving
  /\ saving' = FALSE
  /\ savedBy' = saveAsk
  /\ justSaved' = TRUE
  /\ screen' = "library"       \* src/AddLink.tsx:104-106
  /\ UNCHANGED filtered        \* src/Library.tsx:61-62, src/Library.tsx:72-73
  /\ UNCHANGED <<bar, field, clipboard, ask, saveAsk, newMatches>>
  /\ UNCHANGED sheetVars

\* At idle, a phone loads the sheet's code before the first sheet.
PreloadSheet ==
  /\ sheetCode = "absent"      \* src/surface.tsx:81-85
  /\ sheetCode' = "loading"
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, cached, sheetAsked>>

SheetLoads ==
  /\ sheetCode = "loading"
  /\ net = "online" \/ cached  \* public/sw.js:78-81
  /\ sheetCode' = "loaded"
  /\ cached' = TRUE            \* public/sw.js:83-84
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, sheetAsked>>

\* The service worker installs only what index.html names, so the sheet's
\* chunk is cached after its first online load (public/sw.js:11-13).
\* No step leaves "failed": src/surface.tsx:73 keeps the rejected import,
\* and src/surface.tsx:94 asks the same promise again.
SheetFails ==
  /\ sheetCode = "loading"
  /\ net = "offline"           \* public/sw.js:81
  /\ ~cached                   \* public/sw.js:78-80
  /\ sheetCode' = "failed"
  /\ UNCHANGED <<screen, bar, field, clipboard, ask, justSaved, filtered, newMatches>>
  /\ UNCHANGED saveVars
  /\ UNCHANGED <<net, cached, sheetAsked>>

Reader ==
  \/ OpenBar \/ Type \/ PressSave \/ PressPaste \/ Cancel \/ Filter
  \/ OpenArticle \/ Back \/ TapTextAndTheme \/ CloseSheet

World == GoOffline \/ GoOnline

System ==
  \/ ClipboardGivesLink \/ ClipboardRefused \/ FinishSave
  \/ PreloadSheet \/ SheetLoads \/ SheetFails

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader or the network.
Settled == ~ENABLED System

(******************************* The rules ********************************)

\* After you cancel the link bar, nothing you did in it gets saved.
CancelSavesNothing == savedBy # "cancel"

\* When a save from the link bar is done, its card is in view.
SavedLinkInView == justSaved => (~filtered \/ newMatches)

\* Once things settle while online, the Text and theme sheet you tapped is on screen.
SheetShowsOnline == (Settled /\ sheetAsked /\ net = "online") => sheetCode = "loaded"

=============================================================================
