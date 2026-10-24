---------------------------- MODULE SentComments ----------------------------
(***************************************************************************)
(* One comment on a saved review, and Send to Claude: the host reads the  *)
(* comment, sends it to the agent, and marks it sent. The comment leaves  *)
(* your drafts once it is sent, until you edit it or reply to it.         *)
(*                                                                         *)
(* The fix: the host reads each comment once, for the agent and for the   *)
(* thread, and keeps the version that it read. A comment is a draft again *)
(* when its version is not the one sent.                                   *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, on   *)
(* the branch agent/med-statecharts, after the fix.                        *)
(***************************************************************************)
EXTENDS Naturals

\* The host's clock, in milliseconds. 3 is enough for every path here.
CONSTANT MaxTime

\* 1 and 2 are the comment's text before and after your edit.
NoMessage == [sent |-> FALSE, at |-> 0, body |-> 0, shown |-> 0, version |-> 0]

VARIABLES
  now,        \* the host's clock
  text,       \* the comment's text on the host
  updatedAt,  \* the comment's updatedAt (host/saved-reviews.ts:1108-1109)
  send,       \* the send on its way: at, and what it read for the thread and the body
  message,    \* the stored message (host/agent-inbox.ts:288-300)
  agentGot    \* the text that the agent got, or 0

vars == <<now, text, updatedAt, send, message, agentGot>>

\* A comment is a draft until a message holds its version
\* (host/server.ts:1497-1515). The version is the thread's newest updatedAt
\* (host/saved-reviews.ts:1557-1562); each edit makes a new one, so the
\* text stands for it here.
IsDraft == ~message.sent \/ message.version # text

Init ==
  /\ now = 1
  /\ text = 1
  /\ updatedAt = 0
  /\ send = [at |-> "none", shown |-> 0, body |-> 0, version |-> 0]
  /\ message = NoMessage
  /\ agentGot = 0

(***************************** The reader *********************************)

\* Send to Claude with the comment chosen.
PressSend ==
  /\ send.at = "none"
  /\ IsDraft                                \* web/components/session/SessionComposer.tsx:213, 281: you choose from the drafts
  /\ send' = [send EXCEPT !.at = "posted"]
  /\ UNCHANGED <<now, text, updatedAt, message, agentGot>>

\* Edit the comment, in this window or another.
Edit ==
  /\ text = 1                               \* model bound: one edit
  /\ text' = 2
  /\ updatedAt' = now                       \* host/saved-reviews.ts:1109
  /\ UNCHANGED <<now, send, message, agentGot>>

(****************************** The world *********************************)

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<text, updatedAt, send, message, agentGot>>

(******************************* The host *********************************)

\* One read gives the agent's text, the thread's copy, and each comment's
\* version (host/server.ts:1595-1609, host/saved-reviews.ts:1394-1409, 1508-1527).
Read ==
  /\ send.at = "posted"
  /\ send' = [at |-> "read", shown |-> text, body |-> text, version |-> text]
  /\ UNCHANGED <<now, text, updatedAt, message, agentGot>>

\* After the waits for the agent's process (host/server.ts:1618-1645) and
\* the inbox (host/agent-inbox.ts:285-288), the message takes its time.
Stamp ==
  /\ send.at = "read"
  /\ message' = [sent |-> TRUE, at |-> now, body |-> send.body,
                 shown |-> send.shown, version |-> send.version]   \* host/agent-inbox.ts:300, host/server.ts:1654
  /\ send' = [send EXCEPT !.at = "stamped"]
  /\ UNCHANGED <<now, text, updatedAt, agentGot>>

\* The session takes the message (host/agent-inbox.ts:303-318).
Deliver ==
  /\ send.at = "stamped"
  /\ agentGot' = message.body
  /\ send' = [at |-> "none", shown |-> 0, body |-> 0, version |-> 0]
  /\ UNCHANGED <<now, text, updatedAt, message>>

Reader == PressSend \/ Edit

World == Tick

System == Read \/ Stamp \/ Deliver

Next == Reader \/ World \/ System

Spec == Init /\ [][Next]_vars

(******************************* The rules ********************************)

\* A comment leaves your drafts only when the agent's message has its newest
\* text.
SentIsNewest == ~IsDraft => message.body = text

\* Once the agent's message has a comment's newest text, the comment is not
\* in your drafts.
NewestLeavesDrafts == (message.sent /\ message.body = text) => ~IsDraft

\* The thread shows each sent comment as the agent's message has it.
ThreadShowsSent == message.sent => message.shown = message.body

=============================================================================
