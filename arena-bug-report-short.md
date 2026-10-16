Title: Agent Mode: snapshot restore rolls .git back to a stale state while the worktree stays current (9 repros)

Summary: When the Agent Mode sandbox is rebuilt from a turn-end snapshot, the worktree is restored current, but git is restored to an old complete capture. Every time (9 events, 4 in one session day): HEAD and origin/main rewind to the SAME stale commit (b22b121, ~5 days old); every commit made after it is missing from the object database (git cat-file -t fails, so not refs-only); .git/config is emptied (remote and identity gone); one known file (MainActivity.java) comes back in an old partial state. Worktree files, including new untracked ones, are always current. The failure is silent until the next git command.

Evidence: git count-objects showed 1166 loose objects (30.6 MB) before I packed them - a small-file cloud under the documented ~128 MB / 10,000-file best-effort snapshot cap. .git/config is on the documented credential exclusion list, explaining the silent remote/identity loss. After each loss, fetch + reset --mixed origin/main recovered HEAD and refs; the worktree diff against origin/main was exactly the unpushed work - proof only .git was rolled back. Anything pushed was never lost.

Repro: in an Agent Mode session with a git repo, commit without pushing, cross a turn boundary, then git log: HEAD rewound, recent objects missing, git remote -v empty, worktree current. 4/4 within one day.

Expected: capture .git atomically with an integrity check on restore (git fsck), falling back to the previous COMPLETE .git or none - never a partial merge with a current worktree. A restore diagnostic ("N recovered, M skipped (cap)") would make partial restores visible immediately.

Workaround in place (not blocking): git gc after every push (single pack file), commit and push in the same turn, plus an idempotent one-command recovery script. Risk: if capture priority ever changes, the same partial-restore mechanism could hit the worktree too.
