# Adapt a good reference

Use an existing app to make a precise interaction decision. Study what happens
before, during and after an action, then implement that behavior with the new
app's own components and data model.

## Start with a sequence, not a screenshot

Write a small contract before coding. For a theme picker:

- Opening preserves the current theme.
- Moving through choices previews them immediately.
- Confirm keeps the selected theme.
- Dismiss restores the original theme.

The screenshot supplies spacing and hierarchy. This sequence supplies ownership,
persistence and cancellation. Test both.

For a message-like note composer, inspect empty, focused, typing, sending,
failed-send and dismissed states. A pill shape alone will not make it feel like
Telegram. Check input height, keyboard movement, when Send appears, where focus
goes, and whether a cancelled draft changes stored data.

## Examples from our projects

| Reference | What transferred | What stayed local |
| --- | --- | --- |
| Zed theme picker → med | Preview, confirm and dismiss behavior; restrained visual hierarchy | React controls, semantic theme tokens, Pierre syntax-theme mapping |
| snacks.nvim picker → med | Selection previews inside the picker; Enter opens; Escape preserves the workspace; source-scoped resume | Browser focus, request cancellation, cache bounds and source identity |
| Hunk → med | Selected review semantics and their tests, adapted with provenance | Browser renderer, host transport and application composition |
| Telegram image lists → Arctic | Visible versus loaded ranges, compact representations and immediate visual feedback | SwiftUI lazy stacks, ImageIO codecs, viewport preloading and app-specific limits |
| Telegram composer → Arctic | Compact input, a short quoted passage with a colour accent, direct send feedback | Article ownership, note persistence, saved/unsaved rules and Reader controls |

These are different forms of reuse. med uses Pierre as a dependency, adapts a
specified Hunk source revision, and uses Zed/Snacks as behavior references. Arctic
did not import Telegram's custom list renderer. Name the type of reuse clearly.

The med checkout records these decisions in `upstream/THEMES.md`,
`upstream/HUNK.md`, and its README. Hunk source records pin
revision `9b95a71b76c472bad21ffa5cc6b01b204e2f6f7a` and retain the original MIT notice
and matching tests. Keep that level of provenance when source is copied.

## Read the mechanism that explains the behavior

Useful primary references:

- [Telegram ListView](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/Display/Source/ListView.swift)
  exposes separate loaded and visible ranges. This is more useful to preloading
  design than assuming every created row is on screen.
- [Telegram photo resources](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/PhotoResources/Sources/PhotoResources.swift)
  supports immediate thumbnail data and several image representations. Arctic
  receives plain website URLs, so it must create its own preview after download.
- [Telegram Undo overlay](https://github.com/TelegramMessenger/Telegram-iOS/blob/master/submodules/UndoUI/Sources/UndoOverlayController.swift)
  is a focused reference for transient confirmation with an action.
- [Zed theme selector](https://github.com/zed-industries/zed/blob/main/crates/theme_selector/src/theme_selector.rs)
  keeps original theme state while selection is in progress.
- [Snacks picker](https://github.com/folke/snacks.nvim/blob/main/docs/picker.md)
  documents picker behavior; it is not a browser component to install.

Upstream branch links can change. Record the inspected revision when copying
source or depending on a specific implementation. A product observation is a
hypothesis about its mechanism until the relevant source or trace confirms it.

## Translate deliberately

1. **Select one useful behavior.** State the problem it solves in this app. Avoid
   a general request to make everything look like the reference.
2. **Capture states and geometry.** Record text width, padding, touch target,
   keyboard overlap and light/dark appearance. Include long text and Dynamic Type.
3. **Separate preview from commit.** A highlighted search result need not replace
   the active document. A note draft need not create an article or highlight.
4. **Keep platform ownership.** Use native selection, keyboard and scroll behavior
   where possible. Do not put a second virtualizer around an existing renderer.
5. **Assign async work an identity.** Cancel stale previews and reject results from
   another article, repository, account or picker selection.
6. **Use the app's visual language.** Map colours to existing semantic tokens.
   Keep typography and accent consistent. Translate motion to the available
   platform; a short opacity transition may be enough.
7. **Test interruption and failure.** Repeat the action, change selection quickly,
   dismiss mid-request, turn off the network, use Reduce Motion, and check that
   the original content and stored state remain correct.

## Review the result on two axes

**Does it behave correctly?** Check open → preview → commit/cancel → reopen,
including stored state. A pleasing animation cannot hide data loss or save a
cancelled draft.

**Does it feel right?** Check real-device input, frame timing, optical alignment
and visual density. Stable geometry and timely feedback matter more than adding
motion. Use [UI performance](UI_PERFORMANCE.md) for measurable checks.

A small reference note is enough for future work:

```text
Reference + revision:
Behavior to retain:
Local differences:
States and failure cases:
Implementation owner / files:
Tests and device evidence:
Copied source or assets + provenance, if any:
```

Keep dependencies, adapted source and visual inspiration separate in credits.
Do not describe a reference as an integration or claim the reference app's
performance for a new implementation.
