# Saved reviews

An agent saves a commit range or the working changes through the running
server, and gives you a link. Open the server's launch URL once in a browser;
saved links then work in new tabs of that browser. See
[agent reviews](../AGENT_INTEGRATION.md#create-a-review).

A saved review keeps its diff when the agent makes more changes. An agent that
names its task with a key adds a version for each round of work. The Review
opens on the latest one and is marked new again; comments on earlier versions
stay. The version menu above the diff names each version and its age. A
version with more
than one comparison, such as one for each repository, lists each one in the
menu by its repository, and so does a commit that you commented on while
browsing.

**Copy comments** copies the comments of all targets, with paths, revisions,
line numbers, and nearby source, for any agent. **Send to Claude** or **Send to
Codex** sends them to the review's own agent; see
[sending comments](review-changes.md#send-comments-to-the-agent). **Clear**
clears the review's comments after you confirm. Copying does not clear them.
Beside a thread, the review's header keeps only its tabs: **Send to** shows
when there are comments to send, and **Copy comments**, **Clear all
comments**, **Commands**, and **Files** are in its **⋯** menu.

The review's bar shows its title, or its pull request's title as a link. Hover
the title for the time Med saved the review and its repository. Beside a
thread, and in quiet chrome, a pull request is the thread's title in the
window's title band: its number and title, which open it on GitHub, its state
(**Open**, **Draft**, **Merged**, or **Closed**), and its author, then the
repository and branch in quieter text, and its comments at the band's end. A
long title is cut at its end; in a narrow band, the repository and branch go
first. The review card keeps its tabs as its first row. See
[titles and pull requests](../AGENT_INTEGRATION.md#titles-and-pull-requests).

## Set up agents

```sh
med skills install
```

This writes the Med skill for Claude Code (`~/.claude/skills/med`) and Codex
(`~/.agents/skills/med`). The skill is a short `SKILL.md` that tells the agent
to run `med skills show`, which prints the hand-off checklist of the Med that
you have now; `med docs agents` prints the full guide. So when you update Med,
agents read the new rules at once. `med skills uninstall` removes the skill.

`med skills status` tells, for each agent, if the skill is installed and up to
date. A full copy from an earlier Med (`SKILL.md` and `guide.md`) is out of
date, and `med status` and `med web` say so too. `med skills update` replaces
it with the short skill where it is installed and installs it nowhere new. The
install script runs it for you.
`med skills suggest` lists review
practices that you can copy into your own skills; see
[review practices](../PRACTICES.md). For agents without skills, see
[AGENTS.md guidance](../AGENT_INTEGRATION.md#agentsmd-guidance).

For threads that Med starts, add these lines to your CLAUDE.md or AGENTS.md,
such as `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. The first install prints
them, and `med skills instructions` prints them again. Edit them as you like;
Med adds nothing to an agent's prompt.

```markdown
## Med

Hand off finished changes for review with the `med` skill. In a thread that
Med started (`MED_SESSION=owned`), hand off each round of work with
`med review create --working --title "<2-4 words>" --guide -` (add `--paths`
in a shared checkout); messages arrive as new turns, so don't run
`med review wait`.
```

Review commands talk to the running server, so start Med with `med web`. They
find it through a private connection file in the state folder,
`~/.local/state/med` by default. Every command takes the folder from
`--state-dir` or `MED_STATE_DIR`, and the port from `--port` or `MED_PORT`.
Without a port, a command uses the server that runs from the state folder.
Port 6330 is for `~/.local/state/med`: a server of another state folder, such
as a second Med that an agent runs beside yours, takes a free port and says
which. Choose a port with `--port` for an address that stays the same after a
restart. A login service of another state folder needs `--port`. The commands
that Med prints for an agent to run next carry `--port` and `--state-dir`
when they are not the defaults. Saved reviews and their comments last as long
as the state folder.

Open the server's launch URL once in the browser where you review. Med changes
its token for a browser cookie and removes the token from the address; review
links such as `http://127.0.0.1:6330/review/r_…` then work in new tabs. Another
browser must open the launch URL once too. Never put the launch token in agent
instructions or review links.

Saved reviews persist in the state folder, until 30 days after you close
their tabs ([Threads](threads.md)). Notes on a branch last until the server
stops.
