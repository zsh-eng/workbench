# Med site

The marketing page for [Med](../med/README.md): one static HTML page with
inline CSS and a small script for the install tabs and copy buttons. There is
no UI framework and no third-party request.

## Commands

Run these from `apps/med-site`. Install dependencies from the Workbench root
with `bun install`.

```sh
bun run dev        # http://127.0.0.1:4320, renders src/ on each request
bun run build      # writes dist/ and prints the page weight
bun run preview    # serves dist/ on http://127.0.0.1:4320
bun run test       # builds, then runs the Playwright checks on dist/
```

## Where things are

- `src/site.ts`: the install command, the agent prompt, the requirements line,
  and the links. Change provisional strings here only.
- `src/index.html`, `src/styles.css`, `src/main.js`: the page. The build inlines
  the CSS and the script. `scripts/render.ts` describes the template syntax.
- `src/shots.ts`: alt text and layout sizes for the screenshots.
- `public/`: files served as they are. The build gives fonts and screenshots
  content hashes under `/assets/`.

## Fonts

`public/fonts` holds Latin subsets of Med's Geist and Paper Mono, with their
SIL Open Font License notices. After Med's fonts change, run `bun run fonts`.

## Screenshots

`bun run screenshots` builds a small invented repository ("Trailhead"), starts a
built Med on port 4310 with temporary state, creates the review "Search filters"
in two iterations with briefs, adds two comments, and captures each view in
Med's Graphite Light and Graphite Dark themes. It then writes AVIF and WebP files
to `public/screenshots` and their sizes to `src/screenshots.json`. It never
reads your repositories, Git identity, or Med state, and it fails if a local
path is on screen.

```sh
MED_CLI=/path/to/workbench/apps/med/dist/cli.js bun run screenshots
```

Set `MED_PORT` to use another port (never 4173, the Med service). Set
`SCREENSHOT_PNGS` to a directory to keep the full-size PNG captures.

## Deploy

`dist/` is a complete static site. Any static host can serve it; for
Cloudflare static assets, `dist/_headers` sets a one-year cache for the hashed
files. This app has no deployment configuration, project name, or domain yet.
Add them when the domain is chosen.
