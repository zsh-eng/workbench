#!/bin/sh
# Installs the Med executable from its GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/zsh-eng/workbench/main/apps/med/install.sh | sh
#
# Options (after `sh -s --` when piped):
#   --version <x.y.z>   Install this release instead of the newest one (MED_VERSION).
#   --dir <path>        Install the executable here (MED_INSTALL_DIR, default ~/.local/bin).
#   --no-modify-path    Do not add the directory to PATH in a shell startup file
#                       (MED_NO_MODIFY_PATH=1).
#   --force             Install again when this version is already installed.
set -eu

repo="zsh-eng/workbench"
# Tests point these at a local server.
api="${MED_INSTALL_API:-https://api.github.com}"
downloads="${MED_INSTALL_DOWNLOADS:-https://github.com}"
version="${MED_VERSION:-}"
dir="${MED_INSTALL_DIR:-$HOME/.local/bin}"
modify_path=1
[ "${MED_NO_MODIFY_PATH:-}" = 1 ] && modify_path=0
force=0

say() { printf '%s\n' "$*"; }
fail() {
  printf 'med install: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)
      [ $# -ge 2 ] || fail "--version needs a value, such as --version 0.1.7."
      version="$2"
      shift 2
      ;;
    --dir)
      [ $# -ge 2 ] || fail "--dir needs a path."
      dir="$2"
      shift 2
      ;;
    --no-modify-path)
      modify_path=0
      shift
      ;;
    --force)
      force=1
      shift
      ;;
    -h | --help)
      say "Usage: install.sh [--version <x.y.z>] [--dir <path>] [--no-modify-path] [--force]"
      say "Installs the Med executable for macOS on Apple Silicon to ~/.local/bin."
      exit 0
      ;;
    *) fail "unknown option $1. Use --version, --dir, --no-modify-path, or --force." ;;
  esac
done

# Releases are built for Apple Silicon. A shell under Rosetta reports x86_64.
os=$(uname -s)
arch=$(uname -m)
[ "$os" = Darwin ] || fail "Med releases are for macOS. Build from source: https://github.com/$repo/tree/main/apps/med"
if [ "$arch" = x86_64 ] && [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
  arch=arm64
fi
[ "$arch" = arm64 ] || fail "Med releases are for Apple Silicon Macs. This Mac is $arch."
major=$(sw_vers -productVersion 2>/dev/null | cut -d. -f1 || true)
[ -z "$major" ] || [ "$major" -ge 13 ] || fail "Med needs macOS 13 or newer."
for tool in curl tar shasum; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required."
done

if [ -z "$version" ]; then
  # This repository also releases other apps, so GitHub's "latest" release can
  # be another app's. The list is newest first; take the first plain med-v tag.
  releases=$(curl -fsSL -H "Accept: application/vnd.github+json" "$api/repos/$repo/releases?per_page=100") ||
    fail "could not list Med releases. Set MED_VERSION=<x.y.z> to choose one."
  version=$(printf '%s\n' "$releases" |
    grep -o '"tag_name": *"med-v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"' |
    head -n 1 | sed 's/.*"med-v//; s/"$//')
  [ -n "$version" ] || fail "found no Med release."
fi
version=${version#v}
name="med-v$version-macos-arm64"
target="$dir/med"
previous=$("$target" --version 2>/dev/null || true)

if [ "$previous" = "med $version" ] && [ "$force" = 0 ]; then
  say "Med $version is already installed at $target."
else
  base="$downloads/$repo/releases/download/med-v$version"
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/med-install.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' INT TERM
  say "Downloading Med $version…"
  curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" || fail "could not download $base/$name.tar.gz"
  curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || fail "could not download $base/SHA256SUMS"
  expected=$(awk -v file="$name.tar.gz" '$2 == file || $2 == "*" file { print $1 }' "$tmp/SHA256SUMS")
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $name.tar.gz."
  actual=$(shasum -a 256 "$tmp/$name.tar.gz" | awk '{ print $1 }')
  [ "$expected" = "$actual" ] || fail "the checksum of $name.tar.gz does not match SHA256SUMS. Nothing was installed."
  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  [ -f "$tmp/$name/med" ] || fail "the archive has no med executable."
  [ "$("$tmp/$name/med" --version 2>/dev/null || true)" = "med $version" ] ||
    fail "the downloaded executable did not report version $version."

  # Replace the executable in one step, so a running `med` keeps its own copy.
  mkdir -p "$dir"
  cp "$tmp/$name/med" "$dir/.med-install.$$"
  chmod 755 "$dir/.med-install.$$"
  mv -f "$dir/.med-install.$$" "$target"

  # Keep the license notices of Med and the runtime it includes with the install.
  share="${XDG_DATA_HOME:-$HOME/.local/share}/med"
  mkdir -p "$share"
  rm -rf "$share/licenses"
  cp -R "$tmp/$name/licenses" "$share/licenses"
  for file in LICENSE BUILD.json; do
    [ ! -f "$tmp/$name/$file" ] || cp "$tmp/$name/$file" "$share/$file"
  done
  say "Installed Med $version at $target."
  case "$previous" in
    "med "*) say "If Med is running, restart it to use this version: med stop && med web" ;;
  esac
fi

case ":$PATH:" in
  *":$dir:"*) ;;
  *)
    shown="$dir"
    case "$dir" in "$HOME"/*) shown="\$HOME${dir#"$HOME"}" ;; esac
    case "$(basename "${SHELL:-sh}")" in
      zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" line="export PATH=\"$shown:\$PATH\"" ;;
      bash) rc="$HOME/.bash_profile" line="export PATH=\"$shown:\$PATH\"" ;;
      fish) rc="$HOME/.config/fish/config.fish" line="fish_add_path \"$shown\"" ;;
      *) rc="$HOME/.profile" line="export PATH=\"$shown:\$PATH\"" ;;
    esac
    if [ "$modify_path" = 0 ]; then
      say "$dir is not on your PATH. Add it with: $line"
    elif grep -qsF "$line" "$rc"; then
      say "$rc adds $dir to PATH. Open a new terminal to use med."
    else
      mkdir -p "$(dirname "$rc")"
      printf '\n# Med\n%s\n' "$line" >>"$rc"
      say "Added $dir to PATH in $rc. Open a new terminal to use med."
    fi
    ;;
esac

say ""
say "Next:"
say "  med add /path/to/repository   Register a repository to review"
say "  med web                       Open Med in your browser"
say "  med skills install            Teach Claude Code and Codex to hand off reviews in Med"
