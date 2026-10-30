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

# 2. make the repo if needed. The identity and the remote are re-asserted on
#    EVERY run, not just the first: .git/config is excluded from workspace
#    snapshots, so both silently vanish whenever the sandbox is restored and
#    the push would otherwise fail with "Author identity unknown" or "no remote".
if [ ! -d .git ]; then
  git init -q
  git branch -M main
fi
git config user.name  "Horde Studio"
git config user.email "hordestudio@users.noreply.github.com"
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "${ORIGIN:-git@github.com:tensozanghetzu-hub/horde-studio-apk.git}"
fi

# 3. stage explicitly. Never `git add -A`: this workspace also holds the push
#    key, a browser cache and the Playwright vendor bundle.
git add .gitignore README.md NOTES.md GITHUB-SETUP.md sync-github.sh 2>/dev/null || true
git add tools apk-build horde-studio-mobile tests .github 2>/dev/null || true
git add docs 2>/dev/null || true

# Character cards are private workspace artifacts, not product source. Keep
# them under /character-cards/ (gitignored) and hard-stop if a V2/V3 card or
# PNG-embedded card is ever staged from anywhere else by mistake.
CARD_BAD="$(python3 - <<'PY'
import json, os, subprocess
bad = []
paths = subprocess.check_output(['git', 'diff', '--cached', '--diff-filter=ACMR', '--name-only', '-z']).decode().split('\0')
for path in filter(None, paths):
    low = path.lower()
    if low.startswith('character-cards/') or low.endswith(('.card.json', '.card.png')):
        bad.append(path); continue
    try:
        raw = open(path, 'rb').read()
    except OSError:
        continue
    is_card = False
    if low.endswith('.json'):
        try:
            obj = json.loads(raw.decode('utf-8'))
            is_card = obj.get('spec') in ('chara_card_v2', 'chara_card_v3')
            if not is_card and isinstance(obj.get('data'), dict):
                d = obj['data']
                is_card = ('first_mes' in d and 'mes_example' in d and
                           ('description' in d or 'personality' in d))
        except Exception:
            pass
    elif low.endswith('.png'):
        is_card = b'ccv3\0' in raw or b'chara_card_v2' in raw or b'chara_card_v3' in raw
    if is_card: bad.append(path)
print('\n'.join(bad))
PY
)"
if [ -n "$CARD_BAD" ]; then
  echo "refusing to publish character-card files; they must stay in /character-cards/:"
  echo "$CARD_BAD" | sed 's/^/  /'
  git reset -q
  exit 1
fi

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
# A sandbox restore rewinds .git refs to snapshot time while the remote has
# since moved on — every push would be rejected. Rebase over the remote and,
# when a file conflicts, the workspace tree is the newest complete state:
# resolve with the local side wholesale.
git fetch origin -q
if ! git pull -q --rebase origin main >/dev/null 2>&1; then
  git diff --name-only --diff-filter=U | while read -r f; do
    git checkout --theirs -- "$f" && git add -- "$f"
  done
  git -c core.editor=true rebase --continue
fi

git push -u origin main
echo
echo "pushed. Pages republishes docs/ from the commit above."
