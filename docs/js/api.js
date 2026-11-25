/* LLM layer: OpenAI-compatible endpoints + AI Horde text, memory, summarisation */
(function (global) {
  'use strict';

  /* Pronoun sets. JanitorAI cards use {{sub}} {{obj}} {{poss}} {{poss_p}}
     {{ref}} so a card works for any player; without these the braces print
     literally into the prompt and the model copies them. */
  var PRONOUN_PRESETS = {
    'they': { sub: 'they', obj: 'them', poss: 'their', possP: 'theirs', ref: 'themselves' },
    'she':  { sub: 'she', obj: 'her', poss: 'her', possP: 'hers', ref: 'herself' },
    'he':   { sub: 'he', obj: 'him', poss: 'his', possP: 'his', ref: 'himself' },
    'it':   { sub: 'it', obj: 'it', poss: 'its', possP: 'its', ref: 'itself' }
  };
  function pronounsFor(s) {
    var custom = (s && s.pronouns) || {};
    var set = PRONOUN_PRESETS[(s && s.pronounPreset) || 'they'] || PRONOUN_PRESETS.they;
    var out = {};
    ['sub', 'obj', 'poss', 'possP', 'ref'].forEach(function (k) {
      out[k] = String(custom[k] || set[k] || '').trim() || set[k];
    });
    return out;
  }
  function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }
  /* {{Sub}} at the start of a sentence keeps its capital. Only a plain
     title-case name counts: in {{Poss_p}} the capital P belongs to the macro
     name (possessive pronoun), so it must not capitalise the output. */
  function capIf(source, word) {
    var inner = /\{\{\s*([A-Za-z_]+)\s*\}\}/.exec(source);
    var raw = inner ? inner[1] : '';
    return /^[A-Z][a-z]*$/.test(raw) ? cap(word) : word;
  }

  /* v1.40.0 (compatibility letter, item 3): where the system prompt comes from.
     Three modes per character, and the app's own prompt stays the default.

       'app'     the global prompt, or this character's own prompt box - exactly
                 what every version of this app has done, and what a card with no
                 prompt falls back to in every mode.
       'card'    the card's `system_prompt` replaces it. That is what the V2
                 spec actually asks of a frontend ("default behavior MUST be to
                 replace ... the value inside this field"), and this app does not
                 do it by default: the global prompt carries rules that keep the
                 mobile build working - plain prose, no narration in the
                 player's voice - and a card silently deleting them is a worse
                 surprise than a card whose extra rules go unread. The mode is
                 one tap away, and a Settings-wide default turns it on for every
                 card. The divergence is deliberate and documented.
       'combine' the global prompt, then the card's. An author can add, not take
                 away - so card text can never outvote the player's controls.

     `{{original}}` means the app/global prompt in all three modes, so a card can
     never redefine the macro that points back at the player's own text, and the
     substitution runs once with no recursion. */
  /* Which prompt a character uses, as one string the editor can also show:
     '' means "nobody has decided", which is the same result as 'app' unless the
     player has switched the global preference on. A card's own request
     (`systemPromptAsked`) is honoured through that preference and nothing else —
     v1.41.0 (review issue 1) took away the other path, where importing a card
     stamped its request into this field and the card then replaced the app's
     rules on the first request after it. */
  function cardPromptMode(char, s) {
    var chose = String((char && char.systemPromptSource) || '');
    if (chose) return chose;
    /* The preference says "a card that ASKED may have its way", not "every card
       with a prompt takes it": no recorded ask, no application. An earlier draft
       of this branch fell through to 'card' when the field was absent, which
       would have let the switch hand a prompt to every card in the library —
       including the ones whose author never thought about the question. */
    if (s && s.honorCardSystemPrompt === true) {
      var asked = String((char && char.systemPromptAsked) || '');
      return (asked === 'card' || asked === 'combine' || asked === 'app') ? asked : '';
    }
    return '';
  }
  function personaField(char, which) {
    if (char && char.personaSplit === true) {
      var part = String((which === 'pers' ? char.persText : char.descText) || '');
      if (part.trim()) return part;
    }
    return (char && char.persona) || '';
  }
  function systemTextOf(char, s) {
    var app = String((char && char.systemPrompt) || (s && s.systemPrompt) || '');
    var card = String((char && char.cardSystemPrompt) || '').trim();
    if (!card) return app;                       /* the spec's own empty-field case */
    var mode = cardPromptMode(char, s);
    if (mode === 'card') return card;
    if (mode === 'combine') {
      /* `{{original}}` means "the prompt the frontend would have used if this
         card's were not there". In this mode that prompt is already in front of
         the card's text, so the reference is satisfied by what is being sent and
         the macro resolves to nothing — one copy of the player's prompt, never
         two. The clause an author wrapped around it keeps its own words. */
      var body = card.replace(/\{\{\s*original\s*\}\}/gi, '')
        .replace(/^\s*([,;:.\-])\s*/, '').trim();
      if (!body) return app;
      return app ? app + '\n\n' + body : body;
    }
    return app;
  }

  /* v1.40.0 (item 2): where `post_history_instructions` is put. Default 'sheet'
     is what the app has always done - the text joins the end of the character
     sheet, above the examples and the transcript. 'tail' moves it after the
     history, where the model is still holding it when it writes; 'off' omits it
     entirely. It is never sent twice: charSheet reads the mode and steps aside. */
  function postHistoryMode(char) {
    var m = String((char && char.postHistoryPlacement) || '');
    return m === 'tail' || m === 'off' ? m : 'sheet';
  }
  function postHistoryText(char, s) {
    var raw = String((char && char.postHistory) || '').trim();
    return raw ? macros(plainText(raw), char, s) : '';
  }

  function macros(text, char, s) {
    if (!text) return '';
    var name = (char && char.name) || 'Assistant';
    var user = (s && s.userName) || 'You';
    var pr = pronounsFor(s);
    var out = String(text)
      /* pronoun macros first: {{poss_p}} must not be eaten by {{poss}} */
      .replace(/\{\{\s*poss[_-]?p\s*\}\}/gi, function (m, o) { return capIf(m, pr.possP); })
      .replace(/\{\{\s*poss\s*\}\}/gi, function (m) { return capIf(m, pr.poss); })
      .replace(/\{\{\s*obj\s*\}\}/gi, function (m) { return capIf(m, pr.obj); })
      .replace(/\{\{\s*subj?\s*\}\}/gi, function (m) { return capIf(m, pr.sub); })
      .replace(/\{\{\s*ref(?:lexive)?\s*\}\}/gi, function (m) { return capIf(m, pr.ref); })
      .replace(/\{\{char\}\}/gi, name)
      .replace(/\{\{user\}\}/gi, user)
      .replace(/\{\{name\}\}/gi, name)
      /* v1.41.0 (review request 4): a character edited as the card's two fields
         has two different texts, so `{{personality}}` and `{{description}}` mean
         what they say. Without a split there is one persona string and both
         macros keep resolving to all of it, which is what they have done forever. */
      .replace(/\{\{personality\}\}/gi, personaField(char, 'pers'))
      .replace(/\{\{description\}\}/gi, personaField(char, 'desc'))
      .replace(/\{\{scenario\}\}/gi, (char && char.scenario) || '')
      .replace(/\{\{persona\}\}/gi, (s && s.userPersona) || '')
      /* v1.39.112: SillyTavern's {{original}} means "the unmodified system
         prompt". There was no such macro here, so the braces reached the model
         as-is — typically in post_history_instructions, where the card says
         "{{original}}, [Use * for narration…]". Resolved at prompt-build time
         rather than baked in at import, so it always means the prompt the
         player currently has, and cards imported before this fix work too.
         A function replacer, so a $ in the prompt is not read as a pattern. */
      .replace(/\{\{\s*original\s*\}\}/gi, function () { return (s && s.systemPrompt) || ''; });
    return out;
  }

  /* v1.30.3: OOC notes are the one sanctioned break. The default prompt says
     "stay in character at all times" and forbids commentary, so without a
     standing rule most models ignore "OOC: ..." lines entirely. */
  var OOC_RULE =
    'Out of character: if, and only if, {{user}} writes an OOC note (OOC:, [ooc], ' +
    '(ooc)), step out of the character and answer it first, in one short plain line that ' +
    'begins with "OOC:" and answers the question they actually asked, then return ' +
    'to the scene exactly where it left off. Never answer an OOC question only ' +
    'through the fiction - if you are unsure what they are asking, say so in ' +
    'that line. ' +
    /* v1.39.87: the escape hatch was being used without an invitation. A model
       that noticed anything it could not reconcile - a sample that looked out
       of order, a contradiction it imagined - would open the reply with an
       OOC question and write no story at all. */
    'Otherwise write the scene and never speak out of character: do not open a ' +
    'reply with "OOC:", do not ask the player which version of events to ' +
    'continue, and do not comment on the prompt, the examples or the order of ' +
    'the story. If something seems inconsistent, treat the opening message and ' +
    'the most recent turns as the truth and carry on from there. ' +
    '{{char}} never comments on OOC inside the fiction.';

  /* ------------------------------------------------------------------
   * v1.13.1 — HTML in card text.
   *
   * SillyTavern and especially Janitor AI cards carry their description,
   * greeting and example dialogue as HTML — <p>, <br>, <i>, and the bot's
   * avatar as <img src="…">. Models cannot show images, so what actually
   * happens is that the model reads the markup out of the character sheet
   * and types it back into the reply as literal text (and the app
   * deliberately shows reply HTML as text, never rendered). plainText
   * turns card HTML into plain prose: line breaks survive, tags and their
   * URLs drop, common entities unescape. It is applied at import (new
   * cards arrive clean) and at prompt time (already-imported cards stop
   * echoing markup without a re-import). Idempotent, and a no-op for text
   * without markup, so clean cards are never touched.
   * ------------------------------------------------------------------ */
  var ENTITY_MAP = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  /* cp1252 byte for the non-Latin-1 characters (everything below 0x100 is
     identity). The undefined cp1252 slots decode to C1 controls, so those
     map back to their raw byte value. */
  var CP1252 = { 0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85,
    0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B,
    0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94,
    0x2022:0x95, 0x2013:0x96, 0x2014:0x97, 0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A,
    0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F };
  /* characters that open a UTF-8 multibyte sequence once mangled — the
     usual suspects in card text (curly quotes, accents, dashes) */
  var MOJI_RE = /â|Ã|Â|É|È|Ê|Ë|Î|Ï|æ/;

  /* v1.13.2 — mojibake repair.
   *
   * Card exporters (especially Janitor AI) sometimes write UTF-8 bytes as
   * if they were Windows-1252: the apostrophe of "she's" (E2 80 99)
   * becomes the three characters â€™, and a model that reads that in the
   * character sheet or the greeting starts imitating it in its replies.
   * This is the reverse transform: characters → cp1252 bytes → strict
   * UTF-8 decode. The decode is fatal, so it only ever succeeds on text
   * that is genuinely double-encoded — clean text ("château", "I paid
   * €5") fails to decode and is returned untouched. A repair that does
   * not shorten the text or that still carries markers is rejected.
   * Idempotent: repaired text has no markers, so a second pass is a
   * no-op. */
  function repairMojibake(text) {
    var t = String(text == null ? '' : text);
    if (!MOJI_RE.test(t)) return t;
    var bytes = new Uint8Array(t.length);
    for (var i = 0; i < t.length; i++) {
      var c = t.charCodeAt(i);
      var b = c < 0x100 ? c : CP1252[c];
      if (b === undefined) return t;    /* a char beyond cp1252: not this mojibake */
      bytes[i] = b;
    }
    var repaired;
    try { repaired = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return t; }             /* not valid UTF-8: not double-encoded */
    if (!repaired || repaired.length >= t.length || MOJI_RE.test(repaired)) return t;
    return repaired;
  }

  function plainText(text) {
    var t = String(text == null ? '' : text);
    if (t.indexOf('<') !== -1) {
      /* script/style blocks go with their contents */
      t = t.replace(/<(?:script|style)\b[\s\S]*?(?:<\/(?:script|style)\s*>|$)/gi, '');
      t = t.replace(/<br\s*\/?>/gi, '\n');
      t = t.replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)\s*>/gi, '\n');
      t = t.replace(/<[^>]*>/g, '');
    }
    if (t.indexOf('&') !== -1) {
      t = t.replace(/&#(\d+);/g, function (_, n) {
        var cp = parseInt(n, 10);
        return (cp >= 32 && cp !== 127) ? String.fromCharCode(cp) : ' ';
      });
      t = t.replace(/&[a-z]+;/gi, function (ent) {
        var v = ENTITY_MAP[ent.slice(1, -1).toLowerCase()];
        return v === undefined ? ent : v;   /* unknown entity: leave as written */
      });
    }
    t = repairMojibake(t);
    t = t.replace(/\n{3,}/g, '\n\n');
    return t.trim();
  }

  /* Turn a SillyTavern-style example block into alternating messages */
  function examplesToMessages(text, char, s) {
    /* B1 (v1.39.70): every card-writing guide tells authors to separate example
       turns with <START>, but plainText() deletes every tag — including that
       one — before the parser below could ever match it, so the separator
       vanished and the turns merged into one wall of text with no warning.
       Hold it behind a sentinel so it survives the plain-text pass. */
    var START = '@@HS_START@@';
    text = String(text || '').replace(/<\s*START\s*>/gi, '\n' + START + '\n');
    text = plainText(text);
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      /* the recovered separator, plus the other common convention */
      if (line === START || /^-{3,}$/.test(line)) { cur = null; return; }
      /* v1.40.0 (item 5): a label decorated the way card guides write one is
         still a label. Cards put `<START>` between turns, bullets in front of
         them, and the speaker's name inside `**emphasis**` — all three at once,
         sometimes. The decoration is stripped from a PROBE so the label can be
         recognised; the text that goes into the turn is cut from the author's
         own line at the label's colon, so nothing inside it is rewritten or
         dropped. An unrecognised line still joins the turn above it, which is
         the rule that keeps a multiline turn in one piece. */
      var probe = line.replace(/^[-*>•\s]+/, '')
        .replace(/^([*_]{1,3})\s*/, '')
        .replace(/\s*([*_]{1,3}):/, ':');
      var decorated = probe !== line;
      var isUser = /^\{\{user\}\}\s*:/i.test(probe);
      var isChar = /^\{\{char\}\}\s*:/i.test(probe) ||
        new RegExp('^' + (char && char.name ? char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'char') + '\\s*:', 'i').test(probe);
      function labelled() {
        var cut = line.indexOf(':');
        var text = cut >= 0 ? line.slice(cut + 1) : line;
        /* the closing half of an emphasis run belongs to the label, not to the
           reply: `**{{char}}:** Hello` starts its content with `**` */
        if (decorated) text = text.replace(/^[*_]{1,3}\s*/, '');
        return text.trim();
      }
      if (isUser) { out.push({ role: 'user', content: labelled() }); cur = out[out.length - 1]; }
      else if (isChar) { out.push({ role: 'assistant', content: labelled() }); cur = out[out.length - 1]; }
      else if (cur) { cur.content += '\n' + line; }
    });
    return out.filter(function (m) { return m.content && m.content.trim(); })
      .map(function (m) { m.content = macros(m.content, char, s); return m; });
  }

  /** v1.36.1: the character side learns its word edges - the same rule the
   *  world lorebook got: a key must stand on its own ("label" inside
   *  "labelling" is not a sighting) while a bare plural still carries
   *  ("gossips" finds "gossip"). Match-time regex only; stored keys
   *  untouched, and the character policy keeps its no-length-floor rule
   *  since word edges already blunt the short-key risk. */
  /* `caseSensitive` is the V2/V3 entry flag of the same name, honoured since
     v1.40.0: a key that is written with capitals only matches those capitals.
     Note the word-edge class has to grow when the text is not lowercased, or
     "Door" stops matching at "Door" because 'D' is not in [a-z0-9]. The plural
     allowance stays in both modes - a key for "gossip" has always also found
     "gossips", and that is documented in the Lore screen rather than changed. */
  function keyStands(text, key, caseSensitive) {
    var k = String(key || '').trim();
    if (!k) return false;
    if (!caseSensitive) k = k.toLowerCase();
    var edge = caseSensitive ? 'A-Za-z0-9' : 'a-z0-9';
    var re = new RegExp('(^|[^' + edge + '])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '(?:s|es)?(?=$|[^' + edge + '])');
    return re.test(text);
  }

  /* v1.40.0 (item 5): which macros a card uses that this app will not resolve.
     Asked of the resolver rather than of a list, so it cannot drift: a name is
     unsupported exactly when handing `{{name}}` to macros() gives `{{name}}`
     back. Nothing here invents a meaning for a macro it has not implemented. */
  var MACRO_SEEN = /\{\{\s*([^{}]{1,40}?)\s*\}\}/g;
  function unresolvedMacros(text, char, s) {
    var found = [], seen = {};
    var m, src = String(text || '');
    MACRO_SEEN.lastIndex = 0;
    while ((m = MACRO_SEEN.exec(src))) {
      var name = m[1].trim();
      if (!name || seen[name]) continue;
      seen[name] = 1;
      if (/\{\{/.test(macros('{{' + name + '}}', char, s))) found.push(name);
    }
    return found;
  }

  /* C2 (v1.39.71): why each entry did or did not join the prompt. loreHits
     answers yes/no; an author whose entry never fires needs the reason, and
     "dropped for budget" and "no keyword" are very different fixes.
     Returns one row per entry, in book order. */
  function loreDiagnostics(entries, recent, limit, budget, stage, opts) {
    var max = limit || LORE_LIMIT;
    var cap = (typeof budget === 'number' && budget > 0) ? budget : LORE_BUDGET;
    var ranked = loreRanks(entries, recent, stage, opts);
    var byIndex = {};
    ranked.forEach(function (r) { byIndex[r.index] = r; });
    /* Decide against the ranked list, so this reports what the prompt will
       actually contain. It used to walk the book in order, which described a
       selection nobody used. */
    var chosen = {};
    /* the entries this app could not use as patterns, by book index: the spec's own
       rule is that a broken pattern means "not a match", so the row has to say that
       rather than reporting a missed keyword, which reads as a typo in the key */
    var badBy = {};
    (ranked.bad || []).forEach(function (b) { badBy[b.index] = b.why; });
    /* v1.40.0: the same options the prompt path uses, so what this reports is
       what the request does - including compat mode's priority-ordered cuts.
       v1.42.2: and the reason each entry was cut, carried out of the same pass. */
    var admits = loreAdmit(ranked, max, cap, opts);
    var skipped = admits.skips || {};
    admits.forEach(function (r) { chosen[r.index] = true; });
    var activeStage = String(stage || '').trim().toLowerCase();
    var rows = [], used = 0, admitted = 0;
    /* v1.40.0: what the ceiling cost. An author who marked an entry essential
       needs to be told when even that was not enough, and a compat-mode book
       trimmed by its own token_budget looks identical to one trimmed by the app
       unless the readout says which ceiling was in force. */
    var droppedByLimit = 0, droppedByBudget = 0, droppedEssential = 0;
    (entries || []).forEach(function (e, i) {
      var row = { keys: e.keys || [], content: e.content || '', matched: false, reason: '', rank: -1,
        /* v1.40.0: the author-controlled flags the matcher now reads, reported
           per entry so the Lore screen can say WHY an entry behaved as written */
        essential: e.essential === true,
        caseSensitive: e.caseSensitive === true,
        selective: e.selective === true,
        /* v1.47.0: the two asks a book can make that need the player's switch. Named
           per row because the row is where an author looks when an entry is quiet,
           and "the switch is off" is not an answer this screen could give before. */
        useRegex: e.useRegex === true,
        /* patterns / chained / broken are filled in below, once the ranked row for
           this entry is in hand: a property read off a `var` that has not been
           assigned yet is `undefined`, and every row would have said "no". */
        insertionOrder: e.insertionOrder === undefined ? null : e.insertionOrder,
        position: e.position || '',
        /* v1.40.0 (item 4a): the entry says something about matching that this
           app cannot read. `selectiveLogic` is SillyTavern's, not in either
           spec, so the boolean `selective` rule is applied in its place; a
           `selective` or `case_sensitive` that is not a real boolean is treated
           as absent. Named on the row, so an author is never left guessing why a
           well-written entry stays quiet. */
        ignored: e.selectiveLogic !== undefined ? 'selectiveLogic'
          : (e.selective !== undefined && e.selective !== true && e.selective !== false ? 'selective'
            : (e.caseSensitive !== undefined && e.caseSensitive !== true && e.caseSensitive !== false
              ? 'case_sensitive' : '')) };
      var r = byIndex[i];
      row.patterns = !!(r && r.patterns);
      row.chained = !!(r && r.chain);
      row.broken = (r && r.broken) || badBy[i] || '';
      /* V3 says a pattern entry SHOULD ignore `secondary_keys`, and it does. Named
         on the row, the way `selectiveLogic` is, so an author whose entry fires on
         half its declared conditions reads why. */
      if (!row.ignored && e.useRegex === true && (opts && opts.regex) &&
        ((e.selective === true && Array.isArray(e.secondaryKeys) && e.secondaryKeys.length) ||
         (Array.isArray(e.secondaryKeys) && e.secondaryKeys.length && e.selective !== true && e.selective !== false))) {
        row.ignored = 'secondary_keys';
      }
      row.stage = String(e.stage || '').trim();
      if (e.enabled === false) { row.reason = 'disabled'; rows.push(row); return; }
      var need = String(e.stage || '').trim().toLowerCase();
      if (need && need !== '*' && (!activeStage || need !== activeStage)) {
        /* v1.39.110: distinguish "this chat is in a different act" from "this
           chat has no act at all". They are different fixes for the author:
           the first is expected, the second means the entry is dark in every
           chat until a stage is set - which is the default state. */
        row.stageDark = true;
        row.noStage = !activeStage;
        row.reason = activeStage
          ? 'wrong stage (entry needs "' + row.stage + '", chat is "' + activeStage + '")'
          : 'needs stage "' + row.stage + '" - this chat has no stage set, so it is dark';
        rows.push(row); return;
      }
      if (!r) {
        if (badBy[i]) {
          row.reason = 'its “' + badBy[i] + '” pattern was refused, so the entry cannot match — ' +
            (badBy[i] === 'nested repeat'
              ? 'a group repeated inside and after itself is exponential on a backtracking engine, ' +
                'and this runs on your phone every turn'
              : 'it is not a regular expression JavaScript can compile');
        } else if (e.useRegex === true && !(opts && opts.regex)) {
          row.reason = 'this entry asks for regex keys and the switch is off, so its pattern was ' +
            'searched for as plain text';
        } else {
          row.reason = 'no keyword matched in the recent messages';
        }
        rows.push(row); return;
      }
      row.matched = true;
      row.rank = ranked.indexOf(r);
      if (chosen[i]) {
        row.reason = r.constant ? 'always (constant)' : 'matched';
        used += r.cost; admitted++;
      } else {
        /* v1.42.2: the reason comes from the pass that made the cut. It used to
           be decided here by `admitted >= max`, where `admitted` counted the
           entries admitted EARLIER IN THE BOOK - a different number from how many
           the ranking admitted. An entry the 10-entry limit had pushed out but
           that sits near the top of the book was judged while that counter still
           read zero and fell through to the budget branch, so the author was told
           their entry did not fit in bytes while 0.2 % of the budget was used -
           and the note at the top of this screen picks the budget wording first,
           so the advice was wrong too. Selection was always correct; only this
           explanation was. The counter is kept as a fallback for a caller that
           hands over a list with no reasons attached. */
        var sk = skipped[i];
        var why = sk ? sk.why : (admitted >= max ? 'limit' : 'budget');
        if (why === 'limit') {
          row.reason = 'matched, but the ' + max + '-entry limit was reached';
          droppedByLimit++;
        } else {
          row.reason = 'matched, but over the ' + cap + '-byte budget';
          droppedByBudget++;
          if (r.essential) droppedEssential++;
        }
        if (sk && sk.both) row.reason += ' - the byte budget is full as well';
      }
      rows.push(row);
    });
    /* How many entries are in the dark because of staging, and how many of
       those are dark only because the chat has no stage at all. The Lore
       screen surfaces both, because a blank stage silently hides a staged
       book and looks exactly like a broken lorebook. */
    var stageSkipped = 0, stageDimForNoStage = 0;
    rows.forEach(function (r) {
      if (!r.stageDark) return;
      stageSkipped++;
      if (r.noStage) stageDimForNoStage++;
    });
    return { rows: rows, used: used, cap: cap, admitted: admitted, limit: max,
      stage: activeStage, stageSkipped: stageSkipped, stageBlank: !activeStage,
      stageDarkWithoutStage: stageDimForNoStage,
      droppedByLimit: droppedByLimit, droppedByBudget: droppedByBudget,
      droppedEssential: droppedEssential,
      /* the settings the matcher ran with, so the screen can name them instead of
         the reader having to remember which mode this character is in */
      compat: !!(opts && opts.compat), turns: (opts && opts.turns) || LORE_SCAN_TURNS,
      /* what the two switches did here, so the screen reports the state it saw rather
         than reading settings of its own and risking a different answer */
      regexOn: !!(opts && opts.regex), chainOn: !!(opts && opts.chain),
      chainDepth: (opts && opts.chainDepth) || 0,
      patterns: ranked.filter(function (r) { return r.patterns; }).length,
      chained: ranked.filter(function (r) { return r.chain; }).length,
      patternAsked: (entries || []).filter(function (e) { return e && e.useRegex === true; }).length,
      brokenPatterns: Object.keys(badBy).length };
  }

  /* v1.39.109: how much of a book may reach one prompt.
     These were 6 / 1536. On a real 28-entry card, four fat chapter summaries
     consumed 1,533 of 1,536 bytes, so a character entry that mattered more was
     dropped while a scene from sixty turns ago was injected. Raised so that
     relevance - not the size of whichever entry happens to be listed first -
     decides what survives. */
  var LORE_LIMIT = 10, LORE_BUDGET = 5000;
  var LORE_CHAT_LIMIT = 6, LORE_CHAT_BUDGET = 2048;

  /* v1.39.109: the window that keyword scanning reads.
     loreSample used to return ALL of history, so on turn 66 the scan text held
     the entire story: every proper noun ever mentioned still matched, every
     entry fired, and the budget was spent on whatever was listed first. Every
     engine descended from World Info scans a small window for exactly this
     reason.

     v1.39.111: the window is counted in TURNS, not messages, and it is
     computed once per request for every consumer.
     - A message is not a unit of story. Messages-per-turn drifts as a chat
       runs (multi-bubble replies, regenerations), so a constant in messages
       covered 19 turns at the start of the reported chat and 4 at the end of
       the same chat. 20 messages is 4 player turns there; LORE_SCAN_TURNS is
       what the number was always trying to say.
     - buildChat opened three separate windows on one history: lore over 20
       messages, the transcript trimmed to 8 by budget, and styleLock over
       those 8. The lore selector was choosing which facts to inject from a
       stretch of story the request had already cut, and styleLock was sizing
       a habit from however much history happened to fit. requestWindow()
       answers "what is recent" once; lore, the transcript and the style lock
       all read it. */
  /* Why 6: measured on the reported 160-message chat, windows of 4, 10, 20 and
     40 messages all admitted the entry the scene was about, so the smallest
     window that did the job was 4 turns' worth. 6 was taken for headroom - a
     player may speak twice before something is answered, and an entry keyed to
     the previous beat should not fall out between them. Larger buys nothing:
     past a few turns the scan text grows and the ranking, not the window, is
     what decides. */
  var LORE_SCAN_TURNS = 6;

  /* The transcript ceiling, in one place. It used to be written twice: the
     window took `s.contextMessages` as it came, trimHistory took `|| 40`, so an
     unset or zero setting meant "unbounded" to one and "40" to the other — and a
     preview built from the first was wrong about the second. The store's default
     is 40, so this is the same number for every real chat. */
  var DEFAULT_CONTEXT_MESSAGES = 40;
  /* v1.46.0: how little a memory pass is allowed to read. A chat set to six
     messages in context still has to be summarised over more than a beat of
     dialogue, or the summary records the reply it just saw and nothing else. */
  var SUMMARY_MIN_MESSAGES = 12;
  function contextMessageCeiling(s) {
    var n = parseInt(s && s.contextMessages, 10);
    return n > 0 ? n : DEFAULT_CONTEXT_MESSAGES;
  }

  /** The last `turns` player turns of a history, inclusive of the reply they
   *  answered. A turn starts at a user message; if the window would begin
   *  mid-turn it is extended back to the turn's opening message. */
  function lastTurns(history, turns) {
    var list = history || [];
    var n = parseInt(turns, 10);
    if (!(n > 0)) return list.slice();
    var seen = 0, start = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i] && list[i].role === 'user') {
        seen++;
        if (seen >= n) { start = i; break; }
      }
    }
    return list.slice(start);
  }

  /** The last `max` messages of a history, extended back to the opening of
   *  the turn it lands in mid-way, so a transcript never begins with an answer
   *  whose question was left out. Mirrors lastTurns' turn rule for the same
   *  reason: a reply read without the line it replies to invites the model to
   *  restart the beat. */
  function lastMessages(history, max) {
    var list = history || [];
    var n = parseInt(max, 10);
    if (!(n > 0) || n >= list.length) return list.slice();
    var start = list.length - n;
    while (start > 0 && list[start] && list[start].role !== 'user') start--;
    return list.slice(start);
  }

  /** The one answer to "what is recent", for the whole request.
   *  Both shapes are returned because the consumers want different things, and
   *  since v1.44.0 they are measured differently on purpose:
   *   - `sample` is what the lore scanner reads: LORE_SCAN_TURNS turns, or the
   *     card's own scan depth (loreWindow re-derives it when they differ).
   *   - `messages` is what the transcript carries: as many MESSAGES as the
   *     "Messages in context" setting allows, turn-aligned.
   *  They were the same number, which made that setting a ceiling nobody could
   *  raise: it is read by trimHistory after this window had already cut the
   *  history to six turns, so any value above 12 messages described a request
   *  the builder could not build. The window now gives the setting its own
   *  argument to govern, and the token budget (historyBudgetTokens) plus
   *  CONTEXT_CAP remain what actually bounds the request. */
  function requestWindow(history, s) {
    var list = history || [];
    var cap = contextMessageCeiling(s);
    var windowed = lastTurns(list, LORE_SCAN_TURNS);
    return {
      sample: loreSample(windowed),
      messages: lastMessages(list, cap),
      turns: LORE_SCAN_TURNS,
      /* reported, never re-derived: the inspector says which ceiling was in force */
      messageCap: cap,
      ceilingIsDefault: !(parseInt(s && s.contextMessages, 10) > 0)
    };
  }

  /* v1.40.0 (item 4c): how far back the keyword scan reads, per character. The
     6-turn default is the number v1.39.111 measured, and it is the window the
     transcript and the style lock read too - so this override applies to the
     LORE scan alone. Widening it can therefore never change how much history is
     sent, only which entry the scanner is allowed to notice. Bounded at 24
     turns: past that the ranking stops meaning "recent", the whole book fires,
     and the budget is spent on whichever entry is shortest.
     Compat mode lets a card NARROW the window with its own `scan_depth`, which
     the books count in MESSAGES - halved into turns here, because a message is
     not a unit of story (that is exactly why this app measures in turns). The
     conversion is stated rather than hidden: a book asking for 8 reads as 4. */
  var LORE_SCAN_MIN = 1, LORE_SCAN_MAX = 24;
  function loreScanTurns(char) {
    var n = parseInt(char && char.loreScanTurns, 10);
    if (!(n > 0)) n = LORE_SCAN_TURNS;
    var book = parseInt(char && char.loreBookScan, 10);
    if (char && char.loreCompat && book > 0) n = Math.min(n, Math.ceil(book / 2));
    return Math.max(LORE_SCAN_MIN, Math.min(LORE_SCAN_MAX, n));
  }
  /* What the book itself asked for, read out of the record the importer keeps whole
     (`cardSource.book` is the card's own book object, entries aside). Nothing is
     copied into a second field, so a character imported before this release answers
     the question exactly as one imported after it does — and a book that writes
     "true" as a string did not ask, which is the same strictness every other
     mirrored card flag gets. */
  function loreBookAsk(char) {
    var out = { recursion: false, depth: 0 };
    var b = char && char.cardSource && char.cardSource.book;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return out;
    out.recursion = b.recursive_scanning === true;
    var d = Number(b.recursion_depth);
    if (isFinite(d) && d > 0) out.depth = Math.floor(d);
    return out;
  }

  /* v1.47.0: a card's `use_regex` keys, compiled. The V3 spec is exact about the
     failure: "if the value in keys has invalid regex patterns the application MUST
     consider the lorebook field as not a match". So a pattern that will not compile
     takes the entry out; it does not fall back to plain text, because an entry
     authored as `/cat|dog/` matching the literal characters `/cat|dog/` is a card
     quietly doing something nobody wrote. The same refusal covers a pattern this
     engine cannot be asked to run — a group quantified inside and after itself, the
     shape that goes exponential — which is the check the display scripts already
     use, reused rather than re-invented: this runs on the phone on every turn.
     Compiled once per pattern, and the cache forgets rather than growing. */
  var LORE_CHAIN_MAX = 3;          /* hops a book may chain, whatever it asks for */
  var LORE_CHAIN_FROM = 20;        /* only this many of what the chat matched is read */
  var loreReCache = Object.create(null);
  var loreReN = 0;

  function lorePattern(key, caseSensitive) {
    var src = String(key == null ? '' : key).trim();
    if (!src) return { re: null, why: 'empty' };
    /* `/pattern/flags` is how several editors save a regex key; unwrapping it means
       the flags the author wrote are the flags that run, instead of a pattern whose
       leading slash matches nothing. */
    var flags = caseSensitive ? '' : 'i';
    var wrap = /^\/(.+)\/([a-z]{0,4})$/.exec(src);
    if (wrap && wrap[1].trim()) {
      src = wrap[1];
      if (wrap[2]) flags = wrap[2].replace(/[^imsuy]/g, '');
    }
    var ck = src + '\u0000' + flags;
    if (Object.prototype.hasOwnProperty.call(loreReCache, ck)) return loreReCache[ck];
    var out;
    if (scriptLooksEvil(src)) out = { re: null, why: 'nested repeat' };
    else {
      try { out = { re: new RegExp(src, flags), why: '' }; }
      catch (e) { out = { re: null, why: 'does not compile' }; }
    }
    if (loreReN > 256) { loreReCache = Object.create(null); loreReN = 0; }
    loreReCache[ck] = out; loreReN++;
    return out;
  }

  /** The options the lore matcher runs with for this character. */
  function loreOpts(char, s) {
    var budget = parseInt(char && char.loreBookBudget, 10);
    /* Two things a book can ask for that change what the model sees: regex keys, and
       one entry waking another. A card cannot approve itself — the same rule
       `honorCardSystemPrompt` runs on — so each needs the player's switch, and both
       ship off. `s` is optional because callers that have no settings to hand must
       keep getting today's behaviour, and "the card asked, the player did not agree"
       is that behaviour, not a bug in the caller. */
    var ask = loreBookAsk(char);
    var chain = ask.recursion && !!(s && s.honorCardRecursion === true);
    var depth = ask.depth;
    return {
      compat: !!(char && char.loreCompat),
      turns: loreScanTurns(char),
      /* the book's own token_budget, read only in compat mode, and only ever to
         narrow what the app allows - a card may tighten, never spend past the cap
         the Lore screen shows */
      tokenBudget: (char && char.loreCompat && budget > 0) ? budget : 0,
      regex: !!(s && s.honorCardRegex === true),
      chain: chain,
      /* `recursion_depth` is SillyTavern's bound on its own feature, and a card that
         asks for unlimited recursion gets this app's bound instead: three hops, no
         more. Below the floor and above the ceiling are both refused by clamping
         rather than by ignoring the field, so a book that says 1 really does one. */
      chainDepth: chain ? Math.max(1, Math.min(LORE_CHAIN_MAX, depth > 0 ? depth : 2)) : 0
    };
  }
  /** This character's scan window, or the shared one when they take the default. */
  function loreWindow(char, history, win) {
    var turns = loreScanTurns(char);
    if (win && turns === win.turns) return win.sample;
    return loreSample(history || [], turns);
  }

  function loreSample(history, turns) {
    var list = history || [];
    /* Turns, then the message cap is only a backstop for a history with no
       user messages at all. */
    var window = lastTurns(list, turns > 0 ? turns : LORE_SCAN_TURNS);
    var parts = window.map(function (m) { return String(m.text || ''); });
    var text = parts.join('\n');
    /* The newest turn is carried separately: an entry whose key the player has
       just written is more likely to be what the reply is about than one that
       only appeared a few messages back. */
    var newest = parts.length ? parts[parts.length - 1] : '';
    return { text: text, newest: newest, parts: parts };
  }
  /* Accept either the object loreSample returns or a plain string, so any
     caller that already hands over the text keeps working. */
  function scanText(sample) {
    if (sample && typeof sample === 'object') return String(sample.text || '');
    return String(sample || '');
  }
  function scanNewest(sample) {
    if (sample && typeof sample === 'object') return String(sample.newest || '');
    return '';
  }

  /* Rank every entry that may join this prompt, best first, and — when the book asks
     for it and the player agreed — read what those entries say for a second hop. */
  function loreRanks(entries, sample, stage, opts) {
    var o = opts || {};
    var raw = scanText(sample);
    var text = raw.toLowerCase();
    var activeStage = String(stage || '').trim().toLowerCase();
    /* Split the scan into messages so a match can be scored by how long ago
       it happened. "The newest message mentions it" and "it was mentioned
       forty turns ago" were previously the same yes/no answer, which is why a
       wide window produced an arbitrary top ten. */
    var lines = (sample && typeof sample === 'object' && Array.isArray(sample.parts))
      ? sample.parts.map(function (p) { return String(p || '').toLowerCase(); })
      : null;
    var rawLines = lines && (sample || {}).parts
      ? sample.parts.map(function (p) { return String(p || ''); }) : null;

    /* One key, one answer, for both places a key is asked about — the match and the
       recency score. If those two used different rules an entry would rank by a
       sighting that never happened, which is how "it matched but came in last" gets
       reported as a bug in the ranking. */
    function stands(e, patterns, key, hay, low) {
      var cs = e.caseSensitive === true;
      if (patterns) {
        var p = lorePattern(key, cs);
        return p.re ? p.re.test(hay) : false;
      }
      return keyStands(cs ? hay : low, key, cs);
    }
    function recencyOf(e, patterns, keys) {
      if (!lines) return 0;
      var cs = e.caseSensitive === true;
      var where = (cs || patterns) ? (rawLines || [raw]) : (lines || [text]);
      for (var back = 0; back < where.length; back++) {
        var line = where[where.length - 1 - back];
        for (var i = 0; i < keys.length; i++) {
          if (keys[i] && stands(e, patterns, keys[i], line, String(line).toLowerCase())) return back;
        }
      }
      return where.length;
    }

    var out = [], bad = Object.create(null);
    var seen = Object.create(null);

    function evaluate(e, index, isChain) {
      if (!e || e.enabled === false) return null;
      var requiredStage = String(e.stage || '').trim().toLowerCase();
      if (requiredStage && requiredStage !== '*' && (!activeStage || requiredStage !== activeStage)) return null;
      var constant = e.constant === true;
      var keys = e.keys || [];
      /* `use_regex` is V3's per-entry flag and it is strict: a card that writes
         "true" as a string is not asking for patterns, exactly as `selective` and
         `case_sensitive` already behave. Only when the player's switch is on. */
      var patterns = !!(o.regex && e.useRegex === true);
      /* `case_sensitive` (V2/V3) decides which casing of the scan window the
         keys are looked for in. Everything else in the ranking is unaffected —
         except a pattern entry, where the pattern's own flags decide and the text
         is matched as written, because lowercasing "Vlad" would silently rewrite
         what the author's regular expression says. */
      var broken = '';
      var row_broken = '';
      if (patterns) {
        for (var ki = 0; ki < keys.length; ki++) {
          if (!String(keys[ki] || '').trim()) continue;   /* no key, not a broken one */
          var pr = lorePattern(keys[ki], e.caseSensitive === true);
          if (!pr.re) { broken = pr.why || 'invalid'; break; }
        }
        /* A constant entry stays constant: the spec says a pattern entry SHOULD
           ignore `constant`, and obeying that would delete an always-on fact because
           a key was written badly — the one outcome an author cannot see coming. */
        /* once per entry, whatever the pass: a chain re-reads the same book and must
           not report the same broken key three times to the screen */
        row_broken = broken;   /* a constant entry still says it, below */
        if (broken && !constant) {
          if (!bad[index]) bad[index] = { index: index, why: broken, keys: keys.length };
          return null;
        }
      }
      var hay = raw, matched = keys.filter(function (k) { return k && stands(e, patterns, k, hay, text); });
      if (!constant && !matched.length) return null;
      /* `selective` + `secondary_keys`, the V2 pair, honoured since v1.40.0.
         The spec is exact, and this follows it word for word: `selective: true`
         requires a key from `keys` AND a key from `secondary_keys`; with
         `selective` false or absent the secondary list is IGNORED, so an entry
         that does not opt in keeps the ordinary primary-key behaviour it has
         always had. Secondary keys alone never wake an entry - the primary match
         is always required. A `selectiveLogic` (a SillyTavern field, not a spec
         one) is not implemented: its four variants are that client's meaning,
         not a meaning verified here, so the entry falls back to the boolean
         rule above and the import note says so rather than guessing.
         V3 says a pattern entry SHOULD ignore `secondary_keys`, and it does: a
         `selective` pair on a regex entry is two different rules for one key, and
         the pattern is the one the author wrote last. The Lore screen says so. */
      var sec = (!patterns && e.selective === true && Array.isArray(e.secondaryKeys))
        ? e.secondaryKeys.filter(function (k) { return !!k; }) : [];
      if (sec.length && !sec.some(function (k) { return stands(e, patterns, k, hay, text); })) return null;
      return {
        entry: e, index: index, constant: constant,
        /* v1.47.0: what this row is made of, so the Lore screen can say it without
           recomputing anything: `patterns` is why it fired on a shape rather than a
           word, `broken` that a key was unusable, `chain` that the chat did not
           mention it at all. */
        patterns: patterns, broken: row_broken, chain: !!isChain,
        /* v1.40.0 (item 6.6): an entry the author marked essential is admitted
           ahead of everything that is not constant, so a tight budget spends
           itself on what the card says the story cannot do without. */
        essential: e.essential === true,
        /* 0 = mentioned in the message being answered; higher = older */
        recency: constant ? -1
          : (isChain ? LORE_CHAIN_FROM + isChain : recencyOf(e, patterns, matched.length ? matched : keys)),
        keyCount: constant ? keys.length : matched.length,
        keys: keys.length, cost: String(e.content || '').length
      };
    }

    (entries || []).forEach(function (e, index) {
      var r = evaluate(e, index, 0);
      if (r) { out.push(r); seen[index] = 1; }
    });

    /* Chaining: a book whose `recursive_scanning` is true asks that an entry which
       came in can wake a second one, which is the one lorebook behaviour that
       changes what the model sees the most. So it is bounded three times: at most
       this many hops however long the book asks, an entry can only come in once,
       and only what the chat itself matched is read for the next hop. A chained row
       is scored below every row the chat matched, so a chain can fill the space the
       conversation left over and can never displace an entry the player's own words
       brought in. */
    if (o.chain) {
      out.sort(function (a, b) { return rankCompare(a, b); });
      var pool = out.slice(0, LORE_CHAIN_FROM);
      var extra = pool.map(function (r) { return String(r.entry.content || ''); }).join('\n');
      for (var pass = 1; pass <= (o.chainDepth || 1); pass++) {
        if (!extra) break;
        raw = scanText(sample) + '\n' + extra;
        text = raw.toLowerCase();
        var added = 0, more = [];
        (entries || []).forEach(function (e, index) {
          if (seen[index]) return;
          var r = evaluate(e, index, pass);
          if (r) { more.push(r); seen[index] = 1; added++; }
        });
        out = out.concat(more);
        if (!added) break;
        extra += '\n' + more.map(function (r) { return String(r.entry.content || ''); }).join('\n');
      }
    }
    out.sort(function (a, b) { return rankCompare(a, b); });
    /* What the card asked for that this app could not use, reported on the array for
       the Lore screen (the same trick loreAdmit uses for `skips`: it belongs to this
       one call, and every other caller maps the list and never sees it). */
    out.bad = Object.keys(bad).map(function (k) { return bad[k]; }).sort(function (x, y) { return x.index - y.index; });
    out.ranked = out.length;
    return out;
  }

  /* The order of precedence, once, for the ranking and for the chain's source pool.
     1. constant - the author's own "always" flag, honoured first
     2. not chained - what the conversation mentioned outranks what an entry said
     3. essential - then recency: mentioned in the message being answered beats
        mentioned forty turns ago
     4. key count, 5. specificity (fewer keys = a more deliberate match),
     6. shorter, 7. book order.
     Nothing here looks at book order except last. On a real card the chapters are
     listed before the characters, and with a flat scan the chapters always won. */
  function rankCompare(a, b) {
    if (a.constant !== b.constant) return a.constant ? -1 : 1;
    if (!!a.chain !== !!b.chain) return a.chain ? 1 : -1;
    if (a.essential !== b.essential) return a.essential ? -1 : 1;
    if (a.recency !== b.recency) return a.recency - b.recency;
    if (a.keyCount !== b.keyCount) return b.keyCount - a.keyCount;
    if (a.keys !== b.keys) return a.keys - b.keys;
    if (a.cost !== b.cost) return a.cost - b.cost;
    return a.index - b.index;
  }

  /* Admit ranked entries until the count or the byte budget runs out. A single
     entry larger than the whole budget is still admitted when it is first, so
     a lone long entry is not silently dropped. */
  function loreAdmit(ranked, limit, budget, opts) {
    var max = limit || LORE_LIMIT, cap = (typeof budget === 'number' && budget > 0) ? budget : LORE_BUDGET;
    /* Compat mode (item 4b) also reads the book's own budget, and drops by the
       spec's rule - V3: "remove the lowest priority lorebook fields if the total
       token count exceeds token_budget". Priority and insertion_order are only
       ever read here, never as a substitute for relevance ranking. */
    var o = opts || {};
    if (o.compat && o.tokenBudget > 0) cap = Math.min(cap, o.tokenBudget * 4);
    var out = [], bytes = 0;
    var list = ranked;
    if (o.compat) {
      /* Only the cut changes: the candidate set is still the entries the scan
         matched, and `insertion_order` still only decides where an admitted
         entry is put. What compat mode asks for is the book's own rule for WHO
         loses when the budget runs out - V3: "remove the lowest priority
         lorebook fields if the total token count exceeds token_budget". So the
         HIGH priority number is admitted first and the low one is what falls
         off the end, which is the same outcome arrived at from the other side. */
      list = ranked.slice().sort(function (a, b) {
        if (a.constant !== b.constant) return a.constant ? -1 : 1;
        if (a.essential !== b.essential) return a.essential ? -1 : 1;
        var pa = numField(a.entry.priority, 50), pb = numField(b.entry.priority, 50);
        if (pa !== pb) return pb - pa;      /* highest priority admitted first */
        if (a.recency !== b.recency) return a.recency - b.recency;
        return a.index - b.index;
      });
    }
    var skips = {};
    list.forEach(function (r) {
      /* v1.42.2: when an entry is passed over, say why HERE. Both ceilings can
         be shut on the same entry, and only this walk knows which one was full
         at the moment it was turned away - loreDiagnostics used to work it out
         afterwards from a counter of its own and got it wrong (see there). The
         order of the two tests is unchanged, so the limit still wins the
         description when both are true, and `both` records the rest. */
      var why = '';
      var both = false;
      if (out.length >= max) { why = 'limit'; both = !!(out.length && bytes + r.cost > cap); }
      else if (out.length && bytes + r.cost > cap) { why = 'budget'; }
      if (why) { skips[r.index] = { why: why, both: both }; return; }
      out.push(r);
      bytes += r.cost;
    });
    /* Deterministic, and reported by loreDiagnostics rather than remembered
       here: an entry the author called essential outranks the rest, and if the
       essentials alone fill the budget the others are cut. No counter is kept on
       the function - this runs once per request, and a tally that survives from
       one request to the next is a bug waiting for a second chat. `skips` is a
       property on the returned array for the same reason: it belongs to this one
       call, and every other caller maps the list and never sees it. */
    out.skips = skips;
    return out;
  }

  /* Item 4b: the order and the place an admitted entry is put, which is a
     different question from which entries got in. Only in compat mode, because
     Horde ranks by relevance and a card that sorts by book order would lose the
     fix in v1.39.109 that stopped chapters crowding out the scene. */
  /* The card's numbers are read loosely - an `insertion_order` written as "10"
     is still 10 - and a value that is not a number at all falls back to the
     default the engines ship (100 for order, 50 for priority). Loose reading is
     only ever for matching: the entry keeps the bytes it arrived with. */
  function numField(v, dflt) {
    if (v === '' || v === null || v === undefined) return dflt;
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }

  function lorePlacements(hits, opts) {
    var groups = { before: [], middle: [], after: [] };
    (hits || []).forEach(function (e) { groups.middle.push(e); });
    if (!opts || !opts.compat) return groups;
    /* Wrapped in {e, i} so the book position can be the last tiebreak without
       a scratch property being written onto the stored entry. */
    var items = (hits || []).map(function (e, i) { return { e: e, i: i }; });
    groups.before = []; groups.middle = []; groups.after = [];
    items.forEach(function (it) {
      /* V2 spells the two values `before_char` / `after_char`; anything else,
         including `before_character` from a hand-edited card, stays in the
         sheet's own world-facts block rather than being guessed at. */
      if (it.e.position === 'before_char') groups.before.push(it);
      else if (it.e.position === 'after_char') groups.after.push(it);
      else groups.middle.push(it);
    });
    function byOrder(a, b) {
      var oa = numField(a.e.insertionOrder, 100), ob = numField(b.e.insertionOrder, 100);
      /* lower insertion_order = inserted higher, per the V2 field comment */
      return oa !== ob ? oa - ob : a.i - b.i;
    }
    groups.before.sort(byOrder); groups.middle.sort(byOrder); groups.after.sort(byOrder);
    ['before', 'middle', 'after'].forEach(function (k) {
      groups[k] = groups[k].map(function (it) { return it.e; });
    });
    return groups;
  }

  function loreHits(entries, sample, limit, budget, stage, opts) {
    if (!entries || !entries.length) return [];
    var admitted = loreAdmit(loreRanks(entries, sample, stage, opts), limit, budget, opts);
    var out = admitted.map(function (r) { return r.entry; });
    /* v1.44.0: the entries that did not get in, and why. `map` above used to
       drop the `skips` loreAdmit attaches, and the prompt path has no use for
       them — but the inspector asks "which of my lore was cut", and re-running
       the ranking to answer it would be a second answer to one question. A
       property on the array, so every existing reader of loreHits still gets
       the same array of entries it always got. */
    out.skips = admitted.skips || {};
    return out;
  }

  /* Per-chat continuity state is deliberately generic: the app stores approved
     scene facts and knowledge provenance; the model may only propose changes. */
  function emptyContinuity() {
    return { enabled: false, stage: '', location: '', time: '', participants: [], knowledge: [], objects: [], events: [] };
  }

  function normalizeContinuity(raw) {
    raw = raw && typeof raw === 'object' ? raw : {};
    function text(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
    function listStrings(a, max, cap) {
      var out = [], seen = {};
      (Array.isArray(a) ? a : []).slice(0, cap * 2).forEach(function (v) {
        var x = text(v, max), k = x.toLowerCase();
        if (x && !seen[k] && out.length < cap) { seen[k] = true; out.push(x); }
      });
      return out;
    }
    var knowledge = [];
    (Array.isArray(raw.knowledge) ? raw.knowledge : []).slice(0, 100).forEach(function (f) {
      if (!f || typeof f !== 'object') return;
      var who = text(f.who, 80), fact = text(f.fact, 320), basis = text(f.basis, 200);
      if (!who || !fact) return;
      if (!knowledge.some(function (x) { return x.who.toLowerCase() === who.toLowerCase() && x.fact.toLowerCase() === fact.toLowerCase(); })) {
        knowledge.push({ who: who, fact: fact, basis: basis });
      }
    });
    var objects = [];
    (Array.isArray(raw.objects) ? raw.objects : []).slice(0, 100).forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var name = text(o.name, 100), state = text(o.state, 160), holder = text(o.holder, 80), basis = text(o.basis, 200);
      if (!name || !state) return;
      var prev = objects.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
      if (!prev && objects.length < 80) objects.push({ name: name, state: state, holder: holder, basis: basis });
    });
    var events = [];
    (Array.isArray(raw.events) ? raw.events : []).slice(0, 100).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      var name = text(e.name, 120), status = e.status === 'resolved' ? 'resolved' : 'open', detail = text(e.detail, 240);
      if (!name) return;
      var prev = events.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
      if (!prev && events.length < 80) events.push({ name: name, status: status, detail: detail });
    });
    return {
      enabled: raw.enabled === true,
      stage: text(raw.stage, 120), location: text(raw.location, 160), time: text(raw.time, 120),
      participants: listStrings(raw.participants, 80, 24), knowledge: knowledge.slice(0, 80), objects: objects, events: events
    };
  }

  /* v1.39.105: does this ledger actually hold anything approved?
     A ledger with the switch on and nothing in it used to inject ~1,500
     characters of protocol that stated nothing, and one of its lines was
     actively harmful: with no cast listed it still said "only characters
     listed as present may speak or act", so a chat whose ledger had a
     location and nothing else was told that nobody present could speak.
     Nothing approved means nothing to say. */
  function continuityHasState(c) {
    if (!c) return false;
    return !!(c.stage || c.location || c.time ||
      c.participants.length || c.knowledge.length || c.objects.length || c.events.length);
  }

  function continuityPrompt(session) {
    var raw = session && session.continuity;
    if (!raw || raw.enabled !== true) return '';
    var c = normalizeContinuity(raw);
    /* Enabled but blank is worth less than disabled: it costs tokens and says
       nothing. The switch stays on, so the moment there is something approved
       this starts appearing - it just does not pretend to a state it has not
       been given. */
    if (!continuityHasState(c)) return '';
    var scene = [];
    if (c.stage) scene.push('Stage: ' + c.stage);
    if (c.location) scene.push('Location: ' + c.location);
    if (c.time) scene.push('Time: ' + c.time);
    /* Only fields that were actually approved. "(not set)" is not a fact, and
       printing it invites the model to write the placeholder into the story. */
    var lines = [
      'CHAT CONTINUITY LEDGER — USER-APPROVED STATE',
      'This state belongs only to this chat. Treat it as authoritative over model-invented details. It is not automatically public knowledge to every character.'
    ].concat(scene);
    lines.push('Present in scene: ' + (c.participants.length
      ? c.participants.join(', ')
      : '(not listed; keep the cast you already have and do not introduce anyone new)'));
    lines.push('Never put words, actions, thoughts, memories, or unrecorded knowledge into the user character.' +
      (c.participants.length
        /* the cast rule only bites when there is a cast - see above */
        ? ' Only characters listed as present may speak or act in this scene; show a transition before anyone enters, leaves, or changes location.'
        : ' Do not invent a new character into the scene without showing a transition; anyone already present may continue to act.'));
    var present = {};
    c.participants.forEach(function (n) { present[n.toLowerCase()] = true; });
    var gm = [], shared = [], user = [], npc = [];
    c.knowledge.forEach(function (f) {
      var who = f.who.toLowerCase(), line = f.who + ' knows: ' + f.fact + (f.basis ? ' (basis: ' + f.basis + ')' : '');
      if (who === 'narrator only' || who === 'gm only' || who === 'world truth') gm.push(line);
      else if (who === 'user' || who === '{{user}}') user.push(line);
      else if (who === 'everyone' || who === 'all' || who === 'shared') shared.push(line);
      else if (present[who]) npc.push(line);
    });
    if (gm.length) lines.push('Narrator-only world facts (not NPC knowledge; reveal only through established evidence):\n- ' + gm.join('\n- '));
    if (shared.length) lines.push('Approved shared knowledge:\n- ' + shared.join('\n- '));
    if (user.length) lines.push('Facts explicitly known to {{user}}:\n- ' + user.join('\n- '));
    if (npc.length) lines.push('Knowledge of present NPCs only:\n- ' + npc.join('\n- '));
    if (c.objects.length) lines.push('Important object states (approved; not proof that every character knows them):\n- ' + c.objects.map(function (o) { return o.name + ': ' + o.state + (o.holder ? ' (held by ' + o.holder + ')' : '') + (o.basis ? ' (basis: ' + o.basis + ')' : ''); }).join('\n- '));
    var open = c.events.filter(function (e) { return e.status === 'open'; });
    var done = c.events.filter(function (e) { return e.status === 'resolved'; });
    if (open.length) lines.push('Open events:\n- ' + open.map(function (e) { return e.name + (e.detail ? ' — ' + e.detail : ''); }).join('\n- '));
    if (done.length) lines.push('Resolved events (do not repeat or reopen without a new cause):\n- ' + done.map(function (e) { return e.name + (e.detail ? ' — ' + e.detail : ''); }).join('\n- '));
    lines.push('Do not silently change this ledger. If a concrete event changes location, cast, object state, knowledge, or an open/resolved event, append a JSON proposal in <continuity_update> at the very end of the reply. Use exactly this outer shape: {"reason":"brief evidence from the chat","changes":[{"type":"scene","op":"set","field":"location","value":"..."}]}. Other change shapes: participant {type,op,name}; knowledge {type,op,who,fact,basis}; object {type,op,name,state,holder,basis}; event {type,op,name,detail}. Propose only changes explicitly established in this chat; never promote a guess, canon fact, or hidden truth to NPC knowledge. The app will ask the user to approve or dismiss it. Omit the tag when no durable state changed. Allowed: scene set (stage/location/time), participant add/remove, knowledge add/remove (who/fact; add also needs basis), object set/remove (name/state; include holder/basis when supported), event add/resolve/reopen/remove.');
    return lines.join('\n');
  }

  var CONTINUITY_UPDATE_RE = /<continuity_update\b[^>]*>([\s\S]*?)<\/continuity_update\s*>/gi;
  function parseContinuityUpdate(text) {
    var source = String(text || ''), m, last = null;
    CONTINUITY_UPDATE_RE.lastIndex = 0;
    while ((m = CONTINUITY_UPDATE_RE.exec(source))) last = m;
    if (!last || last[1].length > 6000) return null;
    var raw;
    try { raw = JSON.parse(last[1].trim()); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.changes) || !raw.changes.length || raw.changes.length > 20) return null;
    function clip(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
    var changes = [];
    raw.changes.forEach(function (x) {
      if (!x || typeof x !== 'object') return;
      var type = String(x.type || ''), op = String(x.op || '');
      if (type === 'scene' && op === 'set' && ['stage', 'location', 'time'].indexOf(x.field) !== -1) {
        /* v1.39.102: each scene field is clipped to the same ceiling the
           ledger stores it at. They used to share one 160 ceiling, so a long
           stage or time was shown to the reviewer in full and then silently
           cut to 120 on save - the approved change and the saved change were
           not the same string. */
        var cap = (x.field === 'location') ? 160 : 120;
        var value = clip(x.value, cap); if (value) changes.push({ type: type, op: op, field: x.field, value: value });
      } else if (type === 'participant' && ['add', 'remove'].indexOf(op) !== -1) {
        var name = clip(x.name, 80); if (name) changes.push({ type: type, op: op, name: name });
      } else if (type === 'knowledge' && ['add', 'remove'].indexOf(op) !== -1) {
        var who = clip(x.who, 80), fact = clip(x.fact, 320);
        var basis = clip(x.basis, 200);
        if (who && fact && (op === 'remove' || basis)) changes.push({ type: type, op: op, who: who, fact: fact, basis: basis });
      } else if (type === 'object' && ['set', 'remove'].indexOf(op) !== -1) {
        var objectName = clip(x.name, 100), objectState = clip(x.state, 160);
        var holder = clip(x.holder, 80), objectBasis = clip(x.basis, 200);
        if (objectName && (op === 'remove' || objectState)) changes.push({ type: type, op: op, name: objectName, state: objectState, holder: holder, basis: objectBasis });
      } else if (type === 'event' && ['add', 'resolve', 'reopen', 'remove'].indexOf(op) !== -1) {
        var event = clip(x.name, 120), detail = clip(x.detail, 240);
        if (event) changes.push({ type: type, op: op, name: event, detail: detail });
      }
    });
    if (!changes.length) return null;
    return { reason: clip(raw.reason, 300) || 'A story event may warrant a continuity update.', changes: changes };
  }

  function stripContinuityUpdate(text) {
    return String(text || '').replace(/<continuity_update\b[^>]*>[\s\S]*?(?:<\/continuity_update\s*>|$)/gi, '').trim();
  }
  function hideContinuityUpdate(text) {
    var t = String(text || ''), m = /<continuity_update\b/i.exec(t);
    return m ? t.slice(0, m.index).replace(/\s+$/, '') : t;
  }
  function applyContinuityProposal(current, proposal) {
    var next = normalizeContinuity(current);
    if (!proposal || !Array.isArray(proposal.changes)) return next;
    proposal.changes.forEach(function (x) {
      if (x.type === 'scene' && x.op === 'set') next[x.field] = x.value;
      else if (x.type === 'participant') {
        if (x.op === 'add' && !next.participants.some(function (n) { return n.toLowerCase() === x.name.toLowerCase(); }) && next.participants.length < 24) next.participants.push(x.name);
        if (x.op === 'remove') next.participants = next.participants.filter(function (n) { return n.toLowerCase() !== x.name.toLowerCase(); });
      } else if (x.type === 'knowledge') {
        if (x.op === 'add' && !next.knowledge.some(function (f) { return f.who.toLowerCase() === x.who.toLowerCase() && f.fact.toLowerCase() === x.fact.toLowerCase(); }) && next.knowledge.length < 80) next.knowledge.push({ who: x.who, fact: x.fact, basis: x.basis });
        if (x.op === 'remove') next.knowledge = next.knowledge.filter(function (f) { return !(f.who.toLowerCase() === x.who.toLowerCase() && f.fact.toLowerCase() === x.fact.toLowerCase()); });
      } else if (x.type === 'object') {
        var object = next.objects.find(function (o) { return o.name.toLowerCase() === x.name.toLowerCase(); });
        if (x.op === 'remove') next.objects = next.objects.filter(function (o) { return o.name.toLowerCase() !== x.name.toLowerCase(); });
        else if (object) { object.state = x.state; object.holder = x.holder || ''; object.basis = x.basis || ''; }
        else if (next.objects.length < 80) next.objects.push({ name: x.name, state: x.state, holder: x.holder || '', basis: x.basis || '' });
      } else if (x.type === 'event') {
        var old = next.events.find(function (e) { return e.name.toLowerCase() === x.name.toLowerCase(); });
        if (x.op === 'remove') next.events = next.events.filter(function (e) { return e.name.toLowerCase() !== x.name.toLowerCase(); });
        else if (x.op === 'add' && !old && next.events.length < 80) next.events.push({ name: x.name, status: 'open', detail: x.detail });
        else if (x.op === 'resolve' || x.op === 'reopen') {
          if (old) { old.status = x.op === 'resolve' ? 'resolved' : 'open'; if (x.detail) old.detail = x.detail; }
          else if (next.events.length < 80) next.events.push({ name: x.name, status: x.op === 'resolve' ? 'resolved' : 'open', detail: x.detail });
        }
      }
    });
    return normalizeContinuity(next);
  }

  /* Scene cast (multi-person cards): who is present here and who is
     elsewhere. Appended at the very end of the prompt so it is the
     most recent instruction — and worded to override the card. */
  function sceneCastPrompt(session, userName) {
    var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    /* v1.39.77: one name is not a cast. The strip hides below two, and the
       prompt must agree with the screen — otherwise a single-character card
       silently carries "SCENE CAST — THIS OVERRIDES THE CARD" on every turn,
       which is both a waste and an instruction the user never asked for. */
    if (cast.length < 2) return '';
    var presentNow = cast.filter(function (n) { return (session.scenePresent || []).indexOf(n) !== -1; });
    var awayNow = cast.filter(function (n) { return (session.scenePresent || []).indexOf(n) === -1; });
    var lines = [];
    if (presentNow.length) lines.push('Present in this scene: ' + presentNow.join(', ') + ', ' + userName);
    if (awayNow.length) lines.push('Elsewhere and out of the scene: ' + awayNow.join(', '));
    if (!lines.length) return '';
    /* v1.39.82: the block used to be a roster and nothing else — who is here,
       who is not, and one prohibition. A model handed three names and no
       rules either blends them into one narrator or writes a round-robin in
       which everyone gets a paragraph. These four sentences are the
       difference between a scene and a list. */
    return 'SCENE CAST — THIS OVERRIDES THE CARD: ' + lines.join('. ') +
      '. Characters listed as elsewhere never speak, react, act, or get narrated in this reply, even if the card or examples show them speaking.' +
      ' When someone present speaks or acts, name them in the prose so it is never ambiguous who did it.' +
      ' More than one present character may act in a reply, but do not give each of them a turn: write the beat that the moment calls for and let the others stay quiet.' +
      ' Never write ' + userName + "'s words, thoughts or actions — leave them to the player.";
  }

  /* v1.40.0 (item 6): the fields Horde Studio owns, in
     `extensions.horde_studio.*`. All optional, all read only when present, and
     each one is a HEADING over content the model previously had to infer from
     raw prose. Nothing here invents an instruction for a card that does not ask
     for one - the block simply does not exist for such a card. Every field is
     plainText()'d and capped at import (store.js, `cardDirectives`), so these
     cannot smuggle an essay into the head of the request, and what does land is
     part of the character sheet, which cardTokens() counts. */
  var DIRECTIVES = [
    /* how much the player may tell the character's head */
    ['agency', 'Player agency'],
    /* how the prose should read */
    ['style', 'Narration and style'],
    /* what the card treats as settled */
    ['canon', 'Canon boundaries'],
    /* how the story is meant to move */
    ['progression', 'Story progression'],
    /* slow-burn gates, if the card declares any */
    ['stages', 'Stage controls'],
    /* what must survive the budget */
    ['priority', 'Essential information']
  ];
  /* What one instruction line may cost in the prompt. The character's own copy is
     carried in full (store.js CARRY_CAP) so nothing is lost from the card, but a
     sheet that grew because a player pasted a manifesto would squeeze the
     transcript out of the request. 600 characters per field is about 150 tokens -
     more than most cards want and far less than most players paste. */
  var DIRECTIVE_CHARS = 600;
  function directiveBlock(char, s) {
    var d = (char && char.directives) || {};
    var lines = [];
    DIRECTIVES.forEach(function (pair) {
      var txt = plainText(String(d[pair[0]] || '')).replace(/\s+/g, ' ').trim();
      if (!txt) return;
      var cut = txt.length > DIRECTIVE_CHARS;
      if (cut) txt = txt.slice(0, DIRECTIVE_CHARS).replace(/\s+$/, '') + ' …';
      /* expanded like every other piece of card-authored text, so an author can
         write {{char}}/{{user}} here and does not have to know which fields this
         app runs macros through */
      lines.push(pair[1] + ': ' + macros(txt, char, s) + (cut ? ' [truncated by Horde at ' + DIRECTIVE_CHARS + ' characters]' : ''));
    });
    return lines.length ? 'CARD INSTRUCTIONS FOR HORDE STUDIO:\n' + lines.join('\n') : '';
  }

  /* `stats` is an optional sink: the prompt builders pass an object and get
     told what the lore admission cost them. Nothing else reads it, and a caller
     that omits it changes nothing about the prompt — the sheet is the same
     string either way. */
  function charSheet(char, s, session, recent, assistantTurns, opts, stats) {
    var lo = opts || loreOpts(char);
    var head = [], parts = [];
    var persona = macros(plainText(char.persona), char, s);
    if (persona) parts.push(persona);
    var scenario = macros(plainText(char.scenario), char, s);
    if (scenario) parts.push('Current situation: ' + scenario);
    if (s.userPersona) parts.push('About {{user}}: '.replace('{{user}}', s.userName) + s.userPersona);
    var state = statePrompt(char);
    if (state) parts.push(state);
    var sceneNote = '';
    if (session && String(session.sceneNote || '').trim()) {
      var frequency = parseInt(session.sceneNoteFrequency, 10);
      if (!(frequency > 0)) frequency = 1;
      if ((assistantTurns || 0) % frequency === 0) {
        sceneNote = macros(plainText(session.sceneNote), char, s);
      }
    }
    var scenePlacement = session && session.sceneNotePlacement || 'end';
    if (sceneNote && scenePlacement === 'character') parts.push('Scene note: ' + sceneNote);

    var activeStage = session && session.continuity && session.continuity.enabled ? session.continuity.stage : '';
    var lore = loreHits(char.lorebook, recent, LORE_LIMIT, LORE_BUDGET, activeStage, lo);
    if (stats) {
      var lbook = char.lorebook || [];
      var lskips = lore.skips || {};
      stats.lore = {
        total: lbook.length, admitted: lore.length,
        limit: LORE_LIMIT, budget: LORE_BUDGET,
        turns: (lo && lo.turns) || LORE_SCAN_TURNS,
        compat: !!(lo && lo.compat),
        skipped: Object.keys(lskips).map(function (i) {
          var e = lbook[i] || {};
          return {
            entry: Number(i), why: lskips[i].why, both: !!lskips[i].both,
            keys: String((e.keys || []).join(', ')).slice(0, 120),
            chars: String(e.content || '').length
          };
        })
      };
    }
    /* Item 4b: `position` and `insertion_order` decide where an ADMITTED entry
       goes, which is a different question from which entries got in - that stays
       relevance-ranked in every mode. Horde's layout has one place for world
       facts, so by default the book's own ordering is preserved and not applied.
       Turning on the card's lore ordering puts `before_char` entries ahead of the
       sheet and `after_char` entries after it, each group sorted by
       `insertion_order`. */
    var groups = lorePlacements(lore, lo);
    lore = groups.middle;
    if (groups.before.length) {
      head.push('World facts (before the character):\n' + groups.before.map(function (e) {
        return '- ' + macros(plainText(e.content), char, s);
      }).join('\n'));
    }
    if (lore.length) {
      parts.push('Relevant world facts:\n' + lore.map(function (e) {
        return '- ' + macros(plainText(e.content), char, s);
      }).join('\n'));
    }
    /* Chat lore supplements the character's baseline world facts but only
       for this transcript. It is intentionally placed afterward so a
       timeline-specific fact can clarify an otherwise shared canon detail. */
    var chatLore = session && Array.isArray(session.chatLorebook)
      ? loreHits(session.chatLorebook, recent, LORE_CHAT_LIMIT, LORE_CHAT_BUDGET, activeStage) : [];
    if (chatLore.length) {
      parts.push('Relevant chat-only facts:\n' + chatLore.map(function (e) {
        return '- ' + macros(plainText(e.content), char, s);
      }).join('\n'));
    }
    if (session && (session.summary || (session.facts && session.facts.length))) {
      var mem = [];
      if (session.summary) mem.push('Story so far: ' + repairMojibake(session.summary));
      /* v1.39.104: what the chat holds true now, newest first and dated with
         the message count it was learned at. A superseded fact stays on the
         chat but is never offered here as current - that is what used to put
         a stale promise or a finished plan in front of the character. */
      var chatNow = currentChatFacts(session).slice()
        .sort(function (a, b) { return (b.from || 0) - (a.from || 0); });
      if (chatNow.length) {
        mem.push('Established facts (each still true; the message it was learned at in brackets):\n' +
          chatNow.map(function (f) { return '- ' + repairMojibake(f.text) + ' [' + (f.from || 0) + ']'; }).join('\n'));
      }
      parts.push(mem.join('\n'));
    }
    if (sceneNote && scenePlacement === 'memory') parts.push('Scene note: ' + sceneNote);
    var continuity = continuityPrompt(session);
    if (continuity) parts.push(continuity);
    var post = postHistoryMode(char) === 'sheet' ? postHistoryText(char, s) : '';
    if (post) parts.push(post);
    if (sceneNote && scenePlacement !== 'character' && scenePlacement !== 'memory') parts.push('Scene note: ' + sceneNote);
    if (groups.after.length) {
      parts.push('World facts (after the character):\n' + groups.after.map(function (e) {
        return '- ' + macros(plainText(e.content), char, s);
      }).join('\n'));
    }
    var dirs = directiveBlock(char, s);
    /* Labelled rather than appended bare: the sheet is a list of things the
       model is told, and an instruction with no heading is the kind of line a
       model reads as fiction. It sits last inside the sheet, above the examples
       and the transcript. */
    if (dirs) parts.push(dirs);
    return head.concat(parts.filter(Boolean)).join('\n\n');
  }

  /* ---------------- per-chat player RPG ledger ---------------- */
  var RPG_UPDATE_RE = /<rpg_update\b[^>]*>([\s\S]*?)<\/rpg_update\s*>/gi;

  function parseRpgUpdate(text) {
    var source = String(text || ''), match = null, m;
    RPG_UPDATE_RE.lastIndex = 0;
    while ((m = RPG_UPDATE_RE.exec(source))) match = m;
    if (!match || match[1].length > 8000) return null;
    var raw;
    try { raw = JSON.parse(match[1].trim()); } catch (e) { return null; }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.changes) || !raw.changes.length || raw.changes.length > 20) return null;
    var changes = [];
    raw.changes.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var field = String(c.field || ''), op = String(c.op || ''), value = c.value;
      if (field === 'xp' && (op === 'add' || op === 'set')) {
        var n = Number(value);
        if (isFinite(n) && Math.floor(n) === n && Math.abs(n) <= 1000000 && (op !== 'set' || n >= 0)) {
          changes.push({ field: field, op: op, value: n });
        }
      } else if (field === 'level' && op === 'set' && (typeof value === 'string' || typeof value === 'number')) {
        var level = String(value).trim().slice(0, 40);
        if (level) changes.push({ field: field, op: op, value: level });
      } else if (field === 'attributes' && (op === 'set' || op === 'remove')) {
        var key = String(c.key || '').trim().slice(0, 48);
        if (!key) return;
        if (op === 'remove') changes.push({ field: field, op: op, key: key });
        else if (typeof value === 'string' || typeof value === 'number') {
          var attr = String(value).trim().slice(0, 160);
          if (attr) changes.push({ field: field, op: op, key: key, value: attr });
        }
      } else if (['skills', 'inventory', 'notes'].indexOf(field) !== -1 && (op === 'add' || op === 'remove') && typeof value === 'string') {
        var item = value.trim().slice(0, 240);
        if (item) changes.push({ field: field, op: op, value: item });
      }
    });
    if (!changes.length) return null;
    return { reason: String(raw.reason || 'A story event may warrant a status change.').trim().slice(0, 400), changes: changes };
  }

  function stripRpgUpdate(text) {
    return String(text || '').replace(/<rpg_update\b[^>]*>[\s\S]*?(?:<\/rpg_update\s*>|$)/gi, '').trim();
  }

  function hideRpgUpdate(text) {
    var t = String(text || ''), m = /<rpg_update\b/i.exec(t);
    return m ? t.slice(0, m.index).replace(/\s+$/, '') : t;
  }

  function rpgStatusPrompt(session) {
    var st = session && session.rpgStatus;
    if (!st || st.enabled !== true) return '';
    var lines = [
      'PLAYER RPG STATUS — APP-MANAGED LEDGER',
      'This is one player-facing ledger shared by this conversation (including a group chat). It is for continuity and game bookkeeping; it does not grant any character knowledge of private events or make the sheet visible in-fiction unless the story establishes that.',
      'Level: ' + String(st.level || '1'),
      'XP: ' + String(Math.max(0, Number(st.xp) || 0))
    ];
    if (st.xpToNext !== null && st.xpToNext !== undefined && st.xpToNext !== '') lines.push('XP target for next level: ' + String(st.xpToNext));
    if (st.attributes && Object.keys(st.attributes).length) lines.push('Attributes: ' + JSON.stringify(st.attributes));
    if (Array.isArray(st.skills) && st.skills.length) lines.push('Skills: ' + JSON.stringify(st.skills));
    if (Array.isArray(st.inventory) && st.inventory.length) lines.push('Inventory: ' + JSON.stringify(st.inventory));
    if (Array.isArray(st.notes) && st.notes.length) lines.push('Player notes: ' + JSON.stringify(st.notes));
    lines.push('Do not silently change this ledger. Do not invent rewards, losses, items, skill changes, or level-ups. Only propose a change supported by events explicitly established in this conversation and by the stated game rules.');
    if (st.suggestionsEnabled !== false) {
      lines.push('When a concrete event clearly warrants a status change, append one machine-readable proposal after the narrative (and after any <state> block): <rpg_update>{"reason":"brief reason","changes":[{"field":"xp","op":"add","value":10}]}</rpg_update>. Never put story prose inside the tag. Allowed changes: xp add/set (integer), level set, attributes set/remove with key and value, skills/inventory/notes add/remove with a value. The app hides this block and asks the player to approve it; never claim it was applied. Omit the tag entirely when there is no well-supported change.');
    } else {
      lines.push('Status suggestions are disabled. Do not output an <rpg_update> block.');
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------
   * v1.13.0 — internal state.
   *
   * A character can carry a small internal state (mood / intent / flags).
   * When tracking is on, the current state goes into the character sheet
   * and the model is asked to end every reply with an updated state in a
   * hidden <state> block. The block is parsed out of the reply before it
   * is stored or shown, and becomes the state the next prompt carries.
   *
   * Deliberately simple: three free-text fields, one tag, no schema. The
   * tag name avoids the stripThinking list (which eats <internal>), and
   * every parse is defensive — a reply without a usable block simply
   * keeps the previous state. Virtual humans and world runs are excluded:
   * the life simulation / world engine own that kind of state.
   * ------------------------------------------------------------------ */
  var STATE_RE = /<state[^>]*>([\s\S]*?)<\/state\s*>/gi;

  function stateFields(char) {
    var st = (char && char.state) || {};
    return {
      mood: String(st.mood || '').trim(),
      intent: String(st.intent || '').trim(),
      flags: String(st.flags || '').trim()
    };
  }

  /** The section this character's prompt carries, or '' when tracking is
   *  off (or the character is a virtual human). */
  function statePrompt(char) {
    if (!char || char.stateTracking !== true || char.vh) return '';
    var f = stateFields(char);
    var cur = [];
    if (f.mood) cur.push('mood: ' + f.mood);
    if (f.intent) cur.push('intent: ' + f.intent);
    if (f.flags) cur.push('flags: ' + f.flags);
    var head = cur.length
      ? 'Your current internal state:\n' + cur.join('\n')
      : 'Your internal state is not established yet.';
    return head + '\nKeep your internal state current. At the very end of every reply, add your ' +
      'updated state in exactly this format — the reader never sees it:\n' +
      '<state>\nmood: one short phrase\nintent: what you are trying to do next\n' +
      'flags: comma-separated details worth remembering\n</state>';
  }

  /** Pull the last <state> block out of a model reply. Returns
   *  {mood,intent,flags} or null when there is no usable block — the
   *  caller then keeps the previous state. */
  function parseState(text) {
    var t = String(text || '');
    STATE_RE.lastIndex = 0;
    var m, last = null;
    while ((m = STATE_RE.exec(t))) last = m;
    if (!last || last[1].length > 1200) return null;
    var out = { mood: '', intent: '', flags: '' };
    last[1].split('\n').forEach(function (line) {
      var kv = line.match(/^\s*(mood|intent|flags)\s*:\s*(.+)$/i);
      if (!kv) return;
      var v = kv[2].trim().slice(0, 400);
      if (v) out[kv[1].toLowerCase()] = v;
    });
    return (out.mood || out.intent || out.flags) ? out : null;
  }

  /** Remove every <state> block from a reply so the reader sees the
   *  story, not the bookkeeping. */
  function stripState(text) {
    var t = String(text || '');
    if (!t) return t;
    return t.replace(STATE_RE, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function trimHistory(history, n, maxChars) {
    var msgs = history.slice(-n);
    var total = msgs.reduce(function (a, m) { return a + (m.content ? m.content.length : 0); }, 0);
    while (total > maxChars && msgs.length > 4) {
      total -= (msgs.shift().content || '').length;
    }
    return msgs;
  }

  /* ------------------------------------------------------------------
   * Context budget. Upstream 18.0.1 fixed replies being rejected with
   * "context exceeds the current provider input limit" because an audit
   * snapshot was counted against the same cap as the conversation. The
   * rule here: the character sheet and the life snapshot are never the
   * thing that gets cut — trim the conversation instead, and only then
   * the example dialogue.
   * ------------------------------------------------------------------ */
  var CONTEXT_CAP = 128000;   // bytes, provider-bound messages

  /* v1.39.82: the history had a hard 26 000-character cap written into the
     one call that used it — no setting, no UI, and it silently outranked the
     "Messages in context" slider (which says 40 and delivers 17 at 250 words
     a reply). It is now a real budget in tokens, and when the app knows the
     model's window (OpenRouter publishes context_length) it shrinks to fit
     inside it, because a prompt larger than the window is not "more memory":
     the provider truncates it and the character answers the start of the
     conversation forever. */
  var DEFAULT_HISTORY_TOKENS = 6000;
  /* room for the sheet, the examples, the reply and a little slack, so the
     budget never claims the whole window */
  var WINDOW_MARGIN_TOKENS = 512;

  /* { model name -> context window in tokens }, filled from whatever model
     catalogue the app has already fetched and cached in localStorage. No
     extra request: the picker's own payload carries it. */
  function modelContextTokens(model) {
    var name = String(model || '').trim();
    if (!name) return 0;
    try {
      var map = JSON.parse(global.localStorage.getItem('hs-model-windows') || '{}') || {};
      var n = parseInt(map[name], 10);
      return n > 0 ? n : 0;
    } catch (e) { return 0; }
  }

  function rememberModelWindows(rows) {
    try {
      var map = JSON.parse(global.localStorage.getItem('hs-model-windows') || '{}') || {};
      var seen = 0;
      (rows || []).forEach(function (m) {
        var id = m && (m.id || m.name);
        var ctx = m && (m.context_length || m.context_window || (m.top_provider && m.top_provider.context_length));
        if (id && parseInt(ctx, 10) > 0) { map[id] = parseInt(ctx, 10); seen++; }
      });
      if (seen) global.localStorage.setItem('hs-model-windows', JSON.stringify(map));
    } catch (e) { /* storage can be unavailable in private WebViews */ }
  }

  /* How many tokens of transcript to send. The user's number, unless the
     model's window is known and smaller than what the rest of the prompt
     leaves room for. `cardTokens` is the sheet + examples + system block,
     already measured by the caller. */
  function historyBudgetTokens(s, cardTokens, replyTokens) {
    var want = parseInt(s && s.historyTokens, 10);
    if (!(want > 0)) want = DEFAULT_HISTORY_TOKENS;
    var window = modelContextTokens(s && s.model);
    if (!window) return want;
    var room = window - (cardTokens || 0) - (replyTokens || 0) - WINDOW_MARGIN_TOKENS;
    if (!(room > 0)) return Math.min(want, 1000);      /* a huge card leaves almost nothing */
    return Math.min(want, room);
  }

  /* The Horde is the tight one. horde.js asks for a context of
     min(HORDE_CTX_TOKENS, prompt + reply + 64) and the worker window really is
     that size, so a prompt that is comfortable for a chat provider can still be
     too big here. When the worker truncates, a backend that keeps the head of
     the prompt leaves the model answering the start of the conversation forever,
     whatever you type next. So budget the prompt against this, not CONTEXT_CAP. */
  var HORDE_CTX_TOKENS = 8192;

  /* v1.21.0 (upstream 18.3.5): a hard ceiling on one OpenAI-compatible
     request. The Horde path is already bounded by hordeMaxWait; this is for
     the streaming providers, where a hung read() used to wait forever. */
  var STREAM_TIMEOUT_MS = 240000;   /* free routes queue well past 2 min */
  /* D1 (v1.39.71): one answer to "what if maxTokens is missing?". Three places
     used to disagree (400 in the settings default, 200 in two budget sums, and
     no fallback at all in the Horde request), so a stored character with a
     null cap computed its budget against 200 and then asked for undefined. */
  var DEFAULT_MAX_TOKENS = 400;
  function maxTokensOf(s) {
    var n = parseInt(s && s.maxTokens, 10);
    return n > 0 ? n : DEFAULT_MAX_TOKENS;
  }
  /* Why the last generation stopped, as the provider reported it:
     'length' means our max-token cap cut the reply, 'stop' means the model
     finished (or a stop sequence fired). Shown on the bubble. */
  var lastFinish = null;
  /* What the last prompt assembly did, set by buildChat and buildPrompt
     themselves and read back by the prompt inspector. Same reasoning as
     `lastFinish` and `API.lastHorde`: the only honest account of a request is
     the one written by the code that made it, so a preview cannot describe a
     request that was never built. Null when nothing has been assembled. */
  var lastAssembly = null;
  function bytesOf(s) {
    try { return new TextEncoder().encode(s || '').length; } catch (e) { return String(s || '').length; }
  }
  function totalBytes(msgs) {
    return msgs.reduce(function (a, m) { return a + bytesOf(m.content); }, 0);
  }
  /* C2 (v1.39.74): what the lorebook is matched against.
     It used to be the last six messages — three exchanges. An entry keyed to
     "the ridge" fired while the ridge was being discussed and went silent four
     messages later, even though the ridge was still in the prompt, still in the
     story, and still the thing you were standing on. The prompt was right; the
     trigger was looking at a window that closed behind you.

     It is now the same transcript the request carries: the history the caller
     passed, already cut by trimHistory to the user's "Messages in context"
     setting. Cost does not grow — admission is still capped at 6 entries and
     1536 bytes; only what can *fire* an entry widens. */
  function fitContext(msgs, floor) {
    var total = totalBytes(msgs);
    if (total <= CONTEXT_CAP) return msgs;
    var out = msgs.slice();
    while (total > CONTEXT_CAP && out.length > floor + 4) {
      total -= bytesOf(out.splice(floor, 1)[0].content);
    }
    return out;
  }

  /* v1.39.108: one line, only when the transcript it follows actually shows
     the habit. A chat that never used asterisks gets no extra instruction, so
     nothing changes for it; a chat that did gets told, at the point of
     generation, not to copy what it can see. Underscores are not mentioned -
     they are common in ordinary prose and would be a false positive. */
  function styleLock(history) {
    var total = 0, worst = 0;
    (history || []).forEach(function (m) {
      if (!m || m.role !== 'assistant') return;
      /* buildPrompt sees the stored shape (text); buildChat has already mapped
         it to wire shape (content). Accept either. */
      var body = String(m.text != null ? m.text : (m.content != null ? m.content : ''));
      var n = (body.match(/\*/g) || []).length;
      total += n;
      if (n > worst) worst = n;
    });
    /* A greeting that italicises one line is not a habit. Measured against the
       reported export: a normal early reply carries a handful, a reply that has
       started degenerating carries dozens (51, then 302 as it ran away). Only
       these two shapes earn the instruction - a first turn is never told to
       break a habit it does not have. */
    if (total < 20 && worst < 12) return '';
    return 'FORMAT FOR THIS REPLY: write plain prose and quoted dialogue, with no asterisks ' +
      'anywhere - not on words, not between them. Earlier replies above use them; that is the ' +
      'habit to break, not a style to match. Do not mention or apologise for the change.';
  }

  /* ---------------- recall: BM25-lite over the messages the window left out ----
   * The history budget decides what the model is shown, so a name planted at turn 8
   * is simply absent by turn 55 — not forgotten, never sent. The field's answer is a
   * vector store; a phone with free routes cannot have one, and does not need one for
   * the thing people actually want from it, which is "find the old line that
   * resembles this one". This is ~140 lines of scoring over the message array that is
   * already in memory, no model and no dependency, and it is OFF by default: a
   * retriever that fires on the wrong word confidently is a new failure mode, and
   * every passage costs the prompt tokens.
   *
   * Three rules are borrowed rather than invented:
   *   - protect the window (SillyTavern calls it `protect N`): a message the request
   *     already carries is never recalled. The corpus is exactly the tail-minus-
   *     window, so recall answers "what did I lose", not "what is right there".
   *   - append, never relocate (§A3 of the scan): ST's rearrangeChat() lifts matched
   *     messages out of the history and re-inserts them as a block, and a memory
   *     block that moves costs the prompt-cache discount every turn — 90 % of this
   *     app's friendliest behaviour on a free route is that prefix staying put. So
   *     the block lands AFTER the transcript, which is also where attention is
   *     highest when the context is long (lost-in-the-middle, §1.2).
   *   - idf, not tf: "the lamp" appears in half a lighthouse story, and a raw
   *     term count ranks it first every time. Inverse document frequency is what
   *     makes a rare name beat a common word, and it needs no model either. */
  var RECALL_MIN = 1, RECALL_MAX = 12, RECALL_DEFAULT = 6;
  var RECALL_DOC_CHARS = 1400;      /* scored text: beyond this a post is padding */
  var RECALL_SNIPPET = 420;         /* injected text per message */
  var RECALL_TOKENS = 700;          /* the block's own ceiling */
  var RECALL_MAX_DOCS = 1500;       /* newest this many out-of-window messages are ranked */
  var RECALL_STOP = (' a an and are as at be but by did for from had has have he her him his how i in ' +
    'is it its of on or our she so that the their them then there they this to us was we were what when ' +
    'where which who will with you your not just like about into over under out up down one two three ' +
    'me my mine ours his hers very much little more most other another').split(/\s+/);
  /* Tokenisation is cached per message, not per history: the window moves every
   turn while the old messages do not, so the expensive half is reusable and the
   cheap half (which messages are outside the window) is recomputed. Keyed on id
   plus length, so an edited line is a different key and cannot be served stale. */
  var recallTok = Object.create(null);
  var recallTokN = 0;
  var RECALL_TOK_MAX = 4000;      /* a phone's memory, not an index of a library */

  function recallEnabled(s) { return !!(s && s.recallOn === true); }
  function recallCount(s) {
    var n = parseInt(s && s.recallCount, 10);
    if (!(n > 0)) n = RECALL_DEFAULT;
    return Math.max(RECALL_MIN, Math.min(RECALL_MAX, n));
  }

  /** The words a passage is matched on: lowercase, markup gone, stopwords gone,
   *  duplicates KEPT (that is the tf half of the score). `limit` bounds the work on
   *  a monstrous post without changing which post it is. */
  function recallTokenize(text, limit) {
    var raw = String(text == null ? '' : text)
      .replace(/[*_`#>\[\]()]/g, ' ')
      .replace(/[^\p{L}\p{N}']+/gu, ' ')
      .toLowerCase();
    var all = RECALL_STOP.reduce(function (o, w) { o[w] = 1; return o; }, Object.create(null));
    var out = [], n = 0, max = limit || 400;
    var parts = raw.split(' ');
    for (var i = 0; i < parts.length && n < max; i++) {
      var w = parts[i];
      if (w.length < 3 || all[w]) continue;
      out.push(w); n++;
    }
    return out;
  }

  /** One message, scored-shaped: term frequencies and the term set. Null for a
   *  message too short or too empty to be worth interrupting the model with. */
  function recallDoc(m, i) {
    var text = String(m.text || '');
    var key = (m.id == null ? 'i' + i : String(m.id)) + ':' + text.length;
    if (Object.prototype.hasOwnProperty.call(recallTok, key)) return recallTok[key];
    var doc = null;
    var body = text.slice(0, RECALL_DOC_CHARS);
    if (body.trim().length >= 12) {
      var terms = recallTokenize(body);
      if (terms.length) {
        var tf = Object.create(null), set = Object.create(null);
        for (var k = 0; k < terms.length; k++) { tf[terms[k]] = (tf[terms[k]] || 0) + 1; set[terms[k]] = 1; }
        doc = { tf: tf, set: set, len: terms.length };
      }
    }
    if (recallTokN > RECALL_TOK_MAX) { recallTok = Object.create(null); recallTokN = 0; }
    recallTok[key] = doc; recallTokN++;
    return doc;
  }

  /** The corpus: everything outside the window, in order, oldest first. */
  function recallCorpus(history, windowed) {
    var inWindow = Object.create(null);
    (windowed || []).forEach(function (m) { if (m && m.id != null) inWindow[m.id] = 1; });
    var docs = [];
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      if (!m || inWindow[m.id] != null) continue;
      var d = recallDoc(m, i);
      if (!d) continue;
      docs.push({ i: i, id: m.id, role: m.role, text: String(m.text || ''), tf: d.tf, set: d.set, len: d.len });
    }
    return { docs: docs, df: Object.create(null), n: docs.length };
  }

  /* How many messages a term has to appear in before it stops being a clue. A
     quarter of the corpus is the line: a phrase the model repeats every reply —
     "she nods at the weather" — is in everything, and ranking by it hands back
     forty near-duplicates of the turn you just read, which the model weaves in.
     That is worse than recalling nothing, so it is refused by default. */
  function recallIsCommon(df, N) { return df > Math.max(2, Math.floor(N * 0.25)); }

  function recallDf(cache, term) {
    if (cache.df[term] != null) return cache.df[term];
    var n = 0;
    for (var i = 0; i < cache.docs.length; i++) if (cache.docs[i].set[term]) n++;
    cache.df[term] = n;
    return n;
  }

  /** Score every document against the query, BM25 (k1 1.2, b 0.75 — Okapi defaults,
   *  which is what they are still used for). Returns ranked hits, best first. */
  function recallSearch(history, query, opts) {
    opts = opts || {};
    var win = opts.windowed || [];
    var cache = recallCorpus(history || [], win);
    var docs = cache.docs.length > RECALL_MAX_DOCS ? cache.docs.slice(cache.docs.length - RECALL_MAX_DOCS) : cache.docs;
    var qterms = recallTokenize(query, 80);
    var qtf = Object.create(null);
    qterms.forEach(function (t) { qtf[t] = (qtf[t] || 0) + 1; });
    var terms = Object.keys(qtf);
    var out = [];
    if (!terms.length || !docs.length) {
      return { hits: out, corpus: docs.length, terms: terms, scanned: cache.n };
    }
    var avg = 0;
    for (var d = 0; d < docs.length; d++) avg += docs[d].len;
    avg = avg / docs.length;
    var N = docs.length;
    var k1 = 1.2, b = 0.75;
    var idf = Object.create(null), dfn = Object.create(null), rare = Object.create(null);
    for (var t = 0; t < terms.length; t++) {
      var n = recallDf(cache, terms[t]);
      dfn[terms[t]] = n;
      rare[terms[t]] = !recallIsCommon(n, N);
      /* Lucene's form: never negative, so a term in every document contributes
         nothing rather than subtracting from a document that mentions it twice. */
      idf[terms[t]] = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    }
    for (var i = 0; i < N; i++) {
      var doc = docs[i], score = 0, matched = 0, clues = 0;
      for (var j = 0; j < terms.length; j++) {
        var f = doc.tf[terms[j]];
        if (!f) continue;
        matched++;
        if (rare[terms[j]]) clues++;
        score += idf[terms[j]] * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.len / (avg || 1))));
      }
      /* Precision over recall, twice over: a term the whole chat contains is not a
         clue (that is what ranks boilerplate first), and one shared word is not
         enough to interrupt the model for — unless that word is rare, which is the
         turn where all the player typed was a name. */
      if (!clues) continue;
      if (matched < 2 && terms.length > 1) continue;
      if (score > 0) out.push({ doc: doc, score: score, matched: matched, clues: clues });
    }
    /* Deterministic order, because the same chat must produce the same prompt: score
       first, then recency (newer passages are the closer neighbours of "now"), then
       position. A tie broken by Date.now() would make the prompt unrepeatable. */
    out.sort(function (a, x) {
      if (x.score !== a.score) return x.score - a.score;
      if (a.doc.i !== x.doc.i) return x.doc.i - a.doc.i;   /* newer first */
      return String(a.doc.id) < String(x.doc.id) ? -1 : 1;
    });
    var keep = out.slice(0, opts.limit || RECALL_DEFAULT);
    return {
      hits: keep.map(function (h) {
        return {
          index: h.doc.i, id: h.doc.id, role: h.doc.role, text: h.doc.text,
          score: h.score, matched: h.matched, clues: h.clues
        };
      }),
      ranked: out.length, corpus: docs.length, terms: terms, scanned: cache.n, avg: avg
    };
  }

  /* The densest stretch of the message, not its opening: a recalled four-thousand-
   * character post is worthless if the one sentence that matters is at the far end.
   * Span from the first matched term to the last, padded, then capped. */
  function recallSnippet(text, terms, size) {
    var full = String(text || '').replace(/\s+/g, ' ').trim();
    var low = full.toLowerCase(), first = -1, last = -1;
    for (var i = 0; i < terms.length; i++) {
      var at = low.indexOf(terms[i]);
      if (at < 0) continue;
      if (first < 0 || at < first) first = at;
      if (at > last) last = at + terms[i].length;
    }
    if (first < 0) return full.slice(0, size);
    var start = Math.max(0, first - 60);
    var end = Math.min(full.length, Math.max(last + 60, start + Math.floor(size * 0.7)));
    if (end - start > size) end = start + size;
    return (start > 0 ? '…' : '') + full.slice(start, end).trim() + (end < full.length ? '…' : '');
  }

  /** The block buildChat appends, or null. `char` and `session` are only there to
   *  attribute a reply to the right speaker in a group, the same call the thread
   *  makes — a recalled line with no name on it reads as the narrator's. */
  function recallFor(history, win, character, session, s) {
    if (!recallEnabled(s)) return null;
    var list = history || [];
    if (list.length < 6) return null;                 /* nothing old enough to recall */
    var lastUser = null, lastReply = null;
    for (var i = list.length - 1; i >= 0 && (!lastUser || !lastReply); i--) {
      var m = list[i];
      if (!m || !m.text) continue;
      if (!lastUser && m.role === 'user') lastUser = String(m.text);
      if (!lastReply && m.role === 'assistant') lastReply = String(m.text);
    }
    if (!lastUser) return null;
    var r = recallSearch(list, lastUser + ' ' + (lastReply || ''), {
      windowed: win.messages, limit: recallCount(s)
    });
    if (!r.hits.length) return null;
    var budget = RECALL_TOKENS * 4, used = 0, lines = [], taken = 0, dropped = 0;
    for (var h = 0; h < r.hits.length; h++) {
      var hit = r.hits[h];
      /* the label the model wrote is part of the body; taking the name out of it and
         then prefixing a name again is how a recall block reads "Her: Her: …" */
      var said = hit.role === 'user'
        ? { name: (s && s.userName) || 'You', text: hit.text }
        : splitSpeaker(character, session, hit.text);
      var who = said.name || ((s && s.userName) || 'You');
      var body = String(said.text == null ? '' : said.text);
      /* One label per recalled line. splitSpeaker strips a card's own name only when a
         scene cast lists it, so with a solo card the label inside the line and the name
         prefixed here both survive, and the model reads the same name twice before the
         prose. A label that is somebody else's name is not noise — with no cast to
         match it against, that name is who spoke, so it moves into the prefix. */
      var lab = /^[ \t>*_#]*([A-Z][^\n:()\[\]!?.]{0,39})[ \t]*:[ \t]/.exec(body);
      if (lab) {
        var lowName = String(lab[1]).toLowerCase().trim();
        var mine = String(who || '').toLowerCase().trim();
        var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast.length : 0;
        if (lowName === mine) body = body.slice(lab[0].length);
        else if (hit.role === 'assistant' && cast < 2) { who = lab[1].trim(); body = body.slice(lab[0].length); }
      }
      body = recallSnippet(body, r.terms, RECALL_SNIPPET);
      var line = (taken + 1) + '. ' + who + ': ' + body;
      if (used + line.length > budget) { dropped++; continue; }
      used += line.length; taken++;
      lines.push(line);
    }
    if (!lines.length) return null;
    var text = 'From earlier in this conversation, taken from its own record — these are real lines ' +
      'from messages no longer in the window. They are background, not the present moment: if one of ' +
      'them contradicts anything newer, newer wins, and do not repeat them verbatim.\n' + lines.join('\n');
    return {
      text: text, hits: taken, dropped: dropped, ranked: r.ranked, corpus: r.corpus,
      tokens: Math.ceil(text.length / 4), scanned: r.scanned,
      from: r.hits.slice(0, taken).map(function (x) { return x.index; })
    };
  }

  /** Build the payload for an OpenAI-compatible endpoint. */
  function buildChat(character, session, history, s, note, finalNote) {
    var stats = {};
    /* v1.39.111: one window for the whole request. Lore, the transcript and
       the style lock all read `win`; nothing opens its own. */
    var win = requestWindow(history, s);
    var recent = loreWindow(character, history, win);
    var assistantTurns = history.filter(function (m) { return m.role === 'assistant'; }).length;
    /* A world run (and any caller that knows better) supplies character.systemPrompt
       with the narrator rules plus live state. Fall back to the global prompt. */
    var system = macros(systemTextOf(character, s), character, s);
    system += '\n' + macros(OOC_RULE, character, s);
    var sheet = charSheet(character, s, session, recent, assistantTurns, loreOpts(character, s), stats);
    if (sheet) system += '\n\n' + sheet;
    var rpg = rpgStatusPrompt(session);
    if (rpg) system += '\n\n' + rpg;
    if (note) system += '\n\n' + note;
    var sceneCast = sceneCastPrompt(session, s.userName);
    if (sceneCast) system += '\n\n' + sceneCast;

    /* v1.39.87: the example dialogue was pushed as REAL turns, before the
       history — so the model read the card's samples as the oldest part of
       this conversation. A card whose examples show a later moment (moving
       boxes already inside, the wife in the doorway) then reads as a story
       that happened first and then restarted at its own opening line, and the
       model stops to ask which version to continue. Examples are a sample of
       voice and format; they are labelled as such and kept out of the
       transcript. */
    var ex = examplesToMessages(character.examples, character, s);
    /* v1.39.111: an assistant example keeps the speaker the card names for it.
       Every card writing a multi-speaker example uses inline labels - it is the
       only way to write them - and this block used to prefix each one with the
       card's own name while leaving the label in place, so a narrator card
       reached the model as "The Narrator: Mara: ...". The card reads correctly
       in every other viewer, which is why the author never sees it. */
    var exText = ex.map(function (m) {
      if (m.role === 'user') return s.userName + ': ' + m.content;
      var inline = labelledName(m.content);
      return inline ? m.content : character.name + ': ' + m.content;
    }).join('\n');
    if (exText) {
      system += '\n\nExample dialogue — a sample of the intended voice, length and format. ' +
        'These are NOT events that have already happened, they are not part of this story, ' +
        'and nothing in them overrides the opening message below where the chat actually begins.\n' +
        exText;
    }
    var msgs = [{ role: 'system', content: system.trim() }];

    /* v1.13.2: repair double-encoded text in stored messages (the card's
       greeting, a model reply that imitated the card's mojibake) so the
       model stops reading — and imitating — it. */
    var castNow = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    var hist = win.messages.map(function (m) {
      var content = repairMojibake(m.text || '');
      /* v1.39.0: a player's photo degrades to the caption they wrote for
         it - text models never see pixels, so the caption IS the photo. */
      if (m.imageCaption && m.role === 'user') content += '\n[photo: ' + m.imageCaption + ']';
      if (m.role !== 'user') {
        /* v1.39.86: a chat-format provider sends bare turns, so a card with
           three speakers reached the model as an unattributed wall — and every
           reply looked like it belonged to the card's own name. The speaker is
           named, the way the examples do it.
           v1.39.111: labelling used to be gated on the session cast having two
           names, so before the cast was detected a reply carrying its own
           "Mara:" label came out as "The Narrator: Mara: ..." - the same stacked
           label the examples had. Now a line that already names a speaker is
           left alone, and a bare line is labelled with the card's name only if
           the card has one voice to attribute it to. */
        var sp = splitSpeaker(character, session, content);
        content = labelledName(sp.text) ? sp.text : sp.name + ': ' + sp.text;
        /* A single-voice card's own turns stay bare: the provider already knows
           who is speaking, and every existing transcript test - and every card
           that has ever worked - expects an unprefixed line. Labelling is a
           multi-speaker affordance, so it stays one. */
        if (castNow.length < 2 && sp.name === fallbackName(character)) content = sp.text;
      }
      return { role: m.role === 'user' ? 'user' : 'assistant', content: content };
    }).filter(function (m) { return m.content.trim(); });

    var histBudget = historyBudgetTokens(s,
      Math.ceil(String(system).length / 4), maxTokensOf(s));
    var preTrim = hist.length;
    hist = trimHistory(hist, contextMessageCeiling(s), Math.max(2000, histBudget * 4));
    /* the count ceiling already landed in requestWindow; whatever trimHistory
       still removes here is the token budget, and the label has to say so */
    var trimmedBySetting = preTrim - hist.length;
    hist.forEach(function (m) { msgs.push(m); });

    /* A reroll instruction rides LAST, after the card, the examples and the
       transcript. Buried in the system block it argued with the card from a
       weaker position and lost; here it is the final thing read before the
       reply, which is where a model actually takes its orders from. */
    /* v1.39.108: the style lock rides here for the same reason, and it is the
       only thing that survives a long chat. The default system prompt used to
       request asterisks; even with that gone, a history carrying thousands of
       them teaches the habit far better than a system message can forbid it.
       An instruction that sits AFTER the transcript is the one the model is
       still holding when it writes. */
    /* v1.39.111: the lock measures the turn window, not the byte-trimmed
       transcript. Sizing the evidence from `hist` made the window a function of
       reply length: long replies hit trimHistory's floor of four, the star count
       fell with the message count, and an identical habit went unnoticed on
       exactly the cards that write long replies. */
    /* the card's own instruction lands after the history and BEFORE the
       app's continuation/reroll note, so it cannot be read as the last order in
       the request - that stays the app's, and it is the one that has to survive
       a reroll. */
    var tailPost = postHistoryMode(character) === 'tail' ? postHistoryText(character, s) : '';
    /* recall sits FIRST in the tail — it is evidence, and the style lock and the
       app's own instruction are orders; the last thing read is the one obeyed. */
    var recalled = recallFor(history, win, character, session, s);
    var tail = [recalled && recalled.text, styleLock(win.messages), tailPost, finalNote].filter(Boolean).join('\n\n');
    if (tail) msgs.push({ role: 'system', content: tail });

    var preCap = msgs.length;
    msgs = fitContext(msgs, 1 + ex.length);
    var droppedByCap = preCap - msgs.length;
    var exDropped = false;
    if (totalBytes(msgs) > CONTEXT_CAP && ex.length) {
      msgs = [msgs[0]].concat(msgs.slice(1 + ex.length));   // last resort: drop the examples
      exDropped = true;
    }
    lastAssembly = {
      shape: 'chat', at: Date.now(),
      /* the history the caller had, what the window allowed, what the request
         carries — the three numbers that turn "it forgot" into a diagnosis */
      available: (history || []).length,
      window: win.messages.length,
      messageCap: win.messageCap,
      ceilingIsDefault: !!win.ceilingIsDefault,
      scanTurns: LORE_SCAN_TURNS,
      sent: hist.length,
      trimmedByBudget: trimmedBySetting,
      droppedByCap: droppedByCap,
      examplesDropped: exDropped,
      bytes: totalBytes(msgs), cap: CONTEXT_CAP,
      /* fitContext protects the sheet and the examples the same way the plain-text
         builder protects its two turns, so a request can end up over the cap on
         purpose. Saying so beats implying the number was met. */
      overCap: totalBytes(msgs) > CONTEXT_CAP,
      /* v1.46.0: what recall spent, or that it was switched off. Reported rather
         than assumed, because "the model brought up something from forty turns ago"
         is only reassuring if you can see that it was paid for. */
      recall: recalled ? { on: true, passages: recalled.hits, corpus: recalled.corpus,
        ranked: recalled.ranked, dropped: recalled.dropped, tokens: recalled.tokens,
        scanned: recalled.scanned, from: recalled.from } : { on: recallEnabled(s), passages: 0, corpus: 0 },
      historyTokens: histBudget,
      cardTokens: Math.ceil(String(system).length / 4),
      replyTokens: maxTokensOf(s),
      modelWindow: modelContextTokens(s && s.model) || 0,
      lore: stats.lore || null
    };
    return msgs;
  }

  /** Build a plain-text prompt for AI Horde / non-chat backends. */
  /* v1.39.86: who is actually talking.
     On a multi-person card the app labelled every reply with the card's own
     name, so a second character's dialogue reached the model stacked behind
     it — two labels for one line. The model then copied that shape back, and
     the export and the memory summariser both recorded everyone's lines under
     the card's name. A reply usually opens with its own speaker label; when it
     names someone in the scene cast, that is the speaker: it wins, and the
     label is removed so it is not sent back twice. */
  /* v1.39.111: who is speaking, without needing a chat to have started.
   *
   * `splitSpeaker` below answers the same question but reads its roster from
   * session.sceneCast, which is empty until the cast has been detected - and an
   * example block is assembled from card data before any chat exists. So the
   * examples went out every assistant line labelled with the card's own name,
   * stacked on top of whatever inline label the author had written:
   *
   *   The Narrator: Aston Ashworth: "You are a lifesaver, buddy."
   *
   * These are the two halves that do not depend on session state:
   *   speakerNames()  - who the card names, from its own examples
   *   labelledName()  - the label at the head of a line, if it is a name
   */

  /* A capitalised word, or two joined words, the way cards name people:
     "Mara", "Aston Ashworth", "McDonald", "O'Brien", "van der Berg". */
  var SPEAKER_NAME_RE = /^[A-Z][\w'\u2019-]*(?:\s+(?:[A-Z][\w'\u2019-]*|van|von|de|der|da|di|al|bin)){0,3}$/;

  /** The label at the head of a line ("Mara: ..." -> "Mara"), or ''. */
  function fallbackName(character) {
    return (character && character.name) || 'Assistant';
  }

  function labelledName(line) {
    /* trailing markup is allowed before the colon: **Mara:** */
    /* markup is allowed on both sides of the colon: **Mara:** is bold around
       the whole label, so the closing asterisks sit after the colon. */
    var m = /^[\s>*_#]*([^\n:()\[\]]{1,40}?)[\s*_#]*:[\s*_#]*/.exec(String(line == null ? '' : line));
    if (!m) return '';
    /* **Mara:** and _Mara:_ are common in cards; the markup is not the name. */
    var label = String(m[1]).trim().replace(/^[*_#\s]+/, '').replace(/[*_#\s]+$/, '');
    /* A bare capitalised name. "It was late: he said" is prose that happens to
       carry a colon, and must not be read as a speaker. */
    return SPEAKER_NAME_RE.test(label) ? label : '';
  }

  /** Every distinct speaker label the card's own examples use, in order. */
  function speakerNames(character) {
    var raw = String((character && character.examples) || '');
    if (!raw) return [];
    var out = [];
    raw.split(/\r?\n|<\s*START\s*>/i).forEach(function (line) {
      var name = labelledName(line);
      if (!name || out.indexOf(name) !== -1) return;
      out.push(name);
    });
    return out;
  }

  function splitSpeaker(character, session, text) {
    var fallback = (character && character.name) || 'Assistant';
    var body = String(text == null ? '' : text);
    var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    function key(v) { return String(v || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").split(/[\s,]+/)[0]; }
    function find(label) {
      var low = String(label || '').toLowerCase().trim();
      var hit = null;
      cast.forEach(function (n) {
        var nl = String(n || '').toLowerCase().trim();
        if (!nl || hit) return;
        if (nl === low || key(nl) === key(low) || nl.indexOf(low + ' ') === 0 || low.indexOf(nl + ' ') === 0) hit = n;
      });
      return hit;
    }
    if (cast.length < 2) {
      /* still strip a redundant copy of the card's own name */
      var one = find(fallback);
      if (one) {
        var m1 = /^[\s>*_#]*([^\n:()\[\]]{1,40}):\s/.exec(body);
        if (m1 && String(m1[1]).toLowerCase().trim() === String(fallback).toLowerCase().trim()) {
          return { name: fallback, text: body.slice(m1[0].length) };
        }
      }
      return { name: fallback, text: body };
    }
    var name = '', t = body;
    for (var pass = 0; pass < 2; pass++) {
      var m = /^[\s>*_#]*([^\n:()\[\]]{1,40}):\s/.exec(t);
      if (!m) break;
      var who = find(m[1]);
      if (!who) break;
      /* the label nearest the prose is the one the writer meant */
      name = who;
      t = t.slice(m[0].length);
    }
    return { name: name || fallback, text: name ? t : body };
  }

  function buildPrompt(character, session, history, s, note, budgetTokens, finalNote) {
    /* v1.39.111: the prompt format reads the same one window as the chat
       format, so the two cannot disagree about what is recent. */
    var win = requestWindow(history, s);
    var recent = loreWindow(character, history, win);
    var assistantTurns = history.filter(function (m) { return m.role === 'assistant'; }).length;
    var stats = {};
    var head = macros(systemTextOf(character, s), character, s) +
      '\n\n' + charSheet(character, s, session, recent, assistantTurns, loreOpts(character, s), stats);
    var rpg = rpgStatusPrompt(session);
    if (rpg) head += '\n\n' + rpg;
    if (note) head += '\n\n' + note;
    head += '\n\n' + macros(OOC_RULE, character, s);
    var sceneCast = sceneCastPrompt(session, s.userName);
    if (sceneCast) head += '\n\n' + sceneCast;
    var ex = examplesToMessages(character.examples, character, s).map(function (m) {
      if (m.role === 'user') return s.userName + ': ' + m.content;
      var inline = labelledName(m.content);
      return inline ? m.content : character.name + ': ' + m.content;
    }).join('\n');
    var hist = win.messages.map(function (m) {
      if (m.role === 'user') {
        var mine = repairMojibake(m.text || '');
        if (m.imageCaption) mine += '\n[photo: ' + m.imageCaption + ']';
        return s.userName + ': ' + mine;
      }
      var sp = splitSpeaker(character, session, repairMojibake(m.text || ''));
      return sp.name + ': ' + sp.text;
    });
    /* computed before the joiner so both shapes read the same block: recall is a
       property of the conversation, not of the transport. */
    var recalled = recallFor(history, win, character, session, s);
    var join = function (h) {
      return [head.trim(), ex ? 'Example dialogue — a sample of the intended voice, length and format. ' +
        'These are NOT events that have already happened and are not part of this story:\n' + ex : '',
        'Chat history:\n' + h.join('\n'),
        recalled ? recalled.text : '',
        /* v1.39.99: finalNote is read here too, so a state reminder supplied
           by a world run lands after the transcript and immediately before
           the cue to answer — the same position the chat format gives it. */
        postHistoryMode(character) === 'tail' ? postHistoryText(character, s) : '',
        finalNote || '', styleLock(win.messages), character.name + ':'].filter(Boolean).join('\n\n');
    };
    /* head holds the character sheet and the life snapshot — trim history, never that */
    /* Drop the OLDEST turns first, so the newest thing you typed always survives.
       With a budget we trim harder than CONTEXT_CAP would, because the Horde's
       window is far smaller than a chat provider's. */
    var capBytes = budgetTokens ? budgetTokens * 4 : CONTEXT_CAP;
    var preCap = hist.length;
    while (hist.length > 2 && bytesOf(join(hist)) > capBytes) hist.shift();
    var out = join(hist);
    /* The plain-text shape has no trimHistory step: the byte cap is the only
       thing that shortens it, and it keeps two turns no matter what it costs.
       Recording that explicitly is the point — a reader of the inspector can
       see the floor at work instead of guessing why a turn survived. */
    lastAssembly = {
      shape: 'prompt', at: Date.now(),
      available: (history || []).length,
      window: win.messages.length,
      messageCap: win.messageCap,
      ceilingIsDefault: !!win.ceilingIsDefault,
      scanTurns: LORE_SCAN_TURNS,
      sent: hist.length,
      trimmedByBudget: 0,
      droppedByCap: preCap - hist.length,
      floor: 2,
      bytes: bytesOf(out), cap: capBytes,
      overCap: bytesOf(out) > capBytes,
      recall: recalled ? { on: true, passages: recalled.hits, corpus: recalled.corpus,
        ranked: recalled.ranked, dropped: recalled.dropped, tokens: recalled.tokens,
        scanned: recalled.scanned, from: recalled.from } : { on: recallEnabled(s), passages: 0, corpus: 0 },
      historyTokens: 0,
      cardTokens: Math.ceil(String(head).length / 4),
      replyTokens: 0, modelWindow: budgetTokens || 0,
      lore: stats.lore || null
    };
    return out;
  }

  function endpoint(s) {
    return String(s.baseUrl || '').replace(/\/+$/, '');
  }

  function isOpenRouterEndpoint(s) {
    return /^https:\/\/openrouter\.ai(?:\/|$)/i.test(endpoint(s));
  }

  /* Local OpenRouter diagnostics deliberately store metadata only: never
     prompts, completions, API keys, or chat transcripts. The key fingerprint
     keeps activity from two different configured keys from being combined. */
  var OR_ACTIVITY_PREFIX = 'hs.openrouter.activity.v1.';
  function openRouterKeyTag(s) {
    var key = String((s && s.apiKey) || ''), hash = 2166136261;
    for (var i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul ? Math.imul(hash, 16777619) : (hash * 16777619) | 0;
    }
    return key.length.toString(36) + '-' + (hash >>> 0).toString(36);
  }
  function readOpenRouterStore(s) {
    try {
      var raw = global.localStorage && global.localStorage.getItem(OR_ACTIVITY_PREFIX + openRouterKeyTag(s));
      var data = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data)) return { events: data.slice(0, 60), dayStats: null };
      if (data && typeof data === 'object') return {
        events: Array.isArray(data.events) ? data.events.slice(0, 60) : [],
        dayStats: data.dayStats && typeof data.dayStats === 'object' ? data.dayStats : null
      };
    } catch (e) { /* storage can be unavailable in private WebViews */ }
    return { events: [], dayStats: null };
  }
  function readOpenRouterActivity(s) { return readOpenRouterStore(s).events; }
  function openRouterUtcDay(ts) { return new Date(ts || Date.now()).toISOString().slice(0, 10); }
  function recordOpenRouterEvent(s, event) {
    if (!isOpenRouterEndpoint(s) || !s.apiKey) return;
    try {
      var oldStore = readOpenRouterStore(s), list = oldStore.events;
      var usage = event && event.usage || {}, prompt = Number(usage.prompt_tokens), completion = Number(usage.completion_tokens);
      var entry = {
        at: Date.now(), model: String((event && event.model) || s.model || '').slice(0, 180),
        kind: String((event && event.kind) || 'other'), status: (event && event.status) || null,
        diagnosis: String((event && event.diagnosis) || ''),
        rateLimit: (event && event.rateLimit) || null,
        message: String((event && event.message) || '').replace(/\s+/g, ' ').slice(0, 300),
        provider: String((event && event.provider) || '').slice(0, 100),
        promptTokens: isFinite(prompt) && prompt >= 0 ? prompt : null,
        completionTokens: isFinite(completion) && completion >= 0 ? completion : null,
        totalTokens: isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) :
          (isFinite(prompt) && isFinite(completion) ? prompt + completion : null)
      };
      list.unshift(entry);
      if (list.length > 60) list.length = 60;
      var today = openRouterUtcDay(entry.at), stats = oldStore.dayStats;
      if (!stats || stats.day !== today) stats = { day: today, requests: 0, successes: 0, failures: 0, promptTokens: 0, completionTokens: 0, tokenReports: 0 };
      stats.requests++;
      if (entry.kind === 'success') stats.successes++;
      else if (entry.kind !== 'cancelled') stats.failures++;
      if (entry.promptTokens !== null && entry.completionTokens !== null) {
        stats.promptTokens += entry.promptTokens;
        stats.completionTokens += entry.completionTokens;
        stats.tokenReports++;
      }
      if (global.localStorage) global.localStorage.setItem(OR_ACTIVITY_PREFIX + openRouterKeyTag(s), JSON.stringify({ events: list, dayStats: stats }));
    } catch (e) { /* telemetry is best-effort; inference still succeeds */ }
  }
  function openRouterActivityToday(s) {
    var store = readOpenRouterStore(s), today = openRouterUtcDay(Date.now());
    var events = store.events.filter(function (x) { return x && openRouterUtcDay(x.at) === today; });
    var stats = store.dayStats && store.dayStats.day === today ? store.dayStats : null;
    if (!stats) {
      stats = { requests: events.length, successes: 0, failures: 0, promptTokens: 0, completionTokens: 0, tokenReports: 0 };
      events.forEach(function (x) {
        if (x.kind === 'success') stats.successes++;
        else if (x.kind !== 'cancelled') stats.failures++;
        if (typeof x.promptTokens === 'number' && typeof x.completionTokens === 'number') {
          stats.promptTokens += x.promptTokens;
          stats.completionTokens += x.completionTokens;
          stats.tokenReports++;
        }
      });
    }
    return { requests: stats.requests, successes: stats.successes, failures: stats.failures,
      promptTokens: stats.promptTokens, completionTokens: stats.completionTokens,
      tokenReports: stats.tokenReports, events: events };
  }
  function openRouterErrorDiagnosis(err, headers) {
    var status = Number(err && err.status) || null, metadata = err && err.openRouterMetadata || {};
    var type = String(metadata.error_type || metadata.type || '').toLowerCase();
    var rl = (err && err.openRouterRateLimit) || null;
    var limitHeader = !!rl;
    try { limitHeader = limitHeader || !!(headers && headers.get && headers.get('x-ratelimit-limit')); } catch (e) {}
    if (err && err.openRouterKind === 'empty') return { kind: 'empty', diagnosis: 'Route returned no visible answer' };
    if (err && err.name === 'TimeoutError' || /timeout/.test(type)) return { kind: 'timeout', diagnosis: 'App/provider timeout — quota not confirmed' };
    if (err && err.name === 'AbortError') return { kind: 'cancelled', diagnosis: 'Cancelled by user' };
    if (metadata.limit_source || limitHeader) {
      return { kind: 'account_limit',
        diagnosis: 'OpenRouter account rate limit' + (rateLimitSummary(rl) ? ' — ' + rateLimitSummary(rl) : '') };
    }
    if (status === 429 || /rate_limit/.test(type)) {
      if (metadata.provider_code) return { kind: 'provider_limit', diagnosis: 'Model provider throttled / saturated' };
      return { kind: 'ambiguous_limit', diagnosis: '429 rate limit — compare account quota; provider may also throttle' };
    }
    if (/provider_overloaded|provider_unavailable/.test(type)) return { kind: 'provider_error', diagnosis: 'Model provider overloaded / unavailable' };
    if (status === 402) return { kind: 'credits', diagnosis: 'OpenRouter credits or key budget' };
    if (status === 401 || status === 403) return { kind: 'auth', diagnosis: 'API key / permission / budget issue' };
    if (status === 404) return { kind: 'route', diagnosis: 'Model ID or provider route unavailable' };
    if (status >= 500) return { kind: 'provider_error', diagnosis: 'Provider or OpenRouter server error' };
    if (!status) return { kind: 'network', diagnosis: 'Network / connection failure' };
    return { kind: 'error', diagnosis: 'Request failed' };
  }
  function recordOpenRouterFailure(s, err, headers, model, provider) {
    if (!isOpenRouterEndpoint(s)) return;
    var diagnosis = openRouterErrorDiagnosis(err || {}, headers);
    recordOpenRouterEvent(s, {
      kind: diagnosis.kind, diagnosis: diagnosis.diagnosis,
      status: err && err.status,
      /* Keep raw provider error text out of local history: only store a safe
         status/diagnosis summary, since an upstream could echo request data. */
      /* Raw upstream text can echo request data, so only the app's own
         explanation is ever stored. */
      message: (err && err.openRouterExplanation)
        ? 'HTTP ' + err.status + ' — ' + String(err.openRouterExplanation)
        : (err && err.status
          ? 'HTTP ' + err.status + (rateLimitSummary(err && err.openRouterRateLimit)
              ? ' — ' + rateLimitSummary(err.openRouterRateLimit) : '')
          : diagnosis.diagnosis),
      rateLimit: (err && err.openRouterRateLimit) || null,
      model: model, provider: provider
    });
  }
  function openRouterResetAt(now) {
    var d = new Date(now || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
  }

  /* OpenRouter's own documentation: a 429 it raises for a free-model or a
     key-management limit carries X-RateLimit-Limit / -Remaining / -Reset
     describing the limit that was HIT, Reset being epoch milliseconds. The
     account-wide daily counter on the Connection panel reports none of that —
     per-minute and per-model ceilings live only in these headers — so a phone
     could read "772 remaining" and a "check the quota panel" line in the same
     minute, and be sent to look for an answer that panel cannot hold. Read the
     headers, carry them on the error and into the logged event. */
  function openRouterRateLimit(hdrs) {
    var out = {};
    try {
      if (!hdrs || !hdrs.get) return null;
      var lim = parseInt(hdrs.get('x-ratelimit-limit'), 10);
      var rem = parseInt(hdrs.get('x-ratelimit-remaining'), 10);
      var rst = parseInt(hdrs.get('x-ratelimit-reset'), 10);
      if (isFinite(lim) && lim >= 0) out.limit = lim;
      if (isFinite(rem) && rem >= 0) out.remaining = rem;
      if (isFinite(rst) && rst > 0) {
        /* epoch ms when it looks like an instant, relative seconds otherwise */
        out.resetInSec = rst > 1e11
          ? Math.max(0, Math.round((rst - Date.now()) / 1000))
          : Math.max(0, rst);
      }
    } catch (e) { return null; }
    if (!('limit' in out) && !('remaining' in out) && !('resetInSec' in out)) return null;
    return out;
  }

  /* The period is named by the reset window, never by the size of the limit:
     OpenRouter caps free models per minute AND per day AND, for some models,
     per model — a limit of 40 that resets in nine minutes is not a per-minute
     cap, and labelling it one sends the reader after the wrong thing. */
  function rateLimitPeriod(rl) {
    var sec = rl && typeof rl.resetInSec === 'number' ? rl.resetInSec : null;
    if (sec === null) return null;
    return sec < 120 ? 'min' : (sec < 90000 ? 'window' : 'day');
  }

  function rateLimitSummary(rl) {
    if (!rl) return null;
    var bits = [];
    if (typeof rl.limit === 'number') bits.push(rl.limit + '/' + (rateLimitPeriod(rl) || 'window'));
    if (typeof rl.remaining === 'number') bits.push(rl.remaining + ' left');
    var reset = rateLimitResetText(rl);
    if (reset) bits.push(reset);
    return bits.length ? bits.join(' · ') : null;
  }

  function rateLimitResetText(rl) {
    if (!rl || typeof rl.resetInSec !== 'number') return null;
    var sec = rl.resetInSec;
    if (sec < 2) return 'resets now';
    if (sec < 120) return 'resets in ' + sec + 's';
    if (sec < 7200) return 'resets in ' + Math.round(sec / 60) + 'm';
    return 'resets in ' + (sec / 3600).toFixed(1) + 'h';
  }

  /* OpenRouter's free Nemotron 3 endpoints default to reasoning. At the
     app's normal reply budget, that can consume all generated tokens before
     any user-facing content is emitted. Keep this workaround narrowly scoped
     to OpenRouter's NVIDIA Nemotron 3 free routes. */
  function isOpenRouterFreeNemotron(s, model) {
    return endpoint(s).toLowerCase().indexOf('openrouter.ai') !== -1 &&
      /^nvidia\/nemotron-3(?:\.5)?-[^:]+:free$/i.test(String(model || s.model || '').trim());
  }

  function headers(s) {
    var h = { 'Content-Type': 'application/json' };
    if (s.apiKey) h['Authorization'] = 'Bearer ' + s.apiKey;
    if (isOpenRouterEndpoint(s)) {
      h['HTTP-Referer'] = location.origin;
      h['X-Title'] = 'Horde Studio Mobile';
    }
    return h;
  }

  function listModels(s) {
    if (s.provider === 'horde') return Horde.listTextModels().then(function (r) {
      return r.map(function (m) { return m.name; });
    });
    return fetch(endpoint(s) + '/models', { headers: headers(s) }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && (d.error && d.error.message)) || r.statusText);
        /* Catalogs come back in three shapes (upstream 18.3.6): a bare
           array, {data: [...]} and {models: [...]} — accept all three,
           and degrade to [] instead of crashing on anything else. */
        var arr = Array.isArray(d) ? d
          : (Array.isArray(d && d.data) ? d.data
            : (Array.isArray(d && d.models) ? d.models : []));
        /* v1.39.82: keep each model's context window while we are here, so
           the history budget can fit itself to the model instead of guessing
           a character count. No extra request — the catalogue already has it. */
        rememberModelWindows(arr);
        return arr.map(function (m) {
          return typeof m === 'string' ? m : (m && (m.id || m.name));
        }).filter(Boolean);
      });
    });
  }

  function testConnection(s) {
    if (s.provider === 'horde') {
      return Horde.health().then(function (h) {
        var msg = h.textWorkers + ' text workers / ' + h.imageWorkers + ' image workers online · ' +
          h.textJobs + ' text + ' + h.imageJobs + ' image jobs queued · typical wait ~' + Math.max(h.textEta, 5) + 's';
        var who = Horde.whoami(s.hordeKey);
        return (who ? who.then(function (u) {
          if (u && u.kudos !== undefined) msg += ' · your kudos: ' + Math.round(u.kudos);
          return { ok: true, message: msg };
        }) : Promise.resolve({ ok: true, message: msg }));
      }).catch(function (e) { return { ok: false, message: e.message }; });
    }
    return listModels(s).then(function (m) {
      return { ok: true, message: m.length + ' models available' };
    }).catch(function (e) { return { ok: false, message: e.message }; });
  }

  /* Authoritative OpenRouter account counter. This is account-wide request
     quota; it is different from an individual provider/model's saturation. */
  function openRouterKeyStatus(s) {
    if (!isOpenRouterEndpoint(s)) return Promise.reject(new Error('Quota status is only available for the official OpenRouter endpoint.'));
    if (!s.apiKey) return Promise.reject(new Error('Add your OpenRouter API key in Connection settings first.'));
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    return fetch(endpoint(s) + '/key', { method: 'GET', headers: headers(s), signal: controller ? controller.signal : undefined })
      .then(function (r) {
        return r.text().then(function (text) {
          var payload = {};
          try { payload = text ? JSON.parse(text) : {}; } catch (e) { payload = {}; }
          if (!r.ok) {
            var detail = payload && payload.error || {};
            var err = providerError(r.status, detail.message || text || r.statusText, s.model, detail.metadata, r.headers, true);
            throw err;
          }
          var data = payload && payload.data;
          if (!data || typeof data !== 'object') throw new Error('OpenRouter returned an unexpected quota response.');
          return { data: data, checkedAt: Date.now(), resetsAt: openRouterResetAt(Date.now()) };
        });
      }).catch(function (err) {
        if (err && err.name === 'AbortError') {
          var timeout = new Error('OpenRouter quota check timed out after 15 seconds.');
          timeout.name = 'TimeoutError';
          throw timeout;
        }
        throw err;
      }).then(function (v) { if (timer) clearTimeout(timer); return v; }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* Explicit, cheap smoke test. Never runs automatically because it consumes
     one model request. A success proves the selected route answered now; it
     cannot promise the route will remain healthy for the next generation. */
  function probeOpenRouterModel(s) {
    if (!isOpenRouterEndpoint(s)) return Promise.reject(new Error('Model probe requires the official OpenRouter endpoint.'));
    if (!s.apiKey || !s.model) return Promise.reject(new Error('Set an OpenRouter API key and choose a model first.'));
    var started = Date.now(), controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 30000) : null;
    var request = fetch(endpoint(s) + '/chat/completions', {
      method: 'POST', headers: headers(s), signal: controller ? controller.signal : undefined,
      body: JSON.stringify((function () {
        var probeBody = { model: s.model, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 12, temperature: 0, stream: false };
        if (isOpenRouterFreeNemotron(s, s.model)) probeBody.reasoning = { enabled: false };
        return probeBody;
      })())
    }).then(function (r) {
      return r.text().then(function (text) {
        var payload = {};
        try { payload = text ? JSON.parse(text) : {}; } catch (e) { payload = {}; }
        if (!r.ok) {
          var detail = payload && payload.error || {};
          var err = providerError(r.status, detail.message || text || r.statusText, s.model, detail.metadata, r.headers, true);
          recordOpenRouterFailure(s, err, r.headers, s.model, payload.provider || '');
          /* The probe is the one place a 429 is read on screen as a sentence,
             so the figures it measured belong in the log beside it. */
          if (err && err.openRouterRateLimit) {
            recordOpenRouterEvent(s, { kind: 'account_limit', status: 429,
              diagnosis: 'Probe refused by the account limiter', rateLimit: err.openRouterRateLimit,
              message: String(err.message || '').slice(0, 300), model: s.model });
          }
          throw err;
        }
        var choice = payload.choices && payload.choices[0], message = choice && choice.message || {};
        var answer = String(message.content || choice && choice.text || '');
        var elapsedMs = Date.now() - started;
        if (!answer.trim()) {
          var empty = new Error('The selected route returned no visible answer text.');
          empty.status = 200; empty.openRouterKind = 'empty';
          recordOpenRouterEvent(s, { kind: 'empty', diagnosis: 'Route answered with no visible text', status: 200, message: empty.message, model: s.model, provider: payload.provider, usage: payload.usage });
          throw empty;
        }
        recordOpenRouterEvent(s, { kind: 'success', diagnosis: 'Selected model answered', status: 200, message: 'Probe succeeded in ' + (elapsedMs / 1000).toFixed(1) + 's', model: s.model, provider: payload.provider, usage: payload.usage });
        return { ok: true, model: s.model, elapsedMs: elapsedMs, answer: answer.slice(0, 80), usage: payload.usage || null, provider: payload.provider || '' };
      });
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        var timeout = new Error('Model probe timed out after 30 seconds. This indicates a slow or stalled route; it does not by itself prove the quota is exhausted.');
        timeout.name = 'TimeoutError';
        recordOpenRouterFailure(s, timeout, null, s.model);
        throw timeout;
      }
      throw err;
    }).then(function (v) { if (timer) clearTimeout(timer); return v; }, function (e) { if (timer) clearTimeout(timer); throw e; });
    return request;
  }

  /* v1.39.19: rate-limit discipline for the OpenAI-compatible socket.
     A 429 gets bounded backoff retries (a Retry-After header wins, capped);
     402/401/403 are explained in plain language and never retried — the
     toast used to carry only the provider's hollow "Provider returned
     error". */
  var RATE_BACKOFF = [5000, 15000];
  var RATE_RETRY_AFTER_CAP = 30000;
  function rateRetryAfterMs(hdrs) {
    try {
      var h = hdrs && hdrs.get && hdrs.get('retry-after');
      var sec = h ? parseFloat(h) : NaN;
      if (!isNaN(sec)) return Math.min(Math.max(0, sec * 1000), RATE_RETRY_AFTER_CAP);
    } catch (e) {}
    return 0;
  }
  function providerError(status, msg, modelName, metadata, responseHeaders, openRouterRequest) {
    msg = String(msg == null ? '' : msg).trim();
    var base = msg ? 'API ' + status + ': ' + msg : 'API ' + status;
    var rateLimit = openRouterRateLimit(responseHeaders);
    var e;
    if (status === 429) {
      var sharedFree = /:free\s*$/i.test(modelName || '');
      var isAccountLimit = !!(metadata && metadata.limit_source);
      try { isAccountLimit = isAccountLimit || !!(responseHeaders && responseHeaders.get && responseHeaders.get('x-ratelimit-limit')); } catch (ignored) {}
      var providerCode = metadata && metadata.provider_code;
      var rlBits = [], resetText = rateLimitResetText(rateLimit);
      if (rateLimit) {
        if (typeof rateLimit.limit === 'number') rlBits.push('limit ' + rateLimit.limit);
        if (typeof rateLimit.remaining === 'number') rlBits.push(rateLimit.remaining + ' remaining');
        if (resetText) rlBits.push(resetText);
      }
      var explanation = (isAccountLimit
        ? (rateLimit
          ? ' — OpenRouter reports an account/key rate limit: ' + rlBits.join(', ') +
            '. That is the limiter this response names; the daily counter on the ' +
            'Connection panel is a separate allowance, which is why it can still read ' +
            'hundreds remaining while this 429 stands. Per-minute ceilings do not appear ' +
            'there at all' + (rateLimit.resetInSec < 120 ? ' — and this one is that per-minute window' : '') + '.'
          : ' — OpenRouter reports an account/key rate limit. Check the quota panel for requests remaining and reset time.')
        : (openRouterRequest
          ? (providerCode
            ? ' — the upstream model provider rate-limited this route. Check the quota panel: a provider throttle can happen while account requests remain.'
            : ' — 429 rate limit. It may be the OpenRouter account cap or this model’s provider; check the quota panel to distinguish. The app retries briefly, then records the result.')
          : (sharedFree
            ? ' — the shared free endpoint for this model is saturated upstream; its provider throttles the pool regardless of YOUR balance or today’s count (both are fine). Retried already — try again in a few minutes, pick another :free model, or drop the :free suffix to spend your balance on it instead.'
            : ' — rate limit reached. Free tiers cap requests per minute and per day (OpenRouter free: 20/min, 50/day until a one-time $10 top-up). The app already retried it — give it a minute; if every try today fails, the daily cap may be spent')));
      e = new Error(base + explanation);
      /* base is 'API 429: ' + whatever the provider said. Only the clause this
         app wrote is safe to keep in local history. */
      e.openRouterExplanation = explanation;
      e.rateLimited = true;
    } else if (status === 402) {
      e = new Error(base + ' — the provider says the account is out of credits/quota. ' +
        'On OpenRouter even free models reject when the balance goes negative.');
    } else if (status === 401 || status === 403) {
      e = new Error(base + ' — the API key was rejected; check Settings and the connection.');
    } else if (status >= 500) {
      /* v1.39.94: a 5xx is not the player's account, key or quota, and it is
         not something a retry in the same minute usually fixes on a free
         route. Say which of those it is, plainly. */
      var freeRoute = /:free\s*$/i.test(modelName || '');
      e = new Error(base + ' — the provider behind this model is unavailable. ' +
        (freeRoute
          ? 'Free routes carry no availability guarantee: when the shared pool is full, ' +
            'every request is refused like this for a while and then recovers on its own. '
          : '') +
        'Nothing was lost — your message is still in the chat. The app already retried it ' +
        'twice; wait a few minutes, or switch model for now.');
      e.providerDown = true;
    } else {
      e = new Error(base);
    }
    e.status = status;
    e.openRouterMetadata = metadata || null;
    if (rateLimit) e.openRouterRateLimit = rateLimit;
    return e;
  }

  /** Stream a chat completion. onDelta(textChunk). Returns full text. */
  /** The JSON body a reply request is sent with, assembled in exactly one
   *  place. streamChat posts what this returns and the prompt inspector shows
   *  it, so a preview cannot drift from the wire - the failure loreDiagnostics
   *  was written to avoid. No field here is a second opinion about a setting:
   *  every value is read the way the request reads it. `override` is the
   *  caller's escape hatch (summarize and quickText force stream:false); it is
   *  honoured, never rewritten. */
  function chatRequestPlan(s, messages, override) {
    /* The parser must follow the mode we actually asked for, not the global
       setting. summarize() (auto-memory) and quickText() (AI persona draft)
       force stream:false; when the user has streaming on, their JSON answer was
       fed to the SSE parser and came back as '' — so memory silently never
       updated. Derive one value and use it for both request and response. */
    var wantStream = (override && override.stream !== undefined)
      ? !!override.stream
      : (s.streaming !== false);
    var body = Object.assign({
      model: s.model,
      messages: messages,
      temperature: s.temperature,
      top_p: s.topP,
      max_tokens: s.maxTokens,
      stream: wantStream
    }, override || {});
    /* v1.43.0: OpenRouter's own answer to a saturated route is a model chain —
       "add fallback models ... to try a different model when all providers for
       the first are exhausted". The app retried the SAME route twice and then
       told the user to go and change the model by hand, which is the one thing
       in this app a machine could do better. OpenRouter only: the Horde socket
       has no such field and strict OpenAI-compatible hosts reject unknown keys.
       A caller override wins, so a hand-built body is never rewritten. */
    var fbList = String((s && s.replyFallback) || '').split(/[,\n]/)
      .map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 3);
    if (fbList.length && isOpenRouterEndpoint(s) && !body.models) {
      body.models = [body.model].concat(fbList);
    }
    /* OpenRouter's free Nemotron 3 routes can spend this whole budget on
       hidden reasoning, returning no final content. Disable it by default
       only for those routes; leave an explicit caller override intact.
       v1.43.0: "Ask for no thinking at all" widens the same treatment to any
       OpenRouter model, because the failure is not Nemotron-shaped — it is
       budget-shaped, and a 400-token reply budget is the whole problem. */
    var guardedNemotron = isOpenRouterFreeNemotron(s, body.model) ||
      !!(s && s.reasoningOff && isOpenRouterEndpoint(s));
    if (guardedNemotron && !(body.reasoning && body.reasoning.enabled === true)) {
      body.reasoning = Object.assign({}, body.reasoning || {}, { enabled: false });
    }
    /* v1.39.25 — repetition guard: never sent before, so a model's favorite
       words kept regenerating into the history they were read back from — a
       loop no amount of message-editing could ever finish. 0/unset omits the
       key entirely (byte-identical body; some providers dislike the nuance). */
    if (s.frequencyPenalty) body.frequency_penalty = s.frequencyPenalty;
    /* The flag the response parser follows and the field the provider sees are
       one value, assigned once rather than derived twice. Both derived answers
       travel out with the body: the reply handler needs to know whether it asked
       for the reasoning guard, and a second copy of that condition is how the
       preview and the wire drift apart. */
    body.stream = wantStream;
    return {
      body: body,
      wantStream: wantStream,
      reasoningGuarded: !!guardedNemotron
    };
  }

  function streamChat(s, messages, onDelta, signal, override) {
    var plan = chatRequestPlan(s, messages, override);
    var body = plan.body;
    /* read back, never recomputed: whatever mode the body asks for is the mode
       the parser uses, and the guard the reply handler reasons about is the one
       the body actually carries */
    var wantStream = plan.wantStream;
    var guardedNemotron = plan.reasoningGuarded;

    /* v1.21.0 (ported from upstream 18.3.5): a stream that hangs mid-read
       used to wedge the app in "Generating…" forever, and a stream that
       carried anything but completion frames (an HTML error page, a proxy
       notice) surfaced as a mysterious "…" bubble. Both now fail loud, and
       the whole request dies at a deadline instead of waiting on silence. */
    return new Promise(function (resolve, reject) {
      var settled = false;
      var reader = null, streamedUsage = null, streamedProvider = '';
      function fail(err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (reader) { try { reader.cancel().catch(function () {}); } catch (e) {} }
        recordOpenRouterFailure(s, err, err && err.openRouterHeaders, body.model, streamedProvider);
        reject(err);
      }
      function ok(v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
      var timer = setTimeout(function () {
        var err = new Error('The provider did not complete within ' +
          Math.round(STREAM_TIMEOUT_MS / 1000) + ' seconds. Retry or choose another model.');
        err.name = 'TimeoutError';
        fail(err);
      }, STREAM_TIMEOUT_MS);

      var connectAttempt = 0;
      function attemptFetch() {
      /* a backoff firing after timeout/abort must not raise the dead */
      if (settled) return;
      if (signal && signal.aborted) return;
      fetch(endpoint(s) + '/chat/completions', {
        method: 'POST', headers: headers(s), body: JSON.stringify(body), signal: signal
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = t, errorMeta = null;
            try { var j = JSON.parse(t); msg = (j.error && (j.error.message || JSON.stringify(j.error))) || j.message; errorMeta = j.error && j.error.metadata || null; } catch (e) {}
            if (r.status === 429 && connectAttempt < RATE_BACKOFF.length && !settled) {
              var wait = rateRetryAfterMs(r.headers) || RATE_BACKOFF[connectAttempt];
              connectAttempt++;
              setTimeout(attemptFetch, wait);
              return;
            }
            /* 502/503/504: the upstream provider is saturated or restarting,
               which is the single most common failure on free routes. Asking
               again shortly usually succeeds, so do not surface it at once. */
            if ((r.status === 502 || r.status === 503 || r.status === 504) &&
                connectAttempt < RATE_BACKOFF.length && !settled) {
              var fWait = RATE_BACKOFF[connectAttempt];
              connectAttempt++;
              setTimeout(attemptFetch, fWait);
              return;
            }
            var httpErr = providerError(r.status, msg, body.model, errorMeta, r.headers, isOpenRouterEndpoint(s));
            httpErr.openRouterHeaders = r.headers;
            fail(httpErr);
          }).catch(fail);
        }
        if (!wantStream) {
          return r.json().then(function (d) {
            if (d.choices && d.choices[0] && d.choices[0].finish_reason) lastFinish = String(d.choices[0].finish_reason);
            var txt = (d.choices && d.choices[0] && (d.choices[0].message ? d.choices[0].message.content : d.choices[0].text)) || '';
            if (!txt && guardedNemotron) {
              var noText = new Error('The OpenRouter free Nemotron endpoint returned no final answer text. Reasoning is disabled automatically; retry the request.');
              noText.openRouterKind = 'empty';
              fail(noText);
              return;
            }
            if (onDelta) onDelta(txt);
            recordOpenRouterEvent(s, { kind: 'success', diagnosis: 'Request completed', status: 200, model: body.model, provider: d.provider || '', usage: d.usage || null });
            ok(txt);
          }).catch(fail);
        }
        reader = r.body.getReader();
        var dec = new TextDecoder(), buf = '', full = '';
        var sawValidFrame = false;
        function line(raw) {
          var value = raw.trim();
          if (!value) return;
          if (value.indexOf('data:') === 0) {
            var payload = value.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              var j = JSON.parse(payload);
              /* v1.39.21: a data frame carrying an error (idle upstream,
                 provider hiccup mid-stream) must fail with ITS message —
                 before, it silently settled as an empty "…" bubble */
              if (j && j.error) {
                var streamErr = new Error('API stream error: ' + (j.error.message || JSON.stringify(j.error)));
                streamErr.status = Number(j.error.code) || null;
                streamErr.openRouterMetadata = j.error.metadata || null;
                fail(streamErr);
                return;
              }
              sawValidFrame = true;
              if (j.usage) streamedUsage = j.usage;
              if (j.provider) streamedProvider = String(j.provider);
              var ch = j.choices && j.choices[0];
              if (ch && ch.finish_reason) lastFinish = String(ch.finish_reason);
              var delta = ch && (ch.delta ? ch.delta.content : ch.text);
              if (delta) { full += delta; if (onDelta) onDelta(delta, full); }
            } catch (e) { /* a malformed frame: the end-of-stream checks judge it */ }
            return;
          }
          if (/^(?:event|id|retry):/.test(value)) return;   /* SSE metadata, harmless */
          if (value.charAt(0) === ':') return;              /* v1.39.21: SSE comment — the spec's keep-alive; OpenRouter fires ': OPENROUTER PROCESSING' before and mid-stream */
          /* anything else is not a chat stream at all - fail loud instead of
             letting it dissolve into an empty reply */
          fail(new Error('The provider returned an invalid chat stream. Retry or choose another model.'));
        }
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) {
              if (buf.trim()) line(buf);
              if (!settled) {
                /* no text and not even one parseable completion frame: this
                   was never a real chat stream. A frame that parsed but had
                   no content is legitimate (the app shows its "…" bubble),
                   and keeps resolving '' exactly as before. */
                if (!full && guardedNemotron) {
                  var noStreamText = new Error('The OpenRouter free Nemotron endpoint returned no final answer text. Reasoning is disabled automatically; retry the request.');
                  noStreamText.openRouterKind = 'empty';
                  fail(noStreamText);
                  return;
                }
                if (!full && !sawValidFrame) {
                  fail(new Error('The provider completed without visible text. Retry or choose another model.'));
                  return;
                }
                recordOpenRouterEvent(s, { kind: 'success', diagnosis: 'Request completed', status: 200, model: body.model, provider: streamedProvider, usage: streamedUsage });
                ok(full);
                return;
              }
              return;
            }
            buf += dec.decode(res.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            for (var i = 0; i < lines.length; i++) {
              line(lines[i]);
              if (settled) return;
            }
            return pump();
          }, fail);
        }
        return pump();
        }, fail);
      }
      attemptFetch();
    });
  }

  /* Reveal a finished string progressively so Horde replies feel the same as streams */
  function revealText(text, onDelta) {
    return new Promise(function (resolve) {
      var words = text.split(/(\s+)/);
      var i = 0, out = '';
      (function step() {
        if (i >= words.length) return resolve(out);
        var chunk = words.slice(i, i + 3).join('');
        i += 3;
        out += chunk;
        if (onDelta) onDelta(chunk, out);
        setTimeout(step, 12);
      })();
    });
  }

  /** Refuse early (and clearly) when the chosen Horde model has no workers. */
  function guardModel(type, name) {
    if (!name || name === Horde.ANY_UNCENSORED) return Promise.resolve();
    return Horde.modelStatus(type, name).then(function (st) {
      if (st && st.count === 0) {
        var e = new Error('No workers are serving “' + name + '” right now. ' +
          'Set it to “Any available model” or pick one with workers online.');
        e.modelOffline = true;
        throw e;
      }
    }).catch(function (e) {
      if (e && e.modelOffline) throw e;   // real problem worth surfacing
      return null;                        // couldn't check: don't block the job
    });
  }

  function escapeRe(s) { return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /**
   * The Horde generates raw text: models happily keep writing past their own turn
   * ("Sera: ..." then "You: ...") and stop dead at max_length. Cut at the next
   * speaker so the reply is theirs and theirs alone.
   */
  /* ------------------------------------------------------------------
   * Thinking that leaks into the reply.
   *
   * Plenty of models plan out loud before they answer. Some wrap it in tags
   * (<think>, <reasoning>, …) and those are easy. The harder case is a model
   * that just starts thinking in plain prose — question headers, "let's refine
   * the response", references to "the prompt" — and only then writes the reply.
   * ------------------------------------------------------------------ */
  var THINK_TAGS = 'think|thinking|reasoning|reasoned|thought|thoughts|internal|analysis|' +
    'reflection|plan|planning|notes|scratchpad|chain[- ]?of[- ]?thought|antml:think';

  /** A line that is the model talking to itself rather than to the player. */
  function isMetaLine(L) {
    var l = String(L || '').trim();
    if (!l) return false;
    if (/\?$/.test(l) && l.length < 70) return true;                 // "How do they react?"
    /* A bare "Note:" is how a character leaves a note on the table, and this
       test runs over every line of a reply — treating that as planning is what
       deletes a scene beat. Only the bracketed forms stay, further down. */
    if (/^(?:let's|lets|let me|wait|okay|ok[,.]|hmm|so,|now,|first,|firstly|then,|after that|actually,|maybe|perhaps|alright|right,|yes,|no,|i should|i'll|i will|i'd|i need|i can|i could|i must|i want to|we should|we need|the prompt|the instruction|the system|the card|step \d|finally,|also,|importantly,?|keep in mind|remember,?|one more|to sum|in summary,?)/i.test(l)) return true;
    if (/\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?|requires?|mentions?)\b/i.test(l)) return true;
    if (/\b(?:refine|rework|rewrite|adjust|revise|tighten|trim)\s+(?:the\s+)?(?:response|reply|answer|draft|this)\b/i.test(l)) return true;
    if (/\b(?:i|we)\s+(?:should|need to|could|can|will|must|might)\s+(?:probably\s+)?\b/i.test(l) && l.length < 90) return true;
    /* v1.39.86: [ooc] is not planning. The OOC rule above asks the model to
       answer in a tagged line, and this test then classified that very line as
       reasoning and stripped it — the player's question went unanswered and
       the answer, when it came, was deleted. OOC is an aside for the player;
       [note]/[meta]/[aside] are still treated as planning. */
    if (/^(?:\[|\()\s*(?:note|meta|aside)/i.test(l)) return true;
    return false;
  }

  /** A line that is unmistakably the story: dialogue, an action beat, a speaker. */
  function isProseLine(L) {
    var l = String(L || '').trim();
    if (!l || isMetaLine(l)) return false;
    if (/^["“*_(]/.test(l)) return true;                             // speech, *action*, (beat)
    if (/["“”]/.test(l) && l.length > 40) return true;               // a line with dialogue in it
    if (l.length > 120) return true;                                 // a real paragraph
    if (/^[A-Z][\w'’ -]{1,24}:\s+\S/.test(l) && l.length > 24) return true;   // "Rachel: …"
    return false;
  }

  /** Planning commentary after the reply. Deliberately narrow: a character
      ending on a question is normal, so a bare "?" is not enough to cut. */
  function isTrailerMeta(L) {
    var l = String(L || '').trim();
    if (!l) return false;
    if (/\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?)\b/i.test(l)) return true;
    if (/\b(?:refine|rework|rewrite|adjust|revise|tighten|trim)\s+(?:the\s+)?(?:response|reply|answer|draft|this)\b/i.test(l)) return true;
    if (/^(?:let's|lets|okay|ok,|alright|hmm|now,|finally,|in summary|to sum up|i'll|i will|i should)\b/i.test(l) && l.length > 20) return true;
    /* v1.29.1: the observed Horde trailer - a self-audit, then a sign-off.
       Deliberately strict: these only count as planning when they START a
       line; a story line that merely contains the words is prose. */
    if (/^self[- ]correction\s+check\b/i.test(l)) return true;
    if (/^self[- ]check\s*:/i.test(l)) return true;
    if (/^ready\s+to\s+output\b/i.test(l)) return true;
    return false;
  }

  /** v1.29.1: a line of pure separator characters. Tolerated (and dropped)
   *  only while a trailer is being popped from the end of a reply, so a
   *  story that legitimately ends on a divider is left alone. */
  function isSeparatorLine(L) {
    return /^\s*[-=*_]{3,}\s*$/.test(String(L || ''));
  }

  /**
   * Remove the model's reasoning from a reply, keeping what the character
   * actually says. Tagged blocks always go. An unlabelled preamble only goes
   * when several consecutive-looking planning lines precede the first real
   * line of story, so ordinary prose is never mistaken for thinking.
   */
  function stripThinking(text, enabled) {
    var t = String(text || '');
    if (!t) return t;
    if (enabled === false) return t;

    /* 1. <think>…</think> and friends, including when the model forgets to close */
    var re = new RegExp('<(?:' + THINK_TAGS + ')\\s*>[\\s\\S]*?(?:</(?:' + THINK_TAGS + ')\\s*>|$)', 'i');
    var out = t, m, guard = 0;
    while ((m = re.exec(out)) && guard++ < 20) {
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
    }
    if (!out.trim()) return t;                    // it was all thinking — keep something

    /* 2. an unlabelled planning preamble in front of the reply.
          Scan the whole thing rather than stopping at the first story-looking
          line: a long context line inside the planning would otherwise cut the
          scan short and leave the rest of the reasoning behind. We only strip
          when planning clearly dominates the head and a reply is left over. */
    var lines = out.split('\n');
    var meta = [], prose = [], i;
    var lastMeta = -1;
    for (i = 0; i < lines.length; i++) {
      var l = lines[i].trim();
      meta[i] = !!l && isMetaLine(l);
      prose[i] = !!l && !meta[i] && isProseLine(l);
      if (meta[i]) lastMeta = i;
    }
    if (lastMeta >= 0) {
      var m = 0, p = 0, q = 0;
      var head = [];
      for (i = 0; i <= lastMeta; i++) {
        if (meta[i]) {
          m++;
          if (/\?\s*$/.test(lines[i]) && lines[i].length < 70) q++;   // "How do they react?"
        }
        if (prose[i]) p++;
        if (lines[i].trim()) head.push(lines[i]);
      }
      var refs = /\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?)\b/i.test(head.join('\n'));
      var tailHasStory = false;
      for (i = lastMeta + 1; i < lines.length; i++) if (prose[i]) { tailHasStory = true; break; }

      if (m > p && (q >= 2 || refs || m >= 4)) {
        var rest = lines.slice(lastMeta + 1).join('\n').trim();
        if (rest.length >= 25 && tailHasStory) out = rest;
      }
    }

    /* 3. v1.29.1: a planning TRAILER at the end - the observed Horde
          pattern is scene, divider, a self-check, and a sign-off. Same
          pop rule as cleanReply: blanks and dividers go only while a
          planning line is actually being dropped, so a story that merely
          ends with the author's own divider is untouched. */
    var tl = out.split('\n');
    var sawT = false;
    while (tl.length > 1) {
      var lastL = tl[tl.length - 1];
      if (isTrailerMeta(lastL)) { tl.pop(); sawT = true; continue; }
      /* blanks and dividers go only while the trailer is going; a story
         that ends on the author's own divider is left exactly as written */
      if ((lastL.trim() === '' || isSeparatorLine(lastL)) && sawT) { tl.pop(); continue; }
      break;
    }
    return tl.join('\n');
  }

  function cleanReply(text, charName, userName, opts) {
    if (!text) return '';
    /* v1.39.93: on a card with more than one character in the scene, the card's
       own name is a SPEAKER LABEL, not the start of a new turn. The old rules
       cut the reply at the first line beginning with it and stripped it off the
       front, so whenever the loaded character spoke first her name vanished and
       nothing on screen said who was talking. Those two rules stay for a
       single-character card, where "CharName:" really is the model starting a
       turn it should not have written. */
    var casted = !!(opts && opts.cast && opts.cast.length >= 2);
    var lines = String(text).split('\n');
    var out = [];
    var userRe = new RegExp('^\\s*' + escapeRe(userName) + '\\s*:', 'i');
    var charRe = new RegExp('^\\s*' + escapeRe(charName) + '\\s*:', 'i');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0 && (userRe.test(lines[i]) || (!casted && charRe.test(lines[i])))) break;
      out.push(lines[i]);
    }

    /* A model handing the pen back to the player ("What's your response as
       Aslyn?", "Your response:") is not part of the reply. Drop those trailing
       lines — but only short ones that are clearly a prompt, and never so many
       that nothing is left. */
    var asName = charName
      ? new RegExp('response\\s+as\\s+' + escapeRe(String(charName)) + '\\b', 'i')
      : null;
    var META = /^(?:your\s+)?(?:next\s+)?response\b[\s\S]*$/i;
    var META_ANY = /\byour\s+(?:next\s+)?response\b/i;
    var ASK = /^(?:\[|<)?(?:write|continue|you\s+respond|your\s+turn)\b/i;
    /* v1.29.1: a planning trailer (and the blanks/dividers around it) is
       popped from the end; a story that merely ends on its own divider is
       left exactly as written. */
    var sawTrailer = false;
    while (out.length > 1) {
      var last = out[out.length - 1];
      var isMeta = META.test(last) ||
        (asName && asName.test(last)) ||
        (ASK.test(last) && last.length < 80) ||
        (META_ANY.test(last) && last.length < 80 && /[?:]\s*$/.test(last)) ||
        isTrailerMeta(last);
      if (isMeta) { out.pop(); sawTrailer = true; continue; }
      if ((last.trim() === '' || isSeparatorLine(last)) && sawTrailer) { out.pop(); continue; }
      break;
    }

    var t = out.join('\n').replace(/\s+$/, '');
    /* v1.39.93 stopped stripping the card's own first-line label on a cast card
       because at that moment nothing else on screen said who was speaking. That
       reason expired in the same release, which added the bubble header — and
       the header always has something to say, because views.js renders
       `m.speakerName || char.name`. So the inline label is a duplicate of the
       header, and a duplicate that compounds: the stored line is labelled again
       when the next prompt is built (`sp.name + ': ' + sp.text`), which is how a
       chat ends up reading "Name: Name: Name: …" a few turns in. The label is
       therefore stripped on the first line for every card now.

       What v1.39.93 existed to protect stays protected: another speaker's label
       is never touched (it is the only thing naming them), and a later line
       beginning with the card's own name still does not cut the reply — the
       `!casted` rule in the loop above is unchanged, and this pattern is not
       multiline, so only line 0 can ever match it. */
    if (charName) t = t.replace(new RegExp('^\\s*\\*{0,2}\\s*' + escapeRe(charName) + '\\s*:\\*{0,2}\\s*', 'i'), '');
    return t.trim();
  }

  /* Short words that can legitimately end a generation pass — if the last word is one of
     these we treat the next chunk as a new word and re-insert the space. */
  var COMMON_WORDS = /^(a|an|and|the|to|of|in|on|at|is|it|its|was|were|be|been|am|are|that|this|these|those|with|for|from|by|as|but|not|no|nor|or|so|if|then|than|there|here|their|his|her|hers|him|she|he|they|them|we|you|your|yours|i|my|our|have|has|had|will|would|can|could|should|shall|may|might|must|do|does|did|done|up|out|down|over|under|again|more|most|some|any|all|one|two|three|what|when|where|why|how|who|whom|which|because|about|into|onto|off|after|before|while|during|through|between|against|among|also|very|just|only|even|still|yet|ever|never|always|now|soon|later|today|tonight|yes|ok|okay|well|good|bad|right|left|back|away|enough|much|many|few|own|same|such|other|another|every|both|each|either|neither|mine|me|us|let|lets|go|going|went|come|coming|came|said|says|say|know|knows|knew|think|thought|want|wants|need|needs|see|saw|look|looked|take|took|give|gave|make|made|get|got|tell|told|ask|asked|keep|kept|put|find|found|leave|left|feel|felt|seem|seemed|turn|turned|stand|stood|hold|held|hear|heard|run|ran|move|moved|open|opened|close|closed|begin|began|start|started|stop|stopped|work|worked|try|tried|use|used)$/i;

  /* A continuation sometimes starts with two words fused into one token
     ("shattereach", "Precisionover") because the model picks up mid-sentence.
     Split it when the tail is a common word and the head is not — a real word
     such as "understand" or "everyone" has a common HEAD, so it is left
     alone. Only ever applied to the first word of a continuation. */
  function unfuseFirstWord(piece) {
    var m = /^([\"'\u201c\u2018(]*)([A-Za-z]{10,})(?![A-Za-z])/.exec(piece);
    if (!m) return piece;
    var lead = m[1], word = m[2];
    if (COMMON_WORDS.test(word)) return piece;
    /* both halves must be at least four letters: a three-letter tail catches
       real words ("under|stand" -> "underst and"), four does not */
    for (var k = word.length - 4; k >= 4; k--) {
      var head = word.slice(0, k), tail = word.slice(k);
      if (COMMON_WORDS.test(tail) && !COMMON_WORDS.test(head)) {
        return lead + head + ' ' + tail + piece.slice(m[0].length);
      }
    }
    return piece;
  }

  /** Does this read like it was cut off? */
  function looksTruncated(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    /* v1.39.17: cut mid-contraction ("…each other, don'") — the tail is an
       apostrophe GLUED to a letter, which only happens inside a word; a
       genuinely finished line ends on punctuation AFTER the quote mark.
       This shape used to slip the punctuation whitelist below and the
       auto-finish rounds never fired. */
    if (/[A-Za-z]['\u2019]\s*$/.test(t)) return true;
    if (/[.!?\u2026"\u201d'\u2019)\]]\s*$/.test(t)) return false;   // ended on real punctuation
    if (/\*\s*$/.test(t)) return false;                             // ended on an action beat
    return true;                                                  // dangling word, comma, dash…
  }

  /**
   * Break a one-line reply into its sentences. Returns null unless every piece
   * looks like a text someone would actually send — that keeps "Dr. Warden is
   * here" and long prose from being torn apart.
   */
  var ABBREV = /^(?:mr|mrs|ms|dr|st|jr|sr|prof|vs|etc|eg|ie|approx|no|al|fig|figs|vol|ch|pp|inc|ltd|co|mt|ft|sq|ave|rd|blvd)$/i;
  function splitSentences(t) {
    if (t.length > 220 || t.length < 12) return null;
    var parts = [], buf = '';
    for (var i = 0; i < t.length; i++) {
      buf += t.charAt(i);
      if (!/[.!?]/.test(t.charAt(i))) continue;
      var next = t.charAt(i + 1);
      if (next !== undefined && !/\s/.test(next)) continue;          // mid-word punctuation
      var word = (buf.trim().replace(/[.!?]+$/, '').match(/[\w'’-]+$/) || [''])[0];
      if (word.length <= 1 || ABBREV.test(word)) continue;            // initials and "Dr."
      parts.push(buf.trim());
      buf = '';
    }
    if (buf.trim()) parts.push(buf.trim());
    if (parts.length < 2) return null;
    /* every piece has to read as a text of its own: at least two words, and
       short enough to have been typed in one go */
    var ok = parts.every(function (p) {
      return p.split(/\s+/).length >= 2 && p.length <= 120;
    });
    return ok ? parts : null;
  }

  /**
   * Split one generation into the separate texts a person would actually send.
   *
   * Structured replies keep their explicit boundaries; for anything else this is a
   * deliberately conservative fallback — paragraphs, formatted blocks and anything
   * that reads like prose stay exactly as the model wrote it. (v18.0.1)
   */
  function splitBurst(text, max) {
    var t = String(text || '').trim();
    if (!t) return [];
    max = Math.max(1, Math.min(4, max || 1));
    if (max < 2) return [t];

    /* never break up formatting the model clearly meant as one block */
    if (/```|^\s*>|^\s*#{1,6}\s|^\s*\|/m.test(t)) return [t];
    if (t.indexOf('\n') === -1) {
      /* Bounded compatibility fallback: most models write a burst as one run-on
         line instead of separate lines. Split on sentence ends, but only when
         every piece is a plausible text of its own. */
      var sentences = splitSentences(t);
      if (sentences && sentences.length >= 2 && sentences.length <= max) return sentences;
      return [t];
    }

    var lines = t.split(/\n+/).map(function (l) {
      return l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    }).filter(Boolean);
    if (lines.length < 2 || lines.length > max) return [t];
    if (t.length > 600) return [t];

    /* every line has to stand on its own: short enough to be one text, and either
       punctuated or short enough that punctuation doesn't matter */
    var ok = lines.every(function (l) {
      if (l.length > 180) return false;
      return /[.!?\u2026"'\u201d\u2019)\]]\s*$/.test(l) || l.length <= 60;
    });
    return ok ? lines : [t];
  }

  /* v1.39.27 — continuation passes that REPLAY instead of continuing. When
     a chat-template model is handed the cut reply back as its own
     turn-in-progress, it may complete that turn and rerun a whole paragraph
     ("Her emerald eyes close…" twice in one bubble), and the pass's token
     budget dies on the rerun. Measure the shared run that reaches the very
     END of the text we already had — that is, and only that is, a replayed
     cut-tail; shorter or floating overlaps are coincidence. */
  function replayedTail(before, piece) {
    if (!before || !piece) return 0;
    var first = piece.charAt(0), best = 0;
    for (var p = 0; p < before.length; p++) {
      if (before.charAt(p) !== first) continue;
      var n = 0;
      while (n < piece.length && p + n < before.length && before.charAt(p + n) === piece.charAt(n)) n++;
      /* the run counts only when it reaches the end of `before` — a replay
         of the cut tail continues INTO the piece; an internal echo is not
         the stitcher's business */
      if (p + n === before.length && n > best) best = n;
    }
    return best >= 40 ? best : 0;
  }

  /** Where a reply should end, as Horde stop sequences. */
  function stopSeqs(char, s) {
    var u = String((s && s.userName) || 'You').trim();
    var c = String((char && char.name) || '').trim();
    var out = [];
    if (u) out.push('\n' + u + ':', '\n' + u + ' :', u + ':');
    if (c && c !== u) out.push('\n' + c + ':', '\n' + c + ' :');
    out.push('\n<START>', '<START>');
    return out.slice(0, 8);
  }

  /**
   * Main entry: generate the next reply.
   * If a reply comes back cut off mid-sentence, keep going until it lands on its
   * feet (up to 3 passes) — providers that stop cleanly just return after one.
   */
  function generate(o) {
    var s = o.settings, char = o.character, session = o.session;
    /* Keep the auto-finisher bounded: its job is to close a cut-off reply,
       not to keep extending the narration indefinitely. */
    var maxRounds = (o.autoFinish === false || s.autoFinish === false) ? 1 : 3;
    /* v1.39.17: opts.continueFrom seeds the assembly with a partial reply
       (the manual Continue button). The seed rides the wire as the
       assistant's own turn-in-progress, so the model FINISHES the cut
       sentence instead of inventing a new beat that echoes the last one. */
    var full = o.continueFrom ? String(o.continueFrom) : '';

    function round(idx) {
      if (o.signal && o.signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
      if (s.provider === 'horde') {
        /* buildPrompt ends with "Name:" — for a continuation we append what we have
           so the model carries on from that exact point. */
        /* A continuation round re-sends what we already have on top of the
           prompt, so it has to leave room for two replies, not one. */
        var inContinuation = (idx > 0 || !!o.continueFrom);
        var budget = HORDE_CTX_TOKENS - maxTokensOf(s) * (inContinuation ? 2 : 1) - 64;
        var base = buildPrompt(char, session, o.history, s, o.note, budget, o.finalNote);
        var prompt = inContinuation ? base + ' ' + full : base;
        return guardModel('text', s.hordeTextModel).then(function () {
          return Horde.generateText({
            prompt: prompt,
            model: s.hordeTextModel || '',
            maxLength: maxTokensOf(s),
            temperature: s.temperature,
            topP: s.topP,
            topK: s.topK,
            repPen: s.repPen,
            apikey: s.hordeKey,
            signal: o.signal,
            maxWait: s.hordeMaxWait,
            onProgress: o.onProgress,
            stopSequence: stopSeqs(char, s)
          });
        }).then(function (r) {
          /* v1.29.1: record who actually answered. "Requested" is a
             setting; this is the receipt. The world's status sheet shows
             it under the run - no other behaviour changes. */
          API.lastHorde = {
            model: r.model || '',
            worker: r.worker || '',
            kudos: r.kudos || null,
            tries: r.tries || null,
            requested: s.hordeTextModel || 'any'
          };
          return r.text;
        });
      }
      var msgs = buildChat(char, session, o.history, s, o.note, o.finalNote);
      if (idx > 0 || o.continueFrom) {
        /* v1.39.30: the trailing assistant PREFILL alone is not portable.
           Some chat endpoints read it as a FINISHED turn and answer with a
           fresh beat — a seeded Continue then "continues" with a brand-new
           reply (observed live: the cut after "…Crabbe" answered with
           "Draconica's expression doesn't change…"). Pin the instruction in
           words right at the seam, immediately before the seed, so even a
           prefill-blind endpoint knows the following text is in-progress. */
        /* Quote the exact stopping point. Told only "continue", models read the
           cut text as a finished turn and write what happened NEXT — the robe
           order came back as "You fold the outer robe…" instead of finishing
           "Place it". Naming the words removes that reading. */
        var cutTail = String(full).replace(/\s+/g, ' ').trim().slice(-90);
        msgs.push({ role: 'system', content:
          '[System note: the assistant message that follows this note is one reply that was CUT OFF ' +
          'mid-stream by a length limit. It is NOT a finished turn, and the events in it are not ' +
          'resolved. Finish it. The text stops at these exact words: "' + cutTail + '" — your first ' +
          'words must continue that unfinished sentence and complete the action being described, ' +
          'before anything else happens. Begin with the characters that follow those words — do not ' +
          're-emit the final word you were given. Do not start a new sentence, paragraph or story beat. Do not ' +
          'describe the result of an order that was still being given. Do not repeat, restate or ' +
          'rephrase any text already written, and do not speak as the user.]' });
        msgs.push({ role: 'assistant', content: full });
      }
      /* Preview this pass in its own buffer. loop() cleans the returned text and
         commits it to `full` exactly once — accumulating here as well left two
         copies of every tag, so a single [[cash:+10]] settled as +20. */
      var streamed = '';
      var contOverride = o.override;
      if (o.continueFrom && !(contOverride && contOverride.temperature !== undefined)) {
        var ct = parseFloat(s.temperature);
        if (!(ct > 0)) ct = 0.85;
        contOverride = Object.assign({}, contOverride || {}, { temperature: Math.min(ct, 0.7) });
      }
      return streamChat(s, msgs, function (chunk) {
        streamed += chunk;
        /* a seeded continuation previews seed + stream WITHOUT the glue
           guess — the real seam rule settles it in the assembled text */
        if (o.onDelta) o.onDelta(chunk, full ? full + (o.continueFrom && idx === 0 ? '' : ' ') + streamed : streamed);
      }, o.signal, contOverride);
    }

    function loop(idx) {
      return round(idx).then(function (txt) {
        var raw = stripThinking(txt || '', s.stripThinking !== false);
        /* v1.39.30: the raw stream's own leading whitespace IS the seam
           evidence — tokenized continuations of a complete word begin with a
           " " token ("…Crabbe" + " and Goyle"), while a word cut mid-token
           continues straight on ("rh" + "ythms"). cleanReply trims that
           space away, which once tight-glued "Crabbe" + "and"; hold it in a
           flag and hand it back after cleaning, before the glue rules run. */
        var leadSpace = /^\s/.test(raw);
        var piece = cleanReply(raw, char && char.name, s.userName, { cast: session && session.sceneCast });
        if (!piece) return full;

        /* Stitch without mangling. The hard part: when the previous pass ends with a
           letter and the next starts with one, it is either a word split by the token
           limit ("wes" + "t.") or a real word boundary ("and" + "how"). Only join tight
           when the last word does not read as a finished English word. */
        /* v1.39.27: strip a replayed cut-tail BEFORE the seam rules see the
           piece — otherwise the glue logic pastes the rerun whole (the
           doubled paragraph the user screenshot) and the pass's budget is
           spent on text we already had. */
        if (o.continueFrom && idx === 0 && piece) piece = unfuseFirstWord(piece);
        var reran = replayedTail(full, piece);
        if (reran) piece = piece.slice(reran);
        /* v1.39.30: a model that parrots the continue-note sheds its bracket
           echo before the seam rules see it (the space that followed the
           bracket stays, so word-boundary seams still read as boundaries) */
        piece = piece.replace(/^\s*\[[^\]\n]*[Cc]ontinue[^\]\n]*\]/, '');
        /* v1.39.31: seam STUTTER below the 40-char replay line. Observed
           live: cut at "…Fingers interl", the next pass replayed "Fingers
           interl" then continued "…aced…" — 14 chars, under the replay
           threshold, pasted whole. Two shapes, both only meaningful at a
           mid-sentence cut; pure coincidental echoes ("water is cold")
           continue AFTER a space and stay untouched:
             1) fragment straddle — the piece re-emits the cut fragment and
                keeps writing INTO the word (remainder starts with a letter)
             2) whole-word repeat — the piece re-opens with the cut word
                itself then moves on ("Crabbe and Goyle…") */
        var stutRun = 0, seamSpace = false;
        if (!reran && full && piece && !/[.!?\u2026"'\u201d\u2019)\]]\s*$/.test(full) &&
            /[A-Za-z'\u2019]$/.test(full)) {
          for (var L = Math.min(full.length, piece.length, 24); L >= 6; L--) {
            if (piece.slice(0, L) === full.slice(-L) &&
                /[A-Za-z'\u2019]/.test(piece.charAt(L))) { stutRun = L; break; }
          }
          if (stutRun) {
            /* v1.39.64: the re-emitted cut word can be FUSED to the next one
               by the model ("Precision" + "over power" came back as
               "Precisionover power", pasted as one word). If what follows the
               stripped tail reads as a whole word, the seam is a boundary and
               keeps its space; only a fragment ("aced") stays tight. */
            var restWord = (piece.slice(stutRun).match(/^[A-Za-z']+/) || [''])[0];
            piece = piece.slice(stutRun);
            if (restWord && COMMON_WORDS.test(restWord)) seamSpace = true;
          } else {
            var tw = full.match(/[A-Za-z'\u2019]{3,}$/);
            if (tw && piece.indexOf(tw[0]) === 0 && piece.charAt(tw[0].length) === ' ') {
              piece = piece.slice(tw[0].length + 1);
              seamSpace = true;
            }
          }
        }
        if (!stutRun && !seamSpace && leadSpace && full && piece && !/^\s/.test(piece)) piece = ' ' + piece;
        /* v1.39.29: a pure rerun spends THIS round but must not end the
           story — v1.39.27's hard stop here silently returned while the
           reply was still cut mid-sentence. Fall through to after(): when
           the text still looks truncated, the remaining rounds of the
           ordinary 3-round budget still get their chance to close it;
           maxRounds itself is the only ceiling, as for any other round. */
        if (!piece) return after();

        var glue = '';
        if (full) {
          var prevEnd = full.slice(-1), nextStart = piece.charAt(0);
          var lastWord = full.match(/[A-Za-z']+$/);
          var splitWord = /[A-Za-z0-9]$/.test(prevEnd) && /^[A-Za-z0-9]/.test(nextStart) &&
            !(lastWord && COMMON_WORDS.test(lastWord[0]));
          /* the seam is a contraction ('' + 't you…'): join tight only for
             stems that actually take an apostrophe-suffix — a plural
             possessive like "the Malfoys'" must NOT swallow the next word */
          var stem = full.match(/([A-Za-z]+)['\u2019]$/);
          var cutContraction = !!(stem && /^[A-Za-z]/.test(nextStart) &&
            /^(i|you|he|she|it|we|they|that|there|here|what|who|how|when|where|why|let|don|can|isn|aren|wasn|weren|won|wouldn|couldn|shouldn|didn|doesn|hasn|haven|hadn|mustn|ain)$/i.test(stem[1]));
          var hasSpace = /\s$/.test(full) || /^\s/.test(piece);
          var noSpace = /^[.,!?;:')"\u201d\u2019]/.test(nextStart) || /[(]$/.test(prevEnd);
          glue = (hasSpace || splitWord || noSpace || cutContraction) ? '' : ' ';
          if (seamSpace) glue = ' ';   /* a restated cut word keeps its boundary space */
        }
        var before = full;
        full = before ? before + glue + piece : piece;
        /* Clean the ASSEMBLED text too: a speaker label can land across a pass
           boundary ("...out here.\n\nMi" + "ira: ..."), which per-pass cleaning misses. */
        var joined = cleanReply(stripThinking(full, s.stripThinking !== false), char && char.name, s.userName, { cast: session && session.sceneCast });
        if (joined) full = joined;

        if (s.provider === 'horde' && o.onDelta) {
          /* reveal it like a stream so the Horde feels the same as everything else */
          return revealText(glue + piece, function () {
            if (o.onDelta) o.onDelta('', full);
          }).then(function () { return after(); });
        }
        if (idx > 0 && o.onDelta) o.onDelta(glue + piece, full);
        return after();
      });

      function after() {
        if (idx + 1 >= maxRounds) return full;
        if (!looksTruncated(full)) return full;
        if (o.signal && o.signal.aborted) return full;
        if (o.onProgress) o.onProgress({ state: 'continuing', waitTime: 0, elapsed: 0 });
        return loop(idx + 1);
      }
    }

    return loop(0);
  }

  /* v1.43.0: what the app took off a reply, offered back on request.
     cleanReply truncates at the first line that looks like a speaker label —
     right when the model starts writing the player's turn, and quietly wrong
     when a character is ADDRESSED by name inside the prose ("He looked up.
     \"Alice: get down here,\" he shouted."). A reader cannot tell those apart
     from a cut-off sentence; they can tell at once when shown both. Returns
     null when nothing was removed, so an ordinary reply never stores a second
     copy of itself. */
  /* ---------------- display scripts (v1.45.0) ----------------
   * User-authored find/replace rules applied to a bubble as it is rendered, and
   * nowhere else. That boundary is the whole design: the stored message, the
   * prompt, the transcript export, the read-aloud text and the `raw` copy behind
   * the −N chip all keep the model's own words, so a script can never quietly
   * rewrite the story — it only changes what the screen shows. SillyTavern has
   * had this for years with prompt-affecting stages; this app starts without
   * them, because a display bug can be undone by turning a switch off and a
   * prompt bug cannot.
   *   - `s.regexOn` is the master switch; a card or a chat cannot turn it on.
   *   - order matters and is honoured: scripts run top to bottom, each seeing
   *     what the one before it left.
   *   - a pattern that will not compile is skipped, not fatal: one bad rule must
   *     not blank every bubble in the chat.
   *   - text longer than SCRIPT_MAX is shown raw, so a pathological pattern
   *     cannot turn a long reply into a frozen phone. */
  var SCRIPT_MAX_CHARS = 40000;
  var scriptCache = {};
  var scriptCacheN = 0;
  function safeFlags(f) {
    /* only real RegExp flags, and never `g` twice; the caller's default is gi */
    var keep = String(f == null ? 'gi' : f).split('').filter(function (c) {
      return 'gimsuy'.indexOf(c) !== -1;
    });
    var out = keep.join('');
    return out.indexOf('g') === -1 ? 'g' + out : out;
  }
  /* The shape that only a backtracking engine can be asked for: a group that is
   * quantified inside AND after — `(a+)+`, `(.*)*`, `(a+|b)+`. On the wrong input
   * it is exponential. Refusing it by shape rather than by measurement means the
   * answer does not depend on how fast this phone happens to be today, and it
   * costs nothing to check again when a rule is loaded. */
  function scriptLooksEvil(src) {
    /* escapes and bracket classes go first: `[^*]` contains a `*` that means a
       character, not a repeat, and that rule is the one everybody writes. */
    var bare = String(src || '').replace(/\\.|\[[^\]]*\]/g, 'x');
    return /\([^()]*[*+][^()]*\)\s*[*+{]/.test(bare);
  }
  function compileScript(sc) {
    var src = String((sc && sc.pattern) || '');
    var flags = safeFlags(sc && sc.flags);
    var key = src + '\u0000' + flags;
    if (Object.prototype.hasOwnProperty.call(scriptCache, key)) return scriptCache[key];
    var re = null;
    try { re = new RegExp(src, flags); } catch (e) { re = null; }
    /* a phone edits these one keystroke at a time; the cache is a convenience,
       so it is allowed to be small and to forget rather than to grow forever */
    if (scriptCacheN > 64) { scriptCache = {}; scriptCacheN = 0; }
    scriptCache[key] = re; scriptCacheN++;
    return re;
  }
  /** The scripts that will actually run for these settings, in order. */
  function displayScripts(s) {
    if (!s || s.regexOn !== true) return [];
    var list = Array.isArray(s.regexScripts) ? s.regexScripts : [];
    return list.filter(function (x) {
      if (!x || x.enabled === false) return false;
      var src = String(x.pattern || '');
      /* a rule saved by hand into the settings blob, or one that predates the
         save-time test, still cannot take the screen down */
      return src.length > 0 && !scriptLooksEvil(src);
    });
  }
  function applyDisplayScripts(text, s) {
    var list = displayScripts(s);
    var out = String(text == null ? '' : text);
    if (!list.length || out.length > SCRIPT_MAX_CHARS) return out;
    for (var i = 0; i < list.length; i++) {
      var sc = list[i];
      var re = compileScript(sc);
      if (!re) continue;
      try {
        re.lastIndex = 0;
        out = out.replace(re, sc.replacement == null ? '' : String(sc.replacement));
      } catch (e) {
        /* `$<name>` with no such group, a replacement that is not a string: the
           bubble keeps the text it had rather than showing the error */
      }
      if (out.length > SCRIPT_MAX_CHARS) return out;
    }
    return out;
  }
  /** Test one candidate rule before it is allowed into the list. The timing
   *  check is not decoration: `gi` patterns with nested quantifiers can take
   *  minutes on a paragraph, and a WebView that hangs on the UI thread has no
   *  cancel button. `sample` is the text the user last saw (or a stand-in),
   *  because a rule is usually written against the reply on screen. */
  function scriptTest(pattern, replacement, flags, sample) {
    var src = String(pattern || '');
    if (!src) return { ok: false, why: 'Find something first — an empty pattern matches everywhere.' };
    var re;
    try { re = new RegExp(src, safeFlags(flags)); }
    catch (e) { return { ok: false, why: 'Not a valid regular expression: ' + (e && e.message || e) }; }
    if (scriptLooksEvil(src)) {
      return { ok: false, evil: true,
        why: 'A group repeated inside a repeated group — like (a+)+ — can take a minute on one reply and it ' +
             'cannot be cancelled once it starts. Write it without the nested repeat, or anchor it.' };
    }
    var text = String(sample == null ? '' : sample).slice(0, 6000);
    if (!text) text = 'She looked up. "Alice: get down here," he shouted, and the lamp turned.';
    var t0 = Date.now();
    var before = text, after = text, threw = null;
    try { re.lastIndex = 0; after = before.replace(re, replacement == null ? '' : String(replacement)); }
    catch (e) { threw = e && e.message || String(e); }
    var ms = Date.now() - t0;
    if (threw) return { ok: false, why: 'The replacement failed: ' + threw };
    if (ms > 500) {
      return { ok: false, slow: true, ms: ms,
        why: 'That pattern took ' + ms + ' ms on one reply. Something this slow on every bubble will stall the ' +
             'screen — try narrowing it (anchor with ^ or $, or drop a nested * or +).' };
    }
    var hits = 0;
    try { hits = (text.match(re) || []).length; } catch (e) { hits = 0; }
    return {
      ok: true, ms: ms, hits: hits, changed: after !== before,
      before: before.slice(0, 900), after: after.slice(0, 900)
    };
  }

  function replyProvenance(display, raw) {
    var d = String(display == null ? '' : display);
    var r = String(raw == null ? '' : raw);
    if (!r || d === r) return null;
    var dropped = r.length - d.length;
    if (dropped <= 0) return null;
    return { dropped: dropped, endsEarly: d.length > 0 && /[:\u2012-\u2015-]\s*$/.test(d) };
  }


  /** Ask the model to compress the story so far into a summary + facts. */
  function summarize(o) {
    var s = o.settings, char = o.character, session = o.session, history = o.history;
    /* v1.39.91: the summariser ignored the history budget completely and sent
       up to 40 whole messages. On a long chat that is a request bigger than a
       free route's window, and a provider that cannot fit it answers with
       nothing at all — which then reads, wrongly, as "the model refused".
       The transcript is capped to the same budget the chat itself uses, newest
       turns kept, so the request always fits the model that has to answer it. */
    function transcriptOf(list) {
      return list.map(function (m) {
        var body = repairMojibake(m.text || '');
        var who = m.role === 'user' ? s.userName : splitSpeaker(char, session, body).name;
        return who + ': ' + (m.role === 'user' ? body : splitSpeaker(char, session, body).text);
      }).join('\n');
    }
    /* v1.46.0: the recap read its own last-40 while the live request read the
       "Messages in context" window, so the two could disagree by an order of
       magnitude — and the disagreement was invisible, because `sentMessages`
       reported the recap's number, not the chat's. "Keep the recent turns" only
       means something if the memory pass works on the same recent turns.
         - the window is `requestWindow`, the one answer to "what is recent";
         - a floor of 12 messages, because a recap of the six lines the slider
           may be set to would extend the previous summary with a snapshot;
         - an explicit `o.maxMessages` still wins: a caller that asks for a
           short recap gets one.
       The byte cap and the halving stay: a recap that does not fit the model
       that has to answer it is the failure this function has already had twice. */
    var budgetChars = Math.max(4000, historyBudgetTokens(s, 900, 500) * 4);
    var pool;
    if (o.maxMessages > 0) {
      pool = history.slice(-o.maxMessages);
    } else {
      pool = requestWindow(history, s).messages;
      if (pool.length < SUMMARY_MIN_MESSAGES) pool = history.slice(-SUMMARY_MIN_MESSAGES);
    }
    var convo = transcriptOf(pool);
    while (convo.length > budgetChars && pool.length > 6) {
      pool = pool.slice(Math.ceil(pool.length / 2));
      convo = transcriptOf(pool);
    }
    var sentMessages = pool.length;

    var instruction =
      'You are a memory manager for a roleplay between ' + s.userName + ' and ' + char.name + '.\n' +
      'Read the transcript and return STRICT JSON only, with no commentary:\n' +
      '{"summary":"<3-6 sentences capturing plot, tone and where things stand>",' +
      '"facts":["<short durable fact>","..."],' +
      '"changed":["<a fact from the list below that this transcript has made untrue>"]}\n' +
      'Keep at most 8 facts. Facts must be durable: names, places, relationships, injuries, promises, objects, goals.\n' +
      /* v1.39.104: the world summariser has asked for this since v1.39.100 and
         the chat one did not, which is half of why a chat's memory could argue
         with itself. A change is a different job from the news. */
      '\"changed\" lists any fact from the list below that this conversation has made ' +
        'untrue - a name that changed, a debt that was paid, a place that burned, a ' +
        'promise that was broken. Quote that fact word for word in \"changed\" and state ' +
        'the new truth in \"facts\". Do not change a fact on a guess, and do not restate ' +
        'an old fact in new words unless something actually changed. Omit \"changed\" ' +
        'entirely when nothing changed.\n' +
      (session && session.summary ? 'Existing summary to extend:\n' + repairMojibake(session.summary) + '\n' : '') +
      (session && session.facts && session.facts.length
        ? 'What the chat currently holds true:\n' +
          chatFactObjects(session).filter(function (f) { return f.to === null || f.to === undefined; })
            .map(function (f) { return '- ' + repairMojibake(f.text); }).join('\n') + '\n'
        : '');
    var rules = instruction;
    instruction = rules + '\nTranscript:\n' + convo;

    /* v1.39.86: the transcript was only ever inside the SYSTEM message, and the
       one user turn said "Return the JSON now." to nobody. A model that reads
       the user turn as the request saw an instruction with no data in front of
       it and refused — and the refusal was then stored as the story so far,
       which is the only record of the past once the history budget is full. */
    var msgs = [
      { role: 'system', content: rules },
      { role: 'user', content: 'Transcript:\n' + convo + '\n\nReturn the JSON now.' }
    ];

    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: instruction + '\n\nJSON:',
        model: s.hordeTextModel || '',
        maxLength: 320, temperature: 0.3, topP: 0.9, apikey: s.hordeKey,
        maxWait: 300
      }).then(function (r) { return parseMemory(r.text); });
    }
    /* v1.39.89: 500 tokens was not enough for a six-sentence summary plus a
       dozen facts, so on a long chat the answer was cut mid-JSON and the whole
       memory was discarded. The ceiling is raised, the fact count trimmed, and
       there is one cheap retry that asks for the summary alone — a model that
       will not produce JSON will usually still write five sentences. */
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3, max_tokens: 900 })
      .then(function (raw) {
        var mem = parseMemory(raw);
        if (mem.ok) return mem;
        var retry = [
          { role: 'system', content: 'You summarise a roleplay for its own memory.' },
          { role: 'user', content: 'Transcript:\n' + convo +
            '\n\nWrite 3-6 plain sentences saying what has happened, who is where, and what is unresolved. No JSON, no headings, no commentary.' }
        ];
        return streamChat(s, retry, null, null, { stream: false, temperature: 0.3, max_tokens: 400 })
          .then(function (raw2) {
            var mem2 = parseMemory(raw2);
            if (mem2.ok) return mem2;
            /* both attempts are reported: which one failed matters */
            mem.reason = (mem.reason || 'no usable summary') +
              (mem2.reason && mem2.reason !== mem.reason ? ' (retry: ' + mem2.reason + ')' : '');
            mem.lastRaw = String(raw2 || raw || '').slice(0, 600);
            mem.firstRaw = String(raw || '').slice(0, 600);
            return mem;
          }, function (err) {
            mem.reason = (mem.reason || 'no usable summary') + ' (retry: ' +
              String((err && err.message) || 'the retry failed') + ')';
            mem.lastRaw = String(raw || '').slice(0, 600);
            return mem;
          }).then(function (mem) {
            if (mem && mem.ok) return mem;
            /* A third, deliberately tiny attempt. Some routes answer with
               nothing at all when a reasoning model spends the whole output
               budget thinking - the visible content is empty and the tokens
               are gone. A short prompt with reasoning switched off (OpenRouter
               only; the parameter is ignored elsewhere) is the cheap way out,
               and it costs one request on an already-failing path. */
            /* six of the newest turns, then a hard character cap: six long
               replies can still be most of the chat, and the point of this
               attempt is that nothing about it can be too big. */
            var tiny = transcriptOf(history.slice(-6));
            if (tiny.length > 3500) tiny = tiny.slice(-3500);
            var tinyMsgs = [
              { role: 'system', content: 'You summarise a roleplay for its own memory. Answer with plain sentences only.' },
              { role: 'user', content: 'A few recent lines:\n' + tiny +
                '\n\nIn 2-4 plain sentences, say what has happened and what is unresolved. No JSON, no headings.' }
            ];
            var tinyOpt = { stream: false, temperature: 0.3, max_tokens: 300 };
            if (endpoint(s).toLowerCase().indexOf('openrouter.ai') !== -1) tinyOpt.reasoning = { enabled: false };
            return streamChat(s, tinyMsgs, null, null, tinyOpt).then(function (raw3) {
              var mem3 = parseMemory(raw3);
              if (mem3.ok) { mem3.shortOf = true; return mem3; }
              var lm = mem3.reason && mem3.reason !== mem.reason ? ' (third: ' + mem3.reason + ')' : '';
              mem.reason = mem.reason + lm;
              if (String(raw3 || '').trim() && !mem.lastRaw) mem.lastRaw = String(raw3).slice(0, 600);
              return mem;
            }, function (err3) {
              mem.reason = mem.reason + ' (third: ' + String((err3 && err3.message) || 'failed') + ')';
              return mem;
            });
          });
        }).then(function (mem) {
          /* Whatever happened, the record says what was asked and of whom:
             an empty answer from an oversized request and an empty answer
             from a model that simply said nothing look identical without it. */
          mem.sentMessages = sentMessages;
          /* the recap says which window it read, because it is no longer always
             forty: `available` is the whole history, `window` is what was sent */
          mem.availableMessages = history.length;
          mem.sentChars = convo.length;
          mem.sentTokens = Math.ceil(convo.length / 4);
          mem.model = String(s.model || (s.provider === 'horde' ? 'horde' : ''));
          mem.window = modelContextTokens(s.model) || 0;
          return mem;
      });
  }

  /* ---------------- chat facts keep a history (v1.39.104) -----------------

     The world half of this shipped in v1.39.100; this is the same discipline
     for persona chats, where the bug was identical. `session.facts` was an
     array of plain strings replaced wholesale on every pass, so a fact from
     message 20 and its replacement from message 200 sat side by side with no
     ordering signal, and the model chose between them. That is the "the
     quest changed" failure wearing a chat costume.

     A fact now carries an id, the message count it was learned at, the point
     it stopped being true (null while current) and the id of what replaced
     it. Nothing is deleted: a stale fact is superseded, so a chat can still
     answer "was that ever true" while the prompt shows only what is true now.

     The matching and supersession rules are deliberately the same shape as
     the world engine's (sameFact there), kept here rather than imported:
     api.js has no dependency on hordeworld.js and a cycle between them would
     be a much worse bug than the duplication. */

  function chatFactWords(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  var CHAT_FACT_STOP = {};
  ('a an the is was were are be been being has have had do does did will would ' +
   'can could may might must shall should to of in on at for with by from as ' +
   'that this these those it its he she they them his her their you your ' +
   'and or but not no yes now still then there here about into over after ' +
   'before again also just only very too more most some any all one two ' +
   'user they\'ve they\'re i we us our my me').split(' ').forEach(function (w) { CHAT_FACT_STOP[w] = true; });
  function chatFactTokens(text) {
    var out = [];
    chatFactWords(text).forEach(function (w) {
      if (w.length < 3 || CHAT_FACT_STOP[w]) return;
      if (out.indexOf(w) === -1) out.push(w);
    });
    return out;
  }
  /** 'same' (restated, nothing changed), 'supersede' (the same subject, a
   *  different claim) or '' (unrelated). Cautious on purpose: a miss leaves
   *  both facts on the record with dates and the model can read them, while a
   *  false hit would retire something still true with no way back. */
  function chatSameFact(aText, bText) {
    var a = chatFactWords(aText), b = chatFactWords(bText);
    if (!a.length || !b.length) return '';
    if (a.join(' ') === b.join(' ')) return 'same';
    var ta = chatFactTokens(aText), tb = chatFactTokens(bText);
    if (!ta.length || !tb.length) return '';
    var shared = 0;
    ta.forEach(function (w) { if (tb.indexOf(w) !== -1) shared++; });
    var min = Math.min(ta.length, tb.length), max = Math.max(ta.length, tb.length);
    if (shared >= 3 && shared / min >= 0.75 && (max - min) <= Math.max(2, max * 0.5)) return 'supersede';
    return '';
  }
  function chatNextFactId(facts) {
    var n = 0;
    (facts || []).forEach(function (f) {
      var m = /^f(\d+)$/.exec(String((f && f.id) || ''));
      if (m) n = Math.max(n, parseInt(m[1], 10));
    });
    return 'f' + (n + 1);
  }
  /** A chat written before facts had ids carried plain strings. They become
   *  records stamped with the count the memory was last written at - the best
   *  date the chat still has. Read-only: nothing on disk is rewritten. */
  function chatFactObjects(session) {
    var list = (session && Array.isArray(session.facts)) ? session.facts : [];
    var from = typeof (session && session.memAt) === 'number' ? session.memAt : 0;
    return list.map(function (f, i) {
      if (f && typeof f === 'object') {
        return { id: f.id || ('f' + (i + 1)), text: String(f.text || ''),
                 from: typeof f.from === 'number' ? f.from : from,
                 to: (f.to === undefined ? null : f.to), by: f.by || null };
      }
      return { id: 'f' + (i + 1), text: String(f || ''), from: from, to: null, by: null };
    }).filter(function (f) { return f.text; });
  }
  /** What the chat holds true now, oldest first. */
  function currentChatFacts(session) {
    return chatFactObjects(session).filter(function (f) { return f.to === null || f.to === undefined; });
  }
  /** What it used to hold true, newest first - for the sheet, never for the
   *  prompt. */
  function pastChatFacts(session) {
    return chatFactObjects(session)
      .filter(function (f) { return f.to !== null && f.to !== undefined; })
      .sort(function (a, b) { return (b.to || 0) - (a.to || 0); });
  }
  var CHAT_FACT_CAP = 24, CHAT_FACT_CURRENT = 12;

  /** Write a memory pass onto a session: restatements are confirmed rather
   *  than duplicated, contradictions supersede, and a fact the model reports
   *  as no longer true is retired only when the report actually names it. */
  function applyChatMemory(session, mem) {
    var at = typeof session.messageCount === 'number' ? session.messageCount : 0;
    var all = chatFactObjects(session).map(function (f) { return { id: f.id, text: f.text, from: f.from, to: f.to, by: f.by }; });
    var currentOf = function () {
      return all.filter(function (f) { return f.to === null || f.to === undefined; });
    };

    /* the model's report of what stopped being true - an accusation, not an
       instruction: it retires a fact only when it points at one */
    ((mem && (mem.changed || mem.superseded)) || []).forEach(function (raw) {
      var said = String(raw || '').replace(/\s+/g, ' ').trim();
      if (!said) return;
      var saidWords = chatFactWords(said).join(' '), saidTokens = chatFactTokens(said);
      var target = null;
      currentOf().forEach(function (f) {
        if (target) return;
        if (chatFactWords(f.text).join(' ') === saidWords) { target = f; return; }
        var ft = chatFactTokens(f.text);
        if (!ft.length || saidTokens.length < 3) return;
        var shared = 0;
        ft.forEach(function (w) { if (saidTokens.indexOf(w) !== -1) shared++; });
        if (shared >= 3 && shared / ft.length >= 0.6) target = f;
      });
      if (target) target.to = at;
    });

    ((mem && mem.facts) || []).forEach(function (raw) {
      var text = String((raw && raw.text) || raw || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return;
      var match = null, how = '';
      currentOf().forEach(function (f) { if (!match) { var v = chatSameFact(f.text, text); if (v) { match = f; how = v; } } });
      if (match && how === 'same') {
        /* restating a fact is the chat still relying on it: it stays young, so
           a load-bearing fact is never the one an overflow retires */
        match.from = at;
        return;
      }
      if (match && how === 'supersede') {
        var nf = { id: chatNextFactId(all), text: text, from: at, to: null, by: null };
        match.to = at; match.by = nf.id;
        all.push(nf);
        return;
      }
      var dup = currentOf().some(function (f) { return chatFactWords(f.text).join(' ') === chatFactWords(text).join(' '); });
      if (!dup) all.push({ id: chatNextFactId(all), text: text, from: at, to: null, by: null });
    });

    /* the ceilings retire, they do not delete */
    var cur = currentOf();
    if (cur.length > CHAT_FACT_CURRENT) {
      cur.slice().sort(function (a, b) { return (a.from || 0) - (b.from || 0); })
        .slice(0, cur.length - CHAT_FACT_CURRENT)
        .forEach(function (f) { f.to = at; f.retired = true; });
    }
    if (all.length > CHAT_FACT_CAP) {
      var past = all.filter(function (f) { return f.to !== null && f.to !== undefined; })
        .sort(function (a, b) { return (a.to || 0) - (b.to || 0); });
      var doomed = {};
      past.slice(0, all.length - CHAT_FACT_CAP).forEach(function (f) { doomed[f.id] = true; });
      all = all.filter(function (f) { return !doomed[f.id]; });
    }
    return { facts: all, current: all.filter(function (f) { return f.to === null || f.to === undefined; }) };
  }

  /* v1.36.0: a world run gets the same memory discipline as a persona
     chat - same strict-JSON instruction shape, but the transcript is the
     referee's scene log, and ledger mechanics are explicitly off the
     menu (the ledger itself tracks those). */
  function summarizeWorld(o) {
    var s = o.settings, world = o.world, run = o.run;
    var convo = (run.log || []).slice(-40).map(function (m) {
      if (m.role === 'user') return 'Player: ' + (m.content || '');
      if (m.role === 'assistant') return String((world && world.name) || 'Referee') + ': ' + (m.content || '');
      return '';   /* corrections and dice verdicts are not story */
    }).filter(Boolean).join('\n');

    /* v1.39.100: the model is asked, once, for three things: the summary, what
       is true now, and - separately - what this transcript has made UNTRUE.
       A memory that only ever appends is a memory that argues with itself:
       the old line and its replacement sit in the same list with no ordering
       signal and the referee picks. Reporting the change is a distinct job
       from reporting the news, so it gets its own field. It is still only a
       report - the engine retires a stored fact only when the report names
       it (applyFacts), never on a vague say-so. */
    var current = (run.memory && run.memory.facts) || [];
    var currentLines = current.map(function (f) {
      return '- ' + String((f && typeof f === 'object') ? (f.text || '') : f);
    }).filter(function (l) { return l.length > 2; });

    var instruction =
      'You are a memory manager for the text roleplay world "' +
        String((world && world.name) || 'World') + '".\n' +
      'Read the transcript and return STRICT JSON only, with no commentary:\n' +
      '{"summary":"<3-6 sentences capturing plot, tone and where things stand>",' +
      '"facts":["<short durable fact>","..."],' +
      '"changed":["<a fact from the LIST BELOW that this transcript has made untrue>"]}\n' +
      'Keep at most 12 facts. Facts must be durable: names, places, relationships, ' +
      'promises, objects, goals, conditions, what was decided or revealed.\n' +
      'Do NOT record tag commands, stat numbers, cheese-and-ledger mechanics - ' +
      'the world tracks those itself.\n' +
      'If the transcript makes any fact in the LIST BELOW untrue - a name that ' +
      'changed, a debt that was paid, a place that burned, an alliance that broke - ' +
      'quote that fact word for word in "changed" and state the new truth in ' +
      '"facts". Do not change a fact on a guess, and do not restate an old fact ' +
      'in new words unless something actually changed. Omit "changed" entirely ' +
      'when nothing did.\n' +
      (run.memory && run.memory.summary ? 'Existing summary to extend:\n' + run.memory.summary + '\n' : '') +
      (currentLines.length
        ? 'LIST BELOW - what the story currently holds true:\n' + currentLines.join('\n') + '\n'
        : '');
    var rules = instruction;
    instruction = rules + '\nTranscript:\n' + convo;

    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: instruction + '\n\nJSON:',
        model: s.hordeTextModel || '',
        maxLength: 420, temperature: 0.3, topP: 0.9, apikey: s.hordeKey,
        maxWait: 300
      }).then(function (r) { return parseMemory(r.text); });
    }
    /* v1.39.86: the world log gets the same treatment as the chat transcript —
       data in the user turn, rules in the system turn. */
    var msgs = [
      { role: 'system', content: rules },
      { role: 'user', content: 'Transcript:\n' + convo + '\n\nReturn the JSON now.' }
    ];
    /* v1.39.89: same ceiling as the chat summariser — a world log is longer
       than a chat transcript, not shorter. */
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3, max_tokens: 900 })
      .then(parseMemory);
  }

  /* v1.39.86: a refusal is not a summary.
     This used to store whatever came back, up to 800 characters, when it held
     no JSON — so a model that answered "No transcript was provided, so there
     is no roleplay content to summarize" had that sentence written into
     `session.summary`, which is appended to every later prompt as "Story so
     far". Past the history budget that summary is the ONLY record of the past,
     so the chat's memory became a note saying there was nothing to remember.
     A model's silence is now a failure the caller reports, never content. */
  /* v1.39.90: only a refusal that OPENS the text is a refusal.
     The old pattern matched anywhere — "there is no", "no conversation",
     "I can't" — so an honest summary of a scene where nobody had agreed on
     the rent yet ("there is no agreement about it") was thrown away as a
     model refusal, twice if the retry said something similar. A refusal is
     the whole of what the model said, and it starts the answer. */
  var MEMORY_REFUSAL = /^(?:(?:i\s+)?(?:cannot|can\s*not|can't|won't|will not|am unable to|am not able to|i'm unable to|i'm not able to)\b|as an ai\b|no transcript\b|there (?:is|was) no (?:transcript|conversation|roleplay|content|history|text)\b|the (?:transcript|conversation|content|text|input) (?:was|is) (?:not provided|missing|empty|absent)\b|(?:transcript|conversation|content|text|input) (?:was|were) not provided\b|nothing to (?:summari[sz]e|extract)\b|unable to (?:summari[sz]e|process|comply|extract)\b)/i;
  /* Does a stored summary read like a refusal, or like nothing at all? Used by
     the Memory sheet to flag a chat whose past was quietly replaced by the
     model's excuse. */
  function memoryLooksBroken(text) {
    var t = String(text || '').trim();
    if (!t) return false;
    if (t.length < 24) return true;
    return MEMORY_REFUSAL.test(t) && t.length < 400;
  }

  /* v1.39.105: this summary is prose, and it is going straight back into the
     next prompt where it will be read as remembered fact. Cutting it at a
     byte count used to leave "...the town wakes on the following morning",
     a sentence that stops mid-thought with nothing to show it was cut - the
     next prompt reads that as a memory that simply ends there. Prefer the
     last real sentence end inside the budget; if a single sentence is longer
     than the whole budget, cut on a word and mark it. Either way the model
     is told, out loud, that there is more it is not seeing. */
  function clipProse(text, max) {
    var t = String(text || '').trim();
    if (t.length <= max) return t;
    var body = t.slice(0, max);
    var lastEnd = -1, m, re = /[.!?][\"'\u201d\u2019)\]]*(?=\s|$)/g;
    while ((m = re.exec(body))) lastEnd = m.index + m[0].length;
    if (lastEnd > max * 0.4) return body.slice(0, lastEnd).replace(/\s+$/, '') + ' \u2026';
    /* no usable sentence end: cut on the last word boundary, not mid-word */
    var sp = body.search(/\s\S*$/);
    if (sp > 0) body = body.slice(0, sp);
    return body.replace(/[\s,;:\-]+$/, '') + ' \u2026';
  }

  /* v1.39.106: is this answer only the wreckage of JSON, or is there prose
     worth keeping? A model that opens its memory answer with a short sentence
     of its own ("Here is the summary:") and is then cut off by the token
     ceiling leaves `Here is the summary: {"summary":"...` with no closing
     brace. The unfinished-JSON guard only refused answers that START with a
     brace, so that shape sailed through and the raw wrapper was stored as the
     chat's permanent memory of its own past - read back on every later turn.

     Anything holding the shape of a JSON summary key is treated as wreckage
     no matter what precedes it, and recovery is attempted from the fragment.
     Prose that never mentions a summary key is returned unchanged. */
  function proseOnly(text) {
    var t = String(text || '').trim();
    /* Only an answer that is demonstrably JSON-shaped can be wreckage. The
       first cut of this looked for the word "summary:" anywhere, and so ate
       ordinary prose like "Here is a summary: the mill burned" and a sentence
       that merely quoted the word - both were stored as memories before and
       were rejected by that version. A brace, a bracket or a fence is the
       evidence; the word alone is not. */
    var jsonish = /^[\[{]/.test(t) || /^```/.test(t) || /\{\s*["\u201c]?summary["\u201d]?\s*:/.test(t);
    if (!jsonish) return t;
    /* Take the *quoted* key first. A single regex with optional quotes matched
       the word inside a preamble ("Here is the summary: {"summary":"...") and
       captured nothing, because the quote after the colon belongs to the key
       one character later. */
    var m = /["\u201c]summary["\u201d]\s*:\s*["\u201c]?((?:[^"\\\n\u201d]|\\.)*)/.exec(t) ||
            /(?:^|[\s{,\[])summary\s*:\s*["\u201c]?((?:[^"\\\n\u201d]|\\.)*)/i.exec(t);
    if (!m) return '';
    var body = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'").trim();
    /* The JSON never closed, so whatever was recovered is the end of a
       sentence the model did not finish - even when it is short enough not to
       need clipping. Say so, or the next prompt reads it as a thought that
       simply stopped. */
    if (body && !/[.!?]["'\u201d\u2019)\]]*$/.test(body)) {
      body = clipProse(body, 800);
      if (!/\u2026$/.test(body)) body = body.replace(/[\s,;:\-]+$/, '') + ' \u2026';
    }
    return body;
  }

  function parseMemory(text) {
    var out = { summary: '', facts: [], changed: [], ok: false, reason: '' };
    var raw = String(text || '').trim();
    if (!raw) { out.reason = 'the model returned nothing'; return out; }
    var start = raw.indexOf('{');
    var end = raw.lastIndexOf('}');
    var body = '';
    if (start !== -1 && end > start) {
      try {
        var j = JSON.parse(raw.slice(start, end + 1));
        body = String(j.summary || '').trim();
        out.facts = (j.facts || []).map(function (f) { return String(f).trim(); }).filter(Boolean).slice(0, 12);
        /* v1.39.100: facts this transcript made untrue. Free text, matched
           against the stored list by the engine - never applied blindly. */
        out.changed = (j.changed || j.superseded || []).map(function (f) {
          return String((f && typeof f === 'object') ? (f.text || '') : f).trim();
        }).filter(Boolean).slice(0, 12);
        out.ok = true;
      } catch (e) { body = ''; }
    }
    /* v1.39.89: a reply cut off by the token ceiling is not a refusal. The
       summary is the first thing the model writes, so when the JSON is
       incomplete the summary is usually whole and only the facts are missing.
       Salvage it rather than lose the whole memory. */
    if (!body && start !== -1) {
      var sm = /"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(raw);
      if (sm) {
        try { body = JSON.parse('"' + sm[1] + '"').trim(); }
        catch (e2) { body = sm[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim(); }
        /* v1.39.100: stop at the end of the facts array, or at the next
           key - otherwise a truncated answer with a "changed" list after
           "facts" folded those lines into the facts as well. */
        var fm = /"facts"\s*:\s*\[([\s\S]*?)(?:"changed"\s*:|"superseded"\s*:|\]\s*[,}]|$)/.exec(raw);
        if (fm) {
          var items = fm[1].match(/"((?:[^"\\]|\\.)*)"/g) || [];
          out.facts = items.map(function (q) {
            try { return JSON.parse(q).trim(); } catch (e3) { return q.replace(/^"|"$/g, '').trim(); }
          }).filter(Boolean).slice(0, 12);
        }
        out.salvaged = true;
      }
    }
    /* No usable JSON: only accept plain prose that reads like a summary. */
    if (!body && !out.ok) {
      var wreck = /["\u201c]?summary["\u201d]?\s*:/.test(raw);
      body = clipProse(proseOnly(raw), 800);
      if (MEMORY_REFUSAL.test(body)) { out.reason = 'the model refused'; return out; }
      /* An answer that carried a summary key but yielded nothing usable was a
         JSON attempt that did not finish - say that, rather than blaming its
         length. The too-short floor is for prose replies. */
      if (!body || (wreck && body.length < 40)) { out.reason = 'the model returned unfinished JSON'; return out; }
      if (body.length < 40) { out.reason = 'the answer was too short to be a summary'; return out; }
    }
    if (!body) { out.reason = 'the model returned no summary field'; return out; }
    /* A summary that came out of parsed JSON is the field the model was asked
       for; it is only rejected if it IS a refusal, first words and all. */
    if (MEMORY_REFUSAL.test(body) && body.length < 240) { out.reason = 'the model refused'; return out; }
    out.summary = body;
    out.ok = true;
    return out;
  }

  /** Two-line pitch for a character (used by "generate persona"). */
  function quickText(s, prompt, maxTokens, temperature) {
    var msgs = [{ role: 'user', content: prompt }];
    var temp = temperature === undefined || temperature === null ? 0.9 : temperature;
    if (s.provider === 'horde') {
      return Horde.generateText({ prompt: prompt, model: s.hordeTextModel || '', maxLength: maxTokens || 220,
        temperature: temp, apikey: s.hordeKey, maxWait: 300 }).then(function (r) { return r.text; });
    }
    return streamChat(s, msgs, null, null, { stream: false, temperature: temp, max_tokens: maxTokens || 220 });
  }

  /** Pull one JSON object out of a model reply. Models wrap JSON in markdown
   *  fences, add prose before and after, and leave trailing commas — all of
   *  it is tolerated here. Returns null when there is no usable object, so the
   *  caller can say "try again" instead of crashing. */
  function parseAiJson(text) {
    var s = String(text || '').trim();
    var fenceOpen = s.indexOf('{');
    if (fenceOpen === -1) return null;
    var fenceClose = s.lastIndexOf('}');
    if (fenceClose <= fenceOpen) return null;
    var raw = s.slice(fenceOpen, fenceClose + 1);
    var attempts = [raw];
    /* strip markdown fences that snuck inside, then trailing commas */
    attempts.push(raw.replace(/```(?:json)?/gi, ''));
    attempts.push(raw.replace(/,\s*([}\]])/g, '$1'));
    for (var i = 0; i < attempts.length; i++) {
      try {
        var v = JSON.parse(attempts[i]);
        if (v && typeof v === 'object') return v;
      } catch (e) { /* next attempt */ }
    }
    /* v1.38.1: a live-model pathology the world-creator bench caught -
       some Horde worker styles answer with SEVERAL top-level objects in a
       row (one entity per object) even when asked for one. Salvage: close
       each complete top-level object by brace depth, parse the clean ones,
       deep-merge same-key arrays across them. Deterministic, no guessing:
       a chunk that does not parse is dropped, scalar collisions are last
       write wins. */
    var objs = [], depth = 0, start = -1, inStr = false, esc = false;
    for (var j = 0; j < s.length; j++) {
      var ch = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{') { if (depth === 0) start = j; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          /* a live-model pathology: the last tokens often bleed junk
             bracket permutations ("]}]}}]") - trim up to three closing
             brackets off the chunk tail and try again before dropping */
          var tails = [s.slice(start, j + 1)];
          for (var t = 0; t < 3; t++) tails.push(tails[tails.length - 1].replace(/[\]}']+[^\]}']*$/, ''));
          var piece = null;
          for (var ti = 0; ti < tails.length && !piece; ti++) {
            try { piece = JSON.parse(tails[ti]); } catch (e2) { /* next tail */ }
          }
          if (piece && typeof piece === 'object' && !Array.isArray(piece)) objs.push(piece);
          start = -1;
        }
      }
    }
    /* one or more complete objects: pick the key-salvation path. A single
       clean chunk beats nothing when the model wrote one good object and
       then slop or a truncated echo - the app says "press Create" only
       when there is really nothing to hold. */
    if (objs.length >= 1) {
      var merged = null;
      objs.forEach(function (o) {
        if (merged === null) { merged = o; return; }
        Object.keys(o).forEach(function (key) {
          if (Array.isArray(merged[key]) && Array.isArray(o[key])) merged[key] = merged[key].concat(o[key]);
          else if (merged[key] && o[key] && typeof merged[key] === 'object' && typeof o[key] === 'object' &&
            !Array.isArray(merged[key]) && !Array.isArray(o[key])) {
            Object.keys(o[key]).forEach(function (inner) { merged[key][inner] = o[key][inner]; });
          } else if (merged[key] === undefined) merged[key] = o[key];
        });
      });
      return merged;
    }
    return null;
  }

  /** Recover complete top-level fields from a response clipped by its output
   *  limit. This is opt-in: ordinary JSON consumers keep the strict parser's
   *  all-or-nothing contract. A complete prefix ending before a later field is
   *  useful for the character sheet (persona is requested before examples),
   *  while an incomplete final value is discarded rather than guessed. */
  function parseAiJsonPartial(text) {
    var complete = parseAiJson(text);
    if (complete) return complete;
    var s = String(text || '');
    var start = s.indexOf('{');
    if (start < 0) return null;
    var depth = 0, inString = false, escaped = false, commas = [];
    for (var i = start; i < s.length; i++) {
      var ch = s[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth <= 0) break;
      } else if (ch === ',' && depth === 1) commas.push(i);
    }
    function parsePrefix(end) {
      var prefix = s.slice(start, end).trim();
      try {
        var value = JSON.parse(prefix + '}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      } catch (e) { return null; }
    }
    var recovered = parsePrefix(s.length);
    if (recovered) return recovered;
    for (var c = commas.length - 1; c >= 0; c--) {
      recovered = parsePrefix(commas[c]);
      if (recovered) return recovered;
    }
    return null;
  }

  /** Character creation is more forgiving than schema-oriented world drafts:
   *  a model may put its persona in a common alias or answer in prose instead
   *  of JSON. Preserve that useful text as the editable persona instead of
   *  throwing away the whole creation attempt. */
  function parseCharacterDraft(text) {
    var value = parseAiJson(text) || parseAiJsonPartial(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.persona === 'string' && value.persona.trim()) return value;
      var c = value.character && typeof value.character === 'object' ? value.character : {};
      var candidates = [value.description, value.bio, value.personality, value.profile,
        value.text, value.content, value.answer, c.persona, c.description, c.bio, c.personality];
      for (var i = 0; i < candidates.length; i++) {
        if (typeof candidates[i] === 'string' && candidates[i].trim()) {
          value.persona = candidates[i].trim();
          return value;
        }
      }
      var fragments = Object.keys(value).filter(function (k) {
        return !/^(name|tagline|persona|character)$/i.test(k) && typeof value[k] === 'string' && value[k].trim();
      }).map(function (k) { return value[k].trim(); });
      if (fragments.length) { value.persona = fragments.join('\n\n'); return value; }
    }
    var raw = String(text || '').trim();
    var refusal = /^(?:i(?:'m| am)? (?:sorry|unable|not able|cannot|can't)|i cannot help|i can't help|as an ai|sorry[,!]?\s+(?:but|i\b))/i;
    var startsWithTemplateMacro = /^\s*\{\{(?:char|user)\}\}/i.test(raw);
    var looksLikeJson = !startsWithTemplateMacro && /^\s*(?:```(?:json)?\s*)?[\[{]/i.test(raw);
    if (raw.length >= 20 && raw.length <= 6000 && !looksLikeJson && !refusal.test(raw)) {
      return { persona: raw, _plainTextFallback: true };
    }
    return value;
  }

  /** A one-field draft can be valid as JSON, use a common alias, or arrive as
   *  plain prose. Do not discard useful text just because a model ignored the
   *  wrapper requested by the editor. */
  function parseTextFieldDraft(text, field, aliases, maxLength) {
    var value = parseAiJson(text) || parseAiJsonPartial(text);
    if (!value) {
      var candidate = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      if (candidate.charAt(0) === '[') {
        try { var arrayReply = JSON.parse(candidate); if (Array.isArray(arrayReply)) value = arrayReply; } catch (e) {}
      }
    }
    if (value && typeof value === 'object') {
      var wanted = [field].concat(aliases || []).map(function (k) {
        return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      });
      /* Compatible endpoints may wrap the model object in data/result/output
         or message/choices. Walk a bounded tree instead of accepting an empty
         outer wrapper as a successful draft. */
      var queue = [value], seen = [];
      while (queue.length && seen.length < 80) {
        var node = queue.shift();
        if (!node || typeof node !== 'object' || seen.indexOf(node) >= 0) continue;
        seen.push(node);
        if (!Array.isArray(node)) {
          var keys = Object.keys(node);
          for (var i = 0; i < keys.length; i++) {
            var normalized = keys[i].toLowerCase().replace(/[^a-z0-9]/g, '');
            if (wanted.indexOf(normalized) >= 0 && typeof node[keys[i]] === 'string' && node[keys[i]].trim()) {
              var result = {};
              result[field] = node[keys[i]].trim();
              return result;
            }
          }
          keys.forEach(function (k) { if (node[k] && typeof node[k] === 'object') queue.push(node[k]); });
        } else {
          node.forEach(function (child) { if (child && typeof child === 'object') queue.push(child); });
        }
      }
    }
    var raw = String(text || '').trim()
      .replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (raw.length >= 2 && (raw.charAt(0) === '"' || raw.charAt(0) === "'") &&
        raw.charAt(raw.length - 1) === raw.charAt(0)) {
      if (raw.charAt(0) === '"') {
        try { var quoted = JSON.parse(raw); if (typeof quoted === 'string') raw = quoted.trim(); } catch (e) {}
      } else raw = raw.slice(1, -1).trim();
    }
    var labels = [field].concat(aliases || []).join('|');
    raw = raw.replace(new RegExp('^(?:' + labels + ')\\s*[:—–-]\\s*', 'i'), '').trim();
    var refusal = /^(?:i(?:'m| am)? (?:sorry|unable|not able|cannot|can't)|i cannot help|i can't help|as an ai|sorry[,!]?\s+(?:but|i\b))/i;
    var startsWithTemplateMacro = /^\s*\{\{(?:char|user)\}\}/i.test(raw);
    var looksLikeJson = !startsWithTemplateMacro && /^\s*(?:```(?:json)?\s*)?[\[{]/i.test(raw);
    if (raw.length > 0 && raw.length <= maxLength && !looksLikeJson && !refusal.test(raw)) {
      var out = { _plainTextFallback: true };
      out[field] = raw;
      return out;
    }
    return value;
  }

  function parseScenarioDraft(text) {
    return parseTextFieldDraft(text, 'scenario', ['situation', 'scene', 'opening', 'opening_scene', 'setting', 'premise', 'scenario_text', 'scenario_draft', 'roleplay_scenario', 'description', 'text', 'content', 'answer', 'response', 'result', 'output', 'data'], 4000);
  }

  function parseGreetingDraft(text) {
    return parseTextFieldDraft(text, 'greeting', ['first_message', 'opening', 'message', 'text', 'content', 'answer', 'response', 'result', 'output', 'data'], 2400);
  }

  /** Turn a small labeled prose response into the virtual-human fields. This
   *  deliberately avoids requiring another JSON-shaped response from the model. */
  function parseLifeNotes(text) {
    var structured = parseAiJson(text) || parseAiJsonPartial(text);
    if (structured && typeof structured === 'object') {
      var pending = [structured], walked = [];
      while (pending.length && walked.length < 80) {
        var node = pending.shift();
        if (!node || typeof node !== 'object' || walked.indexOf(node) >= 0) continue;
        walked.push(node);
        if (!Array.isArray(node) && ['places', 'routine', 'sleep', 'people', 'diary'].some(function (k) { return node[k] != null; })) {
          return node;
        }
        if (Array.isArray(node)) node.forEach(function (v) { if (v && typeof v === 'object') pending.push(v); });
        else Object.keys(node).forEach(function (k) { if (node[k] && typeof node[k] === 'object') pending.push(node[k]); });
      }
    }
    var fields = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = /^\s*(?:[-*•]\s*)?([^:]{2,32}):\s*(.*?)\s*$/.exec(line);
      if (m && m[2]) fields[m[1].toLowerCase().replace(/[^a-z0-9/]/g, '')] = m[2];
    });
    function splitPlace(value, id, kind, fallback) {
      if (!value) return null;
      var parts = value.split(/\s*[|—–]\s*/, 2);
      return { id: id, name: String(parts[0] || fallback).trim().slice(0, 60), kind: kind,
        note: String(parts[1] || '').trim().slice(0, 160) };
    }
    var places = [];
    var home = splitPlace(fields.home, 'home', 'home', 'Home');
    var other = splitPlace(fields['study/work'] || fields['school/work'] || fields.otherplace || fields.school || fields.work,
      'place_other', 'work', 'School');
    if (home) places.push(home);
    if (other) places.push(other);
    var routine = (fields.routine || '').split(/\s*;\s*/).map(function (item) {
      var m = /^(\d{1,2}:\d{2})\s*(?:[-—–:]\s*)?(.+)$/.exec(item.trim());
      return m ? { t: m[1], a: m[2].trim().slice(0, 120) } : null;
    }).filter(Boolean).slice(0, 12);
    var sleepMatch = /([0-2]?\d:\d{2})\s*(?:-|—|–|to|until)\s*([0-2]?\d:\d{2})/i.exec(fields.sleep || '');
    var people = (fields.people || '').split(/\s*;\s*/).map(function (item, i) {
      var m = /^(.+?)\s*(?:\||—|–)\s*(.+)$/.exec(item.trim());
      var name = m ? m[1].trim() : item.trim();
      return name ? { id: 'life_person_' + i, name: name.slice(0, 60),
        relation: m ? m[2].trim().slice(0, 60) : '', closeness: 0, note: '' } : null;
    }).filter(Boolean).slice(0, 8);
    var diary = fields.diary ? [fields.diary.slice(0, 300)] : [];
    if (!places.length && !routine.length && !sleepMatch && !people.length && !diary.length) return null;
    return { places: places, routine: routine,
      sleep: sleepMatch ? { start: sleepMatch[1], end: sleepMatch[2] } : null,
      people: people, diary: diary };
  }

  /** Parse compact `keywords | content` lines for character lorebook entries. */
  function parseLoreDraft(text) {
    var value = parseAiJson(text) || parseAiJsonPartial(text);
    if (!value) {
      var raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      if (raw.charAt(0) === '[') { try { value = JSON.parse(raw); } catch (e) {} }
    }
    var source = null, queue = value ? [value] : [], walked = [];
    while (queue.length && walked.length < 80 && !source) {
      var node = queue.shift();
      if (!node || typeof node !== 'object' || walked.indexOf(node) >= 0) continue;
      walked.push(node);
      if (Array.isArray(node)) { source = node; break; }
      if (Array.isArray(node.entries)) { source = node.entries; break; }
      if (Array.isArray(node.lorebook)) { source = node.lorebook; break; }
      Object.keys(node).forEach(function (k) { if (node[k] && typeof node[k] === 'object') queue.push(node[k]); });
    }
    if (Array.isArray(source)) {
      var parsed = source.map(function (e) {
        if (!e) return null;
        var keys = Array.isArray(e.keys) ? e.keys : String(e.keys || e.keywords || '').split(/[,;]/);
        var content = String(e.content || e.text || '').trim();
        keys = keys.map(function (k) { return String(k).trim(); }).filter(Boolean);
        return keys.length && content ? { keys: keys, content: content, enabled: true } : null;
      }).filter(Boolean).slice(0, 8);
      if (parsed.length) return parsed;
    }
    return String(text || '').split(/\r?\n/).map(function (line) {
      var clean = line.trim().replace(/^(?:[-*•]|\d+[.)])\s*/, '').replace(/^`+|`+$/g, '');
      var at = clean.indexOf('|');
      if (at < 0) at = clean.search(/\s+[—–]\s+/);
      if (at < 0) at = clean.indexOf(':');
      if (at < 1) return null;
      var keys = clean.slice(0, at).replace(/[,;]+\s*$/, '').split(/[,;]/).map(function (k) { return k.trim(); }).filter(Boolean);
      var content = clean.slice(at + (clean.charAt(at) === '|' || clean.charAt(at) === ':' ? 1 : 3)).trim();
      return keys.length && content.length > 5 ? { keys: keys, content: content, enabled: true } : null;
    }).filter(Boolean).slice(0, 8);
  }

  /** Read standalone lorebooks and embedded card books from JSON. Supports
   *  this app's `keys` entries, SillyTavern's `key`/`disable` entries (arrays
   *  or object maps), and character_book wrappers. */
  function parseLorebookFile(text) {
    var root;
    try { root = JSON.parse(String(text || '').replace(/^\uFEFF/, '')); }
    catch (e) { return []; }
    function isEntry(node) {
      return !!(node && typeof node === 'object' &&
        (node.keys || node.key || node.keywords || node.keyword || node.triggers) &&
        (node.content || node.text || node.description));
    }
    var queue = [root], walked = [], source = null;
    while (queue.length && walked.length < 100 && !source) {
      var node = queue.shift();
      if (!node || typeof node !== 'object' || walked.indexOf(node) >= 0) continue;
      walked.push(node);
      if (Array.isArray(node)) {
        if (!node.length || node.some(isEntry)) { source = node; break; }
        node.forEach(function (child) { if (child && typeof child === 'object') queue.push(child); });
        continue;
      }
      var entries = node.entries;
      if (Array.isArray(entries)) { source = entries; break; }
      if (entries && typeof entries === 'object') { source = Object.keys(entries).map(function (k) { return entries[k]; }); break; }
      if (Array.isArray(node.lorebook)) { source = node.lorebook; break; }
      var lore = node.lorebook;
      var book = node.character_book || node.characterBook;
      if (lore && typeof lore === 'object') queue.unshift(lore);
      if (book && typeof book === 'object') queue.unshift(book);
      if (isEntry(node)) { source = [node]; break; }
      var values = Object.keys(node).map(function (k) { return node[k]; });
      if (values.some(isEntry)) { source = values; break; }
      Object.keys(node).forEach(function (k) {
        if (node[k] && typeof node[k] === 'object' && node[k] !== book && node[k] !== lore) queue.push(node[k]);
      });
    }
    if (!Array.isArray(source)) return [];
    return source.map(function (entry) {
      if (!entry || typeof entry !== 'object') return null;
      var rawKeys = entry.keys;
      if (!rawKeys || (Array.isArray(rawKeys) && !rawKeys.length) ||
          (typeof rawKeys === 'string' && !rawKeys.trim())) {
        rawKeys = entry.key || entry.keywords || entry.keyword || entry.triggers || [];
      }
      var keys = Array.isArray(rawKeys) ? rawKeys : String(rawKeys).split(/[,;\r\n]/);
      keys = keys.map(function (k) { return String(k || '').trim(); }).filter(Boolean).slice(0, 32);
      var rawContent = entry.content || entry.text || entry.description || '';
      var content = plainText(String(rawContent)).trim().slice(0, 12000);
      if (!keys.length || !content) return null;
      return { keys: keys, content: content,
        enabled: entry.enabled !== false && entry.disable !== true && entry.disabled !== true,
        stage: typeof entry.stage === 'string' ? entry.stage.trim().slice(0, 100) : '' };
    }).filter(Boolean).slice(0, 200);
  }

  /** One bounded JSON request — the way the AI-creation helpers talk to the
   *  model: a plain-text instruction in, one JSON object out. Lower
   *  temperature than a chat draft, because structure matters more than
   *  sparkle here. `onProgress` gets the same queue/processing states the
   *  banner shows, so a long world draft doesn't look frozen. */
  function aiJson(s, prompt, maxTokens, onProgress, recoverPartial) {
    function parse(text) {
      if (recoverPartial === 'character') return parseCharacterDraft(text);
      if (recoverPartial === 'scenario') return parseScenarioDraft(text);
      if (recoverPartial === 'greeting') return parseGreetingDraft(text);
      var value = parseAiJson(text);
      return value || (recoverPartial ? parseAiJsonPartial(text) : null);
    }
    if (s.provider === 'horde') {
      return Horde.generateText({ prompt: prompt, model: s.hordeTextModel || '',
        maxLength: maxTokens || 300, temperature: 0.3, apikey: s.hordeKey,
        maxWait: 600, onProgress: onProgress }).then(function (r) { return parse(r.text); });
    }
    var msgs = [{ role: 'user', content: prompt }];
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3,
      max_tokens: maxTokens || 300 }).then(parse);
  }

  /** One-shot generation from an arbitrary system + instruction (virtual humans). */
  function generateFree(o) {
    var s = o.settings;
    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: o.system + '\n\n' + o.instruction + '\n\n' + (o.name || '') + ':',
        model: s.hordeTextModel || '', maxLength: o.maxTokens || 120,
        temperature: 0.95, topP: 0.95, apikey: s.hordeKey,
        signal: o.signal, maxWait: 300, onProgress: o.onProgress
      }).then(function (r) { return r.text; });
    }
    return streamChat(s, [
      { role: 'system', content: o.system },
      { role: 'user', content: o.instruction }
    ], o.onDelta, o.signal, {
      max_tokens: o.maxTokens || 120, temperature: 0.95, stream: s.streaming
    });
  }

  global.API = {
    generateFree: generateFree,
    macros: macros, pronounPresets: PRONOUN_PRESETS, pronounsFor: pronounsFor,
    buildChat: buildChat, buildPrompt: buildPrompt, generate: generate,
    /* the tests read the assembled character sheet directly; the app never does */
    _charSheet: charSheet,
    cleanReply: cleanReply, looksTruncated: looksTruncated, replyProvenance: replyProvenance,
    recallSearch: recallSearch, recallFor: recallFor, recallTokenize: recallTokenize,
    recallEnabled: recallEnabled, recallCount: recallCount, recallSnippet: recallSnippet,
    RECALL_LIMITS: { min: RECALL_MIN, max: RECALL_MAX, def: RECALL_DEFAULT,
      docChars: RECALL_DOC_CHARS, snippet: RECALL_SNIPPET, tokens: RECALL_TOKENS,
      maxDocs: RECALL_MAX_DOCS },
    applyDisplayScripts: applyDisplayScripts, displayScripts: displayScripts, scriptTest: scriptTest,
    scriptLooksEvil: scriptLooksEvil,
    SCRIPT_MAX_CHARS: SCRIPT_MAX_CHARS,
    splitBurst: splitBurst,
    stripThinking: stripThinking,
    isMetaLine: isMetaLine,
    isProseLine: isProseLine,
    CONTEXT_CAP: CONTEXT_CAP,
    HORDE_CTX_TOKENS: HORDE_CTX_TOKENS,
    summarize: summarize, listModels: listModels, testConnection: testConnection,
    openRouterKeyStatus: openRouterKeyStatus, probeOpenRouterModel: probeOpenRouterModel,
    openRouterActivity: readOpenRouterActivity, openRouterActivityToday: openRouterActivityToday,
    openRouterErrorDiagnosis: openRouterErrorDiagnosis, openRouterResetAt: openRouterResetAt,
    summarizeWorld: summarizeWorld,
    streamChat: streamChat, quickText: quickText, examplesToMessages: examplesToMessages,
    splitSpeaker: splitSpeaker, parseMemory: parseMemory, memoryLooksBroken: memoryLooksBroken,
    clipProse: clipProse, continuityHasState: continuityHasState, proseOnly: proseOnly,
    styleLock: styleLock,
    providerError: providerError,
    parseAiJson: parseAiJson, parseAiJsonPartial: parseAiJsonPartial,
    parseLifeNotes: parseLifeNotes, parseLoreDraft: parseLoreDraft,
    parseLorebookFile: parseLorebookFile, aiJson: aiJson,
    statePrompt: statePrompt, parseState: parseState, stripState: stripState,
    rpgStatusPrompt: rpgStatusPrompt, parseRpgUpdate: parseRpgUpdate,
    stripRpgUpdate: stripRpgUpdate, hideRpgUpdate: hideRpgUpdate,
    emptyContinuity: emptyContinuity, normalizeContinuity: normalizeContinuity,
    /* v1.39.104: chat facts keep a history, the same way a world's do */
    chatFactObjects: chatFactObjects, currentChatFacts: currentChatFacts,
    pastChatFacts: pastChatFacts, applyChatMemory: applyChatMemory,
    chatSameFact: chatSameFact,
    continuityPrompt: continuityPrompt, parseContinuityUpdate: parseContinuityUpdate,
    stripContinuityUpdate: stripContinuityUpdate, hideContinuityUpdate: hideContinuityUpdate,
    applyContinuityProposal: applyContinuityProposal,
    plainText: plainText, repairMojibake: repairMojibake,
    estTokens: function (t) { return Math.ceil((t || '').length / 4); },
    /* v1.29.1: the last real Horde answer, as a receipt (model, worker,
       kudos, tries, what was requested). Set by generate(); the world's
       status sheet reads it. null until the first text generation. */
    lastHorde: null,
    /* why the last reply stopped: 'length' (our cap), 'stop' (the model
       finished), or null. Read after generate() resolves. */
    lastFinish: function () { return lastFinish; },
    lastAssembly: function () { return lastAssembly; },
    resetAssembly: function () { lastAssembly = null; },
    chatRequestPlan: chatRequestPlan,
    resetFinish: function () { lastFinish = null; },
    _unfuseFirstWord: unfuseFirstWord,
    /* tests shorten the stream deadline and the 429 backoff; the app never calls these */
    _setStreamTimeoutMs: function (ms) { STREAM_TIMEOUT_MS = ms; },
    _setRateRetryDelays: function (arr) { RATE_BACKOFF = arr.slice(); },
    /* tests call the matcher directly; the app never does */
    _loreHits: loreHits,
    loreDiagnostics: loreDiagnostics,
    loreSample: loreSample,
    /* v1.40.0: the screens and the tests read the matcher's own settings back
       from here, so the Lore screen can never disagree with the request. */
    loreOpts: loreOpts, loreScanTurns: loreScanTurns,
    LORE_SCAN_DEFAULT: LORE_SCAN_TURNS, LORE_SCAN_MIN: LORE_SCAN_MIN, LORE_SCAN_MAX: LORE_SCAN_MAX,
    /* items 2 and 3: the two choices, and the resolver the prompt uses, so the
       editor can show the same text the request sends */
    systemTextOf: systemTextOf, postHistoryMode: postHistoryMode,
    cardPromptMode: cardPromptMode,
    postHistoryText: postHistoryText,
    /* item 5: which macros a card asks for that this app will not resolve */
    unresolvedMacros: unresolvedMacros,
    /* item 6: the authoring fields, in the order the sheet prints them */
    CARD_DIRECTIVES: DIRECTIVES,
    directiveBlock: directiveBlock,
    loreRanks: loreRanks, lorePattern: lorePattern, loreBookAsk: loreBookAsk,
    LORE_CHAIN_MAX: LORE_CHAIN_MAX, LORE_CHAIN_FROM: LORE_CHAIN_FROM,
    LORE_LIMIT: LORE_LIMIT, LORE_BUDGET: LORE_BUDGET, LORE_SCAN_TURNS: LORE_SCAN_TURNS,
    requestWindow: requestWindow, lastTurns: lastTurns, labelledName: labelledName,
    speakerNames: speakerNames,
    historyBudgetTokens: historyBudgetTokens,
    modelContextTokens: modelContextTokens,
    rememberModelWindows: rememberModelWindows,
    DEFAULT_HISTORY_TOKENS: DEFAULT_HISTORY_TOKENS,
    DEFAULT_MAX_TOKENS: DEFAULT_MAX_TOKENS,
    maxTokensOf: maxTokensOf,
    _examplesToMessages: examplesToMessages
  };
})(window);
