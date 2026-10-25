------------------------------ MODULE Activity ------------------------------
(***************************************************************************)
(* The background activity manager's queue: two downloads in one lane, the *)
(* network and its events, cancel and retry, the retry timer, and reloads. *)
(* The model follows createActivityManager in ../../src/manager.ts. Each   *)
(* action is one synchronous step of that code: a call you make, a timer,  *)
(* a browser event, or an attempt's promise settling. See ../STATES.md for *)
(* the chart and what the model leaves out.                                *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS N, Limit, MaxAttempts

J == 1..N

States == {"none", "queued", "waiting", "running", "retrying", "failed",
           "done", "cancelled"}
\* manager.ts:43-48 ACTIVE: the job still has work to do.
Active == {"queued", "waiting", "running", "retrying"}

VARIABLES
  \* The world.
  net,       \* navigator.onLine, as network.isOnline() reads it: "online" | "offline"
  events,    \* online and offline events that the browser has not delivered yet
  \* The manager (manager.ts).
  seen,      \* `online` (manager.ts:168): what the manager last learned
  st,        \* each job's state; "none" when it is not in the list
  runs,      \* attempts whose promise has not settled: "current" has the
             \* entry's epoch (manager.ts:268), "stale" any older one
  retryDue,  \* entry.timer holds a retry (manager.ts:345-348)
  attempts,  \* job.attempts
  \* Storage (persistNow, manager.ts:497-534).
  saved,     \* "none" | "queued" | "failed"
  savedAttempts,
  \* What the rules read.
  cancelled, \* you cancelled the job and have not started it again
  wanted,    \* you started the job; it has not finished, and you did not
             \* cancel or dismiss it
  real,      \* failures counted while the device said it was online
  told       \* the device is offline, and the app has learned of it: from
             \* the offline event, a request that failed, or a reload

vars == <<net, events, seen, st, runs, retryDue, attempts, saved,
          savedAttempts, cancelled, wanted, real, told>>

Running(s) == Cardinality({j \in J : s[j] = "running"})

\* manager.ts:505-522: what storage holds for each job.
Persisted(s) ==
  [j \in J |-> IF s[j] \in Active THEN "queued"
               ELSE IF s[j] = "failed" THEN "failed"
               ELSE "none"]

\* pumpOnce(): queued jobs in order. Offline, a job that needs the network
\* waits; otherwise it starts while the lane has room, and begin() makes it
\* running with a new attempt.
StartOne(s, r, j) ==
  IF s[j] = "queued" /\ net = "offline" \* manager.ts:243, 248
  THEN <<[s EXCEPT ![j] = "waiting"], r>> \* manager.ts:249-254
  ELSE IF s[j] = "queued" /\ Running(s) < Limit \* manager.ts:236, 245, 259
  THEN <<[s EXCEPT ![j] = "running"], [r EXCEPT ![j] = @ \cup {"current"}]>>
  ELSE <<s, r>>

RECURSIVE PumpFrom(_, _, _)
PumpFrom(s, r, k) ==
  IF k > N THEN <<s, r>>
  ELSE LET a == StartOne(s, r, k) IN PumpFrom(a[1], a[2], k + 1)

\* manager.ts:211-227 pump(), after a step has set `s` and `r`.
Pump(s, r) ==
  LET a == PumpFrom(s, r, 1)
  IN /\ st' = a[1]
     /\ runs' = a[2]

\* manager.ts:375-384 requeue(): queued, or waiting while offline.
Requeued == IF net = "online" THEN "queued" ELSE "waiting" \* manager.ts:377

\* manager.ts:387-393 interrupt(): the current attempt becomes stale.
Interrupted(r, j) ==
  IF "current" \in r[j] THEN (r[j] \ {"current"}) \cup {"stale"} ELSE r[j]

TypeOK ==
  /\ net \in {"online", "offline"}
  /\ events \in Seq({"online", "offline"}) /\ Len(events) <= 2
  /\ seen \in {"online", "offline"}
  /\ st \in [J -> States]
  /\ runs \in [J -> SUBSET {"current", "stale"}]
  /\ retryDue \in [J -> BOOLEAN]
  /\ attempts \in [J -> 0..MaxAttempts]
  /\ saved \in [J -> {"none", "queued", "failed"}]
  /\ savedAttempts \in [J -> 0..MaxAttempts]
  /\ cancelled \in [J -> BOOLEAN]
  /\ wanted \in [J -> BOOLEAN]
  /\ real \in [J -> 0..MaxAttempts]
  /\ told \in BOOLEAN

Init ==
  /\ net = "online" /\ events = <<>> /\ seen = "online"
  /\ st = [j \in J |-> "none"]
  /\ runs = [j \in J |-> {}]
  /\ retryDue = [j \in J |-> FALSE]
  /\ attempts = [j \in J |-> 0]
  /\ saved = [j \in J |-> "none"] /\ savedAttempts = [j \in J |-> 0]
  /\ cancelled = [j \in J |-> FALSE] /\ wanted = [j \in J |-> FALSE]
  /\ real = [j \in J |-> 0]
  /\ told = FALSE

\* Each step that calls persistNow() writes storage from the step's result.
Persist ==
  /\ saved' = Persisted(st')
  /\ savedAttempts' = attempts'

(***************************************************************************)
(* What you do.                                                            *)
(***************************************************************************)

\* start() (manager.ts:589-648). An active job with the id is joined
\* (manager.ts:600-605), and a failed one restarts as Retry does
\* (manager.ts:606-610), so both are left out here. A done or cancelled job
\* is replaced by a new entry (manager.ts:611).
Start(j) ==
  /\ st[j] \in {"none", "done", "cancelled"} \* manager.ts:600, 606
  /\ Pump([st EXCEPT ![j] = Requeued], runs) \* manager.ts:613, 621, 645
  /\ retryDue' = [retryDue EXCEPT ![j] = FALSE] \* manager.ts:611; remove() clears the timer
  /\ attempts' = [attempts EXCEPT ![j] = 0]
  /\ cancelled' = [cancelled EXCEPT ![j] = FALSE]
  /\ wanted' = [wanted EXCEPT ![j] = TRUE]
  /\ real' = [real EXCEPT ![j] = 0]
  /\ UNCHANGED <<net, events, seen, told>>
  /\ Persist \* manager.ts:644

\* cancel() (manager.ts:650-670).
Cancel(j) ==
  /\ st[j] \in Active \cup {"failed"} \* manager.ts:657
  /\ Pump([st EXCEPT ![j] = "cancelled"], [runs EXCEPT ![j] = Interrupted(runs, j)]) \* manager.ts:659-668
  /\ retryDue' = [retryDue EXCEPT ![j] = FALSE] \* manager.ts:392
  /\ cancelled' = [cancelled EXCEPT ![j] = TRUE]
  /\ wanted' = [wanted EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<net, events, seen, attempts, real, told>>
  /\ Persist \* manager.ts:667

\* retry() (manager.ts:672-687): a failed job starts again with its attempts
\* reset; a retrying one skips its wait.
Retry(j) ==
  /\ st[j] \in {"failed", "retrying"} \* manager.ts:679, 682
  /\ Pump([st EXCEPT ![j] = Requeued], runs) \* manager.ts:680-685
  /\ retryDue' = [retryDue EXCEPT ![j] = FALSE] \* manager.ts:376
  /\ attempts' = IF st[j] = "failed" \* manager.ts:680
                 THEN [attempts EXCEPT ![j] = 0] ELSE attempts
  /\ wanted' = [wanted EXCEPT ![j] = TRUE]
  /\ real' = IF st[j] = "failed" THEN [real EXCEPT ![j] = 0] ELSE real
  /\ UNCHANGED <<net, events, seen, cancelled, told>>
  /\ Persist \* manager.ts:684

\* dismiss() (manager.ts:689-695): a finished or failed job leaves the list.
Dismiss(j) ==
  /\ st[j] \in {"failed", "done", "cancelled"} \* manager.ts:691
  /\ st' = [st EXCEPT ![j] = "none"]
  /\ wanted' = [wanted EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<net, events, seen, runs, retryDue, attempts, cancelled, real,
                 told>>
  /\ Persist \* manager.ts:693

\* The page reloads: storage brings back each saved job (restore(),
\* manager.ts:537-587), queued or waiting by navigator.onLine, and the
\* manager pumps (manager.ts:791). The old page's requests die with it.
Reload ==
  /\ Pump([j \in J |-> IF saved[j] = "failed" THEN "failed"
                       ELSE IF saved[j] = "queued"
                            THEN (IF net = "online" THEN "queued" ELSE "waiting") \* manager.ts:553-555
                            ELSE "none"],
          [j \in J |-> {}])
  /\ seen' = net \* manager.ts:168
  /\ events' = <<>>
  /\ retryDue' = [j \in J |-> FALSE]
  /\ attempts' = savedAttempts
  /\ real' = savedAttempts
  /\ told' = (net = "offline") \* manager.ts:168 reads navigator.onLine
  /\ UNCHANGED <<net, saved, savedAttempts, cancelled, wanted>>

(***************************************************************************)
(* The world, and time passing.                                            *)
(***************************************************************************)
DeviceGoesOffline ==
  /\ net = "online" /\ Len(events) < 2
  /\ net' = "offline"
  /\ events' = Append(events, "offline")
  /\ UNCHANGED <<seen, st, runs, retryDue, attempts, saved, savedAttempts,
                 cancelled, wanted, real, told>>

DeviceGoesOnline ==
  /\ net = "offline" /\ Len(events) < 2
  /\ net' = "online"
  /\ events' = Append(events, "online")
  /\ told' = FALSE
  /\ UNCHANGED <<seen, st, runs, retryDue, attempts, saved, savedAttempts,
                 cancelled, wanted, real>>

\* retryTimerFires() (manager.ts:365-372). It does not persist; the job was
\* saved as queued while it retried.
RetryTimerFires(j) ==
  /\ retryDue[j]
  /\ st[j] = "retrying" \* manager.ts:367
  /\ Pump([st EXCEPT ![j] = Requeued], runs) \* manager.ts:369-370
  /\ retryDue' = [retryDue EXCEPT ![j] = FALSE] \* manager.ts:366
  /\ UNCHANGED <<net, events, seen, attempts, saved, savedAttempts,
                 cancelled, wanted, real, told>>

\* forgetLater() (manager.ts:413-423): ten seconds after a job ends.
ForgetFires(j) ==
  /\ st[j] \in {"done", "cancelled"} \* manager.ts:419
  /\ st' = [st EXCEPT ![j] = "none"]
  /\ UNCHANGED <<net, events, seen, runs, retryDue, attempts, saved,
                 savedAttempts, cancelled, wanted, real, told>>

(***************************************************************************)
(* What the app does by itself.                                            *)
(***************************************************************************)

\* onNetwork() (manager.ts:453-485) for the next event the browser delivers.
DeliverEvent ==
  /\ events # <<>>
  /\ LET next == Head(events) = "online"
         was == seen = "online" \* manager.ts:455
         stops(j) == ~next /\ st[j] \in {"running", "queued", "retrying"} \* manager.ts:462-465
         back(j) == next /\ (st[j] = "waiting" \/ (~was /\ st[j] = "retrying")) \* manager.ts:475-480
         s == [j \in J |-> IF stops(j) THEN "waiting"
                           ELSE IF back(j) THEN Requeued
                           ELSE st[j]]
         r == [j \in J |-> IF stops(j) THEN Interrupted(runs, j) ELSE runs[j]]
     IN /\ Pump(s, r) \* manager.ts:483
        /\ retryDue' = [j \in J |-> IF stops(j) \/ back(j) THEN FALSE ELSE retryDue[j]]
        /\ seen' = IF next THEN "online" ELSE "offline" \* manager.ts:456
        /\ told' = (told \/ (~next /\ net = "offline"))
  /\ events' = Tail(events)
  /\ UNCHANGED <<net, attempts, cancelled, wanted, real>>
  /\ Persist \* manager.ts:482

\* An interrupted attempt's promise settles: settle() returns at
\* manager.ts:314. Several stale attempts may end together.
StaleAttemptEnds(j) ==
  /\ "stale" \in runs[j]
  /\ runs' = [runs EXCEPT ![j] = @ \ {"stale"}]
  /\ UNCHANGED <<net, events, seen, st, retryDue, attempts, saved,
                 savedAttempts, cancelled, wanted, real, told>>

\* settle() (manager.ts:309-363) for the current attempt, which succeeded.
AttemptSucceeds(j) ==
  /\ "current" \in runs[j]
  /\ st[j] = "running" \* manager.ts:314
  /\ Pump([st EXCEPT ![j] = "done"], [runs EXCEPT ![j] = @ \ {"current"}]) \* manager.ts:319-327, 361
  /\ wanted' = [wanted EXCEPT ![j] = FALSE]
  /\ UNCHANGED <<net, events, seen, retryDue, attempts, cancelled, real,
                 told>>
  /\ Persist \* manager.ts:360

\* settle() for the current attempt, which failed. `retryable` is the
\* failure's class (classifyJobError, manager.ts:841-864). Offline, settle()
\* waits before it reads the class (manager.ts:328), so the class matters
\* only online.
AttemptFails(j, retryable) ==
  /\ "current" \in runs[j]
  /\ st[j] = "running" \* manager.ts:314
  /\ LET r == [runs EXCEPT ![j] = @ \ {"current"}]
     IN IF net = "offline" \* manager.ts:328
        THEN /\ Pump([st EXCEPT ![j] = "waiting"], r) \* manager.ts:331, 361
             /\ seen' = "offline" \* manager.ts:330
             /\ told' = TRUE
             /\ UNCHANGED <<retryDue, attempts, real>>
        ELSE LET n == attempts[j] + 1 \* manager.ts:334
                 again == retryable /\ n < MaxAttempts \* manager.ts:335-336
             IN /\ Pump([st EXCEPT ![j] = IF again THEN "retrying" ELSE "failed"], r) \* manager.ts:336-358, 361
                /\ retryDue' = [retryDue EXCEPT ![j] = again] \* manager.ts:345-348
                /\ attempts' = [attempts EXCEPT ![j] = n]
                /\ real' = [real EXCEPT ![j] = @ + 1]
                /\ UNCHANGED <<seen, told>>
  /\ UNCHANGED <<net, events, cancelled, wanted>>
  /\ Persist \* manager.ts:360

System ==
  \/ DeliverEvent
  \/ \E j \in J : StaleAttemptEnds(j)
  \/ \E j \in J : AttemptSucceeds(j)
  \/ \E j \in J, retryable \in BOOLEAN : AttemptFails(j, retryable)

Next ==
  \/ \E j \in J : Start(j) \/ Cancel(j) \/ Retry(j) \/ Dismiss(j)
  \/ \E j \in J : RetryTimerFires(j) \/ ForgetFires(j)
  \/ Reload
  \/ DeviceGoesOffline
  \/ DeviceGoesOnline
  \/ System

Spec == Init /\ [][Next]_vars

\* The app has nothing left to do until you, the network or a timer act.
Settled == ~ENABLED System

(***************************************************************************)
(* Rules.                                                                  *)
(***************************************************************************)

\* At most Limit downloads in a lane say Downloading at once.
LaneLimit == Running(st) <= Limit

\* A download says Downloading exactly while its request is out.
RunMeansRunning == \A j \in J : ("current" \in runs[j]) = (st[j] = "running")

\* Once the app knows the device is offline, no download says Downloading.
OfflineNothingRuns == told => \A j \in J : st[j] # "running"

\* A download you cancelled stays cancelled until you start it again: no
\* late answer, retry, reconnect or reload brings it back.
CancelIsFinal == \A j \in J : cancelled[j] => st[j] \in {"cancelled", "none"}

\* A reload never loses a download you started and did not cancel; one
\* that gave up comes back as "Couldn't download".
ReloadKeepsWork == \A j \in J : wanted[j] => st[j] # "none"

\* Losing the network never uses up a download's retries.
OfflineCostsNoRetry == \A j \in J : attempts[j] <= real[j]

\* Once the network is back and the app has heard, work that waited for it
\* runs again without a tap, and nothing sits in the queue with the lane
\* free.
ResumesWhenBack ==
  (Settled /\ net = "online")
    => \A j \in J : st[j] \notin {"waiting", "queued"}

=============================================================================
