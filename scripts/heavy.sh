#!/bin/sh
# Runs a heavy command (Playwright, a full vitest run, a build) in one of
# HEAVY_SLOTS (2) slots shared by every worktree on this machine. It waits up
# to HEAVY_WAIT (300) seconds for a slot, then fails with exit code 75.
#
#   sh scripts/heavy.sh bunx playwright test library.spec.ts
#
# A slot is a symlink whose target names its holder: a PID and that process's
# start time. The command replaces this shell (exec), so its slot is free as
# soon as its process ends, however it ends. A waiter takes over a slot whose
# holder is gone. A command inside a slot (HEAVY_SLOT is set) does not take a
# second one, and CI runs without slots.
[ -n "$CI$HEAVY_SLOT" ] && exec "$@"
[ $# -gt 0 ] || { echo "usage: heavy.sh <command> [args...]" >&2; exit 64; }

dir=${HEAVY_DIR:-/tmp/workbench-heavy}
slots=${HEAVY_SLOTS:-2}
limit=${HEAVY_WAIT:-300}
mkdir -p "$dir" && [ -w "$dir" ] || { echo "heavy: cannot write $dir" >&2; exit 1; }
started() { ps -o lstart= -p "$1" 2>/dev/null; }
# Prints the PID that holds a slot, if that process still runs.
holder() {
  owner=$(readlink "$1" 2>/dev/null) || return 1
  [ "$(started "${owner%% *}")" = "${owner#* }" ] && echo "${owner%% *}"
}
me="$$ $(started $$)"
begin=$(date +%s)
report=0

while :; do
  n=1
  while [ "$n" -le "$slots" ]; do
    slot="$dir/slot-$n"
    if ln -s "$me" "$slot" 2>/dev/null; then
      export HEAVY_SLOT=$n
      exec "$@"
    fi
    if ! holder "$slot" >/dev/null; then
      # Free a slot whose holder is gone, unless a waiter has just taken it,
      # and try it again.
      [ -n "$owner" ] && [ "$(readlink "$slot" 2>/dev/null)" = "$owner" ] &&
        rm -f "$slot"
      continue
    fi
    n=$((n + 1))
  done
  waited=$(($(date +%s) - begin))
  if [ "$waited" -ge "$report" ]; then
    running=""
    for slot in "$dir"/slot-*; do
      pid=$(holder "$slot") &&
        running="$running
  $pid $(ps -o command= -p "$pid" | cut -c1-100)"
    done
    [ "$waited" -ge "$limit" ] && {
      echo "heavy: no free slot after ${limit}s. Running:$running" >&2
      exit 75
    }
    echo "heavy: waiting for one of $slots slots (${waited}s of ${limit}s). Running:$running" >&2
    report=$((waited + 30))
    [ "$report" -gt "$limit" ] && report=$limit
  fi
  sleep 1
done
