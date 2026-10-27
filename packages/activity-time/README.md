# @workbench/activity-time

Time spent in Reader, Arctic and Spaced, counted by one rule and read in one
shape. The package exports TypeScript source and works with React 18 and 19.

- `@workbench/activity-time`: the rule (`ActiveTime`), sessions and their
  saves (`ActivityTracker`), the `ActivitySession` shape, the codecs for each
  app's records, and `summarizeTime`. No DOM.
- `@workbench/activity-time/dom`: `observeInteraction` (the page's signals)
  and `connectTracker` (signals and checkpoints into a tracker).
- `@workbench/activity-time/react`: `useActivityTracker` and
  `useActivitySession`.

[Reading time](../../READING_TIME.md) explains why the rule counts time
between actions. This page is the contract.

## The rule

A session counts **time between boundaries**. A boundary is an opening (the
session starts, or the page comes back), an input, or a pause.

- The interval from one boundary to the next counts when it is longer than
  zero and at most the **gap**. A longer interval counts for nothing, not
  even up to the gap.
- A pause counts its interval and leaves none open. No time counts until the
  page comes back or the person makes an input.
- A timer saves counted time. It never adds time.

The gap is three minutes (`DEFAULT_GAP_MS`), as on Arctic for iPhone.
Spaced uses three minutes. Both used two until 28 October 2026. The Reader
keeps ten minutes (`READER_GAP_MS`): paged reading has quiet minutes between
page turns, and its history was counted that way. Each session records its
gap in `gapMs`; Arctic's and Spaced's stores keep none, so their codecs give
today's.

Example, with a three-minute gap: open at 0 s, inputs at 40, 75 and 300 s.
The session has 75 s; the 225 s gap counts nothing. An input at 310 s adds
10 s.

## Signals

`observeInteraction` reports these signals from a window:

| Signal             | Events                                                                    | Report          |
| ------------------ | ------------------------------------------------------------------------- | --------------- |
| Input              | `pointerdown`, `mousemove`, `touchstart`, `touchmove`, `keydown`, `wheel` | input           |
| Pen hover          | `pointermove` from a pen, as an Apple Pencil over an iPad                 | input           |
| Scroll             | `scroll` within one second of an input                                    | input           |
| Hidden, visible    | `visibilitychange`                                                        | pause, return   |
| Window focus       | `blur` (focus left the page and its frames), `focus`                      | pause, return   |
| Back/forward cache | `pagehide` and `pageshow` with `persisted`                                | pause, return   |
| Unload             | `pagehide` without `persisted`                                            | end the session |
| Frozen             | `freeze`                                                                  | pause           |

- Only the browser's own events count: an event with `isTrusted` false does
  not. A scroll event is trusted even when code scrolled the page, for
  example to restore a reading position. Thus a scroll counts only just after
  a real input. Momentum scrolling more than a second after a flick does not
  count; that moves a boundary and rarely changes a total.
- Inputs do not count while the page is hidden.
- An input proves presence, so it also ends a pause. A person can scroll or
  move the mouse over a window that does not have focus, for example to read
  beside their notes. That time counts from the input; the time before it
  does not.
- Listeners use the capture phase and are passive. A handler that stops
  propagation cannot hide an input, and scrolling does not wait for them.
- `pauseOnBlur: false` turns off the focus pause.

## Sessions and saves

`ActivityTracker` keeps one session at a time. `begin(subject)` starts one
and ends the previous subject's; for the open subject it only moves the
position. `input`, `pause` and `resume` report boundaries; `end` closes the
session. `connectTracker` and the hooks call them for the page.

- A changed session saves at most every five seconds (`CHECKPOINT_MS`) and at
  once on a pause or end. Saves run one at a time, in order. A newer value is
  never overwritten by an older one.
- A failed save stays in memory. The next checkpoint retries the newest
  value. `onError` hears every failure.
- `persist(session, { paused })` receives the whole snapshot. `paused` is
  true after a pause or end, a good moment to upload.
- Elapsed time uses the wall clock (`Date.now`), which advances while a
  computer sleeps. A visible page on a sleeping laptop thus shows a long gap
  and counts nothing. A clock that goes back starts a fresh boundary; a jump
  forward longer than the gap counts nothing. Tests inject `now`.
- A forced stop can lose up to five seconds. Show the result as an estimate.

## The format

`ActivitySession` (version 1) is one visit's time on one subject:

| Field          | Meaning                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `v`            | `1`. A new optional field keeps it. A change that an older reader would misread increments it, and readers skip versions they do not know. |
| `id`           | A random UUID minted when the session begins.                                                                                              |
| `app`          | `"reader"`, `"arctic"` or `"spaced"`.                                                                                                      |
| `subject`      | `{ kind, id }`: `book` and the Reader's book id, `article` and the canonical URL, `card` and the Spaced card id.                           |
| `device`       | The device that counted it, or null when its records do not say.                                                                           |
| `startedAt`    | Unix milliseconds. Stats assign a session to the local day it started.                                                                     |
| `lastActiveAt` | Unix milliseconds of the last input, or of the end of the last counted interval. It never goes back.                                       |
| `endedAt`      | Unix milliseconds, or null while open or when the store has no end. Use `lastActiveAt` as the end of a session left open.                  |
| `activeMs`     | Whole milliseconds counted by the rule.                                                                                                    |
| `gapMs`        | The gap that counted `activeMs`.                                                                                                           |
| `position`     | `{ start, end }` in the app's terms, or null. Reader: `{ spineIndex, progress }`, progress 0–100 through the spine item.                   |

It is safe to save again and on many devices:

- Only the tab that began a session writes it, so devices never merge into
  one record.
- Every write replaces the whole value. A retried or repeated write leaves the
  same record.
- `activeMs` and `lastActiveAt` only grow, so an older copy is recognisably
  older.

## Stored records

The format is the shape that code reads and writes. Each app keeps its
stored record, so synced history and the iPhone app stay as they are. The
codecs map them without loss of the fields they have:

| App    | Stored record                                                                                                               | Codec                                        | Missing in the store                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| Reader | `readingSessions` row in the `reader` namespace                                                                             | `fromReaderSession`, `toReaderSession`       | `gapMs` (always ten minutes)                                                  |
| Arctic | `session/<UUID>` in `arctic-reading`: `{articleURL, id, seconds, startedAt, updatedAt}`, Swift reference dates, sorted keys | `decodeArcticSession`, `encodeArcticSession` | `device`, `endedAt`, `position`, `gapMs`                                      |
| Spaced | `duration` of a `reviewLog` operation                                                                                       | `fromSpacedReview` (read only)               | `device`, `position`, `gapMs`; the start is the review time less the duration |

- **Arctic for iPhone needs no change.** The web writes the phone's five keys
  with the same encoding, and no record with zero seconds, as before.
  `updatedAt` is `lastActiveAt`. It still only grows, which is all the
  phone's merge needs: the later `updatedAt` wins. The phone counts with the
  same rule and gap (a phone build from before 28 October 2026 with 120
  seconds). To share more fields, such as `endedAt` or `device`, add
  them to `ArticleReadingSession` as optional properties first, then let the
  web write them. The phone's decoder ignores keys it does not know, and its
  journal compares decoded values, so extra keys would not break it, but the
  phone would not keep them in its own files.
- **Reader** rows do not store their gap. Add the field to the row before the
  Reader's gap changes.
- **Spaced** keeps time per card in each review log, at most two minutes per
  review (`MAX_DURATION_PER_CARD_MS`, which the gap does not change). Older reviews timed a card from its display and restarted the timer
  after a two-minute pause or a visibility change; reviews from this change
  on use the rule. The logs do not say which. Spaced writes no session
  records.

## Stats

`summarizeTime(sessions, { from, to, bucket })` totals any sessions with a
`subject`, `startedAt` and `activeMs`. A session counts when it has time and
started from `from` to `to`; pass the current time as `to`, because another
device's clock can be ahead. It returns the total, the counted sessions
(newest first), the number of local days, time per bucket (local days unless
`bucket` says otherwise), and time per subject (most first). The Reader's
Sessions page and Arctic's Reading page use it.

Sessions on two devices or tabs at once both count. The focus and hidden
pauses keep this small; removing overlap would need each interval's times,
which no store keeps.

## Tests

`bun run --cwd packages/activity-time test` runs the rule, the browser
signals (with happy-dom windows and an injected clock), saves, multi-tab use
and the codecs.

On a copy of the Workbench Backup mirror (24 October 2026), all 493 Reader
rows mapped to sessions and back unchanged, and the Sessions page gave the
same overview for eight ranges as before. All 9 Arctic records re-encoded to
the same bytes, with the same Reading page stats. All 67,371 Spaced review
logs mapped, with the same total.
