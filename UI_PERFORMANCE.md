# Smooth UI: measure, prepare, render less

This guide records the techniques used in Arctic and the EPUB Reader. The target
is responsive input and stable content. On a 120 Hz display, one frame interval
is about **8.33 ms**; the app does not own all of that time.

Arctic became visibly smoother on the user's iPhone after the changes below.
We have not established sustained 120 rendered frames per second in every
condition. The [performance record](apps/arctic/PERFORMANCE.md) keeps the
measurements, build differences and validation limits.

## Measure the action that feels slow

Record an exact sequence: fresh launch → first Search opening → fast scroll
both ways → close → reopen. Measure a warm list separately from an import and
from first-time image downloads. Keep device, build configuration, data, cache
state and network conditions the same for comparisons.

Use three layers of evidence:

| Tool | Useful for | Does not prove |
| --- | --- | --- |
| In-app display-link counter | Finding callback stalls during a real gesture | Compositor delivery, touch latency or sustained 120 FPS |
| Time Profiler and focused spans | Finding expensive stacks and blocked stages | Which sampled work caused each dropped frame without correlation |
| Instruments animation-hitch capture | Checking rendered animation timing on the device | Performance for untested devices, data or network states |

Arctic's **Sort and filter → Frame diagnostics** samples callbacks in a bounded
ring and publishes only twice a second. The counter owns its observation state;
it must not make the library update every frame. It stops when disabled or
inactive. See [`LibraryFrameDiagnostics`](apps/arctic/Sources/LibraryFrameDiagnostics.swift).
Apple explains [hitch measurement](https://developer.apple.com/videos/play/wwdc2020/10077/)
and [ProMotion timing](https://developer.apple.com/documentation/QuartzCore/optimizing-iphone-and-ipad-apps-to-support-promotion-displays).

## Reduce invalidation before changing the renderer

Arctic uses SwiftUI lazy stacks with stable article IDs. It does not use
Telegram's custom list engine. Lazy creation reduces offscreen views; it does
not make a large parent view cheap to rebuild.

The important fix was to move frequently changing viewport state out of the
library's observation path. Small row modifiers report visibility to a separate
preload owner. Rows crossing the screen no longer invalidate the NavigationStack,
card buttons and context menus. Sorted projections and URL/ID indexes are reused
until the library revision or filter changes.

The same rule applies elsewhere: composer text belongs to the composer; a frame
counter belongs to its overlay; an animated border owns its clock. A small
visual change should not rebuild its surrounding screen.

Search keeps its native input mounted during normal transitions. Text layout and
measurements are reused with bounded caches. Large keyboard transitions suspend
speculative Reader WebView construction, while image and metadata work can
continue. Inactive result rows unmount instead of loading hidden images.

Source: [viewport and projection ownership](apps/arctic/Sources/LibraryPreloading.swift),
[search and thumbnail caches](apps/arctic/Sources/LibrarySearch.swift).

## Keep four image representations distinct

| Representation | Arctic implementation | Purpose |
| --- | --- | --- |
| Network original | Temporary download; not the persistent OG-image cache | Input to resizing |
| Compact master | At most 1,200 px; HEIC when available and smaller, otherwise JPEG; PNG for alpha | Reusable compressed source |
| Display derivative | Persistent 96/256/960 px JPEG or PNG; decode for the requested size | Icons, compact rows and large cards |
| Tiny preview | 24 px image, with its own small decoded cache | Brief blurred placeholder while a cached image becomes ready |

Downsample from compressed bytes with ImageIO off the main thread. Do not decode
a full publisher photograph and then shrink it in a view. A compressed 60 KB
image can still require several MB when decoded. Budget the memory cache by
decoded byte cost, not compressed file size.

The current native limits are 32 MiB for decoded display images, 1 MiB for tiny
previews and 128 MB for the disk cache. Downloads, image conversion and display
decode have separate bounded work queues. Native display derivatives use
JPEG/PNG to avoid repeated HEIC encoding. Saved Reader HTML uses JPEG/PNG for
WebKit compatibility. These are native codec choices; the web EPUB cover pipeline
uses WebP and BlurHash.

One controlled large-image fixture shrank from a 205,494-byte 1,200 px JPEG to a
57,818-byte HEIC. This is one example, not a publisher-wide compression estimate.
See [codec source](apps/arctic/Sources/PreviewImageCodec.swift) and the
[measured image table](apps/arctic/PERFORMANCE.md#measured-image-example).

An unseen URL has no local tiny preview until its first image download. Arctic
does not receive Telegram's immediate thumbnail bytes with each message. Show a
ready full image immediately; never delay it to demonstrate a blur. The loading
arc appears only after 250 ms and animates through Core Animation, not per-frame
SwiftUI state. Respect Reduce Motion.

## Preload a bounded working set

Use actual viewport intersection, not only a lazy row's appearance callback.
Arctic requests visible articles first, then two neighboring rows, capped at ten
article URLs. Image requests share downloads and decoded variants. When a row
leaves the working set, cancel its lease; preserve work another visible row
still needs. Visible requests go ahead of queued speculative work.

Reader HTML and WebViews are more expensive than image bytes. Arctic pauses new
Reader preloads during scrolling and keyboard movement, then waits 150 ms of
idle time. Images continue loading during scrolling. A click reuses prepared
work instead of starting its first database read, parse and WebView from zero.

Do not let an actor's expensive codec operation block unrelated cache reads.
Moving image conversion outside Arctic's disk-cache actor reduced a hot thumbnail
read under conversion load from 511.83 ms to 3.36 ms in a controlled Mac test.
That measures cache contention, not iPhone FPS.

## Separate fetching, persistence and publication

During Chrome import, metadata uses six workers overall and at most three per
host. Visible results batch for 120 ms; background results batch for 600 ms.
Publication pauses during drag/deceleration; fetching continues only until the
completed-plus-in-flight buffer reaches 48. User saves keep their durability.
Source dates remain intact.

In a loopback replay of 180 responses against 10,000 temporary records, completion
fell from 7.782 s to 4.024 s and publications from 52 to 7. No publishers were
contacted. These are Mac results. Replay bundled HTML and images locally before
increasing concurrency; variable websites make attribution difficult and should
not receive repeated benchmark traffic.

Use [the import replay](apps/arctic/Tests/bench-import-replay.py),
[1,000-photo scroll tests](apps/arctic/Tests/LibraryScrollPerformanceUITests.swift)
and [Reader preparation tests](apps/arctic/Tests/ReaderPerformanceUITests.swift).
The replay script documents its SwiftSoup argument and baseline setup.

## Preserve geometry and state

Reserve known image/title space while metadata loads. Avoid a large empty region
for optional tags. Bound title lines, retain stable IDs and update only changed
content. Do not replay image-arrival animations during fast scrolling.

For a distant folder tap, decide before starting native paging. Arctic replaces
the destination directly under an outgoing snapshot; it does not scroll through
all intermediate folders. Keep the controller and frame stable. See
[`LibraryPager`](apps/arctic/Sources/LibraryPager.swift).

For Reader navigation, scope async extraction, caches and callbacks to the current
document identity. Preparing a linked page must not overwrite its saved parent.
A fast but incorrect restore is not a performance improvement.

## Predict text heights for long lists

A virtual list needs the height of rows that have not rendered.
[Pretext](https://github.com/chenglou/pretext) measures text with canvas and
counts lines with arithmetic, without DOM layout. Use it in one of two ways:

- **Layout authority.** The app places every line itself, so the prediction is
  the rendering. Reader's [pagination](apps/reader/docs/0001-pagination-v2.md)
  works this way.
- **Prediction.** The browser renders the row, for example Markdown with code
  and tables, and Pretext only estimates it. The row's own height replaces the
  estimate after it renders. Med's [session thread](apps/med/docs/SESSIONS.md)
  works this way.

For a prediction:

- Read fonts, line heights, and margins from a hidden sample of each part.
  Clear Pretext's cache when a font finishes loading, because it keeps widths
  by font name.
- Pretext counts lines; the boxes around them are your model. In Med, plain
  paragraphs matched the browser in all 337 samples in four themes, which
  included system fonts and a monospace font. The errors were in the model:
  inline code (until it used rich-inline items with the code font and
  padding), margins that collapse, list gaps, and table columns.
- A monospace font does not make the estimate more exact. Text measurement
  was already exact; the remaining errors were in the model.
- Load the same CSS in tests as in the app. A style sheet that only another
  module loads hides errors.
- Keep the first row that starts in view in place. A row cut at the top of
  the view can still change size.
- A render can come between a scroll and its scroll event. If the view moved
  since the anchor was saved, use the reader's new position.

## A repeatable acceptance check

1. Test a cold import with controlled local responses and a warm long list without
   clearing its caches. Include rapid reversals, Search and repeated reopen.
2. Check visible content, scroll position and stored state. Capture screenshots
   for layout; use traces for timing.
3. Profile an optimized build on the target device. Include cold images, memory
   pressure, background/resume and the app's accessibility modes.
4. State what the evidence proves. Simulator gesture duration is not FPS. The
   original Arctic library comparison changed Debug to Release; its source and
   compiler effects cannot be separated. Search comparisons also used different
   gesture timing. User feedback confirms feel, not an exact frame-rate gain.

For web Reader spans, workers and first-content measurements, use the
[Reader diagnostic guide](apps/reader/src/features/reader/README.md) and
[web performance evidence](apps/reader/src/features/reader/PERFORMANCE.md).
