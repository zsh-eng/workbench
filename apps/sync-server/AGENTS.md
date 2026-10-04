# Shared sync service

Follow the root guidelines and read `../../docs/SHARED_SYNC_PLAN.md` before
changes. This service owns production Reader and Spaced auth, sync, and files at
`https://api.zsheng.app`. Arctic native auth and its namespace are implemented locally; production
activation and native library migration remain separate steps. Keep production deployment and
data migration explicit; local development uses its own configuration and data.

The server owns authentication and app namespaces. Values remain opaque; do
not import Reader or Spaced domain schemas. Scope records, files and devices by
both authenticated user and namespace. Refuse unknown apps and stale epochs.

Run `bun run test:sync-server` and `bun run build:sync-server` from the workspace
root. For client wiring changes, run `bun run test:shared:e2e` and the owning
app checks. Integration tests use real Better Auth, D1 and R2. Browser tests
start their own local stack; stop all task-owned servers after validation.
