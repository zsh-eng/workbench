# Arctic agent guidelines

Read `README.md` and `PERFORMANCE.md` before changing the native app. Read
`../../docs/ARCHITECTURE.md` before data, cache, or sync changes.

- Keep UIKit/SwiftUI UI, share extension, and local persistence in this app.
- Keep WebView JavaScript in `Web/`; build it with `bun run build:arctic-web`
  from the repository root. Run `bun run test:arctic-web` for its tests.
- Open `ArticleReader.xcodeproj`; use the `ArticleReader` scheme. Build for an
  iOS simulator after Swift or project changes. Use focused `Tests/`, `Checks/`,
  and `Sync/` tests for behavior and persistence changes.
- Test the actual interaction. Simulator results do not establish physical
  device frame rate, signing, or share-extension behavior.
- Preserve local data. Keep HTML and images separate from metadata. Never
  synchronize Jev keys. The SQLite library copy and account sync of library
  state, titles and tags are approved and live (10 October 2026). Annotation,
  reading-time and file sync need the user's approval of a concrete migration.
- Shared auth and v3 sync are owned by `../sync-server`; reusable native auth
  support lives in `../../packages/arctic-sync-server`. Legacy Reader-hosted
  Arctic routes remain during transition. Never change or remove `links.json`:
  it is the backup of the first copy.
