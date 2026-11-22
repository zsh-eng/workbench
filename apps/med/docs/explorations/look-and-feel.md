# Look and feel: what Linear, Claude and Telegram do, and what Med can use

Research of 2026-11-22. Subject: the look and feel of Linear (web, desktop and
mobile), Anthropic's Claude apps (desktop and mobile) and Telegram (iOS,
Android and Web A). Purpose: decide what Med removes, what it refines and what
new interaction it adds. [claude-desktop.md](claude-desktop.md) covers the
structure of the Claude desktop app's Code tab; this page is about craft.

## How to read the sources

Three research passes (subagents) read primary sources: each product's own
writing, changelogs and docs, the stylesheets that linear.app and claude.ai
serve, and Telegram's open-source clients. Their numbers were not re-checked
by a second reader. A number marked **[CSS]** or **[source]** was
read from a stylesheet or a repository, not published by the company as a
rule. "Unverified" means that no source was found.

| Key   | Source                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------- |
| L-24  | [How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)                         |
| L-26  | [Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh) (March 2026)          |
| L-SX  | [Styling Linear for the future](https://linear.app/now/styling-linear-for-the-future-stylex)                      |
| L-QW  | [Quality Wednesdays](https://linear.app/now/quality-wednesdays)                                                   |
| L-D   | [Linear Diffs docs](https://linear.app/docs/diffs) and its changelog entries of May and November 2026             |
| L-LG  | [Linear Liquid Glass](https://linear.app/now/linear-liquid-glass)                                                 |
| L-CSS | Linear's served app stylesheet, read on 2026-11-22                                                                |
| C-CL  | [Claude desktop changelog](https://claude.com/docs/cowork/changelog.md)                                           |
| C-DD  | [Claude Code desktop docs](https://code.claude.com/docs/en/desktop.md)                                            |
| C-MG  | [Design guidelines for apps in Claude](https://claude.com/docs/connectors/building/mcp-apps/design-guidelines.md) |
| C-CSS | claude.ai's served stylesheets, read on 2026-11-22                                                                |
| C-KF  | [The artisans of AI](https://www.kinfolk.com/stories/the-artisans-of-ai/) (Kinfolk, with Anthropic)               |
| T-WA  | [Telegram Web A](https://github.com/Ajaxy/telegram-tt), commit 4566a14                                            |
| T-iOS | [Telegram-iOS](https://github.com/TelegramMessenger/Telegram-iOS), commit 24638bc                                 |
| T-B   | [telegram.org/blog](https://telegram.org/blog)                                                                    |

## Linear

**Colour.** A theme is three inputs: base, accent and contrast. Every other
colour is derived in LCH (L-24). In 2026 the generator derives more than a
hundred variables, and a selected row re-derives its text and borders against
its own background (L-SX). The March 2026 refresh moved the greys from cool
blue to "a warmer gray that still feels crisp", and made the sidebar "a few
notches dimmer" than the content (L-26). The accent is "typically reserved";
unread pips carry it.

**Type.** Inter Variable and Berkeley Mono. Sizes 11, 12, 13 and 15 px for
chrome; weights 450, 500 and 600 [L-CSS]. Hierarchy comes from weight and four
steps of text colour, not from size.

**Density and structure.** The 2024 goal was to "reduce visual noise, maintain
visual alignment, and increase the hierarchy and density of navigation" (L-24).
The 2026 refresh cut icons and made them smaller, removed coloured icon
backgrounds, and cut the separators that "had quietly proliferated" (L-26).
Radius is 4 px on controls, 8 or 12 px on comments [L-CSS].

**Motion.** A hover shows at once and fades out over 150 ms (L-QW). The speed
tokens are 0 s in, 0.15 s out, 0.1 s quick, 0.25 s regular and 0.35 s slow
[L-CSS]. Hover styles apply only under `(any-hover: hover) and (any-pointer:
fine)`; touch uses `:active` (L-SX). About 600 rules have that gate [L-CSS].

**Primitives.** Space peeks at the highlighted item, as Quick Look does. `G`
then a letter navigates; `J`/`K` move. Shortcut hints light up the key that is
pressed. In Diffs (L-D): a Guide orders the change with the core first; a
reviewed file gets a grey check and **Hide reviewed** removes it; a review can
be snoozed until its next comment; on the phone, a tap on a line adds it to
the message.

**Mobile.** A bottom toolbar that the user can reorder, with Create at the top
of every screen. Glass with a blur that grows at the scroll edges; refraction
was rejected because it "can make dense professional interfaces harder to
read" (L-LG).

**Onboarding.** About seven short screens that teach one thing, `⌘K`, and end
on creating the first issue. No tour (third-party teardowns).

**Play.** Hidden: a Konami code, a special transition while `⌘` is held on a
theme change, and loader variants. None of it is in a list or a toolbar.

**Principles.** "Don't compete for attention you haven't earned." "Structure
should be felt not seen." "If most people don't immediately notice what
changed, that's probably a good sign." (L-26)

## Claude's apps

**Colour and material.** Warm neutrals at hue 30–60° and 2–3 % saturation in
both themes; no pure black or white for text (C-MG, C-CSS). The clay accent
has its own token and is rationed: in the guidelines for apps inside Claude,
the primary button and the focus ring are ink, not clay (C-MG). One border ink at 15, 30 and 40 % alpha, 0.5 px wide.
Shadows only on floating layers.

**Type.** A serif for Claude's prose and a sans for the user's messages and
the chrome (C-CSS). The transcript became "a narrower, more readable column"
in July 2026, and in November the text-size setting was removed: "Transcripts
now read at one size. Use zoom" (C-CL).

**Layout.** The sidebar's **Group and sort** control shows only while a
heading is hovered. A side panel no longer opens by itself over the
conversation in a narrow window, and Escape closes it and returns focus to
what opened it (C-CL). In a split, the pane without focus is dimmed (C-DD).

**Feedback.** Steps "sit behind one status row, which opens with a click", and
the row speaks in words: "Needs your input", "Blocked", "Nothing new from
Claude for 2 minutes" (C-CL). The view stays at the sent message while a long
reply streams. Failures are one sentence and one action. Sound is opt-in.

**Primitives.** A comment on a diff line: hover, **+**, Enter adds, `⌘↵` sends
all (C-DD). A queued message waits in the conversation looking like a sent
one, with Send now, Edit and Remove (C-CL). A permission card puts Deny first
in tab order and never takes Enter for a destructive action (C-CL).

**Removed in 2026** (C-CL): the mode picker, the web-search toggle, the
summary view, **Mark as unread** for chats, the sidebar's "Get started"
checklist, the transcript text-size setting and the separate Queue button.
First run is: sign in, pick a folder, type.

**Play.** One mark, the spark, which is still while Claude listens and moves
only while it responds (C-KF, a paraphrase). Spectacle is opt-in, in a theme
plugin.

**Principles.** "Reveal complexity only when users need it." Inline cards get
at most two actions (C-MG).

## Telegram

**Speed.** The app paints from a local cache and keeps each thread's scroll
position and draft [T-WA]. A sent message shows at once with a pending mark
that becomes a check. Network state is small text in the header
("Updating"), never a page spinner. Skeletons are rare.

**Lists.** Unread state uses little ink: an accent pill, the same pill in grey
for a muted chat, and a pin that shows only when nothing is unread [T-WA]. A
chat with a draft moves to the top and says "Draft" (T-B). Swipe actions arm
with a haptic at a threshold [T-iOS].

**Threads.** A floating date pill shows while the reader scrolls and fades
0.3 s after 1 s of rest; a tap opens a calendar [T-WA]. Jump-to-latest shows
50 px from the end with a count of unread messages. A jump scrolls for
300–600 ms and then highlights the target for 1.5 s [T-WA]. An unread divider
marks where the reader left. Consecutive messages within 10 minutes group.

**Composer.** One main button with seven states (send, stop, record, edit,
schedule, forward, send once); its icon changes with a 0.4 s ease-out [T-WA].
A hold on Send offers the other ways to send. A bar above the field names what
the message replies to.

**Motion.** One house spring on iOS. Web A: 200 ms for menus, 300 ms for
layers on `cubic-bezier(0.33, 1, 0.68, 1)` [T-WA]. A context menu blurs what
is behind it by 10 px. An **Animation level** setting has three steps and a
switch for each effect.

**Gestures.** Swipe to reply at 45–60 pt with a haptic [T-iOS]. Hold a chat to
preview it (T-B). Double-click a message to reply on desktop [T-WA].

**Empty states and play.** One line and at most one action: "No messages here
yet...", "Folder is empty". Play is confined and plays once: a lone emoji
animates, an effect runs for 3 s, a status emoji loops twice and stops [T-WA].

## What the three agree on

1. **The first run is the product.** None of the three has a welcome page
   that is not also the work. The empty state does the setup.
2. **Colour is rationed.** The accent marks what is new or needs you. Nothing
   decorative is tinted.
3. **Say less over time.** Each of them removed controls, icons, separators
   and settings in 2026.
4. **Motion answers the hand.** Nothing animates by itself except the one
   mark that says "working". A hover does not fade in.
5. **Play is rare, earned and plays once.**
6. **The phone is its own layout**, with the main switch under the thumb.

## What Med already has

Quiet chrome ([quiet.md](quiet.md)), state by type in the sidebar (a working
thread shimmers; a dot means "needs you" or "new since you looked"), a turn's
work behind one row, a view that follows a streaming reply and lets go at the
reader's first move, palettes that open without animation from the keyboard,
lines and fills derived from the text colour, and `[` and `]` to step through
a thread's prompts.

## What Med takes from this

The design review of 2026-11-22 showed these as mock-ups. In short:

**Remove (done).** The dawn colours and the sun at the end of Changes. The
welcome page: Sources finds repositories and vaults itself.

**Refine (proposed, not built).**

- Things that one window says twice or three times: the branch (the band, and
  twice in the session rail), spend and context (the rail and under the
  message box), a file's change (numbers and five squares).
- Hover styles on touch screens, which stay after a tap.
- The phone's band, which holds nine controls and cuts the title to
  "Forgivin…".

**Add (proposed, not built).**

- **Peek:** hold Space on a thread, a file or a commit to see it without
  leaving.
- **The place pill:** while a long thread scrolls, a pill names the request
  that the reader is in.
- **Drafts in the sidebar:** a thread with comments or a message not yet sent
  says so.
- **A pane bar on the phone,** under the thumb.
- **The mark as the meter:** the review's sun fills as files are viewed.

Left out: glass and blur, a serif for the agent's prose, swipe to comment on a
code line (long lines scroll sideways under the same gesture), and an
animation setting.
