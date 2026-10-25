# Living covers

A living cover shows a book's cover as a lit object: the art has real
depth, foil and gloss catch a light that moves with the phone, and a few
scenes have small motion. Each scene is made by hand for one cover. It is
not an automatic depth estimate.

Open it with Debug mode on: **Library → Account → Debug tools → Design
ideas → Living covers**. In the Library, **Sort and layout → Debug → Living
covers** turns it on for the real covers.

## Scene files

A scene is a folder with `scene.json` and up to three maps. The maps have
the cover's aspect ratio. They are lossless WebP, so each value is exact.

| Map         | R                            | G                                 | B          |
| ----------- | ---------------------------- | --------------------------------- | ---------- |
| `depth`     | Parallax height (white: top) | Relief for light only (50%: flat) | Not used   |
| `materials` | Foil                         | Spot gloss                        | Glow       |
| `life`      | Shimmer (water)              | Mist                              | Slow pulse |

`scene.json` gives the depth of the parallax and the relief in cover
widths, the paper (gloss, roughness, grain, cloth weave), the foil, the
life and the page count. `src/features/living-covers/scene.ts` has the
types and the defaults. Glints are points in `scene.json`, not in a map.

A scene names the covers it fits in `covers`: the cover's file ID
(`xxh64:` of the cover file). The Library uses the same ID, and the ID is
part of the synchronized Book row, so each device that has the book finds
the scene.

A cover without a scene gets the default scene: a soft laminate sheen, the
paper grain, the hinge and the page block. It has no depth map.

## Where scenes live

- **Public-domain covers** are committed. Their sources (SVG layers,
  `recipe.ts`, the original cover) are in
  `scripts/living-covers/scenes/<name>/`. The built scene, with its own
  480 px cover, is in `src/features/living-covers/scenes/<name>/` and is
  part of the build.
- **The user's own books** have copyrighted covers. Their scenes, and every
  file made from those covers, stay in `living-covers.local/`. That folder
  is git-ignored. Only the dev server reads it, at `/__living-covers/`
  (`scripts/living-covers/dev-plugin.ts`). Set `READER_LIVING_COVERS_DIR`
  to use another folder. A production build has no local scenes.

The app fetches scene files through one cache (`reader-living-covers-v1`),
so a scene that showed once also shows offline.

## Making a scene

```bash
bun scripts/living-covers/author.ts <scene folder> [--out <folder>]
```

The folder has `scene.json`, the cover and `recipe.ts`. A recipe draws the
maps from SVG layers written by hand in the cover's pixels, and a few image
operations: colour keys (`fx`), rounded domes from a mask (`inflate`),
blur and per-pixel maths. `work/grid.png` is the cover with a pixel grid,
to place shapes. `preview.png` shows the cover, the depth, its contours on
the cover, the relief and the masks side by side.

What worked:

- Trace shapes by hand and let a colour key give the exact edge: the
  fresco fragment of The Odyssey is a loose polygon cut by the paint.
- Make a foreground mask 3 px wider than its art. Parallax then stretches
  the dark ground beside a letter, not the letter.
- Keep type on the surface (height 1). Type never moves.
- Give each register its own job: shallow relief and foil for stamped
  bindings, deep parallax for windows (Anathem's hall, Hydrogen Sonata's
  space), stepped sheets for flat graphics (Dune Messiah).

What did not work: segmenting texture from pixels (the serpent on
Emberdark), and small circles placed on painted beads. A depth edge that
misses the art by a few pixels tears under tilt. Use one soft layer there.

## Engine

`src/features/living-covers/engine/` is about 1,600 lines of WebGL2 with no
dependencies. The chunk is lazy: 37 kB, 14 kB gzip.

- **Pool.** At most 8 contexts. Each canvas sits in its cover, so the page
  scrolls on the compositor as before. A cover that leaves the screen
  returns its context after 1.5 s; a cover that arrives takes one. The
  plain image stays below the canvas, so a cover is never blank.
- **Frames.** One loop draws only what changes: a new tilt, a cover that
  moved, or a scene with life. A grid draws life at half rate. Uploads are
  limited to one cover per frame. The loop stops when nothing changes.
- **Optics.** The screen is the plane z = 0 and the face of the book is on
  it, so an off-axis projection puts the face exactly on its place in the
  page. The eye and the lamp stay in the room while the phone turns. Each
  cover sees them from its own place, so foil catches the light as it
  scrolls by, also without a gyroscope.
- **Cover shader.** Parallax occlusion (18 steps in a grid, 36 for one
  book, with a secant refinement), relief normals, soft self-shadow, a
  laminate, foil with a studio reflection and grain, spot gloss, glow, and
  life. At rest the art keeps its own colours; the light only shapes it.
- **Book.** The page block is as thick as the page count (pages in the
  scene, or 320). The spine takes the cover's edge colour.
- **Tilt.** `DeviceOrientationEvent`, with a neutral pose that follows the
  phone. iOS asks once, from the "Tilt to catch the light" button; after a
  grant, a later visit asks again on the first tap. A pointer or a drag on
  the book stands in.
- **Reduced motion.** No life, no tilt, no scroll response: one still frame
  per cover. A drag on the book still turns it.

`window.__livingCoverTilt(x, y)` simulates a tilt and
`window.__livingCoverStats()` returns frame and draw times.

## Production

Not built. The plan: a scene is a set of small files per user, like a
cover. Upload the maps and `scene.json` with the files API (`files.put`),
and add a synchronized `coverScenes` table: `{ coverFileId, sceneFileId,
mapFileIds }`. The registry then reads the user's own rows in place of the
dev manifest, and `files.get` downloads the maps on demand and keeps them
offline. The scenes stay private to the user's account, like the covers
they are made from.
