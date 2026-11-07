# Using Med

Med shows Git changes, files, and notes in your browser, from a server on your
Mac. This guide covers the app. To hand off reviews from coding agents, see
[agent reviews](AGENT_INTEGRATION.md).

## Concepts

These words name the parts of Med.

- A **source** is a repository, or a vault of Markdown notes, that you
  registered with `med add`. Med watches it for changes.
- A **workspace** is a set of tiled panes around one review or source: the
  review, **Changes**, **Session**, and **Files**. Each keeps its own layout.
- A **thread** is one task: an agent's work and its changes. The threads that
  you have open are tabs in the sidebar. The others are history.
- A **review** is the saved record of a change: its diffs, the agent's guide,
  and your comments. It stays on your Mac.
- A **version** is one hand-off in a review. Each `med review create` with the
  same key adds one, and you can compare it with an earlier one.
- A **key** names the task, usually by its branch. An agent gives the same key
  for each round.
- A **guide** is the agent's reading order for a version: a summary, then
  segments that you check one at a time.

## Pages

- [Run Med](usage/run-med.md): start the server, start it at login, install the app, and register sources.
- [Threads](usage/threads.md): tabs and history, an agent's session, attempts, and scheduled tasks.
- [Review changes](usage/review-changes.md): read a diff, comment, ask about lines, and send comments to the agent.
- [Saved reviews](usage/saved-reviews.md): what a saved review keeps, and how to set up agents to hand off work.
- [The Guide](usage/guide.md): read an agent's change as a summary, segments, commits, and what changed since your last review.
- [Pull requests](usage/pull-requests.md): review a GitHub pull request, its comments, a draft, and stacks of changes.
- [Find files and code](usage/find.md): find files, search their contents, and go to symbols.
- [Edit working files](usage/edit-files.md): edit, commit, and push, and open files outside Git.
- [Read and edit Markdown](usage/markdown.md): read rendered Markdown, images, and videos.
- [Layout](usage/layout.md): panes, the review's header, and the view settings.
- [Keyboard shortcuts](usage/keyboard.md): every shortcut, by place.
- [Limits and evidence](usage/limits.md): what Med does not do, and the reports that measure it.
