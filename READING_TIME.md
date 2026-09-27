# Estimate reading time with activity sessions

Track time between deliberate actions, not the number of actions. Keep one
small session record for each article visit. Do not write a database row for
every scroll event, and do not treat an open screen as proof of reading.

Arctic uses a **120-second inactivity threshold**. The EPUB web reader uses
**10 minutes**. These are product choices, not shared constants.

## Accounting rule

When an eligible article becomes visible, record a monotonic time boundary.
At the next user action or pause:

- If the interval is greater than zero and at most 120 seconds, add it.
- If the interval exceeds 120 seconds, discard the **whole interval**.
- Start a new boundary at the action. On pause, remove the boundary instead.

For example: open at 0 seconds, scroll at 40, tap at 75, then scroll at 240.
The estimate is **75 seconds**. The last 165-second gap contributes nothing.
An action at 250 adds another 10 seconds.

A timer saves completed intervals. It **does not add time**. Otherwise a timer
would keep an abandoned page active forever. This rule can undercount a long,
quiet reading interval, so display the result as *estimated reading time*.

## Eligibility and navigation

The view owns eligibility. The accounting module does not inspect UI state.

| Event or state | Policy |
| --- | --- |
| Saved article, readable Reader content, foreground | Start or resume an interval |
| Archived but still saved article | Same policy as any saved article |
| Scroll, tap, text selection, reader keyboard action | Report deliberate activity |
| Loading, speculative preload, image decode, restored scroll | Do not report activity |
| Website mode, background, lock, notes or settings UI | Pause; exclude the time away |
| Return from a pause | Start a fresh boundary; keep the visit record |
| Navigate to another document | End the outgoing visit before changing identity |
| Same-document anchor | Keep the article identity |
| Back to a previous article | Start a new visit; exclude time on the other page |
| Unsaved article | Do not start tracking |
| Save while reading | Start now; do not add time from before saving |
| Unsave | Stop tracking; keep existing history and annotations |

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

Elapsed intervals use a monotonic clock. Wall-clock dates are only for history
and presentation; changes to the device clock cannot add negative duration.
The controller resets its boundary if the monotonic input regresses in a test
or unusual runtime condition.

These files are local only. They do **not** activate Arctic's dormant sync or
library storage migration. The web reader persists session summaries through
its existing domain store and generic sync engine. Do not equate the two
platforms' current sync status.

## Reuse in another app

1. Define exactly what makes content eligible and what constitutes activity.
2. Give the visible reader one owner for starting, pausing, and ending visits.
3. Use stable document IDs, monotonic intervals, and separate reporting dates.
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
- [Web session controller](apps/reader/src/features/reader/hooks/reading-sessions/reader-reading-session-controller.ts)
- [Web session domain store](apps/reader/src/data/reading-sessions.ts)

A forced process termination can lose changes after the last completed write.
No background timer or exit callback guarantees a final write. Keep the
checkpoint interval small and report this as an estimate, not audited time.
