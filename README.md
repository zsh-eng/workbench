# Workbench

A monorepo for personal apps and shared local-first software.

## Apps and packages

| Path                                                                 | Purpose                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [apps/spaced2](apps/spaced2/README.md) | Spaced flashcards, FSRS scheduling, local review and sync. |
| [apps/med](apps/med/README.md)                                       | Local Git review, file navigation, and agent review links.                   |
| [apps/reader](apps/reader/README.md)                                 | Web EPUB Reader. React, IndexedDB, and a Cloudflare Worker.                  |
| [apps/arctic](apps/arctic/README.md)                                 | Arctic, the native iOS and Mac article reader, plus the iOS share extension. |
| [packages/local-sync](packages/local-sync/README.md)                 | Shared sync protocol, engine, and Dexie/Hono adapters.                       |
| [packages/text-highlighter](packages/text-highlighter/README.md)     | DOM text selection and highlight restoration.                                |
| [packages/arctic-sync-server](packages/arctic-sync-server/README.md) | Private Arctic auth and sync routes, hosted by the Reader Worker.            |

Arctic keeps its library in local SQLite. After sign-in, it syncs library state,
titles and tags through the shared service; notes and files stay on each device.

## Start

Use Bun from this directory. There is one workspace lockfile.

```sh
bun install --frozen-lockfile
bun run dev:reader
# Or run Spaced (a second terminal runs its local API):
bun run dev:spaced2
bun run dev:spaced2-server
```

For Arctic, open `apps/arctic/ArticleReader.xcodeproj` in Xcode and select the
**ArticleReader** scheme. See its README for signing and device setup.

| Command, from this directory          | Action                                                         |
| ------------------------------------- | -------------------------------------------------------------- |
| `bun run build`                       | Build shared libraries and the web Reader.                     |
| `bun run test:client --run`           | Run Reader client tests.                                       |
| `bun run test:server --run`           | Run Worker tests with local D1.                                |
| `bun run test:packages`               | Test shared packages.                                          |
| `bun run test:e2e`                    | Run Reader browser tests.                                      |
| `bun run build:med`                   | Type-check and build med’s browser UI and local host.          |
| `bun run med /path/to/repository`     | Start med; pass more repository paths to review them together. |
| `bun run dev:med /path/to/repository` | Start med’s development UI and local host.                     |
| `bun run check:med`                   | Check med’s formatting, lint, tests, and build.                |
| `bun run build:arctic-web`            | Bundle Arctic's WebView extraction code.                       |
| `bun run test:arctic-web`             | Test Arctic's WebView code.                                    |
| `bun run lint`                        | Check TypeScript and JavaScript sources.                       |
| `bun run deploy`                      | Build and deploy the existing Reader Worker.                   |

The default `dev`, `build`, `test`, `deploy`, database, and diagnostic commands
still target Reader. Each app owns its dependencies, tests, and configuration.
Reader environment files belong in `apps/reader/`; start with its
[environment examples](apps/reader/.env.example) and
[Worker secret names](apps/reader/.dev.vars.example).
Deployment names, domains, database bindings, and iOS bundle IDs are unchanged.

med is developed in `apps/med`. It uses the root Bun install and retains its local port, review links, and state directory. See [med setup](apps/med/README.md) and [agent review guidance](apps/med/docs/AGENT_INTEGRATION.md), and
[migration notes](docs/MED_MIGRATION.md).

## Guides for future projects

- [Local-first data and sync](LOCAL_FIRST.md): durable local writes, files, and preloading.
- [Reading time](READING_TIME.md): session boundaries and idle time.
- [UI performance](UI_PERFORMANCE.md): traces, virtualization, and image preparation.
- [Adapting design references](DESIGN_REFERENCES.md): turn references into testable behavior.
- [Architecture](docs/ARCHITECTURE.md): workspace boundaries and app-specific designs.

Add independent products under `apps/`. Add a package under `packages/` when
code has a clear shared contract. Keep app data and generated output out of Git.

For the native desktop app, open `apps/arctic/ArcticMac.xcodeproj`. See the
[Mac guide](apps/arctic/Mac/README.md) for shortcuts, build commands and performance evidence.

Spaced is developed in `apps/spaced2`. Use `bun run test:spaced2`,
`bun run build:spaced2`, and `bun run deploy:spaced2`. Its existing Worker,
domain, auth, D1 and R2 resources remain separate from Reader. See the
[Spaced migration notes](docs/SPACED_MIGRATION.md).
