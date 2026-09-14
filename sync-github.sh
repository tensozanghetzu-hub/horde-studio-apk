#!/usr/bin/env bash
# Publish this workspace to GitHub.
#
#   bash /home/user/sync-github.sh "what changed"
#
# It rebuilds docs/ (the update channel) from horde-studio-mobile/, commits
# the project, and pushes. GitHub Pages then republishes docs/ within a
# minute or so, and "Check for update" on the phone picks it up.
#
# The update address is not typed anywhere: build-channel.py derives it from
# the git remote, so once the remote is set the channel cannot drift from it.
set -euo pipefail

ROOT=/home/user
KEY="$HOME/.ssh/id_ed25519"
cd "$ROOT"

MSG="${1:-Update $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

# 1. rebuild the channel
python3 tools/build-channel.py
echo

# 2. first run: make the repo
if [ ! -d .git ]; then
  git init -q
  git branch -M main
  git config user.name  "Horde Studio"
  git config user.email "hordestudio@users.noreply.github.com"
fi

# 3. stage explicitly. Never `git add -A`: this workspace also holds the push
#    key, a browser cache and the Playwright vendor bundle.
git add .gitignore README.md NOTES.md GITHUB-SETUP.md sync-github.sh 2>/dev/null || true
git add tools apk-build apk-download horde-studio-mobile tests 2>/dev/null || true
git add docs 2>/dev/null || true

# 4. refuse to publish anything that looks like a key, a cache or a photo
BAD="$(git diff --cached --name-only | grep -E \
  '(^|/)\.ssh/|id_ed25519|id_rsa|\.pem$|\.key$|\.netrc|git-credentials|/\.cache/|/node_modules/|/vendor/|/uploads/|android-sdk|/\.local/' \
  || true)"
if [ -n "$BAD" ]; then
  echo "refusing to commit these:"
  echo "$BAD" | sed 's/^/  /'
  git reset -q
  exit 1
fi

if git diff --cached --quiet; then
  echo "nothing has changed since the last commit"
else
  git commit -q -m "$MSG"
  echo "committed: $MSG"
fi

# 5. push over SSH with the key generated in this sandbox
if ! git remote get-url origin >/dev/null 2>&1; then
  echo
  echo "no remote yet. Once the empty repo exists on GitHub:"
  echo "  git remote add origin git@github.com:YOUR-USER/YOUR-REPO.git"
  exit 1
fi

chmod 700 "$HOME/.ssh" 2>/dev/null || true
chmod 600 "$KEY" 2>/dev/null || true
export GIT_SSH_COMMAND="ssh -i $KEY -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes"
git push -u origin main
echo
echo "pushed. Pages republishes docs/ from the commit above."
