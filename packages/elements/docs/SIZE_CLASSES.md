# Size classes: phone, tablet and desktop on the web

One rule decides the phone, tablet and desktop layouts of Reader, Arctic for
the web and Spaced. It is in `src/size-class.ts`
(`@workbench/elements/size-class`). Use its hooks and queries; do not add a
breakpoint of your own for these layouts.

## The rule

**The window's width class** is Android's:

| Class    | Window width | Typical window                 |
| -------- | ------------ | ------------------------------ |
| compact  | below 600 px | a phone, a narrow split window |
| medium   | 600–839 px   | a tablet in portrait           |
| expanded | 840 px up    | a tablet in landscape, desktop |

Bars, sidebars, popovers and menus follow the width class:

- Compact: the phone layout. Tools are sheets.
- Medium and expanded: the tablet layout. Tools are a sidebar, popovers and
  menus.
- A second pane (Arctic's library sidebar) needs an expanded width and a
  window 480 px or taller. A shorter window is Android's compact height, as
  a phone on its side.

**A tablet** is a touch screen (`any-pointer: coarse`) whose shortest side
is 600 px or more (`screen.width`, `screen.height`). It stays a tablet when
it turns, whatever the browser's bars take. A phone on its side stays a
phone. A smaller touch screen is a phone, and a screen without touch a
desktop (`deviceClass()`); a touch laptop is a tablet.

**Sheets take the form layout** (UIKit's iPad sheet, `sheetPlacement` in
`src/sheet-body.tsx`) on a tablet in a window compact in neither width nor
height: 600 px or wider and 480 px or taller. Elsewhere they are phone
sheets. UIKit shows a form sheet full screen in a compact height.

| Export                                                    | Use                                               |
| --------------------------------------------------------- | ------------------------------------------------- |
| `useWidthClass()`, `widthClass()`                         | the layout of bars, sidebars and popovers         |
| `useCompactHeight()`, `isCompactHeight()`                 | keep a second pane off a short window             |
| `useTabletSheets()`, `tabletSheets()`                     | the sheets' layout (`useSheetForm` in sheet-body) |
| `isTabletScreen()`                                        | a default for a tablet (Arctic's Magazine)        |
| `deviceClass()`                                           | phone, tablet or desktop (Reader's reading time)  |
| `COMPACT_QUERY`, `EXPANDED_QUERY`, `COMPACT_HEIGHT_QUERY` | `matchMedia`, tests                               |
| `MEDIUM_WIDTH`, `EXPANDED_WIDTH`, `MEDIUM_HEIGHT`         | the numbers                                       |

In CSS, write the same lines: `@media (width < 600px)` and
`@media (width >= 600px)`. Spaced has the Tailwind variant `medium:`
(`@custom-variant medium` in `src/index.css`).

## Why

- **Android's classes.** Android's
  [window size classes](https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes)
  give these widths (compact below 600 dp, medium to 840, expanded to 1200) and heights (compact below 480 dp, medium to 900). The page says
  most apps can use the width class only, and to look at the height for a
  phone on its side, where two panes are not practical. It also says that
  size classes are "not intended for _isTablet_‑type logic".
- **A tablet by its shortest side.** The layout follows the window, as
  Android says. The sheets alone follow the device: an iPad's sheet is a
  form sheet in any orientation, and a phone's never is. Android's own line
  for a 7-inch tablet is a shortest side of 600 dp (the
  [smallest width qualifier](https://developer.android.com/topic/architecture/views/resources/providing-resources-views),
  `sw600dp`). Android measures the app's window; a page reads the screen
  (`screen`), because a browser's bars take a tablet's height in landscape
  and the window's shortest side would change as it turns.
- **A CSS pixel is a dp in Chrome on Android.** Android sets
  `px = dp × (dpi / 160)`, and `DisplayMetrics.density` is that scale
  ([pixel densities](https://developer.android.com/training/multiscreen/screendensities)).
  Chrome gives its display that density as the dip scale and the display's
  size in dips (`PhysicalDisplayAndroid.java`, `DisplayAndroid.java`), and
  makes the dip scale the display's device scale factor
  (`display_android_manager.cc`). `devicePixelRatio` is physical pixels per
  CSS pixel ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)).
  So one CSS pixel is one dp, and `screen` is the display in dp.
- **One rule in one place.** Before, Reader changed at 768 px, Arctic at 720
  and 1100, Spaced at 640, and sheets at 640 × 600. A tablet could be a
  phone in one app and a tablet in the next.

## Devices

Windows are in CSS px. A browser shows the screen less its bars: Safari's
on an iPad, Chrome's and Android's on an Android tablet. For an Android
tablet the table guesses 140 px of bars; only Arctic's sidebar reads the
height. "Sidebar" in Reader means the tools are a sidebar with popovers;
"phone" means sheets.

| Device, window                     | Sheets       | Reader          | Arctic library                  | Spaced review |
| ---------------------------------- | ------------ | --------------- | ------------------------------- | ------------- |
| Phone 390 × 844                    | phone        | phone           | phone, List                     | phone         |
| Phone on its side, 844 × 340       | phone        | sidebar         | top bar, Magazine → Cards       | wide          |
| Large phone on its side, 956 × 390 | phone        | sidebar         | top bar, Magazine → Cards       | wide          |
| iPad mini 744 × 1133               | form         | phone → sidebar | top bar, Magazine               | wide          |
| iPad mini on its side, 1133 × 744  | form         | sidebar         | sidebar                         | wide          |
| iPad 820 × 1180, 834 × 1194        | form         | sidebar         | top bar                         | wide          |
| iPad 1180 × 820                    | form         | sidebar         | sidebar                         | wide          |
| iPad 13-inch 1024 × 1366           | form         | sidebar         | top bar → sidebar               | wide          |
| iPad split, 500 wide               | phone        | phone           | phone                           | phone         |
| iPad split, 678 wide               | form         | phone → sidebar | phone, List → top bar, Magazine | wide          |
| OPPO 2.5, 672 × 868                | form         | phone → sidebar | phone, List → top bar, Magazine | wide          |
| OPPO 2.5 on its side, 1008 × 532   | phone → form | sidebar         | top bar → sidebar               | wide          |
| OPPO 2.625, 640 × 820              | form         | phone → sidebar | phone, List → top bar, Magazine | phone → wide  |
| OPPO 2.625 on its side, 960 × 500  | phone → form | sidebar         | top bar → sidebar               | wide          |
| OPPO 3.0, 560 × 700                | phone        | phone           | phone                           | phone         |
| OPPO 3.0 on its side, 840 × 420    | phone        | sidebar         | top bar, Magazine → Cards       | wide          |
| Desktop 1280 × 800, no touch       | phone        | sidebar         | sidebar, Cards                  | wide          |
| Touch laptop 1440 × 900            | form         | sidebar         | sidebar, Magazine               | wide          |

"a → b" is before → after this rule; one value is unchanged. Arctic's
default layout (Magazine, Cards or List) shows where it changed; a saved
choice stays. Before, Arctic's sidebar started at 1100 px; now it starts at
840 px in a window 480 px or taller.

The OPPO Pad Mini has a 2520 × 1680 screen, 8.8 inches at 344 PPI, up to
144 Hz, on ColorOS 16
([Notebookcheck](https://www.notebookcheck.net/Oppo-launches-high-end-compact-OLED-tablet-with-144Hz-matte-display.1431107.0.html)).
The maker sets its density, and Android's display size setting can change
it; the readout below shows it. At 2.5 its screen is 1008 × 672, at 2.625
960 × 640, at 3.0 840 × 560. Above 2.8 its shortest side (1680 / density)
is below 600, so the sheets take it for a phone.

Spaced's rail and page grid still change at Tailwind's `md` (768 px). Only
the review screen follows the width class.

## Read a new device

In Reader, turn on Settings → Debug mode, then open Debug tools → Sheet Lab.
The line at the top reads, for example:

```
window 672×868 · screen 672×1008 · density 2.5 · medium width, medium height · tablet · form sheets
```

- `window`: the page's size now. `screen`: the display in CSS px (dp).
- `density`: device pixels per CSS pixel, Android's density.
- The width and height classes, then "tablet", "phone" or "no touch", and
  which sheets this window gets.

Read it in portrait and on its side, and again after a change to Display
size. Add the device to the table above. `sheet-android.spec.ts` in Reader
emulates the OPPO's three densities in Chromium with touch.
