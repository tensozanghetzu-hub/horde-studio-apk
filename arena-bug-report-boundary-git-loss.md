# Bug report: Agent Mode workspace snapshots restore .git to a stale state while the worktree stays current

**Product:** Arena Agent Mode — sandboxed workspace (working directory /home/user)
**Reported:** 2026-10-16
**Frequency:** 9 confirmed occurrences on one account, 4 of them within a single session day (2026-10-16)
**Severity:** High for any git-based workflow. Data loss is recoverable only because the worktree happens to survive; the failure is silent until the next git command.

## Summary

When the sandbox is rebuilt from a turn-end snapshot, the working tree is restored current, but the git repository is restored to an old, previously captured complete state. Concretely: HEAD and refs/remotes/origin/main rewind to a stale commit, every commit made after that state is missing from the object database (not just the refs), .git/config is emptied of the remote and the local identity, and one known file (apk-build/src/com/hordestudio/mobile/MainActivity.java) comes back in an old partial state. Everything in the worktree — including untracked files created in the lost turns — is present and current. The result is a repository whose files and history contradict each other, discovered only when a git command is run.

## The fingerprint (identical in all 9 occurrences)

1. git rev-parse HEAD and the local origin/main ref both point at the same stale commit every time. On this account it is always b22b121 ("workspace cleanup", the v1.28.1 era), roughly five days older than the work it interrupted.
2. git cat-file -t fails for every commit created after that state — the objects are missing from the object database, so this is not a refs-only problem.
3. git remote -v is empty and git config user.name / user.email are empty — the contents of .git/config are gone.
4. apk-build/src/com/hordestudio/mobile/MainActivity.java is restored in an old partial state — older than both HEAD and the rest of the worktree (a known recurring victim, previously documented in the workspace's own NOTES.md).
5. All background processes are dead; tests/node_modules and ~/.cache/ms-playwright (the Playwright browser binary) are wiped; the Android SDK directory (apk-build/android-sdk, hundreds of MB, thousands of files) is wiped.
6. The worktree under /home/user is fully current, including brand-new files created during the lost turns.
7. Nothing that had been pushed to the GitHub remote is ever lost — the remote always contains the real tip, and git fetch recovers all published history.

## Evidence gathered inside the workspace (2026-10-16, before mitigation)

- git count-objects -vH reported: count: 1166 (loose objects), size: 30.59 MiB, in-pack: 145 objects in one 1.27 MiB pack. Total .git size: 33 MB. So the object database was a cloud of 1,166 individual loose object files.
- The workspace snapshot is documented as best-effort, capped around 128 MB or 10,000 files, and excludes generated dependency and cache directories (node_modules, .cache, build directories) plus sensitive credential paths — .git/config is explicitly on that credential exclusion list.
- The same day, four consecutive boundaries produced the identical fingerprint above, each about one to three hours apart, with normal agent work (commits, pushes, file edits, test runs) in between.
- After each loss, git fetch + git reset --mixed origin/main restored HEAD and refs; the worktree diff against the recovered origin/main matched exactly the uncommitted-plus-unpushed work — proof that the worktree was never stale and only the .git state was rolled back.

## Diagnosis (confirmed vs. inferred)

Confirmed from documented behavior:

- .git/config is on the snapshot's sensitive-path exclusion list. That fully explains symptom 3 (remote and identity gone) and is probably intentional and correct.
- node_modules, .cache, and the SDK are excluded or wiped; background processes do not survive. That explains symptom 5.
- The worktree is the primary snapshot payload and is captured completely. That explains symptom 6.

Inferred, with strong evidence from the fingerprint:

- The snapshot's .git capture is partial. A 1,166-file loose-object cloud (30.6 MB) under a best-effort 10,000-file / 128 MB cap — shared with the repo worktree, docs, test suites, and other trees — is a prime target for file-count truncation.
- On restore, the system falls back to the most recent snapshot state in which .git was captured completely (on this account, the b22b121 era), and merges that stale .git with the current worktree. The identical stale target in all 9 events supports "last complete capture" rather than random corruption.
- The stale partial MainActivity.java suggests the same per-file partial-restore applies inside the worktree for specific files, so the .git merge is not the only place a partial restore shows up — but it is the only place it breaks invariants.

## Reproduction (as deterministic as a sandbox boundary allows)

1. In an Agent Mode session with a git repository in the workspace, commit new work but do not push it (the normal mid-task state).
2. Make further worktree changes, then cross a turn boundary (sandbox restart or rebuild between turns).
3. On the next turn, run git status or git log: HEAD has rewound to the stale commit, recent objects are missing (git cat-file -t fails), git remote -v is empty, and the worktree is current.
4. On this account the pattern reproduced 4 out of 4 within one day, and 9 times total across recent sessions.

## Expected behavior

One of these, consistently:

1. The snapshot captures .git atomically and completely (pack file plus refs treated as one logical unit), with an integrity check (git fsck) on restore, and a clean fallback to the previous complete .git — never a partial merge.
2. .git is excluded from snapshots entirely, and restores are a clean no-git worktree that the client re-initializes deliberately.
3. The platform exposes the "last complete snapshot state" so clients can detect and recover deterministically.

The current mixed state (current worktree + stale partial git) is the worst of the options because it fails silently: nothing errors at restore time, and the contradiction is only visible when git is next used.

## Suggested fixes

1. Treat .git as a first-class snapshot target: capture it last, verify it on restore, and on verification failure restore the previous complete .git or none — never a partial merge with a current worktree.
2. Keep the documented .git/config credential exclusion, but either restore a documented placeholder or document that clients must re-provision identity and remotes. The loss is currently silent.
3. Reconsider the cap's accounting: large generated trees (an Android SDK is hundreds of MB and thousands of files) crowd small critical trees (.git/objects) out of the 10,000-file / 128 MB budget. Per-directory caps or generated-tree exclusion from the accounting would protect small critical files.
4. Surface a restore diagnostic in the session, e.g. "snapshot restore: N files recovered, M skipped (cap)" — so users can detect partial restores immediately instead of at the next git command.

## The four events of 2026-10-16 (timeline, one session day)

Each event below is a boundary crossed during normal agent work (commits, pushes, file edits, test suites). In every case the recovery was: restore git identity and remote, fetch, reset to origin/main, restore the victim file, and re-run verification.

1. **Morning, before first push of the day.** State rolled back to b22b121; two local commits (a data-integrity fix and its channel build, ~900 lines changed) missing from the object database; remote and identity gone; MainActivity.java in a partial state from the v1.28.1 era; tests/node_modules and the Playwright browser wiped. Worktree fully current. Recovery: re-committed both commits from the intact worktree, pushed, verified the release and update channel went live.
2. **Midday, just before the second push.** Identical fingerprint. Two more local commits (a feature plus channel) lost. Recovery as above; push succeeded on the first attempt after restore.
3. **Afternoon, mid-publish.** Rolled back again between the commit and the push of a third feature. This time the git remote survived the restore (only the object DB and refs regressed), which shortened recovery to fetch + reset + re-commit + push.
4. **Evening, before a fourth push.** Full fingerprint again (remote gone, objects gone, identity gone, victim file stale). Same recovery. Note: each of the four pushes had already been preceded by a full test battery (43 suites, 1,300+ assertions) run in the same session, so the lost commits were fully verified work — only the git record of them was eaten.

Across all four: zero worktree loss, zero published-state loss (everything pushed was intact on GitHub), and four manual forensics-and-recovery cycles of roughly ten minutes each, plus repeated re-warm of excluded dependencies (npm modules, browser binary, and once the apt-level browser libraries).

## Representative raw output (event 1)

Before recovery:

    $ git log --oneline -3
    b22b121 workspace cleanup: drop the theme preview page   <- stale, 5 days old
    156b32c v1.28.1: channel rebuild - ledger hygiene
    f68796c v1.28.1: ledger hygiene
    $ git cat-file -t 91748b3        # commit created earlier today
    fatal: Not a valid object name 91748b3
    $ git remote -v                  # (empty)
    $ git config user.name           # (empty)
    $ git status --short | head
     M NOTES.md
     M horde-studio-mobile/js/app.js
     ... (current work present)

After `git fetch && git reset --mixed origin/main`:

    $ git diff origin/main --stat     # exactly the unpushed work, nothing else
    21 files changed, 927 insertions(+), 210 deletions(-)

## Why it matters

Any agent workflow that accumulates unpushed commits — the normal state mid-task — silently loses its local history at random boundaries. Recovery is possible only because the worktree happens to be the surviving payload: unpushed commits must be reconstructed by re-committing the surviving files. If capture priority ever changes, the same partial-restore mechanism could damage the worktree too. The mixed state also defeats any client-side integrity check that assumes worktree and git agree, and it converts a platform restore into a forensic recovery for the user (identifying the stale target, re-adding the remote, resetting, restoring victim files, re-warming excluded dependencies).

## Workaround already in place (so this is not blocking)

- git gc after every push, so the object database is a single small pack file instead of a loose-object cloud (run automatically by a repo-local tools/git-doctor.sh, which packs whenever loose objects exceed 200).
- Commit and push in the same turn, so the GitHub remote is always the durable source of truth; unpushed commits are the only thing a boundary can eat.
- An idempotent one-command recovery (tools/git-doctor.sh): key permissions, identity, remote, fetch, reset-to-origin only when strictly behind, victim-file check with explicit opt-in restore, and gc. It turns the ten-minute recovery into one command and is a no-op on a healthy repo.
- Re-warm excluded dependencies on demand (npm install plus Playwright browser install; in one observed case even the apt-level browser libraries were gone, requiring a full dependency reinstall).

## Account and session context

Single user account, single project (a private Android APK repository with a GitHub Pages update channel, roughly 60 published commits, 33 MB .git). All 9 events occurred in Agent Mode sessions on that workspace. No credentials or private content are included in this report; the stale-commit identifier and file paths are given because they are the diagnostic fingerprint. Happy to provide a minimal reproduction repository, raw git output transcripts from each event, or snapshot diagnostics on request.
