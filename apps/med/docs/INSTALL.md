# Install med on macOS

Med v0.1.5 supports Apple Silicon (M1 or newer), macOS 13 or newer.
Download `med-v0.1.5-macos-arm64.tar.gz` and `SHA256SUMS` from the
[GitHub release](https://github.com/zsh-eng/workbench/releases/tag/med-v0.1.5).
Intel Macs are not included in this release.

In the download directory:

```sh
shasum -a 256 -c SHA256SUMS
tar -xzf med-v0.1.5-macos-arm64.tar.gz
mkdir -p ~/.local/bin
install -m 755 med-v0.1.5-macos-arm64/med ~/.local/bin/med
~/.local/bin/med --version
```

Add `~/.local/bin` to your shell's PATH to use `med` directly. The executable
includes Bun, the browser UI, fonts, workers, and offline documentation. No
checkout, Node, or separate Bun install is needed.

This build is not Developer ID signed or notarized. macOS may block its first
launch; approve it in **System Settings → Privacy & Security** if you trust the
download. Keep the archive's `licenses` folder with redistributed copies.

## Start

```sh
med add /path/to/repository
med add /path/to/obsidian-vault
med web
```

`med web` starts one local background server and opens your browser. Use
`med status` to inspect it and `med stop` to stop it. Closing the browser does
not stop the server. Registration and saved reviews persist in
`~/.local/state/med`; the default address is `http://127.0.0.1:4173`.

Git is required for repository features (`git --version` checks your install).
Vaults and local files do not need Git. Universal Ctags is optional for symbols:
`brew install universal-ctags`. Indexed search with Zoekt is optional; without it,
content search uses Git. Initial Zoekt setup needs the Workbench checkout and Go;
see `med docs usage`. A previously installed Zoekt cache works with this binary.

## Offline help and updates

```sh
med --help
med docs usage
med docs vaults
med docs agents
```

For an update, run `med stop`, install the new executable at the same path,
then run `med web`. Your sources and saved reviews stay in the state directory.
To start at login, opt in with `med service install` after installing at a stable
path. Remove that setting with `med service uninstall`.

Build source: [Workbench / Med](https://github.com/zsh-eng/workbench/tree/med-v0.1.5/apps/med).
`BUILD.json` records the exact source commit and Bun runtime version. Build steps
are in `docs/RELEASING.md` in the checkout. Bun and its runtime dependencies'
notices and source references are in `licenses/upstream/BUN-LICENSE.md`.
