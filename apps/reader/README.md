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
active sync from Arctic's dormant native sync integration.

Roadmap (v0.1):

- [x] Read books
- [x] Themes
- [x] Highlights
- [x] Navigation
- [x] Mobile view
- [x] Reading progress

Roadmap (v0.2):

- [x] Login
- [x] Sync books
- [x] Sync Engine
- [x] Sync reading progress
- [x] Sync highlights
- [x] Sync log (for debugging)

Testing:

- Playwright tests for
  - Adding books
  - Deleting books
  - Reading and navigating
  - Changing settings
  - Sync of books
  - Sync of highlights
  - Offline usage and support

Roadmap (v0.3):

- [ ] Better book text styles
- [ ] Text notes
- [ ] Reading stats over time
- [ ] Book shelves (DNF, completed, etc.)
- [ ] Full text search
- [ ] Add multiple EPUBs at once

Future:

- [ ] Voice notes
- [ ] Audio notes
- [ ] Quote sharing
- [ ] Read articles
- [ ] Read PDFs
- [ ] LLM (ask questions)
- [ ] Flashcard integration
- [ ] Chinese learning (show pinyin, translation of words)
- [ ] Desktop / Mobile App (Tauri)

Not on roadmap:

- Paginated view
- RTL or Top to bottom layout
- EPUB CFI for reading progress

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
- The mirror opens read-only. Edits, imports and deletions in the browser stay
  in the dev server's memory and in the browser. They never reach the backup
  or the production API, and a restart discards them on the server.
- This mode reads no `.env` file and starts no local Worker. It uses its own
  port, so its IndexedDB does not mix with `bun run dev` data. To install the
  data again, clear the site data for `localhost:5177` and reload.

## Notes on Env

`VITE_BETTER_AUTH_URL` should be defined in `.env.development` and `.env.production`.
Other environment variables should be defined in `.dev.vars` or `wrangler.jsonc` (non-sensitive).

You should manually add these environment variables to the cloudflare dashboard for the production build.
The only environment variable that's updated locally is the `VITE_BETTER_AUTH_URL` variable.

## Notes on Dependencies

Worker tests use the Cloudflare Vitest integration. The workspace lockfile
defines the compatible tool versions.
See [this link](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).
