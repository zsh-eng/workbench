# Install Med

Med v0.2.1 runs on Apple Silicon Macs (M1 or newer) with macOS 13 or newer.
This release does not support Intel Macs.

```sh
curl -fsSL https://raw.githubusercontent.com/zsh-eng/workbench/main/apps/med/install.sh | sh
```

The script downloads the newest release from GitHub and stops if the archive
does not match `SHA256SUMS`. It installs `med` in `~/.local/bin`, keeps the
license notices in `~/.local/share/med`, and adds `~/.local/bin` to PATH in
your shell's startup file. The executable includes its runtime, the browser
app, and these guides, so you do not need Node, Bun, or a checkout.

Options go after `sh -s --`: `--version x.y.z` installs that release, `--dir`
installs in another folder, `--no-modify-path` leaves your startup file as it
is, and `--force` installs a version again.

## Start

```sh
med add ~/code/my-app
med add ~/notes
med web
```

`med add` registers a Git repository or an Obsidian vault. `med web` starts
one background server and opens Med in your browser. With nothing registered,
Med opens a welcome page that finds your repositories and vaults for you and
can open Med at login.

The server keeps running when you close the browser. `med status` shows it,
and `med stop` stops it. Med keeps your sources and saved reviews in
`~/.local/state/med` and serves `http://127.0.0.1:6330`.

## Connect your agents

```sh
med skills install
```

This writes a Med skill for Claude Code (`~/.claude/skills/med`) and Codex
(`~/.agents/skills/med`). With it, an agent hands off its changes as a review
in Med. `med skills uninstall` removes it.

## Requirements

- **Git** for repository features. Vaults and other files do not need it.
- **Universal Ctags** (optional) for symbol search:
  `brew install universal-ctags`.
- **Zoekt** (optional) for indexed search. Without it, content search uses
  Git. Setup needs Go and a Workbench checkout; see `med docs usage`. Med uses
  a Zoekt cache that is already installed.

## Update

Run the install command again. Then restart the server and refresh the agent
skill:

```sh
med stop
med web
med skills install
```

Your sources and saved reviews stay in the state folder.

## Manual install

Download `med-v0.2.1-macos-arm64.tar.gz` and `SHA256SUMS` from the
[GitHub release](https://github.com/zsh-eng/workbench/releases/tag/med-v0.2.1).
In the download folder:

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf med-v0.2.1-macos-arm64.tar.gz
mkdir -p ~/.local/bin
install -m 755 med-v0.2.1-macos-arm64/med ~/.local/bin/med
~/.local/bin/med --version
```

Add `~/.local/bin` to your shell's PATH to run `med` by name.

This build is not Developer ID signed or notarized. Files that curl downloads
have no quarantine flag, so the install script needs no approval. After a
browser download, macOS can block the first launch; if you trust the download,
allow it in **System Settings → Privacy & Security**.

## Privacy

Med sends nothing to any server: no telemetry, and no requests for the icons
of linked sites. Bun uploads crash reports to bun.report on macOS by default;
Med sets `BUN_ENABLE_CRASH_REPORTING=0` for itself, the processes it starts,
and its login item.

## Offline help

```sh
med --help
med docs usage
med docs agents
med docs vaults
```

## Source and licenses

Med is built from
[Workbench / Med](https://github.com/zsh-eng/workbench/tree/med-v0.2.1/apps/med).
`BUILD.json` records the source commit and the Bun version, and
`docs/RELEASING.md` in the checkout has the build steps. Notices and source
references for Bun and its dependencies are in
`licenses/upstream/BUN-LICENSE.md`. Keep the archive's `licenses` folder with
copies that you share.
