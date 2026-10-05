# Verified live backup — 4 October 2026

Bun 1.3.5, macOS ARM64, native SQLite, durable WAL transactions. The CLI used
normal device-code login and a server-enforced read-only credential. No user
records or files were changed. Private data, manifests and raw timings are in
`~/Library/Application Support/Workbench Backup/`, outside Git.

## Live results

| Measurement                                         |        Result |
| --------------------------------------------------- | ------------: |
| Reader records                                      |         1,115 |
| Spaced records                                      |        98,838 |
| Catalogued files                                    |           716 |
| Downloaded bytes                                    |   323,359,403 |
| First Reader record pull                            |       0.585 s |
| First Spaced record pull                            |       9.725 s |
| SQLite time within those pulls                      |       1.181 s |
| First full sync, including files                    |      76.748 s |
| Independent fresh record-only pull, both namespaces |      10.203 s |
| Repeat full sync, median of three                   |       2.009 s |
| Repeat full sync, range                             | 1.789–2.620 s |

The final fresh run repeated all downloads after durability hardening and also
matched every record in the retained mirror. Both full-run observations are kept;
network and host variation preclude treating the lower total as a speedup.

Repeat runs received zero records and downloaded zero files. Both catalogs were
rechecked. A second fresh live pull matched every raw stored record field,
including versions, tombstones and sequences, by a deterministic SHA-256
comparison. All known xxh64 references were present. A dated standalone snapshot
passed SQLite integrity checking and size, xxHash and SHA-256 checks for every
file. External URLs and unsynced device data are outside this coverage.

These are observed timings on this machine and connection, not guarantees.
Record time includes HTTP, parsing, protocol validation and SQLite. File time
includes catalog checks, four concurrent downloads, hashing and disk writes.
SQLite-only time is a subset, not additive to total sync time.

## Native write-only benchmark

Three rounds, rotated batch order, 99,953 already-decoded records from the live
mirror. Prepared UPSERTs, table indexes, cursor updates and synchronous FULL
transactions are included. Every sample passed full-row equality and integrity
checks. Network, source reads and initial decoding are excluded. Temporary
databases were removed after checking.

| Records per transaction | Median write time |         Range |
| ----------------------: | ----------------: | ------------: |
|                     500 |           0.833 s | 0.828–0.865 s |
|                   5,000 |           0.679 s | 0.618–0.692 s |
|                  20,000 |           0.658 s | 0.637–0.698 s |

Keep 5,000 as the client bound: larger transactions provide little measured gain
and retain more uncommitted work. Live pulls also flush at each bounded response
window or approximately 8 MiB, so their actual transaction sizes differ. This
agrees with the direction of Spaced's earlier native SQLite batching experiment;
it is not a controlled cross-run speedup comparison.

## Checks

- Client integration suite: three tests, including crash-released writer lease.
- Server integration suite: 12 tests passed serially with a 60-second timeout.
  The first parallel run exceeded default five-second timeouts under host load.
- TypeScript checks and Worker dry-run build passed.
- Real local Worker + browser + CLI: login, Keychain, selective and full pulls,
  repeat pull, tree/table/schema commands, snapshot, and token revocation passed.
- Production device-code approval used the existing signed-in Google account.
  No browser cookies or credentials were extracted.
- Deployed Worker version: `4f290fd1-4c92-4996-b134-c9e9caf1de08`.
  Only CLI auth migration `0004_cli_auth.sql` was applied; the pending Arctic
  native-auth migration and runtime changes were excluded from this deployment.
