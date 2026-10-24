---------------------------- MODULE SentComments ----------------------------
(***************************************************************************)
(* One comment on a saved review, and Send to Claude: the host reads the  *)
(* comment, sends it to the agent, and marks it sent. The comment leaves  *)
(* your drafts once it is sent, until you edit it or reply to it.         *)
(*                                                                         *)
(* Each action is one step that the code takes without waiting. Each      *)
(* guard cites the line that checks it. Paths start at apps/med/src, at   *)
(* main d53abaa8, before the fix.                                          *)
(***************************************************************************)
EXTENDS Naturals

\* The host's clock, in milliseconds. 3 is enough for every path here.
CONSTANT MaxTime

\* 1 and 2 are the comment's text before and after your edit.
NoMessage == [sent |-> FALSE, at |-> 0, body |-> 0, shown |-> 0]

VARIABLES
  now,        \* the host's clock
  text,       \* the comment's text on the host
  updatedAt,  \* the comment's updatedAt (host/saved-reviews.ts:1107-1108)
  send,       \* the send on its way: at, and what it read for the thread and the body
  message,    \* the stored message (host/agent-inbox.ts:288-300)
  agentGot    \* the text that the agent got, or 0

vars == <<now, text, updatedAt, send, message, agentGot>>

\* A comment is a draft until a message that was made after its last change
\* holds it (host/server.ts:1497-1506).
IsDraft == ~message.sent \/ message.at < updatedAt

Init ==
  /\ now = 1
  /\ text = 1
  /\ updatedAt = 0
  /\ send = [at |-> "none", shown |-> 0, body |-> 0]
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
  /\ updatedAt' = now                       \* host/saved-reviews.ts:1108
  /\ UNCHANGED <<now, send, message, agentGot>>

(****************************** The world *********************************)

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<text, updatedAt, send, message, agentGot>>

(******************************* The host *********************************)

\* The thread's copy of the comments: the drafts, read first
\* (host/server.ts:1585-1589).
ReadDrafts ==
  /\ send.at = "posted"
  /\ send' = [send EXCEPT !.at = "drafts", !.shown = text]
  /\ UNCHANGED <<now, text, updatedAt, message, agentGot>>

\* The agent's copy: the comments as text, read again
\* (host/server.ts:1590-1593, host/saved-reviews.ts:1397).
ReadBody ==
  /\ send.at = "drafts"
  /\ send' = [send EXCEPT !.at = "read", !.body = text]
  /\ UNCHANGED <<now, text, updatedAt, message, agentGot>>

\* After the waits for the agent's process (host/server.ts:1604-1631) and
\* the inbox (host/agent-inbox.ts:284-287), the message takes its time.
Stamp ==
  /\ send.at = "read"
  /\ message' = [sent |-> TRUE, at |-> now,
                 body |-> send.body, shown |-> send.shown]   \* host/agent-inbox.ts:296
  /\ send' = [send EXCEPT !.at = "stamped"]
  /\ UNCHANGED <<now, text, updatedAt, agentGot>>

\* The session takes the message (host/agent-inbox.ts:302-313).
Deliver ==
  /\ send.at = "stamped"
  /\ agentGot' = message.body
  /\ send' = [at |-> "none", shown |-> 0, body |-> 0]
  /\ UNCHANGED <<now, text, updatedAt, message>>

Reader == PressSend \/ Edit

World == Tick

System == ReadDrafts \/ ReadBody \/ Stamp \/ Deliver

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
