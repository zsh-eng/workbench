# Theme references

The picker follows Zed's preview / confirm / dismiss behavior. No Zed code is copied.

- Zed: https://github.com/zed-industries/zed/blob/main/crates/theme_selector/src/theme_selector.rs
- Vitesse by Anthony Fu: https://github.com/antfu/vscode-theme-vitesse
- Rosé Pine: https://rosepinetheme.com/palette/
- Tokyo Night: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors
- Pierre Light, Dark, Soft, Vibrant, and the color-blind variants: `@pierre/theme` 2.0.0 (Apache-2.0), which `@pierre/diffs` already depends on.
- GitHub, Light+ and Dark+, Catppuccin, One, Solarized, Gruvbox, Everforest, Kanagawa, Ayu, Night Owl, Min, Nord, Dracula, Monokai, Poimandres, Vesper, Houston, and Vitesse Black: the Shiki builds in `@shikijs/themes` 4.4.3, each under its own author's license.

## Generated editor themes

`scripts/generate-editor-themes.ts` writes `src/web/editor-themes.ts` from the Pierre and Shiki theme files that Pierre already bundles. It copies no syntax rules: Pierre loads each theme's own definition when it is chosen. The script reads a few VS Code `colors` for Med's palette (`editor.background`, `editor.foreground`, `sideBar.background`, borders, `textLink.foreground` or `focusBorder`, Git decoration and terminal colors) and the code colors under the same keys as the tuned themes. A key that a theme leaves unset, or sets too close to the canvas, is mixed from its text and canvas, and status colors are moved toward the text until they read at 3:1. Display P3 colors (Pierre Vibrant) are converted to sRGB. Where a theme's keys pick a gray or a comment color for its accent, the script names the theme's signature color instead (Solarized blue, Night Owl blue and red, Dracula purple and yellow, Monokai cyan and pink). These themes use Med's own aesthetic.
- Claude Light and Dark: the Claude desktop app's Code tab, which ships `claude-light` and `claude-dark` editor themes and design-system tokens for diffs (Claude 2.31226, read on 2026-10-09).
- Codex Light and Dark: the Codex desktop app's Codex Light and Codex Dark code themes and default appearance values (Codex 26.930, read on 2026-10-09). Chrome values are computed from the app's own formulas.
- Cursor Light and Dark: Cursor 3.12's built-in theme-cursor extension, from public copies such as https://github.com/evanlong-me/cursor-themes-vscode (commit d6cd033f).
- Paper Light and Dark: the Paper app stylesheet at https://app.paper.design. Paper has no syntax theme of its own; paper.design shows code with VS Code's Light+ and Dark+ colors, which Med uses through Shiki's `light-plus` and `dark-plus`.
- Linear Light and Dark: the color, font, and radius variables in the linear.app website stylesheet (read on 2026-10-09). Linear has no code theme; Med uses Pierre's syntax colors. Linear Light's green, red, and warning are darker than Linear's so they read as small text on white.

## Aesthetics

A theme family also sets fonts, a corner scale, hairlines, selection, the primary button, section labels, and shadows (`aesthetics` in `src/web/themes.ts`). Brand fonts are not bundled: each stack names the product's own font, then the system fallback it uses, so only an installed copy appears.

- Claude: the Claude desktop app's design-system variables (`--font-anthropic-sans`, `--font-voice` serif for reading, `--radius` 8 px, card radius 12 px, `--cds-fill-primary` dark fill), read on 2026-10-09.
- Codex: OpenAI's apps, observed: the system sans, generous corners, and pill buttons. No source is copied.
- Cursor: VS Code's workbench conventions that Cursor keeps: the system font, small corners, and uppercase section headers.
- Linear: the linear.app stylesheet's `--font-regular` (Inter Variable), `--font-weight-medium` 510, radii 4–12 px, and indigo brand fill.
- Paper: Paper's mono interface as the user supplied it in a screenshot of Paper's "hello-mono" file: Paper Mono throughout, nearly square corners, light accent outlines, a solid accent selection with white text, uppercase tracked accent labels, accent-filled segments, and no shadows.
- Graphite, Rosé Pine, Tokyo Night, Vitesse, and the generated editor themes use Med's own aesthetic: Geist, soft corners, and a tinted selection.

The application maps these palettes to its own semantic surface tokens. Pierre loads its bundled Shiki syntax definitions on demand; no new theme package is installed. Claude, Codex, and Cursor have no Shiki build, so `themes.ts` maps their syntax colors to Med's own TextMate scope rules; no theme file is copied.

Code colors (selection, find matches, the editor's cursor line, and diff lines and changed words) use each theme's own VS Code keys, such as `editor.selectionBackground`, `editor.findMatchBackground`, and `diffEditor.insertedLineBackground`. Where a theme leaves a key unset, `themes.ts` names the value Med uses instead. `code-colors.ts` converts the translucent values for Pierre, so a selected line keeps its addition or removal color under the selection. When a theme's selection is strong, a selected line range uses a lighter fill of the same color; its line numbers keep the full strength. Graphite Dark and Light are original neutral palettes, not an official Vercel theme. Geist fonts come from Vercel; their source and license are recorded separately in GEIST.md and GEIST-OFL.txt.
