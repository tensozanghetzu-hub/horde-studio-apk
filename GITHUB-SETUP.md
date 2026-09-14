# GitHub update channel — status

Repo: **https://github.com/tensozanghetzu-hub/horde-studio-apk**

---

## ✅ Step 1 — Key added

`ssh -T git@github.com` answered *"Hi tensozanghetzu-hub! You've successfully
authenticated"*. The sandbox can push.

## ✅ Step 2 — Repo created and published

Public, branch `main`, three pushes landed. `docs/` holds the channel:

| File | Size | What it is |
|---|---|---|
| `version.json` | 417 B | what is current |
| `web.zip` | 133 KB | the bundle for an in-place update |
| `HordeStudio-latest.apk` | 223 KB | the APK, for when the wrapper changes |

Current channel state: **app 1.4.8, code 13, webRev `f8c44de4c6ef`, 18 files**.

## ✅ Step 3 — Pages is on

Checked and working: all four files serve 200, and the APK comes back with the
right MIME type (`application/vnd.android.package-archive`) so Android's
installer recognises it. The `web.zip` Pages serves is byte-identical to the one
we published.

Nothing left to set up.

---

## Do this now on your phone

Your report — *"could not check: the server did not answer with a version
file"* — turned out to be a bug in the app, not in GitHub. It is fixed in
**1.4.8**. See the last section for what was actually wrong.

1. **Settings → App updates → Check for update**
2. It should now answer, and offer two buttons:

| Button | What it does |
|---|---|
| **Install app update** | The real fix. Downloads 1.4.8 and opens Android's install screen → *More details → Install anyway*. |
| **Apply now** | The web bundle, ~133 KB, no reinstall. Optional. |

3. Tap **Install app update** — that is the one that matters
4. Open **About**: it must say **1.4.8**

If *Check for update* still refuses on your current build, skip it: open
<https://tensozanghetzu-hub.github.io/horde-studio-apk/> in your browser,
download `HordeStudio-latest.apk`, and install it. Same result, one warning
prompt.

---

## Do this on your phone — once, then never again

The APK you have installed still has the **old sandbox address** baked into it,
and that address is dead (it answers `403`). So the app cannot find the update
until you tell it where to look. One time only:

1. Open Horde Studio → **Settings** → **App updates**
2. In the **Update address** box, replace whatever is there with:

```
https://tensozanghetzu-hub.github.io/horde-studio-apk/
```

3. Tap **Check for update**
4. Tap **Apply now** — about 133 KB, no reinstall, chats untouched

After that the address is remembered, so every future update is just
*Check for update → Apply now*.

**The one thing worth checking afterwards:** open **About**. It must say
**1.4.7**. If it says `1.0.0`, the update did not take and I need to know.

<details>
<summary>Why the baked-in address died, and why this fixes it for good</summary>

Every time this workspace restarts it gets a new sandbox ID, and the address
baked into an APK points at the sandbox that was alive when it was built. That
is why you saw `502 sandbox was not found` last time — nothing was wrong with
the app, the address simply pointed at a sandbox that no longer existed.

A GitHub Pages address never moves. Once it is in the *Update address* box it
stays valid forever, and any APK built from now on has it baked in.
</details>

## The address to use on the phone

**Settings → App updates → Update address** →

```
https://tensozanghetzu-hub.github.io/horde-studio-apk/
```

**If Pages is ever unreachable**, the same files are also served with no
configuration at all from:

```
https://raw.githubusercontent.com/tensozanghetzu-hub/horde-studio-apk/main/docs/
```

Keep it as a spare address. It is why `apkUrl` in
`version.json` is a bare filename rather than a full URL — the app reads it
relative to the update address, so one channel works from Pages, from raw, from a
NAS or from a home server without being rewritten for each.

The address is already baked into the APK, so once you install
`HordeStudio-latest.apk` from the repo you do not need to type anything.

---

## Day to day

Every future change is one command, which I run at the end of the work:

```bash
bash /home/user/sync-github.sh "what changed"
```

That rebuilds `docs/`, commits, and pushes. Pages follows within a minute; you
press **Check for update**.

---

## What I had to fix along the way

A snapshot restore had reverted `MainActivity.java`, dropping four methods and
putting a hardcoded `1.0.0` back where the real version should be. The web files
were untouched, so it was invisible until I grepped the compiled dex rather than
the source — the third time this has happened. Consequences if it had shipped:

- **Apply from a file** would have thrown — the picker method was gone
- **Or in browser** would have thrown too
- **About** would have read `1.0.0` again

All three are restored and verified in the compiled dex, not just the source:
`pickUpdateZip`, `openDownload`, `installApk`, `applyWebUpdate`, `finishSwap`,
`revFromBundle`, `checkUpdate`, `clearWebUpdate`, `confirmUpdate`, `version`.

Tests: `node /home/user/tests/apkurl-test.js` — 9/9, covering the `/app` fallback,
an absolute `apkUrl`, a relative `apkUrl`, and that *Reset* really forgets the
address (it was leaving the cached copy behind, so a reset phone kept fetching
the old APK).
