# @workbench/background-activity

Background work that the apps can show: downloads, uploads, a sync pass and
the app update, as one list of jobs with progress. The package exports
TypeScript source and works with React 18 and 19.

- `@workbench/background-activity`: the manager (`createActivityManager`),
  the rules for what to show (`summarizeActivity`), words (`describeJob`),
  and sync as a job (`syncAsJob`). No React, no DOM beyond `navigator.onLine`.
- `@workbench/background-activity/react`: `useActivity`, `useJob`,
  `useJobs`, `useActivitySummary`, `useNow`.
- `@workbench/background-activity/service-worker`: `createAppUpdate`, an
  update that downloads in the background and waits for a safe moment.

[MODEL.md](docs/MODEL.md) says what shows and when. [STATES.md](docs/STATES.md)
has the state chart and the rules a TLA+ model checks.

## Why beside local-sync, not in it

`@zsh-eng/local-sync` is the record protocol: a versioned, built package
whose core imports no React and no browser storage, and whose README keeps
binary transfer in the apps. This package is the apps' scheduler for work
around sync: it runs file transfers, owns the app update, and reads sync's
status through `syncAsJob`, a structural adapter, so neither package
depends on the other. It is source-only and private, like `activity-time`.

## Jobs

```ts
import {
  createActivityManager,
  JobError,
} from "@workbench/background-activity";

const activity = createActivityManager({
  kinds: {
    book: {
      lane: "network", // jobs in a lane share its limit
      persist: true, // survives a reload; input and checkpoints are JSON
      retry: { attempts: 3, initialMs: 2_000, maxMs: 60_000 },
      title: (book: { id: string; title: string }) => book.title,
      async run(book, { signal, progress, checkpoint, resume }) {
        progress({ phase: "downloading", bytes: 0, totalBytes: 4_600_000 });
        // ... honour `signal`; throw on failure, or a JobError to name it.
      },
    },
  },
  lanes: { network: 2 },
  persist: { storage: localStorage, key: "app-activity" },
  paused: true, // resume() after the first paint
});

activity.start("book", book, { id: `book:${book.id}`, origin: "user" });
activity.cancel(id);
activity.retry(id); // a failed job again, or a retry now
activity.dismiss(id); // a finished or failed job off the list
activity.track("sync", syncAsJob(syncController)); // a job owned elsewhere
```

- **One job per subject.** The id names the subject. Starting an id that is
  running joins it; a failed one starts again; a done one is replaced.
- **States:** `queued`, `waiting` (`waitingFor`: network, a safe moment, a
  sign-in), `running`, `retrying` (`retryAt`), `failed`, `done`,
  `cancelled`. Done and cancelled jobs leave the list after ten seconds.
- **Your work first.** In a lane, `user` jobs start before `app` jobs, then
  oldest first.
- **Offline.** `navigator.onLine === false` is trusted: running network jobs
  stop and wait, and start again when the network returns, with no attempt
  used. A failure while the device says online retries with backoff (75–100%
  jitter); "online" again skips the wait.
- **Failures.** `classifyJobError` reads HTTP statuses (401/403 need a
  sign-in, 408/429/5xx retry, other 4xx stop), fetch's `TypeError` and
  timeouts (network), and a full disk (storage). A kind can pass `classify`
  or throw `JobError`.
- **Progress** is items (`done`, `total`), bytes (`bytes`, `totalBytes`) and
  a `phase`. Report as often as you like; the snapshot changes at most every
  100 ms. A job keeps its object until it changes, so `useJob` re-renders
  only for its own job.
- **Reloads.** A persisted kind's job is saved when it starts and on each
  change, with its last checkpoint (at most every 0.5 s). The next page
  brings it back queued, or failed as it was. Two tabs each run a restored
  job; the app's own deduplication (for example by file id) must cope.
- **Main thread.** The manager is bookkeeping and stays on the main thread.
  A job moves its own heavy work off it where that helps: the Reader's
  fflate already unzips in workers. Spaced's images are network-bound; a
  thumbnail worker is worth it only if a measurement shows decoding hurts.

## What to show

`summarizeActivity(snapshot, now)` returns `shown` (most urgent first),
`active`, `fraction` (the shown jobs together), `attention`, `busy` and
`nextChangeAt`. Work you asked for (`origin: "user"`) shows after 0.5 s and
confirms for 1.5 s when done, if it showed. App work stays quiet unless it
sets `attention`. A failure stays until it is retried or dismissed.

```tsx
import {
  useActivitySummary,
  useJob,
} from "@workbench/background-activity/react";

const job = useJob(activity, `book:${book.id}`); // a cover that fills
const summary = useActivitySummary(activity); // a glyph and its sheet
```

## The island

```tsx
import { ActivityIsland } from "@workbench/background-activity/island";

<ActivityIsland
  content={{
    mark: "progress",
    fraction: 0.42,
    label: "Restoring history",
    detail: "42%",
  }}
  status="Restoring your review history…"
>
  <AppIcon />
</ActivityIsland>;
```

Work you wait for, such as a new device's restore, as one dark pill that
grows out of `children` (the app's own mark), changes its words and ring in
place, confirms `done` and folds back. `islandStep` is its timing as a pure
step: nothing for 0.5 s, at least 0.6 s once shown, `done` for 1.5 s if it
showed. Marks: `progress` (a ring; `fraction: null` sweeps), `waiting`,
`attention`, `done`. `status` is heard once per stage. The island takes no
taps, so they reach the mark. Colours and where it grows from are custom
properties (`island.css`): an app sets `--ba-island-surface`, `-text` and
`-edge` from its own tokens per theme; without them the island is near
black in light mode and a raised grey with a hairline in dark mode, with
its text at AA in both. The defaults follow a `.light` or `.dark` class on
the root, else the OS; an app with other themes (Reader's `night` and
Flexoki, Arctic's `data-mode`) sets its own. With reduced motion it cross-fades at its final
width. Spaced uses it; Reader and Arctic have mock-ups in Spaced's Elements
page.

## App updates

```ts
import { createAppUpdate } from "@workbench/background-activity/service-worker";

const update = createAppUpdate({
  container: navigator.serviceWorker,
  register: () => navigator.serviceWorker.register("/sw.js"),
  policy: () => (calm ? "wait" : "now"),
  readManifest: () => fetch("/sw-precache.json").then((r) => r.json()),
  caches,
  reload: () => location.reload(),
  storage: sessionStorage,
});
update.apply(); // at a safe moment
activity.track("app-update", update.asJob());
```

The worker must wait after it installs and take over on
`{ type: "SKIP_WAITING" }`: Workbox's generated worker with
`skipWaiting: false`. While it installs, the store counts the new version's
precache entries in Cache Storage against the manifest, so the download
shows "1.2 of 3.4 MB". `now` switches and reloads as soon as the update is
ready, as an auto-updating PWA does; `wait` holds it until `apply()`. A
switch made by another tab sets `takenOver` and reloads only under `now`.
After an apply, the next page's `justUpdated` is true once.

## Development

`bun test ./test` in this directory. The tests run the manager on a fake
clock and network, and the update store on fake service workers.
