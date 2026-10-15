# Claude desktop, October 2026: what Med can use

Research of 2026-10-15. The frames named here are in the thread's videos. Subject: the Code tab of the Claude desktop app, after
the update that @ClaudeDevs announced on 2026-10-14. Purpose: find interaction
patterns and structure that Med can use. Brand looks are out of scope.

## Sources

| Source                                                  | What it gave                                                                                            | Link                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X thread by @ClaudeDevs, 2026-10-14 (6 posts, 5 videos) | The update. All text and all 5 videos (read through `api.fxtwitter.com`, including `/2/conversation/`). | [post 1](https://x.com/ClaudeDevs/status/2110445844675838148), [2](https://x.com/ClaudeDevs/status/2110445846219382954), [3](https://x.com/ClaudeDevs/status/2110445847922245974), [4](https://x.com/ClaudeDevs/status/2110445849516101743), [5](https://x.com/ClaudeDevs/status/2110445851466485786), [6](https://x.com/ClaudeDevs/status/2110445852905062457) |
| Desktop docs                                            | Panes, diff view, `/code-review` card, keyboard, sessions, side chat, notifications                     | [code.claude.com/docs/en/desktop](https://code.claude.com/docs/en/desktop)                                                                                                                                                                                                                                                                                      |
| Desktop quickstart (the thread's last link)             | Start flow, permission modes                                                                            | [desktop-quickstart](https://code.claude.com/docs/en/desktop-quickstart)                                                                                                                                                                                                                                                                                        |
| Agent view docs (the CLI's session list)                | The same states as the new sidebar, with more rules: pin, cold rows, resume picker                      | [agent-view](https://code.claude.com/docs/en/agent-view)                                                                                                                                                                                                                                                                                                        |
| Anthropic blog, 2026-04-14                              | The first redesign: sidebar, panes, side chat                                                           | [claude-code-desktop-redesign](https://claude.com/blog/claude-code-desktop-redesign)                                                                                                                                                                                                                                                                            |
| 32 replies to the thread                                | User reactions                                                                                          | (in the thread)                                                                                                                                                                                                                                                                                                                                                 |

**Not reached or not found:**

- `api.vxtwitter.com` returned 403. fxtwitter gave the same data.
- I found no third-party write-up of the 2026-10-14 update. Search finds only
  write-ups of the April redesign.
- The docs (read on 2026-10-15) do not yet describe the state groups in the
  sidebar, the environment dialog, the recap card, or the suggested-tasks
  card. For these, the only source is the videos.

## 1. What changed in Claude desktop

### 1.1 The announcement

- The update makes the Code tab better for many sessions side by side. It
  claims faster session start, easier splits of work, and a constant view of
  what each session does. ([post 1](https://x.com/ClaudeDevs/status/2110445844675838148))
- To get it: update the app and start a new session.
  ([post 6](https://x.com/ClaudeDevs/status/2110445852905062457))
- The docs compare the CLI and the desktop app. For "Multiple sessions", the
  desktop column says "Sidebar tabs". (docs, Feature comparison)

### 1.2 Sidebar

All from the videos (post 1 video, 0:06, post 5 video, 0:00, post 3 video, 0:16), except where a
link says otherwise.

- The sidebar has three groups, by state: **Needs input**, **Working**,
  **Completed**. Each header is plain text, with no count and no colour.
- A row is one line: the title, and at most one icon at the right.
  - Needs input: a warning triangle.
  - Working: no icon. The title is dim, with a light highlight that moves
    across it.
  - Completed: an icon for where it runs (laptop for local, cloud for cloud).
    An unread result has a bold title; a read one has a regular title.
  - No row shows a branch, an age, a change count, or a status word.
- A row moves to another group when its state changes. In the post 1 video,
  "Update onboarding emails" moves from Working to Needs input, and "Retry
  failed webhook delivery" moves from Working to the top of Completed.
- Child sessions show under their parent with a tree line, in the parent's
  group. Each child shows its own state by its type (dim while it works, bold
  when it has an unread result). (post 1 video, 0:06, post 3 video, 0:16)
- Completed ends with **Show more**.
- At the foot: the account, Search, and a bell with a blue dot.
- While the sidebar is hidden, its toggle in the title bar has a blue dot
  (post 4 video, 0:14, post 2 video, 0:19). The docs do not say what the dot means.
- The docs say: filter the list by status, project, or environment; group it
  by project; Ctrl+Tab and Ctrl+Shift+Tab step through it; archive from the
  row's hover icon; optional auto-archive when the session's PR merges or
  closes. ([docs: Work in parallel](https://code.claude.com/docs/en/desktop#work-in-parallel-with-sessions))
- The app sends an OS notification when a session ends a task and you do not
  look at that session. (same section)

### 1.3 New session and environments

([post 2](https://x.com/ClaudeDevs/status/2110445846219382954), post 1 video, 0:06, post 2 video, 0:19)

- The new-session screen shows recent folders in the centre, one click each,
  with a check on the current one, and **Choose environment**.
- The prompt reads "Describe a task or ask a question". Under it: the
  environment, the permission mode (Auto), the model, the effort, and a usage
  ring.
- The environment menu has a search field, Local, Cloud, Remote Control, and
  **New environment** (⌥⌘0).
- An environment is a saved setup. The dialog has tabs Local, Cloud, SSH, and
  Remote Control. A Local environment has a name, folders, and environment
  variables. Each folder has a menu: **Select branch**, **Use worktree**,
  **Remove**; a folder that uses a worktree shows "Worktree".
- Cloud adds repositories, network access with allowed domains, network
  secrets, and a setup script. SSH adds a host.

### 1.4 Parallel work

- **Nested sessions.** When you ask for parallel tasks, Claude starts a nested
  session for each. Each child reports its result back to the main session.
  ([post 3](https://x.com/ClaudeDevs/status/2110445847922245974))
  - In the video, a card "3 suggested tasks" has **Start all**. Each task has
    a title, a short description with a file path, ×, **Options**, **Do it
    here**, and **Start** (post 3 video, 0:01).
  - After Start all, the card header says "3 started". Each row shows the
    child's current action, such as "Reading CartLineItem.tsx".
  - The main transcript shows one line per child, "Received message from
    <child title>", each a link. Then the parent writes a short summary with
    links to the children (post 3 video, 0:16).
- **Follow-up suggestions.** While Claude works, it can suggest follow-up
  work. One click runs it as its own session. In the video, a "New session"
  card shows mid-turn with Options, Do it here, and Start. After Start, it
  becomes an inline chip with the child's live action.
  ([post 4](https://x.com/ClaudeDevs/status/2110445849516101743))
- **Side chat.** `/btw` opens a side question in its own tab while the main
  session goes on (post 4). In the video, the side chat is a pane at the right,
  titled with the question, with its own prompt "Reply in this session…"
  (post 4 video, 0:14). The docs add: ⌘; also opens it; it reads the main thread
  up to that point; it adds nothing back; the app does not save it to disk.
  ([docs: side question](https://code.claude.com/docs/en/desktop#ask-a-side-question-without-derailing-the-session))
- The docs also describe a task chip for out-of-scope work: a click starts it
  in a new session with its own worktree. Messages between sessions show as a
  card with the sender's title and a link back.
  ([docs: Work across sessions](https://code.claude.com/docs/en/desktop#work-across-sessions))

### 1.5 Inside a session

([post 5](https://x.com/ClaudeDevs/status/2110445851466485786), post 5 video, 0:00, post 5 video, 0:16, post 5 video, 0:21)

- A live to-do list follows Claude's plan: a filled check for done (dim text),
  a turning ring for the current step, a dashed circle for steps to come.
- Under it, one activity line: three dots, then what Claude does and the
  seconds so far, for example "Editing ProductCard.tsx 18s ▸". The ▸ opens
  the detail.
- While Claude works, the prompt reads "↵ to send, ⌘↵ to queue for later". It
  has a stop button. When idle, it reads "Type / for commands".
- When Claude needs you, a **recap card** sums up the turn and asks one
  question. In the video: a muted summary ("…All 14 tests pass…"), the
  question "Should I open a PR for this?", and two buttons: **Yes, open PR**
  with a ⌘↵ hint, and **Not now**. × closes the card. The card takes the place
  of the to-do list.
- Under each reply: copy, branch, pin, read aloud, thumbs up and down, and the
  time.
- The **side rail** opens from the first icon in the session's title bar. It
  has four boxes: Environment (the folders with their paths, and a Remote
  Control switch), Context (12 % and a bar), Connectors ("4 connected"), and
  Outputs (the files that the turn made).
- The session title bar: the title with a menu caret at the left; icons for
  the side rail, terminal, changes, browser, and files, and ⋯ at the right.

### 1.6 Panes, diff, and review (docs)

([docs](https://code.claude.com/docs/en/desktop#review-changes-with-diff-view))

- Panes: chat, diff, browser, terminal, file, plan, tasks, and subagent. Drag a
  pane by its header. A pane can pop out into its own window.
- ⌘-click a session in the sidebar to open it in a second pane beside the
  current one.
- Diff view: a "+12 −1" indicator in the chat opens it. Files at the left,
  changes at the right. Click a line to comment; Enter adds the comment; ⌘↵
  sends all comments. Claude revises, and the result is a new diff.
- `/code-review` puts its findings in a **Code review** card, by file. **Walk
  through in diff** steps through the findings at their lines, each with
  **Fix this one** or dismiss. **Apply fixes** fixes the open ones.
- View modes Normal, Thinking, Verbose; Ctrl+O steps through them.
- PR status bar with optional auto-fix of CI and auto-merge.

### 1.7 Keyboard (docs)

([docs: Keyboard shortcuts](https://code.claude.com/docs/en/desktop#keyboard-shortcuts))

| Key                           | Action                                             |
| ----------------------------- | -------------------------------------------------- |
| ⌘/                            | Show all shortcuts                                 |
| ⌘N, ⌘W                        | New session, close session                         |
| Ctrl+Tab, Ctrl+⇧Tab, ⌘⇧], ⌘⇧[ | Next or previous session                           |
| Esc                           | Stop Claude                                        |
| Tab or →                      | Accept the suggested prompt in an empty prompt box |
| ⌘⇧D, ⌘⇧B, Ctrl+\`             | Diff pane, browser pane, terminal                  |
| ⌘\\                           | Close the focused pane                             |
| ⌘;                            | Side chat                                          |
| Ctrl+O                        | Next view mode                                     |
| ⌘⇧M, ⌘⇧I, ⌘⇧E                 | Permission mode, model, and effort menus           |
| 1–9                           | Choose an item in an open menu                     |

### 1.8 The CLI's agent view: the same states, with more rules

([agent-view](https://code.claude.com/docs/en/agent-view)). This is the
terminal, not the desktop app, but it shows the rules behind the same groups.

- Groups, top to bottom: Pinned, Ready for review, Needs input, Working,
  Completed. Ready for review means an open PR that needs review or has failed
  checks.
- Ctrl+T pins a session to the top **and keeps its process running while it
  is idle**. Shift+↑↓ reorders rows in a group.
- The icon's colour gives the state. The icon's shape gives the process: a
  small dot means the process has exited. A reply to such a row restarts it
  from its saved conversation.
- A small model writes each row's one-line summary at the end of each turn.
  While a session works, the row text updates from its own output.
- Completed rows that do not fit fold into "… N more". The live groups always
  stay in view.
- `/resume` opens a picker of past sessions of the repository, newest first,
  also deleted ones, but not the ones that already have a row. Enter brings
  one back into the list.

### 1.9 Reactions in the replies

- One user does not want rows to move by themselves: "I like knowing exactly
  where every session is in my list." (@atc6955)
- Others liked the old sidebar, miss the context window in view, or said the
  RAM use grows with parallel sessions. Some called the release "feature
  slop". Many were positive.

## 2. Ideas for Med, ranked

The rank uses three tests: value for "open tabs and cold history" and for
guided review; fit with the user's taste (typography, restraint, say each
thing once); cost.

**Med already has these. Do not build them again:** the plan as a docked task
list with a highlight on the current step (`PlanDock` in
`SessionThread.tsx`), the working time ("Working 4m 33s"), what the agent does
now on the sidebar row, subagent tabs and the Background dock, comments on
lines with **Send to** the agent, folded turns ("Worked for"), the context
meter, the ⌃Tab switcher, and found Claude Code and Codex sessions.

### 1. Open tabs that keep their place; state by type, not by place

- **Claude desktop:** groups rows by state. The group header names the state,
  so a row is only a title and at most one icon. Dim means working; bold means
  an unread result. Children nest under the parent. Rows move between groups.
  The CLI's agent view adds Pinned: a pinned session keeps its process warm.
- **Why it works:** one look answers "what needs me". Nothing on a row repeats
  the header. Weight and tone carry the state without colour. But the moving
  rows break spatial memory (see 1.9), and they make ⌘1–9 point at a
  different thread after each state change.
- **Med surface:** `ThreadSidebar.tsx` (`ThreadRow`, the groups),
  `data/threads.ts` (`groupThreads`, `isRecent`), `Workspaces.tsx` (`Warm`,
  `MOUNTED`, `WARM`, ⌘1–9), `InboxPage.tsx`.
- **Effort:** L for tabs, warmth, and history together; M for the sidebar
  only.
- **Adapt.** Take the state vocabulary, the one-mark row, and bold for unread,
  dim for working. Do not move rows: tabs keep the order that the user gives
  them, so ⌘1–9 always open the same tab. Put the state counts in one line at
  the top ("1 needs you · 2 working").

### 2. History as a picker, not a list

- **Claude desktop:** Completed folds into Show more; archive removes a row.
  In agent view, `/resume` lists past sessions, also deleted ones, and leaves
  out the ones in the list. A small dot marks a cold row (no process).
- **Why it works:** the list stays short. History costs nothing until you ask
  for it. There is one way back for every closed thing.
- **Med surface:** the ⌃Tab `WorkspaceSwitcher` and ⌘K; found sessions
  (`src/host/found-sessions.ts`); saved-review pruning
  (`src/host/saved-reviews.ts`).
- **Effort:** M.
- **Adopt.** One picker: the open tabs first, then on typing the history
  (closed Med threads and found Claude Code and Codex sessions, newest
  first). Enter opens the result as a tab.

### 3. A turn recap that opens the review

- **Claude desktop:** when Claude needs you, a recap card gives a muted
  summary of the turn, one question, and two buttons, the first with a key
  hint (post 5 video, 0:16). × closes it. It takes the place of the to-do list.
- **Why it works:** the decision and its context are in one place, and the
  next action has a key. You do not read the transcript to learn what
  happened.
- **Med surface:** the session thread (`SessionPanel.tsx`,
  `SessionThread.tsx`); `src/host/thread-turns.ts` (last paragraph, the
  question rule); the check extraction in `src/host/attempts.ts`; the Guide's
  **Start reviewing**.
- **Effort:** M.
- **Adapt.** Med's main action is **Review** (the Guide at the first segment
  not viewed, or Changes), not "open PR". Add facts from the transcript:
  files, +/−, and checks ("bun test 5 pass"). Flat, with a hairline; no
  filled card.

### 4. Ask about these lines, without steering the agent

- **Claude desktop:** `/btw` or ⌘; opens a side chat titled with the
  question. It reads the main context and adds nothing back. The app does not
  save it (post 4 video, 0:14).
- **Why it works:** a reviewer has questions that are not instructions. A
  question in the main thread changes the agent's context and can start
  work.
- **Med surface:** the selection toolbar of the diff and the Guide (where `c`
  comments today); the session harness for Claude (`owned-sessions.ts`); a
  short-lived pane in the pane tree.
- **Effort:** M to L. Claude Code first; Codex after a check of what ACP
  allows.
- **Adapt.** Tie the question to the selected lines. Show the answer in a
  side pane. Offer **Keep as comment** to save the answer as a review comment.

### 5. A comment that becomes its own thread

- **Claude desktop:** suggests out-of-scope follow-ups as cards with **Do it
  here** and **Start**. Start makes a child session in its own worktree that
  reports back (post 3 video, 0:01, post 3 video, 0:16).
- **Why it works:** the current task keeps its scope. A side task costs one
  click, and its result comes back to the place it came from.
- **Med surface:** a comment's menu in the review; `NewThread.tsx`;
  `POST /api/threads`; the new tab under its parent tab, as attempts nest.
- **Effort:** M.
- **Adapt.** The user starts it from a comment ("New thread from comment":
  the task is the comment and its file and lines). No agent-proposed cards,
  no Start all.

### 6. Close a tab when its work has landed

- **Claude desktop:** optional auto-archive when the session's PR merges or
  closes. Agent view colours the PR number by its state.
- **Why it works:** the list cleans itself when the work is done elsewhere,
  for example by an agent that merged the PR.
- **Med surface:** `src/host/checkout-work.ts` (commits ahead, uncommitted
  changes), the Inbox's Ready rule, the tabs store, saved-review pruning.
- **Effort:** S to M.
- **Adopt.** A read tab whose branch has no commits ahead of its base and no
  uncommitted changes (or whose PR merged) goes to history, with a notice and
  Undo. Never a tab on screen, a tab that needs you, or a working tab. This
  also gives the pruning rule a start point.

### 7. Quiet signals when you do not look

- **Claude desktop:** an OS notification when a session ends and you do not
  look at it; a dot on the bell and on the hidden sidebar's toggle.
- **Why it works:** you can work in one tab, full screen, and still learn when
  another tab needs you.
- **Med surface:** `WorkspaceBar.tsx` (the band's **Show sidebar** button);
  the Badging API (`navigator.setAppBadge`) for the installed app's Dock
  icon; presence in `data/inbox.ts`.
- **Effort:** S.
- **Adopt** the dot on Show sidebar and a Dock badge with the "needs you"
  count. **Adapt** OS notifications: opt-in, and only for "needs you".

### 8. Recent repositories one click away in New thread

- **Claude desktop:** the new-session screen lists recent folders in the
  centre. Saved environments keep folders, branches, and worktree choices.
- **Why it works:** most new work goes to the last few places.
- **Med surface:** `src/web/components/shell/NewThread.tsx`.
- **Effort:** S.
- **Adopt** the recent list. **Skip** saved multi-folder environments, cloud,
  SSH, and Remote Control: a Med thread is one local repository.

### 9. Tab verbs on the keyboard

- **Claude desktop:** ⌘N, ⌘W, Ctrl+Tab and ⌘⇧[ ] for sessions, 1–9 in an open
  menu, ⌘/ for all keys.
- **Why it works:** the verbs are a browser's. Nothing new to learn.
- **Med surface:** the key handlers in `App.tsx` and `Workspaces.tsx`;
  `data/shortcut-guide.ts`.
- **Effort:** S.
- **Adapt.** Keep Med's keys: ⌘W belongs to the browser, ⌘⇧[ ] to file tabs,
  and ⌘↵ sends in the composer. Add **Close tab** (`e` on a focused row, as
  in the Inbox, and ⌘K), **Reopen closed tab** (`z`, and ⌘K), and **Next tab
  that needs you** (⌘0, when the Inbox page goes). Add 1–9 in open menus.
  Before you choose a key, grep `tests/browser` and `scripts/validate-*.mjs`.

### 10. Send one comment now

- **Claude desktop:** the review card has **Fix this one** for each finding,
  and **Apply fixes** for all.
- **Why it works:** a reviewer can fix a clear item at once and keep the
  hard ones for the batch.
- **Med surface:** the comment's controls in the review; **Send to** in the
  review's row.
- **Effort:** S.
- **Adapt**, low priority: Med already has the batch loop and iterations.

### Skipped

| Claude desktop feature                                | Why Med skips it                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Rows that move between state groups                   | Breaks spatial memory and ⌘1–9. Med's tabs belong to the user.                                |
| Side rail (Environment, Context, Connectors, Outputs) | Repeats the band, the session's row, and the review. Quiet chrome says each thing once.       |
| Two sessions side by side (⌘-click)                   | Attempts compare covers the main case. Panes are per workspace. Revisit later.                |
| View modes (Ctrl+O)                                   | Med has Worked for and Show work.                                                             |
| Agent-proposed tasks with Start all                   | Makes many threads. The user wants a small set of warm tabs.                                  |
| Cloud, SSH, and Remote Control environments           | Med is local.                                                                                 |
| Message cards between sessions                        | Low value; `@thread` mentions already link threads.                                           |
| "↵ to send, ⌘↵ to queue"                              | Med's composer sends with ⌘↵ and Enter adds a line. Teach Med's own keys if a hint is needed. |

## 3. What not to copy, and why

- **The brand surfaces.** The pixel mascot, the orange working dots, the blue
  user bubble, the field of moving characters behind the new-session screen,
  and Anthropic's type. They are Claude's identity. The user rejects
  lookalikes, and Med has its own palette (Dawn and Night) and painted icon.
- **The moving highlight on working titles.** It is motion as decoration. The
  user asked for rare, functional motion. Med already has one turning mark;
  dim text is enough for the row.
- **Rows that jump between groups.** See idea 1 and the reply in 1.9.
- **A stack of filled cards.** The to-do list, the recap, the suggestions,
  and the rail are each a filled, rounded box. The user wants flat surfaces
  and hairlines; the Arctic "Strata" pass failed on cards, pills, and glows.
- **A chat-first layout.** In Claude desktop the transcript is the centre and
  the diff is an optional pane. Med is review-first: the diff is the content,
  and the session is beside it. A chat-first Med is one more agent chat, the
  "Cursor-like" result that the user rejected.
- **Ship buttons.** "Yes, open PR", CI auto-fix, and auto-merge. The user
  dropped Land: agents do the PR and landing work.
- **The reaction row under each reply** (copy, share, pin, read aloud,
  thumbs). Noise for a local tool.
- **Claude's words.** Keep "thread", "Needs you", and "Working". Do not rename
  Med's states to "session" and "Needs input"; the same words with a similar
  layout read as a copy.
- **Account, plan, and usage chrome** (the account footer, the usage ring, the
  Chat and Code switch). Not Med's scope.

## 4. The top 3 changes to build next

### Brief A: open tabs, cold history

**Goal.** The sidebar shows only the open tabs. They stay warm and keep their
place. Everything else is history: cold, one picker away.

**Behaviour.**

1. A thread is a **tab** or **history**. New threads, a thread that you open
   from history, and a new agent handoff (`med review create` for a new
   thread) open as tabs. Found sessions start in history.
2. The sidebar lists the tabs in the user's order: new tabs at the top; drag
   to reorder. A row does not move when its state changes. ⌘1–9 open tabs by
   this order.
3. A row keeps Med's two lines (title; activity or branch, and +/−). State by
   type: dim title while working; bold title for an unread result; the
   existing "Needs you" mark and label. One mark at most.
4. One line above the tabs gives the counts: "1 needs you · 2 working". A
   click, or ⌘0, opens the next tab that needs you. This line takes the place
   of the Inbox row. The Inbox's "Since you left" line moves above the tabs.
5. **Close tab**: × on hover, `e` on a focused row, or ⌘K. The workspace
   unmounts and its live streams stop. A notice offers Undo (`z`). **Reopen
   closed tab** is in ⌘K.
6. A tab whose agent works or needs you closes only after one confirm that
   also stops the agent. (Open question: or keep the agent running.)
7. **Auto-close**: a read tab, not on screen and not needing you, goes to
   history when its branch has no commits ahead of its base and no
   uncommitted changes, or its PR merged. A notice names it, with Undo.
8. **History**: ⌃Tab shows the open tabs, most recent first, as now. Typing
   also searches history: closed threads and found sessions, by title,
   branch, repository, and first prompt, newest first. Rows from history
   show a hollow mark. Enter opens one as a tab. ⌘K has "Open from history…".
9. **Warmth**: only tabs are warm. Replace the `isRecent` set in `Warm` with
   the tab set. Keep hover prefetch for tabs only. Cap warm tabs (start at 8;
   about 6 MB of heap each). The host stops polling the session state and Git
   work of history threads.
10. **Pruning (proposal for the user)**: when a thread is in history and has
    landed, or has been in history for 30 days, delete its captures,
    iterations, and comments. Keep a stub (title, repository, branch, session
    IDs, closed time) so history can still list it and resume its agent.

**Where.** `data/threads.ts`, a new `data/tabs.ts`, `ThreadSidebar.tsx`,
`Workspaces.tsx` (`Warm`, `MOUNTED`, `WARM`, ⌘1–9, the switcher),
`InboxPage.tsx` and `data/inbox.ts` (retire the page after the tabs ship),
`src/host/server.ts` (a tabs store in the state folder, shared by every
window; `open` and order on the thread list), `src/host/saved-reviews.ts`
(pruning), `src/host/checkout-work.ts` (landed), `data/shortcut-guide.ts`,
`docs/USAGE.md`, `ARCHITECTURE.md`.

**Checks.** Browser tests: open, close with Undo, reorder, ⌘1–9 after a state
change, reopen from ⌃Tab, auto-close, a found session opened from history.
Host tests: the tabs store, the landed rule, pruning with a stub. Screenshots
in Night and Dawn, browser and installed-app window modes, 1440 px and 900
px. Measure a tab switch and a history open with ⌘1–9 and the COMMIT mark.

**Out of scope.** State groups that move rows; a history list in the sidebar.

**Ask the user first.** Points 6 and 10; whether found sessions that work
right now open as tabs; one list for all repositories, or a repository label
only when tabs span two or more.

### Brief B: turn recap, then review

**Goal.** When a tab's turn ends, the session shows what happened, what the
agent asks, and one way into the review.

**Behaviour.**

1. At the end of a turn that you did not see, a recap block shows at the end
   of the session thread. It takes the place of `PlanDock` for that turn.
2. Content, top to bottom: the agent's last paragraph (muted); the question,
   if Med's question rule finds one (normal text); one line of facts in
   tabular figures: files, +/−, and the checks from the turn's tool calls
   ("bun test 5 pass · tsc pass"); then **Review** and **Reply**.
3. **Review** opens the Guide at the first segment that is not viewed. With no
   guide, it opens Changes at the first file. It marks the turn as seen.
4. **Reply** puts the focus in the composer.
5. × or Esc (with focus in the recap) hides it until the next turn.
6. Style: no fill and no shadow; a hairline above; the session's type sizes;
   **Review** is the only primary button.
7. Key for Review: choose one that does not clash. ⌘↵ sends in the composer.

**Where.** `SessionThread.tsx` and `SessionPanel.tsx`;
`src/host/thread-turns.ts` (add checks to the turn summary); move the check
extraction from `src/host/attempts.ts` to a shared host module;
`src/shared/threads.ts` (the `turn` shape); the Guide's entry point.

**Checks.** Browser test with a fake agent: a turn that ends with a question
shows the recap and the question; Review opens the Guide at the first segment
not viewed; Esc hides it; the next turn shows a new recap. Screenshots in both
themes at 1440 px and 900 px.

**Out of scope.** PR, land, and merge buttons.

### Brief C: ask about these lines

**Goal.** A reviewer asks the agent about selected code. The answer does not
go into the agent's thread.

**Behaviour.**

1. With lines selected in the diff or a Guide segment, the selection toolbar
   has **Ask** beside the comment action. ⌘K has "Ask about the selection".
   Choose a key after a check of the review's keys.
2. Ask opens a short-lived **Question** pane at the right of the review, with
   a box that names the file and lines.
3. On send, the host runs a fork of the thread's lead Claude session:
   `claude -p --resume <id> --fork-session --permission-mode plan
--output-format stream-json`, with the question and the excerpt as the
   user's message. Med adds no system prompt.
4. The answer streams into the pane. The main session gets nothing; its
   transcript does not change.
5. **Keep as comment** saves the question and answer as a review comment on
   the lines. **Close** discards it. Med does not keep the question after
   close.
6. The fork writes its own transcript. `found-sessions.ts` must not list it
   as a found thread.
7. Codex: phase 2. Check whether ACP or `codex exec` can fork. If not, run a
   read-only session with the excerpt only, and say so in the pane.

**Where.** The selection toolbar in the review and the Guide;
`src/host/owned-sessions.ts` (a one-shot fork run); a new route; the pane tree;
`src/host/found-sessions.ts` (exclude forks); `tests/fixtures/agents/` (a fake
`claude` that accepts `--fork-session`).

**Checks.** Host test: the fork runs with plan mode, the lead transcript is
unchanged, and the found list does not show the fork. Browser test: Ask,
stream, Keep as comment, Close. Screenshots in both themes.

**Ask the user first.** The model for questions (the thread's model, or a
cheaper one), and whether Codex threads get the excerpt-only fallback.
