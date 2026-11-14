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
  // shortcut guide, and the switcher. One surface, with its top edge at one
  // height, so the header and the query never move between palettes. From
  // the top: a header (44), the search (48), an optional strip (36), the
  // list, and the footer (34), each band under a rule. The compact width is
  // the default; `paletteGuide` and `palettePreview` widen it.
  palette: {
    position: "fixed",
    top: "12vh",
    // Centred by its margins, so that an entrance can animate the transform.
    left: 0,
    right: 0,
    marginInline: "auto",
    width: "min(600px, calc(100vw - 32px))",
    maxHeight: "calc(88vh - 16px)",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    backgroundColor: tokens.menu,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    borderRadius: `calc(12px * ${tokens.round})`,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
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
    width: "min(1120px, calc(100vw - 32px))",
    height: "min(680px, calc(88vh - 16px))",
  },
  scrim: { position: "fixed", inset: 0, backgroundColor: tokens.scrim },
  paletteScrim: { zIndex: 110 },
  // Header: the title, then what the palette searches, a spacer, its
  // controls, and Esc last.
  paletteHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    boxSizing: "border-box",
    height: 44,
    paddingInlineStart: 16,
    // A 28 px control's icon, and the Esc keycap, end 16 px in, as the rows do.
    paddingInlineEnd: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  paletteTitle: {
    flexShrink: 0,
    margin: 0,
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 550,
    whiteSpace: "nowrap",
  },
  // What the palette searches, such as the checkout. It gives way first.
  paletteContext: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12,
  },
  // The header's Esc keycap, a button that closes the palette.
  paletteClose: { flexShrink: 0, minHeight: 24, paddingInline: 6 },
  // Search: the glass 16 px in, then the query 42 px in. A row's icon sits
  // under the glass and its text starts where the query does.
  paletteInput: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    boxSizing: "border-box",
    height: 48,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    color: tokens.faint,
  },
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
    fontSize: 14,
    "::placeholder": { color: tokens.faint },
  },
  // Below the search: filter chips or tabs.
  paletteStrip: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    boxSizing: "border-box",
    minHeight: 36,
    paddingBlock: 4,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  // Rows sit 6 px in, so a row's corner and the palette's stay concentric.
  paletteList: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
    maxHeight: "min(360px, 50vh)",
    overflowY: "auto",
    boxSizing: "border-box",
    padding: 6,
    scrollPaddingBlock: 6,
    outline: "none",
  },
  // In a palette with a fixed height, the list takes what the bands leave.
  paletteListFill: { flexBasis: 0, maxHeight: "none" },
  // A row: the icon under the glass, the text under the query, then at its
  // end secondary text, keycaps, and the check. The pointer moves the
  // keyboard's highlight (`menuHighlighted`), so a row has no hover tint.
  paletteRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    boxSizing: "border-box",
    width: "100%",
    minHeight: 32,
    margin: 0,
    paddingBlock: 0,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 400,
    lineHeight: 1.4,
    textAlign: "start",
    cursor: "default",
    outline: "none",
  },
  // A row without an icon: its text still starts where the query does.
  paletteRowBare: { paddingInlineStart: 36 },
  // Two lines, only where the second says what the name does not.
  paletteRowTall: { minHeight: 40, paddingBlock: 3, lineHeight: 1.3 },
  paletteRowIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 16,
    color: tokens.muted,
  },
  paletteRowText: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // A name over a second line.
  paletteRowLines: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0, gap: 1 },
  paletteRowSecondary: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11.5,
  },
  // A row's last column: the accent check, in a slot that each row keeps.
  paletteCheck: {
    display: "inline-flex",
    justifyContent: "center",
    flexShrink: 0,
    width: 14,
    color: tokens.accent,
  },
  // A section label at the rows' text inset.
  paletteSection: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    paddingTop: 10,
    paddingBottom: 4,
    paddingInlineStart: 36,
    paddingInlineEnd: 10,
  },
  paletteEmpty: {
    margin: 0,
    padding: 24,
    textAlign: "center",
    color: tokens.muted,
    fontSize: 12.5,
  },
  // A line about the whole list, such as a failure, above the footer.
  paletteNotice: {
    flexShrink: 0,
    margin: 0,
    paddingBlock: 7,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.muted,
    fontSize: 11.5,
  },
  // Footer, always the last band: keycap and verb pairs, then a count.
  paletteFooter: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexShrink: 0,
    boxSizing: "border-box",
    height: 34,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  paletteHint: { display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 },
  paletteCount: {
    minWidth: 0,
    marginInlineStart: "auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontVariantNumeric: "tabular-nums",
  },
  // A header's choice of two or three words, such as Files and Content.
  paletteSegments: {
    display: "flex",
    flexShrink: 0,
    gap: 2,
    padding: 2,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  paletteSegment: {
    minHeight: 24,
    height: 24,
    paddingInline: 10,
    fontSize: 12,
    borderRadius: `calc(6px * ${tokens.round})`,
  },
  paletteSegmentOn: {
    backgroundColor: { default: tokens.raised, ":hover:not(:disabled)": tokens.raised },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001f`,
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
