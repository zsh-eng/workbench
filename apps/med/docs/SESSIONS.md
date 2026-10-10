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
  `<task-notification>` messages to the same calls;
- reports subagents, whose transcripts are `<session>/subagents/agent-<id>.jsonl`;
- turns compactions, API errors, and interruptions into dividers and notices;
- skips attachments, system reminders, and meta messages;
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
   modification time, in parts of up to 1 MiB.
4. Every 400 ms it reads new complete lines from the transcript and from each
   subagent transcript it found, and sends `updates` events.

Updates keep a command but no other raw tool input or output. Text longer than
64 KiB, diffs over 512 KiB, and images over 512 KiB are cut or replaced. At
most 8 session streams are open. A reconnect starts with a new `reset`.

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
  opens the row, as in Claude Desktop. The thread opens at its end. The view
  follows new items while the reader is at the bottom; only the reader's move
  up (wheel, touch, keys, or the pointer) stops it. A thread that gets shorter
  also moves the view up, and that move does not stop it. The Background and
  Tasks docks sit under the thread.
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
- Nested subagent threads render whole inside their call.
- Estimates of open edits miss Pierre's hunk separators. A wrong estimate
  costs only a move of the units below it when the edit renders.
- Not shown yet for attached sessions: context usage, permission requests
  (owned sessions show both), questions that the agent asked the user, and the
  dev servers that Claude Desktop starts from
  `.claude/launch.json` (the Background dock shows servers that the agent
  started in a shell).
