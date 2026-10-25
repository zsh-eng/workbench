# Arriving books

The moment a book you add comes into the Library, for one book and for
many at once. This is an experiment. It is off by default.

- **Compare the looks:** Settings → Debug tools → Design ideas → Arriving
  books. Each look opens full screen at
  `/debug/ideas/arriving-books?look=<look>&state=<one|five|trouble>`. The
  demo runs the real job queue and the real tiles on simulated imports,
  with public-domain covers.
- **Try it in the Library:** Settings → Debug tools → Try on this device →
  Arriving books. Then add one or more EPUB files.

## What the moment says

| The import                                    | What you see                                     | What it tells you          |
| --------------------------------------------- | ------------------------------------------------ | -------------------------- |
| Files chosen                                  | A place for each file, in order, as paper        | The app has your files     |
| Saving (hash, store, duplicate check)         | Paper; the caption is the file name              | Nothing yet to show        |
| Reading (unzip, OPF, title, author, cover)    | Paper, until the reading finds the cover         | Nothing yet to show        |
| Preparing (cover decode, resize, WebP, write) | Title and author; the cover develops, grey first | The book is what you chose |
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
- No toast for each book. One toast for the batch, when the last cover is
  at rest (4 s at most), with the same words as today.
- No modal and no navigation at the end. The Library opens when you choose
  the files; you can scroll, search, or open a book while the others come
  in. A book you can open is a book on the shelf.
- No sound, no haptics, no repeating pulse. A finished cover is still.

## The looks

All three shader looks start from paper, end on the plain cover, and hand
over to the Library's own image in a 200 ms cross-fade. They differ in how
the black and white turns into the cover.

1. **Develop (recommended).** A print in the developer tray. The image
   comes up from the paper through a fine silver grain: shadows first on
   light paper, highlights first on dark paper. In the second half of
   preparing the colour comes in over the black and white, and the grain
   goes as it fixes. It is the seed ("a black and white cover that lights
   up") done as chemistry instead of a light sweeping across. It is calm,
   it reads as progress, and it is the cheapest shader.
2. **Raking light.** The cover waits pale, in black and white. A low lamp
   crosses from the spine as the book is prepared and rises as it goes. In
   its pool the relief stands up in a warm grazing light; behind it the
   colour is back. With a living-cover scene the relief is the hand-made
   depth map; without one it is the ink, softened. It feels tactile and
   ties to living covers, but on a flat cover the estimated relief can look
   like an emboss filter, and it reads five texture samples a pixel.
3. **Ink.** Three drops fall near the top of the cover and bloom down into
   blotting paper in soft lobes, dark inks a little ahead, with a pale bleed
   and a faint tide line, then dry to the cover's colour. It is the most
   playful, and the most decorative: on a busy cover it can look blotchy.

Two looks are not shaders:

- **Calm (CSS).** The black and white cover fades up when the book is read,
  and its colour fades up over it when it is ready. Opacity only, so the
  compositor does all of it. Weak devices and a lost context fall back to
  this.
- **Still.** With Reduce Motion on: paper, then one short cross-fade to the
  cover when the book is ready. Nothing moves.

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
  covers develop in order, a wave down the grid. One import at a time also
  keeps the phone's main thread free for the drawing.
- Each book counts as added at `start − its place in the batch`. The final
  order is the order you chose, and a finished book takes the place it
  held. Nothing moves.
- Each book goes on the shelf as soon as it is ready, so you can open it
  before the batch ends. The places leave 5 s after the batch.
- **A slow book** shows its step after 2.5 s. The books after it wait;
  their places stay.
- **A failure** keeps its place, faded, with "Couldn't add this file" and
  **Try again** and **Dismiss** on the empty cover. Try again runs the same
  job again. The place stays until you act.
- **A duplicate** keeps a faded place that says "Already in your library"
  and opens the copy you have. It leaves with the batch. A single duplicate
  file also opens the Duplicate book dialog, as today.
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

### Measured

Chromium on an M1 Pro (Metal), production build, 390 × 844 at 3×, CPU
slowed with DevTools throttling. rAF runs at 120 Hz here (8.3 ms frames).
"Frame" is the time between frames on the main thread. "Engine" is the
arrival loop's own CPU time a frame. CPU throttling does not slow the GPU.

Real Library import of five books (two without a cover), three runs each:

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

Design ideas, five simulated books, so only the drawing costs:

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
- `src/features/library/use-epub-import.ts`: with the switch on, an import
  goes through `importBooks`; with it off, nothing changed.

### Feeding it from background activity

An arrival is a job of the app's `activity` manager, so anything that reads
the queue sees it: the activity sheet shows "Saving", "Reading" and
"Preparing" from the job's phase. The Library reads the same queue through
`ArrivalFeed` (`activity.subscribe` and `activity.getSnapshot`), joined by
the job id with its record. Try again and Dismiss call `activity.retry` and
`activity.dismiss`. A demo passes its own manager and records to
`ArrivalProvider`. To show another kind of work with the same look, give
the job a phase for each step and a record for what the drawing needs.
