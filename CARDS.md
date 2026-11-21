# Character cards — what this app reads, keeps, and applies

How Horde Studio (v1.40.0) handles a character card, field by field. Written for
people who import cards from other frontends and export them again, and for
authors who want to know what a card may safely ask this app to do.

Two sentences of policy, then the tables.

**A card is never damaged on the way through.** Anything this app does not model
is kept as the card wrote it and put back on export — including unknown
extensions, book-level settings, legacy spellings and values this app would not
have chosen. Editing one field changes that field and nothing else.

**Nothing is called supported just because it is kept.** Each table says which of
the two it is: *applied* means it changes what the model is sent, *preserved*
means it rides back out untouched and changes nothing here. Where a field is
preserved but not applied, the importer says so out loud, on the character, where
it can still be acted on.

## Contents of a card

| Card field | Here | Where it goes |
|---|---|---|
| `description`, `personality` | applied, together | the character sheet's persona. Editing the persona empties `personality`, because one box cannot be split back into two fields. |
| `scenario` | applied | the situation line, with the `scenario_list` variant picker if the card carries one |
| `first_mes` | applied | the greeting |
| `alternate_greetings` | applied | the extra intros, swipeable in the chat (a greeting that repeats `first_mes` is not carried twice) |
| `mes_example` | applied | example dialogue, labelled as a sample and kept out of the transcript |
| `post_history_instructions` | applied, position is a choice | see [placement](#where-post_history_instructions-goes) |
| `system_prompt` | kept, shown, applied on request | see [the system prompt](#the-cards-own-system_prompt) |
| `character_book` | applied | the lorebook: see [matching](#lorebook-matching) |
| `name`, `tags`, `creatorcomment` | applied to the character record | `tags` fill the character's tagline; none of the three is sent to the model |
| `creator_notes`, `creator`, `character_version` | preserved | not sent to the model, per the spec's own instruction |
| V3 character fields with no Horde equivalent (`nickname`, `language`, `depth_prompt`, `creation_date`, `modification_date`) | preserved | returned verbatim on export; `depth_prompt` is not applied, because this app has no per-depth prompt slot |
| `extensions`, at card and entry level | preserved | every key the card had, with only `horde_studio` replaced by this app's own values |
| `char_x`, `image_1…n`, other picture keys | shown | the avatar and the card gallery; pictures the app has no place for (a background, an image inside a lore entry) are preserved in the card and the export says which ones it could not put back |
| `metadata` blobs from other clients | preserved | never rewritten, never merged into |
| `.charx` archives | not supported | no unzipper in the APK. A `.charx` cannot be imported or exported; use the `.json` or `.png` card |

## Where `post_history_instructions` goes

The text is put where the character's **Always-remember note** setting says, and
it is never sent twice:

| Choice | Position in the request | Used when |
|---|---|---|
| **End of the sheet** (default) | last inside the character sheet, above the examples and the transcript | what every version of this app has done; what a card imported before v1.40.0 keeps |
| **After the history** | after the transcript, *before* the app's own continuation/reroll instruction | a card that asks for its rule to be the last thing read, without letting it outvote the app's |
| **Not sent** | — | when the note is only there for other frontends |

Both request shapes answer the choice: the chat format puts it in the trailing
system turn, the text-completion format appends it after `Chat history:`. There is
no third path and no invented player message. The Prompt inspector shows the
request as it goes out, so the position can be checked rather than trusted.

Macros in that text (`{{char}}`, `{{user}}`, `{{original}}`, the pronouns) are
expanded at build time, not at import — so changing the global prompt changes what
`{{original}}` means, for cards imported before that macro existed too.

## The card's own `system_prompt`

Imported and kept even when unused, shown in full on the character, and applied
according to a three-way choice:

| Choice | The model is told |
|---|---|
| **Your prompt** (default) | the global prompt from Settings, or this character's own prompt box if it is filled in |
| **The card's** | the card's text instead, and nothing of the global prompt |
| **Both** | the global prompt, then the card's |

The V2 spec's own words are that a frontend's *default behaviour MUST be to
replace* the user's system prompt with the card's, with an empty field as the
exception. **This app deliberately does not default to that.** Its global prompt
carries the rules the mobile build runs on — plain prose, no narration written for
the player, the out-of-character convention — and a card that silently deletes
them is a worse surprise than a card whose extra rules go unread. The card's text
is imported, displayed, and one tap away; `Both` is the middle that lets an author
add without letting a card take away. This divergence is a product decision, not a
claim of compliance.

`{{original}}` means "the prompt the app would have used without this card" in
every mode. In `Both` it resolves to nothing rather than repeating the global
prompt twice — the reference is satisfied by the copy already in front of the
card's text. An empty or missing `system_prompt` always falls back to the global
prompt, whatever the mode says.

## Lorebook matching

Entries are *candidates*, then *admitted*, then *placed*. Which of the card's
fields act on each stage:

| Stage | Field | Behaviour |
|---|---|---|
| candidate | `enabled` | `false` excludes the entry |
| candidate | `stage` | a staged entry appears only in a chat whose continuity stage matches exactly; `*` means always, blank means the entry is dark until the chat sets a stage — the Lore screen says which of these it is |
| candidate | `keys` | a key must stand on its own word edges ("label" does not match "labelling"), and a bare plural still counts ("gossip" matches "gossips") |
| candidate | `case_sensitive` | applied: a key written with capitals matches only those capitals. Word edges and the plural rule still apply |
| candidate | `selective` + `secondary_keys` | applied per V2's own comment: `selective: true` needs a key from `keys` **and** a key from `secondary_keys`. When `selective` is not `true`, `secondary_keys` is ignored. A secondary key alone never wakes an entry |
| admitted | `constant` | always admitted, ahead of everything else, while the budget lasts |
| admitted | `extensions.horde_studio.essential` | this app's own flag: admitted ahead of any entry that is not `constant`, so a tight budget spends itself on what the card says the story cannot do without. It does **not** lift the budget — an essential entry larger than the whole budget is sent alone, and the rest is cut and reported |
| admitted | *(nothing in the card)* | the default order is recency: a key in the message being answered beats a key from three turns back, which beats a key from six. This is the whole point of the selection and it is never replaced by book order |
| placed | `insertion_order`, `position`, `priority`, book `token_budget`, book `scan_depth` | applied **only** when the character has *Follow the card's lore order* on. See below |

**The window.** Keyword scanning reads the last **6 player turns** — in turns, not
messages, because messages-per-turn drifts as a chat runs. The same window is what
the transcript and the style lock read, and one request computes it once. A
character may widen the scan window from 1 to **24** turns; that changes only what
the scanner is allowed to *notice*, never how much history is sent. A card's own
`scan_depth` counts messages, so in compat mode it is halved into turns and is
only ever allowed to **shorten** the window.

**Compat mode** (*Follow the card's lore order*, off by default). Horde has one
place for world facts — a block inside the character sheet — so a book's ordering
has nothing to re-order unless the card's layout is asked for. With it on:
`position: before_char` / `after_char` split the admitted entries ahead of and
below the sheet, `insertion_order` sorts each group (lower number = higher up),
and when the book's `token_budget` is exceeded the entries with the lowest
`priority` are the ones that do not fit. Who is admitted does not change: the
candidates are still the entries the scan matched, ranked by relevance.

**Not honoured, and said so.** `selectiveLogic` is SillyTavern's, with four modes
that neither card spec defines; the boolean rule above is applied instead and the
import note plus the entry's own row name the field. `use_regex`,
`recursive_scanning`, `comment`, `display` and the entry `id` spellings are
preserved and not applied. A `selective` or `case_sensitive` that is neither `true`
nor `false` is treated as absent, exactly as the spec's boolean type implies, and
is reported as malformed rather than guessed at.

## Instructions a card leaves for this app

`extensions.horde_studio` is this app's own namespace and it carries six optional
authoring fields, editable on the character and round-tripped through the card:

`agency` (how much the player may say about the character's head), `style` (how the
prose should read), `canon` (what counts as settled fact), `progression` (how the
story is meant to move), `stages` (slow-burn gates), `priority` (what must survive
the budget).

Every one is off by default: nothing is added to the prompt for a card that does
not set them. Set, each becomes one labelled line under `CARD INSTRUCTIONS FOR
HORDE STUDIO`, inside the character sheet, above the examples. Macros expand as
elsewhere. Each line is cut at **600 characters** when it enters the prompt, and
the cut is marked in the prompt and shown in the editor — while the character and
the card keep the whole text up to the storage bound below.

## Limits

| Bound | Value | Why it is there |
|---|---|---|
| lore entries per request | 10 | four fat chapter summaries used to fill a 6-entry budget and out-rank the character |
| lore bytes per request | 5000 | ditto; a lone entry bigger than the budget is still sent, once, rather than silently dropped |
| chat-only lorebook | 6 entries / 2048 bytes | a per-chat book supplements the card's, it does not replace it |
| keyword window | 6 turns default, 1–24 allowed | measured on a 160-message chat; wider buys nothing past a few turns |
| one instruction field into the prompt | 600 characters | keeps a sheet from squeezing the transcript out of the request |
| text this app carries from a card | 4000 characters per instruction field, 6000 for `system_prompt` | storage bound; over it the character is shortened, the card is left whole, and the import says which fields were shortened |
| source copy kept for non-destructive export | 2 MB of JSON | above it nothing is preserved, and the character is told so at import |

## Exchanging cards with other clients

* Import: `.png` (tEXt / zTXt / iTXt chunk, base64 JSON), `.json` (V1, V2, V3, top-level or `data`), and a JanitorAI bulk export. A card that declares V3 but puts its fields at the top level is read from the top level, and told.
* Export: PNG with the card JSON in a tEXt chunk, or `.json`. Both write the V2 fields at the top level **and** under `data`, because other tools read one or the other.
* `.charx`: not supported in either direction.
* A card that was opened and never edited exports byte-for-byte identical where this app models the field, and unchanged where it does not — types included, so a `"0.9"` that arrived as a string leaves as a string.
* Deleting a lorebook empties it; it does not restore the author's copy. Deleting a *field*'s text sets that field; a card's untouched fields are never rewritten by an edit elsewhere.

## Versions this describes

Behaviour follows `character-card-spec-v2` (`spec_v2.md`, the V2.0 lorebook entry
comments) and `character-card-spec-v3` (`SPEC_V3.md`, the Lorebook and assets
sections), read 2026-09-10. Where a field means something only in SillyTavern, it
is named as such and not implemented from memory of that client's code.
