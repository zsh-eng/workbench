# Magazine: the library for wide touch screens

A third library layout, beside Cards and List, where each link's og:image
carries the card. Status: built (October 2026); the default on touch
screens wider than a phone.

## What an iPad shows today

Cards at iPad widths: a 2:1 cover above the source line and a three-line
title. Two columns at 820 px portrait (covers 364 × 182), three with the
sidebar at 1180 px landscape (273 × 136) and at 1366 px (335 × 167). The
image is about half of each card, and at 1180 px a cover is smaller than
the title block beside it.

The real library (copied from the Workbench Backup mirror into the lab, 641
saved) changes the brief: only 9 of the newest 50 saved links have an
image or an icon, because a link saved from the web or `wb` has none until
Arctic on iPhone fetches its preview. From the 50th link on, 64–96% have
one. A card without an image is a title and its description, so the top of
an iPad's library is a wall of text cards of different heights. A layout
"with more og:images" has to make the links without one look intended too.

## References read

- HIG [Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
  decide by size class, the space available, "not device type or
  orientation"; keep functionality the same and take advantage of larger
  spaces.
- HIG [Collections](https://developer.apple.com/design/human-interface-guidelines/collections):
  collections suit image-based content; prefer the standard grid to a
  custom layout; avoid changing the layout while people view it.
- WWDC19 [Advances in Collection View Layout](https://developer.apple.com/videos/play/wwdc2019/215/):
  columns follow the container's width (its example switches to more
  columns above 800 points); a large item beside a group is a nested group.
- [Apple News Format `Layout`](https://developer.apple.com/documentation/applenewsformat/layout):
  a column system designed at the iPad's 1,024 points, 60-point margins and
  20-point gutters by default, scaled down for smaller screens.
- Meta, [Images in link shares](https://developers.facebook.com/docs/sharing/webmasters/images/):
  og:images of at least 1200 × 630, "as close to 1.91:1 as possible".
- web.dev, [Browser-level lazy loading](https://web.dev/articles/browser-level-image-lazy-loading):
  Chromium starts lazy images 1,250 px from the viewport (2,500 px on slow
  connections); do not lazy-load images in the first viewport.
- NewsBlur, [Grid view on iOS](https://blog.newsblur.com/2023/12/06/ios-grid-view/)
  and [customisable grid](https://blog.newsblur.com/2020/10/28/customizable-grid-view-story-layout/):
  "large thumbnails in a magazine-like format", with a choice of sizes and
  the option to turn image previews off.
- In this repository: the phone's retained `GradientArticleCard`
  (`apps/arctic/Sources/LibraryCards.swift`): a wide image above a title on
  an opaque surface, "so its contrast does not depend on the publisher's
  photograph"; and [UI performance](../../../../UI_PERFORMANCE.md) on image
  sizes and decoding.

Not read, so not used: Safari's Reading List and Favourites (no current
Apple page found), Apple News itself, Readwise Reader (only a changelog
about a gallery for books), Matter, Pocket, Arc's Library, Raindrop and
Are.na (their help pages did not describe their grids).

## The layout

1. **The picture at the og:image's shape.** Every picture is 1.91:1, so a
   1200 × 630 image shows whole. A square or tall image is shown whole,
   centred on the site's colour, instead of cut to a band.
2. **Two columns on every iPad.** Columns follow the list's own width, not
   the device: one below 600 px, two to 1,240 px, three above (a wide
   desktop window). `useColumns` measures the list before the first paint.

   | Screen           | Pictures (Cards) | Magazine pictures |      Lead |
   | ---------------- | ---------------: | ----------------: | --------: |
   | 820 × 1180       |        364 × 182 |         366 × 192 | 756 × 396 |
   | 1024 × 1366      |        301 × 151 |         468 × 245 | 624 × 327 |
   | 1180 × 820       |        273 × 137 |         426 × 223 | 568 × 297 |
   | 1366 × 1024      |        335 × 168 |         519 × 272 | 692 × 362 |
   | 678 (Split View) |        311 × 156 |         309 × 162 | 642 × 336 |
   | 504 (Split View) |       one column |         468 × 245 |           |

   At 1366 a third column would make the pictures Cards' size again, so
   three columns wait for a wider window.

3. **A lead.** When the first link has a picture, it leads: the picture
   spans the row, with the title in large type and the description beside
   it from 924 px (below it on narrower lists). With three columns the
   picture takes exactly two (a subgrid). Search results have no lead, so
   typing never swaps a large picture; a first link without a picture has
   none, since a large blank is the opposite of the aim.
4. **Links without a picture.** The real library's newest links are mostly
   without one, so they must look intended:
   - A run of them first fills the row it starts in, each as a **site
     cover**: the picture's place in the site's colour (a hue from its
     name, the same on every visit and in each theme), the title set large
     in a serif and the description under it.
   - The rest of a run that fills two rows or more becomes a **band of
     headlines** in whole rows: source line and title, divided by hairlines
     and aligned across the columns, like a newspaper's index. Anything
     left over is site covers again. So every row of the grid is full, and
     no cell is an empty box.
   - A picture that fails, or turns out to be a site icon, becomes a site
     cover. The same colour fills a picture's place while it loads.
5. **Under the picture:** the source line (icon, site, reading time,
   favourite) and the title in up to three lines. A progress line along
   the picture's foot shows an article this browser has started (the
   position the reader keeps, `position.ts`).
6. **Touch.** The picture and the title open the article; More is always
   shown on touch screens, as now. Opening keeps the view transition from
   the picture into the reader (not from a site cover, which has no
   picture in the reader).

**The default:** Magazine on a touch screen wider than 720 px (an iPad
full screen or in a wide window, or a touch laptop); Cards with a mouse;
List on a phone. The layout switch offers all three. Why: the request came
from the iPad; at arm's length a picture finds an article faster than a
line of text, and the larger cards cost little on a screen that scrolls by
flicks. A desktop window keeps the denser Cards. A choice already saved in
a browser stays.

## Performance

- The lead and the first two rows load eagerly at high priority; the rest
  are `loading="lazy"`, with `decoding="async"`.
- A picture's box has its shape before the image arrives, so nothing
  moves; the site colour fills it.
- Cards keep `content-visibility: auto` (not the lead: layout containment
  would stop it being a subgrid) and the list keeps rendering in steps.
- There is no image service on the web: each picture is the publisher's
  file, usually about 1200 px wide. A 519 px card on a 2× screen shows
  1,038 device pixels of it, so the file is about the size needed; the lead
  at 692 px shows it a little enlarged.

**Scrolling check.** A production build, Chromium at 1180 × 820 with touch
and a 4× CPU slowdown, flicking 9,000 px in 8 s down the real library from
the top (`tests/kit/scroll-library.ts`, `kit time --trace`, `kit frames`):

| Layout   | Frames | Complete | Partial | Dropped | Main thread busy | Longest without an update |
| -------- | -----: | -------: | ------: | ------: | ---------------: | ------------------------: |
| Magazine |  1,048 |      70% |     189 |       0 |              69% |                    118 ms |
| Cards    |  1,274 |      56% |     414 |       0 |              81% |                    116 ms |

Magazine renders fewer cards for the same distance, so it is no slower
than Cards. Not measured: memory, and WebKit (the kit traces only
Chromium).

## Critique

- **A lead is a custom layout.** HIG warns against layouts that confuse.
  It is one row at the top, the first link in the folder's own order, and
  it only appears with a picture; everything after is a plain grid. With
  two columns its picture (2 : 1 of the row) does not line up with the
  columns under it.
- **Bands change the order's shape, not the order.** A run of links
  without pictures reads across the row, as tiles do. A run that grows by
  one link (a save on another device) can turn a site cover into a
  headline; the cells above it do not move.
- **The default by input, not by space.** HIG says layout follows space.
  Columns do follow space here; only the default choice of layout depends
  on touch, and the choice stays the user's.
- **Fewer links per screen.** In the lab's Favourites, 5 links show at
  820 × 1180 and 1366 × 1024 where Cards shows 8 and 12. A band of
  headlines is as dense as Cards' text cards. List remains for scanning.
- **Site colours are invented.** A hue from the name is stable and
  readable, not the brand's colour. Reading a favicon's colour needs CORS,
  which publishers do not send.
- **Pictures cost memory.** Hundreds of decoded 1200 px images; browsers
  drop decoded data off screen, and `content-visibility` skips their
  painting. The scrolling check above found no cost over Cards; memory
  was not measured.
- **Split View.** Below 720 px the page is the phone's. Magazine there has
  two columns down to 600 px, then one; List stays the phone default.
