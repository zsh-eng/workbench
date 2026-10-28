# Estimate reading time with activity sessions

A plain-language account, with how it fits an iPad, is in
[docs/READING_TIME_GUIDE.md](docs/READING_TIME_GUIDE.md).

Track time between deliberate actions, not the number of actions. Keep one
small session record for each article visit. Do not write a database row for
every scroll event, and do not treat an open screen as proof of reading.

Every app counts with one rule. The web apps share its code,
[activity-time](packages/activity-time/README.md), which also defines one
record shape for time spent in Reader, Arctic and Spaced. Only the gap
differs: Arctic (on iPhone and on the web) and Spaced use **180 seconds**.
The EPUB web reader allows quiet minutes between page turns: **3 minutes on
a phone and 5 minutes on a tablet or desktop**. The device decides, not the
window, and a session keeps the gap it began with.
Arctic and Spaced used 120 seconds until 28 October 2026; their records keep
no gap, so a session read back says 180 either way. Reader used 10 minutes
on every device until then. Its sessions now store their gap (`gapMs`), and
a session without one reads as 10 minutes.

## Accounting rule

When an eligible article becomes visible, record a monotonic time boundary.
At the next user action or pause:

- If the interval is greater than zero and at most 180 seconds, add it.
- If the interval exceeds 180 seconds, discard the **whole interval**.
- Start a new boundary at the action. On pause, remove the boundary instead.

For example: open at 0 seconds, scroll at 40, tap at 75, then scroll at 300.
The estimate is **75 seconds**. The last 225-second gap contributes nothing.
An action at 310 adds another 10 seconds.

A timer saves completed intervals. It **does not add time**. Otherwise a timer
would keep an abandoned page active forever. This rule can undercount a long,
quiet reading interval, so display the result as _estimated reading time_.

## Eligibility and navigation

The view owns eligibility. The accounting module does not inspect UI state.

| Event or state                                               | Policy                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Article with readable text, saved or not, foreground         | Start or resume an interval                                         |
| Archived article                                             | Same policy as any article                                          |
| Scroll, tap, text selection, reader keyboard action          | Report deliberate activity                                          |
| Loading, speculative preload, image decode, restored scroll  | Do not report activity                                              |
| Website mode with extracted article text                     | Same policy as Reader                                               |
| Website page without article text, or a publisher front page | Do not start tracking                                               |
| Background, lock, notes or settings UI                       | Pause; exclude the time away                                        |
| Return from a pause                                          | Start a fresh boundary; keep the visit record                       |
| Navigate to another document                                 | End the outgoing visit before changing identity                     |
| Same-document anchor                                         | Keep the article identity                                           |
| Back to a previous article                                   | Start a new visit; exclude time on the other page                   |
| Page opened above another                                    | Start its visit; the covered page's late pause or end has no effect |
| Save or unsave while reading                                 | Keep the visit; time is keyed by URL either way                     |

A WebView wrapper can outlive the article it first opened. Key sessions to the
**current document identity**, not the wrapper's original URL. Scope delayed
callbacks to that document. Native callbacks report drag boundaries and throttle progress updates to once
a second; the Reader's isolated script reports trusted clicks and keys. Automatic scroll events do not count. This also prevents annotations and extracted HTML
from being written into the wrong saved article.

## Statistics

The last-seven-days article count includes a URL only when its combined reading
intervals in that window total at least 60 seconds. Several short visits can
qualify together. Earlier reading outside the window does not qualify it.
Shorter totals still contribute to reading time and visit counts. This count
measures articles read for at least a minute, not articles completed.

## Storage without scroll work

The native [ReadingSessions controller](apps/arctic/Sources/ReadingSessions.swift)
holds active boundaries and totals in memory. It has no published value that
invalidates the UI on every action. `total(for:)` returns completed intervals;
it does not estimate additional time while the reader is idle.

The view calls `flush()` on a five-second schedule and forces a flush on pause
or exit. Each dirty session becomes one small JSON file. A serial background
queue performs initial loading, encoding, and atomic replacement. Newer values
that arrive during a write are written next; an older snapshot cannot replace
them. Failed writes remain dirty in memory and can be retried. A damaged file
is kept and does not prevent other sessions from loading.

On the phone, elapsed intervals use a monotonic clock. Wall-clock dates are
only for history and presentation; changes to the device clock cannot add
negative duration. The controller resets its boundary if the monotonic input
regresses in a test or unusual runtime condition. The web uses the wall
clock, because a browser's monotonic clock can stop while a computer sleeps
and would then credit a visible page on a sleeping laptop. A clock that goes
back resets the boundary there too.

The phone uploads these files as `session/<UUID>` records in `arctic-reading`
(`AccountRecordJournal` in `Sources/LibrarySync.swift`), and Arctic for the
web writes the same records. The EPUB web reader persists session summaries
through its existing domain store and generic sync engine. Each row carries
its gap, so its total can be read with the limit that counted it.

## Reuse in another app

A web app uses [activity-time](packages/activity-time/README.md): its
tracker, browser signals and hooks do steps 2 to 6, and its session shape and
`summarizeTime` give the same records and totals as the other apps.

1. Define exactly what makes content eligible and what constitutes activity.
2. Give the visible reader one owner for starting, pausing, and ending visits.
3. Use stable document IDs, a clock that cannot add negative time, and
   separate reporting dates.
4. Keep activity updates in memory; checkpoint only changed summaries.
5. Save on lifecycle boundaries. Retain failed values and expose the error.
6. Test with an injected clock instead of waiting for real idle timeouts.

Tests should cover the exact threshold, long gaps, duplicate lifecycle events,
background/resume, document changes, clock changes, writes that overlap newer
edits, restart, and storage failure. Also test real UI navigation: a correct
counter cannot compensate for a view that sends activity for the wrong page.

Native deterministic checks:

```sh
swiftc apps/arctic/Sources/ReadingSessions.swift \
  apps/arctic/Checks/ReadingSessionChecks.swift \
  -o /tmp/arctic-reading-time-check
/tmp/arctic-reading-time-check
```

Useful code to compare:

- [Native accounting and local files](apps/arctic/Sources/ReadingSessions.swift)
- [Native deterministic checks](apps/arctic/Checks/ReadingSessionChecks.swift)
- [Shared web rule, tracker and signals](packages/activity-time/src)
- [Reader's use of it](apps/reader/src/features/reader/hooks/reading-sessions/use-reader-reading-session.ts)
- [Web session domain store](apps/reader/src/data/reading-sessions.ts)

A forced process termination can lose changes after the last completed write.
No background timer or exit callback guarantees a final write. Keep the
checkpoint interval small and report this as an estimate, not audited time.
