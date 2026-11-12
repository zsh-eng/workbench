# One model under the panes (November 2026)

In November 2026 an exploration rebuilt Med as one page for each thread, on a
new store. The page was dropped: the panes stay. The model was kept. This
note says what the model is, how the code says it now, and what is still
open.

## The exploration

Branch `claude/med-one` holds it: a core with one SQLite journal and one
table of commands (`src/core`), and a window at `/one` that shows a thread as
a chat with its versions inline. It is not on `main`.

What it showed:

- A chat-first page is the wrong shape for Med. Med is review-first: the diff
  is the content and the session is beside it
  ([Claude desktop](claude-desktop.md), section 3, said this already).
- The page had no pull requests, no file views, no search, and no instant
  send. Each is part of daily use.
- The model under it was simpler than what the panes had, and that part was
  right.

## The model

The owner's words:

> Session thread can just list multiple reviews - each review has its own
> checkout or diff that it's projecting. Switching reviews switches. Changes
> is just that particular branch that we're based in. Multiple pull requests
> can be referenced in a single session thread just like multiple reviews can
> be.

| Noun         | What it is                                                                          |
| ------------ | ----------------------------------------------------------------------------------- |
| Thread       | A session, with its reviews. One row in the sidebar.                                |
| Review       | A captured change, the place that it projects, and its pull request, if it has one. |
| Place        | A repository, a checkout, its branch, and the base that the review names.           |
| Pull request | A review whose change is a pull request's. A thread can have several.               |

A thread shows one review at a time. That review's place is the place of
every pane: Review, Changes, Commit, search, and the files. Changes is not a
thing that Med stores; it is that checkout's branch since its base.

## How the code says it

- `ThreadReview` in [`src/shared/threads.ts`](../../src/shared/threads.ts):
  a review with its `place` and its `pullRequest`. The host builds it in
  [`src/host/thread-service.ts`](../../src/host/thread-service.ts).
- [`src/web/data/review-place.ts`](../../src/web/data/review-place.ts):
  `liveReviewCheckout` and `reviewChanges` give the checkout and the base
  that Changes uses for the review on screen.
- The stores did not change: `threads.json` and `reviews/*.json`. A review
  joins its thread through its session.

## What changed for the reader

- **Changes follow the review on screen.** Before, Changes went back to the
  session's checkout.
- **A thread names each review's pull request**, not only the newest one.
- **Add a pull request…** (`⌘K`, or `med thread pr`) adds a pull request to an
  open thread as one more review.
- **The review's name lists the thread's reviews.** A caret after the name
  opens the list. It shows only when the thread has more than one review, and
  it is there when the window is too narrow for the session's rail.
- **A code block in a reply has Copy**, on hover and on focus.

## Claude desktop, and what Med takes from it

The quality to copy is restraint: a control is there when you reach for it
and absent otherwise, and each state is said once, in words, where you look.

| Claude desktop                             | Med                                                           |
| ------------------------------------------ | ------------------------------------------------------------- |
| Copy on a code block, on hover             | Added. The table's copy button and the code's are one family. |
| The session's title has a caret and a menu | The review's name has a caret when there is a choice to make. |
| Panes open when asked for                  | Already so: a thread opens with its session alone.            |
| Tool calls fold to one line                | Already so: "Worked for 14 min · 4 tool calls".               |
| A stack of filled cards, a reaction row    | Not copied.                                                   |

Med keeps its own type (Geist and Paper Mono), comments in the files at
their lines with a reply that goes to the agent at once, and Vim movement in
files. The pass added no bar, no label, and no always-visible control.

## Open

- **The store.** The journal of `claude/med-one` is not under the panes. A
  move needs care in five places: a thread's ID is a session key or a review
  ID and names files and routes; a review joins a thread through its session,
  not through a stored link; a review switch depends on captured patches;
  "sent" is matched across two comment stores; and a thread's row and its
  attention use clocks, not event numbers.
- **A pull request's own base.** Med does not store it, so a stacked pull
  request shows Changes since the repository's base.
- **A pull request's state** shows after Med has read that pull request in
  this run of the host. Before that, the number alone.
- **A thread's change count** in the sidebar uses the session's base, not the
  review's.
