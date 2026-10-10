# Med site

The marketing page for [Med](../med/README.md): one static HTML page with
inline CSS and one small script. There is no UI framework and no third-party
request. On wide screens each window on the page runs Med itself on a
recorded review (see [Live demo](#live-demo)).

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
- `src/shots.ts`: alt text and layout sizes for the screenshots.
- `scripts/painting/paint.ts`: the painting (see [Brand](#brand)).
- `public/`: files served as they are. The build gives fonts, screenshots, and
  the painting content hashes under `/assets/`. `public/demo/recording.json`
  and `public/demo/vault.json` are the live demo's recorded review and vault.

## Fonts

`public/fonts` holds Latin subsets of Med's Geist and Paper Mono, with their
SIL Open Font License notices. After Med's fonts change, run `bun run fonts`.

## Screenshots

`bun run screenshots` builds a small invented repository ("Trailhead"), starts a
built Med on port 4310 with temporary state, creates the review "Search filters"
in two iterations with briefs, and adds two comments. A fixture Claude Code
transcript (`scripts/screenshots/session.ts`) stands in for the agent: Med
shows it in the Session pane, sends the first comment to it through
`med review wait`, and keeps the second comment ready to send. The run stages
the review's files, writes a commit message, and opens a small Obsidian vault
(`scripts/screenshots/vault.ts`) on a second Med server, on the next port.

While it does this, it records every API answer into `public/demo/recording.json`
and `public/demo/vault.json`. Then it builds the live demo, serves it on the
port after the vault's, and captures each scene of the demo (see
[Live demo](#live-demo)) in Med's own Med Dawn and Med Night themes. So each
screenshot shows what the live window shows. Each feature also gets a capture
at 390 px for phones, where Med lays its part out again for the narrow
window. It writes AVIF and WebP files to
`public/screenshots` and their sizes to `src/screenshots.json`. It never reads
your repositories, Git identity, or Med state, and it fails if a local path is
on screen or in a recording. `--demo` records only, without captures.

```sh
MED_CLI=/path/to/workbench/apps/med/dist/cli.js bun run screenshots
MED_CLI=/path/to/workbench/apps/med/dist/cli.js bun run screenshots --demo
```

Set `MED_PORT` to use another port (never 4173, the Med service, nor the two
ports before it). Set
`SCREENSHOT_PNGS` to a directory to keep the full-size PNG captures.

## Brand

The page is paper and ink, with a narrow column of text. Its palette is Med's
own Med Dawn and Med Night themes (`apps/med/src/web/themes.ts`): the sea for
what you act on, and the dawn's peach for selection. The only other colour is
a painting: the Mediterranean sun rising over the sea, with its reflection on
the water, and the moon in dark mode. The product window rises from it.

Med's `scripts/painting/painter.js` paints a scene with thousands of bristle
strokes in a browser canvas; `scenes.js` holds the dawn and night scenes and
the icon's tiles. The random numbers are seeded, so each run paints the same
picture. `bun run paint` (`scripts/painting/paint.ts`) writes
`public/painting` in AVIF and WebP at 1200 and 2400 px.

Med's icon, Reflection, comes from `apps/med/scripts/render-icons.mjs`: a paper
sun and its reflection on a painted tile of the same sea, dawn in a light
scheme and moonrise in a dark one. The favicon carries both. After it changes,
copy its `icon.svg` to `public/favicon.svg`, and its `icon-dawn.svg`,
`icon-night.svg`, and `apple-touch-icon.png` to `public/`. The header picks
`icon-dawn.svg` or `icon-night.svg` with the system's colour scheme, as the
screenshots do; the wordmark is drawn strokes in `src/index.html`. The agent marks in the install card come from
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
event streams stay open, writes succeed and change nothing, and the clock
starts at the time of the recording. The build compiles the app with
`apps/med/vite.demo.config.ts` into `dist/demo/`.

A window names its scene in `data-demo`: `demo.html?scene=review` for the
product window, and `brief`, `comment`, `session`, `commit`, and `notes` for
the features. The scene sets the panes, opens the tab or note, scrolls to the
comment, and then marks the page ready. The `notes` scene replays `vault.json`;
the others replay `recording.json`.

The product window shows all of Med. A feature's scene shows only its part:
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
640 KB for the editor and Mermaid. All of it loads after the page.

## Deploy

`dist/` is a complete static site. Any static host can serve it; for
Cloudflare static assets, `dist/_headers` sets a one-year cache for the hashed
files. This app has no deployment configuration, project name, or domain yet.
Add them when the domain is chosen.
