# Briefing: fixing character cards for Horde Studio Mobile

Paste this at the top of a new chat before you hand over a card. It exists because
Horde Studio is **not** SillyTavern, not JanitorAI, not Risu, and not any other
card runner — the card fields mean specific things here, and advice written for
those apps is frequently wrong in this one.

---

## What the app is

A single-file offline-first PWA + Android WebView app. The player chats with one
card at a time (or a small group of cards). It talks to OpenAI-compatible
endpoints, OpenRouter, or AI Horde.

Card formats it reads: character card **V1**, **V2**, **V3** (JSON or PNG with a
`chara`/`ccv3` text chunk), JanitorAI bulk exports, and URL import.

## How a card's fields are actually used

| Card field | Becomes | Notes |
|---|---|---|
| `description` + `personality` | **persona** | Joined into one plain-text system block. HTML is stripped. |
| `scenario` | **scenario** | Sent as `Current situation: …` |
| `scenario_list` | **scenarios** | Extra fields; one may be picked as the situation |
| `first_mes` | **greeting** | Shown as the opening bubble, *not* re-sent every turn |
| `alternate_greetings` | **intros** | Swipeable in the chat opening bubble |
| `mes_example` | **examples** | **Sent as real chat messages**, right after the system prompt |
| `post_history_instructions` | **postHistory** | Appended late in the character sheet — the closest thing to an author's note |
| `character_book` | **lorebook** | Keyword-triggered, token-budgeted, injected only on a match |
| `char_x` | avatar + images | Base64 in the card |

## The order the model actually sees

1. System prompt (global or the card's own `systemPrompt`)
2. OOC rule
3. **Character sheet**, in this order: persona → `Current situation: scenario` →
   `About {{user}}:` user persona → RPG state → scene note (if placed early) →
   world facts (lore hits) → chat-only facts → story summary + established facts →
   continuity → post-history instructions → scene note (if placed at the end)
4. Any per-reply note
5. **Examples, as actual user/assistant messages**
6. Chat history (last ~40 messages, trimmed to a character budget)
7. Any trailing seam instruction

Consequences that trip up advice from other apps:

- **Examples outrank the system block.** They arrive as real turns, later in the
  request. Long, forceful example dialogue overrides persona instructions. This is
  the single most common reason "the card ignores its own rules."
- **The greeting is not re-sent.** It only sets the scene once. Rules placed only
  in `first_mes` fade immediately.
- **There is no author's-note depth field.** Use `post_history_instructions` or the
  app's Scene note.
- **Persona is one block, not depth-injected.** Anything buried in the middle of a
  long description competes with everything else in that block.
- **Lore only fires on keyword matches.** Lore that never triggers is invisible.

## Defaults that matter when tuning a card

- Max reply length: **600 tokens** (user's setting; ~390 words of dialogue-heavy prose)
- Temperature 0.85, top_p 0.95
- Auto-finish is **off** — a long reply stops at the cap and the player presses
  Continue. The setting for that is deliberate.
- `{{user}}` supplies the player's name from the active persona. **Never** hardcode
  a player name in a card.

## Rules the app already enforces (do not re-implement in the card)

- Anti-repetition: a reply that mostly repeats an earlier one is regenerated.
- Continue: a cut reply is finished, and fused continuation words are split.
- Scene cast: who is present and who is addressed (auto-detected, editable).
- Continuity and RPG status changes require the player's approval.

A card that also enforces these in prose will fight the app. Write the card's
*violes*, not its safety rails.

## What to send with the request

1. The card as JSON (or PNG). Not a screenshot of the card text — the exact fields.
2. What the player actually sees, in their words, with a sample of the bad output.
3. What should have happened instead.
4. Which of these it is: wrong content in a field, wrong prompt order, model
   behaviour, or app behaviour. Guessing here wastes the most time.

## Ask these before proposing a fix

Most wrong fixes come from assuming an answer instead of asking. Run through
these first. If a question cannot be answered from what the player sent, ask it
and wait — do not fill the gap with a plausible default.

**1. Which model and provider is running?**
A small or free model repeats, fuses words, and stops mid-sentence on its own.
Changing the card cannot fix a model that is degenerating. Ask, and note that
"it worked before" usually means the model changed.

**2. What is the reply length set to, and is auto-finish on or off?**
"Cut off mid-sentence" is the most common complaint and it is almost always this,
not the card. With auto-finish off, a reply that hits the cap simply stops.

**3. Did the reply stop at the cap, or did the model choose to stop?**
Since v1.39.66 the bubble says which: "cut at the length limit" (raise the cap)
or "cut (the model chose to stop)" (the cap is not the problem). Ask for that
exact wording before touching the card.

**4. Is this a fresh chat or one with a long transcript?**
Once bad replies are in the history, the model imitates them. A card that looks
broken in a 60-message chat can behave in a new one. Test the card in a fresh
chat before concluding anything about the card.

**5. What exactly did the player type, and what came back?**
Ask for the verbatim last message and the verbatim reply. Paraphrases hide the
trigger, and the trigger is usually a word or beat that appears in the card's
examples or scenario.

**6. Has this card ever behaved correctly?**
If yes: what changed (model, settings, app version, edit to the card)? If no: the
card was written for something this app does not do, and the fix is structural.

**7. Which is it — the card, the model, or the app?**
Say the answer out loud before proposing anything, with the reason. Then:

- **Card** — the field content is wrong, missing, or in a field the app never reads.
  Fix the card.
- **Model** — it loops, fuses, or trails off regardless of card. Change model or
  sampling; do not rewrite the card around it.
- **App** — the card is fine and the app mishandled it. Describe the behaviour
  generically and stop; do not reshape the card to work around it.

A useful tell: if the same problem appears with a second, unrelated card, it is
not the card. And if a "fix" only works for the card in front of you, it is not a
fix — it is a workaround that will fail on the next card.

## How to validate before handing a card back

- Every field the card needs is one the table above actually reads. A rule in an
  unread field is a rule that does not exist.
- No player name is hardcoded; `{{user}}` and `{{char}}` are used consistently.
- The card does not restate the app's anti-loop, continuity, or cast rules.
- Example dialogue is short and *representative* — it is the strongest lever in the
  prompt, so it should not contain anything the player would not want repeated.
- Nothing in the card assumes a feature this app lacks (depth prompts, regex
  scripting, group-greeting logic, author's note depth).

## What this chat should NOT do

Do not propose changes to the app to make one card work. If the card exposes a
genuine app bug, describe it generically — "section headings in a description are
being detected as people" — and hand that to the app development chat on its own.
A fix shaped around one card's quirks breaks other cards.
