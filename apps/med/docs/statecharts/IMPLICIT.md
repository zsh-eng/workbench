# Implicit state machines

Status, 8 November 2026: an inventory, read from the code, not modelled. Each
entry is a flow whose states are spread over several flags or nullable fields
instead of one value, so some combinations of them mean nothing, and the code
must keep them from happening. [FINDINGS.md](FINDINGS.md) has the three flows
already modelled in TLA+: editor drafts, the Commit tab, and sent comments.

How they were found: React state that is a boolean, a nullable value, or an
empty string (four or more in one component), mutable flags in the host's
long-lived closures, and every `status` field. A component whose state is
already one string union, such as `DiagramBlock` (`source | drawn | failed`),
is explicit and left out.

## Worth modelling next

These hold the agent's work or the reader's words, and the queue that **Send
to Claude** and **Queue** would add (see the proposals) builds on the first
two.

| Flow                                  | Where                                                     | Its state is spread over                                                                                                                                                                                                                                                            | Harm when it is wrong                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The agent process that Med runs       | `host/owned-sessions.ts` (Claude), `host/codex-runner.ts` | `status` (`starting · working · idle · exited`) and, beside it, `held` (a process), `active` (a turn), `replaying`, `waking`, `exists` (a transcript to resume), `stopping`, `ask` (a permission or question waiting), `streaming`, `bypassable`, and `halt` (a turn a restart cut) | A message sent to a process that is stopping, or replayed twice after a restart. A stop that races a wake leaves `working` with no process.                                          |
| Queued messages                       | `host/queued-messages.ts`, the inbox in `host/server.ts`  | Each message's `afterTurn` flag, the session's `status`, `halt`, and whether the agent can take a message mid-turn (Claude while its tools run, Codex by `turn/steer`, ACP never)                                                                                                   | A message lost, sent twice, or sent out of order across a turn's end, an Esc, or a host restart.                                                                                     |
| Ask (a question about lines)          | `host/questions.ts`, `QuestionPane`                       | Run `status` (`starting · answering · done · stopped · failed`), the global limit of four runs, the fork's ID kept on disk, the idle close after 15 minutes, and the transcript's removal after a restart (`SETTLED_MS`)                                                            | A fork's transcript left behind, or one removed while it is still written. A fifth question that waits with no sign.                                                                 |
| The reader's pending review on GitHub | `host/repository/pull-request.ts`, `PullRequestComments`  | GitHub's pending review (none, or one that the reader authored), `body`, `busy` (`comment · reply · submit · discard`), `error`, and the 30-second read cache                                                                                                                       | A second pending review, a comment that goes to the wrong head commit, or a submit that leaves comments behind. Its truth is on GitHub, so the model needs GitHub as a second actor. |

## Read, and leave as they are

The harm is a wrong view for a moment, not lost work, and each is small
enough to read whole.

| Flow                              | Where                           | State                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A note's lifecycle                | `NoteCard`                      | `editing`, `saving`, `sending` (`posting · posted`), `handing`, `replying`, `error`, on one note                                                                                                                                |
| Push from the comparison menu     | `ComparisonActions`             | `pushOpen`, `pushing`, `published`, `pushError`, `pushHead`, and a `pushBusy` ref that closes the dialog only between pushes                                                                                                    |
| Commit and push in the Commit tab | `CommitView`                    | `busy` (`commit · push`), `loadError`, the `pending` stage changes; the commit itself is in `CommitTab.tla`                                                                                                                     |
| Message box                       | `SessionComposer`               | `text`, `images`, `open`, `continuing`, `confirming`, `menuClosed`, `error`, the kept draft, and the waiting comments; the send itself is in `SentComments.tla`                                                                 |
| First run                         | `Welcome`                       | `scanning`, `discovery`, `selected`, per-repository `pending` (`adding · failed`), `busy`, `done`, `progress`                                                                                                                   |
| Opening a dropped or local file   | `LocalFiles`                    | `visible`, `reviewMounted`, `opening`, `loading`, `dragging`, `error`                                                                                                                                                           |
| A brief's comment and delete      | `BriefView`                     | `draft`, `selected`, `submitted`, `deleting` (`ask · busy`), `linked`                                                                                                                                                           |
| The window's layout               | `App`, `Workspaces`, `PaneTree` | 37 flags in `App` alone: panes shown, zoom, the title band's mode (`lead · cover · none`, from the column's width), palettes and their modes, the toast; and in `Workspaces` the band's slot claims and the retained workspaces |
| The search service                | `host/search/`                  | No index · indexing · ready · failed, with Git answering until the index is ready                                                                                                                                               |
| The host's own life               | `host/server.ts`                | `closing`, `releaseAgain`, the service lock, and each inbox stream's `queued` debounce                                                                                                                                          |

## One from a library

`@replit/codemirror-vim` draws the half-block cursor whenever `vim.status`
is not empty, which also holds the keys typed so far. Pressing `g` or a count
set it, so the cursor shrank while Vim waited for the next key. Vim shows the
half block only while an operator waits for its motion; the fix in
`FileEditor.tsx` clears the status on each key unless an operator waits
(`inputState.operator`). The state that decides the cursor was implicit in a
string meant for display.

## Next

Model the agent process and its queue as one TLA+ spec before **Queue** reaches
files and the desk: one session, two messages (one sent now, one after the
turn), a turn that ends, an Esc, a stop, and a host restart. The property: each
message reaches the agent exactly once, in order, or stays in the inbox.
