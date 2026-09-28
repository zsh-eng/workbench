# Arctic — native article reader

The native Mac workspace has its own [Mac guide](Mac/README.md) and
`ArcticMac.xcodeproj`. The iPhone app and share extension use the project below.

The [sync design](SYNC_DESIGN.md) covers the proposed iPhone/Mac architecture,
account isolation, conflict rules, file transfer and staged local migration.
It is a proposal; live sync and the storage migration remain inactive.

Open `ArticleReader.xcodeproj`, select the **ArticleReader** scheme and an iPhone
simulator, then Run. Requires Xcode 26+ and iOS 17+. For a physical iPhone, select
the same signing team for **ArticleReader** and **ArticleShare**, then register/
enable `group.com.zsheng.ArticleReader` in App Groups for both targets. Both use
`ArticleReader.entitlements`. The simulator build can use ad-hoc signing.

- **Sort and filter → Article replay** opens a taller, automatically looping native share/tag/save scene for An Alien Mind. It uses bundled artwork and a measured Jev result, makes no network calls, and does not save to the library. Close it with the top-right cross; Reduce Motion shows its completed state.
- First launch offers three optional setup pages: Share, paste permission, and Jev automatic tagging. Replay them from **Sort and filter → Getting started**.
- Copy an HTTP(S) link and enter Arctic. Choose **Save** or **Open** in the clipboard banner above Search. Already-saved links offer only Open.
- **Continue reading** appears in that same space for the most recent saved,
  unarchived article with a Reader checkpoint between 1% and 95%. Continue restores
  its Reader position, including offline. A copied link takes priority. Dismissal
  survives relaunch until the next visit to that article. The prompt stays
  hidden during search and selection; it does not fetch article metadata.
- Cards use an inset Open Graph image, a source badge at the upper left, and a
  material caption at the bottom. A one-line title can include one subtitle line;
  longer titles use at most two balanced lines with an ellipsis and no subtitle. Links without images use a compact
  text card. The previous gradient design remains in `GradientArticleCard` as an
  unused alternative. A failed preview does not prevent opening the link.
- Tap an article to open a full reading page. Use the native Back button or swipe from the left edge to return.
- The bottom controls provide Back, Forward, the lightning Reader / Website icon,
  a bookmark toggle to save or unsave, and Aa for Reader appearance. Unsave keeps
  history, tags and cached Reader content; Remove link deletes the record and copy.
- The library follows system light/dark mode. Reader defaults to the system font with
  a bold title, optional subtitle/byline/avatar, and lead image before the body.
  Missing metadata is omitted. Reader uses bundled Defuddle and DOMPurify. Website restores
  the live page without reloading it. Tap the **Aa** icon beside Reader to open
  live Reader appearance controls (five fonts, size, side padding, line spacing,
  and System/White/Paper/Ink/Night palettes). Tap minus or plus for precise steps.
  The article remains visible and scrollable.
  Aa also enters Reader mode when opened from the publisher's page. Reader keeps
  the system text-selection menu; Copy writes the selected plain text through UIKit.
- Search titles, descriptions and domains. Results use compact rows with matched
  text highlighted. A one-line title allows up to two subtitle lines; longer titles
  use two lines alone. Clearing or cancelling restores the library.
- **Saved** is the default inbox. The top folder strip switches between Saved,
  Favourites, Downloaded, article tags, History, then Archive. History and Archive use compact
  search-style rows; Saved, Favourites, Downloaded and tags retain image cards. Tapping any folder crossfades directly. Swipe horizontally to move between adjacent folders. The bottom has one native search field in a glass capsule, with a soft scroll edge on iOS 26 and a material fallback on older iOS. The field stays mounted from launch so the first tap can focus it directly.
- **History** records each URL you view, most recently viewed first, including links
  followed inside articles. Opening does not save a link. Preloading does not add history.
- **Favourites** includes favourite saved articles, including archived ones. In a tag,
  tap the star beside the folder strip to show only favourites, including archived
  matches. The ordinary tag view remains limited to the inbox. Favourites are a
  separate flag, not a tag. Unsaving clears that flag; archiving preserves it.
- Long-press a saved article to **Favourite** or **Unfavourite**, edit **Tags**, archive, or remove it. Archived links
  retain their tags and history. **Move to Saved** restores them to the inbox.
  Both actions show a six-second **Undo** banner, including bulk changes and
  archiving from Reader. Undo changes only archive status. VoiceOver users can
  dismiss it explicitly; its timer pauses while the app is inactive.
  Select supports bulk archiving and confirmed deletion. Tags use a compact sheet
  that grows with the tag list, up to 360 points.
- Reader controls use the native navigation bar, safe-area bars and soft scroll-edge
  blur on iOS 26; older systems use translucent material. The shared title and menu
  stay outside the sliding page stack and crossfade in place when Reader opens or
  closes. UIKit owns the Back button and interactive back swipe.
  Library and search crossfade in place in 180 ms (100 ms with Reduce Motion).
  Typing does not trigger this transition.
- Visible library/search rows and their two nearest neighbors in each direction
  preload their Reader documents, with a ten-article window plus the last opened
  page retained. Cached HTML and fonts prepare before a tap; opening reuses that
  same WebView, including work still in progress. Two preparation slots load
  downloaded documents only. Uncached publisher/Unwall pages start when opened,
  not during library startup or scrolling. The queue pauses during reading,
  onboarding, and modal settings. Backgrounding and memory pressure release
  nearby browsers while retaining the last opened Reader.
  Metadata remains in memory; opening does not query a remote database.
- **Downloaded** includes saved articles, including archived articles, whose Defuddle
  Reader view has been written to disk. Cached articles open from their styled local
  HTML in any folder, without briefly showing the website. New HTML declares UTF-8;
  older cached bytes also load as UTF-8, preserving quotes, accents, and CJK text. Reader and Website
  crossfade while preserving their separate scroll positions. Website loads on demand;
  the cached Reader stays visible until it is ready. Stored text, code and embedded
  header images do not need the website. Appearance controls
  still work. The two bundled custom fonts load from a fixed local asset scheme
  and are no longer copied into each saved HTML file. Reader text does not wait
  for decorative images or body-image load events. Inline article media can still
  require a network connection. Deleting a link removes its stored Reader view;
  archiving keeps it. New pages extract at DOM readiness without waiting for
  publisher images or analytics. Reader is also available during loading once
  the main document has committed; extraction still needs enough article text.
- Reader and Website share an explicit article history, including the initial
  offline Reader. Following a link uses its own save state, notes and HTML target.
  Back and Forward restore that identity; a detour cannot replace the original
  saved article. Website form/scroll state is not retained across history loads.
- Leading article images stay in their editorial position and suppress the OG
  hero. Large standalone images extend through the text gutter. Wide media caps
  at 60% of viewport height; other body images cap at 70%, without cropping.
- Preview images and favicons share a memory cache and a durable 128 MB disk cache.
  Reader lead images and author portraits use the same cache; images are downsampled
  to at most 1200 pixels. Thumbnail decoding runs off the main thread, with at
  most three concurrent image jobs. Requests without consumers are cancelled.
  Decoded thumbnails have a separate 32 MB memory limit. Oldest-used disk files
  are evicted when the limit is reached.
- Code blocks with supported language labels receive bundled highlight.js colouring.
  Unknown languages remain plain code. No remote script is loaded.
- Reader restores the last text passage after relaunch, including offline. Checkpoints
  are device-local and stored separately from the article index after scrolling settles
  or Reader closes; Website scrolling never updates them. A paragraph anchor handles
  text-size changes, with progress as a fallback after article text changes.
- The page menu provides Copy link, Share, native Find in page, Open in browser,
  Favourite, Archive article, **Reading time**, **Refresh Reader**, Reload and Try Unwall.
  Refresh Reader uses the current page DOM, or loads the source if only cached
  HTML is open. A failed extraction keeps the previous saved document.
  A saved, unarchived article also offers **Archive and close** after you scroll near
  its end. Both archive actions return to the library only after storage succeeds.
- Empty folders use muted ink-wash landscapes and botanical studies: a shoreline,
  sheltered pine, snow trail, layered ridges, plum branch, reeds, pale sun and bird.
  Transparent edges and native multiply/screen blending let the light or dark
  surface act as the canvas. The eight local assets are capped at 720 pixels
  (about 1.3 MB total); constrained layouts prioritize text.
- Long-press a card to refresh its preview or remove the link.

This app stores link metadata in an atomic JSON file under Application Support,
with separate HTML files for downloaded Reader views. Download status is committed
only after the HTML write succeeds. Preview images are reused from local storage.
Highlights and notes use separate atomic record files. Archive is library status
only. Website cookies use WebKit's persistent store. There is no active account
or cloud sync UI. The staged sync package and Worker routes are described below;
they do not replace the current local storage path.

## Highlights and notes

The bottom **Add note** button turns the Reader toolbar into a composer. Notes
can refer to the article without selecting text. Send appears only for nonempty
text. Tap the article to lower the keyboard and return to the toolbar; opening
the input again resumes that draft while its browser is retained. **Send** publishes
immediately and writes an atomic record off the UI thread. Failed writes keep the
text visible with Retry; later edits and deletion are ordered after pending sends.

For an unsaved article, the selection menu says **Save & highlight** and a new
note's send button says **Save & keep note**. A quoted draft creates neither an
article nor a highlight until Send. Existing annotations remain accessible and
editable after unsaving; editing them does not save the article again.

Select text and choose **Add note**, or
use the highlight toolbar, to include a compact two-line quote with its colour.
The top Notes button opens the article conversation with full note text. Empty
conversations open at medium height. Editing uses explicit **Save** and **Cancel**.
**Remove highlight** keeps an existing note; **Delete note** keeps its highlight.

The library notebook includes full notes, short quote previews, search and a
small source link. Its filter/sort work uses cancellable background snapshots;
stable IDs and lazy rows keep offscreen note views out of the scrolling path.
Text entry stays in the small composer view and does not rewrite records or
invalidate the whole Reader for each keystroke.

Quoted passages store their exact text, nearby context and a UTF-16 position
hint. Standalone notes omit the quote. When regenerated HTML has changed,
ambiguous matches stay available without attaching to unrelated text. Removing
the final highlight/note writes a deletion marker. These records are local;
annotation sync is not active. A damaged record is kept and reported without
preventing other records from loading.

## Estimated reading time

Open **Sort and filter → Reading stats** for the library, or
**Page options → Reading time** for the current article. The rounded sheet shows
seven days of activity, selectable day bubbles, today's time, weekly articles/visits,
and an all-time total. Visits are grouped by their start day in the current
time zone. Summaries use one in-memory snapshot when opened; no timer drives
the chart or reads article content. Only a
saved article's visible Reader content counts, including archived articles.
Website mode, loading, background, notes and appearance controls pause tracking.
Gaps longer than 120 seconds are discarded in full. Saving starts tracking from
that point; unsaving stops it without deleting earlier time.

Records use separate local files and background checkpoints. They are not synced.
See [the reusable session guide](../../READING_TIME.md) for rules and tests.

## Favourites

Use an article's context menu or Reader's page menu to favourite it. Favourites
has its own folder and includes archived articles. Within a tag, the star button
shows matching favourites, including archived ones. Archiving preserves this
flag; unsaving clears it. Favourite state is independent of the tag catalogue.

## Sync implementation status

`Sync/` contains the staged native protocol, account-scoped journal, authenticated
transport and Google sign-in helper. `../../packages/arctic-sync-server/` contains isolated Worker/D1
routes and release instructions. The main app still uses its existing local JSON
library. Account UI, the live storage migration, annotation sync and durable HTML
upload intent are not integrated. No production Worker release or remote Arctic
migration has been applied as part of this work.

See [release boundaries](../../packages/arctic-sync-server/README.md) and the
[measured storage limits and migration proposal](Sync/PERFORMANCE.md) before
continuing integration. A 10,000-article JSON journal still has excessive write
cost. Do not activate it as the live library store. The proposed live migration
requires the explicit approval recorded in `OVERNIGHT.md`. Jev keys stay in the
device Keychain and are never sync data.

## Open from another app

The registered URL is `articles://open?url=<percent-encoded HTTP(S) URL>`.
For example: `articles://open?url=https%3A%2F%2Fstephango.com%2Fsaw`.
A Shortcut can URL-encode its input, append it to this prefix, and Open URLs.
This opens a reading page and records History without saving it to the inbox. Invalid schemes
and non-web targets are ignored. It does not intercept ordinary HTTPS links.
The native Share extension saves links through an App Group inbox; default-browser support needs Apple's
entitlement and must render the original destination by default (our automatic
Unwall routing would need to change). Universal Links require the domain owner's
associated-domain file.

## Two quick entry paths

- **Share → Arctic → Save:** the extension first shows the link, then reveals
  its title and image in reserved space. Completed tags appear above the card,
  with no empty tag area when there are none. Cancel and Save stay at the bottom;
  saving never waits for a publisher. With automatic tagging enabled, rich metadata
  and Jev classification start while the preview is open, before Save. Save writes
  an immutable local inbox event and reuses the running request or completed tags.
  Cancel discards the unsaved result. Done is available immediately. A separate
  completion event carries tags, so dismissal cannot lose the saved link
  or race with the main app consuming it. The app resumes incomplete work on entry.
- **Copy link → open Arctic:** on app activation, detect a probable web URL,
  then read it through the normal iOS paste-permission flow. A small clipboard
  banner appears immediately. Pasted URLs have all query parameters removed, while
  keeping their path and fragment. Unsaved links offer Save and Open; saved links
  offer only Open. Save adds the link without opening Reader.
  The banner shows its title and thumbnail as they arrive. The image is cached before the copied page starts
  its background preload. Paste, save and preload share one metadata request.
  With tagging enabled, the preview also starts Jev before Save. Its bounded
  in-memory result cache shares requests with the saved queue; Dismiss never
  creates an article or persists tags.
  Tapping Open takes priority and does not wait for the preview. Open uses that
  prepared browser; Open records History; the Reader bookmark saves the link; Dismiss does neither. Each clipboard
  change is checked once, including across launches. Non-link text is ignored.

Automatic clipboard reading can cause iOS to ask **Allow Paste**. If access is
denied, no page can preload; share the link to Arctic instead.
Allow Paste in the prompt is not a permanent grant. For ongoing access, choose
**Settings → Apps → Arctic → Paste from Other Apps → Allow**.
The app does not bypass the OS permission or change the clipboard. Preloading
visits the copied URL (and Unwall where configured) before Open is tapped.

## Automatic tags and onboarding

Onboarding bundles the real title, byline, and Open Graph photograph from Elizabeth Rush’s [Glacial Longings](https://emergencemagazine.org/essay/glacial-longings/), published by Emergence Magazine. Its taller article, share, and tagging scenes use local assets only; replay does not access the publisher or Jev. The source credit is in `THIRD_PARTY_NOTICES.txt`.

Onboarding uses three concise, replayable native demonstrations: sharing from Safari, choosing Allow in Settings, and tags appearing on a saved card. A single pointer travels between controls, pauses, then presses with a tap ripple.
The share replay shows the URL while its preview loads, then expands upward above
fixed Save and Cancel buttons. The demonstrations follow the system appearance and use a completed static scene with Reduce Motion. Arctic uses a glacier-blue accent and separate light/dark ice-shelf app icons. Page two
opens the app's Settings page; it cannot grant or inspect iOS paste permission.
The paste setting may appear only after the first cross-app paste prompt. All
pages can be skipped, including key setup, without blocking local reading.

**Sort → Automatic tags** verifies, replaces, or removes a user's Jev API key.
The key stays in the shared iOS Keychain with device-only accessibility; both app
and extension need the shared keychain-access-group entitlement when signing.
Both entry paths start classification as soon as rich metadata is ready; thumbnail
loading does not block tags. No developer key is bundled. Enabling tagging sends
previewed links’ titles and metadata descriptions directly to TypeSafe over HTTPS,
including before Save. Available introductory prose adds up to 180 words, even
when the description is long. This context is capped at 2,500 characters and
stays separate from the displayed subtitle. The excerpt uses article/main
paragraphs, with a body-paragraph fallback; it is not the full Defuddle document.
Metadata and prose use the same response, capped at 2 MiB and parsed off the main
actor. Fetches have a resource deadline of 8 seconds in Share and 20 seconds in
the app. A blocked HTML fetch in the extension can fall back to the available
Link Presentation title.
**Sort → Tag existing articles** refreshes old context through the saved queue,
first using a bounded cached Reader file when available, otherwise refreshing
metadata. Saving a Reader copy can enrich description-only context without a
second publisher request. Short catalog names retain their IDs, classification
questions and fingerprints; old stored names map at display time, without a
library rewrite or automatic retag caused by the rename. Prepared main-app
requests are keyed by input and credential revision, capped at eight entries,
and never persist an unsaved article. Changing the key or enabled setting
invalidates reuse of earlier requests.

`Shared/ArticleTagging.swift` defines 12 fixed categories and makes one request
with independent yes/no questions. The initial threshold of 0.75 is provisional,
not a measured accuracy guarantee. The model is pinned to `jev-1.13.0`. Tagging
identity includes the bounded input, category descriptions, model and threshold;
completed empty results are stored too. Changes in input can trigger a new request.

Manual additions and rejected automatic tags persist across retries. Results are
merged into the latest record; deletion, unsave, new metadata, key replacement,
and explicit re-tagging invalidate stale work. Network failures leave work pending
until a later foreground activation. Invalid credentials pause the queue and show
an error in Automatic tags. Tag completion uses the original soft gradient border, which hands its glow to
the tag outlines before their labels appear, and
an Edit tags action. Only the border and pills use the animation clock; card text and images stay outside it. Completed Share tags are written immediately, before the reveal. The receipt is marked presented only after the tags appear. Results already shown in the share extension carry a durable receipt, so importing or refreshing their metadata does not repeat the tag notice. Unfinished shared work still shows feedback when the app finishes. Reduce Motion uses static/fade feedback.

Simulator tests use separate article files and fixture classifications, never a
real Jev key or request. `-test-onboarding -reset-onboarding` exercises first run;
`-test-key-success` and `-test-key-failure` exercise setup with in-memory credentials.
`-test-tagging`, `-test-tagging-delayed`, `-test-tagging-held`, and
`-test-tagging-failure` cover persistence, controlled in-flight edits, and interrupted
requests. The DEBUG-only reserved `fixture.example` share preview
shows deterministic metadata; real publisher preview checks remain separate.

## Import Chrome's reading list

1. In Google Takeout, select Chrome and its Reading list data, then export.
2. Unzip the download and put its reading-list HTML file in Files on the iPhone.
3. Tap **Sort → Import Chrome reading list** and select the HTML file.

The importer saves HTTP(S) links and titles, preserves Chrome's `ADD_DATE` Unix
seconds, skips duplicates and ignores non-web links. Existing saved dates remain
unchanged. A history-only link restored to Saved uses its source import date.
The local import completes before network work starts. Up to three metadata
requests run concurrently, with visible and nearby rows first; imported images
load as their cards become visible. The import sheet shows progress and article
counts for each tag, instead of a separate automatic-tag notice for every link.
The batch receipt survives a restart. It does not import read/unread state or
change Chrome. A bookmark HTML export also works;
choose only the file whose links you want to add. ZIP and JSON are not accepted.
Availability depends on the Chrome data stored in your Google account.

Sources: [Chrome export help](https://support.google.com/chrome/answer/10248834)
and [Google's Reading List HTML schema](https://developers.google.com/data-portability/schema-reference/chrome).

## Test scope

Prefer production integration paths and observable results. Keep one owner for
normal behavior: native UI tests own saved/history/favourite filters, paste
choices, and manual tag edits; Web tests own extraction, text anchors, and paint.
`Sync/Tests` owns durable transport/journal behavior. The isolated domain-sync
harness tests the dormant repository, not live ArticleStore sync.

Keep small lower-level checks only where normal UI flows cannot expose the
failure: malformed font requests, codec alpha/orientation/MIME handling,
calendar boundaries, cancelled work, storage failures, and authentication
validation. Do not repeat accessors, derived labels, or framework encoding tests.
Use real files and the shipping implementation for persistence checks. Existing
source-extraction harnesses are limited checks, not proof of app wiring.

Throughput is opt-in. Pass `--benchmark` to `Tests/check-reading-list.py` for
10,000 imports, use `Tests/check-article-sync.py --performance --configuration
release` for journal profiling, or set `ARCTIC_RUN_BENCHMARKS=1` in the Mac test
scheme environment for cold/warm timings. Normal fixtures stay small. Keep the
large native scrolling fixtures: they exercise list virtualization rather than
repeat a small-list assertion. None of these timings establishes device FPS.

## Build and checks

The Xcode project is independent of the parent web app. Xcode resolves the pinned
SwiftSoup package. The JavaScript bundle is checked in, so Bun is needed only
when changing the extraction code:

```sh
cd apps/arctic/Web
bun install --frozen-lockfile
bun run build
```

From the repository root, run `bun run test:arctic-web` for extraction,
annotations, and rendered reading-position checks.
These use the repository’s Playwright Chromium installation and local fixtures.

From the repository root (replace the simulator name if necessary):

```sh
xcodebuild -project apps/arctic/ArticleReader.xcodeproj \
  -scheme ArticleReader -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath /tmp/article-reader-build test CODE_SIGN_IDENTITY=-
xcrun swift-format lint --strict apps/arctic/Sources/*.swift apps/arctic/Tests/*.swift apps/arctic/Shared/*.swift apps/arctic/ShareExtension/*.swift
```

UI tests use local fixtures and a separate `test-links.json`. They cover preview
metadata, saving and removal across launches, Reader bookmark toggles, end-of-article
and menu archiving, browser history, reader switching,
article-frame extraction, disabled navigation controls, folder swipes, stored Reader
views across an offline restart, short/long/no-image cards, compact tags, page back navigation,
search and native-file-picker HTML
import dates and aggregate tag counts, clipboard suggestions, Share extension
saving, highlights and notes, offline fonts, 1,000-row search/scroll behavior,
background/resume and the absence of speculative publisher requests. Clipboard UI tests use
app-written simulator fixture text, so cross-app Allow Paste prompts still need a
physical-device check. The import test stages a sample HTML file in Documents in debug builds
only. Screenshots are attached to test
results. These checks do not prove publisher or Unwall availability.

For an opt-in live check, prefix the test command with
`TEST_RUNNER_ARTICLE_READER_LIVE_URL=https://stephango.com/saw` and add
`-only-testing:ArticleReaderUITests/ArticleReaderUITests/testLiveArticle`.
On 2026-09-19, this article passed both directly and through
`https://unwall.app/stephango.com/saw` in the iPhone 17 Pro simulator. Preview and
reader screenshots were inspected. Physical-device and paywalled-publisher
checks remain open.

## Discovery and passage images

The Saved shelf opens NY Times, Financial Times, Economist, New Yorker and
Atlantic homepages through the existing Unwall route. The actual publisher marks are bundled assets;
the shelf makes no favicon requests. [Asset sources](Design/publisher-marks.md) record provenance.
News has two states: three small overlapping publisher circles beside the Arctic
mark/name, or a publisher row above the folder tabs. In the compact state,
the mark and name shift right to make room for the circles. Tap the header or pull
down at the top by 44 points to open the row; the pull gives one medium haptic.
A small pull uses the native bounce and stays closed. An upward drag, another tap,
or leaving Saved closes it. News lives outside the article pager: opening it moves
the tabs and pager down together by 128 points without changing a page's scroll
position. The tabs and news follow the list's native top bounce through a read-only
scroll observation. Only those small header views observe per-frame changes.
The news row owns a floating glass panel with a gap above the tabs; neither the
panel nor its horizontal scroller shares the article pager's background or gestures.
Bubbles fan out with short staggered springs, while the panel scales/fades. Their
fixed hit targets and the article list do not take part in those springs. Removing
the row cancels pending animation starts. A 240 ms transition handles the layout;
Reduce Motion skips the bubble springs, fades the news and changes
the brand position immediately. There are no flying icon copies, scroll-inset
changes, or display-link writes to scroll offsets. Publisher availability
requires a connection. A publisher shortcut starts a fresh website visit, even
when that homepage has downloaded Reader content. In-page URL changes get their
own history and article identity, so saving a linked article does not replace
the homepage's Reader content.

**This week** shows articles favourited from Monday to Sunday in the current
time zone, including archived favourites. **All favourites** also includes
older favourites without a recorded date; Arctic does not invent dates for them.

Tap **Share passage** in the selected-highlight toolbar, or select **Share passage**
in a highlight/note menu. **Copy text** copies the full passage unchanged.
**Text + link** opens the native share sheet with the full passage and its source
URL in one text item. These actions remain available when an image cannot fit
or is still loading. **Share image** exports the selected poster card.

The note input uses fixed 27-point corners as it grows to five lines, keeping
the text clear of the curved edges and the send button at the bottom.

Twelve poster templates—
Newsprint, Bookleaf, Biblioteca, Theatre, Xuan, Modern, Jade, Swiss, Sumi, Hanji, Offset and Seoul—
combine live typography with local paper, ink and collage textures. Each keeps
only a small theme-coloured Arctic mark. Short opening sentences can become
larger display type. Stories prefer one image: longer quotes reduce type down
to a readable limit. Square defaults to pages, with an explicit One image /
Pages control for either format. A quote that cannot fit shows a message and
disables image export; it never silently cuts off the passage.
The picker shows actual miniature compositions. Preview and export share a
360 × 640 Story or 360 × 360 Square canvas; exports are 1080 × 1920 or
1080 × 1080. Biblioteca, Modern, Swiss, Offset and Newsprint offer an Article image toggle
when the source has an image. It reuses the bounded thumbnail cache; loading
reserves image space and export waits for it. The other templates keep their
artwork intact. Only the selected card is rasterized
for the native share sheet. Save or copy the image for Instagram; there is no
Meta account integration. Quotes keep their article title and source.

Newsprint matches the source host to one of the five bundled publisher marks;
FT articles use salmon paper. Its masthead uses installed Georgia, Baskerville
or Didot, not the publisher's proprietary typeface. FT's
[public font package](https://github.com/Financial-Times/o-fonts) does not contain
font assets. Bookleaf draws live Core Text with translucent, uneven marker
strokes in the saved highlight colour. Text fit uses the same typesetter as
export. Neither template fetches fonts or runs a texture animation.

Highlights & Notes groups entries by their original creation day, newest first,
with sticky Today / Yesterday / localized date capsules. Older years include
the year. Editing does not move an entry to today's section. Cards keep full
note text, two-line quote previews and smaller padding. The article notebook
uses the same date labels while preserving its oldest-first conversation order.

The [poster design board](Design/Sharing/PosterLab/index.html) shows actual native
exports for short and long passages beside ten generated concept posters. Each
regional exploration links primary design references, exact generation prompts,
material assets and layout recipes. These are original interpretations of
specific print traditions, not reproductions or summaries of national styles.

For repeatable design review, the debug-only `-test-story-gallery` flag writes
68 synthetic publisher, portrait/square, short/long and article-image proofs to the simulator's Documents/PosterProofs when
the sharing sheet opens in UI test mode. The focused story UI test checks all
twelve selections, exact text preservation across pages, whole-quote mode,
format changes, image eligibility and native sharing. No proof export runs in Release.

X/Twitter links stay HTTPS. Reader uses Defuddle's existing rich X renderer with
one bounded response from its documented public source,
[FxTwitter](https://github.com/FxEmbed/FxEmbed/blob/main/docs/src/content/docs/api/introduction.mdx).
No X cookie or Jev key is sent. Private/deleted posts and service outages remain
unavailable. Saved Reader text reopens locally.

## Integration boundaries

`Resources/unwall-domains.json` is a static snapshot of domains classified as
`full` in Unwall's public frontend on 2026-09-19. Archive-only entries are omitted.
Source: https://unwall.app/assets/index-DwGCjSB1.js. This is a routing hint, not a
guarantee that every article works. There is no background list refresh or API
dependency. Open original disables automatic routing for the current page.

For Unwall, extraction targets `iframe[title="Article content"]` in its current
DOM. That integration may need an update if Unwall changes its page structure.
Source: https://unwall.app/assets/Reader-C69bK8Zs.js.

Reader HTML is sanitized and displayed in a separate WebView with page JavaScript
disabled and a restrictive content policy. The live page stays intact. Publisher
readiness and Reader tools use the app’s isolated JavaScript world; publisher
scripts cannot call these native bridges.

Reading themes reuse the parent app’s `src/index.css` neutral and Flexoki palettes.
The library uses native adaptive colours and follows the system appearance.
The reading layout uses editorial typography and optional source metadata; this version does not port the extension runtime. Dependency licenses are
in `THIRD_PARTY_NOTICES.txt`; bundled font licenses are in `Resources/Fonts`.

## Review order

1. `Sources/ReaderTheme.swift` — palette and native/web typography.
2. `Sources/LibraryCards.swift`, `ArticleReaderApp.swift`, `LibrarySearch.swift`, `ArticleTagsSheet.swift` — cards, empty states, library, search and tags.
3. `Sources/ReaderPage.swift` — pushed reading page and live appearance controls.
4. `Sources/ArticleBrowser.swift` — WebView lifetime, routing and reader switching.
5. `Web/reader.js` and `Resources/reader.css` — extraction and reading presentation.
6. `Sources/ArticleStore.swift` — local persistence, HTML import and preview metadata.
7. `Sources/AnnotationStore.swift`, `ReaderAnnotations.swift`, `Resources/annotations.js` — passage persistence, notes and text anchors.
8. `Tests/ArticleReaderUITests.swift`, `AnnotationUITests.swift`, `ReaderPerformanceUITests.swift` — complete user sequences and controlled resource checks.
9. `../../packages/arctic-sync-server/README.md`, `Sync/PERFORMANCE.md` — dormant sync release boundary and measured storage costs.
