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
  state, titles and tags are approved and live (10 October 2026). Article text
  copies in the separate `arctic-content` namespace are approved (19 October
  2026): cleaned HTML only, no scripts, at most 2 MiB each; the web app in
  `Browser/` writes them, and so does `Browser/scripts/upload.ts` with the
  Workbench Backup credential (approved 20 October 2026). The phone uploads
  the text of its Reader copies that the account lacks, in the web's format
  (`AccountRecords` in `Sources/LibrarySync.swift`, 24 October 2026). Annotation and
  reading-time sync are approved web first (21 October 2026): records only, in
  `arctic-annotations` and `arctic-reading`, in the phone's `ReaderAnnotation`
  and `ArticleReadingSession` encodings. The phone syncs them too (approved
  21 October 2026): `AccountRecordJournal` in `Sources/LibrarySync.swift`
  uploads its files and pulls the web's; keep both sides' encodings equal
  (`Checks/AnnotationStoreChecks.swift` compares the bytes). The web saves new links (approved 21 October
  2026) by writing the phone's `article/`, `library/` and `tags/` records for
  a new article. `wb arctic save` writes the same records with the Workbench
  Backup credential, and the shared API checks them. All three use
  `../../packages/arctic-links`; keep it in step with
  `ArticleSyncCodec.canonicalURL`, `identity` and `values`.
- Shared auth and v3 sync are owned by `../sync-server`; reusable native auth
  support lives in `../../packages/arctic-sync-server`. Legacy Reader-hosted
  Arctic routes remain during transition. Never change or remove `links.json`:
  it is the backup of the first copy.
