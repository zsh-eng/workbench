# Threads

A thread is one task: an agent's work and its changes, as a saved review, or
a Claude Code or Codex session that Med found. The threads that you have open
are **tabs**. All other threads are **history**.

The sidebar lists the tabs as sessions, one row each: **Pinned**, in the
order you pinned them, then **Recent**, newest activity first. There is no
grouping by repository. A session that handed off several reviews, such as
one for each branch, is one row: the review on screen, else the newest. The
row keeps the session's name and pin whichever review you open: the name you
gave it, else its first review's title. Its
side panel's **Reviews** lists them all, newest first, and opens each one;
**Archive** on the row archives them all. `⌘1`–`⌘9` open the session at that place in the list.
A row shows the agent's mark and the session's name, and at most one dot: blue
when something is new since you looked, amber when the work stopped. While the
agent works, its name dims under a passing light. **New thread**, a row at
the top, starts a thread, and **Settings** is at the foot.

Tabs stay loaded and Med follows their agents. History is cold: Med does not
load it or read its agents until you open it again.

## Tabs and their state

- A thread opens as a tab when you start it, when an agent hands off its work
  (`med review create`), when you keep a found session in Med, and when you
  open it from history. A found session opens as a tab once, when Med first
  sees its agent work. After you close it, it stays in history.
- A Med with another state folder than `~/.local/state/med` lists only its
  own threads: found sessions start hidden there. **Show sessions not kept in
  Med** in the palette shows them.
- A row's blue dot shows when a turn ended while you were elsewhere, while
  the agent waits for a permission answer or for your review, and after a turn
  that ended on a question, until you send a message from Med. `⌘0` opens the
  next tab that needs you, or else the next tab whose agent works.
- When you look elsewhere, Med tells you only that a tab needs you. While the
  sidebar is hidden, **Show sidebar** has a dot, and its name gives the count,
  such as "Show sidebar · 1 needs you". The installed app's Dock icon shows
  the count as a badge. **Notify me when a tab needs you** in `⌘K` turns on OS
  notifications for this browser; the browser asks for permission the first
  time. When a tab starts to need you and no Med window shows, Med sends one
  notification with the thread's title and the first line of its question.
  Click it to open the tab. Work that starts or ends sends none. **Stop
  notifying me when a tab needs you** turns them off.
- A Claude Code session's subagents show in its conversation, not in the
  sidebar.

## Close, reopen, and delete

- **Archive a session** with **Archive** in its row's menu, **Close tab** in
  `⌘K`, or `⌘⌥W`. Archiving does not stop the agent: Med stops its streams and
  Git checks, and the thread goes to history. No notice announces it; `⌘⌥T`
  (**Reopen closed tab**) opens it again, and `⌃Tab` finds it in history.
- Med archives a session on its own when its work has landed: you read it, it
  was off screen for 5 minutes, it does not need you, its agent does not work,
  and its branch has no commits ahead of its base and no uncommitted changes.
  The window that you used last does this. Med never archives a pinned
  session, one whose work it cannot check, or one with an unsaved draft.
- **Open from history.** `⌃Tab` shows the tabs and other workspaces first.
  Type a word, also while you hold Control, to search history too: closed
  threads and found sessions that are not tabs, by title, branch, repository,
  and first prompt, newest first. A history row has a hollow mark. `↵` opens
  it as a tab. **Open from history…** in `⌘K` lists history at once. `⌘⌫` on a
  history row, or its trash button, deletes the thread after you confirm.
- **Delete…** in a row's menu deletes the thread after you confirm: its saved
  review, its Review versions, and its comments. The agent's session stays in
  Claude Code or Codex; Med does not show it as a found session again.
- History does not grow without limit. Med keeps a closed thread's Review
  versions and comments for 30 days. Then it keeps only the title, the
  repository, the branch, and the sessions, for 180 days after the close; such
  a thread opens as its agent's session. Med prunes when it starts and once a
  day.

## New threads and the sidebar

- **New thread** (`⌥N`, or `⌘N` where the browser lets Med have it, as the
  installed app does; a browser tab keeps `⌘N` for a new window) asks one
  thing in its middle: **Where to work**.
  Your repositories are one list: those of your newest threads, tabs and
  history first, newest first, up to 5, then the others. The chosen one has a
  check. The list scrolls when it is long. Type in its filter to narrow it;
  `↑` and `↓` move, and `↵` picks. A first `Esc` clears the filter.
  **Add a folder…** at its foot opens Sources, where you register another
  repository or vault.
- The task box sits at the bottom, as in a chat. `↵` starts the agent on the
  task, and `⇧↵` adds a line; `⌘↵` starts from anywhere on the page. Under
  the box, one line of menus:
  - **Repository**, on the left, the same choice as the list. With only one
    repository, its name is plain text.
  - **Where the agent works**: **New worktree**, the default, makes a branch
    named for the task in a new linked worktree, so the work stays apart from
    your checkout; **Checkout** works on the checkout's current branch, which
    the item names.
  - **Model**: the agent's mark and its model. Its **Agent** submenu chooses
    another agent, when Med has more than one.
  - **Effort**, such as **High effort**, while the model has efforts. Claude
    Code starts on Opus 5.5 at medium effort and Codex on `gpt-6-astra`; Med
    keeps your last choice for each agent.
- **Superagent**, at the top of the sidebar, is one thread that sees the
  others ([The Superagent](#the-superagent)).
- `⌃Tab` steps through recent workspaces: hold Control, press Tab to step, and
  release to go.
- Rest the pointer on a row, and Med reads the thread before you click.
- A row's menu opens from its **⋯** button, which shows when the pointer
  rests on the row, or from a right-click, under the row and inside the
  sidebar. It has **Open pull request** (`G`, when the session has one),
  **Copy resume command** (`C`), **Pin** or **Unpin** (`P`), **Mark as
  unread** or **Mark as read** (`U`), **Rename** (`R`), **Move up** and
  **Move down** for a pin, **Archive** (`A`), and **Delete** (`D`). While the
  menu is open, a letter runs its item. Med keeps the pins, also across a
  restart and in history. A pinned session's first hand-off takes its pin.
- **Drag a row into Pinned** to pin it at that place, within Pinned to move
  it, and out to Recent to unpin it. While it drags, the list shows where it
  would land: the other rows make room, and Pinned shows even with no pins.
  `Esc` puts it back.
- **Rename a thread** with **Rename…** in its row's menu, a double-click on
  its row, or **Rename thread…** in the palette (`⌘K`). With the sidebar
  hidden, the field shows in the title band, where a double-click on the
  thread's name also renames it. `↵` keeps the new name, and `Esc` keeps the
  old one. The name shows in the sidebar, the title band, the window's title,
  history, and the palette. Med keeps it, not the agent: a new hand-off does
  not change it, and it stays after a restart. An empty name gives the thread
  its agent's title again.
- **Settings**, at the foot of the sidebar, opens the Sources page for now:
  the registered repositories and vaults.
- `⌘B`, or the button beside **New thread**, shows or hides the sidebar. In a window narrower than 760 pixels, the
  sidebar opens over the workspace, and a choice closes it.

## The Superagent

The Superagent is a thread for the other threads: ask it where things stand,
which threads wait on you and why, or to pass a direction to one of them. The
first click on **Superagent** starts it. Med makes it a folder of its own in
its state folder, which no list of repositories shows, and starts Claude Code
there on Opus at high effort with a brief: what the Superagent is for, and how
it works through `med`. After that it is a thread like any other: change its
model and effort in the message box, queue messages, or stop it. There is one
Superagent; the next click opens it.

It reads the threads with `med thread list --json` and their transcripts, and
sends a message to a thread with `med thread send <id> "<message>"`, which the
thread's agent gets as `From the Superagent:` and the message, at its next
step, or after its turn with `--after-turn`. It answers no permission
request, approves, merges, pushes, and deletes nothing, and edits no thread's
files itself. Med schedules nothing; the Superagent uses Claude Code's own
scheduling when you ask for a check later.

## A thread's pane

- A thread's pane has the tabs **Review**, **Changes**, and **Commit**.
  **Changes** are the checkout's Git changes as they are now; Med saves
  nothing for them. Coming back to **Changes** shows the changes it showed
  last at once, while Med reads them again and updates them if anything
  changed. On a branch other than the base, they start at the base:
  the branch's commits and its uncommitted changes (**Branch changes**). The
  list of files also lists those commits, oldest first, when there are two or
  more: a commit shows on its own, and **All changes** goes back. When the
  thread's Review covers a range, as a pull request's does, **Changes** list
  the commits of that range instead, the same list as **Review**. On
  the base branch, they are the working changes. The comparison menu also has
  working, staged, and unstaged changes, and a commit that you open. In a
  checkout that other sessions share, such as the main checkout, **Only this
  session's files** keeps the files that the thread's Claude Code or Codex
  session edited.
- **Set a thread's branch and base** from its comparison menu in **Changes**.
  The menu's button names both, such as "station-search since main".
  **Thread checkout…**, or `⌘⇧G` in a thread, chooses another branch or
  worktree of the repository: `↵` moves the thread there. Use it when the
  agent works in a checkout other than the one that the thread started in.
  The thread's Changes, its row, and the title band then show that checkout,
  also after a restart. A branch that has no worktree opens in a new
  workspace, as Med never switches branches; `⌘↵` opens any choice in a new
  workspace. **Base branch…** chooses what the branch's changes start from:
  the commits since that branch, and the uncommitted changes. The thread
  keeps the base, and its row counts the changes since it. Choose the
  repository's usual base to go back to it. Moving a thread changes only
  what Med shows; the agent's session keeps its own folder.
- **Review** is what the agent hands off (`med thread show`, or
  `med review create --key …`): its Guide or its diff.
  Each hand-off replaces the Review, which opens on what is new since you
  looked; Med shows no version numbers. A hand-off of several checkouts has a
  menu of them above the diff. Git's comparisons are only in **Changes**. In a thread with a Review, the **Changes** tab has no file
  count, so that the tabs keep their places. A thread opens on **Review**
  after a hand-off and on **Changes** before one. A hand-off that arrives
  while you read adds **Review** and does not move you. In the
  conversation, each hand-off (`med review create`) is a card with Med's
  mark that opens the Review; while the agent writes it, the card is dashed
  and shimmers, and it stays in view when the turn's work folds. A reply's
  link to a review in Med, such as the agent's **Review changes here**, is
  the review's card too. A file that a reply names is a link with the file's
  language icon. When the checkout changes after a version, a bar offers
  **Refresh review**, which saves the checkout again as a new version, and
  **Show Changes**. An older thread, which saved its checkout when it
  started, keeps that capture as version 1; an empty capture alone is not a
  Review.
- The band above the workspace names the checkout that it shows: the
  repository, the branch, and a linked worktree's folder. Click the branch to
  copy its name, or the repository or the folder to copy the checkout's path;
  the part turns to the accent for a moment. In a thread with a pull request, the pull request leads the
  band, and the checkout follows it. With the installed app's title bar hidden, the band is the
  title bar, beside the window controls; while the sidebar is hidden, the band
  starts with **Show sidebar**.

**Open a repository** (`⌘O`) is a small picker of your repositories, ranked
as zoxide ranks folders: by how often and how recently you opened them. One
word from the name is enough, and more words narrow it. A row shows the
repository's name and its current branch; the folder shows only when two
repositories share a name. `Tab` moves the repository into the box and
searches its branches, its worktrees first; `⇧Tab` goes back. `↵` opens the
repository's own checkout, or the branch; from a thread, it opens beside it.

The branch switcher (`⌘⇧G`) searches the branches and worktrees of every
registered repository. `↵` opens a branch in the current workspace; `⌘↵` opens
it as a new workspace. In a thread, `↵` moves the thread to the branch's
worktree (**Thread checkout**, above).

Tabs stay loaded, so a switch is immediate; with more than 16 tabs, the ones
shown least recently unload and stay in the sidebar. Of the other workspaces,
such as branches, the six most recent stay loaded. Only the workspace on screen
gets live updates; the others catch up when you return. A thread keeps its
`/review/…` address, and Back and Forward move between workspaces. In a
browser tab, which keeps `⌘1`–`⌘9`, use `Ctrl+1`–`Ctrl+9` or the installed
app.

## Agent sessions

A review that records its agent session has **Show agent session**: the
review's **Restore**, at its top right, while the session hides, and the
palette. Both open the Session pane:
prompts, replies, thoughts, tool calls with output and diffs, the plan, and
background shells and agents. It follows the session live.

- In a wide pane, the thread keeps to a column in the middle of the pane,
  with text 768 pixels wide as in Claude Desktop: the replies, the code
  blocks and tool output, the cards under the thread, and the message box.
  A narrower pane, or the side panel, narrows the column. The pane keeps the
  width that you give it; drag its edge to give the review the room beside
  the column. Markdown files, pull request drafts, and the Guide read at the
  same width.
- Type: Markdown files and briefs read at 15 pixels. The thread's prompts and
  replies read at 14.5 (a little smaller in Paper, as its documents are), so
  a line holds about as many characters as Claude Desktop's. Code and tables
  in either read at 0.867 of the text; diffs stay at 12 pixel monospace.

- The session's menu has the agent's name, such as **Claude**. It holds the
  review's sessions and **Show work**. **New thread** (`⌥N`, or `⌘N` where
  the browser lets Med have it) starts another session.
- **Hide**, at the pane's top right, hides the pane (`⌘⇧B`). It does not stop
  or close the session: the agent keeps working, and its row in the sidebar
  shows its state. The review's **Restore**, at its top right where
  **Expand** was, `⌘K`, or `⌘⇧B` again, shows the pane.
- A long session opens on its latest work. Scroll up for earlier work, or go
  to a prompt from the prompt rail.
- The **prompt rail** at the thread's right edge has a dash for each prompt,
  the first at the top; the dash of the turn in view is longer and darker.
  The pointer on the rail, or the focus in it, lists the prompts with their
  times, and a click goes to one, loading the earlier pages back to it.
- Under a turn's final reply, as in Claude Desktop: **Copy**, which copies
  the whole reply as Markdown; **Fork from here**; and how long ago the reply
  came (hover it for the date and time). They show while the pointer or the
  focus is on the reply, and stay under the latest one. A prompt has **Copy**
  beside its bubble.
- **Fork from here**, on a Claude Code session's reply, starts a new thread on
  the same checkout. Its session starts from this one's history up to that
  reply, with the reply's model and effort, so it reads the session's prompt
  cache. The new thread opens in front and shows that history until you send
  its first message; the thread that you forked stays as it is.
- A finished turn shows its prompt and final reply; its other work folds into
  one **Worked for** row. Click the row to open that turn, or **Show work** to
  open every turn.
- **Times** show only the digits that change as often as Med updates them. A
  running turn's status line has the one clock: from 1 s it counts whole
  seconds ("42s", "1m 05s"), from 10 minutes whole minutes ("12 min"), and
  from an hour "1h 05m". It changes at each whole second or minute from the
  turn's start. A running tool call spins and shows its time when it ends.
  Finished times use the same form and show from 1 s.
- **Background**, above the message box, lists the shells and agents that run
  in the background: the address that a dev server printed, and how long each
  has run, in minutes. A task that ends shows how it ended in its place:
  **Done** leaves after a few seconds, and **Failed** stays until you open it,
  hide the list, or send the next prompt. With nothing to show, the list is
  gone. × hides it until a new task starts.
- With focus in the thread, `[` and `]` step through prompts and replies, and
  `{` and `}` through the prompts alone. A task in **Background** goes to its
  call.
- A turn that ended while you did not see its session ends with a recap,
  under the last reply. The recap is one line of facts that Med knows, such as
  `2 files · +14 −3 · bun test 5 pass · tsc fail`, then **Review** and
  **Reply**. **Review** (`⌥↵`) opens the Review tab at what is new since you
  last looked, or at the Guide's overview; before the agent hands off a
  Review, it opens Changes at the first file. **Reply** puts the focus in the
  message box. ×, or `Esc` in the recap, hides it until the next turn. A turn
  that ends while you watch its session has no recap.
- A session with subagents shows tabs above its thread: **Main** and one per
  subagent, with a spinner while it works. Click a tab, or use `←` and `→` on
  the tabs, to read that subagent's thread; `Esc` goes back to **Main**.
- A prompt longer than 16 lines shows its first 12. **Show more** opens it,
  and **Show less** folds it again.
- A prompt's images are square thumbnails. Click one to see it at full size,
  and use `←` and `→` for the others.
- A reply, a prompt, or a Question answer that names a file of the thread's
  checkout shows it as a link with the file's name and lines, such as
  **filters.ts L8–17**. Med finds Markdown links, `file://` links, and paths in
  inline code or in a prompt: `src/a.ts:10`, `src/a.ts:10-20`, `a.ts#L12`, or an
  absolute path inside the checkout. Hover a link to see its path. Click it to
  open the file as a tab, at its first line, with its lines marked; `⌘`-click
  opens the tab behind the current one. Close the tab to go back to the tab
  that you read before it. Text that names no file of the checkout stays as
  it is.
- Comments link files the same way: yours, the agent's (Guide comments and
  replies), and GitHub's (threads on lines, the conversation, review
  summaries, and pending comments). A comment's paths link also in its text,
  as in a prompt, and a GitHub link to a file at the pull request's head
  opens the file in Med. Paths in code blocks, and paths that name no file of
  the review's checkout, stay text.
- A web link shows as a pill with its
  site's icon. Med holds the icons of common developer sites, and of servers
  that a company runs itself, such as GitHub or Sourcegraph; other sites show a
  globe. Med fetches no icons.

A Session pane without a session lists the agents that Med found, and its **+**
menu starts one. Med starts Claude Code, Codex, OpenCode, or Gemini CLI in
the review's repository, with your own sign-in; it does not install them.
Antigravity (`agy`) is off unless the server starts with `MED_AGY=1`
([agent workspaces](../AGENT_WORKSPACES.md#antigravity-is-off)). To have a thread's agent hand off its work with a guide, add the
lines from `med skills instructions` to your CLAUDE.md or AGENTS.md. The agent
gets your messages from Med as new turns. The message box has model, effort,
and mode pickers, `/` commands, and **Stop** (or `Esc`). Model and effort
change while the agent works too, from its next step; Claude Code's max
effort, or its default, waits for the turn to end. A tool call that
needs an answer shows **Allow** and **Deny**. While the agent works, **Send now**
(`⌘↩`) sends a message at its next step: Claude Code reads it after the
tools that run, in the same turn, and Codex takes it in the turn that runs.
`⇧⌘↩` queues it for the turn's end instead, as the next prompt; the queued
message has **Send now**, which sends it at the next step. **While the agent
works, ⌘↩ queues for the turn's end** in `⌘K` swaps the two keys. Other
agents take messages only between turns, so for them the button is
**Queue**. Until a message goes, **Edit** or `↑` brings its text back into
the box (attachments stay out, and the box says so), and **Remove** drops it.
The pane's header
shows how full
the context is and what the thread has spent, subagents included; click it
for where autocompact starts and each model's tokens. A pane with room beside
its thread shows a side panel instead: the context, the spend, the background
tasks, the subagents, links to the thread's Review, Changes, and pull request,
and where the agent works. There the subagents are a list, with each one's
state, in place of the tabs over the thread. Its button in the header, `⌘⌥⇧B`, or `⌘K` hides or shows it.

- **Mode** shows the mode that Claude Code reports, also after an approved
  plan changes it: **Ask**, **Accept edits**, **Plan**, **Auto**, **Don't
  ask**, or **Bypass permissions**. Med starts a new Claude Code session in
  **Auto**, where a classifier allows safe actions and asks about risky ones.
  A thread's next session starts in the mode that the thread chose last,
  except Bypass. A session keeps its own mode when it resumes. `⇧Tab` in the message box steps through
  Ask, Accept edits, Plan, and Auto, as in the terminal; Bypass joins them once
  you chose it. **Bypass permissions** asks first. If Claude Code started
  without it, Med starts it again with the same session, between turns.
- When Claude Code asks a question, its choices show above the message box.
  Number keys pick one, from the card or from the empty message box, and the
  number after the last choice goes to **Other** for an answer of your own. A
  single question with one answer goes as soon as you pick; otherwise
  **Answer** sends them all. **Skip** declines.
- When Claude Code ends planning, its plan shows as Markdown. **Approve**
  continues in the mode you choose beside it (Accept edits at first), and
  **Keep planning** takes an optional note on what should change.

A Claude Code session that you kept in Med or adopted gets your messages when
Med can run it:

- When no process runs it, Med resumes it with your message as its next
  prompt. Med then runs the session, with the pickers and **Stop**, also
  after a restart. The session goes on with the model and effort of its last
  reply, which the pickers show, so it reads the prompt cache that it wrote.
- When Claude Code has it open in a terminal, you read the thread in Med, and
  the message box is shut: "Claude has this session open in a terminal. Med
  can't type there." In the Claude app it says "open in the Claude app"; in
  any other app, "open in another app". Copy the comments into that session,
  or continue it here.
- **Continue in Med**, on that line or in `⌘K`, forks the session into one
  that Med runs, with the model and effort of its last reply, and the message
  box opens on the fork. The thread follows the fork; the terminal or app
  keeps its own session.

Type `@` in the message box, or in a new thread's task, to name a file in the
checkout, a note in a registered vault, or another thread. A query can have
spaces, as note names do. The best match comes first; `↵` or `Tab` adds it, and
`Esc` keeps the `@` as text. The box shows a short name as a chip,
and the agent gets the absolute path, which it reads itself: a file's or a
note's path, or another thread's session transcript.

Paste or drop images into the message box, or use its image button. Claude
Code and ACP agents that take images get them with the message, up to ten of 5
MB each. Other agents get the paths of saved copies, which Claude Code and
Codex open themselves; Med keeps the copies for 30 days. Med stops its agents when the server stops. See
[agent sessions](../SESSIONS.md).

## Scheduled

Med shows what Claude Code scheduled and never runs a schedule
([details](../SCHEDULES.md)). A `CronCreate` or `ScheduleWakeup` call is a card
in the thread: "Every hour at :23", its prompt, recurring or one-shot, when it
expires, and Cancelled, Expired, Fired, or Missed. A `CronDelete` changes its
job's card to Cancelled and is a row of its turn's work, so one schedule is
one card. A job of a session ends with it, which the card says. The cards are
the only place Med shows schedules; the sidebar does not list them. The Claude
app's scheduled tasks are not shown: Med cannot read their schedules
([why](../SCHEDULES.md#desktop-scheduled-tasks-left-out)).
