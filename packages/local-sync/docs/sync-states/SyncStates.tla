----------------------------- MODULE SyncStates -----------------------------
(***************************************************************************)
(* How a local-first app tells "offline" from "signed out", and what it    *)
(* shows. The model follows createSyncController in                        *)
(* packages/local-sync/src/controller.ts, describeSyncStatus in status.ts, *)
(* and the apps' session checks (apps/reader/src/hooks/use-auth.ts and     *)
(* apps/arctic/Browser/src/App.tsx). Each action is one synchronous step   *)
(* of that code. Conditions on the world (the network, the server, the     *)
(* cookie) are what the code sees when a request settles. See             *)
(* ../SYNC_STATES.md for the chart and what the model leaves out.          *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxEdits

VARIABLES
  \* The world.
  device,     \* navigator.onLine: "online" | "offline"
  reach,      \* requests get an HTTP answer: "yes" | "no" (spotty wifi, a server that is down)
  account,    \* this browser's cookie, as the server sees it:
              \*   "none"  nobody is signed in
              \*   "live"  a valid session that this device has heard about
              \*   "new"   a valid session that this device has not heard about yet
              \*           (just back from the sign-in redirect, or signed in in another tab)
              \*   "ended" the session ended on the server (expired or revoked)
  \* The controller (controller.ts).
  auth,       \* status.auth.status: "unknown" | "signed-in" | "signed-out" | "expired"
  connection, \* status.connection: "online" | "offline" | "unreachable"
  running,    \* status.running: an attempt is in flight (`active`)
  stale,      \* authEpoch changed since the attempt in flight began
  answered,   \* confirmations changed since the attempt in flight began
  sentWith,   \* the cookie that the attempt in flight carries: "valid" | "none"
  failure,    \* status.failure.kind, or "none": "none" | "network" | "unauthorized"
  retryDue,   \* nextAt is finite: a retry is set after a failure
  requested,  \* requestedAt is finite: requestSync or the online event asked for an attempt
  sid,        \* sessionId compared with the cookie's session: "none" | "cookie" | "older"
  synced,     \* status.lastSyncedAt is set
  marker,     \* signInAt: beginSignIn() ran, no server has answered since, and
              \* ten minutes have not passed (SIGN_IN_RETURN_MS)
  returning,  \* `returning`: the page loaded from the marker over an ended
              \* session; auth is "unknown" and that session's user is remembered
  \* The app.
  check,      \* a session check is in flight (Better Auth's get-session, Arctic's /account)
  unsent,     \* local changes the server does not have; the app reports them as status.pending
  sent,       \* how many of them the attempt in flight carries
  \* What the rules read.
  told        \* since this device was last signed in, the server said there is no session,
              \* or you signed out

vars == <<device, reach, account, auth, connection, running, stale, answered,
          sentWith, failure, retryDue, requested, sid, synced, marker,
          returning, check, unsent, sent, told>>

Out == {"signed-out", "expired"}

\* The cookie the browser sends now.
Cookie == IF account \in {"live", "new"} THEN "valid" ELSE "none"

\* controller.ts:201-211 automatic(): started, not paused, and the device says
\* online. The model starts the controller at launch, as Spaced does.
AutomaticWith(a, d) == a \notin Out /\ d = "online"
Automatic == AutomaticWith(auth, device)

\* controller.ts:393-405 refusedAuth(): a remembered user (signed in, ended,
\* or back from signing in) is expired; anyone else is signed out.
Refused(a, r) == IF a \in {"signed-in", "expired"} \/ r THEN "expired" ELSE "signed-out"

\* What the account menu says: describeSyncStatus in status.ts:226-315, in its order.
Label ==
  IF connection = "offline" THEN "Offline"
  ELSE IF auth = "expired" THEN "Sign in again to sync"
  ELSE IF running THEN "Syncing"
  ELSE IF auth = "signed-out" THEN "Sign in to sync"
  ELSE IF failure = "network" THEN "Couldn't reach the server"
  ELSE IF unsent > 0 THEN "Saved on this device, will sync"
  ELSE IF synced THEN "Synced"
  ELSE "Not synced yet"

\* controller.ts:233-248 begin(): a new attempt carries the cookie the browser has now.
Begin(c, u) ==
  /\ running' = TRUE
  /\ stale' = FALSE
  /\ answered' = FALSE
  /\ sentWith' = Cookie
  /\ sent' = u
  /\ requested' = FALSE
  /\ connection' = IF c = "offline" THEN "online" ELSE c

\* No attempt in flight.
Idle(c) ==
  /\ running' = FALSE
  /\ stale' = FALSE
  /\ answered' = FALSE
  /\ sentWith' = "none"
  /\ sent' = 0
  /\ connection' = c

\* controller.ts:249-261: after an attempt, run again when it should
\* (`again`), otherwise schedule().
Settle(again, a, c, u) ==
  IF again /\ AutomaticWith(a, device) \* controller.ts:260
  THEN Begin(c, u)
  ELSE Idle(c) /\ UNCHANGED requested

TypeOK ==
  /\ device \in {"online", "offline"}
  /\ reach \in {"yes", "no"}
  /\ account \in {"none", "live", "new", "ended"}
  /\ auth \in {"unknown", "signed-in", "signed-out", "expired"}
  /\ connection \in {"online", "offline", "unreachable"}
  /\ running \in BOOLEAN /\ stale \in BOOLEAN /\ answered \in BOOLEAN
  /\ sentWith \in {"valid", "none"}
  /\ failure \in {"none", "network", "unauthorized"}
  /\ retryDue \in BOOLEAN /\ requested \in BOOLEAN
  /\ sid \in {"none", "cookie", "older"}
  /\ synced \in BOOLEAN /\ marker \in BOOLEAN /\ returning \in BOOLEAN
  /\ check \in BOOLEAN
  /\ unsent \in 0..MaxEdits /\ sent \in 0..MaxEdits
  /\ told \in BOOLEAN

(***************************************************************************)
(* Start: a new device, online, that nobody has signed in on. Every other  *)
(* launch is a Reopen from a state the model reaches.                      *)
(***************************************************************************)
Init ==
  /\ device = "online" /\ reach = "yes"
  /\ account = "none" /\ auth = "unknown"
  /\ connection = "online" \* controller.ts:161
  /\ failure = "none" /\ retryDue = FALSE /\ requested = FALSE
  /\ sid = "none" /\ synced = FALSE
  /\ marker = FALSE /\ returning = FALSE
  /\ check = TRUE
  /\ unsent = 0 /\ told = FALSE
  /\ running = TRUE \* controller.ts:435 start()
  /\ stale = FALSE /\ answered = FALSE
  /\ sentWith = "none" /\ sent = 0

\* The page loads with the persisted status (controller.ts:413-429 save(),
\* 570-578 initialAuth()), starts sync (controller.ts:431-440), and checks
\* the session. Only a remembered user survives a reload; signed-out comes
\* back as unknown. An ended session with a fresh sign-in marker comes back
\* as unknown, its user remembered (controller.ts:153-162). The step sets
\* account' and marker' before this.
Reopened ==
  LET kept == IF auth \in {"signed-in", "expired"} THEN auth
              ELSE IF returning THEN "expired" \* controller.ts:416-418
              ELSE "unknown"
      r == kept = "expired" /\ marker' \* controller.ts:153-159
      a == IF r THEN "unknown" ELSE kept \* controller.ts:162
      go == AutomaticWith(a, device) \* controller.ts:435
  IN /\ auth' = a
     /\ returning' = r
     /\ told' = (told /\ kept \in Out)
     /\ connection' = IF device = "online" THEN "online" ELSE "offline" \* controller.ts:161
     /\ failure' = "none" /\ retryDue' = FALSE /\ requested' = FALSE
     /\ sid' = "none"
     /\ check' = TRUE
     /\ running' = go
     /\ stale' = FALSE /\ answered' = FALSE
     /\ sentWith' = (IF go THEN Cookie' ELSE "none")
     /\ sent' = (IF go THEN unsent ELSE 0)

(***************************************************************************)
(* The world changes.                                                      *)
(***************************************************************************)
DeviceGoesOffline ==
  /\ device = "online"
  /\ device' = "offline"
  /\ connection' = "offline" \* controller.ts:361-365
  /\ UNCHANGED <<reach, account, auth, running, stale, answered, sentWith,
                 failure, retryDue, requested, sid, synced, marker, returning,
                 check, unsent, sent, told>>

DeviceGoesOnline ==
  /\ device = "offline"
  /\ device' = "online"
  /\ LET c == IF connection = "offline" THEN "online" ELSE connection \* controller.ts:367
     IN IF AutomaticWith(auth, "online") /\ ~running \* controller.ts:369
        THEN Begin(c, unsent)
        ELSE /\ requested' = TRUE \* controller.ts:371
             /\ connection' = c
             /\ UNCHANGED <<running, stale, answered, sentWith, sent>>
  /\ UNCHANGED <<reach, account, auth, failure, retryDue, sid, synced, marker,
                 returning, check, unsent, told>>

RequestsStop ==
  /\ reach = "yes"
  /\ reach' = "no"
  /\ UNCHANGED <<device, account, auth, connection, running, stale, answered,
                 sentWith, failure, retryDue, requested, sid, synced, marker,
                 returning, check, unsent, sent, told>>

RequestsResume ==
  /\ reach = "no"
  /\ reach' = "yes"
  /\ UNCHANGED <<device, account, auth, connection, running, stale, answered,
                 sentWith, failure, retryDue, requested, sid, synced, marker,
                 returning, check, unsent, sent, told>>

SessionEnds ==
  /\ account \in {"live", "new"}
  /\ account' = "ended"
  /\ UNCHANGED <<device, reach, auth, connection, running, stale, answered,
                 sentWith, failure, retryDue, requested, sid, synced, marker,
                 returning, check, unsent, sent, told>>

\* Ten minutes pass after beginSignIn() with no answer: a later load is not a
\* return from it (controller.ts:157, SIGN_IN_RETURN_MS).
MarkerLapses ==
  /\ marker
  /\ marker' = FALSE
  /\ UNCHANGED <<device, reach, account, auth, connection, running, stale,
                 answered, sentWith, failure, retryDue, requested, sid, synced,
                 returning, check, unsent, sent, told>>

(***************************************************************************)
(* What you do.                                                            *)
(***************************************************************************)
\* A local write. Arctic calls syncSoon(); Reader and Spaced wait for the
\* periodic attempt, which the model treats as the same request.
Edit ==
  /\ unsent < MaxEdits
  /\ unsent' = unsent + 1
  /\ requested' = TRUE \* controller.ts:544-547 requestSync()
  /\ UNCHANGED <<device, reach, account, auth, connection, running, stale,
                 answered, sentWith, failure, retryDue, sid, synced, marker,
                 returning, check, sent, told>>

\* The account menu offers Sync now while signed in.
SyncNow ==
  /\ auth = "signed-in" \* AccountMenu.tsx:182-196 (Sign in replaces it otherwise)
  /\ device = "online" \* controller.ts:450
  /\ ~running \* controller.ts:454
  /\ Begin(connection, unsent)
  /\ UNCHANGED <<device, reach, account, auth, failure, retryDue, sid, synced,
                 marker, returning, check, unsent, told>>

\* The tab becomes visible: Better Auth refetches the session, and the
\* controller syncs when healthy.
ReturnToApp ==
  /\ ~check
  /\ check' = TRUE
  /\ IF Automatic /\ ~running /\ failure = "none" \* controller.ts:376-382
     THEN Begin(connection, unsent)
     ELSE UNCHANGED <<running, stale, answered, sentWith, sent, requested,
                      connection>>
  /\ UNCHANGED <<device, reach, account, auth, failure, retryDue, sid, synced,
                 marker, returning, unsent, told>>

\* You close the app, or the page reloads, and open it again.
Reopen ==
  /\ UNCHANGED <<device, reach, account, synced, unsent, marker>>
  /\ Reopened

\* Sign-in is a redirect: the app calls beginSignIn(), and the page loads
\* again with a new cookie.
SignInHere ==
  /\ auth # "signed-in" \* AccountMenu.tsx:191-194, 244-250 offer Sign in otherwise
  /\ device = "online" /\ reach = "yes" \* AccountMenu.tsx:103 signIn.social needs the server
  /\ account' = "new"
  /\ marker' = TRUE \* AccountMenu.tsx:102, controller.ts:554-557 beginSignIn()
  /\ UNCHANGED <<device, reach, synced, unsent>>
  /\ Reopened

\* You leave to sign in but come back without signing in (you cancel at the
\* provider, which sends you back). The cookie stays as it was.
SignInGivenUp ==
  /\ auth # "signed-in" \* AccountMenu.tsx:191-194, 244-250
  /\ device = "online" /\ reach = "yes" \* AccountMenu.tsx:103
  /\ marker' = TRUE \* AccountMenu.tsx:102, controller.ts:554-557 beginSignIn()
  /\ UNCHANGED <<device, reach, account, synced, unsent>>
  /\ Reopened

\* Another tab on this device signs in, which replaces the shared cookie.
SignInElsewhere ==
  /\ account \in {"none", "ended"}
  /\ device = "online" /\ reach = "yes" \* AccountMenu.tsx:103, in the other tab
  /\ account' = "new"
  /\ sid' = IF sid = "cookie" THEN "older" ELSE sid
  /\ UNCHANGED <<device, reach, auth, connection, running, stale, answered,
                 sentWith, failure, retryDue, requested, synced, marker,
                 returning, check, unsent, sent, told>>

SignOut ==
  /\ auth \in {"signed-in", "expired"}
  /\ device = "online" /\ reach = "yes" \* AccountMenu.tsx:120-121 server first
  /\ account' = "none"
  /\ auth' = "signed-out" \* controller.ts:514-530 signOut()
  /\ told' = TRUE
  /\ sid' = "none"
  /\ marker' = FALSE /\ returning' = FALSE \* controller.ts:515 answered()
  /\ failure' = "none" /\ retryDue' = FALSE /\ requested' = FALSE
  /\ synced' = FALSE
  /\ Idle(connection) \* controller.ts:521 aborts the attempt
  /\ UNCHANGED <<device, reach, check, unsent>>

(***************************************************************************)
(* What the app does by itself.                                            *)
(***************************************************************************)
\* controller.ts:214-231: the one timer, for a requested sync.
SoonTimerFires ==
  /\ Automatic \* controller.ts:218, 225
  /\ ~running \* controller.ts:218, 225
  /\ failure = "none" \* controller.ts:219
  /\ retryDue \/ requested \* controller.ts:219, 221
  /\ Begin(connection, unsent)
  /\ UNCHANGED <<device, reach, account, auth, failure, retryDue, sid, synced,
                 marker, returning, check, unsent, told>>

\* controller.ts:214-231: the one timer, for the retry after a failure.
RetryTimerFires ==
  /\ Automatic \* controller.ts:218, 225
  /\ ~running \* controller.ts:218, 225
  /\ failure # "none" \* controller.ts:219-220
  /\ retryDue \* controller.ts:219, 221
  /\ Begin(connection, unsent)
  /\ UNCHANGED <<device, reach, account, auth, failure, retryDue, sid, synced,
                 marker, returning, check, unsent, told>>

\* controller.ts:288-312 succeed()
AttemptSucceeds ==
  /\ running
  /\ device = "online" /\ reach = "yes" \* http.ts:21 the request got a response
  /\ sentWith = "valid" \* the server accepted the attempt's cookie
  /\ LET hear == ~stale /\ (auth \in {"expired", "signed-in"} \/ returning) \* controller.ts:298-303
         a == IF hear THEN "signed-in" ELSE auth
         u == unsent - sent
     IN /\ auth' = a
        /\ account' = IF hear /\ account = "new" THEN "live" ELSE account
        /\ told' = IF hear THEN FALSE ELSE told
        /\ marker' = IF hear THEN FALSE ELSE marker \* controller.ts:306 answered()
        /\ returning' = IF hear THEN FALSE ELSE returning
        /\ failure' = "none" /\ retryDue' = FALSE \* controller.ts:290-296, 308
        /\ synced' = TRUE
        /\ unsent' = u
        /\ Settle(stale, a, "online", u) \* controller.ts:256
  /\ UNCHANGED <<device, reach, sid, check>>

\* controller.ts:314-343 fail() for a request that got no answer.
AttemptNoAnswer ==
  /\ running
  /\ device = "offline" \/ reach = "no" \* http.ts:22-27 fetchOrNetworkError, stream.ts
  /\ LET c == IF device = "online" THEN "unreachable" ELSE "offline" \* controller.ts:317-322
     IN /\ failure' = "network" /\ retryDue' = TRUE \* controller.ts:332-334
        /\ Settle(stale, auth, c, unsent) \* controller.ts:256
  /\ UNCHANGED <<device, reach, account, auth, sid, synced, marker, returning,
                 check, unsent, told>>

\* controller.ts:332-341: a 401 to the current credentials.
AttemptRefused ==
  /\ running
  /\ device = "online" /\ reach = "yes" \* http.ts:21 the request got a response
  /\ sentWith = "none" \* the server refused the attempt's cookie
  /\ ~stale /\ ~answered \* controller.ts:325-328
  /\ auth' = Refused(auth, returning) \* controller.ts:336
  /\ told' = TRUE
  /\ marker' = FALSE /\ returning' = FALSE \* controller.ts:338 answered()
  /\ failure' = "unauthorized" /\ retryDue' = TRUE \* controller.ts:332-334
  /\ Idle("online")
  /\ UNCHANGED <<device, reach, account, requested, sid, synced, check, unsent>>

\* controller.ts:323-331: a 401 to credentials that have since changed, or to
\* an attempt that began before the server last confirmed a session.
AttemptRefusedLate ==
  /\ running
  /\ device = "online" /\ reach = "yes" \* http.ts:21 the request got a response
  /\ sentWith = "none" \* the server refused the attempt's cookie
  /\ stale \/ answered \* controller.ts:325-328
  /\ Settle(TRUE, auth, "online", unsent) \* controller.ts:255-260
  /\ UNCHANGED <<device, reach, account, auth, failure, retryDue, sid, synced,
                 marker, returning, check, unsent, told>>

\* use-auth.ts:37 and App.tsx:144: an error without a 401 is not an answer.
CheckGetsNoAnswer ==
  /\ check
  /\ device = "offline" \/ reach = "no" \* use-auth.ts:37; App.tsx:144
  /\ check' = FALSE
  /\ UNCHANGED <<device, reach, account, auth, connection, running, stale,
                 answered, sentWith, failure, retryDue, requested, sid, synced,
                 marker, returning, unsent, sent, told>>

\* use-auth.ts:27-36 and App.tsx:142 call confirmSignedIn (controller.ts:461-500).
CheckFindsSession ==
  /\ check
  /\ device = "online" /\ reach = "yes" \* use-auth.ts:27 data.user
  /\ account \in {"live", "new"} \* use-auth.ts:27 the server has a session for this cookie
  /\ check' = FALSE
  /\ LET changed == auth \in Out \/ returning \/ (auth = "signed-in" /\ sid = "older") \* controller.ts:472-480
     IN /\ auth' = "signed-in" \* controller.ts:486-491
        /\ account' = "live"
        /\ sid' = "cookie" \* controller.ts:481
        /\ told' = FALSE
        /\ marker' = FALSE /\ returning' = FALSE \* controller.ts:484 answered()
        /\ failure' = IF failure = "unauthorized" THEN "none" ELSE failure \* controller.ts:492-495
        /\ IF changed /\ ~running /\ device = "online" \* controller.ts:498
           THEN Begin(connection, unsent)
           ELSE /\ stale' = (stale \/ (changed /\ running)) \* controller.ts:482
                /\ answered' = running \* controller.ts:464
                /\ UNCHANGED <<running, sentWith, sent, requested, connection>>
  /\ UNCHANGED <<device, reach, retryDue, synced, unsent>>

\* use-auth.ts:37-38 and App.tsx:140 call confirmSignedOut (controller.ts:502-512).
CheckFindsNoSession ==
  /\ check
  /\ device = "online" /\ reach = "yes" \* use-auth.ts:37 no data, no error
  /\ account \in {"none", "ended"} \* use-auth.ts:37 the server has no session for this cookie
  /\ check' = FALSE
  /\ IF auth \in Out \* controller.ts:504
     THEN UNCHANGED <<auth, told, stale, marker, returning>>
     ELSE /\ auth' = Refused(auth, returning) \* controller.ts:507
          /\ told' = TRUE
          /\ stale' = running \* controller.ts:506
          /\ marker' = FALSE /\ returning' = FALSE \* controller.ts:508 answered()
  /\ UNCHANGED <<device, reach, account, connection, running, answered,
                 sentWith, failure, retryDue, requested, sid, synced, unsent,
                 sent>>

System ==
  \/ SoonTimerFires
  \/ RetryTimerFires
  \/ AttemptSucceeds
  \/ AttemptNoAnswer
  \/ AttemptRefused
  \/ AttemptRefusedLate
  \/ CheckGetsNoAnswer
  \/ CheckFindsSession
  \/ CheckFindsNoSession

Next ==
  \/ DeviceGoesOffline
  \/ DeviceGoesOnline
  \/ RequestsStop
  \/ RequestsResume
  \/ SessionEnds
  \/ MarkerLapses
  \/ Edit
  \/ SyncNow
  \/ ReturnToApp
  \/ Reopen
  \/ SignInHere
  \/ SignInGivenUp
  \/ SignInElsewhere
  \/ SignOut
  \/ System

Spec == Init /\ [][Next]_vars

\* The app has nothing left to do until you, the network or the server act.
Settled == ~ENABLED System

(***************************************************************************)
(* Rules.                                                                  *)
(***************************************************************************)

\* Offline is shown when the device has no network, and only then.
OfflineMeansNoNetwork == (Label = "Offline") = (device = "offline")

\* Being offline, or a server that does not answer, never signs you out.
\* Only the server's answer, or you, can.
NoGuessedSignOut == auth \in Out => told

\* While the server accepts a session that this device has heard about, the
\* device never offers Sign in: not offline, not when requests fail, and not
\* after a late answer about an older session.
HeardSessionStays == account = "live" => auth \notin Out

\* "Couldn't reach the server" is shown only while a retry is coming.
RetryIsComing ==
  Label = "Couldn't reach the server" => Automatic /\ ~running /\ retryDue

\* Once the network and the server work again, your changes reach the server
\* without a reload or a tap.
SyncsWhenBack ==
  (Settled /\ device = "online" /\ reach = "yes" /\ account = "live")
    => unsent = 0

\* Back from signing in on this page, the device does not offer Sign in
\* before the server answers, reloads included, unless ten minutes pass.
BackFromSignInIsSeen == (account = "new" /\ marker) => auth \notin Out

\* A session that ended on the server is never shown as signed in.
EndedSessionLooksSignedOut == account = "ended" => auth # "signed-in"

\* After you sign in again, here or in another tab, the device never offers
\* Sign in.
NewSignInIsSeen == account = "new" => auth \notin Out

=============================================================================
