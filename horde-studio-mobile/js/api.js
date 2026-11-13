/* LLM layer: OpenAI-compatible endpoints + AI Horde text, memory, summarisation */
(function (global) {
  'use strict';

  function macros(text, char, s) {
    if (!text) return '';
    var name = (char && char.name) || 'Assistant';
    var user = (s && s.userName) || 'You';
    return String(text)
      .replace(/\{\{char\}\}/gi, name)
      .replace(/\{\{user\}\}/gi, user)
      .replace(/\{\{name\}\}/gi, name)
      .replace(/\{\{personality\}\}/gi, (char && char.persona) || '')
      .replace(/\{\{description\}\}/gi, (char && char.persona) || '')
      .replace(/\{\{scenario\}\}/gi, (char && char.scenario) || '')
      .replace(/\{\{persona\}\}/gi, (s && s.userPersona) || '');
  }

  /* v1.30.3: OOC notes are the one sanctioned break. The default prompt says
     "stay in character at all times" and forbids commentary, so without a
     standing rule most models ignore "OOC: ..." lines entirely. */
  var OOC_RULE =
    'Out of character: if {{user}} writes an OOC note (OOC:, [ooc], (ooc)), ' +
    'step out of {{char}} and answer it in one short plain line, then return ' +
    'to the scene exactly where it left off. {{char}} never comments on OOC ' +
    'inside the fiction.';

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
    text = plainText(text);
    var out = [], cur = null;
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var m = line.match(/^<START>$/i);
      if (m) { cur = null; return; }
      var isUser = /^\{\{user\}\}\s*:/i.test(line);
      var isChar = /^\{\{char\}\}\s*:/i.test(line) ||
        new RegExp('^' + (char && char.name ? char.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'char') + '\\s*:', 'i').test(line);
      if (isUser) { out.push({ role: 'user', content: line.replace(/^[^\s:]*\s*:\s*/, '') }); cur = out[out.length - 1]; }
      else if (isChar) { out.push({ role: 'assistant', content: line.replace(/^[^\s:]*\s*:\s*/, '') }); cur = out[out.length - 1]; }
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
  function keyStands(text, key) {
    var k = String(key || '').toLowerCase().trim();
    if (!k) return false;
    var re = new RegExp('(^|[^a-z0-9])' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:s|es)?(?=$|[^a-z0-9])');
    return re.test(text);
  }

  function loreHits(entries, recent, limit, budget, stage) {
    if (!entries || !entries.length) return [];
    var text = (recent || '').toLowerCase();
    var activeStage = String(stage || '').trim().toLowerCase();
    var out = [], bytes = 0;
    /* v1.37.0: the same byte discipline the world side has - the pile
       stops at the budget, and a lone match may exceed it alone. */
    var cap = (typeof budget === 'number' && budget > 0) ? budget : 1536;
    entries.forEach(function (e) {
      if (out.length >= (limit || 6)) return;
      if (e.enabled === false) return;
      var requiredStage = String(e.stage || '').trim().toLowerCase();
      if (requiredStage && requiredStage !== '*' && (!activeStage || requiredStage !== activeStage)) return;
      var hit = (e.keys || []).some(function (k) { return k && keyStands(text, k); });
      if (!hit) return;
      var cost = String(e.content || '').length;
      if (out.length && bytes + cost > cap) return;
      out.push(e);
      bytes += cost;
    });
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

  function continuityPrompt(session) {
    var raw = session && session.continuity;
    if (!raw || raw.enabled !== true) return '';
    var c = normalizeContinuity(raw), lines = [
      'CHAT CONTINUITY LEDGER — USER-APPROVED STATE',
      'This state belongs only to this chat. Treat it as authoritative over model-invented details. It is not automatically public knowledge to every character.',
      'Stage: ' + (c.stage || '(not set)'),
      'Location: ' + (c.location || '(not set)'),
      'Time: ' + (c.time || '(not set)'),
      'Present in scene: ' + (c.participants.length ? c.participants.join(', ') : '(not set; do not invent who is present)'),
      'Never put words, actions, thoughts, memories, or unrecorded knowledge into the user character. Only characters listed as present may speak or act in this scene; show a transition before anyone enters, leaves, or changes location.'
    ];
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
        var value = clip(x.value, 160); if (value) changes.push({ type: type, op: op, field: x.field, value: value });
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

  function charSheet(char, s, session, recent, assistantTurns) {
    var parts = [];
    var persona = plainText(macros(char.persona, char, s));
    if (persona) parts.push(persona);
    var scenario = plainText(macros(char.scenario, char, s));
    if (scenario) parts.push('Current situation: ' + scenario);
    if (s.userPersona) parts.push('About {{user}}: '.replace('{{user}}', s.userName) + s.userPersona);
    var state = statePrompt(char);
    if (state) parts.push(state);
    var sceneNote = '';
    if (session && String(session.sceneNote || '').trim()) {
      var frequency = parseInt(session.sceneNoteFrequency, 10);
      if (!(frequency > 0)) frequency = 1;
      if ((assistantTurns || 0) % frequency === 0) {
        sceneNote = plainText(macros(session.sceneNote, char, s));
      }
    }
    var scenePlacement = session && session.sceneNotePlacement || 'end';
    if (sceneNote && scenePlacement === 'character') parts.push('Scene note: ' + sceneNote);

    var activeStage = session && session.continuity && session.continuity.enabled ? session.continuity.stage : '';
    var lore = loreHits(char.lorebook, recent, 6, 1536, activeStage);
    if (lore.length) {
      parts.push('Relevant world facts:\n' + lore.map(function (e) {
        return '- ' + plainText(macros(e.content, char, s));
      }).join('\n'));
    }
    /* Chat lore supplements the character's baseline world facts but only
       for this transcript. It is intentionally placed afterward so a
       timeline-specific fact can clarify an otherwise shared canon detail. */
    var chatLore = session && Array.isArray(session.chatLorebook)
      ? loreHits(session.chatLorebook, recent, 4, 1024, activeStage) : [];
    if (chatLore.length) {
      parts.push('Relevant chat-only facts:\n' + chatLore.map(function (e) {
        return '- ' + plainText(macros(e.content, char, s));
      }).join('\n'));
    }
    if (session && (session.summary || (session.facts && session.facts.length))) {
      var mem = [];
      if (session.summary) mem.push('Story so far: ' + repairMojibake(session.summary));
      if (session.facts && session.facts.length) mem.push('Established facts:\n' + session.facts.map(function (f) { return '- ' + repairMojibake(f); }).join('\n'));
      parts.push(mem.join('\n'));
    }
    /* Scene cast (multi-person cards): who is present here and who is
       elsewhere. Locations are hard boundaries — absent characters do
       not speak, react, or comment. */
    var cast = session && Array.isArray(session.sceneCast) ? session.sceneCast : [];
    if (cast.length) {
      var presentNow = cast.filter(function (n) { return (session.scenePresent || []).indexOf(n) !== -1; });
      var awayNow = cast.filter(function (n) { return (session.scenePresent || []).indexOf(n) === -1; });
      var castLines = [];
      if (presentNow.length) castLines.push('Present in this scene: ' + presentNow.join(', ') + ', ' + s.userName);
      if (awayNow.length) castLines.push('Elsewhere and out of the scene (do not speak, react, or comment): ' + awayNow.join(', '));
      if (castLines.length) parts.push('Scene cast:\n' + castLines.join('\n'));
    }
    if (sceneNote && scenePlacement === 'memory') parts.push('Scene note: ' + sceneNote);
    var continuity = continuityPrompt(session);
    if (continuity) parts.push(continuity);
    var post = plainText(macros(char.postHistory, char, s));
    if (post) parts.push(post);
    if (sceneNote && scenePlacement !== 'character' && scenePlacement !== 'memory') parts.push('Scene note: ' + sceneNote);
    return parts.join('\n\n');
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
  var STREAM_TIMEOUT_MS = 120000;
  function bytesOf(s) {
    try { return new TextEncoder().encode(s || '').length; } catch (e) { return String(s || '').length; }
  }
  function totalBytes(msgs) {
    return msgs.reduce(function (a, m) { return a + bytesOf(m.content); }, 0);
  }
  function fitContext(msgs, floor) {
    var total = totalBytes(msgs);
    if (total <= CONTEXT_CAP) return msgs;
    var out = msgs.slice();
    while (total > CONTEXT_CAP && out.length > floor + 4) {
      total -= bytesOf(out.splice(floor, 1)[0].content);
    }
    return out;
  }

  /** Build the payload for an OpenAI-compatible endpoint. */
  function buildChat(character, session, history, s, note) {
    var recent = history.slice(-6).map(function (m) { return m.text || ''; }).join('\n');
    var assistantTurns = history.filter(function (m) { return m.role === 'assistant'; }).length;
    /* A world run (and any caller that knows better) supplies character.systemPrompt
       with the narrator rules plus live state. Fall back to the global prompt. */
    var system = macros(character.systemPrompt || s.systemPrompt, character, s);
    system += '\n' + macros(OOC_RULE, character, s);
    var sheet = charSheet(character, s, session, recent, assistantTurns);
    if (sheet) system += '\n\n' + sheet;
    var rpg = rpgStatusPrompt(session);
    if (rpg) system += '\n\n' + rpg;
    if (note) system += '\n\n' + note;

    var msgs = [{ role: 'system', content: system.trim() }];
    var ex = examplesToMessages(character.examples, character, s);
    ex.forEach(function (m) { msgs.push(m); });

    /* v1.13.2: repair double-encoded text in stored messages (the card's
       greeting, a model reply that imitated the card's mojibake) so the
       model stops reading — and imitating — it. */
    var hist = history.map(function (m) {
      var content = repairMojibake(m.text || '');
      /* v1.39.0: a player's photo degrades to the caption they wrote for
         it - text models never see pixels, so the caption IS the photo. */
      if (m.imageCaption && m.role === 'user') content += '\n[photo: ' + m.imageCaption + ']';
      return { role: m.role === 'user' ? 'user' : 'assistant', content: content };
    }).filter(function (m) { return m.content.trim(); });

    hist = trimHistory(hist, s.contextMessages || 40, s.maxContextChars || 26000);
    hist.forEach(function (m) { msgs.push(m); });

    msgs = fitContext(msgs, 1 + ex.length);
    if (totalBytes(msgs) > CONTEXT_CAP && ex.length) {
      msgs = [msgs[0]].concat(msgs.slice(1 + ex.length));   // last resort: drop the examples
    }
    return msgs;
  }

  /** Build a plain-text prompt for AI Horde / non-chat backends. */
  function buildPrompt(character, session, history, s, note, budgetTokens) {
    var recent = history.slice(-6).map(function (m) { return m.text || ''; }).join('\n');
    var assistantTurns = history.filter(function (m) { return m.role === 'assistant'; }).length;
    var head = macros(character.systemPrompt || s.systemPrompt, character, s) +
      '\n\n' + charSheet(character, s, session, recent, assistantTurns);
    var rpg = rpgStatusPrompt(session);
    if (rpg) head += '\n\n' + rpg;
    if (note) head += '\n\n' + note;
    head += '\n\n' + macros(OOC_RULE, character, s);
    var ex = examplesToMessages(character.examples, character, s).map(function (m) {
      return (m.role === 'user' ? s.userName : character.name) + ': ' + m.content;
    }).join('\n');
    var hist = history.map(function (m) {
      var content = repairMojibake(m.text || '');
      if (m.imageCaption && m.role === 'user') content += '\n[photo: ' + m.imageCaption + ']';
      return (m.role === 'user' ? s.userName : character.name) + ': ' + content;
    });
    var join = function (h) {
      return [head.trim(), ex ? 'Example dialogue:\n' + ex : '', 'Chat history:\n' + h.join('\n'),
        character.name + ':'].filter(Boolean).join('\n\n');
    };
    /* head holds the character sheet and the life snapshot — trim history, never that */
    /* Drop the OLDEST turns first, so the newest thing you typed always survives.
       With a budget we trim harder than CONTEXT_CAP would, because the Horde's
       window is far smaller than a chat provider's. */
    var capBytes = budgetTokens ? budgetTokens * 4 : CONTEXT_CAP;
    while (hist.length > 2 && bytesOf(join(hist)) > capBytes) hist.shift();
    return join(hist);
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
    var limitHeader = false;
    try { limitHeader = !!(headers && headers.get && headers.get('x-ratelimit-limit')); } catch (e) {}
    if (err && err.openRouterKind === 'empty') return { kind: 'empty', diagnosis: 'Route returned no visible answer' };
    if (err && err.name === 'TimeoutError' || /timeout/.test(type)) return { kind: 'timeout', diagnosis: 'App/provider timeout — quota not confirmed' };
    if (err && err.name === 'AbortError') return { kind: 'cancelled', diagnosis: 'Cancelled by user' };
    if (metadata.limit_source || limitHeader) return { kind: 'account_limit', diagnosis: 'OpenRouter account rate limit' };
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
      message: err && err.status ? 'HTTP ' + err.status : diagnosis.diagnosis,
      model: model, provider: provider
    });
  }
  function openRouterResetAt(now) {
    var d = new Date(now || Date.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
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
    var e;
    if (status === 429) {
      var sharedFree = /:free\s*$/i.test(modelName || '');
      var isAccountLimit = !!(metadata && metadata.limit_source);
      try { isAccountLimit = isAccountLimit || !!(responseHeaders && responseHeaders.get && responseHeaders.get('x-ratelimit-limit')); } catch (ignored) {}
      var providerCode = metadata && metadata.provider_code;
      e = new Error(base + (isAccountLimit
        ? ' — OpenRouter reports an account/key rate limit. Check the quota panel for requests remaining and reset time.'
        : (openRouterRequest
          ? (providerCode
            ? ' — the upstream model provider rate-limited this route. Check the quota panel: a provider throttle can happen while account requests remain.'
            : ' — 429 rate limit. It may be the OpenRouter account cap or this model’s provider; check the quota panel to distinguish. The app retries briefly, then records the result.')
          : (sharedFree
            ? ' — the shared free endpoint for this model is saturated upstream; its provider throttles the pool regardless of YOUR balance or today’s count (both are fine). Retried already — try again in a few minutes, pick another :free model, or drop the :free suffix to spend your balance on it instead.'
            : ' — rate limit reached. Free tiers cap requests per minute and per day (OpenRouter free: 20/min, 50/day until a one-time $10 top-up). The app already retried it — give it a minute; if every try today fails, the daily cap may be spent.'))));
      e.rateLimited = true;
    } else if (status === 402) {
      e = new Error(base + ' — the provider says the account is out of credits/quota. ' +
        'On OpenRouter even free models reject when the balance goes negative.');
    } else if (status === 401 || status === 403) {
      e = new Error(base + ' — the API key was rejected; check Settings and the connection.');
    } else {
      e = new Error(base);
    }
    e.status = status;
    e.openRouterMetadata = metadata || null;
    return e;
  }

  /** Stream a chat completion. onDelta(textChunk). Returns full text. */
  function streamChat(s, messages, onDelta, signal, override) {
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
    /* OpenRouter's free Nemotron 3 routes can spend this whole budget on
       hidden reasoning, returning no final content. Disable it by default
       only for those routes; leave an explicit caller override intact. */
    var guardedNemotron = isOpenRouterFreeNemotron(s, body.model);
    if (guardedNemotron && !(body.reasoning && body.reasoning.enabled === true)) {
      body.reasoning = Object.assign({}, body.reasoning || {}, { enabled: false });
    }
    /* v1.39.25 — repetition guard: never sent before, so a model's favorite
       words kept regenerating into the history they were read back from — a
       loop no amount of message-editing could ever finish. 0/unset omits the
       key entirely (byte-identical body; some providers dislike the nuance). */
    if (s.frequencyPenalty) body.frequency_penalty = s.frequencyPenalty;

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
            var httpErr = providerError(r.status, msg, body.model, errorMeta, r.headers, isOpenRouterEndpoint(s));
            httpErr.openRouterHeaders = r.headers;
            fail(httpErr);
          }).catch(fail);
        }
        if (!wantStream) {
          return r.json().then(function (d) {
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
    if (/^(?:let's|lets|let me|wait|okay|ok[,.]|hmm|so,|now,|first,|firstly|then,|after that|actually,|maybe|perhaps|alright|right,|yes,|no,|i should|i'll|i will|i'd|i need|i can|i could|i must|i want to|we should|we need|the prompt|the instruction|the system|the card|note:|notes?:|step \d|finally,|also,|importantly,?|keep in mind|remember,?|one more|to sum|in summary,?)/i.test(l)) return true;
    if (/\b(?:the\s+)?(?:prompt|instruction|system prompt|card|scenario)\s+(?:says?|asks?|tells?|wants?|instructs?|requires?|mentions?)\b/i.test(l)) return true;
    if (/\b(?:refine|rework|rewrite|adjust|revise|tighten|trim)\s+(?:the\s+)?(?:response|reply|answer|draft|this)\b/i.test(l)) return true;
    if (/\b(?:i|we)\s+(?:should|need to|could|can|will|must|might)\s+(?:probably\s+)?\b/i.test(l) && l.length < 90) return true;
    if (/^(?:\[|\()\s*(?:ooc|note|meta|aside)/i.test(l)) return true;
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

  function cleanReply(text, charName, userName) {
    if (!text) return '';
    var lines = String(text).split('\n');
    var out = [];
    var userRe = new RegExp('^\\s*' + escapeRe(userName) + '\\s*:', 'i');
    var charRe = new RegExp('^\\s*' + escapeRe(charName) + '\\s*:', 'i');
    for (var i = 0; i < lines.length; i++) {
      if (i > 0 && (userRe.test(lines[i]) || charRe.test(lines[i]))) break;
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
    if (charName) t = t.replace(new RegExp('^\\s*' + escapeRe(charName) + '\\s*:\\s*', 'i'), '');
    return t.trim();
  }

  /* Short words that can legitimately end a generation pass — if the last word is one of
     these we treat the next chunk as a new word and re-insert the space. */
  var COMMON_WORDS = /^(a|an|and|the|to|of|in|on|at|is|it|its|was|were|be|been|am|are|that|this|these|those|with|for|from|by|as|but|not|no|nor|or|so|if|then|than|there|here|their|his|her|hers|him|she|he|they|them|we|you|your|yours|i|my|our|have|has|had|will|would|can|could|should|shall|may|might|must|do|does|did|done|up|out|down|over|under|again|more|most|some|any|all|one|two|three|what|when|where|why|how|who|whom|which|because|about|into|onto|off|after|before|while|during|through|between|against|among|also|very|just|only|even|still|yet|ever|never|always|now|soon|later|today|tonight|yes|ok|okay|well|good|bad|right|left|back|away|enough|much|many|few|own|same|such|other|another|every|both|each|either|neither|mine|me|us|let|lets|go|going|went|come|coming|came|said|says|say|know|knows|knew|think|thought|want|wants|need|needs|see|saw|look|looked|take|took|give|gave|make|made|get|got|tell|told|ask|asked|keep|kept|put|find|found|leave|left|feel|felt|seem|seemed|turn|turned|stand|stood|hold|held|hear|heard|run|ran|move|moved|open|opened|close|closed|begin|began|start|started|stop|stopped|work|worked|try|tried|use|used)$/i;

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
   * looks like a text someone would actually send — that keeps "Dr. Mara is
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
        var budget = HORDE_CTX_TOKENS - (s.maxTokens || 200) * (inContinuation ? 2 : 1) - 64;
        var base = buildPrompt(char, session, o.history, s, o.note, budget);
        var prompt = inContinuation ? base + ' ' + full : base;
        return guardModel('text', s.hordeTextModel).then(function () {
          return Horde.generateText({
            prompt: prompt,
            model: s.hordeTextModel || '',
            maxLength: s.maxTokens,
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
      var msgs = buildChat(char, session, o.history, s, o.note);
      if (idx > 0 || o.continueFrom) {
        /* v1.39.30: the trailing assistant PREFILL alone is not portable.
           Some chat endpoints read it as a FINISHED turn and answer with a
           fresh beat — a seeded Continue then "continues" with a brand-new
           reply (observed live: the cut after "…Crabbe" answered with
           "Draconica's expression doesn't change…"). Pin the instruction in
           words right at the seam, immediately before the seed, so even a
           prefill-blind endpoint knows the following text is in-progress. */
        msgs.push({ role: 'system', content:
          '[System note: the assistant message that follows this note is a reply CUT OFF ' +
          'mid-stream by a length limit, not a finished answer. Continue that same reply ' +
          'from exactly where its text stops — if a word is cut, finish the word first — ' +
          'without repeating or rephrasing any already-written text, and without starting ' +
          'a new reply, action or paragraph beat.]' });
        msgs.push({ role: 'assistant', content: full });
      }
      /* Preview this pass in its own buffer. loop() cleans the returned text and
         commits it to `full` exactly once — accumulating here as well left two
         copies of every tag, so a single [[cash:+10]] settled as +20. */
      var streamed = '';
      return streamChat(s, msgs, function (chunk) {
        streamed += chunk;
        /* a seeded continuation previews seed + stream WITHOUT the glue
           guess — the real seam rule settles it in the assembled text */
        if (o.onDelta) o.onDelta(chunk, full ? full + (o.continueFrom && idx === 0 ? '' : ' ') + streamed : streamed);
      }, o.signal, o.override);
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
        var piece = cleanReply(raw, char && char.name, s.userName);
        if (!piece) return full;

        /* Stitch without mangling. The hard part: when the previous pass ends with a
           letter and the next starts with one, it is either a word split by the token
           limit ("wes" + "t.") or a real word boundary ("and" + "how"). Only join tight
           when the last word does not read as a finished English word. */
        /* v1.39.27: strip a replayed cut-tail BEFORE the seam rules see the
           piece — otherwise the glue logic pastes the rerun whole (the
           doubled paragraph the user screenshot) and the pass's budget is
           spent on text we already had. */
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
            piece = piece.slice(stutRun);
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
        var joined = cleanReply(stripThinking(full, s.stripThinking !== false), char && char.name, s.userName);
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

  /** Ask the model to compress the story so far into a summary + facts. */
  function summarize(o) {
    var s = o.settings, char = o.character, session = o.session, history = o.history;
    var convo = history.slice(-o.maxMessages || 40).map(function (m) {
      return (m.role === 'user' ? s.userName : char.name) + ': ' + repairMojibake(m.text || '');
    }).join('\n');

    var instruction =
      'You are a memory manager for a roleplay between ' + s.userName + ' and ' + char.name + '.\n' +
      'Read the transcript and return STRICT JSON only, with no commentary:\n' +
      '{"summary":"<3-6 sentences capturing plot, tone and where things stand>",' +
      '"facts":["<short durable fact>","..."]}\n' +
      'Keep at most 12 facts. Facts must be durable: names, places, relationships, injuries, promises, objects, goals.\n' +
      (session && session.summary ? 'Existing summary to extend:\n' + repairMojibake(session.summary) + '\n' : '') +
      (session && session.facts && session.facts.length ? 'Existing facts:\n' + session.facts.map(repairMojibake).join('\n') + '\n' : '') +
      '\nTranscript:\n' + convo;

    var msgs = [{ role: 'system', content: instruction }, { role: 'user', content: 'Return the JSON now.' }];

    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: instruction + '\n\nJSON:',
        model: s.hordeTextModel || '',
        maxLength: 320, temperature: 0.3, topP: 0.9, apikey: s.hordeKey,
        maxWait: 300
      }).then(function (r) { return parseMemory(r.text); });
    }
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3, max_tokens: 500 })
      .then(parseMemory);
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

    var instruction =
      'You are a memory manager for the text roleplay world "' +
        String((world && world.name) || 'World') + '".\n' +
      'Read the transcript and return STRICT JSON only, with no commentary:\n' +
      '{"summary":"<3-6 sentences capturing plot, tone and where things stand>",' +
      '"facts":["<short durable fact>","..."]}\n' +
      'Keep at most 12 facts. Facts must be durable: names, places, relationships, ' +
      'promises, objects, goals, conditions, what was decided or revealed.\n' +
      'Do NOT record tag commands, stat numbers, cheese-and-ledger mechanics - ' +
      'the world tracks those itself.\n' +
      (run.memory && run.memory.summary ? 'Existing summary to extend:\n' + run.memory.summary + '\n' : '') +
      (run.memory && run.memory.facts && run.memory.facts.length
        ? 'Existing facts:\n' + run.memory.facts.join('\n') + '\n' : '') +
      '\nTranscript:\n' + convo;

    if (s.provider === 'horde') {
      return Horde.generateText({
        prompt: instruction + '\n\nJSON:',
        model: s.hordeTextModel || '',
        maxLength: 320, temperature: 0.3, topP: 0.9, apikey: s.hordeKey,
        maxWait: 300
      }).then(function (r) { return parseMemory(r.text); });
    }
    var msgs = [{ role: 'system', content: instruction }, { role: 'user', content: 'Return the JSON now.' }];
    return streamChat(s, msgs, null, null, { stream: false, temperature: 0.3, max_tokens: 500 })
      .then(parseMemory);
  }

  function parseMemory(text) {
    var out = { summary: '', facts: [] };
    if (!text) return out;
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start === -1 || end <= start) { out.summary = text.trim().slice(0, 800); return out; }
    try {
      var j = JSON.parse(text.slice(start, end + 1));
      out.summary = String(j.summary || '').trim();
      out.facts = (j.facts || []).map(function (f) { return String(f).trim(); }).filter(Boolean).slice(0, 12);
    } catch (e) {
      out.summary = text.trim().slice(0, 800);
    }
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
    macros: macros, buildChat: buildChat, buildPrompt: buildPrompt, generate: generate,
    cleanReply: cleanReply, looksTruncated: looksTruncated,
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
    parseAiJson: parseAiJson, parseAiJsonPartial: parseAiJsonPartial,
    parseLifeNotes: parseLifeNotes, parseLoreDraft: parseLoreDraft,
    parseLorebookFile: parseLorebookFile, aiJson: aiJson,
    statePrompt: statePrompt, parseState: parseState, stripState: stripState,
    rpgStatusPrompt: rpgStatusPrompt, parseRpgUpdate: parseRpgUpdate,
    stripRpgUpdate: stripRpgUpdate, hideRpgUpdate: hideRpgUpdate,
    emptyContinuity: emptyContinuity, normalizeContinuity: normalizeContinuity,
    continuityPrompt: continuityPrompt, parseContinuityUpdate: parseContinuityUpdate,
    stripContinuityUpdate: stripContinuityUpdate, hideContinuityUpdate: hideContinuityUpdate,
    applyContinuityProposal: applyContinuityProposal,
    plainText: plainText, repairMojibake: repairMojibake,
    estTokens: function (t) { return Math.ceil((t || '').length / 4); },
    /* v1.29.1: the last real Horde answer, as a receipt (model, worker,
       kudos, tries, what was requested). Set by generate(); the world's
       status sheet reads it. null until the first text generation. */
    lastHorde: null,
    /* tests shorten the stream deadline and the 429 backoff; the app never calls these */
    _setStreamTimeoutMs: function (ms) { STREAM_TIMEOUT_MS = ms; },
    _setRateRetryDelays: function (arr) { RATE_BACKOFF = arr.slice(); }
  };
})(window);
