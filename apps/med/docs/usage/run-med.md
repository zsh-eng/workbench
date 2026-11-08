# Run Med

`med web` starts one background server and opens Med in your browser. The
server keeps running when you close the terminal or the browser. `med status`
shows it and its sources (`--json` for scripts), `med stop` stops it, and
`med serve` runs it in the foreground.
The agents that Med starts keep working while the server stops or restarts,
and the next server takes them up. An agent stops a minute after its
thread's tab closes, once its turn ends. `med agents` lists the agents, and
`med agents stop --all` stops them.

Med serves port **6330** and keeps its state in `~/.local/state/med`. For a
second profile, give every command the same `--state-dir`: its server takes a
free port and says which, and later commands with that folder find it. Add
`--port` for an address that stays the same after a restart; a port that you
give must be free.

When Med is out of date, an open page says so. **Restart** replaces a server
that runs older code, and **Reload** loads a newer page. Med first checks that
the new build starts; if it does not, the current server keeps running and the
notice shows the error. A server that you started with `med serve` asks you
to restart it in its terminal.

## Start at login

- **Open at login** on the setup page, or `med service login on`, opens Med at
  your next login. It does not change the running server.
  `med service login off` removes it.
- `med service install` installs a per-user LaunchAgent that starts the server
  at login and restarts it after a crash. Run `med stop` first, and keep the
  executable at the same path. `med service uninstall` removes it.

The login service keeps the PATH of the install command, so it finds the same
Git and Go as a server that you start in a terminal. Install it again after a
tool moves. Its log is `service.log` in the state folder. On other systems, run
`med serve` from your own service manager.

launchd reads no shell profile, so the login service reads your login shell's
environment once as it starts (`$SHELL -i -l`, at most 5 s) and gives it to
the agents that it starts. A token or a PATH that `~/.zshrc` exports, such as
`ANTHROPIC_API_KEY` for Claude Code, then reaches the agents as in a terminal;
restart the service after you change it. Your profile can check
`MED_RESOLVING_ENVIRONMENT` to skip slow work, and `MED_SHELL_ENVIRONMENT=0`
turns the read off.

## Install as an app

In Chrome or Edge, select the install icon in the address bar, or **Install
Med** in the browser menu. Med then has its own window and Dock icon, and gets
the shortcuts that a browser keeps for its tabs. The app needs the background
server, so use `med service install` to start the server at login. Each port is
a separate app.

The title bar's hide button gives Med the whole window. The branch and the
sidebar toggle move up beside the window controls, in Med's top row, and the
panes start below it. With
branch tabs open, the branch tabs head the window instead. Empty parts of the
top row move the window. Show the title bar again from the same place. Chrome
reads this from Med's manifest at a later launch; reinstall the app to get it
at once.

Med's top row then takes the height of the strip that the system keeps for
the window controls (38 pixels on macOS), so its controls and title sit on the
same centre line as the traffic lights. A page that heads the window, such as
Sources, puts its header in that strip, clear of the window controls. On a
strip lower than 38 pixels, as on Windows and Linux, the header keeps 38
pixels, so its controls sit a little below the window controls' centre line.
In a browser tab the row is 36 pixels.

## Sources

The first time `med web` runs with nothing registered, Med shows a setup page:

- **Repositories** and **Obsidian vaults** list what Med finds in your home
  folder, most recent first. Ones used in the last three weeks (vaults: two
  months) start selected. Linked worktrees, dependency folders, and hidden
  folders are left out. Med searches Desktop, Documents, and Downloads only
  when you choose **Search them too**, because macOS asks permission first.
- **Add a folder by path** adds a repository or vault that the search missed.
- **Open at login** starts Med when you log in.

Setup reads folder names and Git metadata only. To open it again, choose **Add
sources…** on the Sources page, or **Set up Med…** in the command palette.

From a terminal, `med add` registers a folder, `med list` lists your sources,
and `med remove` removes one. Registration persists across restarts. A linked
worktree belongs to its repository; separate clones stay separate, even with
the same remote. On the **Sources** page, a row's **⋯** menu can index a vault
again, copy the path, or remove the source. Removing a source keeps its folder.
See [notes and vaults](../VAULTS.md) for vaults.

### Base branches stay up to date

Med pulls each registered repository's base branch, so a new branch or a
review starts from the newest commits without a `git pull` first. A minute
after Med starts, and then every 15 minutes, it fetches the branch that the
remote names as its default (`origin/HEAD`, such as `main`, `master`, or
`develop`), or else the main checkout's branch, from its upstream, and moves
the local branch forward as `git pull --ff-only` would:

- A checkout that has the branch out moves with it while it has no
  uncommitted changes to tracked files. With changes, Med only fetches.
- A branch that no checkout has out moves by its ref, so a thread's own
  branch and worktree stay as they are.
- A branch with commits of its own stays as it is: Med never merges or
  rebases. It only fetches the remote's branch.
- A fetch never asks for a password or a passphrase. A key in the SSH agent
  and a password in the keychain work; otherwise the pull fails quietly and
  tries again later.

Turn it off with **Pull base branches** in [Settings](settings.md#sources), or
`"sources.pullBase": false` in the settings file. Only the Med that uses its
own state folder pulls; one started with `--state-dir` does not.
