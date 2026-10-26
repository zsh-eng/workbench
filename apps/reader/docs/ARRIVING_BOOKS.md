# Arriving books

The moment a book you add comes into the Library, for one book and for
many at once. This is an experiment. It is off by default.

- **Try it in the Library:** Settings → Debug tools → Try on this device →
  Arriving books. Then add one EPUB file (the sheet) or several (the
  grid).
- **Compare the moments:** Settings → Debug tools → Design ideas → Arriving
  books (or the Debug lightbulb in the Library, which opens the newest
  topic). Each idea opens full screen at
  `/debug/ideas/arriving-books?look=<look>&state=<one|again|five|trouble>`.
  "One book: arrival sheet" and "Several books: raking light" are the two
  moments as they ship behind the switch. Develop, Ink in the grid, Calm
  and Reduced motion stay for comparison. The demo runs the real job queue,
  the real sheet and the real tiles on simulated imports, with
  public-domain covers.

## The two moments

- **One book** arrives in a sheet at the medium detent, over the Library.
  The cover is large and comes in as ink, then the title, the author and
  the number of chapters, then **Read now**.
- **Two or more books** arrive in the covers grid, each in its own place,
  under a raking light. There is no sheet.

### Why a sheet for one book

One book is a moment you watch, so it gets room: the cover as tall as the
medium detent allows, and words that a tile has no space for. On a
390 × 844 phone the cover is 195 × 292 (a grid tile is 169 × 254); on a
430 × 932 phone it is 227 × 341. On a 375 × 667 phone the detent leaves
only 130 × 195, smaller than a tile. A larger cover needs a taller detent. A sheet is
the right container and a full-screen overlay is not:

- The Library stays in view above the sheet, so you see where the book is
  going.
- It closes the way every phone sheet closes: a swipe down or a press
  above it. Closing early is never a loss.
- It does not navigate. The book is still one thing in one place: its
  place in the grid waits empty while the sheet shows it.

The sheet is modal: the Library behind it is inert until it closes. That is
the cost. It is small for one book, because the sheet closes in one
gesture and the book is on the shelf either way. For a batch it is too
much: you would wait in a modal for five imports, so a batch stays in the
grid.

### One book, step by step

| The import                                    | The sheet says         | The cover                                      | The words                                          |
| --------------------------------------------- | ---------------------- | ---------------------------------------------- | -------------------------------------------------- |
| File chosen                                   | Adding to your library | Paper, in the cover's place                    | The file name, muted                               |
| Saving (hash, store, duplicate check)         | Adding to your library | Paper                                          | The file name, muted                               |
| Reading (unzip, OPF, title, author, cover)    | Adding to your library | Paper until the cover is found                 | Title and author, as soon as they are read         |
| Preparing (cover decode, resize, WebP, write) | Adding to your library | Ink drops bloom down the cover, grey to colour | "16 chapters", once the table of contents is known |
| Ready                                         | In your library        | The plain cover                                | Read now becomes active                            |

- **Read now** opens the book in the Reader. It replaces the "Open book"
  toast action, which stays for the switch off.
- **Closing the sheet** sends the cover down to its place in the grid in
  460 ms, as a compositor transform. The place draws the book from the
  same arrival state. The flying cover stays until the place has painted
  the book (a frame on its canvas, or its images loaded; a second at
  most), and then fades over it in 160 ms. It never fades over a blank
  card.
- **Closing early** does the same while the book is still arriving: the
  place goes on drawing it in raking light from where the ink was, and it
  is on the shelf when it is ready.
- **The same book again** shows "Already in your library" with the copy
  you have, and Read now opens that copy. No place opens in the grid, and
  the Duplicate book dialog does not open.
- **A failure** shows "Couldn’t add this book", a faded empty cover and
  **Try again**. Closing the sheet does not fly an empty cover; the failed
  place in the grid shows Try again and Dismiss.
- **A slow step** names itself in the detail line after 2.5 s ("Reading
  the book…").
- With **Reduce Motion** the cover in the sheet uses the still look, and
  closing it does not fly: the sheet goes and the place draws the book.

## What the grid says

| The import                                    | What you see                                     | What it tells you          |
| --------------------------------------------- | ------------------------------------------------ | -------------------------- |
| Files chosen                                  | A place for each file, in order, as paper        | The app has your files     |
| Saving (hash, store, duplicate check)         | Paper; the caption is the file name              | Nothing yet to show        |
| Reading (unzip, OPF, title, author, cover)    | Paper; then the cover waits pale, in grey        | The cover is found         |
| Preparing (cover decode, resize, WebP, write) | Title and author; a low lamp crosses the cover   | The book is what you chose |
| Ready                                         | The plain cover in colour; the tile opens a book | You can read it            |

The drawing follows the real steps. Each step owns a part of the way:
saving 0–25 %, reading 25–55 %, preparing 55–100 %. Inside a long step the
drawing creeps, but never past 70 % of that step, so it does not claim work
that is not done. The import does not paginate the book, so nothing says
"laying out pages".

### Where silence is better

- No percent, no spinner, no step names. A step that takes more than 2.5 s
  shows its name under the cover ("Reading the book…"), so a slow book is
  not a frozen one.
- No toast for each book. One toast for a batch, when the last cover is at
  rest (4 s at most), with the same words as today. One book has the sheet
  and no toast.
- No navigation at the end. Read now is a choice, not a step. A batch
  leaves the Library free: you can scroll, search, or open a book while
  the others come in. A book you can open is a book on the shelf.
- No sound, no haptics, no repeating pulse. A finished cover is still.

## The looks

All shader looks start from paper, end on the plain cover, and hand over to
the Library's own image: the image shows at once under the drawing, and the
drawing fades over it in 200 ms, so the card never shows through. They differ in how the
black and white turns into the cover.

1. **Raking light (the grid).** The cover waits pale, in black and white.
   A low lamp crosses from the spine as the book is prepared and rises as
   it goes. In its pool the paper's surface stands up in a warm grazing
   light; behind it the colour is back. Chosen in review because it reads
   as light being turned on the book, which is the seed of the idea.
2. **Ink (the sheet).** Three drops fall near the top of the cover and
   bloom down into blotting paper in soft lobes, dark inks a little ahead,
   with a pale bleed and a faint tide line, then dry to the cover's
   colour. It is too busy for a grid of five, and right for one large
   cover that you watch.
3. **Develop (comparison).** A print in the developer tray: the image comes
   up through a fine silver grain, and the colour comes in over the black
   and white as it fixes. Calm, and the cheapest shader.

**Raking light on a flat cover.** In round one the slope came from the
cover's own ink, so on a printed cover the light embossed the picture: it
looked like an image filter. Now a cover without a hand-made depth map is
lit as what it is, a printed sheet:

- The slope comes from a fine paper tooth (two octaves of value noise at
  about one cycle a pixel), at 0.13 strength. It reads as grain under a
  low lamp, not as relief. A coarser, stronger tooth looked like hammered
  foil.
- A slow swell (fbm, ±9 %) keeps the lit band from being one flat tone.
- A narrow sheen runs just behind the lamp's edge. It is stronger on dark
  ink, the way a printed black catches a grazing light, and it fades as
  the lamp rises.
- With a living-cover scene the hand-made depth map is still the relief.

Two looks are not shaders:

- **Calm (CSS).** The black and white cover fades up when the book is read,
  and its colour fades up over it when it is ready. Opacity only, so the
  compositor does all of it. Weak devices and a lost context fall back to
  this, in the grid and in the sheet.
- **Still.** With Reduce Motion on: paper, then one short cross-fade to the
  cover when the book is ready. Nothing moves, in the grid or in the
  sheet.

**Not built: the spine sliding into a shelf.** The Library is a grid of
covers, not a shelf of spines. EPUBs have no spine art, so the spine would
be invented. A tile that slides in pushes its neighbours, and the rule for a
batch is that nothing moves.

## A batch

- All places appear at once, at the top of the covers grid, in the order
  the files were chosen. The places are held only where the books will
  stay: sort by Recently added, filter All or Want to read, no search.
  Anywhere else each book appears where it lands, and draws there.
- The imports run one at a time (the `import` lane holds one job), so the
  covers light in order, a wave down the grid. One import at a time also
  keeps the phone's main thread free for the drawing.
- Each book counts as added at `start − its place in the batch`. The final
  order is the order you chose, and a finished book takes the place it
  held. Nothing moves.
- Each book goes on the shelf as soon as it is ready, so you can open it
  before the batch ends. The places leave 5 s after the batch. A place the
  sheet still shows stays until the sheet lets it go.
- **A slow book** shows its step after 2.5 s. The books after it wait;
  their places stay.
- **A failure** keeps its place, faded, with "Couldn't add this file" and
  **Try again** and **Dismiss** on the empty cover. Try again runs the same
  job again. The place stays until you act.
- **A duplicate** in a batch keeps a faded place that says "Already in your
  library" and opens the copy you have. It leaves with the batch.
- A cover off screen keeps its place in time but is not drawn. When you
  scroll back it is where it would be.

## Performance

- One WebGL2 context for every arriving cover, on an `OffscreenCanvas`.
  Each tile has its own canvas with a `bitmaprenderer` context and takes
  its frame with `transferToImageBitmap`, without a copy. The page scrolls
  on the compositor, and menus and focus rings stay above the cover.
- One frame loop runs while something moves, and stops when all covers
  rest. The pixel ratio is at most 2.
- The pace: a cover takes at least 1.15 s from the moment its image is
  known to rest, under a critically damped spring (0.28 s). A frame step is
  at most 1/30 s, so a main-thread stall pauses the drawing instead of
  making it jump.
- The budget: if the median of the last 30 frames of the loop's own work is
  over 4 ms, the engine stops for the visit and every arrival draws the
  calm way. No WebGL2, or a lost context, does the same.
- The context is made and the program compiled while the first file is
  saved, in idle time, not in the frame that shows the first cover.
- The grid reads only where the places are. Each cover reads its own
  progress, so a step of one import re-renders one tile, not the shelf.
- One book can have more than one view: the sheet's cover, the flying
  cover and the grid place. The engine keeps one state for each book and
  advances it once a frame; each view keeps only what it last drew and
  whether it was told the book is at rest. So the ink in the sheet and the
  light in the grid show the same progress, and a place that appears after
  the book came to rest still settles.
- A book that finished while no view was on screen arrives at rest. A
  book the sheet shows counts as seen from its first frame, before the
  sheet's view reports that it is on screen, so its ink always plays.
- The sheet and the flight are a lazy chunk. With the switch on it loads
  when the file picker opens (or when a drop starts an import), so it is
  ready before the files are. A loaded chunk renders at once: `React.lazy`
  suspends on its first render even then, and React holds the fallback
  for up to 300 ms, which left a blank card under the landing cover. The
  flight is a WAAPI transform, so the compositor carries it through a
  main-thread stall, and while it flies it is the book's only drawing.
- An empty Library waits for its first book until that book settles on
  the shelf, not only until the import writes it, so "Your library is
  empty" does not come back while the Library reads its books.

### Measured

Chromium on an M1 Pro (Metal), production build, 390 × 844 at 3×, CPU
slowed with DevTools throttling. rAF runs at 120 Hz here (8.3 ms frames).
"Frame" is the time between frames on the main thread. "Engine" is the
arrival loop's own CPU time a frame. CPU throttling does not slow the GPU.

Round one, a real Library import of five books (two without a cover),
three runs each:

| CPU | Arrivals | Frame p95 | Frame p99 | Longest frame | Frames > 25 ms | Engine p95 | Engine max |
| --- | -------- | --------- | --------- | ------------- | -------------- | ---------- | ---------- |
| 1×  | off      | 9.1–9.9   | 33–50     | 33–50         | 1              | –          | –          |
| 1×  | on       | 9.5–9.7   | 10.2–10.3 | 50            | 1              | 0.2        | 0.2–0.3    |
| 4×  | off      | 15.5–16.1 | 41–43     | 182–191       | 3–5            | –          | –          |
| 4×  | on       | 10.1–10.3 | 25–35     | 168–234       | 4–6            | 0.8–0.9    | 1.2–2.1    |
| 6×  | off      | 25.9–26.2 | 68–92     | 275–292       | 9              | –          | –          |
| 6×  | on       | 16.8–17.6 | 51–57     | 325–333       | 11–13          | 1.3        | 2.0–2.1    |

With arrivals on, the run also holds the pace after the last import, so
its percentiles cover more calm frames than a run with arrivals off. The
longest frame is the same task in both: the first one after you choose the
files, where the first file is read and hashed. With arrivals on it also
draws five places: up to 45 ms more at 4×. The engine never went over budget.

Round one, Design ideas, five simulated books, so only the drawing costs:

| CPU | Look    | Frame p99 | Longest frame | Engine p95 | Engine max |
| --- | ------- | --------- | ------------- | ---------- | ---------- |
| 4×  | today   | 10.2      | 33            | –          | –          |
| 4×  | develop | 10.2      | 42            | 0.5        | 0.9        |
| 4×  | light   | 10.3      | 42            | 0.4        | 1.2        |
| 4×  | ink     | 10.3      | 50            | 0.4        | 1.0        |
| 4×  | calm    | 10.2      | 34            | –          | –          |
| 6×  | develop | 10.3      | 41            | 0.2        | 0.6        |
| 6×  | light   | 10.3      | 51            | 0.2        | 0.7        |
| 6×  | ink     | 10.3      | 52            | 0.3        | 1.6        |

The longest frame in each demo run is the Replay tap itself. Not measured:
the GPU on an iPhone. The worst case is four covers on screen at 2×, about
0.7 megapixels a frame of a short fragment shader; living covers draw more
than that on the same phones.

Round two, the same machine and build, 120 Hz rAF, two runs each (the
sheet after its cover grew to fill the detent; the batch three runs).
"Sheet arrival" is one real import into the sheet, from the press to rest.
"Closing flight" is the 460 ms flight and the fade. "Five in light" is the
real Library batch in raking light.

| CPU | Moment         | Frame p95 | Frame p99 | Longest frame             | Engine p95 | Engine max |
| --- | -------------- | --------- | --------- | ------------------------- | ---------- | ---------- |
| 1×  | Sheet arrival  | 10.0–10.1 | 10.3–16.5 | 15.5–16.7                 | 0.2        | 0.3–0.4    |
| 1×  | Closing flight | 9.9       | 10.1–10.2 | 10.2–10.3                 | 0.2        | 0.3–0.4    |
| 1×  | Five in light  | 9.8–9.9   | –         | 58–60 (the file read)     | 0.3–0.4    | 0.5–9.3    |
| 4×  | Sheet arrival  | 10.2–10.3 | 57        | 83–85 (the file read)     | 0.7–0.9    | 1.7–3.2    |
| 4×  | Closing flight | 10.0–10.1 | 10.4–15.5 | 16.4–33.6                 | 0.8–0.9    | 3.2–3.5    |
| 4×  | Five in light  | 10.2–16.4 | –         | about 225 (the file read) | 0.7–1.1    | 1.2–3.0    |
| 6×  | Sheet arrival  | 15.5–15.9 | 57–93     | 143–144 (the file read)   | 1.3–1.4    | 2.6–3.9    |
| 6×  | Closing flight | 10.2      | 43–60     | 51–82 (the release)       | 1.3–1.4    | 2.6–3.9    |
| 6×  | Five in light  | –         | –         | 358–377                   | 1.3–1.5    | 2.7–5.1    |

The engine never fell back to calm. The longest frames are the first file
read and hash, as in round one, not the drawing. The 9.3 ms engine maximum
at 1× is one frame in one run, most likely a first texture upload; the
other runs stayed near 0.5 ms, and the median is far under the 4 ms
budget. At 6× the flight's longest frame is one task when the press is
released; the flight itself does not stop, because it is a compositor
transform.

## Known issues

- **A small book can be ready before the sheet is up.** The sheet's code
  now loads when the file picker opens, and the book is the sheet's from
  the first frame, so the ink still plays (at its minimum pace) and the
  grid never draws the cover first. But at 4× CPU a 200 KB EPUB is ready
  within about 0.3 s, so the sheet comes up already saying "In your
  library" while the ink finishes. That is true, and Read now works at
  once.
- **The activity glyph** still says "downloading" while a book is
  imported. Its words belong to background activity.

## The first attempt, and what it taught

A prototype from April (`BookArrivalPrototype.tsx`, in an old stash) put
the arrival on a fixed 2.65 s timeline, in a modal ceremony. It was ugly
and slow because:

- The timeline had no tie to the import. It finished on time whether or
  not the book was ready, so it lied in both directions.
- It animated paint: a scan line moving with `top`, `clip-path` wipes, and
  `filter: blur()` and `grayscale()` changing every frame.
- It stacked full-screen `backdrop-blur` layers and blurred and scaled the
  whole Library under them, with `transition-all`.
- The book moved between three containers (a sheet, the centre, a drawer)
  with shared-layout animation, so it lost its identity on the way.
- It blocked the Library: a ceremony in the centre, then a "Start reading"
  drawer.
- It added decoration: sparkle icons, uppercase tracking, heavy shadows,
  pulse rings, and a fake shelf of copies. There was no real shader.

This version keeps each book in one place from the first frame, draws only
inside that place, follows the real work, and stops when it is done.

## Code

- `src/lib/book-service.ts`: `addBookFromFile(file, { onStep, dateAdded })`
  reports the steps.
- `src/lib/book-arrivals.ts`: the `book-import` job kind and
  `ArrivalRecords`, which keeps what an import finds (file id, title,
  author, cover, outcome). A job carries only its state and phase.
- `src/lib/background-activity.ts`: the app's activity manager runs
  `book-import` jobs in the `import` lane beside `book-download`.
  `importBooks(files)` starts a batch.
- `src/features/arrivals/`: the store that joins records and jobs, the
  tiles, the covers, the engine and shaders, and the Design ideas demo.
- `src/features/arrivals/ArrivalSheet.tsx`: the one-book sheet, Read now
  and the flight to the grid. `ArrivalRecords.present(key)` keeps a book's
  grid place empty, and alive after its batch, while the sheet shows it.
- `src/features/library/use-epub-import.ts`: with the switch on, an import
  goes through `importBooks`, and one file opens the arrival sheet; with it
  off, nothing changed.

### Feeding it from background activity

An arrival is a job of the app's `activity` manager, so anything that reads
the queue sees it: the activity sheet shows "Saving", "Reading" and
"Preparing" from the job's phase. The Library reads the same queue through
`ArrivalFeed` (`activity.subscribe` and `activity.getSnapshot`), joined by
the job id with its record. Try again and Dismiss call `activity.retry` and
`activity.dismiss`. A demo passes its own manager and records to
`ArrivalProvider`. To show another kind of work with the same look, give
the job a phase for each step and a record for what the drawing needs.
