# Reader

The web EPUB reader in [Workbench](../../README.md). Run commands in this
folder, or use the Reader commands at the repository root.

See [Architecture and performance principles](docs/ARCHITECTURE.md) for the
current design decisions and validation approach.

## Reusable project guides

- [Local-first data and sync](../../LOCAL_FIRST.md) — durable writes, files, cache ownership and loading order.
- [Reading time](../../READING_TIME.md) — activity-based sessions, idle limits and lifecycle rules.
- [UI performance](../../UI_PERFORMANCE.md) — frame diagnostics, viewport preloading, compact images and measured limits.
- [Adapting design references](../../DESIGN_REFERENCES.md) — turn a useful reference into testable behavior.

These guides describe transferable patterns. They distinguish the web Reader's
sync from Arctic's native sync, which covers library state, titles and tags only.

Plans are in [ROADMAP.md](ROADMAP.md).

## Commands

| Command                  | What it does                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `bun run dev`            | Starts the dev server.                                                                       |
| `bun run dev:local-data` | Starts it with your own library (see below).                                                 |
| `bun run build`          | Type-checks and builds the app and Worker.                                                   |
| `bun run lint`           | Runs oxlint.                                                                                 |
| `bun run test:client`    | Runs the client tests (Vitest with happy-dom and fake IndexedDB).                            |
| `bun run test:server`    | Runs the Worker tests (Cloudflare Vitest integration).                                       |
| `bun run test:e2e`       | Runs the Playwright tests on their own dev server, port 5190. Set `E2E_PORT` to use another. |

`dev`, `build` and the Vitest commands first build `text-highlighter` and
`local-sync`, which the Reader imports from their `dist`. A package whose
`dist` is newer than its source is skipped; `FORCE=1` builds it anyway.

The e2e global setup loads the app once, so no test meets a cold Vite
server, and imports the sample book once through the real importer. The
`localBook` fixture restores those rows into each test's own database.

## Local real data

To see the Reader with your own library, run:

```bash
bun run dev:local-data
```

Then open <http://localhost:5177>. The app signs in as a local user and
installs the library the way a new device does: it pulls every record and
downloads each book file when you open it. Give it a few seconds to fill
the Library on the first visit.

- The data comes from the Workbench Backup mirror in
  `~/Library/Application Support/Workbench Backup`. Set `READER_BACKUP_DIR`
  to use a different mirror folder.
- Set `READER_LOCAL_DATA_PORT` to run a second copy, for example from a
  worktree, next to the first. Each port installs its own copy of the data.
- The mirror opens read-only. Edits, imports and deletions in the browser stay
  in the dev server's memory and in the browser. They never reach the backup
  or the production API, and a restart discards them on the server.
- This mode reads no `.env` file and starts no local Worker. It uses its own
  port, so its IndexedDB does not mix with `bun run dev` data. To install the
  data again, clear the site data for `localhost:5177` and reload.

## Elements

With Debug mode on, open **Settings → Elements**, or `/debug/elements`. The
page shows Reader parts in a desktop frame and a phone frame side by side,
for design checks on desktop.

- **Foundations** shows each theme's tokens and the type scale.
- **Specimens** render real components on sample data. Pick a state above a
  specimen; both frames change without a reload. Choose it again to replay it.
- **Reader** and **Library** run the whole app in the frames. With
  `bun run dev:local-data`, they show your own books.
- **Design ideas** (`/debug/elements/:topic`, for example
  `/debug/elements/library`) put a part of the app as it ships next to its
  ideas, on desktop, phone or both. To add an idea, give it a route that
  renders it full-window and add it to `TOPICS` in
  `src/features/elements/DesignIdeasPage.tsx`. **Living covers**
  (`/debug/elements/covers`) shows covers as lit objects with hand-made
  depth, foil and light; see [Living covers](docs/LIVING_COVERS.md).

The frame theme previews the frames only. To add a specimen, add a component
that takes `state` and `nonce` to `src/features/elements/specimens.tsx`.

## Notes on Env

`VITE_BETTER_AUTH_URL` should be defined in `.env.development` and `.env.production`.
Other environment variables should be defined in `.dev.vars` or `wrangler.jsonc` (non-sensitive).

You should manually add these environment variables to the cloudflare dashboard for the production build.
The only environment variable that's updated locally is the `VITE_BETTER_AUTH_URL` variable.

## Notes on Dependencies

Worker tests use the Cloudflare Vitest integration. The workspace lockfile
defines the compatible tool versions.
See [this link](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).
