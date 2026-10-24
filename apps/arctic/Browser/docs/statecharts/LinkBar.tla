------------------------------ MODULE LinkBar ------------------------------
(***************************************************************************)
(* The link bar in the bottom bar of Arctic for the web on a phone (720 px *)
(* and narrower): + opens a link field, Save or Paste saves a link, and    *)
(* the x button, a tap on the list, Escape or an empty field that loses    *)
(* focus cancels. Saved is the library's first folder, and a search or a   *)
(* topic can filter it.                                                    *)
(*                                                                         *)
(* The code of commit 9bb68715, before the fixes.                         *)
(*                                                                         *)
(* Each action is one step of the code. A save writes its records and      *)
(* shows Saved in one step: it ends before the reader can tap again. The   *)
(* clipboard can wait, for example while the browser asks for permission.  *)
(* Each guard cites the line that checks it; paths are relative to         *)
(* apps/arctic/Browser.                                                    *)
(***************************************************************************)

VARIABLES
  bar,          \* "closed" or "open"
  field,        \* "empty", "link" or "prose": what the link field holds
  clipboard,    \* "idle" or "reading": Paste waits for the clipboard
  filtered,     \* a search or a topic filters the library
  newMatches,   \* the new link passes that filter
  \* History, for the rules: the code does not keep these.
  pasteCancelled,   \* the reader cancelled the bar after the Paste that waits
  savedAfterCancel, \* the last step saved a link from a cancelled bar
  justSaved         \* the last step saved a link

vars == <<bar, field, clipboard, filtered, newMatches, pasteCancelled,
          savedAfterCancel, justSaved>>

Init ==
  /\ bar = "closed"
  /\ field = "empty"
  /\ clipboard = "idle"
  /\ filtered = FALSE
  /\ newMatches \in BOOLEAN
  /\ pasteCancelled = FALSE
  /\ savedAfterCancel = FALSE
  /\ justSaved = FALSE

\* A step that saves nothing ends the moment after a save.
NoSave == savedAfterCancel' = FALSE /\ justSaved' = FALSE

\* The records are written, and show() goes to the top of Saved. It drops
\* ?q= and ?topic= from the address, but the library keeps its filter in
\* state and writes it back.
Saved(fromCancelled) ==
  /\ justSaved' = TRUE                \* src/AddLink.tsx:48-50
  /\ savedAfterCancel' = fromCancelled
  /\ UNCHANGED filtered               \* src/AddLink.tsx:104-106, src/Library.tsx:61-62, 72-73

(***************************** The reader *********************************)

OpenBar ==
  /\ bar = "closed"            \* src/AddLink.tsx:367
  /\ bar' = "open"             \* src/AddLink.tsx:258
  /\ field' = "empty"
  /\ NoSave
  /\ UNCHANGED <<clipboard, filtered, newMatches, pasteCancelled>>

Type ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field' \in {"link", "prose"}
  /\ NoSave
  /\ UNCHANGED <<bar, clipboard, filtered, newMatches, pasteCancelled>>

\* Save, or Return on the keyboard. Prose shows "That is not a web address".
PressSave ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field # "empty"           \* src/AddLink.tsx:163
  /\ IF field = "link"         \* src/AddLink.tsx:164
       THEN /\ bar' = "closed" \* src/AddLink.tsx:169-170
            /\ field' = "empty"
            /\ Saved(FALSE)    \* src/AddLink.tsx:171
       ELSE /\ UNCHANGED <<bar, field, filtered>>
            /\ NoSave
  /\ UNCHANGED <<clipboard, newMatches, pasteCancelled>>

\* The model has one clipboard read at a time, and leaves out a second tap.
PressPaste ==
  /\ bar = "open"              \* src/AddLink.tsx:302
  /\ field = "empty"           \* src/AddLink.tsx:328
  /\ clipboard = "idle"
  /\ clipboard' = "reading"    \* src/AddLink.tsx:344
  /\ pasteCancelled' = FALSE
  /\ NoSave
  /\ UNCHANGED <<bar, field, filtered, newMatches>>

\* The x button, a tap on the list, Escape, or an empty field that loses
\* focus. A clipboard read that waits goes on.
Cancel ==
  /\ bar = "open"              \* src/AddLink.tsx:276, 319, 325, 367
  /\ bar' = "closed"           \* src/AddLink.tsx:261-265
  /\ field' = "empty"
  /\ pasteCancelled' = (clipboard = "reading")
  /\ NoSave
  /\ UNCHANGED <<clipboard, filtered, newMatches>>

\* Type in the search field, clear it, or pick a topic.
Filter ==
  /\ bar = "closed"            \* src/AddLink.tsx:276: the scrim covers the page
  /\ filtered' = ~filtered     \* src/Library.tsx:61-62
  /\ NoSave
  /\ UNCHANGED <<bar, field, clipboard, newMatches, pasteCancelled>>

(******************************* The app **********************************)

\* The clipboard holds a link. The result saves it, open bar or not.
ClipboardGivesLink ==
  /\ clipboard = "reading"
  /\ clipboard' = "idle"
  /\ bar' = "closed"           \* src/AddLink.tsx:346-347, then src/AddLink.tsx:169-170
  /\ field' = "empty"
  /\ Saved(pasteCancelled)     \* src/AddLink.tsx:171: no check that the bar is still open
  /\ pasteCancelled' = FALSE
  /\ UNCHANGED newMatches

\* The browser refuses, or the reader dismisses its Paste button.
ClipboardRefused ==
  /\ clipboard = "reading"
  /\ clipboard' = "idle"       \* src/AddLink.tsx:350
  /\ pasteCancelled' = FALSE
  /\ NoSave
  /\ UNCHANGED <<bar, field, filtered, newMatches>>

Reader == OpenBar \/ Type \/ PressSave \/ PressPaste \/ Cancel \/ Filter

System == ClipboardGivesLink \/ ClipboardRefused

Next == Reader \/ System

Spec == Init /\ [][Next]_vars

(******************************* The rules ********************************)

\* After you cancel the link bar, nothing you did in it gets saved.
CancelSavesNothing == ~savedAfterCancel

\* When a save from the link bar is done, its card is in view.
SavedLinkInView == justSaved => (~filtered \/ newMatches)

=============================================================================
