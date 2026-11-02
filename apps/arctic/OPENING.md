# Opening policy

One rule for every Arctic surface: the web app in `Browser/`, the iPhone app,
the share extension and the Mac app.

**Nothing that is stored waits on the network.**

1. **Stored data opens at once.** The app, the library, a stored text and an
   edit come from this device, with no request in front of them.
2. **Refresh runs behind.** A sync, a preview or a new version of the app starts
   after the page shows. It cannot block the page, and it does not replace what
   the reader is looking at.
3. **Anything not stored has a time limit.** When the limit ends, the app says
   so and offers a way forward. The table has every limit.

`navigator.onLine` and the system's connection state are hints. A dead network
often says that it is connected, so nothing that shows stored data depends on
them.

## What each step waits for

| Step | Surface | Limit | When it ends |
| --- | --- | --- | --- |
| Open the app, library, stored text | All | No network | Not applicable |
| Save or edit | All | No network | Waits in the outbox |
| Share → Save | Share extension | No network | The link is in the inbox at once |
| New version of the web app | Web | 30 s, behind the page | The kept version stays; next open tries again |
| Sync request | Web, iPhone, Mac | 30 s, behind the page | Backs off; edits stay queued |
| Account check | Web | 8 s; behind the page when an account is remembered | The remembered account stays open; a new browser shows sign-in |
| Text that is not stored | Web | 15 s | "Try again" |
| Publisher's page | iPhone, Mac | 25 s without an answer | "Retry" |
| Preview | iPhone, Mac | 20 s, behind the page | The card keeps its title; the next open tries again |
| Preview in the share sheet | Share extension | 8 s | Uses the sheet's title |
| Images | iPhone 8 s, Mac 15 s | Behind the page | The card shows no image |
| X payload for Reader | iPhone 12 s or 15 s | Reader only | Website stays available |
| Tags from Jev | iPhone, share extension | 25 s, behind the page | Tries again at the next foreground |

## How each surface does it

- **Web.** `public/sw.js` answers a page from its kept copy of the app, and
  refreshes that copy behind the page, so a new release shows at the second
  open after it. Only a browser with no kept copy goes to the network: its
  first visit needs one.
- **iPhone and Mac.** `ArticleStore` opens from SQLite before the first frame,
  and `LibrarySync` starts behind it. No opening step awaits a request.
- **Share extension.** The link goes to the App Group inbox as soon as the reader
  taps Save. The preview and tags in the sheet add to it and never hold it.

## Fonts

Fonts do not block an open on any surface:

- Arctic for the web uses system fonts only. It has no web fonts to fetch.
- The native Reader's fonts are in the app bundle, served by `arctic-font://`
  (`ReaderFontScheme.swift`), with `font-display: swap`. They need no network.

The font precaching work was for the Reader app (`apps/reader`), not Arctic.

## Checks

- `Browser/tests/opening.spec.ts` keeps the app's host, the account and the
  publishers open with no answer, and proves that the library opens, a stored
  text reads, and an edit holds.
- `testStoredLibraryOpensWhileTheAccountHoldsEveryRequest` proves the same on
  the iPhone. `testHeldPublisherGivesUpAndOffersRetry` proves the 25 s limit.
- `Browser/scripts/opening-lab.ts` measures paint, cards and text on good, slow,
  flaky, dead and offline networks, for each kind of start.

## Measured

The web app on one production build, as a phone-sized Chromium, 24 links, 3
runs of each. The numbers are medians, in ms, from the start of the open to the
first paint and to the first card. "Never" means a blank page when the test
stopped at 30 s. The slow network waits 2 s before each first byte, then sends
40 kB/s. On the flaky network, every second request hangs for 10 s and drops, and
the others are slow. On the dead network, a connection opens and no answer comes.

| Network | Start | Paint before | Paint after | Cards before | Cards after |
| --- | --- | ---: | ---: | ---: | ---: |
| Good | Warm | 40 | 28 | 53 | 35 |
| Good | Cold | 92 | 96 | 108 | 113 |
| Slow | Warm | 2,156 | 32 | 2,162 | 45 |
| Slow | Cold | 2,216 | 96 | 2,232 | 108 |
| Flaky | Warm | 2,146 | 28 | 2,161 | 40 |
| Flaky | Cold | 2,188 | 96 | 2,206 | 110 |
| Dead, looks connected | Warm | Never | 40 | Never | 57 |
| Dead, looks connected | Cold | Never | 112 | Never | 129 |
| Offline | Warm | 36 | 32 | 49 | 43 |
| Offline | Cold | 88 | 132 | 105 | 129 |

A browser that has never opened Arctic has nothing stored. It needs the network
for the first visit: about 23 s on the slow network, before and after. On dead,
flaky and offline networks that first visit fails, before and after.

On the iPhone simulator, a publisher that holds its page open took 64 s before
Retry showed, and now takes 30 s; each figure includes about 5 s of test
automation. The library opens with every account request held
(`testStoredLibraryOpensWhileTheAccountHoldsEveryRequest`). The simulator does
not establish the times of a physical device.
