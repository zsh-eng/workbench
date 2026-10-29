# Background activity: what shows, and when

This page is the product model. [STATES.md](STATES.md) is the state chart
and the checked rules. The [README](../README.md) is the API.

## What counts

Background activity is work that the app does on its own time, that changes
what this device has or what the server has, and that you do not watch on
screen while it happens.

| Activity    | Examples                                                                                  | Owner                  |
| ----------- | ----------------------------------------------------------------------------------------- | ---------------------- |
| Record sync | a pull and push every 30 s, on reconnect and after an edit; the first restore on a device | `@zsh-eng/local-sync`  |
| Downloads   | a book's EPUB, covers, Spaced card images, "download all images"                          | the app, as a job here |
| Uploads     | a book or cover that you imported, waiting for the server                                 | the app's file manager |
| Preparation | unzipping and indexing a book after its download                                          | the app, in the job    |
| Imports     | a file you chose becoming a book: saving, reading, making the cover                       | the app, as a job here |
| App update  | the new version's files, then the switch to them                                          | the service worker     |

Pagination, search and saving a highlight are not background activity. They
answer something you just did, and they have their own feedback.

## The rule: show it only when it earns its place

Most activity stays silent. Show a piece of work only when one of these is
true:

1. **You asked for it.** You tapped Download, Download all images, or
   Restart. It shows on the thing you asked about, from start to end, and it
   confirms once.
2. **You are waiting for it.** You opened a book that is not on this device,
   or a new device has an empty library until the restore arrives.
3. **Your work is not safe yet, and that matters now.** Changes are saved
   only on this device because you are offline, signed out, or sync keeps
   failing, and that has lasted long enough to matter.
4. **It needs you.** It failed and cannot fix itself: it needs a sign-in,
   storage is full, or the server refused the file. A file that could not
   be added says so on its own place in the Library, with Try again, so
   the glyph does not raise it again.
5. **Something new is possible.** An update is ready, or a book that you
   asked for is now on this device.

Silence is right when:

- **The work is routine and ends by itself.** Periodic sync, a cover, an
  upload that succeeds, a retry that recovers.
- **The work is short.** Nothing shows for the first 0.5 s, and a thing that
  shows stays at least 0.6 s, so nothing flickers.
- **You are reading.** The open page never shows background activity. Work
  that needs you waits until you leave the book, except a failure of the
  book itself.
- **The failure is a blip.** One dropped request is not news. Sync raises
  attention after two failures in a row; a job retries before it says
  "Couldn't download".

## The states you can see

A job is one subject: a book, "all images", or the update. Its states, in
the words the app uses:

| State       | What you see                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Queued      | The subject is dim and still: it is next.                                                                                          |
| Downloading | The subject fills. Bytes when known ("2.1 of 4.6 MB"), else items ("12 of 140 images"). An unknown size shows a slow sweep.        |
| Preparing   | Full, with the short local step named once ("Preparing").                                                                          |
| Waiting     | The fill holds where it is, with the reason: "Waiting for a connection", "Waiting for you to leave the book", "Sign in to finish". |
| Retrying    | Shown as Downloading. Only the activity sheet says "Retrying in 8 s".                                                              |
| Couldn't    | The subject has a retry mark. The sheet says why in words, with Retry.                                                             |
| Done        | The fill completes, a check draws once, and the subject goes back to rest.                                                         |
| Cancelled   | The subject goes back to rest at once.                                                                                             |

Sync is not a job that you start, so it shows only its exceptions:

| Sync state                         | What you see                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Synced, syncing                    | Nothing.                                                                                                                               |
| Restoring on a new device          | The island at the top centre says the stage, and folds into the app's mark when near: Spaced's icon, Reader's glyph, Arctic's account. |
| Offline, changes waiting           | One tick on each changed thing, as Telegram's sent tick. The second tick draws when it syncs.                                          |
| Signed out or ended, changes saved | "3 changes are only on this device. Sign in to keep them."                                                                             |
| Failing twice or more              | The account menu's existing words ("Couldn't reach the server · Retrying in 8 s").                                                     |

The update has its own small moment:

| Update state | What you see                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checking     | Nothing.                                                                                                                                          |
| Downloading  | Only in the activity sheet: "Downloading the update · 1.2 of 3.4 MB".                                                                             |
| Ready        | On the Library only: "Restart to update", in the header, or floating at the bottom on a phone. It also applies by itself at the next safe moment. |
| Restarting   | The same chip becomes a short ring, and the app reloads to the same screen.                                                                       |
| Updated      | After the reload, the chip's place shows a check and "Updated" for two seconds.                                                                   |

## One subject, one element

- A book's download is its cover. The same cover goes from rest to dim
  (queued) to filling, draws its check, and rests again. There is no toast
  and no second progress bar for it. A summary that counts many books, such
  as "3 books · 41%", is a different subject: the downloads together.
- "Download all images" is one row in Spaced, on the Images page and in the
  floating pill elsewhere. Where the page shows the row, the pill steps
  aside: one floating surface per place.
- The update is one chip, from Ready to the ring. "Updated" after the reload
  takes the chip's place.
- In the activity sheet, each book's row carries its cover. The sheet
  covers the shelf, so the row's cover is the only picture of that book on
  screen, not a second one.

## Nothing moves while you look

Rows that jump as work finishes are the usual failure of an activity list.
The sheet follows what App Store updates, Safari's downloads, Music and
Podcasts do:

1. **A row finishes where it is.** Its ring becomes a check and its words
   change ("On this device"). It does not move while the sheet is open,
   and a finished download stays after the queue forgets it.
2. **Sections regroup only when the sheet opens.** Each opening files the
   rows under Now, Waiting, Couldn't finish, Done and This app, each in the
   order the work began. While it is open, a row keeps its section.
3. **Moves happen together, on one spring.** New work joins the end of its
   section, and a row you cancel or dismiss leaves. Every row that changes
   in one update opens or closes its height on the same spring
   (UITableView's, response 0.30 s), never one jump per row.
4. **Fixed sizes.** Every row is 56 px tall whatever it says (a This app
   row 72 px, its words in up to two lines), its actions have one width,
   and numbers use tabular figures, so changing sizes and counts do not
   jiggle the words.
5. **The sheet holds its height.** It fits its rows by the shared sheet
   rules (packages/elements/docs/MOTION.md, "Sheet behaviour"): it follows
   a row that joins, holds while one leaves, and settles once.

A routine sync pass never appears in the sheet, so it cannot add and remove
a row every 30 s. The Library's "On this device" filter follows rules 1
and 2: while you look at it, a book that finishes downloading does not push in
between the covers; the filter takes it in when you choose it again or come
back to the app.

## A safe moment for an update

An update downloads in the background and waits. The page keeps the version
it loaded until the switch, and the waiting service worker keeps that
version's files, so nothing breaks while it waits.

- **Never on the Reader.** Nothing reloads a book that is open.
- **By itself:** when the app comes back to the front on any other screen
  after two minutes or more away, with no download that you asked for in
  progress. (An import should hold it too; that is not wired yet.) A fresh
  launch also gets the new version,
  because the browser switches when no page uses the old one.
- **By a tap:** Restart on the chip or in the activity sheet. A download in
  progress continues after the reload.
- **Required updates:** when sync says "Update to keep syncing" (410), its
  Reload applies the waiting update.

Spaced uses the same engine with its own moments
(`apps/spaced2/src/lib/update-policy.ts`): never while a card is on the
review screen, a dialog is open, an import is under way or "Download all
images" runs; by itself at a launch before your first tap, or when you come
back after two minutes away; and at once on a tap of "Restart to update", a
pill above the tab bar that a review hides. "Updated" is a toast.

## Critique of the starting points

- **An island with mini covers** is strong for one to three downloads while
  you browse. But the mini cover is a second element for a subject that the
  grid already shows, unless the cover flies into the island, and that is
  a lot of motion for a download. Many downloads make it noisy, and in the
  Reader it would compete with the notes island. Tried and dropped.
- **A cover that fills** keeps identity best: the subject is the element. It
  cannot show a subject that is off screen, or work with no cover (sync,
  images, the update), so it needs a summary somewhere.
- **A quiet glyph that opens a sheet** covers every case honestly, and the
  sheet is where details such as "Retrying in 8 s" belong. Its risk is a
  permanent status badge that everyone learns to ignore. The rule: the glyph
  shows only while work you asked for runs, or while something needs you.
- **The update as its own moment** is right: a reload is a product event.
  "What's new" is not needed for a one-person app; "Updated" is the closure.
- **An island for the restore** is the exception: the one sync state you
  wait for. It floats at the top centre, says the stage and its share when
  known ("Restoring history 42%"), confirms "Restored" and folds into the
  app's own mark when it is near (`./island`; Spaced's
  apps/spaced2/docs/FIRST_REVIEW.md, "The restore island"). Reader and
  Arctic use it too (`restoreIsland`).
- **A Dynamic Island for every sync** is the boring version. A spinner on
  each 30 s sync is noise, and noise trains people to ignore the one state
  that matters (your changes are only here).

Beyond the starting points:

- **Ticks for work that is only here.** Telegram's message ticks: one tick
  when saved on this device, two when synced. Show them only while sync is
  held up (offline, signed out, failing), on the things you changed.
- **The offline shelf.** Offline, books that are not on this device fade,
  and the ones you can open stay bright: "Offline · 6 books on this device".
- **The restore is the Library arriving.** On a new device, covers arrive
  as their records do, with a count, instead of a spinner over an empty page.

## Directions to try

Design ideas → Background activity shows the directions with the same
scenarios, on the real engine with simulated jobs:

1. **On the covers.** Progress lives on the subject; ticks for waiting work;
   the offline shelf; the update chip.
2. **A glyph and a sheet.** A glyph beside the account button that shows
   only when it has something to say; tap for the activity sheet: Now,
   Waiting, Couldn't finish, Done, and This app.
3. **Covers and a sheet.** 1 with 2, the choice: progress on the subject,
   and the glyph and sheet for what has no subject on screen.

An island for downloads was a fourth direction, dropped (see the critique); the restore's island is another matter. The Library
wires the choice. The glyph and its sheet show for everyone. Sync does not
raise the glyph: a restore has the island, which folds into a near glyph,
and what sync needs from you (a sign-in, two failures in a row) has the
account menu; the sheet lists it under This app. Books that download for offline, and their covers, stay behind
Debug → Offline downloads. A phone's header is full with the places, so
there the glyph sits in the filter row beside Sort and layout, where
Download all starts, and the update chip floats at the bottom of the
Library. The glyph goes first among the buttons of its row (before Search,
with room), so they keep their places when it comes and goes.
