# Moving to the re-signed app (v1.42.0)

Read this once before you touch anything on the phone. The order matters: one
step of it deletes your chats and characters, and the step before it is what
saves them.

## Why an uninstall is involved

v1.42.0 is the first build signed with a new key. Android accepts an update in
place only when the new APK is signed by the same key as the installed one, so
this release cannot be installed over an older Horde Studio — it has to be
installed fresh, and installing fresh means uninstalling first, and uninstalling
wipes the app's storage. Everything else about the app is unchanged.

If you just tap the new APK without uninstalling, Android says "app not
installed". That is the signature rule working, not a corrupt download.

## Step 0 — two files

1. **The new APK:** `HordeStudio-v1.42.0.apk` (from the build workspace, or from
   the GitHub release once it is published). Copy it to the phone's Downloads.
2. **The old APK**, so you can back out:
   `https://tensozanghetzu-hub.github.io/horde-studio-apk/HordeStudio-latest.apk`
   is v1.41.1 while the channel is unpushed. Keep a copy of the version you are
   actually running.

Then write down, or paste somewhere safe:

    the OpenRouter key you will re-enter in step 7

It is the one thing the backup deliberately does not carry.

## Step 1 — back up, from inside the old app

Settings → Data → **Backup**. A toast confirms *Saved to
Downloads/HordeStudio/horde-studio-backup-YYYY-MM-DD.json*.

That file lives in Downloads, not in the app, so it survives the uninstall. Open
the Files app and check it is really there and has a sensible size before
continuing. If you want a second safety net, mail it to yourself or copy it to a
computer — one line of JSON, a few MB at most.

What it holds: characters, chats and messages, personas, worlds, world runs, and
your settings. What it never holds, by design: `apiKey`, `hordeKey`,
`cloudflareWorkerToken`.

## Step 2 — uninstall

Uninstall Horde Studio. The old app's data goes with it. This is the point of no
return for anything not in the JSON from step 1.

## Step 3 — install

Open `HordeStudio-v1.42.0.apk` from Downloads and allow the install (Android
will ask you to permit "install unknown apps" for whichever app you opened it
from — once, per source). It installs as a new app.

## Step 4 — restore

Settings → Data → **Restore** → pick that JSON. The toast reports what came back:
*Restored N characters, M chats*.

Restore adds to whatever is in the app and keys entries by id, so running it
twice is harmless — but there is no undo, so if you restore and something looks
wrong, restore again rather than trying to fix it by hand.

Two known edges:

- A backup taken when the app had **no characters at all** cannot be restored —
  the importer rejects files with no `characters` array. Not your case if you
  have been using it.
- Restoring does not delete what the new install already has, so if you made a
  character before restoring, it stays alongside the restored ones.

## Step 5 — put the keys back

Settings → API keys: paste the OpenRouter key. Re-add a Horde key if you use
one (`https://hordeai.com/register` → 00000000000 is the anonymous one, so you
can test without it) and re-paste a worker token if you had
`cloudflareWorkerToken` set.

Nothing else needs reconfiguring: the update address, model choice, prompt
budgets and per-card settings all travelled in the backup.

## Step 6 — check it worked, before you rely on it

- Settings → About says **1.42.0**.
- The character count matches what you had.
- Open a long-running chat: scroll to its last message.
- Send one message and get one reply.
- Settings → App updates → Check for update should say up to date.

## From here on

In-place updates work again, for good: this install trusts the new key, and
every future build is signed with it. Interface fixes keep arriving without any
install at all, through the web overlay, which is why the wrapper rarely needs
touching. `apk-build/signing-identity.txt` records the fingerprint, and
`build.sh` refuses to sign a release with any other key — so a build can never
quietly leave the identity behind again.

## If something goes wrong

| Symptom | What it actually means |
|---|---|
| "App not installed" on tap | you did not uninstall the old one yet — the signature differs |
| Restore says "Not a Horde Studio backup" | wrong file, or a backup taken before step 1 |
| Chats missing after restore | the JSON you picked is an old one; look for the file dated today |
| The new app works but your old data is gone | you uninstalled before backing up. If an older backup JSON exists in Downloads, restore that; otherwise the data is unrecoverable — that is the whole reason step 1 is step 1 |
| You want to go back entirely | reinstall the old APK from step 0, restore the same JSON. The signature does not matter for a fresh install |
