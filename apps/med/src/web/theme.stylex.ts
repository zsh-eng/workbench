import * as stylex from "@stylexjs/stylex";

// Runtime variables live on the document root. Portals and Pierre's shadow
// hosts inherit them while StyleX keeps all component rules statically compiled.
export const tokens = stylex.defineVars({
  canvas: "var(--med-canvas, #141416)",
  panel: "var(--med-panel, #0d0d0f)",
  raised: "var(--med-raised, #1b1b1e)",
  /** Menus, palettes, and tooltips: the page's own background in a light
   * theme, the raised one in a dark theme, where a lighter surface lifts. */
  menu: "var(--med-menu, var(--med-raised, #1b1b1e))",
  hover: "var(--med-hover, #232327)",
  border: "var(--med-border, #28282d)",
  text: "var(--med-text, #ececef)",
  muted: "var(--med-muted, #9d9da6)",
  faint: "var(--med-faint, #686871)",
  accent: "var(--med-accent, #8f9cff)",
  selected: "var(--med-selected, #252946)",
  green: "var(--med-green, #82cfa1)",
  red: "var(--med-red, #ee8d98)",
  warning: "var(--med-warning, #e8c17a)",
  shadow: "var(--med-shadow, 0 12px 32px -8px #000000b3)",
  // Translucent layers derive from each theme's text color. One hairline or
  // hover then reads the same on the frame, the review card, and popovers.
  // A theme's aesthetic can draw them from its accent instead (Paper's blue outlines).
  line: "color-mix(in srgb, var(--med-line-from, var(--med-text, #ececef)) var(--med-line-mix, 8%), transparent)",
  lineStrong:
    "color-mix(in srgb, var(--med-line-from, var(--med-text, #ececef)) var(--med-line-strong-mix, 14%), transparent)",
  fill: "color-mix(in srgb, var(--med-text, #ececef) 5%, transparent)",
  fillStrong: "color-mix(in srgb, var(--med-text, #ececef) 9%, transparent)",
  accentSoft: "color-mix(in srgb, var(--med-accent, #8f9cff) 15%, transparent)",
  accentLine: "color-mix(in srgb, var(--med-accent, #8f9cff) 55%, transparent)",
  // Dialog scrim from the frame color: it dims dark themes and frosts light ones.
  scrim: "color-mix(in srgb, var(--med-panel, #0d0d0f) 62%, transparent)",
  // Strong ease-out for entering UI; ease-in-out for elements that move on screen.
  easeOut: "cubic-bezier(0.23, 1, 0.32, 1)",
  easeInOut: "cubic-bezier(0.77, 0, 0.175, 1)",
  code: '"Paper Mono", "SFMono-Regular", Consolas, monospace',
  // The rest is each theme's aesthetic (themes.ts): type, corners, the chosen
  // row, the primary button, and section labels. Code keeps Paper Mono.
  ui: 'var(--med-font-ui, "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)',
  // Multiplies every corner radius: calc(6px * round). Buttons may be pills instead.
  round: "var(--med-round, 1)",
  // Cards at the window's edges, in every theme. macOS rounds a window with a
  // title bar at 16 pt; inside the frame's 6 px gutter, 10 px keeps the two
  // corners concentric. The theme's `round` shapes what is inside the cards.
  frame: "10px",
  // A pane's title bar, the same in each pane beside another: the session's,
  // the review's (which holds the page switch), and a split pane's.
  bar: "44px",
  buttonRound: "var(--med-button-round, 6px)",
  // The highlighted row of a list or menu, the chosen segment, and their text.
  pick: "var(--med-pick, color-mix(in srgb, var(--med-text, #ececef) 9%, transparent))",
  segment: "var(--med-segment, var(--med-raised, #1b1b1e))",
  selectedText: "var(--med-selected-text, var(--med-text, #ececef))",
  primary: "var(--med-primary, var(--med-text, #ececef))",
  primaryText: "var(--med-primary-text, var(--med-canvas, #141416))",
  labelColor: "var(--med-label-color, var(--med-muted, #9d9da6))",
  labelCase: "var(--med-label-case, none)",
  labelTracking: "var(--med-label-tracking, normal)",
  labelSize: "var(--med-label-size, 11.5px)",
  labelWeight: "var(--med-label-weight, 500)",
  // A palette's selected row and its shadow (themes.ts): a solid selection
  // in a theme that fills it, and a ring alone in a flat theme.
  palettePick:
    "var(--med-palette-pick, color-mix(in srgb, var(--med-text, #ececef) 7.5%, transparent))",
  paletteShadow:
    "var(--med-palette-shadow, 0 0 0 1px color-mix(in srgb, var(--med-text, #ececef) 9%, transparent), inset 0 1px 0 color-mix(in srgb, var(--med-text, #ececef) 4%, transparent), 0 4px 12px -4px #0000008c, 0 32px 80px -20px #000000cc)",
});

// Text on a highlighted or selected row. A theme with a solid accent selection
// (Paper) makes the row's text, secondary text, and marks light; other themes
// keep their colors.
export const picked = stylex.createTheme(tokens, {
  text: "var(--med-selected-text, var(--med-text, #ececef))",
  muted: "var(--med-selected-muted, var(--med-muted, #9d9da6))",
  faint: "var(--med-selected-faint, var(--med-faint, #686871))",
  accent: "var(--med-selected-accent, var(--med-accent, #8f9cff))",
  green: "var(--med-selected-green, var(--med-green, #82cfa1))",
  red: "var(--med-selected-red, var(--med-red, #ee8d98))",
});

const reduced = "@media (prefers-reduced-motion: reduce)";

// A palette's layers: the theme's text at a few percent. Its one rule draws
// from the theme's line color, as Paper's blue outlines do.
const fill7 = "color-mix(in srgb, var(--med-text, #ececef) 7%, transparent)";
const fill10 = "color-mix(in srgb, var(--med-text, #ececef) 10%, transparent)";
const fill11 = "color-mix(in srgb, var(--med-text, #ececef) 11%, transparent)";
const fill12 = "color-mix(in srgb, var(--med-text, #ececef) 12%, transparent)";
const paletteRule =
  "color-mix(in srgb, var(--med-line-from, var(--med-text, #ececef)) 7%, transparent)";

export const ui = stylex.create({
  // Keyboard-opened palettes and high-frequency surfaces appear immediately.
  instant: {
    animationName: "none",
    transitionProperty: "none",
    scrollBehavior: "auto",
  },
  // Pointer-opened menus grow from their trigger. Base UI sets the origin and
  // keeps the popup mounted until the exit transition ends.
  pop: {
    transformOrigin: "var(--transform-origin)",
    transitionProperty: "opacity, transform",
    transitionTimingFunction: tokens.easeOut,
    transitionDuration: {
      default: "150ms",
      ":is([data-ending-style])": "90ms",
      ":is([data-instant])": "0ms",
      [reduced]: "0ms",
    },
    opacity: { default: 1, ":is([data-starting-style], [data-ending-style])": 0 },
    transform: {
      default: "scale(1)",
      ":is([data-starting-style], [data-ending-style])": "scale(0.96)",
    },
  },
  button: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    boxSizing: "border-box",
    minHeight: 28,
    paddingBlock: 0,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": tokens.fill },
    color: { default: tokens.muted, ":hover:not(:disabled)": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 450,
    lineHeight: 1.5,
    // Buttons in an uppercase section label keep their own case.
    textTransform: "none",
    letterSpacing: "normal",
    cursor: "pointer",
    whiteSpace: "nowrap",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -1,
    opacity: { default: 1, ":disabled": 0.4 },
  },
  pressable: {
    transform: { default: "scale(1)", ":active:not(:disabled)": "scale(0.97)" },
    transitionProperty: "transform",
    transitionDuration: { default: "100ms", [reduced]: "0ms" },
    transitionTimingFunction: tokens.easeOut,
  },
  active: {
    color: { default: tokens.accent, ":hover:not(:disabled)": tokens.accent },
    backgroundColor: { default: tokens.accentSoft, ":hover:not(:disabled)": tokens.accentSoft },
  },
  strong: { color: tokens.text, fontWeight: 500 },
  primary: {
    color: { default: tokens.primaryText, ":hover:not(:disabled)": tokens.primaryText },
    backgroundColor: {
      default: tokens.primary,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.primary} 86%, ${tokens.canvas})`,
    },
    fontWeight: 500,
  },
  // A quiet outlined button for secondary actions that need an edge, such as Push.
  outlined: {
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  iconButton: { width: 28, minWidth: 28, paddingInline: 0 },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    height: 28,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":hover": tokens.lineStrong, ":focus": tokens.accentLine },
    borderRadius: `calc(6px * ${tokens.round})`,
    paddingBlock: 0,
    paddingInline: 9,
    backgroundColor: tokens.fill,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    outline: "none",
    boxShadow: { default: "none", ":focus": `0 0 0 3px ${tokens.accentSoft}` },
  },
  popup: {
    boxSizing: "border-box",
    minWidth: 200,
    maxHeight: "min(420px, 70vh)",
    overflowY: "auto",
    backgroundColor: tokens.menu,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    // Rows sit 6 px in, so the popup's corner and a row's stay concentric.
    borderRadius: `calc(12px * ${tokens.round})`,
    padding: 6,
    boxShadow: tokens.shadow,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    outline: "none",
    zIndex: 50,
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 24,
    // Roomy rows, as in Claude's apps: easier to aim at, calmer to read.
    minHeight: 32,
    paddingInline: 10,
    borderRadius: `calc(6px * ${tokens.round})`,
    cursor: "default",
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": tokens.fillStrong,
      ":is([data-disabled])": "transparent",
    },
    color: { default: tokens.text, ":is([data-disabled])": tokens.faint },
    fontSize: 12.5,
  },
  // With `picked` on the same element, so the row's secondary text follows.
  menuHighlighted: { backgroundColor: tokens.pick, color: tokens.selectedText },
  // Keyboard palettes: commands, files, symbols, branches, themes, the
  // shortcut guide, and the switcher. Input first and nearly without chrome:
  // the search band, one hairline, then the list. The placeholder names the
  // palette; a hidden title gives the dialog its name. Every palette's top
  // edge is at 12vh, so the query never moves between them. The glass, the
  // section labels, and each row's icon share one left edge, 18 px in, and
  // all text starts 46 px in.
  palette: {
    position: "fixed",
    top: "12vh",
    // Centred by its margins, so that an entrance can animate the transform.
    left: 0,
    right: 0,
    marginInline: "auto",
    width: "min(640px, calc(100vw - 32px))",
    maxHeight: "calc(88vh - 16px)",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    backgroundColor: tokens.menu,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    // As the window's shell: a palette is portalled outside it.
    WebkitFontSmoothing: "antialiased",
    borderRadius: `calc(14px * ${tokens.round})`,
    // A one-pixel ring, a top highlight, and a deep soft shadow (themes.ts).
    boxShadow: tokens.paletteShadow,
    overflow: "hidden",
    outline: "none",
    zIndex: 111,
  },
  // The shortcut guide's two columns.
  paletteGuide: {
    width: "min(880px, calc(100vw - 32px))",
    height: "min(680px, calc(88vh - 16px))",
  },
  // A list with a preview beside it: Find file, symbols in the project.
  palettePreview: {
    top: 96,
    width: "min(1080px, calc(100vw - 32px))",
    height: "min(640px, calc(100vh - 112px))",
    maxHeight: "none",
  },
  scrim: { position: "fixed", inset: 0, backgroundColor: tokens.scrim },
  // The page dims behind a palette, from its own canvas.
  paletteScrim: {
    zIndex: 110,
    backgroundColor: `color-mix(in srgb, ${tokens.canvas} 55%, transparent)`,
  },
  // The search band: the glass, the query, then the palette's own controls
  // at its end. One hairline under it, the palette's only rule.
  paletteInput: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    boxSizing: "border-box",
    height: 54,
    paddingInlineStart: 18,
    paddingInlineEnd: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: paletteRule,
    color: tokens.faint,
  },
  // A band that goes on below the query, as Find file's chips do: the rule
  // moves under them.
  paletteInputOpen: { borderBottomWidth: 0 },
  paletteField: {
    flex: "1",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 15,
    letterSpacing: "-0.006em",
    "::placeholder": { color: tokens.faint },
  },
  // A control in the band: Refresh, ⋯, the preview toggle. Quiet until hovered.
  paletteTool: {
    flexShrink: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    color: { default: tokens.faint, ":hover:not(:disabled)": tokens.text },
  },
  // The band's choice of two words, such as Files and Content.
  paletteSegments: {
    display: "flex",
    flexShrink: 0,
    padding: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: fill7,
  },
  paletteSegment: {
    minHeight: 22,
    height: 22,
    paddingInline: 9,
    fontSize: 12,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": "transparent" },
    color: { default: tokens.faint, ":hover:not(:disabled)": tokens.muted },
  },
  paletteSegmentOn: {
    backgroundColor: { default: fill11, ":hover:not(:disabled)": fill11 },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  // What the palette searches, as a chip that opens a choice: Find file's
  // "Working files · main ⌄".
  paletteScope: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 26,
    height: 26,
    gap: 6,
    paddingInlineStart: 9,
    paddingInlineEnd: 7,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: fill7, ":hover:not(:disabled)": fill11 },
    color: { default: tokens.muted, ":hover:not(:disabled)": tokens.text },
    fontSize: 12,
  },
  // Chips in the band, under the query: filters, the guide's contexts.
  paletteChips: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    boxSizing: "border-box",
    minWidth: 0,
    paddingTop: 0,
    paddingBottom: 12,
    paddingInlineStart: 16,
    paddingInlineEnd: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: paletteRule,
  },
  paletteChip: {
    flexShrink: 0,
    minHeight: 24,
    height: 24,
    gap: 5,
    paddingInline: 9,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: fill7, ":hover:not(:disabled)": fill10 },
    color: { default: tokens.faint, ":hover:not(:disabled)": tokens.muted },
    fontSize: 12,
    fontWeight: 400,
  },
  paletteChipOn: {
    backgroundColor: { default: fill12, ":hover:not(:disabled)": fill12 },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  // Rows sit 6 px in, so a row's corner and the palette's stay concentric.
  // A compact list fades out at its foot while more rows wait below it
  // (`usePaletteFade` sets data-more).
  paletteList: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    maxHeight: "min(412px, calc(88vh - 86px))",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: 6,
    // The selected row stops above the fade at the foot.
    scrollPaddingTop: 6,
    scrollPaddingBottom: 44,
    outline: "none",
    maskImage: {
      default: "none",
      ":is([data-more])": "linear-gradient(to bottom, #000 calc(100% - 44px), transparent)",
    },
  },
  // In a palette with a fixed height, the list takes what the bands leave.
  paletteListFill: { flexBasis: 0, maxHeight: "none" },
  // A section: its label is 26 px tall, 30 after the first section.
  paletteGroup: { paddingTop: { default: 4, ":first-child": 0 } },
  // A section label, with `ui.label` before it for the theme's case. Its
  // text sits on the glass's edge, 7 px above the first row.
  paletteSection: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    boxSizing: "border-box",
    height: 26,
    margin: 0,
    paddingBottom: 7,
    paddingInlineStart: 12,
    paddingInlineEnd: 10,
    color: tokens.faint,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // A row: a 16 px visual on the glass's edge, the text 46 px in, then at
  // its end quiet text, the shortcut, and the check. The pointer moves the
  // keyboard's selection (`paletteRowOn`), so a row has no hover tint.
  // Its icon and shortcut take their colors from the row's variables, so a
  // selected row brightens them.
  paletteRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    boxSizing: "border-box",
    width: "100%",
    minHeight: 36,
    margin: 0,
    paddingBlock: 0,
    paddingInlineStart: 12,
    paddingInlineEnd: 10,
    borderWidth: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 400,
    lineHeight: 1.4,
    textAlign: "start",
    cursor: "default",
    outline: "none",
    "--palette-icon": tokens.faint,
    "--palette-keys": tokens.faint,
  },
  // With `picked` on the same row, so a solid selection (Paper) lightens its text.
  paletteRowOn: {
    backgroundColor: tokens.palettePick,
    color: tokens.selectedText,
    "--palette-icon": tokens.text,
    "--palette-keys": tokens.muted,
  },
  // A row's leading visual: an icon, a swatch, a file's or a symbol's badge.
  paletteRowIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 16,
    height: 16,
    color: "var(--palette-icon)",
  },
  paletteRowText: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // A typed match inside a row's text.
  paletteMatch: { fontWeight: 600, color: "inherit" },
  // Quiet text at the row's end, such as Current, Light, or a folder.
  paletteAside: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "50%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 12,
  },
  // A number at the row's end, such as a symbol's line.
  paletteAsideMono: {
    fontFamily: tokens.code,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  // A shortcut: one quiet run of glyphs, such as ⌘⇧K.
  paletteKeys: {
    flexShrink: 0,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.12em",
    whiteSpace: "nowrap",
    color: "var(--palette-keys)",
  },
  // The selected row's actions, such as Open ↵ and New workspace ⌘↵, in
  // place of its end text.
  paletteActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
    color: tokens.muted,
    fontSize: 12,
    whiteSpace: "nowrap",
  },
  paletteAction: { display: "inline-flex", alignItems: "center", gap: 6 },
  paletteActionKeys: { color: tokens.muted },
  // A row's last column: the accent check.
  paletteCheck: {
    display: "inline-flex",
    justifyContent: "center",
    flexShrink: 0,
    width: 16,
    color: tokens.accent,
  },
  paletteEmpty: {
    margin: 0,
    paddingTop: 40,
    paddingBottom: 44,
    paddingInline: 18,
    textAlign: "center",
    color: tokens.faint,
    fontSize: 13,
    overflowWrap: "anywhere",
  },
  // A line about the whole list, such as a failure, under the rows.
  // Under a list that stops at a limit: faint, so it reads as a footnote.
  paletteCapped: {
    flexShrink: 0,
    margin: 0,
    paddingTop: 4,
    paddingBottom: 10,
    paddingInline: 18,
    color: tokens.faint,
    fontSize: 12,
  },
  paletteNotice: {
    flexShrink: 0,
    margin: 0,
    paddingTop: 2,
    paddingBottom: 12,
    paddingInline: 18,
    color: tokens.muted,
    fontSize: 12,
  },
  // A toggle button that is on, without the accent: a quiet fill.
  pressed: {
    backgroundColor: { default: tokens.fillStrong, ":hover:not(:disabled)": tokens.fillStrong },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  // Text that only a screen reader reads.
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  // A section label such as "Changes" or "Files". Themes set its case, color, and tracking.
  label: {
    color: tokens.labelColor,
    fontFamily: tokens.ui,
    fontSize: tokens.labelSize,
    fontWeight: tokens.labelWeight,
    letterSpacing: tokens.labelTracking,
    textTransform: tokens.labelCase,
  },
  // A menu's rule, inset a little from the popup's edges.
  separator: {
    height: 1,
    backgroundColor: tokens.line,
    borderWidth: 0,
    marginBlock: 6,
    marginInline: 4,
  },
  muted: { color: tokens.muted },
  faint: { color: tokens.faint },
  mono: { fontFamily: tokens.code, fontSize: 11, fontVariantNumeric: "tabular-nums" },
  badge: {
    fontSize: 10,
    lineHeight: "18px",
    paddingInline: 5,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.muted,
  },
  grow: { flex: "1" },
  row: { display: "flex", alignItems: "center", gap: 7, minWidth: 0 },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  added: { color: tokens.green, fontVariantNumeric: "tabular-nums" },
  removed: { color: tokens.red, fontVariantNumeric: "tabular-nums" },
});
