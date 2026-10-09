# Theme references

The picker follows Zed's preview / confirm / dismiss behavior. No Zed code is copied.

- Zed: https://github.com/zed-industries/zed/blob/main/crates/theme_selector/src/theme_selector.rs
- Vitesse by Anthony Fu: https://github.com/antfu/vscode-theme-vitesse
- Rosé Pine: https://rosepinetheme.com/palette/
- Tokyo Night: https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors
- Claude Light and Dark: the Claude desktop app's Code tab, which ships `claude-light` and `claude-dark` editor themes and design-system tokens for diffs (Claude 2.31226, read on 2026-10-09).
- Codex Light and Dark: the Codex desktop app's Codex Light and Codex Dark code themes and default appearance values (Codex 26.930, read on 2026-10-09). Chrome values are computed from the app's own formulas.
- Cursor Light and Dark: Cursor 3.12's built-in theme-cursor extension, from public copies such as https://github.com/evanlong-me/cursor-themes-vscode (commit d6cd033f).
- Paper Light and Dark: the Paper app stylesheet at https://app.paper.design. Paper has no syntax theme of its own; paper.design shows code with VS Code's Light+ and Dark+ colors, which Med uses through Shiki's `light-plus` and `dark-plus`.

The application maps these palettes to its own semantic surface tokens. Pierre loads its bundled Shiki syntax definitions on demand; no new theme package is installed. Claude, Codex, and Cursor have no Shiki build, so `themes.ts` maps their syntax colors to Med's own TextMate scope rules; no theme file is copied.

Code colors (selection, find matches, the editor's cursor line, and diff lines and changed words) use each theme's own VS Code keys, such as `editor.selectionBackground`, `editor.findMatchBackground`, and `diffEditor.insertedLineBackground`. Where a theme leaves a key unset, `themes.ts` names the value Med uses instead. `code-colors.ts` converts the translucent values for Pierre, so a selected line keeps its addition or removal color under the selection. When a theme's selection is strong, a selected line range uses a lighter fill of the same color; its line numbers keep the full strength. Graphite Dark and Light are original neutral palettes, not an official Vercel theme. Geist fonts come from Vercel; their source and license are recorded separately in GEIST.md and GEIST-OFL.txt.
