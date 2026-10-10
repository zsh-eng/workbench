# Agent workspaces

Status: proposal, October 2026. [Agent sessions](SESSIONS.md) describes what
Med does today.

Today Med shows a saved review beside the agent session that made it. This
proposal makes Med the place where you follow your agents, review their work,
and reply to them, without leaving the review.

## Terms

| Term      | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| Workspace | A repository checkout (the main checkout or a worktree) and its changes         |
| Session   | One agent conversation: an agent, an ID, and a working directory                |
| Review    | A saved set of changes with comments and notes                                  |
| Note      | An agent reply that you saved in a review. Notes replace the brief              |
| Comment   | Your remark on a line. A GitHub comment is a comment that Med imported          |
| Lead      | The session that a workspace shows by default. Other sessions are in its picker |

## Two ways to connect to a session

Med can **attach** to a session that another app started, or **own** a
session that Med started.

| Feature            | Attach                                          | Own (built)                                                      |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------- |
| Who starts it      | Claude Desktop, a terminal, or Codex            | The Med host                                                     |
| Source of updates  | Transcript lines, read every 400 ms             | Claude: the transcript and `stream-json`. ACP: the agent's stdio |
| Replies            | Whole blocks                                    | Token by token                                                   |
| Send a message     | Claude: `med review wait`. Codex: `codex queue` | Claude: a `user` line on stdin. ACP: `session/prompt`            |
| Permission prompts | Not visible                                     | A card above the prompt box; you answer them in Med              |
| Stop the agent     | Not possible                                    | Claude: `interrupt`. ACP: `session/cancel`                       |
| Model and effort   | Shown as text                                   | Pickers in the prompt box                                        |
| Context usage      | Codex only                                      | A meter after each turn                                          |
| Slash commands     | Skills from the transcript                      | The agent's own commands, without built-ins                      |
| History on reload  | The transcript                                  | Claude: the transcript. ACP: Med's log of the updates            |

A transcript gets one line for each complete block: a thought, a reply, a tool
call, or a tool result. Claude Code does not write partial text to it. So an
attached session shows a long reply when the reply is complete. The Elements
replay shows replies token by token, but it only simulates this from the
recorded times.

Both ways feed the same store and the same server-sent events. The thread does
not know which way an update came.

**One writer per session.** Only one process can safely add turns to a
session. Med sends prompts only to sessions that it owns, or through a path
that the session's owner provides (`med review wait`, `codex queue`).

Real streaming needs a connection to the process that runs the agent. For a
session that Claude Desktop runs, only Claude Desktop gets the tokens.

### Owning a Claude session

Anthropic's [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
page sets the limits:

- An end user can sign in to the unmodified Claude Code binary with their own
  Claude subscription, also when another product runs that binary.
- A product must not offer Claude.ai login, route requests through other
  people's Free, Pro, or Max credentials, or collect or store Claude
  credentials or session tokens.
- Developers who build products with the Agent SDK should use API keys.
- A product that preinstalls or runs Claude Code must accept Anthropic's
  Commercial Terms and must not modify the binary, unless Anthropic agrees
  otherwise.

So Med starts the unmodified `claude` binary that the user signed in to, with
`--input-format stream-json --output-format stream-json
--include-partial-messages`. Med never sees a credential. Claude Code's
`stream-json` messages are close to its transcript lines, so the Claude
reader can convert them. This needs no ACP adapter, and so no Agent SDK and
no new dependency.

Decision: Med does not install, bundle, or modify an agent. It starts
binaries that the user installed and signed in to. The Commercial Terms
clause gives hosted sandboxes and agent infrastructure as examples, not a
local tool. Med does not use an Agent SDK adapter for Claude.

### Built: owned sessions

`src/host/owned-sessions.ts` starts the agents. Claude Code 2.1.295 was
probed and checked with `--model haiku`:

- Med starts `claude -p --input-format stream-json --output-format
stream-json --include-partial-messages --verbose --permission-prompt-tool
stdio --session-id <id>`, with `--model`, `--effort`, and
  `--permission-mode` when the user chose them.
- The first control request is `initialize`. Its reply gives the commands
  (with `builtin`), the models with their effort levels, and the permission
  mode. It also names the signed-in account; Med drops that field.
- With `--permission-prompt-tool stdio`, Claude Code sends `can_use_tool`
  before a tool runs. Med shows **Allow**, **Allow for this session** (when
  Claude Code suggests rules), and **Deny**.
- `interrupt`, `set_model`, and `set_permission_mode` change a running
  session. There is no `set_effort`: Med starts Claude Code again with
  `--resume` and the new effort, between turns.
- After each turn, `get_context_usage` gives `totalTokens` and `maxTokens`
  for the context meter.
- The thread still reads the transcript. Text deltas from `stream_event`
  show the reply while it streams, until the transcript has it.

ACP agents use `src/host/json-rpc.ts`: `initialize`, `session/new` in the
review's repository, `session/prompt`, `session/cancel`, and
`session/set_config_option` (or the older `session/set_model` and
`session/set_mode`). Med answers `session/request_permission` with the
option that the user chose. An ACP agent writes no transcript that Med can
read, so Med appends its updates to `sessions/<id>.jsonl` in the state
directory. OpenCode 1.3.17 sends each prompt back as a user update; Med
drops that copy. When OpenCode cannot use a model, it ends the turn with no
reply and no error. For example, its free models refuse requests from outside
its own app. Med then adds a notice to the thread. Med finds `claude`, `opencode acp`, `codex-acp`, and `gemini
--experimental-acp` on `PATH` and in their usual folders, and reads other ACP
agents from `agents.json` in the state directory:

```json
[{ "id": "my-agent", "name": "My agent", "command": "/path/to/agent", "args": ["acp"] }]
```

Routes: `GET /api/agents`, `POST /api/reviews/:id/owned` with `{ preset }`,
`GET /api/reviews/:id/owned/:session/events` (the state as server-sent
events), and `POST /api/reviews/:id/owned/:session` with an action: `prompt`,
`permission`, `interrupt`, `setting`, or `stop`. **Send to agent** goes to an
owned session as its next prompt.

## Workspaces and sessions

Links are many-to-many. One workspace can have many sessions, and one session
can work in many workspaces. A strict one-to-one model breaks in common cases:

- You start a new session after `/clear`, or after a compaction lost context.
- A Codex session reviews the changes that a Claude session made.
- One session works in the main checkout and in two worktrees.

The UI still shows one lead session for each workspace. The other sessions
are in the session picker.

Med finds the links itself, because it attaches to work that already exists:

1. The session ran `med review create`. The skill records the session ID.
2. The session's working directory is in the workspace.
3. The session edited files in the workspace. Tool calls give the paths.

The newest linked session that is still working becomes the lead. You can pin
a different lead.

## States

A list of workspaces shows the state of each lead session:

| State     | Attach: how Med knows                                | Own: how Med knows                         |
| --------- | ---------------------------------------------------- | ------------------------------------------ |
| Working   | The turn is open and the transcript changed recently | A prompt is in progress                    |
| Needs you | The session waits in `med review wait`               | A permission request or a question is open |
| Done      | The turn ended after you last looked                 | The prompt finished after you last looked  |
| Read      | You saw the last update                              | You saw the last update                    |

Med keeps the last update that you saw for each session in its state
directory. "Done" shows as an unread dot, as in Claude Desktop.

Built: `GET /api/agent-status/events?reviews=…` sends each listed review's
lead session state as server-sent events, every 1.5 seconds when it changes
(`src/host/agent-status.ts`). The host reads a transcript's last 256 KiB again
only when the file changes. The workspace list shows a turning mark for
Working, **Needs you**, and the existing unread dot for Done. Unlike the plan,
the browser keeps the last update that you saw (`med:agent-seen`), next to the
workspace list, which the browser also keeps. A review that you open for the
first time starts as read. You cannot pin a lead yet.

An attached Claude session cannot show a permission prompt or a question,
because the transcript does not record them while they wait. Claude Code's
`stream-json` output has a `post_turn_summary` message with `needs_action`
and `status_category`, but only the process that owns the session gets it.

## Sending a message to a session

### Why Med cannot send directly to an attached session

- The agent is a process that belongs to the app that started it. That app
  writes the agent's input.
- `claude --resume <id> -p "…"` starts a second process on the same
  transcript. The first process does not see the new turn, so the two
  histories split.
- [Channels](https://code.claude.com/docs/en/channels) push messages from an
  MCP server into a running Claude Code session. But the session must start
  with `--channels`, and during the research preview only approved plugins
  can register. Claude Desktop starts its sessions itself.
- [Remote Control](https://code.claude.com/docs/en/remote-control) drives a
  session only from claude.ai and the Claude apps.
- Claude Desktop gives each session a private messaging socket
  (`CLAUDE_CODE_MESSAGING_SOCKET`) that local sessions use to message each
  other. It is not documented. Med must not depend on it.

### `med review wait`

The agent itself opens the path. This works in every session that can run a
command:

1. After `med review create`, the skill tells the agent to run
   `med review wait <review>` as a background command.
2. The command waits on the Med host. It has no time limit, so the agent can
   end its turn while it waits. The workspace shows **Needs you**.
3. You click **Send to agent**. The command prints your message and exits.
4. Claude Code wakes the agent when a background command ends. The agent does
   the work and runs `med review wait` again.

The message reaches the model as the output of its own command, not as a
user turn. The skill must say that this output is the user's review. The
app that started the session still owns it, and you can still type there.

For an owned session, **Send to agent** is the session's next prompt.

### Codex

Codex 0.160 has a durable message queue:

- `codex queue --thread <id> --message <text>` adds a user message to
  `~/.codex/queue_1.sqlite`. It does not need a running agent.
- The next Codex process that runs the thread takes the queued messages
  first, as user turns. Then it runs its own prompt.
- `codex app-server proxy` connects a client to a shared local app-server
  daemon, and `codex agents` lists the sessions in it.

Tested on a scratch thread: `codex queue` stored the message, and a later
`codex exec resume` replied to it before its own prompt. The queue was then
empty. Not tested yet: whether Codex Desktop takes a queued message while it
has the thread open, and whether Desktop uses the shared daemon. Codex
Desktop was not running.

So Med can send to an attached Codex session with `codex queue`. The message
is a real user turn, not command output. `med review wait` is a poor fit for
Codex, because Codex does not wake the agent when a background command ends.

## Comments and replies

Comments work as a pending review on GitHub:

- A comment is a **draft** until you send it.
- **Send to agent** sends one message: your text, then each draft comment with
  its `path:line`, the quoted lines, and your remark.
- A sent comment links to that message. When the agent changes those lines,
  the comment shows **Maybe addressed**. You resolve it.

```text
3 review comments on "Format durations":

src/summary.ts:12
> return `${trail.bestTimeMs} ms`;
Use formatDuration here.
```

GitHub comments show in the same list with a GitHub badge. **Add to reply**
adds one comment to the draft message. **Add all open** adds every unresolved
one. A reply on GitHub is a separate action that you confirm, because it
publishes.

## Notes (was Brief)

The thread alone is not a good place for a review explanation:

- Replies scroll away between tool calls.
- Compaction and the 8 MiB tail can remove old replies.
- In a review, you read the explanation beside the diff.

So:

- The reply that ends each turn gets **Pin to review**. Med copies the text
  into the review, not a link, because the transcript can lose the reply.
- The brief and the pinned replies are the review's **Notes**. The brief is
  the first note. A pin goes to the latest iteration; each iteration has its
  own pins, and the brief carries over as before.
- To get an explanation, you send a normal prompt, such as "walk me through
  this change", and pin the reply.
- **Pinned** under a reply goes to its note. A note's **⋯** menu copies it or
  removes the pin. Pinning the same reply again keeps one pin.

Built: `POST /api/reviews/:id/pins` with `{ add: { text, source } }` or
`{ remove: id }`. The notes render as one Markdown text, so heading IDs stay
unique, but each note places its own excerpts.

### What Linear's guide adds

Linear shows an agent's PR as a guide: numbered sections ("01 / 04"), prose
on the left, the section's files with **Reviewed** boxes on the right, and a
minimap of ticks. Here is how each part fits Notes:

| Linear guide            | Notes                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Numbered sections       | Yes. With two or more notes, each note has a head: `02 / 03`, its source, and its time. A brief alone has no heads.                                  |
| Minimap ticks           | Yes. A rail on the right edge marks notes, `#` and `##` headings, and excerpts. Ticks in view are darker.                                            |
| Files beside the prose  | No. An excerpt sits under the sentence that cites it, which is closer than a side list, and the main view is often narrow while the session is open. |
| **Reviewed** per file   | Later. Med has no viewed state per file. Add it to Changes first, as GitHub's **Viewed**; then the Notes can show it per note.                       |
| One guide, written once | No. Notes grow while you talk to the agent. Their order is time, not a tour. Ask for a tour and pin it, and its headings become ticks.               |

## Layout: one pane column

Before, the right side had two asides with different widths: Workspace files
(280 px) and Agent session (440 px). The Markdown preview split the file
view.

Built, after Claude Desktop's stacked panes:

- The toolbar toggles **Session** and **Files**; the file view's **Preview**
  button (`⌘⇧V`) toggles the Preview pane.
- All panes share one right column with one width, 400 px at first. You can
  resize the column, and Med keeps its width.
- The column shows at most two panes, one above the other. Each pane has a
  header with **Maximize** and **Close**. A maximized pane leaves the other
  pane as its 40 px header.
- The Preview pane follows the Markdown file in the main view. The file view
  keeps its full width. The file view renders the preview into the pane
  through a portal, so source and preview still scroll together.

Open: stacked panes or tabs. Both are built as prototypes. **Show side panes
as tabs** in the command palette switches the layout, and the Elements page
shows both under **Side panes**. Keep one after some use.

## Long sessions: load earlier work

The host now reads only the last 8 MiB of a transcript. This session's
transcript is over 200 MB. To show earlier work, Med needs the methods that
Pierre uses for large files.

On the host:

- **Pages.** The host reads backwards by byte offset. Each page ends at the
  first line of the page after it.
- **Turn index.** One scan finds each prompt line and its byte offset. The host
  keeps the index for the file's size and modification time, and extends it
  when the file grows. The index gives an outline and "jump to turn".
- **Results across pages.** A result can be on a later page than its call.
  Today the host drops such updates. The store must keep them until the call
  arrives.

In the browser, after Pierre's `Virtualizer`:

- **Estimated heights.** Each item kind has an estimate. Pierre calculates
  estimates from line counts and line height. Measured heights replace them,
  cached by item ID and column width.
- **Render window.** Only items near the viewport are in the DOM, plus extra
  pixels above and below (Pierre's `overscrollSize`). An
  `IntersectionObserver` with a margin decides visibility.
- **Scroll anchor.** When items are added above, or heights change, the first
  visible row stays in place (Pierre's scroll anchor and scroll fix).
- **Prefetch.** A marker two screens above the first item requests the
  previous page before you reach the top.
- **Offset checkpoints.** Sums of heights at fixed steps find the item at a
  scroll position quickly. Pierre makes a checkpoint every 3,000 lines.

Today `content-visibility: auto` is sufficient for the tail (about 240 items).
A thread of some thousand items needs the render window.

Built:

- `GET /api/reviews/:id/sessions/:session/page?before=<offset>` reads up to
  4 MiB before a byte offset, from its first complete line, with the
  subagents that the page starts. The first view's `reset` event gives
  `start`, the offset of its first line.
- `GET …/turns` gives each prompt with its byte offset and time. The host
  scans the transcript once and extends the index when the file grows.
- The host now sends a result whose call is before the tail. The store keeps
  such an update until an earlier page brings the call; then the thread
  builds again in order.
- The thread renders a window of at most 600 top-level rows, counted from the
  newest. Near the top it takes 100 more rows, then loads the earlier page;
  near the bottom of a window that left newer rows out, it moves down. The
  first row in view keeps its place, because browser scroll anchoring does not
  apply at the top of the scroller. Heights are not estimated or measured;
  rows keep `content-visibility: auto`.
- **Turns** in the Session pane lists the prompts and jumps to one. It loads
  each page back to that prompt, so a jump to the start of a session of
  hundreds of megabytes loads all of it.

## Model, effort, and commands

Med is a GUI, not a terminal. Common settings get controls. The `/` menu is
for everything else.

**Model and effort.** The prompt box of an owned session has a model picker
and an effort picker, as in Claude Desktop. The agent supplies the choices:

- ACP agents list them as session config options, with the categories
  `model` and `thought_level` (stable since February 2026).
- Claude Code takes `--model` and an effort level. Its `stream-json` result
  gives each model's context window, for a context meter.
- Codex records `model` and `effort` in each turn's `turn_context`.

An attached session shows its model and effort as text in the session header.
Claude Code records them on each reply (`message.model` and `effort`), and
Codex in `turn_context`. A Claude transcript does not record the context
window, so an attached Claude session has no context meter. When the model or
effort changes between turns, the thread shows a divider.

**Built-in commands become controls:**

| Command    | Control                                  |
| ---------- | ---------------------------------------- |
| `/clear`   | **New session** (built)                  |
| `/compact` | **Compact**, in the context meter's menu |
| `/model`   | The model and effort pickers (built)     |
| `/resume`  | The session picker                       |
| `/context` | The context meter (built)                |

**The `/` menu** lists only skills and custom commands. Its sources:

- Claude Code's `stream-json` `init` message lists every command in
  `slash_commands`, and terminal-only ones in `terminal_slash_commands`. On
  this machine it lists 73.
- An ACP agent sends `available_commands_update`.
- A Claude transcript has a `skill_listing` attachment with the skills (32 on
  this machine), but no built-in commands.
- Custom commands and skills are also files: `.claude/commands/`,
  `~/.claude/commands/`, skills, and plugins.

A transcript records a command that the user ran as `<command-name>` in a
user line. The thread can show it as a command.

## Other agents and models

Med does not talk to models. It talks to agents, and each agent talks to its
model. Each API format (Anthropic Messages, OpenAI Responses, or Chat
Completions) stays between the agent and the model provider. Codex rollouts
look like Responses items because Codex uses that API.

- **Claude Code with another model.** Guides describe a DeepSeek endpoint in
  Anthropic format for Claude Code (`ANTHROPIC_BASE_URL`). The transcript is
  still Claude Code's, so Med reads it now. DeepSeek's own documentation was
  not checked.
- **Codex with another provider.** The rollout is still Codex's format.
- **OpenCode** supports many providers. `opencode acp` speaks ACP on stdio,
  with session load, resume, fork, permission requests, and usage. An owned
  OpenCode session needs no new reader. Each provider needs its own key in
  OpenCode. This is acceptable, because Med's main use is work with API
  pricing. Claude models through OpenCode need an Anthropic API key, because
  a Claude subscription works only in Anthropic's own apps. To attach to
  OpenCode, Med needs a reader for its storage, which was not checked.
- **DeepSeek Harness** (`dsh`, MIT) keeps an append-only session event log.
  Reports say that an ACP server exists for it. This was not checked against
  its repository.

Thus ACP is the general path for owned sessions: one client covers OpenCode,
Codex (through `codex-acp`), and other ACP agents. Claude Code is the
exception: Med starts the binary with `stream-json` (see
[Owning a Claude session](#owning-a-claude-session)). Attaching
needs one reader for each transcript format. Add readers when people ask for
them.

## Phases

1. **Reply path.** Draft comments, **Send to agent**, comment states,
   `med review wait` for Claude, and `codex queue` for Codex. Built.
2. **Notes and panes.** Pin to review, the Notes rename, and the pane column.
   Built; the stack or tabs choice is open.
3. **Owned sessions.** **New session** in a saved review, a prompt box with
   model, effort, and mode pickers, permission prompts, Stop, a context
   meter, and the `/` menu. Claude Code through `stream-json`. OpenCode,
   Codex (`codex-acp`), and other agents through ACP, with no new dependency.
   Built. Not built: **Compact**, and resuming an owned session after the
   host restarts.
4. **Workspace list.** States, unread dots, and lead sessions. Built, except
   pinning a lead.
5. **Long sessions.** Pages, the turn index, and the render window. Built;
   offset checkpoints and a jump that loads only the pages around a turn are
   not.

## Open questions

- Stacked panes or tabs in the right column.
- Does a session that Med starts also show in Claude Desktop's session list?
- Does Codex Desktop take a queued message while it has the thread open?
  Does it keep its sessions in the shared app-server daemon?
- Should an owned session keep running when the Med host restarts? herdr
  keeps agents in a background server for this reason. Today the host stops
  its agents when it stops. The Claude transcript and the ACP log stay, so
  the thread stays readable, but the prompt box goes back to
  `med review wait`.

## References

- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [ACP session config options](https://agentclientprotocol.com/protocol/session-config-options)
- [OpenCode ACP support](https://opencode.ai/docs/acp)
- [herdr](https://herdr.dev/)
- [DeepSeek Harness](https://deepseek.com/harness/en/)
