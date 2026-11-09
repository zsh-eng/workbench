----------------------------- MODULE AgentQueue -----------------------------
(***************************************************************************)
(* The messages that the user sends to a Claude Code session that Med     *)
(* runs, and how they reach the agent: one session, two messages, a turn  *)
(* with one round of tools, Esc, Stop, the agent's process ending, and a  *)
(* restart of the host. The process outlives the host in its holder.      *)
(*                                                                         *)
(* The fix model: the queue after bugs 15 and 16 (FINDINGS.md). Paths    *)
(* start at apps/med/src; lines are at 3b3bd77f.                         *)
(*                                                                         *)
(* Three actors:                                                           *)
(* - The agent (Claude Code): it reads a line of its input when it starts *)
(*   a turn, and every line that waits when its tools end. It writes its  *)
(*   events, which Med reads later, in order.                             *)
(* - The host: its view of the agent (status, halt, tools), the watcher   *)
(*   of queued messages (host/queued-messages.ts), and the inbox on disk  *)
(*   (host/agent-inbox.ts).                                               *)
(* - The user: send, Send now, Esc, Stop, and dismiss a cut turn.         *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Msgs, MaxRestarts, MaxCrashes,
  Gaps  \* FALSE leaves out the steps that need the agent to say what it read:
        \* a stop of the host between a write and its record, a Stop or an
        \* end of the process with lines unread, and a write to a holder
        \* that is gone

VARIABLES
  \* The inbox on disk (host/agent-inbox.ts).
  box,        \* each message: "unsent", "pending", "delivered" or "failed"
  after,      \* its afterTurn flag: Queue, not Send now
  \* History, for the rules.
  qturn,      \* the turn that Med showed when the user queued it
  sent,       \* the messages in the order that the user sent them
  reads,      \* how many times the agent read each message
  late,       \* Med wrote a message before an earlier one that waited
              \* for the same step
  early,      \* Med gave a Queue message while it showed the turn that the
              \* message waits for
  \* The agent's process, in its holder (host/held-agent.ts).
  alive,      \* the process runs
  aturn,      \* "none", "think", "tools" or "wrap" (after its tools)
  stdin,      \* the lines that Med wrote and the agent has not read: sets
  stdout,     \* the events that the agent wrote and Med has not read
  \* The host, in memory.
  up,         \* the host runs
  status,     \* its view: "idle", "working" or "exited"
  mturn,      \* how many turns its view has begun
  halt,       \* its view: a cut turn waits for the reader
  tools,      \* its view: the main conversation's tools run
  held,       \* it has the process
  watching,   \* queued-messages.ts: the session has a watcher
  rel,        \* the watcher's release: "none", "idle", "working",
              \* "record", "check" or "finish"
  again,      \* a change came while a release ran
  seen,       \* what the release's last read of the inbox found
  toWatch,    \* messages stored as queued whose send has not called watch
  writer,     \* who holds the inbox's lock after a write: "none",
              \* "release", or the message that a send gives directly
  writing,    \* the messages that it wrote and has not recorded
  \* On disk, beside the inbox.
  turnKept,   \* owned-sessions.ts: record.turn, a turn that ran
  restarts, crashes

vars == <<box, after, qturn, sent, reads, late, early,
          alive, aturn, stdin, stdout,
          up, status, mturn, halt, tools, held, watching, rel, again, seen, toWatch,
          writer, writing, turnKept, restarts, crashes>>
agentVars == <<alive, aturn, stdin, stdout>>
viewVars == <<status, mturn, halt, tools, held>>
watchVars == <<watching, rel, again, seen, toWatch>>
historyVars == <<qturn, sent, reads, late, early>>

Union(s) == UNION {s[i] : i \in 1..Len(s)}
WasSent(m) == \E i \in 1..Len(sent) : sent[i] = m
SentBefore(x, y) == \E i, j \in 1..Len(sent) : i < j /\ sent[i] = x /\ sent[j] = y
Pending == {m \in Msgs : box[m] = "pending"}
View == [status |-> status, halt |-> halt, tools |-> tools, held |-> held]
(* The view's count of turns goes up when its status becomes working.     *)
Begun(next) == IF status # "working" /\ next = "working" THEN mturn + 1 ELSE mturn
SetView(v) ==
  /\ status' = v.status /\ halt' = v.halt /\ tools' = v.tools /\ held' = v.held
  /\ mturn' = Begun(v.status)

(* Med writes a Queue message while it shows the turn that the message    *)
(* waits for.                                                              *)
TooEarly(batch) == \E m \in batch : after[m] /\ status = "working" /\ qturn[m] = mturn

-----------------------------------------------------------------------------
(* The agent's reads. Messages in one line reach it together, and it      *)
(* reads its lines in the order that Med wrote them.                       *)
Read(batch) == reads' = [m \in Msgs |-> reads[m] + (IF m \in batch THEN 1 ELSE 0)]

(* A line overtakes an earlier message that waits for the agent's next    *)
(* step and is not in it. Send now on a later message makes it the        *)
(* earlier one's equal, so this counts only messages that are not Queue.  *)
Overtakes(batch) ==
  \E y \in batch, x \in Pending \ batch : SentBefore(x, y) /\ ~after[x]

(* An event that the agent writes, as Med reads it                         *)
(* (host/owned-sessions.ts).                                               *)
Step(e, v) ==
  CASE e = "busy"  -> [v EXCEPT !.status = "working"]               \* :726
    [] e = "tools" -> [v EXCEPT !.tools = TRUE]                      \* :671
    [] e = "done"  -> [v EXCEPT !.tools = FALSE]                     \* :671
    [] e = "idle"  -> [v EXCEPT !.status = "idle", !.tools = FALSE]  \* :744
    \* The process ended on its own: a turn that ran waits (:828-838).
    [] e = "exit"  -> [v EXCEPT !.status = "idle", !.tools = FALSE,
                                !.held = FALSE,
                                !.halt = v.halt \/ v.status = "working"]

RECURSIVE Replay(_, _)
Replay(s, v) == IF s = <<>> THEN v ELSE Replay(Tail(s), Step(Head(s), v))

-----------------------------------------------------------------------------
(* The watcher (host/queued-messages.ts).                                  *)

(* release() up to its first wait, with the state that it reads (:40-48).  *)
Look(v) ==
  IF v.status = "exited"
  THEN watching' = FALSE /\ rel' = "none" /\ again' = FALSE          \* :45
  ELSE /\ watching' = TRUE
       /\ rel' = IF v.halt THEN "none"                                \* :47
                 ELSE IF v.status = "idle" THEN "idle" ELSE "working"
       /\ again' = FALSE

(* check(), on a change of the runner's state (:97-101).                  *)
Check(v) ==
  IF ~watching THEN UNCHANGED <<watching, rel, again>>
  ELSE IF rel # "none" THEN again' = TRUE /\ UNCHANGED <<watching, rel>>
  ELSE Look(v)

(* watch() (:89-119): a new watcher, or check() on the one there.          *)
Watch(v) == IF ~watching THEN Look(v) ELSE Check(v)

-----------------------------------------------------------------------------
(* What runner.prompt() writes (host/owned-sessions.ts:975-1000). Without *)
(* the process, Med starts it again, and it resumes the session. A line   *)
(* to a holder that is gone is lost without an error                      *)
(* (host/held-agent.ts:183).                                               *)
Write(batch) ==
  IF ~held
  THEN alive' = TRUE /\ aturn' = "none" /\ stdin' = <<batch>> /\ stdout' = <<>>
       /\ held' = TRUE
  ELSE IF alive
  THEN stdin' = Append(stdin, batch) /\ UNCHANGED <<alive, aturn, stdout, held>>
  ELSE UNCHANGED <<alive, aturn, stdin, stdout, held>>

-----------------------------------------------------------------------------
(* The agent.                                                              *)

AgentStart ==
  /\ alive /\ aturn = "none" /\ stdin # <<>>
  /\ Read(Head(stdin))
  /\ stdin' = Tail(stdin)
  /\ aturn' = "think"
  /\ stdout' = Append(stdout, "busy")
  /\ UNCHANGED <<alive, late, early, box, after, qturn, sent>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts, crashes>>

AgentTools ==
  /\ alive /\ aturn = "think"
  /\ aturn' = "tools" /\ stdout' = Append(stdout, "tools")
  /\ UNCHANGED <<alive, stdin, box, after, historyVars>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts, crashes>>

(* When its tools end, Claude Code reads every line that waits, in the     *)
(* same turn (queued-messages.ts:11-14).                                   *)
AgentToolsEnd ==
  /\ alive /\ aturn = "tools"
  /\ LET got == Union(stdin) IN
       /\ IF got = {} THEN UNCHANGED reads ELSE Read(got)
  /\ stdin' = <<>>
  /\ aturn' = "wrap" /\ stdout' = Append(stdout, "done")
  /\ UNCHANGED <<alive, late, early, box, after, qturn, sent>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts, crashes>>

AgentEnd ==
  /\ alive /\ aturn \in {"think", "wrap"}
  /\ aturn' = "none" /\ stdout' = Append(stdout, "idle")
  /\ UNCHANGED <<alive, stdin, box, after, historyVars>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts, crashes>>

(* The process ends on its own, or with its holder, as in a reboot. The   *)
(* lines that it had not read go with it.                                  *)
Crash ==
  /\ alive /\ crashes < MaxCrashes /\ (Gaps \/ stdin = <<>>)
  /\ alive' = FALSE /\ aturn' = "none" /\ stdin' = <<>>
  /\ stdout' = Append(stdout, "exit")
  /\ crashes' = crashes + 1
  /\ UNCHANGED <<box, after, historyVars>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts>>

-----------------------------------------------------------------------------
(* The host.                                                               *)

ReadOut ==
  /\ up /\ stdout # <<>>
  /\ LET e == Head(stdout)
         v == Step(e, View)
     IN /\ SetView(v)
        \* Tools that start or end notify only on a change (:671).
        /\ IF e \in {"tools", "done"} /\ v = View
           THEN UNCHANGED <<watching, rel, again>>
           ELSE Check(v)
  /\ stdout' = Tail(stdout)
  /\ UNCHANGED <<alive, aturn, stdin, box, after, historyVars>>
  /\ UNCHANGED <<up, seen, toWatch, writer, writing, turnKept, restarts, crashes>>

(* deliverPending() under the inbox's lock (agent-inbox.ts:193-232). Both *)
(* paths check the agent's state again there (:206): the idle one         *)
(* (queued-messages.ts:58-61), and the turn's (:76-79).                    *)
Deliver ==
  /\ up /\ rel \in {"idle", "working"} /\ writer = "none"
  /\ Gaps \/ ~held \/ alive
  /\ LET mid == rel = "working"
         ok == IF mid THEN status = "working" /\ ~halt /\ tools      \* :76-79
               ELSE status = "idle" /\ ~halt                         \* :58-61
         due == IF mid THEN {m \in Pending : ~after[m]} ELSE Pending  \* :81
     IN IF ~ok \/ due = {}
        THEN /\ rel' = "check"
             /\ UNCHANGED <<agentVars, viewVars, box, late, early, again, writer, writing>>
        ELSE IF status = "exited"
        \* prompt() throws: the messages fail (agent-inbox.ts:212-224).
        THEN /\ box' = [m \in Msgs |-> IF m \in due THEN "failed" ELSE box[m]]
             /\ rel' = "check"
             /\ UNCHANGED <<agentVars, viewVars, late, early, again, writer, writing>>
        ELSE /\ Write(due)
             /\ late' = (late \/ Overtakes(due))
             /\ early' = (early \/ TooEarly(due))
             /\ status' = "working" /\ halt' = FALSE /\ UNCHANGED tools
             /\ mturn' = Begun("working")
             \* The prompt's change runs check(), which finds this release.
             /\ again' = TRUE
             /\ writer' = "release" /\ writing' = due
             /\ rel' = "record"
             /\ UNCHANGED box
  /\ UNCHANGED <<after, qturn, sent, reads, up, watching, seen, toWatch, turnKept, restarts, crashes>>

(* The inbox's file is written after the agent has the line              *)
(* (agent-inbox.ts:62-69, :225-228, :317-321).                             *)
Record ==
  /\ up /\ writer # "none"
  /\ box' = [m \in Msgs |-> IF m \in writing THEN "delivered" ELSE box[m]]
  /\ writer' = "none" /\ writing' = {}
  /\ rel' = IF writer = "release" THEN "check" ELSE rel
  /\ UNCHANGED <<after, historyVars, agentVars, up, viewVars>>
  /\ UNCHANGED <<watching, again, seen, toWatch, turnKept, restarts, crashes>>

(* inbox.pending() (queued-messages.ts:85) waits for the inbox's writes   *)
(* (agent-inbox.ts:100), then reads the file.                              *)
CheckRead ==
  /\ up /\ rel = "check" /\ writer = "none"
  /\ seen' = (Pending # {})
  /\ rel' = "finish"
  /\ UNCHANGED <<box, after, historyVars, agentVars, up, viewVars>>
  /\ UNCHANGED <<watching, again, toWatch, writer, writing, turnKept, restarts, crashes>>

(* The release's end: a change that came while it ran asks again, even   *)
(* when it read nothing left; else nothing left stops the watcher         *)
(* (:104-113).                                                             *)
Finish ==
  /\ up /\ rel = "finish"
  /\ IF again THEN Look(View)
     ELSE IF ~seen
     THEN watching' = FALSE /\ rel' = "none" /\ again' = FALSE
     ELSE rel' = "none" /\ UNCHANGED <<watching, again>>
  /\ seen' = FALSE
  /\ UNCHANGED <<box, after, historyVars, agentVars, up, viewVars>>
  /\ UNCHANGED <<toWatch, writer, writing, turnKept, restarts, crashes>>

(* After a restart, the host attaches to the holder, and its log brings   *)
(* the view up to date; the holder's first entry clears a halt            *)
(* (owned-sessions.ts:802). Without a holder, a turn that was recorded    *)
(* waits (:2453-2457). Then each session with queued messages is watched  *)
(* (server.ts:521-522).                                                    *)
HostUp ==
  /\ ~up
  /\ up' = TRUE
  /\ LET v == IF status = "exited" THEN View
              ELSE IF alive
              THEN [Replay(stdout, View) EXCEPT !.halt = FALSE, !.held = TRUE]
              ELSE [status |-> "idle", halt |-> turnKept, tools |-> FALSE, held |-> FALSE]
     IN /\ SetView(v)
        /\ IF Pending # {} THEN Look(v) ELSE UNCHANGED <<watching, rel, again>>
  /\ stdout' = <<>>
  /\ UNCHANGED <<alive, aturn, stdin, box, after, historyVars>>
  /\ UNCHANGED <<seen, toWatch, writer, writing, turnKept, restarts, crashes>>

(* The host stops at any step. What it held in memory goes: the watcher, *)
(* and a write whose file it had not written yet.                          *)
HostDown ==
  /\ up /\ restarts < MaxRestarts /\ (Gaps \/ writer = "none")
  /\ up' = FALSE
  /\ watching' = FALSE /\ rel' = "none" /\ again' = FALSE /\ seen' = FALSE
  /\ toWatch' = {} /\ writer' = "none" /\ writing' = {}
  /\ turnKept' = (status = "working" \/ halt)
  /\ restarts' = restarts + 1
  /\ UNCHANGED <<box, after, historyVars, agentVars, viewVars, crashes>>

-----------------------------------------------------------------------------
(* The user.                                                               *)

Noted(m) == IF WasSent(m) THEN sent ELSE Append(sent, m)

(* An idle session takes the message as its next prompt, with the ones   *)
(* that waited before it, in one change (server.ts:1873, :1904-1907;      *)
(* agent-inbox.ts:310-329). A message whose answer the host never gave,   *)
(* as when it stopped, the page sends again with its ID.                  *)
SendDirect(m) ==
  /\ up /\ box[m] = "unsent" /\ status = "idle" /\ writer = "none"
  /\ Gaps \/ ~held \/ alive
  /\ LET due == Pending \cup {m} IN
       /\ Write(due)
       /\ late' = (late \/ Overtakes(due))
       /\ writer' = m /\ writing' = due
  /\ status' = "working" /\ halt' = FALSE /\ UNCHANGED tools
  /\ mturn' = Begun("working")
  /\ Check([View EXCEPT !.status = "working", !.halt = FALSE])
  /\ sent' = Noted(m)
  /\ UNCHANGED <<box, after, qturn, reads, early>>
  /\ UNCHANGED <<up, seen, toWatch, turnKept, restarts, crashes>>

(* A working session: the message waits in the inbox (server.ts:1904-1905).*)
SendQueued(m, a) ==
  /\ up /\ box[m] = "unsent" /\ status = "working" /\ writer = "none"
  /\ box' = [box EXCEPT ![m] = "pending"]
  /\ after' = [after EXCEPT ![m] = a]
  /\ qturn' = [qturn EXCEPT ![m] = mturn]
  /\ toWatch' = toWatch \cup {m}
  /\ sent' = Noted(m)
  /\ UNCHANGED <<reads, late, early, agentVars, up, viewVars>>
  /\ UNCHANGED <<watching, rel, again, seen, writer, writing, turnKept, restarts, crashes>>

(* Then the send calls watch() (server.ts:1910-1911).                     *)
SendWatch(m) ==
  /\ up /\ m \in toWatch
  /\ toWatch' = toWatch \ {m}
  /\ Watch(View)
  /\ UNCHANGED <<box, after, historyVars, agentVars, up, viewVars>>
  /\ UNCHANGED <<seen, writer, writing, turnKept, restarts, crashes>>

(* Send now on a queued message (queued-messages.ts:108-115).             *)
SendNow(m) ==
  /\ up /\ box[m] = "pending" /\ after[m] /\ status # "exited" /\ writer = "none"
  /\ after' = [after EXCEPT ![m] = FALSE]
  /\ Watch(View)
  /\ UNCHANGED <<box, historyVars, agentVars, up, viewVars>>
  /\ UNCHANGED <<seen, toWatch, writer, writing, turnKept, restarts, crashes>>

(* Esc stops the turn (owned-sessions.ts:1051-1053).                       *)
Esc ==
  /\ up /\ status = "working" /\ held /\ alive /\ aturn # "none"
  /\ aturn' = "none" /\ stdout' = Append(stdout, "idle")
  /\ UNCHANGED <<alive, stdin, box, after, historyVars>>
  /\ UNCHANGED <<up, viewVars, watchVars, writer, writing, turnKept, restarts, crashes>>

(* Stop ends the process; the session stays stopped (:1103-1107).         *)
Stop ==
  /\ up /\ status # "exited" /\ (Gaps \/ stdin = <<>>)
  /\ status' = "exited" /\ halt' = FALSE /\ tools' = FALSE /\ held' = FALSE
  /\ UNCHANGED mturn
  /\ alive' = FALSE /\ aturn' = "none" /\ stdin' = <<>> /\ stdout' = <<>>
  /\ Check([status |-> "exited", halt |-> FALSE, tools |-> FALSE, held |-> FALSE])
  /\ UNCHANGED <<box, after, historyVars>>
  /\ UNCHANGED <<up, seen, toWatch, writer, writing, turnKept, restarts, crashes>>

(* The reader acts on a cut turn (:1100-1102).                            *)
Dismiss ==
  /\ up /\ halt /\ status # "exited"
  /\ halt' = FALSE
  /\ Check([View EXCEPT !.halt = FALSE])
  /\ UNCHANGED <<status, mturn, tools, held>>
  /\ UNCHANGED <<box, after, historyVars, agentVars, up>>
  /\ UNCHANGED <<seen, toWatch, writer, writing, turnKept, restarts, crashes>>

-----------------------------------------------------------------------------

(* The session works on a turn that an earlier prompt began.              *)
Init ==
  /\ box = [m \in Msgs |-> "unsent"]
  /\ after = [m \in Msgs |-> FALSE]
  /\ qturn = [m \in Msgs |-> 0]
  /\ sent = <<>>
  /\ reads = [m \in Msgs |-> 0]
  /\ late = FALSE
  /\ early = FALSE
  /\ alive = TRUE /\ aturn = "think"
  /\ stdin = <<>> /\ stdout = <<>>
  /\ up = TRUE /\ status = "working" /\ mturn = 1 /\ halt = FALSE /\ tools = FALSE /\ held = TRUE
  /\ watching = FALSE /\ rel = "none" /\ again = FALSE /\ seen = FALSE /\ toWatch = {}
  /\ writer = "none" /\ writing = {}
  /\ turnKept = FALSE /\ restarts = 0 /\ crashes = 0

Next ==
  \/ AgentStart \/ AgentTools \/ AgentToolsEnd \/ AgentEnd \/ Crash
  \/ ReadOut \/ Deliver \/ Record \/ CheckRead \/ Finish \/ HostUp \/ HostDown
  \/ \E m \in Msgs : SendDirect(m) \/ SendWatch(m) \/ SendNow(m)
  \/ \E m \in Msgs, a \in BOOLEAN : SendQueued(m, a)
  \/ Esc \/ Stop \/ Dismiss

Fairness ==
  /\ WF_vars(AgentStart) /\ WF_vars(AgentToolsEnd) /\ WF_vars(AgentEnd)
  /\ WF_vars(ReadOut) /\ WF_vars(Deliver) /\ WF_vars(Record)
  /\ WF_vars(CheckRead) /\ WF_vars(Finish) /\ WF_vars(HostUp)
  /\ \A m \in Msgs : WF_vars(SendWatch(m))

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
(* The rules.                                                              *)

(* 1. The agent reads each message at most once.                          *)
Once == \A m \in Msgs : reads[m] <= 1

(* 2. A message that Med shows as delivered reached the agent, or waits   *)
(*    in its input.                                                        *)
Reaches == \A m \in Msgs : box[m] = "delivered" => (reads[m] > 0 \/ m \in Union(stdin))

(* 3. Med never gives the agent a message before an earlier one that      *)
(*    waits for the same step: only Send now goes before a Queue message. *)
InOrder == ~late

(* 4. Med does not give a queued message while it shows the turn that ran *)
(*    when the user queued it. Med's view comes after the agent's: a turn *)
(*    that the agent began from a line that it kept can still get it.     *)
QueueWaits == ~early

(* 5. A message that waits reaches the agent, unless the session stopped, *)
(*    or a cut turn waits for the reader.                                  *)
Taken ==
  \A m \in Msgs : (box[m] = "pending") ~> (box[m] # "pending" \/ status = "exited" \/ halt)

TypeOK ==
  /\ box \in [Msgs -> {"unsent", "pending", "delivered", "failed"}]
  /\ aturn \in {"none", "think", "tools", "wrap"}
  /\ status \in {"idle", "working", "exited"}
  /\ rel \in {"none", "idle", "working", "record", "check", "finish"}
=============================================================================
