**Read the first line before you install this one.**

v1.42.0 is signed with a new key. Android only installs an update in place when
the new APK carries the same signature as the app already installed, so **this
release will not install over an older Horde Studio** — it needs an uninstall,
and an uninstall erases the app's chats and characters unless you back them up
first.

To move over without losing anything:

1. In the old app: **Settings → Data → Backup**. It saves
   `Downloads/HordeStudio/horde-studio-backup-<date>.json`, which survives the
   uninstall.
2. Uninstall Horde Studio.
3. Install this APK.
4. **Settings → Data → Restore**, pick that file.
5. Re-enter your API keys. The backup never contains them, by design — they do
   not leave the device.

If you skip step 1 there is nothing to restore from, so do step 1 first.

Nothing about the interface changed since v1.41.1 — same app, same features, new
signing identity. The reason for the change: the previous keystore was committed
to this repository while it was public, so anyone who cloned it could sign an APK
that every installed copy would accept as an official update. That key is burned
and archived, and from this release `apk-build/signing-identity.txt` records the
fingerprint builds have to match.

- App version: 1.42.0 (code 195)
- Signed with certificate `a1b0e42310b63444…` (`keytool -list` form
  `A1:B0:E4:23:…`; verify any build of ours against it with
  `apksigner verify --print-certs`)
- Android 7.0 (API 24) and up

Once installed, updates arrive from inside the app again: Settings → App updates →
Check for update. Interface fixes apply without any reinstall, and future APKs
will install over this one normally.

Full walk-through, including how to back out: `MIGRATION-signing-key.md` in the
repo.
