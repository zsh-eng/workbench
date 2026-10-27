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
seconds, then scroll again at 4 minutes. The estimate is 75 seconds. The
2 minutes 45 seconds before the last scroll were too long, so none of it
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

| Timing                                   | Value                                   | Why                                                                                                                        |
| ---------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Longest quiet stretch, Arctic and Spaced | 2 minutes                               | You scroll an article every so often. A longer silence more likely means the page was left open.                           |
| Longest quiet stretch, Reader            | 10 minutes                              | A book's page can take minutes to read without touching anything, so Reader waits longer before it decides you stopped.    |
| Scroll after an input                    | 1 second                                | Long enough for a flick's glide to count, short enough that the app's own scrolling does not.                              |
| Saving                                   | every 5 seconds, and at once on a pause | Little is lost if the browser closes, without writing on every scroll.                                                     |
| "Articles read" this week (Arctic)       | 1 minute in total                       | An article counts as read once its visits in the last seven days add up to a minute. Shorter visits still add to the time. |

The result is an estimate. It undercounts a long, still read (a quiet
stretch past the limit counts as nothing) and never counts time with the
page put away.

## On an iPad

**Bigger screens.** An iPad shows more text at once, so you touch it less
often while reading.

- Reader's 10 minutes is ample: even a two-page spread in landscape takes a
  few minutes to read.
- Arctic's and Spaced's 2 minutes is tight on an iPad. A full screen of an
  article in portrait can take about two minutes to read, and if you read
  it without touching the screen, that whole stretch is lost. This has not
  been changed; see the open questions below.

**Touch, keyboard, trackpad and Pencil.** All of them count, as listed
above. An Apple Pencil's taps and strokes count like a finger's; its hover
counts from this change on.

**Split View and Stage Manager.** Reading in one window while you write in
another stops the clock until you come back to the reading window, because
that window has lost focus. Whether iPadOS Safari reports
the lost focus this way has not been checked on an iPad.

## Open questions

These would change what gets counted, so they are left for you to decide:

1. **A longer limit for Arctic and Spaced on large screens**, such as 3 or
   4 minutes when the window is iPad-sized, or a limit that grows with how
   much text is on screen. Each visit records its limit, so old and new
   visits stay comparable in the records, but totals would rise.
2. **Keep counting while the reading window sits beside another app**, for
   reading with notes open. Today that time stops until you come back to
   the reading window.
3. **Count a hovering mouse or trackpad pointer at all.** It counts today,
   as a sign that someone is at the screen, but a pointer can drift without
   any reading.
