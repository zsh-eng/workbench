# Med site

The marketing page and docs for [Med](../med/README.md): static HTML pages
with inline CSS and one small script. There is no UI framework and no
third-party request. On wide screens each window on the page runs Med itself
on a recorded review (see [Live demo](#live-demo)). The docs pages render Med's
own guides (see [Docs](#docs)).

## Commands

Run these from `apps/med-site`. Install dependencies from the Workbench root
with `bun install`.

```sh
bun run dev        # http://127.0.0.1:4320, renders src/ on each request
bun run build      # writes dist/ and prints the page weight
bun run preview    # serves dist/ on http://127.0.0.1:4320
bun run test       # builds, then runs the Playwright checks on dist/
bun run demo       # builds the live demo into .demo/, for `bun run dev`
bun run paint      # paints the picture behind the product window
```

## Where things are

- `src/site.ts`: the install command, the agent prompt, the requirements line,
  and the links. Change provisional strings here only.
- `src/index.html`, `src/styles.css`, `src/main.js`: the page, the install tabs,
  the copy buttons, and the live demo. The build inlines the CSS and the
  script. `scripts/render.ts` describes the template syntax.
- `src/partials/`: the head, header, and footer that every page includes.
- `src/docs.html`, `src/docs.css`, `scripts/docs.ts`: the docs pages.
- `src/try.js`, `src/try.css`: the prototypes in the docs.
- `src/shots.ts`: alt text and layout sizes for the screenshots.
- `scripts/painting/paint.ts`: the painting (see [Brand](#brand)).
- `public/`: files served as they are. The build gives fonts, screenshots, and
  the painting content hashes under `/assets/`. `public/demo` holds the live
  demo's recordings: `hero.json`, `recording.json`, and `vault.json`.

## Docs

`/docs` and its pages render Med's user guides from `apps/med/docs` at build
time: `INSTALL.md` at `/docs`, then `USAGE.md`, `AGENT_INTEGRATION.md`, and
`VAULTS.md` at `/docs/usage`, `/docs/agents`, and `/docs/vaults`. These are the
guides that `med docs` prints, so the website and the app agree; edit the
Markdown in `apps/med/docs`, not here. `scripts/docs.ts` lists the pages and
their sidebar labels.

The build uses Med's Markdown packages (unified, remark, and rehype, at Med's
versions); the pages ship HTML only. Headings get GitHub's anchors, so links
between the guides keep working: a link to another guide opens its page, and a
link to any other file goes to GitHub. The build fails when a link between the
guides names a missing section. An image in a guide gets a hashed URL.

A docs page has the pages at the left, the guide in a reading column, and its
sections at the right on screens 1200 px or wider. Narrow screens show the
pages as a row above the guide. There is no search. The pages use the site's
`styles.css` and `main.js` (for the copy buttons on code), with `docs.css`.

Some sections have a prototype to try: Notes and the Commit tab in Using Med,
and a comment's trip to the agent in Agent reviews. They are Med's parts at
low fidelity, drawn by `src/try.js` in Med's colours, with scripted data and a
scripted agent. Keys work while a prototype has focus, and each key is also a
button for touch screens. `scripts/docs.ts` places each one after the first
paragraph of its section, on the website only; the pages without one do not
load its script. Keep a prototype's keys and labels the same as Med's, and
change it when the section changes.

Every page asks the browser to load another page while the pointer rests on
its link (speculation rules in `src/partials/head.html`); browsers without
them get a prefetch hint from `src/main.js`.

## Fonts

`public/fonts` holds Latin subsets of Med's Geist and Paper Mono, with their
SIL Open Font License notices. After Med's fonts change, run `bun run fonts`.

## Screenshots

`bun run screenshots` builds a small invented repository ("Trailhead"), starts a
built Med on port 4310 with temporary state, creates the review "Search filters"
with a brief, and comments on the first changed file. A fixture Claude Code
transcript (`scripts/screenshots/session.ts`) stands in for the agent, and Med
shows it in the Session pane.

Then the run records the hero, live: the reviewer types a short message and
sends it with the comment. The fixture agent's next round runs in real time:
it thinks, edits three files one at a time, runs the tests, and hands over the
second iteration. Med follows it there, and the run opens the changed files.
Every API answer and stream chunk goes to `public/demo/hero.json` with its time
from the message. After that, the run adds a second comment, opens the Commit
tab and the commit dialog, and opens a small Obsidian vault
(`scripts/screenshots/vault.ts`) on a second Med server, on the next port. It
records those answers into `public/demo/recording.json` and
`public/demo/vault.json`. It also records the vault note's Mermaid diagram as
Med draws it in Med Dawn and Med Night, into `vault.json`. Then it builds the
live demo, serves it on the
port after the vault's, and captures each scene of the demo (see
[Live demo](#live-demo)) in Med's own Med Dawn and Med Night themes. So each
screenshot shows what the live window shows. Each feature also gets a capture
at 390 px for phones, where Med lays its part out again for the narrow
window. It writes AVIF and WebP files to
`public/screenshots` and their sizes to `src/screenshots.json`. It never reads
your repositories, Git identity, or Med state, and it fails if a local path is
on screen or in a recording. `--demo` records only, without captures.
`--shots` captures only, from the recordings in `public/demo`: use it when
Med's interface changes but its API answers do not.

```sh
MED_CLI=/path/to/workbench/apps/med/dist/cli.js bun run screenshots
MED_CLI=/path/to/workbench/apps/med/dist/cli.js bun run screenshots --demo
bun run screenshots --shots
```

Set `MED_PORT` to use another port (never 6330, the Med service, nor the two
ports before it). Set
`SCREENSHOT_PNGS` to a directory to keep the full-size PNG captures.

## Brand

The page is paper and ink, with a narrow column of text. Its palette is Med's
own Med Dawn and Med Night themes (`apps/med/src/web/themes.ts`): the sea for
what you act on, and the dawn's peach for selection. The only other colour is
a painting: the Mediterranean sun rising over the sea, with its reflection on
the water, and the moon in dark mode. The product window rises from it.

The painting is a watercolour. Med's `scripts/painting/watercolor.js` lays
washes of pigment on textured paper in a browser canvas: wet washes run
together, edges dry darker, overlaps deepen, and paper left bare is the light.
`watercolor-scenes.js` paints the sea after two painters: the dawn after
Turner's wide wet washes, and the night after Cézanne's flat strokes, with the
moonlight lifted out. The random numbers are seeded, so each run paints the
same picture. `bun run paint` (`scripts/painting/paint.ts`) paints at 3600 px
and writes `public/painting` in AVIF (quality 64) and WebP at 1200 and 2400
px.

Med's icon, Reflection, comes from `apps/med/scripts/render-icons.mjs`: a paper
sun and its reflection on a tile of the same sea, painted in bristle strokes
(`painter.js`, `scenes.js`), dawn in a light scheme and moonrise in a dark one.
The favicon carries both. After it changes,
copy its `icon.svg` to `public/favicon.svg`, and its `icon-dawn.svg`,
`icon-night.svg`, and `apple-touch-icon.png` to `public/`. The header holds
both icons in the page (`{{inline:…}}`) and shows one with the system's colour
scheme, as the screenshots do. As images, their painted tiles loaded after the
page's first frame, so the icon could flash between pages. The wordmark is
drawn strokes in `src/partials/header.html`. The agent marks in the install card come from
Simple Icons (CC0); Codex and OpenCode have no free mark, so a glyph stands in.

On screens narrower than 960 px, the product window shows the screenshot at
3.6 times the window's width, so the text is legible, one part at a time: the
comment, the agent's session, and the history. Buttons under the window pick a
part, and a swipe on the window moves to the next or previous one. While the
window is in view, it moves to the next part every few seconds until the
visitor picks one; with reduced motion it waits. The review's 2880 px files
serve this zoom on phones.

## Live demo

Each window on the page runs Med's real web app (`apps/med/src/web/demo.ts`)
on a recording instead of a server. In the demo, reads replay the recording,
event streams stay open, and the clock starts at the time of the recording.
A small in-memory backend takes the writes that a visitor can see: comments,
pins, Clear, messages to the agent, staging, commit, and push. They change the
demo until the page reloads. Other writes succeed and change nothing. The build
compiles the app with `apps/med/vite.demo.config.ts` into `dist/demo/`.

A window names its scene in `data-demo`: `/demo/demo?scene=review` for the
product window, and `brief`, `comment`, `session`, `commit`, and `notes` for
the features. The scene sets the panes, opens the tab or note, scrolls to the
comment, and then marks the page ready. The `review` scene replays `hero.json`,
the `notes` scene replays `vault.json`, and the others replay `recording.json`.

The product window shows Med in zen mode: the thread in the sidebar, the
agent's session, and the diff with the comment, without other bars and
buttons. The demo makes the thread list from the recorded review and the
agent's recorded state. It renders at 1309 by 818, so its text is 10% larger
than in a 1440 by 900 window. When most of the window is in view, the demo
starts the hero's clock, types the message, and sends it. The agent's edits
stream in, and when it answers, the demo opens the edited search bar from the
agent's citation. A feature's part fills its window over the rest of Med; on a
phone, Med shows one pane, so the `session` scene chooses the session pane. In the
`commit` scene, the demo stages the remaining files, commits, and pushes,
slowly enough to follow. That window renders at 760 px, because Med's Commit
tab stacks its columns below 720 px. A live window has a button that starts
its scene again: Replay in the hero's title bar and under the commit window,
Reset under the others. The new scene loads behind the old one and fades in
when it is ready.

The demo build does not include Mermaid. `vite.demo.config.ts` points
`mermaid` at `apps/med/src/web/demo-diagrams.ts`, which returns the recorded
drawings. A diagram that a visitor edits shows its source.

A feature's scene shows only its part:
the brief, a short unified diff with the comment, the agent's session, the
commit dialog, or the note beside its preview. The part fills the window, and
the rest of Med runs under it, so the part works as it does in the app. When
the visitor opens something outside the part, the whole app shows.

The demos on a page do not affect each other. Each one keeps its own storage,
opens its event streams directly (the recording keeps each stream by its path,
not as a channel of Med's shared live stream), and highlights in one worker.

`src/main.js` runs the demo only on screens 960 px or wider, and not with
Save-Data. After the page loads, it opens each window's scene as the window
comes near the view: one at a time, the nearest to the middle of the view
first, when the browser is idle. It shows the scene over the screenshot when
the scene is ready, so the page does not move. A window out of view pauses its
demo's animations, which otherwise take work on every frame. Smaller screens
keep the screenshots: Med is a desktop app. Until the visitor clicks in a
window, the wheel scrolls the page, not the window.

The first window loads about 780 KB (Brotli). The brief, comment, session, and
commit windows use the same files from the cache. The notes window adds about
140 KB for the editor. All of it loads after the page.

## Deploy

`dist/` is a complete static site. `bun run deploy` builds it and deploys it to
https://med.zsheng.app as the `med-site` Worker. The Worker has static assets
only (`wrangler.jsonc`), and `dist/_headers` sets a one-year cache for the
hashed files.
