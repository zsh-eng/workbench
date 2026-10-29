# Agent sessions

Med shows the agent session that made a saved review beside the review. The
Session sidebar shows the user's prompts, the agent's replies and thoughts, its
tool calls, its plan, and its background work. It follows the session while the
agent works.

## Overview

```text
 Claude Code / Codex            Med host                         Browser
┌──────────────────────┐   ┌────────────────────────┐   ┌──────────────────────────┐
│ transcript (.jsonl)  │──►│ reader: line → updates │──►│ store: updates → items   │
│ one line per block   │   │ tail, poll, subagents  │SSE│ thread, docks, Markdown  │
└──────────────────────┘   └────────────────────────┘   └──────────────────────────┘
                                      ▲
              or Med starts the agent (stream-json, or ACP over stdio)
```

Med has one data model for a session: the `session/update` notifications of
the [Agent Client Protocol](https://agentclientprotocol.com) (ACP). The
readers, the host stream, the store, and the thread know only this model. A new
source needs a new reader, not a new renderer.

## The model

`src/shared/agent-session.ts` defines the updates. ACP fields keep their names.

| Update                          | Thread                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `user_message_chunk`            | The user's message, at the right                                                             |
| `agent_message_chunk`           | A Markdown reply; chunks with one ID join                                                    |
| `agent_thought_chunk`           | "Thought for 4s", open for its text                                                          |
| `tool_call`, `tool_call_update` | A row by kind: command, edit diff, read, search                                              |
| `plan`                          | The Tasks dock; each update replaces the plan                                                |
| `session_info_update`           | The sidebar title                                                                            |
| `usage_update`                  | Kept in the store; the header reads the transcript ([spend and context](#spend-and-context)) |
| `notice` (Med)                  | A warning or error line                                                                      |
| `compaction_update` (Med)       | A "Context compacted" divider with the summary                                               |

ACP has no field for some things that a transcript records. Med adds them
under ACP's reserved `_meta` key, as `_meta.med`:

- `parentToolCallId`: the update belongs to the subagent that this call started.
- `background`: the call runs a background shell or agent; it reports later.
- `durationMs`: how long a thought took, when the transcript keeps no text.
- `tool`: the agent's own tool name, such as `Bash` or `apply_patch`.
- `queued`: a user message waited in the queue while the agent worked.
- `endsTurn`: the reply ended the agent's turn (Claude Code's `end_turn`).
- On a diff: `excerpt`, when the texts are part of the file and have no line numbers.

Each update also has a time (`SessionEvent.at`), for replays and elapsed times.

## Readers

A reader converts one transcript line at a time, so the same code loads a file
and follows a live one. It keeps the calls it has seen, because a result
arrives on a later line than its call.

**Claude Code** (`agent-session-claude.ts`) reads
`~/.claude/projects/<project>/<session>.jsonl`. Each line holds one finished
block: text, thought, tool call, or tool result. Thought text is often empty;
the line then keeps `thinkingDurationMs`. The reader:

- turns Edit and Write calls into diffs, with line numbers when it knows the
  file's text from Claude Code's `originalFile` or an earlier Write;
- turns TodoWrite and TaskCreate/TaskUpdate into the plan;
- links background shells and agents to their calls, and their
  `<task-notification>` messages to the same calls. A notification that comes
  during a turn is a `queued_command` attachment. When the call is on an
  earlier page, the update names the call (`<tool-use-id>`) or its task
  (`task:<id>`), and the thread gives it to the call when the page arrives;
- reports subagents, whose transcripts are `<session>/subagents/agent-<id>.jsonl`;
- turns compactions, API errors, and interruptions into dividers and notices;
- skips other attachments, system reminders, and meta messages;
- tracks the turn: a reply with `stop_reason: "end_turn"` or a subagent's
  report ends it, and a typed prompt starts the next one.

**Codex** (`agent-session-codex.ts`) reads
`~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`. It takes content from
`response_item` lines and only token counts and interruptions from `event_msg`
lines, because Codex writes most messages twice. Shell calls whose first
program is `rg`, `grep`, `ls`, or `find` are searches; `cat`, `sed`, and
`head` are reads, so they join an "Explored" group as in Codex. `apply_patch`
becomes one diff per file. `task_complete` ends the turn.

Codex Desktop runs its tools from short JavaScript programs (an `exec` call)
that call `tools.exec_command`, `tools.apply_patch`, and MCP tools. The reader
takes the commands and patches from the program's string literals. A program
with a patch is an edit row, and its commands show in the details. The output
is a list of parts: a status, then one JSON result per tool call, which the
reader turns back into text and exit codes. The tests use small rollouts
written to both formats.

**Edited files** (`session-edits.ts`) is a smaller reader for a thread's
Changes in a shared checkout (**Only this session's files**). It reads a
transcript from where it stopped, in 4 MiB pieces, and keeps only the paths:
Claude Code's Edit, Write, MultiEdit, and NotebookEdit calls, also in its
subagents' transcripts, and Codex's `apply_patch` (as a custom call, a
function call, a shell command, a `local_shell_call`, or a patch in an `exec`
program). A relative path is read against the session's folder. Edits that a
shell command makes, such as `sed -i` or a formatter, do not count.

## Host stream

`review create` records the sessions that worked on a review
([agent integration](AGENT_INTEGRATION.md#link-your-session)). The sidebar reads
`GET /api/reviews/:id/sessions/:session/events`, a server-sent event stream:

1. The host accepts only a session that the review records, and finds its
   transcript (`src/host/agent-transcripts.ts`). No transcript gives a 404.
2. It reads the newest 256 KiB, from the first complete line, and reads
   further back (at most 8 MiB) until the thread has about 150 lines to show:
   each prompt, up to 16 lines, and each turn's last reply. That is about three
   screens, so the first view is small and the thread does not load an earlier
   page at once. Transcripts of long sessions reach hundreds of megabytes; one
   of 294 MB opened with 186 kB of updates, not 1.9 MB. The thread loads
   earlier pages of 4 MiB when you scroll to its top, and **Turns** jumps to
   any prompt
   ([long sessions](AGENT_WORKSPACES.md#long-sessions-load-earlier-work)).
3. It sends a `reset` event with the updates, `idle`, and the file's
   modification time, in parts of up to 1 MiB. The `reset` gives the number
   of parts, and the browser applies them in one step, so the thread does not
   grow after each part.
4. Every 400 ms it reads new complete lines from the transcript and from each
   subagent transcript it found, and sends `updates` events.

Updates keep a command but no other raw tool input or output. Text longer than
64 KiB and diffs over 512 KiB are cut or replaced. Images from tools stay on
this computer, because the thread does not show them; tool screenshots were
most of a first view's bytes. A prompt's images go with the prompt. At most 8
session streams are open. A reconnect starts with a new `reset`. A `reset`
names its follower (`feed`). A thread that the browser keeps unchanged since
its last stream asks for `?feed=<id>&count=<n>`, and the `reset` then has only
the later updates (`resumed`): a click after a read ahead, or a revisit, does
not take and build the first view again. A pane waits for a read ahead of its
session that runs, then asks.

Streams of one transcript share one follower (`createTranscriptFeeds`). A new
stream gets the first view and the updates since from memory, so a click after
a read ahead, a revisit, or a reconnect reads and parses nothing again. A
follower stays 10 minutes after its last stream closes, and at most 16 stay
without a stream: one for each tab that stays loaded. Without a stream, a
follower does not read; the next stream wakes it, and it reads what is new at
once. The browser keeps the threads of 16 sessions, so a revisit asks for
`?feed&count` and gets only the updates since. One that has read 8 MiB more since its first view starts
anew for the next stream, so that a first view stays small.
The host finds lines in the bytes it reads and decodes them once.

In the app, this stream and the page's other event streams are channels of
one `GET /api/live` stream (`src/web/data/live.ts`, `src/host/live-streams.ts`).
A browser opens at most six connections to one host, and each open stream
keeps one: with a separate stream for each view, a review with a session left
no connection for its requests.

The browser shows **Working** until the agent ends its turn, or until the
transcript has not changed for 5 minutes, because a stopped process writes
nothing. For a session that Med runs, Med's runner tells instead. While the
runner waits, a transcript that changed after the runner's last state change
holds another process's turn, such as Claude Code's in a terminal on an
adopted session, and the transcript tells, in the thread and in the thread list.

## Found sessions

Med also finds the Claude Code and Codex sessions that no agent handed off
(`src/host/found-sessions.ts`). Med finds a session when its transcript
changed in the last 7 days (`FOUND_DAYS`, one window for both agents) and its
folder is in a registered repository or one of its worktrees. Its thread ID is
`found-<agent>-<session>`, and the session routes accept it. A server of
another state folder than `~/.local/state/med` starts with found sessions
hidden (`startHost({ foundSessions: false })`), so a second Med lists only its
own threads until the reader shows the others.

A found session opens as a tab once, when Med first sees its agent work
(`src/host/thread-service.ts`). The others, and the ones that the user
closed, are in history, where `⌃Tab` and `med thread list --history` find
them. A found tab keeps a short record (title, checkout, branch, sessions), so
it stays a tab after its session leaves the 7-day window.

- Claude Code: the project folders of the registered checkouts.
- Codex files a rollout under the day that its session started. Each scan
  reads the day folders of the window. Every 60 seconds, Med lists all day
  folders, so a session that started earlier and runs again shows within a
  minute. Codex's archived sessions do not show.
- A session that a saved review names shows only as that thread. Med runs
  Codex through ACP under its own session ID, and Codex writes a rollout with
  Codex's thread ID. Med keeps that ID with the session (`owned-sessions.json`),
  so the rollout does not show again as a found thread.
- A fork that answers a question about lines (**Ask**) never shows. Med keeps
  its ID in `question-forks.json`, and found sessions and session search leave
  it out ([questions](../ARCHITECTURE.md#saved-reviews-and-agent-sessions)).

**Keep in Med** saves a found session as a thread on its checkout
(`POST /api/sessions/adopt`). It captures nothing: the thread shows the
checkout's live Changes, and a Review once the agent shows one with `med
thread show`. A row counts the Changes (the branch's changes since the base,
or the working changes on the base) until the first hand-off
(`src/host/checkout-changes.ts`), and marks a checkout that is shared: the
main checkout, or one where another tab's session works too. Keep in Med
opens the thread as a tab. For older sessions, an agent runs `med thread find` and
`med thread adopt`
([agent integration](AGENT_INTEGRATION.md#find-and-adopt-sessions)). These
reach every session on the computer, of any age, also Codex's archived ones
(`src/host/session-search.ts`). A search reads the first 64 KB of each
transcript once per change, and for Claude Code also the last 64 KB, where a
title that the user sets later goes. On a scratch home with 1,770 synthetic
transcripts (the size of a real history), the first search took 86 ms and
later ones 15 ms.

## Messages to adopted sessions

A thread that Keep in Med, `med thread adopt`, or a hand-off made names a
Claude Code session that Med did not start. A message to it
(`POST /api/reviews/:id/agent/messages`) goes one of three ways:

- **No process runs the session.** Med resumes it as a session that Med runs
  (`OwnedSessions.resume`: `claude -p --resume <id>` with `stream-json`) and
  sends the message as its next prompt, after the messages that waited for
  the session, in order, in one prompt. Med keeps its record in
  `owned-sessions.json`, so it resumes after a restart too, and the thread
  shows the turn live. Before the send, the message box says "Med resumes
  Claude with this message".
- **Another process runs it**, such as Claude Code in a terminal or in the
  Claude app. Med cannot type there, and two writers would mix one
  transcript. The message box says so in one line, and a message then waits
  with a label. Both name where the session is open, by the process record's
  `entrypoint`:

  | `entrypoint`                          | Line                                                                    | Label                                                |
  | ------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
  | `cli` (a terminal)                    | "Claude has this session open in a terminal. Med can't type there."     | "Waiting for the terminal session to close"          |
  | `claude-desktop`, `claude-desktop-3p` | "Claude has this session open in the Claude app. Med can't type there." | "Waiting for the session in the Claude app to close" |
  | any other, none, or no record         | "Claude has this session open in another app. Med can't type there."    | "Waiting for the session to close there"             |

  While a message waits, the host checks the process every 3 seconds
  (`src/host/held-messages.ts`); nothing polls otherwise. When the process
  ends, Med resumes the session as above and sends the waiting messages once. Med keeps a held message's mark in its
  inbox file, so a restart checks it again.

- **The session takes messages with `med review wait`**, as after a hand-off.
  A wait that waits gets the message at once; a later wait takes the messages
  that waited, and Med does not send them again. If the process ends first,
  Med resumes the session and sends them.

**Continue in Med** (on that line, and in `⌘K`) forks the session:
`claude -p --resume <id> --fork-session --session-id <new ID>`, with an ID
that Med chooses (`POST /api/reviews/:id/owned` with `fork`). The fork is a
session of the thread that Med runs, after the original in the thread's
sessions, so the thread follows it. The waiting messages go to the fork as its
first prompt. The terminal or app keeps its session as it is. Unlike a question's
fork, this fork is not left out of the found sessions or session search.

**Detection** (`src/host/session-processes.ts`). Claude Code keeps a record
for each running process in `~/.claude/sessions/<pid>.json`. Med reads only
three fields: `sessionId`; `procStart`, which is the output of
`ps -o lstart= -p <pid>` with `LC_ALL=C` and `TZ=UTC` when the process
started, such as `Thu Oct 15 09:12:03 2026`; and `entrypoint`, the
process's `CLAUDE_CODE_ENTRYPOINT`. Claude Code 2.1 sets `cli` for `claude`
in a terminal, and the Claude app sets `claude-desktop`, or
`claude-desktop-3p` with another model provider. The other values that
Claude Code knows name an IDE (`claude-vscode`), the SDK (`sdk-cli`,
`sdk-ts`, `sdk-py`), Cowork (`local-agent`), an integration, or a remote
session; Med says "another app" for them. A record counts when its
`sessionId` matches, its process is alive (`kill(pid, 0)`), and `ps` gives
the same start time now, so a pid that the system gave to a newer process
does not count. Med's own agents and `--fork-session` processes (questions)
do not count. A process that names the session in its arguments, such as
`claude --resume <id>`, also counts, in another app. When Med cannot tell, as
for a record that it cannot read, the session counts as running in another
app: a held message
is safe, and Continue in Med is still there; two writers on one transcript
are not safe. Med does not use Claude Code's messaging socket: Claude treats
those messages as another session's, not as the user's.

## Browser

- `data/session-store.ts` turns updates into thread items. An update replaces
  only the items that it changes, so memoized rows do not render again.
  Subagent updates go into the thread of their call.
- `components/session/SessionThread.tsx` renders the thread. Reads and
  searches in a row form one "Explored" group. An edit is a row with its file
  and its added and removed lines; its Pierre diff renders when the reader
  opens the row, as in Claude Desktop. A finished turn's work (the units
  between its prompt and its final reply, except errors) folds into one
  "Worked for" unit (`fold` in `thread-model.ts`). The unit opens its turn in
  place; **Show work** in the Session pane opens every turn. The turn that
  runs does not fold. A turn can have more than one final reply
  (`finalReplies`): the last reply before the next prompt, the reply before
  the agent runs `med review wait`, and each reply that ended the agent's
  turn, because a background task's report starts more work without a
  prompt. A prompt longer than 16 lines shows its first 12 until **Show
  more**, and the height estimates fold it by the same rule. A prompt shows
  each run of quoted lines as a quote,
  as Claude does, and hides HTML comments such as reply markers
  (`prompt-blocks.ts`). Its images are 64 px square thumbnails; a click opens
  a viewer (`ImageThumbs.tsx`). A reply's web links are pills with their site's icon,
  as in Codex. Med fetches no icons: `site-icons.ts` holds the icons of common
  developer sites and matches a link by its host, or a self-hosted server by a
  word in its name, such as `github` or `sourcegraph`. Other sites show a
  globe. The thread opens at
  its end, in one step: it stays pending until its newest replies have their
  Markdown and their heights. Meanwhile a new workspace stays out of sight and
  the last one stays on screen (`WorkspaceViews`, at most 600 ms); a thread in
  the workspace on screen stays hidden. When the Session pane is open, the
  workspace shows when its thread is ready, and its diff fills in after: the
  review's diff and Git state wait for the painted thread (`lead`), so a large
  diff does not hold the thread on the main thread. The 12 most recent sessions keep
  their threads (`keptSessionStore`), and Med reads a session's first view
  ahead while the pointer rests on its thread, at the `⌘1`–`⌘9` key that
  opens it, and for the open workspaces that load in the background. Every
  thread in view in the sidebar that is not open yet, and the thread under
  the pointer, also loads out of sight under its workspace's id. While the
  browser is idle, each shows out of sight once, until nothing in it is
  pending and its DOM is quiet for two frames, and hides again with its
  state. Its first visit then shows that slot at once, as a revisit does
  (35 to 65 ms from the key to the painted thread on an M1 Pro, with real
  threads). The swap commits in the frame's `requestAnimationFrame`, so it
  paints in that frame. A workspace out of sight runs its effects but takes
  no keys (`useWorkspaceShown`). The stream's own first view replaces the
  thread in one step. The
  view follows new items while the reader is at the bottom; only
  the reader's move up (wheel, touch, keys, or the pointer) stops it. A thread
  that gets shorter also moves the view up, and that move does not stop it.
  The Background and Tasks docks sit under the thread. The Background dock
  lists only the tasks that run. A task that the dock saw run ends in its
  row: "Done" leaves after 3 seconds, and "Failed" stays until the reader
  opens it, hides the dock, or sends the next prompt (`med:background-seen`).
  With no row left, the dock is gone. A running task's time counts minutes
  (`Elapsed.tsx`); the turn's status line is the thread's one clock. The
  skill's `med review wait` is not a task: its row reads "Waiting for your
  message in Med" and does not spin. The dock stays closed as the reader left
  it; **Hide** keeps it hidden until a new task starts or a task fails.
- The turn recap (`TurnRecap.tsx`, `data/turn-recap.ts`) ends the thread of
  the latest session when its turn ended unseen. A turn is seen when it ends
  while the reader watches the session (the pane on screen, the workspace
  shown, the window visible), or when the reader presses **Review**, ×, or
  `Esc`. The browser keeps the end of the last seen turn by thread; turns from
  before its first visit count as seen. The facts come from the thread list:
  `changes`, and `turn.checks`, which `src/host/session-checks.ts` reads from
  the turn's tool calls (the last run of each check). A seen recap keeps its
  height out of sight until the next turn, so the thread does not move, and
  the Tasks dock stays hidden for that turn. Seen does not change the tab's
  unread mark or **Needs you**; a reply does.
- A subagent is part of its parent's session, not a session of its own: the
  host reads its transcript into the call that started it. When a session has
  subagents, a row of tabs above the thread holds **Main** and one tab per
  subagent, with a spinner while it works. A tab, **Open** on a subagent's
  row, or its task in the Background dock shows its whole thread over the
  session's. **Main** or Escape returns to the session where the reader left
  it; the arrow keys, Home, and End move between the tabs.
- A message from the composer shows in the thread at once, with "Sending…".
  The host keeps the browser's ID for it, so a retry after a lost answer does
  not send it twice, and two sends of one ID at the same time go once. While
  Med does not answer, as during a restart, the message stays "Sending…" and
  goes again for about 20 seconds; then it fails with "Med is not running". A
  failed send keeps the text with Retry and Discard. The browser keeps each
  session's unsent messages and its composer draft, with the paths of its @
  mentions, in `localStorage` (`data/outbox.ts`). After a reload, a message
  that was on its way goes again with its ID, and a failed one comes back with
  its reason. A message with more than 1 MB of images comes back without them,
  and says so. A message that waits says for what: "Waiting for Claude to take it", or, while
  a terminal or another app runs the session, for that session to close, such
  as "Waiting for the terminal session to close"
  ([messages to adopted sessions](#messages-to-adopted-sessions)).
  When the agent takes the message, it replaces the agent's own copy in the
  transcript, so the turn before keeps its reply and its "Worked for" row.
- The thread is a virtual list. Only the units within 1,200 px of the view
  render; spacers hold the height of the others. When less than 800 px stays
  rendered past an edge, the range moves in a task after the frame, so the
  frame does not wait for it. Only with less than 400 px does it move in the
  scroll event. A unit's height is its own from when it last rendered, or an
  estimate (`thread-heights.ts`). Browser scroll anchoring is off, because it
  would count the spacers. The list keeps the first unit that starts in view
  at its place when heights above it change or an earlier page arrives. A
  render that comes between the reader's scroll and its scroll event keeps the
  reader's place. Open rows keep their state when they leave the view and come
  back.
- `thread-heights.ts` estimates a unit from its text. Pretext measures the
  text with canvas and counts its lines; the file models the CSS around the
  lines (collapsing margins, list gaps, code blocks, tables, whose long words
  break where the renderer lets them, `markdown/breaks.ts`). A hidden sample
  of each part in the thread gives the fonts and sizes of the current theme,
  so a theme change moves the estimates. Inline code and bold use Pretext's
  rich-inline layout. Estimates for 930 units of a synthetic thread take about
  25 ms with no prepared text, and 2 to 5 ms at a new width. Prompts, prose
  replies, rows, and tables are exact or within 1 px for 93 to 100% of units
  in four themes; the sum is within 0.4%. Open edits are the weak part: 66%
  are exact, because the estimate does not know Pierre's hunks and
  separators. Edits are closed until the reader opens one, so this error
  stays small. A thread opens at its end, where nothing above the view
  needs an exact height: it renders the newest units that fill 1.25 window
  heights, with a quick estimate from the font size for every unit and the
  metrics of the last thread in the same theme. Once it has shown, idle
  time measures text, newest first, and the rendered range grows around
  the view. A prompt with more source lines than the fold renders only its
  first 17 lines until it opens, so its hidden text does not lay out. On a
  cold open of a long session this took Pretext from 17 ms to none.
- Replies render their Markdown in one worker, which takes several replies
  in one message and answers each, so the replies in view do not wait for
  the page between them (`brief-render.ts`). The theme goes to the worker
  once. A read ahead sends the newest replies when its first view arrives,
  before the thread renders. Two batches can be in flight: the page takes a
  batch's answers only when it is free, so replies read ahead while a
  workspace mounts do not wait for an earlier batch.
- Items without an ID take one from their kind and time, so they keep it
  when an earlier page builds the thread again.
- Once the review is idle, the Session pane mounts hidden: the thread
  streams, and its newest units and their Markdown render before the pane
  opens. A hidden thread does not load earlier pages.
- `data/sse.ts` parses the event streams. It finds line ends with `indexOf`,
  because the first event of a long session holds megabytes.
- `SessionMarkdown.tsx` renders replies in the brief's Markdown worker, with a
  separate cache of 200 results. A streaming reply has one render in flight;
  partial text is not cached. Replies, Question answers, guide summaries, and
  comments use this cache, and in them a single dollar is text, as in `$HOME`
  or `$3`; only `$$` starts math. Markdown files keep `$…$` math.
- `SessionPanel.tsx` is the sidebar: the stream, the status, and links. A link
  such as `src/summary.ts:5` opens the file in the review.
- `data/file-refs.ts` turns file references into links. `App.tsx` builds one
  index of the checkout's file list (the list that `⌘P` uses); a reference
  resolves against it, from the session's folder, by exact path or a unique
  suffix. Rendered replies get their links after the worker returns their
  HTML, once for each reply and index (`useFileRefBlocks` in `FileRefs.tsx`),
  so a long thread does no work again when it scrolls. Prompts and Question
  answers use the same index. Until the list loads, references stay as text;
  a link never waits for a request. The height estimates count a link as its
  name and lines (`refEstimate`). A link opens an ordinary file tab
  (`fileWorkspace.open` with `endLine`), so closing it shows the tab before
  it. The link marks its range
  (`.med-cited-line` in `FileEditor.tsx`, or the selected lines in a
  read-only view); the mark goes when you edit or leave the range.

## Replays and fixtures

The Elements page's **Agent session** section replays a real Claude Code
transcript (`components/elements/session-fixture.jsonl`). A transcript keeps
finished blocks, so `data/session-replay.ts` streams each reply in token-sized
chunks that end at the recorded time, at about 4 ms per character, and shows
each thought from its start. Waits over 4 seconds play shorter. A replay proves
the model and the renderer; it does not prove a transport.

`scripts/session-fixture.ts` makes a fixture from a transcript. It drops
attachments, system prompts, and signatures, moves the repository to
`/work/<name>`, and stops if the result still holds the user name, the home
directory, or an email address.

## Transcripts and ACP

ACP is not a file format. A client, such as an editor, starts the agent as a
child process and talks JSON-RPC over its stdin and stdout: `initialize`,
`session/new`, then `session/prompt`. The agent answers with `session/update`
notifications while it works, and asks `session/request_permission` before a
tool runs. Claude Code and Codex speak ACP through adapters
(`claude-agent-acp` and `codex-acp`).

Med reads the transcripts of agents that Claude Desktop, a terminal, or Codex
runs. For those, two things differ from a real ACP connection:

- **Streaming.** A transcript gets a line for each complete block. Claude
  Code 2.1 writes the lines of a response together, when the response ends:
  while a response streams, its thinking included, the thread shows
  **Working** and no new text. Med shows replies as whole blocks; only the
  process that owns the agent sees token deltas (Claude Desktop runs Claude
  Code with `--include-partial-messages`).
- **Control.** A reader cannot prompt the agent, answer a permission request,
  or stop it. Med can resume a Claude session that no process runs, and then
  owns it ([messages to adopted sessions](#messages-to-adopted-sessions)).

To get both, Med can start the agent itself: Claude Code with
`stream-json`, or an ACP agent such as `opencode acp`
([owned sessions](AGENT_WORKSPACES.md#owned-sessions)). A Claude
session still feeds the thread from its transcript; Med adds the streaming
reply on top. Med logs an ACP session's updates and streams them from
`/sessions/:session/events` as for a transcript. The thread, the docks, and
the replay do not change.

## Spend and context

The session's header has a chip with the context in use and the thread's
spend; a click shows where both come from. `GET /api/thread-usage` reads them
from the transcripts (`src/host/session-usage.ts`) and keeps its place in each
file, so the next call reads only the new lines.

- **Spend** adds up every request in the thread: each session's transcript and,
  for Claude Code, its subagents' (`<session>/subagents/agent-*.jsonl`).
  Claude Code writes each block of a response as its own line with the
  response's `usage`, so a response counts once by its message ID, as it does
  across a fork and its original. Each request is priced at list price from
  `src/shared/model-prices.json` (source URL and read date inside): input,
  output, 5-minute and 1-hour cache writes, cache reads, web searches, fast
  mode, US-only inference, and Haiku 5.5's long-context rate. A model that the
  table lacks shows its tokens and no price; Codex's rollouts have totals and
  no price. ACP agents' logs have no token counts and are listed as not
  available. The figure is an estimate: Claude Code also makes small requests
  that the transcript leaves out (titles, suggestions), so `/usage` reads a
  few percent higher.
- **Context** is the prompt of the session's last main request: its input,
  cache reads, and cache writes. The window is what Med's runner reports
  (`get_context_usage`), else the model's window in Claude Code (1M for the
  models with a native 1M window, else 200K). Where autocompact starts comes
  from the settings Claude Code reads, read only: `DISABLE_AUTO_COMPACT` and
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (from the environment of an agent that Med
  starts, or a settings file's `env`), `autoCompactEnabled`, and
  `autoCompactWindow`, where a window saved for the model under
  `modelSettings` wins over the top-level key in the same file. The local,
  project, and user files count in that order. With none, Claude Code's
  default shows as "about 967k" on a native 1M window, else the window's end.
  Med does not read managed settings, `--autocompact`, or a terminal's
  environment, so a session started with those can differ.

## Side panel

A session pane at least 900 pixels wide shows a side panel at its right, as
Claude Desktop does (`SessionSidePanel.tsx`): **Context** and **Spend**
([above](#spend-and-context); the Spend title opens each model's tokens),
**Background** (the dock moves here from under the thread, through a portal
from the thread, so a task still scrolls the thread to its call),
**Reviews** (the thread's Review, its Changes, and its pull request), and
**Environment** (the checkout, its branch, and the agent with its model and
what runs it). 900 pixels is the thread's 540 pixel column, 30 pixels at each
of its sides, and the panel's 300, so the column never narrows for the panel;
in a narrower pane, the panel and its button are gone and the header's chip
shows the context and spend. The header's button, `⌘⌥⇧B`, or **Hide the
session's side panel** in `⌘K` closes it, and
Med keeps that choice (`med:session-panel`).

## Limits and next steps

[Agent workspaces](AGENT_WORKSPACES.md) records the design and the remaining
work.

- The sidebar shows the tabs: sessions recorded with saved reviews, and the
  [found sessions](#found-sessions) that are open. Branch workspaces have no
  session.
- Subagent threads render whole, inside their call and in the subagent view;
  they are not virtual lists.
- Estimates of open edits miss Pierre's hunk separators. A wrong estimate
  costs only a move of the units below it when the edit renders.
- Not shown yet for attached sessions: permission requests (owned sessions
  show them), questions that the agent asked the user, and the
  dev servers that Claude Desktop starts from
  `.claude/launch.json` (the Background dock shows servers that the agent
  started in a shell).
