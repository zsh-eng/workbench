# Using Med

Med shows Git changes, files, and notes in your browser, from a server on your
Mac. This guide covers the app. To hand off reviews from coding agents, see
[agent reviews](AGENT_INTEGRATION.md).

## Run Med

`med web` starts one background server and opens Med in your browser. The
server keeps running when you close the terminal or the browser. `med status`
shows it, `med stop` stops it, and `med serve` runs it in the foreground.
The agents that Med starts keep working while the server stops or restarts,
and the next server takes them up. An agent stops a minute after its
thread's tab closes, once its turn ends. `med agents` lists the agents, and
`med agents stop --all` stops them.

Med serves port **6330** and keeps its state in `~/.local/state/med`. For a
second profile, give every command the same `--port` and `--state-dir`. Med
does not choose another port for you; a port in use is an error.

When Med is out of date, an open page says so. **Restart** replaces a server
that runs older code, and **Reload** loads a newer page. Med first checks that
the new build starts; if it does not, the current server keeps running and the
notice shows the error. The command palette has **Reload Med** and **Restart
Med server and reload**. A server that you started with `med serve` asks you to
restart it in its terminal.

### Start at login

- **Open at login** on the setup page, or `med service login on`, opens Med at
  your next login. It does not change the running server.
  `med service login off` removes it.
- `med service install` installs a per-user LaunchAgent that starts the server
  at login and restarts it after a crash. Run `med stop` first, and keep the
  executable at the same path. `med service uninstall` removes it.

The login service keeps the PATH of the install command, so it finds the same
Git and Go as a server that you start in a terminal. Install it again after a
tool moves. Its log is `service.log` in the state folder. On other systems, run
`med serve` from your own service manager.

launchd reads no shell profile, so the login service reads your login shell's
environment once as it starts (`$SHELL -i -l`, at most 5 s) and gives it to
the agents that it starts. A token or a PATH that `~/.zshrc` exports, such as
`ANTHROPIC_API_KEY` for Claude Code, then reaches the agents as in a terminal;
restart the service after you change it. Your profile can check
`MED_RESOLVING_ENVIRONMENT` to skip slow work, and `MED_SHELL_ENVIRONMENT=0`
turns the read off.

### Install as an app

In Chrome or Edge, select the install icon in the address bar, or **Install
Med** in the browser menu. Med then has its own window and Dock icon, and gets
the shortcuts that a browser keeps for its tabs. The app needs the background
server, so use `med service install` to start the server at login. Each port is
a separate app.

The title bar's hide button gives Med the whole window. The branch and the
sidebar toggle move up beside the window controls, and the review card's first
row rises between them as the card's tab; side panes start below it. With
branch tabs open, the branch tabs head the window instead. Empty parts of the
top row move the window. Show the title bar again from the same place. Chrome
reads this from Med's manifest at a later launch; reinstall the app to get it
at once.

## Sources

The first time `med web` runs with nothing registered, Med shows a setup page:

- **Repositories** and **Obsidian vaults** list what Med finds in your home
  folder, most recent first. Ones used in the last three weeks (vaults: two
  months) start selected. Linked worktrees, dependency folders, and hidden
  folders are left out. Med searches Desktop, Documents, and Downloads only
  when you choose **Search them too**, because macOS asks permission first.
- **Add a folder by path** adds a repository or vault that the search missed.
- **Open at login** starts Med when you log in.

Setup reads folder names and Git metadata only. To open it again, choose **Add
sources…** on the Sources page, or **Set up Med…** in the command palette.

From a terminal, `med add` registers a folder, `med list` lists your sources,
and `med remove` removes one. Registration persists across restarts. A linked
worktree belongs to its repository; separate clones stay separate, even with
the same remote. On the **Sources** page, a row's **⋯** menu can index a vault
again, copy the path, or remove the source. Removing a source keeps its folder.
See [notes and vaults](VAULTS.md) for vaults.

## Threads

A thread is one task: an agent's work and its changes, as a saved review, or
a Claude Code or Codex session that Med found. The threads that you have open
are **tabs**. All other threads are **history**.

The sidebar shows only the tabs, by repository, in your order. A new tab goes
to the top of its repository. Drag a row, or press `⌥↑` or `⌥↓` on a focused
row, to move it in its repository. A row does not move when its agent's state
changes, so `⌘1`–`⌘9` always open the tab at that place. A row shows the
title, the branch, the age, and the change totals.

Tabs stay loaded and Med follows their agents. History is cold: Med does not
load it or read its agents until you open it again.

- A thread opens as a tab when you start it, when an agent hands off its work
  (`med review create`), when you keep a found session in Med, and when you
  open it from history. A found session opens as a tab once, when Med first
  sees its agent work. After you close it, it stays in history.
- A Med with another state folder than `~/.local/state/med` lists only its
  own threads: found sessions start hidden there. **Show sessions not kept in
  Med** in the palette shows them.
- A row shows its agent's state by its type. The title is dim while the agent
  works, and the second line shows what the agent does now, such as "Running
  bun test". The title is bold when a turn ended while you were elsewhere.
  **Needs you** shows, with a dot, while the agent waits for a permission
  answer or for your review, and after a turn that ended on a question, until
  you send a message from Med.
- Above the tabs, a line counts the tabs that need you and the tabs whose
  agents work, such as **1 needs you · 2 working**. It shows only when a count
  is more than 0. Click a count to open the next tab of that kind. `⌘0` opens
  the next tab that needs you, or else the next tab whose agent works.
- When you look elsewhere, Med tells you only that a tab needs you. While the
  sidebar is hidden, **Show sidebar** has a dot, and its name gives the count,
  such as "Show sidebar · 1 needs you". The installed app's Dock icon shows
  the count as a badge. **Notify me when a tab needs you** in `⌘K` turns on OS
  notifications for this browser; the browser asks for permission the first
  time. When a tab starts to need you and no Med window shows, Med sends one
  notification with the thread's title and the first line of its question.
  Click it to open the tab. Work that starts or ends sends none. **Stop
  notifying me when a tab needs you** turns them off.
- A Claude Code tab lists its subagents under it: each one's task, and what
  it does now. The title is dim while the subagent works and bold when it has
  a result that you did not see. Click a subagent to open the thread with the
  subagent's tab in its Session pane. A finished subagent stays until you see
  the thread, then it goes from the list.
- **Close a tab** with the **×** on its row, **Close tab** in `⌘K` or in the
  row's menu, or `⌘⌥W`. Closing does not stop the agent: Med stops its streams
  and Git checks, and the thread goes to history. **Undo** in the notice, or
  `⌘⌥T` (**Reopen closed tab**), opens it again at its place. **Close and
  remove worktree** also removes the worktree that Med made; the branch
  stays, and Git keeps a worktree with changes.
- Med closes a tab on its own when its work has landed: you read it, it was
  off screen for 5 minutes, it does not need you, its agent does not work, and
  its branch has no commits ahead of its base and no uncommitted changes. The
  window that you used last does this, and a notice with **Undo** tells you.
  Med never closes a tab whose work it cannot check, or a tab with an unsaved
  draft.
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
- **New thread** (`⌥N`) asks for the task. Under the task box, one row for
  each choice lists all its options; one click chooses, and the chosen option
  has a highlight. **Repository** lists the repositories of your newest
  threads, tabs and history, newest first, up to 5, then the others, as many
  as fit on the line; **More…** lists them all, and you type to filter them.
  **Works in**: **New worktree**, the default, makes a branch named for the
  task in a new linked worktree, so the work stays apart from your checkout;
  **Checkout** works on the checkout's current branch, which the option names.
  **Attempts** gives the same task to 2 or 3 agents ([Attempts](#attempts)).
  **Agent**, **Model**, and **Effort** follow. Claude Code starts on Opus 5.5
  at medium effort and Codex on `gpt-6-astra`; Med keeps your last choice for
  each agent. A row with one option shows it as text. In a row, `←` and `→`
  choose; `Tab` goes to the next row. `⌘↵` starts the agent on the task at
  once, from anywhere on the page.
- `⌃Tab` steps through recent workspaces: hold Control, press Tab to step, and
  release to go.
- Rest the pointer on a row, and Med reads the thread before you click.
- Right-click a row to open it, rename it, copy a command that resumes the
  agent's session or opens lazygit in its checkout, mark it read or unread,
  close it, or delete it.
- **Rename a thread** with **Rename…** in its row's menu, a double-click on
  its row, or **Rename thread…** in the palette (`⌘K`). With the sidebar
  hidden, the field shows in the title band, where a double-click on the
  thread's name also renames it. `↵` keeps the new name, and `Esc` keeps the
  old one. The name shows in the sidebar, the title band, the window's title,
  history, and the palette. Med keeps it, not the agent: a new hand-off does
  not change it, and it stays after a restart. An empty name gives the thread
  its agent's title again.
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
  `med review create --key …`): its Guide, its brief in **Notes**, or its diff.
  Each hand-off is a new version. The row above the diff names the version
  and its age, such as "Version 2 · 5 min ago"; with more than one version,
  it is a menu of the versions, newest first. Git's comparisons are only in
  **Changes**. In a thread with a Review, the **Changes** tab has no file
  count, so that the tabs keep their places. A thread opens on **Review**
  after a hand-off and on **Changes** before one. A hand-off that arrives
  while you read adds **Review** and does not move you. When the checkout changes after a version, a bar offers
  **Refresh review**, which saves the checkout again as a new version, and
  **Show Changes**. An older thread, which saved its checkout when it
  started, keeps that capture as version 1; an empty capture alone is not a
  Review.
- **Repositories**, at the foot of the sidebar, lists the registered
  repositories and vaults by name. Click one to browse it without a thread;
  **+** opens the Sources page.
- `⌘B` shows or hides the sidebar. In a window narrower than 760 pixels, the
  sidebar opens over the workspace, and a choice closes it.
- The band above the workspace names the checkout that it shows: the
  repository, the branch, and a linked worktree's folder. Click it to copy the
  checkout's path. In a thread with a pull request, the pull request leads the
  band, and the checkout follows it. With the installed app's title bar hidden, the band is the
  title bar, beside the window controls; while the sidebar is hidden, the band
  starts with **Show sidebar**.

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

## Review changes

1. Choose branch, working, staged, or unstaged changes in the comparison menu
   above the diff. Branch changes are the commits since the base branch and
   the uncommitted changes; a branch other than the base opens on them.
   **Base branch…** chooses another base for them, and **Compare
   revisions…** in the review's menu chooses a range. A range compares
   snapshots; it does not add patches across merged branches.
2. Select a changed path to go to it in the diff. Double-click it to open the
   whole file.
3. Open unchanged files from the file picker or the Files pane. Each file opens
   in a tab of its own, beside Changes, and stays until you close it. A branch
   without a worktree opens its committed content.

To comment, drag the gutter **+** across lines, or select line numbers and
press `c`. A comment shows its Markdown rendered, such as code and lists, and
keeps your line breaks; `$HOME` and `$3` stay text, and only `$$` starts math.
**Edit** shows the text as you wrote it, and the agent gets that text. Hover the **+/−** totals to split them into code, tests, docs,
config and data, and generated files.

To ask the thread's agent about lines, select line numbers in Review, Changes,
or a Guide segment, and click **Ask** or press `a`. The **Question** pane opens
at the right of the review and names the file and the lines. Write the
question and press `⌘↵`. Med asks a fork of the thread's Claude Code session,
in plan mode, with the lines and their numbers. The answer shows in the pane;
the thread does not get the question or the answer. Escape or **Stop** ends the
answer. **Keep as comment** adds the question and the answer as a comment on
the lines. **Close** discards them; Med keeps no copy of the question or the
answer. A review has one question at a time, and Ask waits while an answer
comes. A Codex thread is
asked in the same way when Codex has `codex exec fork`; an older Codex answers
from the lines only, and the pane says so.

In a whole file, `⌥B` shows blame in the gutter; hover a label for the date and
message. When the cursor rests on a line, its author, age, and commit subject
show after the text. Click the short hash to copy the full hash. **Hide line
blame at the cursor** in the palette turns this off.

### Generated files and dependencies

Lockfiles, build output (`dist/`, `.vite/`), snapshots, minified files, and
files with a "generated" or "do not edit" header are **generated files**
([rules](GENERATED.md)). Changes and Review show them last, in a folded
**Generated** group, and the headline **+/−** does not count them. Each line
of the group names the file's kind, what changed ("12 indirect dependencies
updated", "3 snapshots: 1 changed, 2 added"), the agent command that wrote it
("written by `bun add zod`"), and the file that it comes from. Click the
group's row to add the files to the stream. Choosing a generated file in
Changed files, a search, or a link opens the group. In Changed files, the
generated files are in a second tree under a folded **Generated** row.

A generated file counts as viewed when its source is viewed, for example a
`bun.lock` when you mark its `package.json`. The group's check marks all of
them. Two warnings show on a generated file: **Edited by hand**, when an agent
session of the thread edited it directly, and **No manifest changed**, for a
lockfile without a changed manifest (correct after `bun update`).

A changed `package.json` gives a **Dependencies** card at the top of the
stream: each added, removed, or changed package, its old and new version, and
**major** when the major version goes up. **Look up licences and dates** adds
the licence and the release date of each version from deps.dev. This sends
package names and versions to deps.dev, so it is off until you turn it on;
the host keeps the answers. A licence change and a release less than a week
old show in the warning colour.

An agent can mark other files that a tool wrote when it hands off a Review
(`med review create --generated <glob>`). To change a file's mark yourself,
use Git attributes; they win over the agent's mark. A committed
`.gitattributes` applies for everyone; `.git/info/attributes` applies only to
your clone:

```gitattributes
src/schema.ts linguist-generated
bun.lock -linguist-generated
```

## Saved reviews

An agent saves a commit range or the working changes through the running
server, and gives you a link. Open the server's launch URL once in a browser;
saved links then work in new tabs of that browser. See
[agent reviews](AGENT_INTEGRATION.md#create-a-review).

A saved review keeps its diff when the agent makes more changes. An agent that
names its task with a key adds a version for each round of work. The Review
opens on the latest one and is marked new again; comments on earlier versions
stay. The version menu above the diff names each version and its age, and
the version keys at the top of **Notes** (`1`, `2`, …) show each version;
older versions move to a menu when the keys do not fit. A version with more
than one comparison, such as one for each repository, lists each one in the
menu by its repository, and so does a commit that you commented on while
browsing.

**Copy comments** copies the comments of all targets, with paths, revisions,
line numbers, and nearby source, for any agent. **Send to Claude** or **Send to
Codex** sends them to the review's own agent; see
[sending comments](#send-comments-to-the-agent). **Clear**
clears the review's comments after you confirm. Copying does not clear them.
Beside a thread, the review's header keeps only its tabs: **Send to** shows
when there are comments to send, and **Copy comments**, **Clear all
comments**, **Commands**, and **Files** are in its **⋯** menu.

The review's bar shows its title, or its pull request's title as a link. Hover
the title for the time Med saved the review and its repository. Beside a
thread, and in quiet chrome, a pull request is the thread's title in the
window's title band: its number and title, which open it on GitHub, its state
(**Open**, **Draft**, **Merged**, or **Closed**), and its author, then the
repository and branch in quieter text, and its comments at the band's end. A
long title is cut at its end; in a narrow band, the repository and branch go
first. The review card keeps its tabs as its first row. See
[titles and pull requests](AGENT_INTEGRATION.md#titles-and-pull-requests).

### Set up agents

```sh
med skills install
```

This writes the Med skill for Claude Code (`~/.claude/skills/med`) and Codex
(`~/.agents/skills/med`): `SKILL.md`, a short checklist that an agent reads
when it hands off changes, and `guide.md`, the guide that `med docs agents`
prints. `med skills show` prints the skill, and `med skills uninstall` removes
it. After an update, `med status` and `med web` say when an installed skill
differs from the new version's; `med skills update` refreshes it where it is
installed and installs it nowhere new. The install script runs it for you.
`med skills suggest` lists review
practices that you can copy into your own skills; see
[review practices](PRACTICES.md). For agents without skills, see
[AGENTS.md guidance](AGENT_INTEGRATION.md#agentsmd-guidance).

For threads that Med starts, add these lines to your CLAUDE.md or AGENTS.md,
such as `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. The first install prints
them, and `med skills instructions` prints them again. Edit them as you like;
Med adds nothing to an agent's prompt.

```markdown
## Med

Hand off finished changes for review with the `med` skill. In a thread that
Med started (`MED_SESSION=owned`), hand off each round of work with
`med review create --working --title "<2-4 words>" --guide -` (add `--paths`
in a shared checkout); messages arrive as new turns, so don't run
`med review wait`.
```

Review commands talk to the running server, so start Med with `med web`. They
find it through a private connection file in the state folder,
`~/.local/state/med` by default. Every command takes the folder from
`--state-dir` or `MED_STATE_DIR`, and the port from `--port` or `MED_PORT`.
Without a port, a command uses the server that runs from the state folder.
Port 6330 is for `~/.local/state/med`: a server of another state folder, such
as a second Med that an agent runs beside yours, takes a free port and says
which. Choose a port with `--port` for an address that stays the same after a
restart. A login service of another state folder needs `--port`. The commands
that Med prints for an agent to run next carry `--port` and `--state-dir`
when they are not the defaults. Saved reviews and their comments last as long
as the state folder.

Open the server's launch URL once in the browser where you review. Med changes
its token for a browser cookie and removes the token from the address; review
links such as `http://127.0.0.1:6330/review/r_…` then work in new tabs. Another
browser must open the launch URL once too. Never put the launch token in agent
instructions or review links.

### Agent sessions

A review that records its agent session has a Claude or Codex button in the
toolbar, and **Show agent session** in the palette. Both open the Session pane:
prompts, replies, thoughts, tool calls with output and diffs, the plan, and
background shells and agents. It follows the session live.

- The session's menu has the agent's name, such as **Claude**. It holds the
  review's sessions, **Show work**, **Turns**, and a new session with each
  installed agent.
- The button at the pane's top right hides the pane (`⌘⇧B`). It does not stop
  or close the session: the agent keeps working, and its row in the sidebar
  shows its state. **Agent session** in the review's **⋯** menu, or `⌘⇧B`
  again, shows the pane.
- A long session opens on its latest work. Scroll up for earlier work, or jump
  to a prompt from **Turns**.
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
- With focus in the thread, `[` and `]` step through prompts and replies. A
  task in **Background** goes to its call.
- A turn that ended while you did not see its session ends with a recap,
  under the last reply. The recap is one line of facts that Med knows, such as
  `2 files · +14 −3 · bun test 5 pass · tsc fail`, then **Review** and
  **Reply**. **Review** (`⌥↵`) opens the Review tab at the Guide's first
  segment that is not viewed; before the agent hands off a Review, it opens
  Changes at the first file. **Reply** puts the focus in the message box. ×,
  or `Esc` in the recap, hides it until the next turn. A turn that ends while
  you watch its session has no recap.
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
- A web link shows as a pill with its
  site's icon. Med holds the icons of common developer sites, and of servers
  that a company runs itself, such as GitHub or Sourcegraph; other sites show a
  globe. Med fetches no icons.

A Session pane without a session lists the agents that Med found, and its **+**
menu starts one. Med starts Claude Code, OpenCode, Codex (`codex-acp`), or
Gemini CLI in the review's repository, with your own sign-in; it does not
install them. To have a thread's agent hand off its work with a guide, add the
lines from `med skills instructions` to your CLAUDE.md or AGENTS.md. The agent
gets your messages from Med as new turns. The message box has model, effort,
and mode pickers, a context meter, `/` commands, and **Stop** (or `Esc`). A
tool call that needs an answer shows **Allow** and **Deny**.

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

A Claude Code session that you kept in Med or adopted gets your messages too:

- When no process runs it, Med resumes it with your message, and any
  messages that waited, as its next prompt. Med then runs the session, with
  the pickers and **Stop**, also after a restart.
- When Claude Code has it open in a terminal, the message box says "Claude
  has this session open in a terminal. Med can't type there." A message then
  shows "Waiting for the terminal session to close". In the Claude app, they
  say "open in the Claude app" and "Waiting for the session in the Claude app
  to close"; in any other app, "open in another app" and "Waiting for the
  session to close there". When that session ends, Med resumes it and sends
  the waiting messages. If that session runs `med review wait`, it gets them
  there instead.
- **Continue in Med**, on that line or in `⌘K`, forks the session into one
  that Med runs and sends it the waiting messages. The thread follows the
  fork; the terminal or app keeps its own session.

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
[agent sessions](SESSIONS.md).

Saved reviews persist in the state folder, until 30 days after you close
their tabs ([Threads](#threads)). Notes on a branch last until the server
stops.

## Review in Med

A thread's pane has the tabs **Review**, **Changes**, and **Commit**. It opens
on **Review**, at the latest version, once the agent has shown one, and on
**Changes** before that. The menu above the diff chooses a version; the keys
at the top of **Notes** do too. Hover the title in the review bar for the time
Med saved the review and its repository. A version with more than one
comparison, such as one for each repository, lists each one in the menu.
History and files stay available, and the **Review** tab brings back the saved
comparison. The saved diff and its context are captured; files that you open
from the file tree, and **Changes**, are live.

- **Comment.** Select lines in the diff. The card shows the lines, **L** for
  the old side and **R** for the new. Write, then press **Comment** or `⌘↵`;
  **Cancel** or Escape closes the draft. Saved comments have **Reply**,
  **Edit**, and **Delete**. Med shows each change at once and saves it in the
  background; if a save fails, Med restores the comment, reports the error, and
  keeps your text.
- **Ask** (`a`) asks the thread's agent about the selected lines, in a fork of
  its session in plan mode. The thread does not get the question or the
  answer. **Keep as comment** saves both as a comment on the lines
  (`Question: …`, then the agent's name and its answer); the agent gets it with
  the other comments.
- **Copy comments** copies, as Markdown, the comments on every comparison that
  you visited in the review, including commits from the history. It uses the
  field names of Codex diff comments: **File**, **Workspace**, **Side**,
  **Lines**, **Diff hunk**, and **Comment**, plus the comparison's ends, the
  capture type, and IDs. Replies name their parent. Each excerpt has the
  selected lines and up to three rows on each side, from the saved patch, or
  from labelled captured source when the patch does not cover them; it never
  reads current files. Copying waits for saves to finish and does not delete
  comments.
- **Clear**, then **Confirm clear**, removes the review's comments from all
  its targets. If the comments changed after you opened the confirmation, Med
  refuses the clear. Clearing does not delete the review or change files.
- **Compare against** compares the selected tip with its common ancestor on a
  local or remote-tracking branch. This browses; the saved review does not
  change. **Compare revisions…** compares two exact ends.
- **Push to remote** (the push button) opens a dialog with the exact commit,
  repository, remote, and branch. Choose a branch or type a new name, then
  select **Push to origin**.
  Med pushes committed history only; it does not force, delete remote
  branches, or push tags. Push hooks run, and a rejected push says what to do.
  A captured working comparison cannot be pushed.

With more than one comparison, **Total** in the review bar counts the lines of
all of them, from their captured ends, and stays fixed while you browse. The diff toolbar counts
the selected comparison. Targets that overlap can count a line twice; for pull
requests and stacked changes, use `--merge-base` so that merged work is left
out. Binary files count no lines.

### Send comments to the agent

A review with an agent session sends comments to that session, so you do not
paste them. **Send to Claude** (or **Send to Codex**) opens the Session pane,
with your text and the comments that you have not sent. Select the comment
count to choose comments. A GitHub comment's reply button, or **Add all to**
the agent in the pull request panel, adds GitHub comments. Press `⌘↵` or **Send**.

- **A session that Med started** in a thread gets the message as a new turn.
  It does not run `med review wait`; in such a session, the command exits at
  once. `MED_THREAD_KEY` and `MED_THREAD_REPO` give its `--key` and `--repo`.
- **Claude Code** in a terminal or app takes the message with
  `med review wait --key <task>`, which the skill runs in the background after
  it creates the review. The command
  waits with no time limit, prints the message, and ends; Claude Code then
  wakes the agent. The pane shows **Waiting for you** while the agent waits. A
  message sent earlier stays in Med until the agent waits. The command confirms
  each message that it prints; a message that no wait confirms within 10
  seconds, as when the waiting process stopped, goes to the next wait. When
  the Claude Code process ends with messages still waiting, Med resumes the
  session and sends them.
- **A Claude Code session that no process runs**, such as an adopted one
  after its terminal closed, resumes in Med with the message as its next
  turn, and Med runs it from then on. A session open in a terminal or another
  app that does not run `med review wait` gets its messages when that session
  ends, or in a fork with **Continue in Med**
  ([messages to adopted sessions](SESSIONS.md#messages-to-adopted-sessions)).
- **Codex** gets the message in its queue (`codex queue`), and the thread's
  next turn reads it first, as a user message. Med finds `codex` on the PATH,
  in the ChatGPT app, or at `MED_CODEX_PATH`.

The thread shows each sent message as waiting (for the agent, or for its
session in a terminal or another app to close), taken, or queued. A sent comment leaves the
drafts until you edit it or reply to it. Each message keeps the version of
each comment that it sent, from the same read as the agent's text, so an
edit while Med sends stays a draft.

## The Guide

When an agent attaches a guide, the **Review** tab opens on the Guide. A guide
splits the change into segments that you check one at a time, like a pull
request split into small ones.

- **Overview.** The agent's summary, the segments with their area, size, and
  comment count, and the range's commits. **Needs care** marks a segment that
  the agent flagged as risky. **Start reviewing** opens the first segment that
  you have not finished, and **All files** shows the version's whole diff.
- **A segment.** Its title, summary, and only its files, with the agent's
  comments on their lines. Comments on whole files, and on lines the diff does
  not show, follow the summary. Reply to a comment on lines with your own note
  from its **Reply** button.
- **Viewed.** Check **Viewed** in a file's header, or press `v` for the file at
  the top. A viewed file folds and stays viewed until it changes. `⇧V` marks
  the segment viewed and opens the next one. The rail at the left shows your
  progress; it hides in a narrow window.
- **Commits.** With two or more commits in the range, each one opens on its own,
  with its message. **Whole range** in the rail goes back to the whole range.
- **Move.** `j` and `k` step through the segments, or through the commits once
  one is open.

A range with several commits and no guide shows its commits in the Guide too.
Agents pass a guide with [`--guide`](AGENT_INTEGRATION.md#attach-a-guide).

### Proof, findings, and later versions

The Overview also shows what a version's notes and guide summary say about
it, in whatever format the agent or your own review skills wrote it
([review practices](PRACTICES.md#b-read-review-output-from-any-source)). A
Review opens on the Overview when its version has a guide, two or more
commits, proof, or findings. A later version opens there too, unless it has
only a brief: then it opens on the brief, and the Overview is the **Review**
tab. Each part shows only when the version has it.

- **Proof.** First, under the title: each check with its result, the media,
  and **Not covered**, what the checks miss. Without written proof, the checks
  that the session ran in the turn that made the latest version show, marked
  "from the session's last turn".
- **Since version N.** From version 2: the files that changed since the last
  version that you approved or commented on, or else the version before.
  Click a file to open it in the diff.
- **Findings.** Items tagged Important, Nit, or Pre-existing, with the ones
  closed as Fixed, Intentional, or Won't fix and their reasons. The start row
  counts the open ones. Click a finding to open its line.
- **Approve version N.** Beside **Start reviewing**. Med keeps the approval
  for the version and marks it in the version menu. It is your record, not a
  gate: nothing waits for it.
- **Practices.** Where one would help, the Overview offers a review practice:
  **Ask the agent to explain** when there is no explanation, which puts the
  request in the session's message box for you to send; the proof-first skill
  to copy when there is no proof; the round-limit skill from version 4. One
  shows at a time, and **Dismiss** hides it for good in this browser.
  `med skills suggest` lists all of them.

A thread's diff has a rail of its changed files as a tree. In **Review**, the
rail also lists the range's commits when it has two or more. A commit shows on
its own; **Whole range** goes back. In **Changes**, the rail lists the
branch's commits, or the Review's range, and **All changes** goes back. The rail shows by itself when the review
pane has room; the toolbar's first button, or **Show files and commits** in
`⌘K`, shows or hides it in any width, and Med keeps that choice. With the
**Changed files** pane open, as for a pull request, the pane lists the files
and the commits instead. Med reads the commits ahead while the review is idle,
so each one shows at once, in **Review** and in **Changes**.

Drag the right edge of the rail, the Guide's list, or the Commit tab's list to
make it wider, or focus the edge and press `←` or `→`. Double-click the edge
for the first width. Med keeps the width of each kind of list. Hover a cut file
name or title to see all of it; full chrome's status bar also shows the path of
the file under the pointer.

## Notes and briefs

A review's **Notes** hold the agent's brief and the replies that you pin from
its session. A brief explains the change in Markdown, and its links open the
lines that it cites. The **Notes** tab comes after **Review** and before
**Changes**; a Review with a brief opens on it unless the
[Overview](#proof-findings-and-later-versions) has a guide, commits, proof, or
findings to show.

- **Attach a brief.** Copy the agent's last message and press `⌘V` outside a
  text field. On live changes, Med first asks for a title and saves the review,
  so the links keep pointing at the code that they describe. Agents can pass
  [`--brief`](AGENT_INTEGRATION.md#attach-a-brief) instead.
- **Pin a reply.** In the Session pane, the reply that ends each turn has **Pin
  to review**. Med copies it into the latest version's notes, because a
  transcript can lose old replies.
- **Read.** With more than one note, each has a head such as `02 / 03`, and a
  rail at the right marks notes, headings, and excerpts. Below each paragraph
  that cites lines, a short diff excerpt shows them. `]` and `[` step through
  the excerpts. **Not in the notes** lists the changed files that the notes do
  not cite; read those yourself.
- **Comment.** Click a link or an excerpt's heading to open its lines in
  **Review**. On an excerpt line, click **+**, or select line numbers and
  press `c`. To comment on the prose, select words and click **Comment** or
  press `c`; the comment keeps the quote, and a comment whose passage is gone
  shows at the end of its note.
- **Manage.** Paste again to replace the brief; **Undo** restores it. A note's
  **⋯** menu copies all notes, removes the brief or a pin, and has **Start new
  notes**, which captures the current comparisons as a new, empty version.
  **Delete these notes…** deletes the shown brief, its pins, and their
  comments, after it asks. Notes that you started also take their version,
  unless its comparisons have comments. In an open menu, a letter chooses the
  item that it underlines: in the **⋯** menu, `n` starts new notes and `d`
  deletes them.

A link can be `path`, `path:12`, `path:12-20`, `path#L12-L20`, an absolute
path, an editor link, or a GitHub blob URL. A unique suffix such as
`App.tsx:42` works. A link or a path in inline code to a file that the change
does not touch opens that file of the checkout as a tab, at its lines. Its
excerpt shows the cited lines from the checkout, marked **Not in the change**.
An absolute path inside the checkout shows as the path in the checkout.

## Pull requests

Paste a pull request link, such as `https://github.com/owner/repo/pull/333`, in
**New workspace…**. Choose **Open pull request #333**, or **Open and review
with** an installed agent. The workspace shows each step:

1. Find the registered repository whose remote is `owner/repo`. Add an unknown
   repository first.
2. Read the pull request with `gh`.
3. Make a worktree in Med's state folder (`worktrees/repo/pr-333`). Your
   checkout and its branch do not change.
4. Check out the pull request there with `gh pr checkout`. If its branch is in
   use in another worktree, Med checks out its commit without a branch.
5. Fetch the base branch if it is not local, and save the review.
6. Start the agent in the worktree with a review prompt, if you chose one.

The same link opens the same worktree and review; a new head adds a
version. A failed step says why and offers **Retry**. When you are done,
right-click the workspace and choose **Close and remove worktree**. Med runs
`git worktree remove` without `--force`, so it keeps a worktree with changes,
a working agent, or a commit on no branch. The branch stays.

In a terminal, `med pr checkout 333` runs `gh pr checkout 333`, fetches the
base branch, and opens a saved review from the merge base to the head. It
passes options such as `--force` and `--branch` to `gh`, and `--no-open` prints
the launch URL instead. It needs the GitHub CLI, signed in.

A saved review with a pull request shows its GitHub comments. Med reads them
with `gh`; it never posts, replies, or resolves.

- When the diff shows the pull request's head commit, each code thread shows on
  its line with the GitHub mark. This includes Changes when the branch tip is
  the pull request's head. A file with changes after that commit lists its
  threads instead.
- The comment count beside the title, such as "3 comments", opens the reviews,
  the general comments, and the threads that the diff cannot show, each with
  the reason.
- A thread whose agent opens a pull request later gets the link by itself: while
  the thread's tab is open, Med asks `gh` for an open pull request from its
  branch.
- A comment shows its Markdown, as Med's own comments and the agent's Guide
  comments do: code, lists, task lists, quotes, and links, which open in the
  browser. Raw HTML stays out, and a suggestion shows as code under
  **Suggested change**.
- Hover a comment for **Copy** and **Open on GitHub**. **Copy comments** copies
  only Med's comments.
- Med reads again when the window gets focus, at most every 30 seconds, or when
  you click refresh. **Hide comments** hides GitHub's comments and Med's.

## Codex reviews

A saved review shows the findings of Codex reviews in its checkouts: run
`codex review --base main` in the worktree, or `/review` in a Codex session
there. Med reads `~/.codex/sessions`; it does not run Codex or change its
files. It lists reviews of a commit that the review shows, and reviews that ran
after the review was saved.

- On the commit that Codex reviewed, each finding shows at its last line with
  its priority, such as **P1**.
- The Codex count beside the title opens each verdict, the findings that the
  diff cannot show, and **Copy resume command**.
- A finding's reply button, or **Add all to** the agent for a whole review,
  puts the findings in the next message to the review's agent.

## Commit and push

Press `q` in a review of live changes, or click the **Commit** tab, to stage
files, commit them, and push the branch. Press `q` again to go back to the tab
that showed before.

- **Files.** The list shows each changed file: ● staged, ◐ partly staged, ○ not
  staged. Their diffs follow in the same order. `j` and `k` move through the
  files and scroll the diffs; `Enter` opens a file in a tab.
- **Filter.** `/` filters by path. `Enter` keeps the filter and `Esc` clears
  it.
- **Stage.** `Space`, or a click on the mark, stages or unstages a whole file.
  `a` stages every file shown, or unstages them all when all are staged.
- **Commit.** `c` or **Commit…** opens the message: a summary, and `Enter`
  goes on to the description. `⌘↵` commits the staged files. With nothing
  staged, the commit takes every file that the dialog counts, unless a file
  has a conflict. As with `git commit -a`, those files are staged only for
  the commit: if it does not complete, nothing stays staged. `Esc` keeps the
  message as a draft. Hooks run; if a hook stops the commit, its output shows
  under the message.
- **Push.** `⇧P` pushes to the upstream. For a branch without one, Med asks,
  then pushes to the push remote (usually `origin`) and tracks it. Med never
  force-pushes.

If the staged files change outside Med, or a stage fails, the commit stops
and the tab reads them again. A commit holds the files that its dialog
counted, with the changes that the tab showed, or nothing: when an agent
changes a file after the tab showed it, the commit stops and keeps the
message. For hunks, amends, rebases, and branch switches, use **Copy lazygit
command** on the workspace.

## Attempts

Two agents seldom do a task the same way. **Attempts** in New thread (`⌥N`)
gives one task to two or three agents. Each attempt has its Agent, Model, and
Effort rows under its letter, and its own branch (the task's name with `-a`,
`-b`, `-c`) in a new worktree. Start starts them all and opens the Attempts
page.

- The sidebar shows the task as one row, with its attempts under it, such as
  **A · Claude** and **B · Codex**. They fold when all are done; the chevron,
  `→`, and `←` show or hide them. Click the row to open the Attempts page.
- The **Attempts page** has a column for each attempt: its agent and model,
  its state and time, its branch, its changes, the checks that its session ran
  (test, type-check, lint, and build commands, with their pass and fail
  counts), and its last message. Below, the files that more attempts changed
  come first, side by side, each against the commit that the attempts started
  from. `←` and `→` move between the attempts' **Keep** buttons; `Esc` goes
  back.
- **Keep** makes that attempt the thread. Med stops the agents of the others,
  commits their work to their branches ("Attempt A of …, not kept"), removes
  their worktrees, and closes their tabs. Their branches stay. A worktree
  that another thread uses, or one with an agent that Med cannot stop, stays,
  and the notice says why. The notice offers **Undo**, which brings back the
  other attempts with their worktrees and uncommitted work. Undo lasts until
  the host restarts.

An agent can hand off one attempt with
`med review create --working --group <task> --attempt <1-3>`.

## Stacks and sets

A thread can hold several reviews of one intent ([design](STACKS.md)): a
**stack** of pull requests or branches, each on the one below, or a **set** of
independent ones. An agent makes one with
`med review create --stack 101 102 103 104` (bottom first) or `--set`; a
hand-off of one range whose base is the head of an open thread's top layer,
from the same session or with both pull requests, joins that thread as its
next layer.

- **Sidebar.** The thread is one row with a strip of segments, one for each
  layer, bottom first: outlined when unreviewed, half filled in progress, green
  when every file is viewed, orange when every file is viewed and you
  commented. The chevron under its mark shows the layers, top first, with
  their `+`/`−`; a click shows that layer.
- **Stack rail.** At the top of the Review's rail: the layers top to bottom,
  the base branch (such as `main`) under the bottom one, each with its number,
  title, pull request state, and `+`/`−`. A pull request that GitHub moved to
  another base says "on main". **This layer** shows the layer's own diff;
  **Whole stack** shows the base to the top layer's head; Shift-click a layer
  for the layers from the shown one to it. In a narrow pane the layers are a
  menu in the review's row.
- **Keys.** `⌥↑` and `⌥↓` go up and down the stack (in a sidebar row they move
  the tab). **Next unreviewed**, in the rail and in `⌘K`, shows the lowest
  layer that is not done and not merged or closed.
- The title band names the shown layer's pull request. All layers use the
  thread's one checkout, so a switch keeps the session and its files.
- Drag a row onto the middle of another row of its repository and hold until
  that row is outlined to stack it on top; a quick drop only moves the row.
  The row's menu has **Stack on**, **Ungroup** (each layer above the
  first is a thread again), and **Treat as a set** or **Treat as a stack**.

## Scheduled

Med shows what Claude Code scheduled and never runs a schedule
([details](SCHEDULES.md)). A `CronCreate` or `ScheduleWakeup` call is a card
in the thread: "Every hour at :23", its prompt, recurring or one-shot, when it
expires, and Cancelled, Expired, Fired, or Missed. A `CronDelete` changes its
job's card to Cancelled and is a row of its turn's work, so one schedule is
one card. A job of a session ends with it, which the card says. The sidebar's
**Scheduled** section lists only the jobs that will fire: the tabs' jobs whose
session's process runs, with their thread and prompt. A job whose session
ended, or that ended, stays in its thread's cards only, and with no job to
fire there is no section. The Claude app's scheduled tasks are not listed: Med
cannot read their schedules
([why](SCHEDULES.md#desktop-scheduled-tasks-left-out)).

## Edit working files

Working files and files outside Git open in Vim Normal mode; press `i` to
insert. Use `a`, `o`, `dd`, `ciw`, Visual selections, `p`, `.`, `u`, and
Ctrl+R as in Vim. Default yanks (`y`, `yiw`, `yy`) also copy to the clipboard;
named and black-hole registers keep their Vim behavior. Med's shortcuts come
before Vim's, except on macOS: Control+B, Control+F, and Control+O reach Vim,
because Command runs Med's shortcuts.

`:w`, `⌘S`, or **Save** writes the file; `:wq` saves, then closes if the save
succeeds. A hollow dot means saved and a filled dot means unsaved. Closing
unsaved text asks you to **Discard draft** or **Keep editing**. Saving does not
stage or commit; use the [Commit tab](#commit-and-push). Blame hides while a
draft is unsaved.

Drafts and their undo history stay in memory across tab switches and closes;
open the file again to resume. An unsaved draft also stays when you close its
workspace, or when Med unloads a workspace that you have not shown for a
while; it comes back when you open the file again. Closing a tab or a
workspace with unsaved drafts asks first. Unsaved drafts are also kept in the
browser's storage, by workspace and file, so they come back after a reload,
without their undo history. If the file changed meanwhile, the editor says so.
Med keeps up to 24 drafts in each workspace. Leaving the page warns only when
the browser could not keep a draft, as when its storage is full.

If another process changes the file, the editor says so. A saved draft offers
**Refresh contents**. An unsaved draft stays, and the editor shows what changed
on disk since the draft started, as a read-only diff, with two choices: **Keep
my version** saves the draft over the new file, and **Use the file on disk**
drops the draft. Med does not merge them. Med edits existing UTF-8 text files up to 1 MiB.
It cannot save symlinks, hard links, or paths through nested repositories. It
keeps uniform CRLF line endings and executable bits. Commit and saved-review
files are read-only.

To link to a working file in a registered repository, encode the worktree path
and the repository-relative path:

```text
http://127.0.0.1:6330/file?repo=%2Fpath%2Fto%2Frepo&path=src%2Fexample.ts&edit=1
```

The link opens live content; it does not save a review or register a
repository. The browser must have opened the launch URL first.

## Find files and code

**Find file** (`⌘⇧K`) searches the current repository. Type part of another
registered repository's name and press **Tab** to search that one; the scope
shows its full path, so clones and worktrees stay distinct. Backspace in an
empty field, **Clear filters**, or the scope button goes back.

A vault is a scope too: type its name and press **Tab** to find a note, such as
a plan that an agent works from. The note opens in this workspace's tabs, beside
the thread, rendered to read; its wiki links stay in the vault, and `⌘⇧V` edits
and saves it in place. With spaces, a query matches each of its words, so
`study plan` finds `study-plan.md`.

Combine **Code**, **Tests**, and **Docs**, or type filters such as
`type:tests ext:java,kt`. Values in one filter match any; the two filters must
both match. Test files follow each language's conventions, such as `.test.ts`,
`_test.go`, `test_*.py`, `*Test.java`, and `src/test/`. In Find file, `↵` opens
the file.

Every open makes a tab that stays until you close it: Find file, a click in
the Files pane, a link, a search result, and Go to definition. A file that is
open already shows its tab, at the line when the open names one. In the Files
pane, the arrow keys move without opening files, and `↵` opens the selected
one. `⌘`-click opens a file in the background. A middle click on a tab closes
it. A workspace holds 24 file tabs; when the row is full, a new file takes the
place of the oldest tab without an unsaved draft.

Right-click a file in a tree or tab for **Reveal in Finder**, **Copy path**,
and **Copy relative path**. The panel button beside **Esc**, or **Hide file
preview in Find file**, hides the preview in every picker and window.

### Search file contents

**Search file contents** (`⌘⇧F`) opens the workspace's **Search** tab, after
Commit in the tab row, or shows it when it is open. Selected text becomes the
query; else the tab keeps its query and selects it. The tab's label is the
query. While you type, the label changes when typing pauses, so the tabs after
it do not move with each key. Results show as you type, by file, with each
file's path and line numbers. Each match shows two lines above and below it;
matches whose lines meet share one excerpt. The lines have the file view's
syntax colors, and the query is marked in them. Med reads and highlights only
the files near the view, so a long list stays fast. **Aa** or `⌥C` matches
case: the search finds the text only as typed, so the first 200 lines are all
lines that match. The workspace keeps the choice, also after a reload. The
search does not take regular expressions. `↑` and `↓` move through the
matches, and `↵` or a click opens one at its line in a file tab; a click on a
line around a match opens the file at that line. The Search
tab stays, with its query, results, and scroll. `Esc` shows the tab that
showed before. Close the tab with its **×**, a middle click, or `⌥W`. Each
workspace has one Search tab, as in Zed, so `⌘⇧F` always goes to the same
place; a new query replaces the old one. A reload keeps the query.

The tab searches the workspace's checkout, such as a thread's worktree.
`repo:name` searches another registered repository, in its main checkout,
instead; add more to search several, or type `repo:*` for every one. A match
in another repository opens in that repository's workspace. An old search
link (`/search?q=…`) opens the Search tab with its query.

Search reads the working files of the checkout, as an editor does: tracked
files with their uncommitted changes, and untracked files that Git does not
ignore. A match opens the working file, which you can edit, at its line. Git
searches them; a checkout of 20,000 files takes about 0.4 s. A checkout with
more than 20,000 files searches its last commit in the Zoekt index instead,
when the index has that commit. Then its results leave out uncommitted
changes, open at that commit, and the tab says so. A review outside the
workspaces, such as a patch file, uses the content picker instead of the tab.

[Zoekt](https://github.com/sourcegraph/zoekt) makes search of commits and of
very large checkouts faster, and gives project symbols in checkouts of more
than 20,000 files. Setup builds pinned helpers once and needs Go
(`brew install go`) and a built Workbench checkout. In its `apps/med` folder:

```sh
node dist/cli.js --setup-search
```

After that, Med needs only the helpers in the cache: no container, service, or
Git hook. The `med` executable uses a cache that is already there. The first
content or project-symbol search starts a search service for the repository,
which indexes in the background. Med indexes up to 64 branch tips in each
repository, worktree branches first, and updates the index when commits change.
Until the index is ready, Git answers: in a checkout, from its working files.

Without the index, search says nothing about it while Git answers. Once in a
run, a Git search that takes a second or more adds a quiet line that the index
would make it faster. **Symbols in the project** (`⌘⇧O`) at a commit, or in a
checkout of more than 20,000 files, needs the index; without it, the picker
says so, and **Symbols in this file** (`⌘O`) still works.

The cache is `~/.cache/med/search`, or `$XDG_CACHE_HOME/med/search`. Set
`MED_SEARCH_CACHE` to move it, or `MED_ZOEKT_BIN` to a folder that has
`zoekt-git-index` and `med-zoekt`.

## Symbols and Vim navigation

![In-file symbol palette with a live jump in the current file](validation/symbol-navigation.png)

**Symbols in this file** (`⌘O`) starts at the symbol nearest the cursor and
ranks ties by distance. Arrow keys jump in the file; Enter keeps the position,
and Escape restores it. **Symbols in the project** (`⌘⇧O`) searches the
checkout's working files, with their uncommitted changes, and has its own
preview. Both keep the last query, and both work in any view of a checkout.
With no file open, `⌘O` says so and offers the project.

Symbols come from Universal Ctags (`brew install universal-ctags`). Project
symbols need no index: Med parses the files that Git tracks or does not
ignore, up to 1 MiB each and without JSON or XML data, when the picker opens,
and then only the files that changed. A commit, and a checkout of more than
20,000 files, use [Zoekt](#search-file-contents). Languages follow the
installed Ctags parsers; Ctags 6.2.1, for example, has no Zig parser, but text
search still works for Zig.

Vim navigation is on by default; the command palette turns it off for this
browser address. Files take focus when they open, in Normal mode:

- `h j k l`, `w b e`, `0 ^ $`, and counts such as `10j`.
- `gg`, `G`, `42G`, `:42` then Enter, `{` and `}`, and `Ctrl+D` and `Ctrl+U`.
- `f`, `F`, `t`, and `T` with `;` and `,`; `Shift+A` for the end of the line.
- `zz`, `zt`, and `zb` put the line at the middle, top, or bottom.
- `v` selects characters and `V` whole lines. Extend with motions; `o` goes to
  the other end, `y` copies, and Escape cancels. A selection can include lines
  outside the view.
- Text objects: `iw` and `aw`, `iW` and `aW`, `ip` and `ap`, quotes (`i"`,
  `a'`, backtick), and brackets (`i(`, `a[`, `i{`, `ib`, `aB`). Counts such as
  `v2i(` and repeated objects expand outward. Brackets are text pairs, not
  syntax.
- `/` and `?` search live, `n` and `N` step, and `*` and `#` search for the word
  at the cursor. An uppercase letter makes a search case-sensitive. Enter
  accepts; Escape cancels or clears highlights.
- `gd` finds declarations of the word at the cursor, first in the file, then
  in the project index. Several candidates open a picker. Ctags does not
  resolve types or imports as a language server does.
- `''` returns to the line of the previous jump, and two backticks to its exact
  column; repeat to swap. `ma`–`mz` set marks, and `'a` or backtick-`a` go to
  them. Marks and jumps reset when the file reloads.

While a Vim pane has focus, `?` searches backward and `⌘K` still opens the
command palette.

Command-click a diff's filename, or a file in the Changes list, to open it in a
background tab. When you close the file on screen, the tab that showed before
it shows again: a file, Changes, Review, Notes, Commit, or Search, as in VS
Code and Zed. **Close all files** (`⌥⇧W`) does the same and keeps Search.
**Close other files** (`⌥⇧O`) keeps the file on screen. Right-click a file tab
for **Close**, **Close other files**, and **Close all files**.

## Read and edit Markdown

A `.md`, `.markdown`, `.mdown`, or `.mkd` file opens rendered, to read. To edit
it, select **Edit source** (the pencil) or press `⌘⇧V`: the source opens in the
Vim editor in the same place, at the first line that was in view. **Read** or
`⌘⇧V` renders it again, at the source's cursor. A file with unsaved changes
opens as source, and Med keeps each file's view until you reload. The rendered
view shows unsaved edits; it does not save them.

At 760 pixels wide or more, the rendered view has **On this page**; select a
heading to go to it.

- GFM tables, task lists, strikethrough, autolinks, and footnotes; LaTeX with
  KaTeX; Mermaid diagrams; colored code; and images. A single newline stays in
  the paragraph, and a blank line starts a new one. Raw HTML is left out.
- Relative images resolve in the same repository or commit. A standalone
  file's images must be in its folder or below it. PNG, JPEG, GIF, WebP, AVIF,
  and SVG load up to 8 MiB each. Remote images load directly, with no referrer.
- A relative link opens its file in a tab, from the Markdown file's folder, in
  the same worktree, commit, file workspace, or vault. `#L42` selects a line.
  Heading, web, and mail links work as usual. A dropped file has no folder, so
  its relative links do not work.
- The preview takes up to 512 KiB of Markdown. A diagram takes up to 20,000
  characters and 500 edges. An invalid diagram keeps its source with a notice,
  and invalid math stays visible.

Try [the reading queue design note](examples/reading-queue.md).

## Standalone files and dropped previews

To open a file that is not in a registered repository, choose **Open
standalone file** in the command palette, or visit `/files`. Then use **Open
file…** (`⌘O`) and enter an absolute path; the file does not need to be in a
Git repository. Vim, the saved dot, and conflict-checked saves work as for
working files.

An agent can link to a file through the running server:

```sh
med open ~/code/my-app/src/Example.java --line 42 --column 8
```

`--edit` starts in the editor, and `--port` and `--state-dir` work as for other
commands. The command prints a link without a token, such as
`http://127.0.0.1:6330/file/absolute/path/Example.java?line=42&column=8`. The
link reads the current file, not a snapshot. It grants access to that file
only, not its folder; the server keeps at most 256 grants until it restarts.

Drop text, image, or video files anywhere in Med for read-only previews. They
stay in the browser. Drop up to 12 files at once; a workspace holds at most 24
tabs. Text is limited to 8 MiB for each file, 24 MiB for each drop, and 32 MiB
in total. Drafts and dropped previews do not survive a reload.

## Images and videos

Image diffs show **Before** and **After** in compact cards that load near the
visible area. Click a card's header to fold it, or its filename to open the
viewer. The viewer fits images to the pane; **1:1** shows actual size. The
browser decodes the images: SVG, PNG, JPEG, WebP, AVIF, GIF, APNG, BMP, and
ICO, and TIFF, HEIC/HEIF, and JPEG XL where the browser supports them.

Videos use the browser's controls. MP4/M4V, WebM, MOV, OGV, and MKV play when
the browser has the codec; Med does not transcode. Images are limited to 32
MiB and videos to 4 GiB. Saved reviews keep image bytes within each target's 24
MiB capture budget, and do not capture videos.

## Full-file change markers

A whole file opened from a diff marks added lines with green gutter bars and
deleted lines with red bars. A deletion with no remaining row shows as a red
tick at its gap. Blue bars mark working-file additions and replacements. Hover
a marker for its comparison.

Markers use the selected comparison only when its captured text matches the
file on screen; otherwise they compare live content with HEAD. **Open before**
and **Open after** show the exact commit versions. A stale view drops its
markers until you refresh.

## Layout

### Panes

A workspace is a set of tiled panes: the review, and **Changes** (the changed
files), **Session** (`⌘⇧B`), and **Files** (the folder button) beside it. Each
thread keeps its own layout.

- A pane's header acts as a window's title bar. Drag it onto a side of another
  pane to place the pane there, or onto the middle to swap the two; Escape
  leaves it where it was. Double-click it to zoom the pane.
- `⌘⌥←→↑↓` moves the focus to the next pane; with `⇧`, the focused pane moves
  past its neighbor.
- Drag a gap between panes to resize them, or focus the gap and press the
  arrow keys. Double-click a gap, or press `⌘⌃=`, to give the panes equal room.
- `⌘E` zooms the focused pane to the whole workspace. Press it again, or click
  **Restore** in the pane's header, to show the others.
- A pane does not get narrower than 220 pixels or lower than 120. When the
  window is too small for all of them, Med hides panes until the rest fit, and
  shows them again when there is room.
- A review narrower than 760 pixels shows unified diffs.

### Zen mode

`⌥Z`, the focus button at the top right, or **Enter zen mode** hides every
bar: the tabs, the Changes toolbar, and the status bar. It also hides the saved
review's header, the session's controls, and the reply and background bars.
The panes stay, and the session keeps its thread and message box; a folded
turn still opens.

In zen mode, the command palette has the review's actions: **Send comments
to** the agent, **Copy comments**, **Show Review**, and **Show Changes**. `⌘B` and `⌘⇧B`
still show or hide the sidebar and the session. Press `⌥Z` again or click
**Leave zen** to leave. Escape does not leave zen mode, so it stays free for
search, Vim, and dialogs.

### Quiet chrome

Quiet chrome is on by default. Each pane has one row, and each thing shows
once: the sidebar names the thread (the title band does while the sidebar is
hidden), the title band names its branch, the review's row names what the diff
compares, and the session's row names the agent and its state.

- The review's row has its tabs (**Review**, **Changes**, **Commit**), the
  comparison or, in Review, the version, and **⋯**. In Changes, the
  comparison menu also has **Base branch…** (for a branch without a
  worktree, **Compare against a branch…**) and **Compare two revisions…**, in
  a thread **Thread checkout…**, and in a shared checkout **Only this
  session's files**.
- **⋯** has the comments, **Find in diffs**, the panes, **Zen mode**, **Push…**,
  and **Refresh review**. Its **View** menu has the diff's layout, comments,
  wrapping, the files and commits rail, and **Collapse all files**.
- There is no Changes toolbar and no status bar. While the page reconnects to
  the server, a notice shows at the lower right of the workspace.
- Every action stays in `⌘K` and keeps its shortcut. **Use full chrome** in
  `⌘K` brings back the toolbar, the status bar, and the review's header; **Use
  quiet chrome** goes back. Med keeps the choice for every window.

## Keyboard shortcuts

Press `?` for the shortcuts of where you are: Review, File, Editor, or Pickers.
Type to search every context by action or key, such as `close`, `zz`, or `⌘K`;
Enter runs a row that has a command. On Linux, use Ctrl for ⌘, Alt for ⌥, and Ctrl+Alt for ⌘⌃.

| Action                           | Shortcut      |
| -------------------------------- | ------------- |
| Command palette                  | `⌘K`          |
| Find a file                      | `⌘⇧K`         |
| Search file contents             | `⌘⇧F`         |
| Find in the diff                 | `⌘F`          |
| Symbols in this file             | `⌘O`          |
| Symbols in the project           | `⌘⇧O`         |
| Open a branch or worktree        | `⌘⇧G`         |
| Open tab 1–9                     | `⌘1`–`⌘9`     |
| Next tab that needs you          | `⌘0`          |
| Close tab / reopen closed tab    | `⌘⌥W` / `⌘⌥T` |
| Move the focused tab             | `⌥↑` / `⌥↓`   |
| Layer above / below in a stack   | `⌥↑` / `⌥↓`   |
| Switch, or search history        | `⌃Tab`        |
| Toggle the sidebar / session     | `⌘B` / `⌘⇧B`  |
| Next permission mode (message)   | `⇧Tab`        |
| New thread                       | `⌥N`          |
| Previous / next attempt          | `←` / `→`     |
| Focus the next pane              | `⌘⌥←`         |
| Move the focused pane            | `⌘⌥⇧←`        |
| Zoom the focused pane            | `⌘E`          |
| Balance the panes                | `⌘⌃=`         |
| Zen mode                         | `⌥Z`          |
| Comment on selected lines        | `c`           |
| Ask about selected lines         | `a`           |
| Paste a brief                    | `⌘V`          |
| Next / previous guide segment    | `j` / `k`     |
| Mark the top file viewed         | `v`           |
| Mark the segment viewed, go on   | `⇧V`          |
| Next / previous excerpt or reply | `]` / `[`     |
| Resume search                    | `⌥R`          |
| Show tab 1–8 / the last tab      | `⌥1`–`⌥9`     |
| Previous / next tab              | `⌘⇧[` / `⌘⇧]` |
| Toggle gutter blame              | `⌥B`          |
| Close the file or Search         | `⌥W`          |
| Close all files in the workspace | `⌥⇧W`         |
| Close other files                | `⌥⇧O`         |

Close actions keep the Changes tab and other workspaces. Tab numbers count the
Review, Notes, Changes, Commit, and Search tabs with the file tabs. A browser can take some
shortcuts first; the command palette has the same actions.

## Limits and evidence

- **Highlighting.** JavaScript and TypeScript (with JSX), CSS, HTML, JSON and
  JSONC, Markdown, YAML, TOML, Bash, Go, Python, Rust, Swift, SQL, Svelte,
  diff, INI, HTTP, dotenv, shell sessions, Java, Gradle, C++, and XML. Markdown
  code fences use the matching grammar. C, Zig, and other languages show as
  plain text. Colors can differ from Shiki: most grammars give token kinds or
  short scope stacks, so theme rules that match parent scopes can miss them.
  Go, Rust, and Swift give Shiki's full scope stacks.
- **Files.** Other binary files and unknown encodings show metadata only. Med
  does not render text above 8 MiB, 200,000 lines, or 250,000 characters on one
  line, and renders large text plainly. File lists stop at 50,000 entries. See
  [file browsing](FILE_BROWSING.md).
- **History.** History follows the selected worktree's HEAD. A shallow clone
  can lack the parent that a comparison or blame needs. Blame does not work for
  files that need Git's content conversion.
- **App.** Med is a browser app with a local server. Notes on branches last for
  the session; there is no shared, persistent review store.
- **Saved reviews.** Reviews are local to the computer that runs Med; a
  localhost link does not open the review on another computer. Med keeps a
  closed thread's Review versions and comments for 30 days, then a short
  record of it (title, repository, branch, sessions) for 180 days after the
  close.
  - A review starts with up to 16 targets and keeps up to 128 captures, including
    comparisons that got comments later.
  - Each target captures up to 500 changed files and 24 MiB of patch and source.
    A larger comparison is an error; narrow it.
  - Med stores up to 64 MiB for each review and 500 comments for each review.
    Over 512 MiB in total, Med first removes the captures of the threads that
    closed first, and keeps their short records; it refuses a new capture only
    when the tabs alone use more.
  - Copied comments are limited to 8 MiB. Med reports an error instead of cutting
    comments; narrow line ranges or remove comments first.
  - Binary and very large files keep their diff metadata but give no text
    context for comments.

Measurements: [Zoekt search](validation/ZOEKT.md) and
[its integration](validation/ZOEKT_INTEGRATION.md),
[highlighting](validation/HIGHLIGHTER_INTEGRATION.md),
[everyday interactions](validation/INTERACTIONS.md),
[symbol search](validation/SYMBOL_SEARCH.md), and
[Vim navigation](validation/VIM_NAVIGATION.md).
