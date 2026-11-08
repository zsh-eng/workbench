# Using Med

Med is a review app that runs on your Mac. A coding agent hands off its work,
you read the diff and comment on lines, and the agent answers and goes on. Med
shows the agent's session beside its changes, in your browser, from a server
on `127.0.0.1:6330`. Your code, reviews, and comments stay on your Mac.

![The agent's session beside the review of its change](screenshots/app/window.webp)

## The words

- A **source** is a repository, or a vault of Markdown notes, that you added
  with `med add`. Med watches it for changes.
- A **thread** is one task: an agent's session and the changes it hands off.
  Your open threads are the rows in the sidebar.
- A **session** is one agent conversation. Med either runs it, or reads one
  that another app runs.
- A **hand-off** is what an agent shows you with `med review create`: a diff,
  or part of one. The agent picks what it compares, such as the whole change
  or only the latest round. A later hand-off with the same **key**, usually
  the branch, joins the same thread and opens on **New since you looked**.
- A **review** is the saved record of a thread's hand-offs: the captured
  diffs, the guide, and the comments. It is a view on a set of changes, kept
  so it still reads the same after the branch moves on.
- A **guide** is optional: the agent's summary, then parts that you read one
  at a time. A diff with a sentence is enough.
- A **comment** is your note on lines. It is a draft until you send it, and
  the agent answers it in its thread with `med reply <id>`.

## A review, round by round

```mermaid
sequenceDiagram
  actor You
  participant Agent
  participant Med
  participant Repo as Repository
  You->>Agent: A task
  Agent->>Repo: Edits and commits
  Agent->>Med: med review create (key: the branch)
  Med->>Repo: Captures the diff
  Med-->>You: The thread opens, with a hand-off card in the session
  You->>Med: Read, and comment on lines
  alt Med runs the session
    You->>Med: Send 2 comments
    Med->>Agent: One message: each comment with its ID, file, and lines
  else Another app runs it
    You->>Agent: Copy comments, and paste them there
  end
  Agent->>Med: med reply 6f1c9e (answers that comment in its thread)
  Agent->>Repo: Fixes
  Agent->>Med: med review create (the same key)
  Med-->>You: Opens on New since you looked
```

The review has three pages, `1`–`3`:

- **Review**: the agent's guide, if it gave one, and its summary.
- **Changes**: the diff, with your comments and the agent's answers.
- **Commit**: stage, commit, and push working changes.

| Review                                                                      | Changes, with the agent's answer                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| ![The Review page with the agent's guide](screenshots/app/review-page.webp) | ![A comment and the agent's answer under it](screenshots/app/reply.webp) |

| Commit                                                                 | Settings                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------ |
| ![The Commit page with four files staged](screenshots/app/commit.webp) | ![Settings on one page](screenshots/app/settings.webp) |

| Display, a row for each choice                                                     | Settings › Open in                                                                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| ![Display: layout, wrap, comments, text size, theme](screenshots/app/display.webp) | ![Code hosts, Sourcegraph, editors, and links](screenshots/app/settings-open-in.webp) |

The review's header keeps one action, **Copy comments**, with their number;
the rest is in `⌘K`, Settings and each of its sections too. Every pane's
header has **Expand** (`⌘E`) and **Hide** (a line). The review hides while the
session shows beside it; the session's header then has **Show review**.

![The review hidden, and Show review in the session's header](screenshots/app/review-hidden.webp)

## Where a message goes

Med writes only to a session that it runs, because one session can have only
one writer.

```mermaid
flowchart TD
  M["You send a message or comments"] --> Q{"Who runs the session?"}
  Q -- "Med: started or resumed in Med" --> P["Its next prompt"]
  Q -- "No one: the session is closed" --> R["Med resumes it with the message,<br/>and runs it from then on"]
  Q -- "Another app: a terminal, the Claude app, Codex" --> S["The thread is for reading:<br/>Continue in Med (a fork), or Copy comments"]
```

## Under the hood

### What runs where

```mermaid
flowchart TB
  browser["Med in your browser"]
  cli["med CLI<br/>(you, or an agent)"]
  host["Med server<br/>127.0.0.1:6330"]
  agents["Agents that Med runs<br/>claude, codex"]
  state[("State folder<br/>~/.local/state/med")]
  settings[("Settings file<br/>~/.config/med")]
  repos[("Repositories<br/>checkouts and worktrees")]
  transcripts[("Agent transcripts<br/>~/.claude, ~/.codex")]
  remote["Git remote, GitHub"]

  browser -- "HTTP" --> host
  host -- "live stream" --> browser
  cli -- "HTTP, with a token" --> host
  host <--> state
  settings -- "watched" --> host
  transcripts -- "tailed" --> host
  host -- "git" --> repos
  repos -- "watched" --> host
  host <-- "stdio" --> agents
  agents -- "edit, commit" --> repos
  host -- "fetch, gh" --> remote
```

- The **state folder** holds the saved reviews (`reviews/`), the open tabs
  (`tabs.json`), the sessions Med runs, and the token that the CLI uses to
  reach the server. A second profile is another folder: `--state-dir`.
- A **review** is captured when the agent hands off: Med copies the diff and
  the files' text, so the review reads the same later.
- The browser reads with plain HTTP calls, and one **live stream** per page
  brings every change: a repository's files, a session's updates, a setting.

### A session's updates

Every source of a session becomes the same updates, those of the
[Agent Client Protocol](https://agentclientprotocol.com) (ACP). The thread
only knows that model ([agent sessions](SESSIONS.md)).

```mermaid
flowchart LR
  file["A transcript (.jsonl)<br/>read every 400 ms"] --> reader["Reader:<br/>a line → ACP updates"]
  stdio["An agent Med runs:<br/>its stdio, token by token"] --> reader
  reader --> live["Live stream"] --> store["The page's store"] --> thread["The thread: replies,<br/>tool calls, plan"]
```

### Settings

Every setting is a key in `~/.config/med/settings.json`
([settings](usage/settings.md)). A choice in Med writes its key; an agent or
an editor can write the file, and Med applies the save at once.

```mermaid
flowchart LR
  choice["A choice in Settings"] -- "writes its key" --> file[("settings.json")]
  editor["An agent, or your editor"] -- "saves" --> file
  file -- "watched" --> host["Med server"] -- "live stream" --> windows["Every window"]
```

### Base branches stay up to date

A minute after Med starts, then every 15 minutes, Med fetches each
repository's base branch and moves it forward as `git pull --ff-only` would.
It never merges, rebases, or asks for a password. Turn it off with
**Settings › Sources › Pull base branches** (`sources.pullBase`).

```mermaid
flowchart TD
  start["Every 15 minutes"] --> base{"A base branch with a remote?<br/>The remote's default, then<br/>main, master, develop, trunk"}
  base -- "no" --> skipped["Skipped"]
  base -- "yes" --> fetch["Fetch the remote's branch"]
  fetch --> ahead{"Where is the local branch?"}
  ahead -- "at the remote's" --> current["Current"]
  ahead -- "has commits of its own" --> fetched["Fetched only"]
  ahead -- "behind" --> out{"Checked out?"}
  out -- "no" --> ref["Move the branch"]
  out -- "yes, clean" --> ff["git merge --ff-only"]
  out -- "yes, with uncommitted changes" --> fetched
```

## Prototypes

The Screens page (`/screens`, in a development build) shows designs on
made-up data before they reach the app. The find bar started there: one bar
for `⌘F` in a diff, `⌘F` in a file, and Vim's `/` and `?`, now in both.

![The find bar, in a diff and in a file with Vim's /](screenshots/app/find-bar.webp)

## Pages

- [Run Med](usage/run-med.md): start the server, start it at login, and add sources.
- [Threads](usage/threads.md): the sidebar, New thread, an agent's session, and scheduled tasks.
- [Review changes](usage/review-changes.md): read a diff, comment, and send comments to the agent.
- [Saved reviews](usage/saved-reviews.md): what a review keeps, and how to set up agents to hand off work.
- [The Guide](usage/guide.md): an agent's summary and parts, and what is new since you looked.
- [Pull requests](usage/pull-requests.md): review a GitHub pull request and its comments.
- [Find files and code](usage/find.md): find files, search their contents, and go to symbols.
- [Edit working files](usage/edit-files.md): edit, commit, and push.
- [Read and edit Markdown](usage/markdown.md): rendered Markdown, diagrams, images, and videos.
- [Layout](usage/layout.md): panes, Expand and Hide, and the review's header.
- [Settings](usage/settings.md): every setting, and the settings file.
- [Keyboard shortcuts](usage/keyboard.md): every shortcut, by place.
- [Limits and evidence](usage/limits.md): what Med does not do.
- For agents: [agent reviews](AGENT_INTEGRATION.md), the full reference of `med review`.
