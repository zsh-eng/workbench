# Download validation — 3 October 2026

Measured on the development Mac using the Bun download service and four public
URLs already present in the Chrome reading-list seed. Each first request used
an empty service cache. Requests ran sequentially. Timings cover network fetch,
Defuddle extraction, and disk cache write; they do not measure reader paint time.

| Article | Path | Words | First request | Immediate disk-cache read |
| --- | --- | ---: | ---: | ---: |
| [File over app](https://stephango.com/file-over-app) | HTTP | 376 | 364 ms | <1 ms |
| [Writes and Write-Nots](https://paulgraham.com/writes.html) | HTTP | 554 | 1,321 ms | <1 ms |
| [Why Europe doesn't have a Tesla](https://worksinprogress.co/issue/why-europe-doesnt-have-a-tesla/) | HTTP | 4,471 | 420 ms | <1 ms |
| [Exploring Notion's Data Model](https://www.notion.com/blog/data-model-behind-notion) | HTTP | 2,640 | 1,751 ms | <1 ms |

All four supplied readable text in their initial HTML, including the Notion
page. Chromium did not start. These are single observations on one network, not
percentile measurements or a guarantee that every saved link can be extracted.

The service integration test supplies an HTML shell whose external script adds
article paragraphs after 150 ms. The real headless fallback extracted it in
about 0.85 seconds on the first validation run, including browser startup.
Image requests and a scripted request to a separate private server never reached
their destinations. This is a controlled fixture, not a live-site benchmark.

Browser interaction tests exercise the actual service through an isolated
publisher. They verify that Save returns before extraction completes, old notes
survive the IndexedDB schema upgrade, downloaded text reopens without the API,
Delete/Undo restores the cached body, and a late result cannot revive a deletion.
Native Swift and its WebView extraction path are unchanged.
