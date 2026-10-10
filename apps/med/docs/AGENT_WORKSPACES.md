# Agent workspaces

Status: design record, October 2026. Most of it is built; [remaining work](#remaining-work)
lists the rest. [Agent sessions](SESSIONS.md) describes the session model,
readers, and stream.

Med is the place where you follow your agents, review their work, and reply to
them, without leaving the review.

| Term      | Meaning                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| Workspace | A repository checkout (the main checkout or a worktree) and its changes         |
| Session   | One agent conversation: an agent, an ID, and a working directory                |
| Review    | A saved set of changes with comments and notes                                  |
| Note      | An agent reply that you saved in a review. The brief is the first note          |
| Comment   | Your remark on a line. A GitHub comment is a comment that Med imported          |
| Lead      | The session that a workspace shows by default. Other sessions are in its picker |

## Attach or own

Med **attaches** to a session that another app started, or **owns** a session
that Med started. Both feed the same store and events; the thread does not
know which way an update came.

| Feature            | Attach                                          | Own                                                              |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------- |
| Who starts it      | Claude Desktop, a terminal, or Codex            | The Med host                                                     |
| Source of updates  | Transcript lines, read every 400 ms             | Claude: the transcript and `stream-json`. ACP: the agent's stdio |
| Replies            | Whole blocks                                    | Token by token                                                   |
| Send a message     | Claude: `med review wait`. Codex: `codex queue` | Claude: a `user` line on stdin. ACP: `session/prompt`            |
| Permission prompts | Not visible                                     | A card above the prompt box                                      |
| Stop, model, mode  | Not possible; model and effort show as text     | Controls in the prompt box                                       |
| History on reload  | The transcript                                  | Claude: the transcript. ACP: Med's log of the updates            |

**One writer per session.** Only the process that runs an agent can safely add
turns. Med sends prompts only to sessions that it owns, or through a path that
the owner provides (`med review wait`, `codex queue`). Token streaming needs
that process too: for a session that Claude Desktop runs, only Claude Desktop
gets the tokens.

### Owning a Claude session

Anthropic's [legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
page lets a user sign in to the unmodified Claude Code binary with their own
subscription, also when another product runs it. A product must not offer
Claude.ai login, use other people's credentials, or store Claude credentials or
tokens, and must not modify the binary.

Decision: Med does not install, bundle, or modify an agent. It starts binaries
that the user installed and signed in to. For Claude, Med runs `claude` with
`stream-json` input and output, never sees a credential, and uses no Agent SDK.

### Owned sessions

`src/host/owned-sessions.ts` starts the agents:

- **Claude Code**: `claude -p --input-format stream-json --output-format
stream-json --include-partial-messages --verbose --permission-prompt-tool
stdio --session-id <id>`, with `--model`, `--effort`, and `--permission-mode`
  when chosen. `initialize` gives the commands, models, and modes; Med drops
  the account field. `can_use_tool` becomes **Allow**, **Allow for this
  session**, or **Deny**. `interrupt`, `set_model`, and `set_permission_mode`
  change a running session; a new effort restarts it with `--resume` between
  turns. `get_context_usage` feeds the context meter. The thread reads the
  transcript and shows streamed text until the transcript has it.
- **ACP agents** (`src/host/json-rpc.ts`): `initialize`, `session/new`,
  `session/prompt`, `session/cancel`, and `session/set_config_option`. Med
  answers `session/request_permission` with the user's choice and appends the
  updates to `sessions/<id>.jsonl` in the state directory. A turn that ends
  with no reply gets a notice.

Med finds `claude`, `opencode acp`, `codex-acp`, and `gemini
--experimental-acp`, and reads other ACP agents from `agents.json` in the state
directory:

```json
[{ "id": "my-agent", "name": "My agent", "command": "/path/to/agent", "args": ["acp"] }]
```

Routes: `GET /api/agents`, `POST /api/reviews/:id/owned` with `{ preset }`,
`GET /api/reviews/:id/owned/:session/events`, and `POST
/api/reviews/:id/owned/:session` with `prompt`, `permission`, `interrupt`,
`setting`, or `stop`.

## Workspaces and sessions

Links are many-to-many: a new session after `/clear`, a Codex session that
reviews Claude's work, and one session across worktrees all break a one-to-one
model. Med finds the links itself: the session ran `med review create`, its
working directory is in the workspace, or it edited files there. The newest
linked session that is still working is the lead.

The workspace list shows each lead's state from `GET
/api/agent-status/events` (`src/host/agent-status.ts`): a turning mark for
**Working**, **Needs you** when the session waits in `med review wait` or on a
permission, and an unread dot for **Done**. The browser keeps the last update
that you saw (`med:agent-seen`). An attached Claude session cannot show a
waiting permission prompt, because the transcript does not record it.

## Replies

Med cannot write to an attached session: `claude --resume` starts a second
process and splits the history, channels and Remote Control need the owner's
setup, and Claude Desktop's messaging socket is not documented.

- **Claude:** after `med review create`, the skill runs `med review wait
<review>` in the background. **Send to agent** makes the command print your
  message and exit; Claude Code wakes the agent, which works and waits again.
  The message arrives as command output, so the skill says that it is your
  review.
- **Codex:** `codex queue --thread <id> --message <text>` stores a real user
  turn that the next Codex process takes first. Codex does not wake an agent
  when a background command ends, so `med review wait` does not fit it.
- **Owned sessions:** **Send to agent** is the next prompt.

Comments work as a pending GitHub review: drafts until sent, one message with
each comment's `path:line`, the quoted lines, and your remark. A sent comment
shows **Maybe addressed** when the agent changes its lines. GitHub comments
appear with a badge; **Add to reply** and **Add all open** copy them into the
draft. Med never posts to GitHub.

## Notes

Replies scroll away, and compaction can remove them, so the reply that ends
each turn has **Pin to review**. Med copies the text into the review (`POST
/api/reviews/:id/pins`). The brief and the pins are the review's **Notes**; each
iteration has its own pins. With two or more notes, each has a head
(`02 / 03`) and a minimap rail marks notes, headings, and excerpts. Excerpts
sit under the sentence that cites them, not in a side list.

The right column holds **Session**, **Files**, and **Preview** panes, at most
two stacked, with one shared, resizable width. **Show side panes as tabs**
switches to tabs.

## Long sessions: load earlier work

The host reads the last 8 MiB of a transcript. `GET
/api/reviews/:id/sessions/:session/page?before=<offset>` reads up to 4 MiB
before a byte offset, and `GET …/turns` lists each prompt with its offset from
an index that grows with the file. The store keeps a result whose call is on an
earlier page until that page arrives. The thread renders at most 600 top-level
rows, loads the earlier page near its top, and keeps the first visible row in
place. **Turns** jumps to a prompt by loading each page back to it.

## Model, effort, and commands

Owned sessions get model and effort pickers from the agent: ACP config options
(`model`, `thought_level`) or Claude Code's `initialize` reply. Built-in
commands become controls (**New session**, the pickers, the context meter);
the `/` menu lists only skills and custom commands. Attached sessions show
model and effort as text, with a divider when they change.

Med talks to agents, not models. A Claude Code or Codex session with another
provider still writes Claude Code's or Codex's format. ACP covers OpenCode,
Codex (`codex-acp`), and other ACP agents; Claude Code uses `stream-json`.
Attaching to another agent needs a reader for its transcript format.

## Remaining work

- **Compact** in the context meter's menu, and pinning a lead session.
- Resume an owned session after the host restarts. Today the host stops its
  agents; the transcript or ACP log keeps the thread readable, and the prompt
  box goes back to `med review wait`.
- Offset checkpoints, and a jump that loads only the pages around a turn.
- Choose stacked panes or tabs.
- Check whether Claude Desktop lists sessions that Med starts, and whether
  Codex Desktop takes a queued message while the thread is open.

## References

- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [ACP session config options](https://agentclientprotocol.com/protocol/session-config-options)
- [OpenCode ACP support](https://opencode.ai/docs/acp)
