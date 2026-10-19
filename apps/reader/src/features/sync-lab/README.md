# Sync Lab

Open **Settings → Debug mode → Sync Lab**, or `/debug/sync`.

The lab runs one simulated account with up to four isolated clients. Start with
an original demo EPUB or capture the current local library. Source capture uses
one read transaction and does not run database upgrades or download missing
files. Open the normal Reader first if its database needs an upgrade.

## Two views, one client implementation

- **Inspector** loads sync, domain writes, and file transfer code in hidden
  frames. It does not mount the app or start pagination workers.
- **App views** mounts the real Library and Reader in mobile-size frames. The
  same controls, record comparison, file inventory, and timeline remain available.

Changing views restarts app processes, retains their databases and preferences,
and remembers each app's route. Frames use memory history, so navigation cannot
lose the isolated runtime configuration.

Each frame has its own database, device ID, HLC state, cursor, preferences, and
services. The parent supplies typed remotes through the same-origin `LabHost`
interface before application modules load. This avoids a second implementation
of the client protocol. The normal API client rejects requests from lab frames;
auth and the Devices view use synthetic session data. Lab frames do not register
a service worker.

## Presets and controls

Empty clients start with cursor zero. Metadata clients receive current server
rows and the cursor for those exact rows. Downloaded clients also receive
currently available server bytes, but no expanded EPUB or pagination cache.
The position preset writes a device-owned checkpoint at 65% of chapter one
through normal middleware after startup.

Automatic sync starts paused. A normal sync cycle pulls and then pushes. Another
client must pull again to see a change pushed after its own pull. Per-client
controls include manual pull/push, offline state, timed reconnection, latency,
a failed request, and a lost response after a server write commits.

The local action panel edits one shared note per book, deletes that note, writes
a device checkpoint, or downloads the source EPUB. Different checkpoints test
resume/handoff behavior. Editing the shared note tests a conflict on one key.

The protocol uses last-write-wins order: HLC wall time, HLC counter, then device
ID. Clock offsets affect sync ordering; monotonic HLCs do not move backwards.
The server rejects writes over five minutes ahead. Advancing sync clocks does
not advance JavaScript timers, animations, or time spent reading.

## Inspection and repeatability

Record comparison includes tombstones. An empty outbox is not proof that clients
agree: compare domain values with the server. File availability and expanded
Reader content are separate states. The protocol panel exposes cursor, clock,
and pending outbox values. The event timeline records committed client decisions
as well as transport requests, results, and failures. It retains 2,000 events;
full payloads are shown only when an event is expanded.

Scenarios support **Set up** and **Play**. Set up prepares the first two clients
and selected book, pauses automatic sync, and saves a starting checkpoint.
Presets cover an offline note, competing offline edits, deletion, a lost write
response, a newer reading position, and a future-clock rejection. The handoff
preset requires opening Reader A after setup so the prompt can be inspected.

Playback controls remain visible above all inspector tabs. **Pause** lets the
active step settle, then stops before the next step. **Step** runs one action.
Clients remain live while paused: you can edit data or use the Reader, then
continue from that changed state. Background transfers and browser timers are
not frozen. Lost-response, clock-rejection, and handoff steps pause automatically
at their inspection points. An outcome mismatch stops playback and leaves the
state available for inspection. **Restart** restores the prepared checkpoint;
**Stop** keeps the current data and releases the sequence.

Inspector recording captures settled actions and expected errors, with a
200-step limit. Recorded sequences use the same playback controls. Replay
restores its starting checkpoint, waits for new clients, and verifies each
step's success or error. It does not record Reader DOM gestures or reproduce
concurrent race timing. Recordings last for this page session.

Checkpoints include all client tables, file bytes, preferences, device/clock
state, cursors, pending changes, network controls, remaining timed-offline delay,
and server data. Capture unmounts the app and drains queries, mutations, final
Reader/session saves, sync, and file operations before reading state. It then
starts new processes. Automatic sync must be paused before capture. Restore uses
fresh processes too; it does not rewind live promises or workers.

Checkpoints can be exported/imported as JSON with binary data. Imports validate
structure, IDs, tables, sizes, and file content hashes before replacing the
experiment. Limits are four clients, 50,000 rows, and 100 MiB of decoded bytes.
Database upgrade checks use actual historical v3/v5 fixtures and the current
Dexie migrations, then verify values and file bytes and remove the test database.
They do not simulate clients running older application builds.

## Ownership and extension points

Read these files in order:

1. `runtime.ts`, `types.ts`, `client.ts`: frame bootstrap and client lifetime.
2. `core/memory-server.ts`, `core/network.ts`: production protocol semantics and faults.
3. `core/controller.ts`, `core/seed.ts`: experiment state and consistent spawning.
4. `core/snapshot-file.ts`, `core/recording.ts`: checkpoints, validation, and replay.
5. `SyncLab.tsx`, `ClientCard.tsx`, `Inspector.tsx`, `ExperimentTools.tsx`: presentation.

Keep fault controls in the remote adapter, and keep local edits on the normal
middleware path. Add protocol parity tests when server behavior changes. A pull
has a fixed head but reads the compacted record log, exactly like the production
server; it is not a historical snapshot of overwritten versions.

Database names use `sync-lab-<session UUID>-<client ID>`. Removing a client or
leaving through the Reader link drains its work and deletes its database. A
browser crash or reload can leave databases behind. **Clean abandoned
experiments** removes only recognized databases whose parent no longer holds a
Web Lock. It keeps active tabs and the production library. If Web Locks are not
available, cleanup does not delete anything.

## Verification

- `bun run test:client --run`: protocol parity, isolation, migration, and
  multi-client scenario tests.
- `bun run test:e2e test/e2e/sync-lab.spec.ts`: copying the local library leaves
  it unchanged.
- `bun run build` and `bun run lint`.
- `bun run test:e2e --config playwright.pwa.config.ts`: production service worker
  registration and offline reopen after a production build.

Further extensions can add held/reordered responses, controlled browser timers,
and clients loaded from different application builds. Those require separate
verification of scheduling, protocol compatibility, and migration boundaries.

## Next scenario coverage

Keep five concerns separate when designing Reader status: connection, record
sync, book-file availability, local save, and reading-position handoff. A local
save can succeed while offline; synchronized records do not prove that the EPUB
has uploaded. Routine transport activity should not move or interrupt the page.

Next presets should cover slow first-open, a metadata-only client offline,
records arriving before an EPUB upload, a remote edit while the composer has a
local draft, and remote deletion while that draft is open. Each needs a concrete
visible result: stable loading, a recoverable file error, an accurate file state,
or an inline conflict that retains the draft. These require file-transfer and
real-composer actions beyond the current note-record commands.
