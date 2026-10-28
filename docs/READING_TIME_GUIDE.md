# How reading time is counted

A plain account of what Reader, Arctic and Spaced count as reading time, the
timings behind it, and how it fits an iPad. The engineering detail is in
[READING_TIME.md](../READING_TIME.md) and
[activity-time](../packages/activity-time/README.md).

## The idea

The apps never watch your eyes. They count the time **between things you
do** while a book or article is open and in front of you: a tap, a swipe, a
key, a page turn. If the next thing you do comes soon enough, the time since
the last one counts as reading. If it comes too late, that whole stretch
counts for nothing, on the view that you had put the page down.

Example, in Arctic: you open an article, scroll at 40 seconds, tap at 75
seconds, then scroll again at 5 minutes. The estimate is 75 seconds. The
3 minutes 45 seconds before the last scroll were too long, so none of it
counts. Leaving a page open never adds time by itself.

## What counts as something you did

- Touching the screen, or moving a finger on it.
- A press of the mouse, trackpad or pen, and moving the mouse pointer.
- Moving an Apple Pencil over the screen without touching it, on iPads that
  sense a hovering pencil.
- A key press, such as an arrow key or the space bar.
- Scrolling with a mouse wheel or two fingers on a trackpad.
- A scroll that follows one of these within one second. A scroll on its own
  does not count, because the app scrolls by itself too, for example when it
  takes you back to where you were.
- In Reader, turning to a new page or place in the book.

Things the app does by itself never count: loading, putting your place
back, and anything a script fakes.

## When the clock stops

The count stops, and the time away is left out, when:

- you switch to another tab or app, or lock the screen;
- the browser window loses focus, for example when you tap the app beside
  it on an iPad, or click another window on a computer;
- the browser puts the page to sleep or keeps it in its back-and-forward
  memory.

The count starts again from the moment you come back. Closing the page, or
opening another book or article, ends the visit.

## The timings and why

| Timing                                   | Value                                           | Why                                                                                                                                                          |
| ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Longest quiet stretch, Arctic and Spaced | 3 minutes                                       | You scroll an article every so often, less often on a tablet's larger screen. A longer silence more likely means the page was left open.                     |
| Longest quiet stretch, Reader            | 3 minutes on a phone, 5 on a tablet or computer | A book's page can take minutes to read without touching anything. A tablet's or computer's page holds more text than a phone's, so it gets the longer limit. |
| Scroll after an input                    | 1 second                                        | Long enough for a flick's glide to count, short enough that the app's own scrolling does not.                                                                |
| Saving                                   | every 5 seconds, and at once on a pause         | Little is lost if the browser closes, without writing on every scroll.                                                                                       |
| "Articles read" this week (Arctic)       | 1 minute in total                               | An article counts as read once its visits in the last seven days add up to a minute. Shorter visits still add to the time.                                   |

Reader's limit follows the device, not the window: a phone on its side
keeps a phone's 3 minutes, and an iPad window beside another app keeps an
iPad's 5. A touch screen whose shorter side is under 600 CSS pixels is a
phone, a larger one a tablet, and a screen without touch a computer (a
touch laptop counts as a tablet). Reader picks the limit when a visit
starts and keeps it for the whole visit. It allowed 10 minutes on every
device until 28 October 2026.

The result is an estimate. It undercounts a long, still read (a quiet
stretch past the limit counts as nothing) and never counts time with the
page put away.

## On an iPad

**Bigger screens.** An iPad shows more text at once, so you touch it less
often while reading.

- Reader allows 5 minutes on an iPad, in any window, as on a computer. A
  two-page spread in landscape takes a few minutes to read, so 5 minutes
  should cover most; a slow read of a dense spread can pass it, and then
  that stretch counts nothing. This has not been measured on an iPad. Until
  28 October 2026 it was 10 minutes, as on every device; a phone now has 3.
- Arctic's and Spaced's limit was 2 minutes until 28 October 2026, tight on
  a tablet: a full screen of an article in portrait can take about two
  minutes to read, and read without a touch, that whole stretch was lost.
  It is now 3 minutes, on every screen size and on Arctic for iPhone too
  (from its next build). A Spaced review still keeps at most 2 minutes per
  card.

**Touch, keyboard, trackpad and Pencil.** All of them count, as listed
above. An Apple Pencil's taps and strokes count like a finger's; its hover
counts from this change on.

**Split View and Stage Manager.** Reading in one window while you write in
another stops the clock until you come back to the reading window, because
that window has lost focus. Whether iPadOS Safari reports
the lost focus this way has not been checked on an iPad.

## Open questions

These would change what gets counted, so they are left for you to decide:

1. **A limit that grows with how much text is on screen.** Arctic and
   Spaced now allow 3 minutes everywhere (decided 28 October 2026). Their
   records keep no limit, so a visit counted with 2 minutes cannot be told
   from one counted with 3; totals from that day on run a little higher.
   Reader went the other way that day: 3 minutes on a phone and 5 on a
   tablet or computer, down from 10, so the same reading can now total less,
   most on a phone. Each Reader visit keeps its limit (older ones read as
   10 minutes), but the Sessions page and the reading time in a book's peek
   add all visits alike, so a week across the change can look shorter
   without less reading.
2. **Keep counting while the reading window sits beside another app**, for
   reading with notes open. Today that time stops until you come back to
   the reading window.
3. **Count a hovering mouse or trackpad pointer at all.** It counts today,
   as a sign that someone is at the screen, but a pointer can drift without
   any reading.
4. **Spaced's cap of 2 minutes per review.** With the 3-minute limit, a
   card looked at for 2.5 minutes without a touch now counts, but its
   review still keeps 2 minutes at most (`MAX_DURATION_PER_CARD_MS`).
