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

| Update                          | Thread                                          |
| ------------------------------- | ----------------------------------------------- |
| `user_message_chunk`            | The user's message, at the right                |
| `agent_message_chunk`           | A Markdown reply; chunks with one ID join       |
| `agent_thought_chunk`           | "Thought for 4s", open for its text             |
| `tool_call`, `tool_call_update` | A row by kind: command, edit diff, read, search |
| `plan`                          | The Tasks dock; each update replaces the plan   |
| `session_info_update`           | The sidebar title                               |
| `usage_update`                  | Kept in the store; not shown yet                |
| `notice` (Med)                  | A warning or error line                         |
| `compaction_update` (Med)       | A "Context compacted" divider with the summary  |

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

## Host stream

`review create` records the sessions that worked on a review
([agent integration](AGENT_INTEGRATION.md#link-your-session)). The sidebar reads
`GET /api/reviews/:id/sessions/:session/events`, a server-sent event stream:

1. The host accepts only a session that the review records, and finds its
   transcript (`src/host/agent-transcripts.ts`). No transcript gives a 404.
2. It reads the last 8 MiB, from the first complete line. Transcripts of long
   sessions reach hundreds of megabytes. The thread loads earlier pages of
   4 MiB when you scroll to its top, and **Turns** jumps to any prompt
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
session streams are open. A reconnect starts with a new `reset`.

Streams of one transcript share one follower (`createTranscriptFeeds`). A new
stream gets the first view and the updates since from memory, so a click after
a read ahead, a revisit, or a reconnect reads and parses nothing again. A
follower stays 30 seconds after its last stream closes, and at most 6 stay
without a stream. One that has read 8 MiB more since its first view starts
anew for the next stream, so that a first view stays near 8 MiB of transcript.
The host finds lines in the bytes it reads and decodes them once.

In the app, this stream and the page's other event streams are channels of
one `GET /api/live` stream (`src/web/data/live.ts`, `src/host/live-streams.ts`).
A browser opens at most six connections to one host, and each open stream
keeps one: with a separate stream for each view, a review with a session left
no connection for its requests.

The browser shows **Working** until the agent ends its turn, or until the
transcript has not changed for 5 minutes, because a stopped process writes
nothing.

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
  the workspace on screen stays hidden. The 12 most recent sessions keep
  their threads (`keptSessionStore`), and Med reads a session's first view
  ahead while the pointer rests on its thread, and for the open workspaces
  that load in the background. The three newest threads in the sidebar that
  are not open yet, and the thread under the pointer, also load out of sight
  under their workspace's id. While the browser is idle, each shows out of
  sight once, until nothing in it is pending and its DOM is quiet for two
  frames, and hides again with its state. Its first visit then shows that
  slot at once, as a revisit does (about 25 ms from the click to the painted
  thread on an M1 Pro). A workspace out of sight runs its effects but takes
  no keys (`useWorkspaceShown`). The stream's own first view replaces the
  thread in one step. The
  view follows new items while the reader is at the bottom; only
  the reader's move up (wheel, touch, keys, or the pointer) stops it. A thread
  that gets shorter also moves the view up, and that move does not stop it.
  The Background and Tasks docks sit under the thread. The Background dock
  lists running tasks and the tasks that ended since the last prompt. The
  skill's `med review wait` is not a task: its row reads "Waiting for your
  message in Med" and does not spin. The dock stays closed as the reader left
  it; **Hide** keeps it hidden until a new task starts.
- A subagent is part of its parent's session, not a session of its own: the
  host reads its transcript into the call that started it. When a session has
  subagents, a row of tabs above the thread holds **Main** and one tab per
  subagent, with a spinner while it works. A tab, **Open** on a subagent's
  row, or its task in the Background dock shows its whole thread over the
  session's. **Main** or Escape returns to the session where the reader left
  it; the arrow keys, Home, and End move between the tabs.
- A message from the composer shows in the thread at once, with "Sending…".
  The host keeps the browser's ID for it, so a retry after a lost answer does
  not send it twice. A failed send keeps the text with Retry and Discard. When
  the agent takes the message, it replaces the agent's own copy in the
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
  lines (collapsing margins, list gaps, code blocks, tables). A hidden sample
  of each part in the thread gives the fonts and sizes of the current theme,
  so a theme change moves the estimates. Inline code and bold use Pretext's
  rich-inline layout. Estimates for 930 units of a synthetic thread take about
  25 ms with no prepared text, and 2 to 5 ms at a new width. Prompts, prose
  replies, rows, and tables are exact or within 1 px for 93 to 100% of units
  in four themes; the sum is within 0.4%. Open edits are the weak part: 66%
  are exact, because the estimate does not know Pierre's hunks and
  separators. Edits are closed until the reader opens one, so this error
  stays small.
- Items without an ID take one from their kind and time, so they keep it
  when an earlier page builds the thread again.
- Once the review is idle, the Session pane mounts hidden: the thread
  streams, and its newest units and their Markdown render before the pane
  opens. A hidden thread does not load earlier pages.
- `data/sse.ts` parses the event streams. It finds line ends with `indexOf`,
  because the first event of a long session holds megabytes.
- `SessionMarkdown.tsx` renders replies in the brief's Markdown worker, with a
  separate cache of 200 results. A streaming reply has one render in flight;
  partial text is not cached.
- `SessionPanel.tsx` is the sidebar: the stream, the status, and links. A link
  such as `src/summary.ts:5` opens the file in the review.

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

- **Streaming.** A transcript gets a line when a block is complete. Med shows
  replies as whole blocks; only the process that owns the agent sees token
  deltas (Claude Desktop runs Claude Code with `--include-partial-messages`).
- **Control.** A reader cannot prompt the agent, answer a permission request,
  or stop it.

To get both, Med can start the agent itself: Claude Code with
`stream-json`, or an ACP agent such as `opencode acp`
([owned sessions](AGENT_WORKSPACES.md#owned-sessions)). A Claude
session still feeds the thread from its transcript; Med adds the streaming
reply on top. Med logs an ACP session's updates and streams them from
`/sessions/:session/events` as for a transcript. The thread, the docks, and
the replay do not change.

## Limits and next steps

[Agent workspaces](AGENT_WORKSPACES.md) records the design and the remaining
work.

- The sidebar shows sessions recorded with saved reviews. Branch workspaces
  have no session.
- Subagent threads render whole, inside their call and in the subagent view;
  they are not virtual lists.
- Estimates of open edits miss Pierre's hunk separators. A wrong estimate
  costs only a move of the units below it when the edit renders.
- Not shown yet for attached sessions: context usage, permission requests
  (owned sessions show both), questions that the agent asked the user, and the
  dev servers that Claude Desktop starts from
  `.claude/launch.json` (the Background dock shows servers that the agent
  started in a shell).
