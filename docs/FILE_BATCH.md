# Bulk file downloads

Status: prototype, October 2026. Not deployed.

Arctic for the web downloads article text (`arctic-content`) and Spaced
downloads card images (`spaced`) from the shared API. Until this change each
file was one request. This page records what limits a bulk download, the
options with numbers, and the chosen design: a batch route that sends many
files in one streamed answer.

## What limits a download

Measured from Singapore on 27 October 2026 with the Workbench Backup
credential (read-only GETs; raw timings and contents stay outside Git).

- **Not the browser's connection limit.** `api.zsheng.app` answers over
  HTTP/2 and offers HTTP/3, so a browser sends every request on one
  connection. The six-connection limit applies to HTTP/1.1 only, which local
  `wrangler dev` uses. The apps' own limits were lower anyway: Arctic asked
  for four texts at once, Spaced for five images.
- **Each file is several trips to storage.** A file request makes three or
  four D1 queries in turn (session, stream epoch, file row) and one R2 get. D1
  (`running_in_region: APAC`, no read replicas) and R2 (`location: APAC`) are
  both in Asia. From the Singapore colo, `/health` answers in about 25 ms, a
  D1 query adds about 30 ms, a text arrives in about 250 ms and an image in
  about 300 ms.
- **The colo changes from one connection to the next.** Over a few hours this
  connection landed on SIN, HKG, NRT, SJC, LAX, DFW, ARN, FRA, MRS and CDG.
  From a European colo, a round trip is about 320 ms, each D1 query about 170
  ms, each R2 get about 550 ms, and one text about 1.4 s.
- **The apps added round trips.** Every file URL is new, and `X-Sync-Scope` is
  not a simple header, so each file request first sent a CORS preflight.
  Spaced also asked `/sync/v3/state` before every image.
- **Images are mostly bytes.** The account's 634 images are 138 MB (217 kB on
  average, median 1325 × 662 px); its 622 texts are 16 MB, 6 MB with
  compression. One connection moved 1.2–5 MB/s with many streams in flight.

So texts wait on round trips, and images wait on round trips and bandwidth.

## Options

Production, today's apps (preflight on each file; Spaced's state request on
each image), against the same apps' fetch pattern with 32 at once. HTTP/2
with browser-sized windows, Accept-Encoding as a browser sends it. Each run
is one connection, on whichever colo the route chose.

| Files            | Today                                   | 32 at once                 |
| ---------------- | --------------------------------------- | -------------------------- |
| 50 texts         | 19.9 s (MRS), 72.4 s (DFW)              | 3.6 s (MRS), 5.6 s (LAX)   |
| 200 texts        | 21.0 s (SIN), 74.1 s (CDG), 129 s (FRA) | 5.0 s (NRT), 12.3 s (DFW)  |
| 622 texts (all)  | 302 s (MRS), 263 s (DFW)                | 74.8 s (MRS), 74.6 s (MRS) |
| 50 images        | 26.9 s (MRS), 36.5 s (FRA)              | 7.4 s (MRS), 20.5 s (DFW)  |
| 200 images       | 14.5 s (SIN), 132 s (MRS)               | 7.9 s (NRT), 36.5 s (ARN)  |
| 634 images (all) | did not finish: connection reset, twice | 70.0 s (FRA), 91.9 s (ARN) |

The same comparison in the lab (below) without a browser: Arctic's texts,
each request after one round trip, with the preflight that a browser sends
for each new URL. No bandwidth limit.

| Texts           | One per file, 4 at once | One per file, 32 at once | Batches, 6 at once |
| --------------- | ----------------------: | -----------------------: | -----------------: |
| 50, near        |                   4.7 s |                   0.75 s |             0.52 s |
| 200, near       |                  17.7 s |                    2.7 s |              1.4 s |
| 1,000, near     |                         |                   12.5 s |              6.1 s |
| 50, far         |                  25.2 s |                    4.0 s |              2.6 s |
| 200, far        |                  96.8 s |                   13.7 s |              6.4 s |
| 1,000, far      |                         |                   61.9 s |             26.7 s |
| Requests, 1,000 |                   2,000 |                    2,000 |                 36 |

| Option                                 | Verdict                                                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raise the client limit (4 → 32)        | No server change and 4–7× faster, but each file still costs a preflight, three or four D1 queries and its own Worker request: 1,000 files are 2,000 requests and up to 4,000 queries, and batches are 1.4–2.3 times as fast again.      |
| **Batch route** (chosen)               | One request authenticates once and reads the rows with one query, so 1,000 texts are 35 requests (and one preflight) and at most 140 queries. R2 reads overlap, six to a request.                                                       |
| Put small texts in sync records        | Changes the `arctic-content` record format (a sync contract), sends every text to every device whether it wants offline text or not, and 45 of 622 texts (7%) are over the 64 KiB record limit. Rejected.                               |
| Edge cache (Cache API) for file bodies | Still authenticates per file, and saves only the R2 get on a hit. A bulk download reads each file once per device, and the colo changes per connection, so it would mostly miss. Rejected for this job.                                 |
| D1 read replicas, Smart Placement      | Configuration on the production Worker and database. Replicas shorten D1 queries from a far colo but not R2 gets; placement runs the Worker near APAC storage. Both help single requests and work with batches; neither was tried here. |

## Design

`POST /api/apps/<namespace>/files/batch` with `{"ids": [...]}` (1–32 ids)
answers with one streamed body of frames: a JSON header line, then the
file's bytes ([format](../packages/file-batch/README.md)).

```text
{"id":"xxh64:…","status":200,"size":1234,"type":"image/png"}\n<1234 bytes>
{"id":"xxh64:…","status":404}\n
{"end":true}\n
```

- **Server** (`apps/sync-server/src/files.ts`). The usual middleware
  authenticates the session or `wb` credential and checks the sync scope. One
  D1 query reads the rows, scoped by user and namespace. The Worker reads up to
  six R2 objects ahead of the one it writes (the Workers limit of connections
  waiting for headers) and pipes each body into the response. It stops adding
  files at 1 MiB of file bytes, always sending one, so a response ends well
  inside the client's 30-second request timeout on a slow route. Text is
  gzip-encoded when accepted, as `pull-stream` does.
- **Client** (`@workbench/file-batch`, `downloadFiles`). Six requests at once
  share the queue; each file is stored as its frame arrives, so progress moves
  file by file. A file left out by the byte limit goes into a later request.
- **Limits.** 32 ids keep one request under 50 subrequests (the Workers Free
  limit; Paid allows 10,000) and the D1 query under 100 bound parameters.
  Memory stays bounded: at most six bodies wait while one is written. Only
  `spaced` and `arctic-content` offer the route; their files are at most
  2 MiB. Reader's books (up to 100 MiB) stay single requests.
- **Failures.** A missing file is a 404 frame and fails at once. A failed R2
  read is a 500 frame, and a dropped or quiet connection (30 s) keeps the
  files that arrived; the rest go into a new request, three tries each, with
  backoff. 401, 403 and 409 stop the download.
- **Compatibility.** `GET /files/<id>` is unchanged. A new client that gets
  400, 404, 405 or 501 from the batch route (an older server reads `batch` as
  a file ID and answers 400) downloads one file per request.
- **Resume and progress.** Both apps skip files that are already stored, so
  a new start after going offline asks only for the rest. Spaced's
  `images:all` job reports each image to background-activity and restarts
  when the network returns; Arctic's Offline section counts each text, and
  downloads new text after the next sync when that setting is on.
- **Spaced's single images.** One client now keeps the account's scope for
  file reads, so displaying an image is one request instead of two.

## Measurements

Real Chromium against the lab Worker (`apps/sync-server/wrangler.lab.jsonc`):
the real routes and storage, with each D1 query and R2 get delayed as
measured above, and six R2 gets at a time per request. Chrome's network
emulation adds the round trip and limits bandwidth: near is the SIN colo
(25 ms, 6 MB/s), far a European colo (320 ms, 1.2 MB/s). Before is the base
commit's app (`e0c834d8`); after is this change. Each run is a fresh browser
profile and ends when the app shows every file stored. Cold is the first run
after the lab Worker starts; warm is the median of the next runs. Texts take
the sizes of the account's 622 texts. Images are synthetic screenshots of
1100–1550 × 560–760 px; 200 of them are 71 MB (354 kB each), 1.6 times the
account's average, so image times here are on the slow side.

Runs per cell: three at near with 50 and 200 files, one at far with 1,000,
two otherwise.

| Files        | Colo | Before, cold | Before, warm | After, cold | After, warm | Faster |
| ------------ | ---- | -----------: | -----------: | ----------: | ----------: | -----: |
| 50 texts     | near |        4.4 s |        4.3 s |       0.9 s |       0.8 s |   5.3× |
| 200 texts    | near |       16.0 s |       15.7 s |       1.9 s |       1.8 s |   8.6× |
| 1,000 texts  | near |       74.8 s |       62.7 s |       7.0 s |       6.4 s |   9.9× |
| 50 texts     | far  |       17.0 s |       16.9 s |       3.4 s |       2.3 s |   7.3× |
| 200 texts    | far  |       64.3 s |       64.8 s |       5.9 s |       5.9 s |    11× |
| 1,000 texts  | far  |        320 s |              |      24.5 s |             |    13× |
| 50 images    | near |        5.9 s |        5.9 s |       3.4 s |       3.4 s |   1.7× |
| 200 images   | near |       22.8 s |       25.3 s |      12.6 s |      12.6 s |   2.0× |
| 1,000 images | near |        170 s |        173 s |      99.9 s |      90.7 s |   1.9× |
| 50 images    | far  |       28.9 s |       29.1 s |      15.0 s |      15.0 s |   1.9× |
| 200 images   | far  |        113 s |        114 s |      61.6 s |      61.8 s |   1.8× |
| 1,000 images | far  |        562 s |              |       313 s |             |   1.8× |

Texts are 5–13 times faster, more at a far colo and with more files, because
their time was round trips. Images are about twice as fast, which is as far
as bandwidth allows: 200 images are 71 MB, 11.8 s at 6 MB/s and 59 s at
1.2 MB/s, against 12.6 s and 61.8 s measured. With no delays and no bandwidth
limit, the page itself needs 0.8 s for 200 texts (before: 1.8 s) and 2.9 s
for 200 images (before: 5.5 s). 1,000 images near took 91 s against a 61 s
bandwidth floor; that gap was not profiled.

To run the lab:

```sh
# The lab API, with the origins of the apps' dev servers.
cd apps/sync-server
bun x wrangler dev --local --port 5501 --config wrangler.lab.jsonc \
  --var BASE_URL:http://localhost:5501 --var APP_ORIGINS:http://localhost:5502
# Each app's dev server against it, e.g. in apps/arctic/Browser:
#   VITE_SHARED_API_URL=http://localhost:5501 bun x vite --port 5502 --strictPort
node scripts/file-batch-lab/bench.ts --app arctic --url http://localhost:5502 \
  --label after --n 200 --profile near --runs 3 --seed
bun scripts/file-batch-lab/transport.ts --n 200 --profile far --pattern single --parallel 32
```

## Not covered

- Arctic on iPhone and Mac keeps its files on the device and does not use
  these routes.
- Workbench Backup (`wb sync`) still downloads one file per request; its
  credential may use the batch route.
- Production numbers for the batch route need a deploy; the lab models
  production's delays but not its variance or HTTP/3.
