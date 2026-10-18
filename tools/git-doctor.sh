#!/usr/bin/env bash
# git-doctor — idempotent recovery from turn-boundary snapshot loss.
#
# What a boundary loss looks like (observed 9x as of 2026-10-16): the
# WORKTREE is current, but git is rolled back to a stale complete state —
# HEAD/refs rewound (here always to b22b121, the v1.28.1 era), the object
# DB missing the newest commits, the remote and identity gone (.git/config
# is on the snapshot's exclusion list), and known victim files
# (MainActivity.java) restored in an old partial state. Everything that was
# PUSHED to origin survives on GitHub. Nothing in the worktree is ever at
# risk: this script rewrites worktree files only with --fix, and only the
# known victims.
#
# Usage:
#   bash tools/git-doctor.sh          # check + repair the safe parts
#   bash tools/git-doctor.sh --fix    # also restore the known victim files
#
# Run it at the start of any turn that touches git, and after every
# suspected boundary loss. On a healthy repo it is a no-op (plus a gc).
set -u
cd "$(dirname "$0")/.."

FIX=0
[ "${1:-}" = "--fix" ] && FIX=1
REMOTE_URL="git@github.com:tensozanghetzu-hub/horde-studio-apk.git"

[ -f ~/.ssh/id_ed25519 ] && chmod 600 ~/.ssh/id_ed25519
git config user.name "Horde Studio" >/dev/null
git config user.email "hordestudio@users.noreply.github.com" >/dev/null
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REMOTE_URL"

if git fetch origin --tags --quiet 2>/dev/null; then
  echo "doctor: fetch OK"
else
  echo "doctor: FETCH FAILED - cannot verify against origin. Check the key and the remote."
  exit 1
fi

local_head=$(git rev-parse HEAD 2>/dev/null)
remote_head=$(git rev-parse origin/main 2>/dev/null)
if [ "$local_head" = "$remote_head" ]; then
  echo "doctor: HEAD matches origin/main ($(echo "$local_head" | cut -c1-7))"
elif git merge-base --is-ancestor "$local_head" "$remote_head" 2>/dev/null; then
  echo "doctor: local is BEHIND origin/main - the snapshot rolled it back."
  echo "doctor: resetting to origin/main (worktree files are kept; uncommitted work survives)."
  git reset --mixed origin/main
else
  echo "doctor: local and origin have DIVERGED - inspect manually:"
  echo "        git log --oneline --all --graph | head"
fi

# Known boundary-loss victims: files the snapshot restores in a stale
# partial state even when the rest of the worktree is current.
VICTIMS="apk-build/src/com/hordestudio/mobile/MainActivity.java"
for f in $VICTIMS; do
  if [ -f "$f" ] && ! git diff --quiet -- "$f" 2>/dev/null; then
    if [ "$FIX" -eq 1 ]; then
      git checkout -- "$f"
      echo "doctor: restored stale $f (any deliberate uncommitted change to it was discarded)"
    else
      echo "doctor: WARNING: $f differs from origin/main (known boundary-loss victim)."
      echo "doctor: rerun with --fix to restore it - unless the change is deliberate."
    fi
  fi
done

# Keep the object DB snapshot-compact. A cloud of loose objects (thousands
# of tiny files) is exactly what the best-effort 10k-file snapshot drops;
# a single pack file survives. git's own auto-gc threshold is 60k loose
# objects - far too late for this.
loose=$(git count-objects -v | awk '/^count: /{print $2}')
if [ "${loose:-0}" -gt 200 ]; then
  git gc -q
  echo "doctor: packed $loose loose objects into a single pack"
fi

echo "doctor: OK - HEAD $(git rev-parse --short HEAD), $(git count-objects -v | awk '/^count: /{print $2}') loose object(s), $(git status --porcelain | wc -l | tr -d ' ') changed path(s)"
