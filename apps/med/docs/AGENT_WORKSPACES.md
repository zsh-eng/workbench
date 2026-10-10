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

| Feature            | Attach (today)                                  | Own (next)                                           |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------- |
| Who starts it      | Claude Desktop, a terminal, or Codex            | The Med host                                         |
| Source of updates  | Transcript lines, read every 400 ms             | The agent's stdio: ACP, or Claude Code `stream-json` |
| Replies            | Whole blocks                                    | Token by token                                       |
| Send a message     | Claude: `med review wait`. Codex: `codex queue` | `session/prompt`                                     |
| Permission prompts | Not visible                                     | Shown in the thread; you answer them in Med          |
| Stop the agent     | Not possible                                    | `session/cancel`                                     |
| Model and effort   | Shown as text                                   | Pickers in the prompt box                            |
| Context usage      | Codex only                                      | Yes                                                  |
| Slash commands     | Skills from the transcript                      | The agent's full list                                |
| History on reload  | The transcript                                  | The transcript, or ACP `session/load`                |

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

It is not clear whether a local tool that starts the user's own installed
binary counts as a product that "runs Claude Code". Ask Anthropic before a
public release has owned Claude sessions, and before Med uses an Agent SDK
adapter with a subscription login.

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

For an owned session, **Send to agent** is `session/prompt`.

### Codex

Codex 0.160 keeps sessions in a shared local app-server daemon:

- `codex queue --thread <id> --message <text>` queues a message for an
  existing session.
- `codex app-server proxy` connects a client to the daemon's control socket.
- `codex agents` lists the sessions in the daemon.

If Codex Desktop keeps its sessions in this daemon, Med can send to an
attached Codex session with `codex queue`. Med can also follow the session
live through the proxy, with token streaming and approvals, and without a
second writer. These facts come from `codex --help` only. Test them with a
scratch session first. `med review wait` is a poor fit for Codex, because
Codex does not wake the agent when a background command ends.

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

- Each agent reply gets **Pin to review**. Med copies the text into the
  review, not a link, because the transcript can lose the reply.
- Pinned replies are the review's **Notes**. Today's brief is the first note.
  A later pin is a new iteration, as brief iterations are now.
- To get an explanation, you send a normal prompt, such as "walk me through
  this change", and pin the reply.

## Layout: one pane column

Today the right side has two asides with different widths: Workspace files
(280 px) and Agent session (440 px). The Markdown preview splits the file
view.

Proposal, after Claude Desktop's stacked panes:

- The toolbar has one toggle for each pane: **Session**, **Files**, and
  **Preview**.
- All panes share one right column with one width. You can resize the
  column, and Med keeps its width.
- The column shows at most two panes, one above the other. Each pane has a
  header, **Maximize**, and **Close**.
- The Preview pane follows the Markdown file in the main view. The file view
  then keeps its full width.

Open: stacked panes or tabs. Make a prototype of both before you decide.

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
| `/clear`   | **New session**                          |
| `/compact` | **Compact**, in the context meter's menu |
| `/model`   | The model and effort pickers             |
| `/resume`  | The session picker                       |
| `/context` | The context meter                        |

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
  OpenCode. Claude models through OpenCode need an Anthropic API key, because
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

1. **Reply path.** Draft comments, **Send to agent**, `med review wait`,
   comment states, and `codex queue` after a test.
2. **Notes and panes.** Pin to review, the Notes rename, and the pane column.
3. **Owned sessions.** **New session** in a workspace, a prompt box with
   model and effort pickers, permission prompts, Stop, and the `/` menu.
   Claude Code through `stream-json`. Codex through its app-server daemon or
   `codex-acp`. Other agents through ACP. An adapter package is a new
   dependency.
4. **Workspace list.** States, unread dots, and lead sessions.
5. **Long sessions.** Pages, the turn index, and the render window.

## Open questions

- Stacked panes or tabs in the right column.
- Does a session that Med starts also show in Claude Desktop's session list?
- Does Codex Desktop keep its sessions in the shared app-server daemon, so
  that `codex queue` reaches them?
- Do owned Claude sessions in a public Med release need Anthropic's
  Commercial Terms? Can Med use an Agent SDK adapter with the user's own
  subscription? Ask Anthropic.
- Should an owned session keep running when the Med host restarts? herdr
  keeps agents in a background server for this reason.

## References

- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [ACP session config options](https://agentclientprotocol.com/protocol/session-config-options)
- [OpenCode ACP support](https://opencode.ai/docs/acp)
- [herdr](https://herdr.dev/)
- [DeepSeek Harness](https://deepseek.com/harness/en/)
