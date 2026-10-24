-------------------------- MODULE ArticleTextFixed --------------------------
(***************************************************************************)
(* The text of one article that was saved on the web. Arctic for the web   *)
(* shows text that the account has: a copy kept on the web, or one that  *)
(* the phone sent. The phone's code is that of commit 4ca672ee: a sync    *)
(* sends a Reader copy whose text the account lacks.                      *)
(*                                                                         *)
(* A device that is offline is one whose sync steps wait. TLC tries every  *)
(* order of steps, so the model needs no network.                         *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each guard *)
(* cites the line that checks it. Paths start at the repository root.      *)
(***************************************************************************)

VARIABLES
  phoneHasLink, \* the phone's library has the link
  phoneText,    \* "none", "teaser" or "article": the Reader copy on the phone
  accountText   \* "none", "web" or "phone": whose text the account has

vars == <<phoneHasLink, phoneText, accountText>>

Init ==
  /\ phoneHasLink = FALSE
  /\ phoneText = "none"
  /\ accountText = "none"

(***************************** The reader *********************************)

\* Keep a copy on the web, with the bookmarklet or a file.
WebKeepsCopy ==
  /\ accountText = "none"      \* apps/arctic/Browser/src/copy.ts:15-43
  /\ accountText' = "web"
  /\ UNCHANGED <<phoneHasLink, phoneText>>

(****************************** The phone *********************************)

\* The library syncs, and the link arrives.
PhoneGetsLink ==
  /\ ~phoneHasLink
  /\ phoneHasLink' = TRUE      \* apps/arctic/Sources/LibrarySync.swift:266
  /\ UNCHANGED <<phoneText, accountText>>

\* The reader opens the article, or the phone prepares a visible row. The
\* page gives the article, or a teaser such as a paywall's. The copy stays
\* on the phone.
PhoneKeepsText ==
  /\ phoneHasLink              \* apps/arctic/Sources/ArticleBrowser.swift:994, 1072
  /\ phoneText = "none"
  /\ phoneText' \in {"teaser", "article"} \* apps/arctic/Sources/ArticleBrowser.swift:1240-1246
  /\ UNCHANGED <<phoneHasLink, accountText>>

\* A sync sends the copy when the account has no text: a few each sync,
\* newest first. A teaser is under 120 words, and it stays on the phone.
PhoneSendsText ==
  /\ phoneText = "article"     \* apps/arctic/Sources/LibrarySync.swift:427
  /\ accountText = "none"      \* apps/arctic/Sources/LibrarySync.swift:635
  /\ accountText' = "phone"    \* apps/arctic/Sources/LibrarySync.swift:644-656
  /\ UNCHANGED <<phoneHasLink, phoneText>>

Reader == WebKeepsCopy

System == PhoneGetsLink \/ PhoneKeepsText \/ PhoneSendsText

Next == Reader \/ System

Spec == Init /\ [][Next]_vars

\* Nothing more happens without the reader.
Settled == ~ENABLED System

(******************************* The rules ********************************)

\* Once the phone has an article's text and is done syncing, the web can show it too.
TextReachesWeb == (Settled /\ phoneText = "article") => accountText # "none"

=============================================================================
