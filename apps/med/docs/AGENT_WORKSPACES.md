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

| Feature            | Attach                                          | Own                                                               |
| ------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Who starts it      | Claude Desktop, a terminal, or Codex            | The Med host                                                      |
| Source of updates  | Transcript lines, read every 400 ms             | Claude: the transcript and `stream-json`. ACP: the agent's stdio  |
| Replies            | Whole blocks                                    | Token by token                                                    |
| Send a message     | Claude: `med review wait`. Codex: `codex queue` | Claude: a `user` line on stdin. ACP: `session/prompt`             |
| Images in a prompt | Saved copies, named by path in the message      | Claude: image blocks. ACP: when `promptCapabilities.image` is set |
| Permission prompts | Not visible                                     | A card above the prompt box                                       |
| Stop, model, mode  | Not possible; model and effort show as text     | Controls in the prompt box                                        |
| History on reload  | The transcript                                  | Claude: the transcript. ACP: Med's log of the updates             |

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
- Every agent starts without the variables of a Claude Code session or app
  that started the Med host, such as `CLAUDE_CODE_SESSION_ID` and
  `CLAUDE_CODE_SIMPLE`. Bare mode (`CLAUDE_CODE_SIMPLE=1`) never reads the
  keychain login, so each new session said "Not logged in".
- **ACP agents** (`src/host/json-rpc.ts`): `initialize`, `session/new`,
  `session/prompt`, `session/cancel`, and `session/set_config_option`. Med
  answers `session/request_permission` with the user's choice and appends the
  updates to `sessions/<id>.jsonl` in the state directory. A turn that ends
  with no reply gets a notice.
- **After a restart**: the host keeps the sessions it started in
  `owned-sessions.json` in the state directory, with the thread's key and the
  model, effort, and mode that each one has now. When it starts again, a Claude
  Code session comes back idle without a process, and its next prompt starts
  `claude` with `--resume` and those choices. Med does not resume a session
  that another Claude Code process runs, such as one that the user resumed in
  a terminal; the message waits until that process ends
  ([messages to adopted sessions](SESSIONS.md#messages-to-adopted-sessions)).
  A session that the user stopped stays stopped, and an ACP session shows as
  stopped, with its log, so the prompt box offers a new session.
- **Cut turns and exits**: the record also keeps a turn that has not ended.
  A host that restarts during a turn brings that session back as
  **Interrupted**, with Continue and Dismiss at the end of its thread; Med
  never continues the turn alone. A Claude Code process that exits without
  a stop from Med leaves its session idle without a process, as after a
  restart, and **Stopped** with the reason and the last error lines. Restart,
  or the next message, resumes it with `--resume`. The owned state carries
  this as `halt`, and the thread list shows it.
- **State files**: Med writes `owned-sessions.json` and `tabs.json` to a
  temporary file that then replaces the old one, and reads each record on its
  own. A record that Med cannot read costs only itself, and the file keeps a
  copy beside it (`<file>.unreadable-<time>`) before Med writes it again
  (`src/host/runtime/state-file.ts`).
- **Adopted sessions**: a Claude Code session that Med did not start, such
  as one that Keep in Med or `med thread adopt` saved, becomes an owned
  session when a message comes and no process runs it (`resume`), with a
  record as above. **Continue in Med** starts an owned fork of one that a
  terminal runs (`--resume <id> --fork-session --session-id <new ID>`).

### What a thread's agent knows

Med adds nothing to an agent's prompt. The user keeps short instructions in
their own CLAUDE.md or AGENTS.md (`med skills instructions` prints them, from
`skills/thread-instructions.md`), so they can edit them. The instructions say
how to hand off work with `med review create --working --title "<2-4 words>"
--guide -`, with `--paths` in a shared checkout, and not to run `med review
wait`; the med skill gives the guide's format.

Every agent that Med starts also gets these variables:

| Variable                            | Value                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| `MED_SESSION`                       | `owned`: `med review wait` exits at once                    |
| `MED_PORT`, `MED_STATE_DIR`         | This host, so `med review` reaches it                       |
| `MED_THREAD_KEY`, `MED_THREAD_REPO` | The default `--key` and `--repo` of `med review`            |
| `PATH`                              | Starts with `<state>/bin`, whose `med` runs this host's CLI |

The `med` command in `<state>/bin` lets an agent hand off work when `med` is
not on PATH, such as when the host runs from a checkout, and it always matches
the host's version.

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

The thread list shows each lead's state from `GET /api/threads/events`
(`src/host/agent-status.ts` reads it): a turning mark for **Working**,
**Needs you** when the session waits in `med review wait` or on a permission,
or when its last turn ended on a question that no message from Med answers,
and an unread dot for **Done**. A working row shows the running tool in place
of its branch (`src/host/thread-turns.ts` reads the transcript's tail). The
browser keeps the last update that you saw (`med:thread-seen`). An attached
Claude session cannot show a waiting permission prompt, because the transcript
does not record it.

## Replies

Med cannot write to an attached session while another process runs it:
`claude --resume` would start a second process and split the history,
channels and Remote Control need the owner's setup, and Claude Desktop's
messaging socket is not documented. When no process runs a Claude session,
Med resumes it and owns it from then on
([messages to adopted sessions](SESSIONS.md#messages-to-adopted-sessions)).

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
version has its own pins. With two or more notes, each has a head
(`02 / 03`) and a minimap rail marks notes, headings, and excerpts. Excerpts
sit under the sentence that cites them, not in a side list.

The right column holds **Session**, **Files**, and **Preview** panes, at most
two stacked, with one shared, resizable width. **Show side panes as tabs**
switches to tabs.

## Long sessions: load earlier work

The host's first view is the end of a transcript: about three screens of
prompts and replies, read from at most the last 8 MiB
([host stream](SESSIONS.md#host-stream)). `GET
/api/reviews/:id/sessions/:session/page?before=<offset>` reads up to 4 MiB
before a byte offset, and `GET …/turns` lists each prompt with its offset from
an index that grows with the file. The store keeps a result whose call is on an
earlier page until that page arrives. The thread renders at most 600 top-level
rows, loads the earlier page near its top, and keeps the first visible row in
place. **Turns** jumps to a prompt by loading each page back to it.

## Model, effort, and commands

Owned sessions get model and effort pickers from the agent: ACP config options
(`model`, `thought_level`) or Claude Code's `initialize` reply. New thread
offers them before the session starts: Med asks Claude Code once per host with
an `initialize` request and no prompt, which writes no transcript; an ACP agent
names its options only in a session, so Med shows those of its last session
(`agent-offers.json` in the state directory). A new session starts with Med's
defaults where the agent offers them: Claude Code on `opus` at `medium` effort,
Codex on `gpt-6-astra`. Built-in
commands become controls (**New session**, the pickers, the context meter);
the `/` menu lists only skills and custom commands. Attached sessions show
model and effort as text, with a divider when they change.

Med talks to agents, not models. A Claude Code or Codex session with another
provider still writes Claude Code's or Codex's format. ACP covers OpenCode,
Codex (`codex-acp`), and other ACP agents; Claude Code uses `stream-json`.
Attaching to another agent needs a reader for its transcript format.

### Review and Changes

A thread has two views of its work, in the tabs **Review** and **Changes**.

- **Changes** are the checkout's Git changes now, read with each change
  event and never saved. On a branch other than the base, they are the
  branch's commits since its merge base with the base branch, and its
  uncommitted changes (`{ kind: "working", base }`); on the base branch, the
  working changes. In a shared checkout (the main checkout, or a checkout
  with two or more threads' sessions), **Only this session's files** adds
  `session` to the comparison, and the host keeps the files that the session's
  transcript edited (`src/host/session-edits.ts`).
- **Review** holds what the agent hands off. `med thread show` adds a version
  (`POST /api/reviews/:id/versions`), and so does `med review create` with the
  thread's key. New thread, **Keep in Med**, and `med thread adopt`
  save only the thread's checkout, so a thread has no Review until its agent
  shows one. An older thread's first capture is version 1; an empty capture
  alone is not a Review.

An agent that does not hand off, such as Codex, changes the checkout and not
the Review. The Review asks the host `GET
/api/reviews/:id/targets/:target/drift` when it opens, and after each change
event: the host compares the checkout's working changes with the latest
version (HEAD, patch, and changed files) and watches the checkout's files from
then on. When they differ, the Review shows **Refresh review**, which saves
the current comparisons as a new version (`POST /api/reviews/:id/iterations`),
and **Show Changes**. The bar waits while the thread's lead session works,
because the agent may still hand off.

## Remaining work

- **Compact** in the context meter's menu, and pinning a lead session.
- Resume an ACP session after the host restarts with `session/load`, for
  agents that offer it; Med would keep the agent's own session ID.
- Offset checkpoints, and a jump that loads only the pages around a turn.
- Choose stacked panes or tabs.
- Check whether Claude Desktop lists sessions that Med starts, and whether
  Codex Desktop takes a queued message while the thread is open.

## References

- [Claude Code channels](https://code.claude.com/docs/en/channels)
- [ACP session config options](https://agentclientprotocol.com/protocol/session-config-options)
- [OpenCode ACP support](https://opencode.ai/docs/acp)
