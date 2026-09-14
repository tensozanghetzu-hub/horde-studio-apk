# Horde Studio — Mobile (Android) · v1.4.8

A phone-native build of the Horde Studio idea: a local-first AI roleplay studio with
characters, persistent chats, story memory, lorebooks and AI-generated images —
rewritten from the ground up for a 6-inch screen and packaged as an installable APK.

## Download

**The APK lives in `docs/`**, not in the top-level listing — which is easy to miss
when you open the repo:

**Releases → [Horde Studio v1.4.8](https://github.com/tensozanghetzu-hub/horde-studio-apk/releases/latest)**
— 223 KB, Android 7.0 (API 24) and up. This is the one to use: it shows in the
**Releases** box on the repo's front page, so nobody has to go looking.

Tap this on your phone and it downloads without any further clicking:

```
https://github.com/tensozanghetzu-hub/horde-studio-apk/releases/latest/download/HordeStudio-latest.apk
```

That URL never changes — it follows whatever release is newest. (The release also
carries a copy named `HordeStudio-v1.4.8.apk`, so you can tell which version you
have after downloading.)

The app's own updater does **not** use releases. It reads the channel in `docs/`,
which is what GitHub Pages serves, because that is how it can check for updates
quietly. Releases are for people; `docs/` is for the app.

Then tap the download and install. Same signing key as before, so installing over
an earlier version keeps your characters and chats.

**What you got**

| Path | What it is |
|---|---|
| `docs/HordeStudio-latest.apk` | The Android app. Signed, ~223 KB, Android 7.0 (API 24) and up. |
| `horde-studio-mobile/` | The full web/PWA source that the APK wraps (also hostable anywhere). |
| `apk-build/` | Android wrapper source + `build.sh` / `setup-sdk.sh` to rebuild the APK. |
| Live preview | [The same app running as a website](https://tensozanghetzu-hub.github.io/horde-studio-apk/) — try it in your browser before installing. |

> **v1.4.4 updates itself from inside the app.** Settings → App updates → Check for
> update. Fixes to the interface download as a small bundle and are applied without a
> reinstall — no Play Store, no install prompt. See [Updating the app](#updating-the-app).

> **v1.4.3 keeps long lines inside the bubble.** When a model answers with a fenced block
> — a status panel, a stat readout, a stanza — that text used to run off the right edge of
> the screen and get cut off mid-word. Code and preformatted blocks now wrap like any
> other text, and every screen was checked at 320, 360 and 412 px.

> **v1.4.2 keeps the model's thinking out of the chat.** Some models plan out loud —
> question headers, notes to self, “the prompt says…” — and used to answer with that
> planning instead of the scene. Recognisable reasoning is now stripped before a reply
> is shown. Settings → Generation → **Strip the model's thinking** (on by default). See
> [When a model thinks out loud](#when-a-model-thinks-out-loud).

> **v1.4.1 fixes “Error: The Horde returned no text (job empty)”.** Some workers answer a
> job with nothing in it — about one in four on the public cluster — and the app used to
> give up immediately. It now asks a different worker, up to 5 times inside a 45-second
> budget, and tells you what it's doing. See [Empty replies](#empty-replies-job-empty).

> **v1.4.0 brings Virtual Humans 2.0 from Horde Studio 18.** A life is no longer just a
> clock and a mood: each one has places they go (with journeys that take real time),
> needs that build up, other people, a diary, and a relationship with you that is kept
> separate from anyone else's. Replies can arrive as separate texts, like messaging a
> real person, and autonomous messages are capped per day so they can't eat your kudos.
> See [Virtual Humans 2.0](#virtual-humans-20).

> **v1.3.0 fixes replies that stop mid-sentence on the Horde.** Replies now end where a
> character's turn ends (stop sequences), the model can't write your lines for you, and
> if a reply is still cut off by the token limit the app quietly asks for the rest and
> stitches it back together. See [Cut-off replies](#cut-off-replies).

> **v1.2.0 adds Virtual Humans** — characters with their own clock, routine, mood and
> relationship state, who sleep instead of answering, and who message you first.
> See [Virtual humans](#virtual-humans).

> **v1.1.0 fixes the “hangs on AI Horde” problem.** Jobs now show live queue position,
> ETA and an elapsed clock, Cancel works, nothing waits on a request that isn't
> answering, and picking a model with no workers online is refused up front instead of
> queuing forever. Details in [Why it hung](#why-it-hung-and-what-changed).

---

## Install on your phone

1. Download the APK — from [`docs/HordeStudio-latest.apk`](https://github.com/tensozanghetzu-hub/horde-studio-apk/blob/main/docs/HordeStudio-latest.apk) in this repo,
   or open `https://tensozanghetzu-hub.github.io/horde-studio-apk/HordeStudio-latest.apk` on your phone.
2. Open it. Android will say **“Install unknown apps” / “Allow from this source”** —
   grant it for the app you downloaded with (Chrome / Files).
3. Tap **Install**. Play Protect may warn that the app is unverified — that’s expected
   for any self-signed APK that isn’t on the Play Store. Choose **Install anyway**.
4. Open **Horde Studio** from your home screen.
5. If you already installed an earlier version, just install this over the top — same
   signing key, higher version, your characters and chats survive.

No account, no signup, no data leaves your phone except the model calls you configure.

<details>
<summary>Installing from a computer instead (adb)</summary>

```bash
adb install -r HordeStudio-latest.apk
```
</details>

---

## First run: pick a brain

Open **Settings → Connection → Provider**:

| Provider | Cost | Notes |
|---|---|---|
| **AI Horde** | Free, no key | Crowdsourced volunteer GPUs. Works out of the box. Queue-based — see below. |
| **OpenRouter** | Paid, one key | Hundreds of models, fastest and best quality. Recommended. |
| **OpenAI / Together / NVIDIA NIM / NanoGPT** | Paid | Their own keys. |
| **Ollama / LM Studio / KoboldCpp** | Free, local | Point at your PC’s LAN IP (`http://192.168.1.50:11434/v1`). Phone must be on the same Wi-Fi; cleartext is enabled for this. |

Then **Model → tap → choose**, hit **Test connection**, and go build a character.

---

## If the Horde is slow (read this before assuming it's broken)

The AI Horde is **a queue, not an API**. You are sharing volunteer GPUs with everyone
else on the internet, and cluster load swings a lot — measured during development:
69 text workers / 44 jobs queued one minute, 341 image workers / 361 jobs the next.
A job that takes 8 seconds at 5am can take 3 minutes at 8pm.

v1.1.0 makes that visible and survivable:

- **Live status bar** — “Queued on the Horde · position 5 (42s · ~30s left)” ticks every
  second while you wait. You always know it's alive.
- **Cancel** — a button in that bar, plus the stop button, actually aborts the job
  (it aborts the network call and stops polling immediately).
- **Nothing waits forever** — every request has a 30–40 s response ceiling, so a stalled
  connection reports “network stall / retrying” instead of sitting silent.
- **Give up after** — Settings → AI Horde → 2–20 minutes (default 10). On timeout you get
  “Still queued after N minutes” with advice, not a dead spinner.
- **Rate limits** — the Horde allows ~2 submits and ~10 status calls per window.
  Hit one and the app pauses and retries automatically instead of erroring out.
- **Offline models are refused** — the model picker shows “N workers · ETA Xs · N jobs
  queued”, and if you pick one with zero workers the app tells you instead of queuing forever.

**To make Horde fast:**
- Set both the text and image model to **“Any available (fastest)”** — no model filter means
  whichever worker is free grabs your job. This is the single biggest speed win.
- Use **512–640 px** images at **16–20 steps** (kudos cost and queue time both scale up fast).
- Add a free API key from **aihorde.net** — it jumps the queue. Test connection shows
  your kudos balance and how many workers are online right now.

---

## Virtual humans

A character answers when you poke it. A **virtual human** has somewhere else to be.
Turn any character into one (Cast → tap the card → **Make a virtual human**, or open the
**Now** tab) and they get:

- **A clock and a routine** — you write what they're doing and when ("07:00 waking up,
  coffee, opening the shutters", "18:00 lighting the lamp at dusk"). That drives their
  status ("Asleep · back around 07:00"), what they talk about, and what they send photos of.
- **Hours where they simply don't answer.** Message them at 2am and you get
  *“Sera is asleep — she will answer around 07:00”*. The message waits; the reply lands
  when they wake, and they react to the delay in character. Even awake, they take a
  beat to answer — 15 s to a few minutes, longer if the relationship is cold.
- **A mood and a relationship that move on their own.** Mood drifts back toward neutral
  (~2% per hour, so a night apart doesn't wipe it), tension cools, warmth grows when you
  talk and cools during long silences. Prompted exchanges nudge it further. Watch it on
  the **Now** tab as three meters; drag the sliders in their settings to steer it.
- **They message you first.** Set how often — Never / Rarely (~20h) / Sometimes (~6h) /
  Often (~2h). When enough real time has passed and they're awake, they send a short
  unprompted line… or, about one time in five, a photo of what they're doing.
- **A chronicle** of the day's beats, so they remember they were on shift all night.
- **Forked timelines.** Chat menu → **Fork an alternate timeline** copies the whole
  conversation into a branch, so you can take the story somewhere else and keep the
  original intact.

**How the clock works on a phone:** Android gives a WebView no reliable background
timers, so instead of pretending to run while closed, the engine does **catch-up** —
whenever you open the app (and every minute while it's in front of you) it advances every
human by however much real time actually passed, delivers any reply that came due, and
lets someone reach out if they've been waiting long enough. Close the app for six hours,
come back, and there may be a message waiting.

**The honest limitation:** because of that, there are no true push notifications
(you won't get a system notification while the app is closed — that would need a native
background service). Everything lands when you open the app. The **Nudge** button on the
Now tab makes someone speak immediately if you don't want to wait.

## Virtual Humans 2.0

Ported from Horde Studio 18. Everything is simulated on the phone by catch-up: when you
open the app it advances each life by the real time that passed. Nothing simulates while
the app is closed.

**Places and journeys.** Give a life its places — home, work, the harbour café — and
they move between them. A journey takes 10–45 minutes, they're "on the way to X" the
whole time, and that's why they took so long to answer. They head out on their own, and
they leave early enough to make an appointment in their diary.

**Needs.** Energy, hunger, company and comfort drift with the time of day: energy drains
while they're awake and returns while they sleep, hunger builds and drops at mealtimes,
company builds while you're not talking and drops when you are. Low energy slows their
replies and sours their mood. All four are visible as meters.

**Other people.** A supporting cast — colleagues, neighbours, family — each with a
relation and a closeness. They show up in the prompt, so the character has something to
talk about besides you.

**A diary.** Recurring commitments ("shift at the harbour, 08:00"), optional day of the
week and place. They travel to these, and what's coming up is in their context.

**One life, distinct relationships.** Switch your persona and you get a different
relationship history with the same person — affinity, trust, tension and exchange count
are stored per persona. Her memories of you aren't her memories of someone else.

**The Life screen.** Replaces "Now": where they are, needs, the bond with you, their
people, today's diary, and the autonomy controls.

**A feed.** Everything they send on their own — messages and photos — is also a post in
their feed, with the place they sent it from. Reach it from the Life screen.

**Autonomy you control.** Four permissions (messages, photos, posts, going out) and a
**daily budget, 12 by default**, for autonomous generations. Your replies and manual
nudges are always free. When the budget is gone they stop messaging on their own until
tomorrow, and it's shown on their card.

**Portable lives.** Export a **clean template** (the person, their places, people and
diary — no conversations, no memories of you) or a **full portable human** including the
chats. Import gives you an isolated copy: fresh ids, nothing overwritten, no queued jobs
from the file. Files are JSON (`horde.human/1`) rather than upstream's ZIP — no zip
library on the device, and one file is easier to move off a phone.

**Replies as separate texts.** When a reply reads like several short messages, it
arrives as separate bubbles a few seconds apart. Structure comes first (lines the model
wrote separately), with a conservative sentence-level fallback for models that write a
burst as one run-on line. Prose, paragraphs, markdown and anything over 220 characters
are never split.

**What didn't come across:** video clips (needs a paid video provider), the multiplayer
relay and MCP (need a host machine), and map/live feeds. Upstream also needs Python and
Node running for background life; this build has no background service at all, so life
only advances while the app is open — the same catch-up model as v1.2, just deeper.

## Empty replies (“job empty”)

You'll see this as `Error: The Horde returned no text (job empty)`. It is not your
prompt, your settings, or your connection: **some Horde workers answer a job with
nothing in it.** Measured on the public cluster while fixing this, 12 of 24 identical
requests came back blank — and most of those failed within 0.4–4 seconds, i.e. the
worker turned straight around and returned an empty generation.

Since it's a property of the worker and not of the request, the fix is to ask a
different one. The app now resubmits the job:

- up to **5 attempts**, inside a **45-second budget**, so a worker that hangs can't turn
  one message into a five-minute wait;
- the progress line reads **“Worker sent nothing — asking another… (2 of 5)”**, so it's
  visibly working rather than looking stuck;
- the same applies to images;
- if every attempt comes back blank you get an error that says how many tries it made,
  and **Continue** or another send will usually work.

While chasing this I checked whether the app's own `stop_sequence` parameter was to
blame (it was new in v1.3.0). It isn't: **9 of 12 with it, 9 of 12 without.** It stays.

If you hit it a lot anyway, picking a specific model in Settings rather than “Any
available (fastest)” avoids whichever workers are currently returning blanks.

## Cut-off replies

The Horde generates **raw text** — there's no chat template and no instruction telling a
worker where a reply should end. Two things go wrong, and both are now handled:

1. **The model keeps writing past its turn.** You ask Sera a question and she answers,
   then keeps going: `Sera: Rain again. The lamp holds.` / `Mira: Then I will stay.` /
   `Sera: Suit yourself.` — the model is writing *your* lines too.
   → The app now sends the Horde's native **`stop_sequence`** parameter (`\nMira:`,
   `\nSera:`, `<START>`, …) so the worker halts at the end of a turn, *and* trims at the
   next speaker label afterwards in case a worker ignores it. You only ever see her reply.

2. **The reply stops dead at the token limit** ("…the storm is coming in from the wes").
   → If a reply doesn't land on real punctuation, the app asks for the continuation and
   joins it — up to 3 passes. It knows the difference between a **split word**
   (`wes` + `t.` → `west.`) and a **word boundary** (`and` + `how` → `and how`), using a
   common-word list at the seam, so joins don't produce `west.` vs `andhow` errors.

Settings → Generation → **Finish cut-off replies** turns the second half off if you'd
rather see exactly what the model produced and hit **Continue** yourself. It costs
nothing when a provider already stops cleanly (one pass, then it stops).

## Features

- **Virtual humans** — own clock, routine, sleep, drifting mood and relationship,
  unprompted messages and photos, forked timelines (see above).
- **Cast** — character cards with avatars, tags and search. Import SillyTavern cards
  (`.json` **or** `.png` with embedded `chara` / `ccv3` data); export back to card JSON.
- **Chats** — one character, many sessions. Streaming replies, **Reroll**, **Continue**,
  swipe between alternative replies, edit/delete any message, export transcripts.
- **Story memory** — every N messages the model compresses the thread into a summary
  plus a list of durable facts, which get injected into later prompts. Long chats stay
  coherent without paying to resend the whole transcript. Edit it by hand any time
  (World → Story memory).
- **Lorebook** — keyword-triggered world entries per character, injected only when
  their keywords show up in recent messages.
- **Images** — generate a picture into the chat (or a character avatar) using the free
  **AI Horde** image cluster, with queue progress shown inline.
- **Prompt control** — global system prompt with `{{char}}` / `{{user}}` macros,
  per-character system-prompt/temperature overrides, temperature, top-P, max tokens,
  context length, and an always-appended “remember this” note.
- **AI drafting** — turn a name + tagline into a full persona with one tap.
- **Offline shell** — the app itself is bundled inside the APK and service-worker
  cached on the web; only model calls need a network.
- **Backups** — export/import everything as JSON. **API keys are stripped from exports.**
- **Native bits** — system Back button pops in-app screens, file picker works for card
  and avatar imports, exports land in `Downloads/HordeStudio/`.

---

## Why it hung, and what changed

Diagnosed against the live cluster on 2026-09-10:

| Symptom | Root cause | Fix |
|---|---|---|
| Spinner sits forever, then “timed out” | The `POST` that submits the job had **no timeout at all** — a stalled or rate-limited request waited on the browser's own (multi-minute) network timeout | 40 s ceiling on submits, 30 s on polls, with explicit “network stall” errors |
| Stop button did nothing | The abort signal was passed to `fetch` but **never into the polling loop**, so cancel couldn't stop a queued job | Signal threaded through every poll and every `sleep`; Cancel aborts instantly (verified: 1.5 s in, job dropped, no orphan message) |
| Gave up at exactly 4 / 6 minutes | Hard-coded deadlines that are shorter than a normal evening queue | Configurable 2–20 min (default 10), chosen by you |
| A job could queue forever | Nothing checked whether the selected model had **any workers online** | Model health cached 5 min; offline models refused up front with a clear message |
| Blunt failure on busy days | A single HTTP 429 or 500 killed the whole job | 429 → back off and retry; 5xx/stall → retry; only give up after repeated strikes |
| Inconsistent image sizes | The size you picked in the image sheet was ignored (always 768) | Size now honoured |
| Replies cut off mid-sentence (v1.3.0) | No `stop_sequence` was sent, so nothing told the worker where a turn ends, and a token-limit cut was returned as-is | Stop sequences + speaker trimming + auto-finish (up to 3 passes), with a split-word/word-boundary aware join |
| Timeout said "Still queued after 0 minutes" (v1.3.0) | `maxWait` is in seconds but was divided as if it were minutes | Correct units; reads "8 seconds" or "10 minutes" |
| Virtual-human photos had no picture | `res` was referenced outside its closure in `vhPhoto`, so every auto-photo silently fell back to a text-only message | Rewritten to carry the image metadata through the chain (caught by the mock-server test, not by eye) |

Also fixed: the text prompt now requests a context length computed from the real prompt
size, so workers never refuse a job for an unservable context.

**Verified** against a mock Horde server (fast path, 3-poll queue, 429 backoff, 500 retry,
timeout, cancel mid-queue, offline-model guard — all pass) and against the live cluster
(text reply in 5.4 s, image in 9.3 s, health: 69 text / 341 image workers online).

---

## When a model thinks out loud

Some models plan before they answer, and the plan comes back as part of the reply:
question headers ("What happened?", "How do they react?"), notes to self ("Let's refine
the response."), and references to "the prompt says…". You can stop that two ways.

**Strip it automatically (on by default).** Settings → Generation → **Strip the model's
thinking**. Recognisable reasoning is removed before the reply is shown, and planning
that trails a reply is trimmed too. It is deliberately cautious: it only cuts when the
planning lines clearly outnumber the story lines and a reply is left over, so a
character who speaks in short fragments, or ends on a question, is left alone. Turn it
off if you would rather see everything the model sent.

**Stop it at the source.** The default system prompt now tells the character to write
only what they do and say — no reasoning, outlines, or commentary about the prompt.
Characters that carry their own system prompt inherit it only if you add the line
yourself.

Wrapped reasoning (`<think>…</think>`, `<reasoning>`, `<analysis>` and similar) is always
removed, even when the model forgets to close the tag.

## Updating the app

You should not need to download the APK again. **Settings → App updates → Check for update**
compares what is installed with what is current and offers one of three things:

| What it finds | What you do |
|---|---|
| Nothing new | Nothing. It says so. |
| A new **web bundle** | Tap **Apply now**. ~130 KB downloads, the app restarts on it. No reinstall, no Android prompt, chats untouched. |
| A new **app version** | Tap **Install app update**. It downloads the APK and opens Android's own install screen — you confirm there. (**Or in browser** does the same through your browser instead.) |

How it works: the wrapper keeps a private folder that shadows the files shipped in the APK.
A file in that folder is served instead of the bundled one; anything it does not contain
falls through untouched. So an update is just a zip unpacked into that folder. Three
things keep it safe:

- **Nothing is deleted.** Remove the folder and the app is exactly as it shipped.
  *Reset to shipped files* does that.
- **A bad update undoes itself.** The wrapper arms a watchdog before switching. If the
  app never gets far enough to call it off, the next launch rolls the update back.
- **An old update is dropped when the APK changes**, so a stale bundle can never shadow
  a newer build.

**About the "potentially malicious" warning.** The app asks for `REQUEST_INSTALL_PACKAGES`
so it can install a newer version of itself from the update screen. Play Protect and most
scanners warn about any app holding that permission — it is also what dropper malware
requests — so expect the warning and tap **More details → Install anyway**. Nothing is
ever installed behind your back: the APK is downloaded through Android, and Android's own
install screen asks you to confirm. If you would rather never see the warning, say so:
dropping the permission keeps *Apply now* (which needs none) and costs only the in-app
APK install.

Two things worth knowing:

- **The address is a setting.** It ships pointing at this project's GitHub Pages site,
  which never moves. Point it anywhere else you control — a home server, a NAS — and it
  works just as well. The server needs to answer `/version.json` and `/web.zip`; both
  are described below.
- **Nothing phones home on its own.** It checks only when you press the button.

**When the address does not work.** The address baked into the app is a GitHub Pages
site, so it should always answer. Trouble only comes from pointing the setting somewhere
temporary — a sandbox preview URL, say. Those die when the sandbox restarts (the app then
reports `502 sandbox was not found`) and the proxy in front of them answers `403` to
anything without a session token. Neither is something the app can fix. Two ways through:

1. **Apply from a file** — download the bundle in your browser (the browser can always
   reach it), then tap *Apply from a file* in Settings → App updates and pick that zip.
   No network involved, so it works regardless of what the proxy does.
2. **Paste the current address** into *Update address* — copy it from the download page in
   your browser.

A URL you control (GitHub Pages, a home server, a NAS) removes the problem entirely; see
*Serving your own updates* below for what it has to answer.

<details>
<summary>Serving your own updates</summary>

`version.json` describes what is current:

```json
{ "apk": "1.4.8", "apkCode": 13, "web": "1.4.8", "webRev": "f8c44de4c6ef",
  "apkUrl": "HordeStudio-latest.apk",
  "apkSize": 228071, "webSize": 136617, "files": 18, "note": "…" }
```

- `apkCode` is compared with the installed `versionCode`; higher means offer the APK.
- `webRev` is any value that changes when the files change — a timestamp, or a hash of
  the files. Different from the installed revision means offer the bundle.
- `apkUrl` is optional. Send it and the app fetches the APK from exactly there; leave it
  out and the app uses `<address>/app`, which is what older servers serve.
- `web.zip` holds `index.html`, `css/`, `js/`, `icons/`, `sw.js` and
  `manifest.webmanifest` at the zip root, with no wrapper folder.

`apk-download/server.py` in this workspace does all of this, recomputing both files from
source on every request, so editing a file in `horde-studio-mobile/` is enough to publish
an update.
</details>

## Hosting the update channel on GitHub

The update address baked into the APK is this project's GitHub Pages site, which never
moves — a sandbox URL would die with the sandbox, as earlier builds proved. This project
publishes itself to Pages, so *Check for update* keeps working from any network, and long
after this workspace is gone.

**How it fits together**

- `docs/` is the published folder. `tools/build-channel.py` regenerates it from
  `horde-studio-mobile/`: the app files, plus `version.json`, `web.zip` and
  `HordeStudio-latest.apk`.
- The address lives in exactly one place — it is derived from the git remote, so
  `git@github.com:you/repo.git` becomes `https://you.github.io/repo/`. Rename the repo and
  the next sync re-bakes it; there is nothing to edit by hand.
- `bash sync-github.sh "what changed"` rebuilds the channel, commits and pushes. That is
  the whole workflow: change a file, run it, press *Check for update* on the phone.
- `webRev` is a hash of the file contents, not a clock reading, so a sync that changes
  nothing does not offer you an update you already have.
- Nothing private can leak into the push: the script stages named folders only, never
  `git add -A`, and refuses to commit if anything staged looks like a key, a cache or a
  photo. `.ssh/` — which holds the push key — is git-ignored.

**Setting it up, once**

1. Create an empty **public** repository on GitHub. Pages needs a public repo on a free
   account. Nothing personal is published: your characters, chats and settings live in the
   app's private storage on the phone and are never uploaded.
2. Add this sandbox's key to your account: **Settings → SSH and GPG keys → New SSH key**.
   The public key is `~/.ssh/id_ed25519.pub` in this workspace. Nothing expires, so the
   sync keeps working across restarts with no re-authorisation.
3. In the repo: **Settings → Pages → Source: Deploy from a branch**, branch `main`,
   folder `/docs`.
4. Point the local repo at it and publish:

```bash
git remote add origin git@github.com:tensozanghetzu-hub/horde-studio-apk.git
bash sync-github.sh "first publish"
```

Then on the phone: **Settings → App updates → Update address** →
`https://tensozanghetzu-hub.github.io/horde-studio-apk/`. Pages needs a minute or two to
rebuild the first time; after that it follows the push within seconds.

**Before Pages is switched on**, the same files are already reachable through
`raw.githubusercontent.com`, which needs no setup at all. Paste this instead and updates
work immediately:

```
https://raw.githubusercontent.com/tensozanghetzu-hub/horde-studio-apk/main/docs/
```

That is why `apkUrl` is a bare filename rather than a full URL: the app reads it relative
to the update address, so the one channel works from Pages, from raw, from a NAS or from
a home server without being rewritten for each.

**Why it cannot be fully automatic.** Two hard limits: this sandbox only runs while you
are in a session, so there is no cron to fire when you are away; and nothing outside can
read from it, because the preview URL answers `403` to anything but a browser. A GitHub
Action polling this workspace would hit that wall. A push from here is the only direction
that works — which is fine, because the only time the files change is during a session,
when the sync is one command away.

## When text runs off the side of the screen

The formatter turns a ```fenced``` block into a `<pre>`, and a `<pre>` does not wrap by
default. So whenever a model answered with a preformatted panel — the stat readouts some
setups emit, a poem, a table — the text carried on past the edge of the bubble, past the
edge of the screen, and was clipped mid-word.

Now `<pre>` and `<code>` wrap like any other text, and they are given a proper panel
style rather than the browser's default. Long words, long URLs and unbroken tokens were
already handled. Every screen was measured at 320, 360 and 412 px wide.

## What's new in v1.4.8

**Check for update now works.** It never did, on any server, and the symptom was
misleading: `Could not check: the server did not answer with a version file`.

The cause was in the wrapper, not the network. When a background job finished,
its result was passed to the web UI through a small JSON envelope. The string
going into that envelope was run through a routine written for human-readable
messages, which swaps every double quote for an apostrophe. That is harmless for
a sentence like *Downloading the update*, but `checkUpdate` carries the entire
`version.json` as its result — so

```json
{ "apk": "1.4.7", "apkCode": 12, ... }
```

arrived as

```
{ 'apk': '1.4.7', 'apkCode': 12, ... }
```

which is not JSON. The envelope itself was still valid, so the app got as far as
*the server answered us* and then failed to read its own copy. The wrapper now
escapes properly instead of substituting, so a result survives intact.

Two smaller things in the same build:

- Builds already installed cannot be reached by a web update, so the app also
  tolerates the mangled form and repairs it. Your current install starts working
  immediately, before you reinstall anything.
- The APK address in `version.json` is now a bare filename resolved against the
  update address, so one channel works from GitHub Pages, from
  `raw.githubusercontent.com`, from a NAS or from a home server.

## What's new in v1.4.7

- **The About screen shows the real version.** It said `1.0.0` because that string was
  hardcoded years ago and never updated — it now reads the installed version, and shows
  which web revision is live when one is applied.
- **Apply from a file.** Download the update bundle in your browser, then pick it in
  Settings → App updates. It needs no network, so it works even when the update address
  is unreachable — which is the case for any sandbox-hosted address.
- **The update address follows the sandbox.** Each rebuild bakes in the address of the
  sandbox it was built in, instead of pointing at one that has since been destroyed.
- **`502` and `403` now explain themselves**, and point at the two ways out above.
- The bundles (served and exported) carry a `version.json`, so an update applied from a
  file knows which revision it is.

## What's new in v1.4.6

- **The three dots only move while something is happening.** They were a permanently
  running animation: the element carried the `hidden` attribute and nothing ever showed
  it, but `.typing{display:flex}` overrode the browser's `[hidden]{display:none}` rule, so
  it was painted and bouncing on the chat screen at all times. It is now wired to real
  activity — a reply on the way, or a virtual human mid-burst — and stays hidden otherwise.
- The updater is unchanged from v1.4.4, in-app APK installs included.
- v1.4.5 briefly dropped the install permission to try to dodge the malware warning. It
  was reverted on request and never reached your phone.

## What's new in v1.4.4

- **The app can update itself.** Settings → App updates → Check for update. Interface
  fixes arrive as a ~130 KB bundle applied without a reinstall; a new app version is
  handed to Android's installer.
- **Rollback watchdog**: an update that the app never boots from is undone automatically
  on the next launch, so a bad bundle cannot wedge the app.
- **Reset to shipped files** throws the update away and returns to the copy in the APK.
- The update address is a setting, and the server that answers it is included
  (`apk-download/server.py`).

## What's new in v1.4.3

- **Text no longer escapes the bubble.** Fenced/preformatted blocks wrap instead of
  running off the right edge and being clipped mid-word.
- Fenced blocks are styled as a monospace panel instead of unstyled browser default, and
  their line breaks are no longer doubled.
- Audited every screen for horizontal overflow at 320, 360 and 412 px; nothing escapes.

## What's new in v1.4.2

- **The model's reasoning no longer lands in the chat.** Thinking that leaks into a
  reply — question headers, notes to self, "the prompt says…" — is stripped before the
  message is shown, on ordinary replies, on autonomous messages, and on every
  continuation round. Tagged blocks like `<think>…</think>` always go, closed or not.
- **Settings → Generation → Strip the model's thinking**, on by default, off if you want
  to see the raw text.
- The default system prompt now instructs the character not to include reasoning,
  planning, or commentary about the prompt.
- The stripper is deliberately narrow: it only fires when planning lines outnumber story
  lines and a reply remains, so terse in-character speech survives intact.

## What's new in v1.4.1

- **Empty jobs are retried with another worker** instead of failing the message — up to
  5 attempts inside a 45-second budget, with visible progress. This was the single most
  common error in v1.4.0.
- Images get the same treatment.
- The error, when it still happens, says how many attempts it made.

## What's new in v1.4.0

- **Virtual Humans 2.0**: places and journeys, needs, supporting people, a diary,
  per-persona relationships, a Life screen and a feed.
- **Autonomy controls**: four permissions and a daily budget (12 by default) so
  unprompted messages and photos can't drain your kudos.
- **Portable lives**: export a clean template or a full portable human; import as an
  isolated copy.
- **Replies arrive as separate texts** when a reply reads like several short messages.
- Replies that ask *"what's your response as…?"* no longer become a bubble of their own.
- Fixed: a bubble's timestamp could be dated into the future, reordering the transcript.
- Fixed: a refused autonomous message (permission or spent budget) left the app busy
  forever, blocking every later generation.
- Fixed: a failed autonomous message retried on every tick instead of backing off.
- Fixed: autonomous messages skipped the reply cleanup, so `Name:` labels and model
  junk came through.
- Fixed: the provider context cap is now enforced on the conversation only — the
  character sheet and life snapshot are never what gets trimmed (upstream 18.0.1's bug).

## What's new in v1.3.0

- Replies end where a character's turn ends: Horde `stop_sequence` support plus
  client-side trimming of speaker labels.
- Cut-off replies are finished automatically (up to 3 passes) with word-boundary-aware
  stitching; toggle in Settings → Generation.
- Timeout message now reports the right units.

## What's new in v1.2.0

- **Virtual humans**: clock, routine, sleep, mood/relationship meters, unprompted
  messages and photos, chronicles, forked timelines, and a new **Now** tab.
- Catch-up life engine: state advances by real elapsed time whenever the app opens.
- Fixed: virtual-human photos were being saved without their image.

## Privacy

- Characters, chats and memories live in IndexedDB **inside the app** — nothing is uploaded.
- API keys are stored in that same private storage and are **never** included in backups.
- The only network traffic is: your chosen model provider, and `aihorde.net` if you use
  Horde text/images.

---

## Rebuilding the APK

```bash
cd apk-build
./setup-sdk.sh      # once: downloads cmdline-tools + platform 34 + build-tools 34 (~400 MB)
./build.sh          # -> /home/user/HordeStudio-v1.1.0.apk
```

`build.sh` uses only the SDK command line tools (`aapt2`, `javac`, `d8`, `zipalign`,
`apksigner`) — no Gradle, no Android Studio, no Node. It copies `horde-studio-mobile/`
into `assets/`, compiles the WebView host, and signs with `apk-build/horde-studio.keystore`.

Bump `versionCode` in `AndroidManifest.xml` **and** `build.sh` before shipping an update,
and keep the same keystore so phones accept it as an update rather than demanding a reinstall.

### How the wrapper works

`MainActivity` serves the whole app from the APK’s assets at **`http://localhost/`** via
`shouldInterceptRequest`. That gives the web app a real HTTP origin, so IndexedDB,
localStorage, service workers and CORS behave exactly as they do in a browser — unlike
the usual `file://` WebView hack. Only non-localhost URLs go out to the internet.

---

## Using the web/PWA build instead

`horde-studio-mobile/` is a standalone PWA. Serve the folder from any static host
(GitHub Pages, Netlify, your own server) and open it in Chrome on Android →
**⋮ → Install app** for the same full-screen experience. `sw.js` caches the app shell
for offline use. It needs HTTPS in a browser for service-worker install; the APK does not.

On the web build, AI Horde calls work because `aihorde.net` sends
`Access-Control-Allow-Origin: *` and allows the `apikey` / `Client-Agent` headers
(verified by preflight).

---

## Known limits

- Horde text/image generation is queue-based and load varies wildly — the app now shows
  you what's happening rather than pretending it's instant. A free key cuts the wait.
- Image generation stores the result inside the chat; very old phones may feel memory
  pressure on 1024 px images (640 px default).
- The APK is self-signed, so Android re-verifies it on install. Future builds signed with
  a different key require uninstalling first.
