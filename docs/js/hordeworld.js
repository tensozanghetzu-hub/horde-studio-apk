/* Authored worlds (.horde_world).
 *
 * Upstream Horde Studio ships a second, quite different kind of world alongside
 * the OpenStreetMap packs: an authored world - a place with rooms and streets,
 * a cast, factions, lore, and a set of rules for what can happen in it.
 * `Policy Panic at Bramble & Pike` is the worked example: 23 locations, 8
 * people, 6 factions, a clock that starts at 8:57 on a Monday.
 *
 * A world file is mostly JSON. Nearly all of its weight is base64 art, which
 * this app has no use for, so importing strips the media and keeps the rest:
 *
 *   locations     region / route / building / room / outdoor, joined by exits
 *                 that carry a travelTime, so moving costs minutes
 *   entities      the cast, each with a persona, a goal and a home
 *   factions      who holds power, and what they want
 *   relationships who depends on whom, and how much
 *   lorebook      entries that surface when their keywords come up
 *   gameRules     stats, currency, dice, and which modules are switched on
 *   hudConfig     the clock, and what the player can see
 *   sandboxConfig politics, law, seasons - how much the world moves by itself
 *   startingLives the roles you can begin as, with their starting kit
 *
 * A run is one playthrough: where you are, what time it is, what you are
 * carrying, what you have promised to do. The model acts as the referee and
 * reports what changed in tags at the end of its reply:
 *
 *   [[move:loc_reception]]      walk to a place you can see from here
 *   [[clock:+30]]               time passes
 *   [[cash:-15]]                money, named by the world
 *   [[stat:performance:-5]]     any stat the world defines
 *   [[item:Brass key]]          pick something up
 *   [[drop:training binder]]    lose something
 *   [[quest:Survive the audit]] take on a task
 *   [[quest-done:Survive...]]   finish one
 *   [[roll:2d6+1]]              roll dice and show the result
 *
 * The tags are stripped before the reply is shown, so the player reads prose
 * and the world keeps its ledgers straight.
 *
 * Nothing here touches a virtual human's life or a character chat unless you
 * start a world yourself.
 */
(function (global) {
  'use strict';

  var MEDIA_KEYS = ['mediaAssets', '_mediaManifest', 'visuals', 'presentation'];

  /* ---------------- import ---------------- */

  /** Join the three bounded AI-draft parts (places, people, rules) into one
   *  .horde_world-shaped object ready for parse(). Each part is the plain
   *  JSON of one model request; missing parts degrade to parse's defaults,
   *  so a partially drafted world can still be inspected instead of lost. */
  function assemble(parts) {
    parts = parts || {};
    var a = parts.places || {}, b = parts.people || {}, c = parts.rules || {};
    var w = { _format: 'horde-world' };
    /* v1.35.0: a richer tape through the same three-part machine - whatever
       the drafts carry (goal programs, task seeds, the calendar, the scene
       cap) becomes the world the player meets. */
    ['name', 'description', 'startLocationId', 'locations',
     'entities', 'factions', 'relationships',
     'dmPrompt', 'intro', 'authorNote', 'startingLives', 'gameRules', 'hudConfig',
     'goalPrograms', 'startingQuests', 'sandboxConfig', 'kernel'
    ].forEach(function (k) {
      var v = a[k] !== undefined ? a[k] : (b[k] !== undefined ? b[k] : c[k]);
      if (v !== undefined) w[k] = v;
    });
    return w;
  }

  /** Strip the art and keep the world. Returns null if this isn't one. */
  function parse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var format = raw._format || (raw.locations && raw.entities ? 'horde-world' : null);
    if (format !== 'horde-world') return null;
    if (!Array.isArray(raw.locations) || !raw.locations.length) return null;

    var w = {};
    Object.keys(raw).forEach(function (k) {
      if (MEDIA_KEYS.indexOf(k) !== -1) return;
      /* v1.30.0: `banner` is the ONE image a world carries - its face. The
         PC version shows it as the world's avatar; the phone keeps it (the
         import path diets it before storing). Every OTHER top-level data:
         URI is still art, not content, and still goes. */
      if (k === 'banner') { w.banner = (typeof raw[k] === 'string' && raw[k]) ? raw[k] : ''; return; }
      /* anything still carrying a data: URI is art, not content */
      if (typeof raw[k] === 'string' && raw[k].indexOf('data:') === 0) return;
      w[k] = raw[k];
    });
    if (!('banner' in w)) w.banner = '';

    w.id = w.id || 'world_' + Date.now().toString(36);
    w.name = w.name || 'Untitled world';
    w.locations = (w.locations || []).map(function (l) {
      return {
        id: l.id, name: l.name || 'Somewhere',
        mapType: l.mapType || 'room',
        region: l.region || '',
        description: l.description || '',
        hiddenDescription: l.hiddenDescription || '',
        parentLocationId: l.parentLocationId || null,
        prosperity: l.prosperity, danger: l.danger,
        exits: (l.exits || []).map(function (e) {
          return typeof e === 'string'
            ? { text: e, travelTime: null, isOneWay: false }
            : { text: e.text || '', travelTime: e.travelTime === undefined ? null : e.travelTime, isOneWay: !!e.isOneWay };
        })
      };
    });
    w.entities = (w.entities || []).map(function (e) {
      return {
        id: e.id, name: e.name || 'Someone', type: e.type || 'npc',
        isMajor: !!e.isMajor, factionId: e.factionId || null,
        startLocation: e.startLocation || null, homeLocation: e.homeLocation || null,
        description: e.description || '', persona: e.persona || '',
        goal: e.goal || '', secrets: e.secrets || '',
        /* v1.32.0: the NPC's declared day - where they are and when, so the
           world can honor "work schedules, homes and who is actually
           present" instead of parking everyone at home forever. */
        schedule: (Array.isArray(e.schedule) ? e.schedule : []).map(function (sc) {
          return { time: sc.time || '', locationId: sc.locationId || null,
            activity: sc.activity || '',
            days: Array.isArray(sc.days) ? sc.days.slice() : [] };
        }),
        /* v1.19.0: when this entity's secret truth becomes discoverable */
        secretUnlock: e.secretUnlock || null
      };
    });
    w.factions = w.factions || [];
    w.relationships = w.relationships || [];
    /* v1.33.0: the off-screen agent and the world's goal programs. They pass
       through the raw-key copy above, and are normalized here so the rest of
       the module can trust the shape: worldAgent {enabled, intervalTurns},
       goalPrograms [{name, actor, steps[]}]. A world without an agent does
       not tick; a program without steps is no program at all. */
    w.worldAgent = (function (a) {
      if (!a || typeof a !== 'object') return null;
      return {
        enabled: a.enabled !== false,
        intervalTurns: (typeof a.intervalTurns === 'number' && a.intervalTurns > 0)
          ? Math.round(a.intervalTurns) : 15
      };
    })(w.worldAgent);
    w.goalPrograms = (Array.isArray(w.goalPrograms) ? w.goalPrograms : [])
      .map(function (g) {
        if (!g || typeof g !== 'object') return null;
        var steps = (Array.isArray(g.steps) ? g.steps : [])
          .map(function (s) { return String(s || '').trim(); }).filter(Boolean);
        if (!steps.length) return null;
        return { id: g.id || '', name: String(g.name || g.goal || 'A scheme in motion'),
          actor: g.actor || g.entityId || g.factionId || '', steps: steps };
      }).filter(Boolean);
    w.lorebook = (w.lorebook || []).map(function (l) {
      return {
        id: l.id, keyword: l.keyword || '', text: l.text || '',
        /* v1.19.0 knowledge gating: who may see this entry */
        knownBy: l.knownBy || '',
        unlockQuest: l.unlockQuest || '',
        unlockNpc: l.unlockNpc || ''
      };
    });
    w.startingLives = w.startingLives || [];
    w.gameRules = w.gameRules || {};
    w.hudConfig = w.hudConfig || {};
    w.sandboxConfig = w.sandboxConfig || {};
    w.dmPrompt = w.dmPrompt || '';
    w.authorNote = w.authorNote || '';
    w.intro = w.intro || '';
    w.startLocationId = w.startLocationId || (w.locations[0] || {}).id;
    w.importedAt = Date.now();
    return w;
  }

  /** Import cost, so the confirmation can say what it is about to do. */
  function summarise(world) {
    var media = 0;
    (world._mediaCount || 0);
    return {
      name: world.name,
      locations: (world.locations || []).length,
      people: (world.entities || []).length,
      factions: (world.factions || []).length,
      lore: (world.lorebook || []).length,
      starts: (world.startingLives || []).length,
      media: media
    };
  }

  /* ---------------- storage ----------------
   * Injected rather than required, so the engine runs in tests with no DOM. */

  var store = null;
  function db() { return store || global.IDB || null; }

  function save(world) {
    var d = db();
    if (!d) return Promise.resolve(world);
    return d.put('worlds', world).then(function () { return world; });
  }
  function all() {
    var d = db();
    if (!d) return Promise.resolve([]);
    return d.getAll('worlds').then(function (list) {
      return (list || []).sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    });
  }
  function get(id) {
    var d = db();
    if (!d) return Promise.resolve(null);
    return d.get('worlds', id);
  }
  function remove(id) {
    var d = db();
    if (!d) return Promise.resolve();
    return d.del ? d.del('worlds', id) : d.delete('worlds', id);
  }
  function saveRun(run) {
    var d = db();
    if (!d) return Promise.resolve(run);
    return d.put('worldRuns', run).then(function () { return run; });
  }
  function allRuns() {
    var d = db();
    if (!d) return Promise.resolve([]);
    return d.getAll('worldRuns').then(function (list) {
      return (list || []).sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    });
  }
  function removeRun(id) {
    var d = db();
    if (!d) return Promise.resolve();
    return d.del ? d.del('worldRuns', id) : d.delete('worldRuns', id);
  }

  /* ---------------- reading a world ---------------- */

  function location(world, id) {
    var list = (world && world.locations) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Exits as { to, text, minutes }. An exit naming no known place is kept but unlinked. */
  function exits(world, fromId) {
    var l = location(world, fromId);
    if (!l || !l.exits) return [];
    var names = {};
    (world.locations || []).forEach(function (p) { names[p.name.toLowerCase()] = p.id; });
    return l.exits.map(function (e) {
      var label = String(e.text || '').replace(/^\s*to\s+/i, '').trim();
      return {
        text: e.text || label,
        label: label,
        to: names[label.toLowerCase()] || null,
        minutes: e.travelTime === null ? null : e.travelTime,
        oneWay: !!e.isOneWay
      };
    });
  }

  function npcsAt(world, locationId, clock) {
    return (world.entities || []).filter(function (e) {
      if (e.type && e.type !== 'npc') return false;
      /* v1.32.0: with a clock this is "who is actually here now" (their
         schedule governs); without one it's the old static answer, which
         lore gating still uses. */
      if (clock) return npcPlaceAt(e, clock) === locationId;
      return e.startLocation === locationId || e.homeLocation === locationId;
    });
  }

  /** v1.24.0: the names the party ledger accepts - every NPC, canonical spelling. */
  function npcNames(world) {
    return (world.entities || []).filter(function (e) {
      return !e.type || e.type === 'npc';
    }).map(function (e) { return e.name; }).filter(Boolean);
  }

  /* ---------------- v1.32.0: the world the player is looking at -------- */

  /* An NPC's declared day: schedule entries carry time, locationId, activity
     and day tags ('weekday'/'weekend', a named day like 'saturday', or none
     meaning every day). The governing entry is the latest one whose time
     has passed today; before the day's first entry the answer is null and
     the caller falls back to home. */
  var DAY_TAGS = {
    weekday: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    weekend: ['SATURDAY', 'SUNDAY']
  };
  function scheduleActiveAt(entity, clock) {
    var sch = entity && entity.schedule;
    if (!sch || !sch.length || !clock) return null;
    var wd = String(clock.weekday || '').toUpperCase(), best = null, bt = -1;
    sch.forEach(function (s) {
      var days = s.days || [];
      var matches = !days.length || days.some(function (d) {
        var low = String(d).toLowerCase();
        if (DAY_TAGS[low]) return DAY_TAGS[low].indexOf(wd) !== -1;
        if (low === 'daily' || low === 'everyday' || low === 'all') return true;
        return low.toUpperCase() === wd;
      });
      if (!matches) return;
      var m = /^(\d{1,2}):(\d{2})$/.exec(String(s.time || ''));
      if (!m) return;
      var t = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      if (t <= clock.minutes && t > bt) { bt = t; best = s; }
    });
    return best ? { locationId: best.locationId || null, activity: best.activity || '' } : null;
  }

  /* Where an NPC is right now: their governing schedule entry when the world
     declares one, else home, else the author's start. Callers without a
     clock keep the old static answer. */
  function npcPlaceAt(entity, clock) {
    var act = scheduleActiveAt(entity, clock);
    if (act && act.locationId) return act.locationId;
    return entity.homeLocation || entity.startLocation || null;
  }

  /** Has the referee already spoken for this NPC in this run? Used to
      shorten repeat dossiers, never to drop one. */
  function metNpc(run, entity) {
    var name = entity && entity.name;
    if (!name || !run || !run.log) return false;
    return run.log.some(function (m) {
      return m.role === 'assistant' && String(m.content || '').indexOf(name) !== -1;
    });
  }

  /** Shorten a reference text at a word boundary (prompt budget). */
  function synopsis(t, max) {
    var s = String(t || '');
    if (s.length <= max) return s;
    var cut = s.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.5) cut = cut.slice(0, sp);
    return cut.trim() + '…';
  }

  /* The world's own calendar, when it declares seasons: a short "early
     autumn · day 47" line from the run clock. No live weather on the phone -
     the authored calendar is the authority. */
  function seasonText(world, run) {
    var sb = world.sandboxConfig || {};
    if (sb.seasons !== true) return '';
    var seasonDays = sb.seasonDays > 0 ? Math.floor(sb.seasonDays) : 90;
    var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
    var PARTS = ['early', 'mid', 'late'];
    var day0 = clockOf(run, world.hudConfig || {}).day - 1;
    var idx = Math.floor(day0 / seasonDays) % 4;
    var part = Math.floor((day0 % seasonDays) / (seasonDays / 3));
    if (part > 2) part = 2;
    if (idx < 0) idx = 0;
    return (sb.calendar ? String(sb.calendar) + ' · ' : '') + PARTS[part] + ' ' + SEASONS[idx] + ' · day ' + (day0 + 1);
  }

  /* The grammar's id roll-call obeys the world's own scene limit
     (kernel.sceneLocationLimit): current place and reachable exits first,
     the rest "+N more". Validation keeps the full map - this is purely the
     prompt budget the file itself asked for. */
  function locationIdLine(world, run) {
    var ids = (world.locations || []).map(function (l) { return l.id; });
    var limit = (world.kernel && world.kernel.sceneLocationLimit) || 0;
    if (!limit || ids.length <= limit) return ids.join(', ');
    var first = [];
    if (run && run.locationId && ids.indexOf(run.locationId) !== -1) first.push(run.locationId);
    exits(world, run && run.locationId).forEach(function (e) {
      if (e.to && first.length < limit && first.indexOf(e.to) === -1) first.push(e.to);
    });
    ids.forEach(function (id) { if (first.length < limit && first.indexOf(id) === -1) first.push(id); });
    var kept = first.slice(0, limit);
    return kept.join(', ') + ', +' + (ids.length - kept.length) + ' more';
  }

  function faction(world, id) {
    var f = (world && world.factions) || [];
    for (var i = 0; i < f.length; i++) if (f[i].id === id) return f[i];
    return null;
  }

  /** v1.32.0: an entity by id (relationships reference ids, not names). */
  function entityById(world, id) {
    var list = (world && world.entities) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------------- knowledge gating (v1.19.0) ---------------- */

  function questReached(run, text) {
    var low = String(text || '').toLowerCase();
    if (!low) return false;
    return (run.quests || []).some(function (q) {
      return String(q.text).toLowerCase().indexOf(low) !== -1;
    });
  }

  /** The player has standing with a faction (any score, positive or not -
   *  being in the loop is what matters). */
  function factionKnown(run, factionId) {
    return (run.reputation || []).some(function (r) { return r.factionId === factionId; });
  }

  function npcHere(world, run, ref) {
    var low = String(ref || '').toLowerCase();
    return npcsAt(world, run.locationId).some(function (e) {
      return String(e.id).toLowerCase() === low || String(e.name).toLowerCase() === low;
    });
  }

  /** May the player's situation see this lore entry?
   *  knownBy: anyone (default) | faction:<id> | npc:<id-or-name> | secret.
   *  A secret unlocks via unlockQuest (the story has reached it) or
   *  unlockNpc (the witness is here); with no unlock condition it stays
   *  locked. An unknown gate word shows rather than silently hides. */
  function loreVisible(world, run, entry) {
    var kb = String((entry && entry.knownBy) || 'anyone').toLowerCase().trim();
    if (!kb || kb === 'anyone') return true;
    if (kb.indexOf('faction:') === 0) return factionKnown(run, kb.slice(8).trim());
    if (kb.indexOf('npc:') === 0) return npcHere(world, run, kb.slice(4).trim());
    if (kb === 'secret') {
      if (entry.unlockQuest && questReached(run, entry.unlockQuest)) return true;
      if (entry.unlockNpc && npcHere(world, run, entry.unlockNpc)) return true;
      return false;
    }
    return true;
  }

  function countHits(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  function loreScore(input, entry) {
    var score = 0;
    String(entry.keyword || '').split(',').forEach(function (k) {
      k = k.trim().toLowerCase();
      if (k.length > 2) score += countHits(input, k);
    });
    return score;
  }

  /** Lorebook entries the player's situation can know and the input
   *  touches - best matches first, within the byte budget. The budget is
   *  what keeps a 120-place pack from eating the prompt: a single matching
   *  entry always gets in, but the pile stops growing at the budget. */
  function loreHits(world, run, text, limit, budget) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return [];
    var scored = (world.lorebook || []).map(function (e, i) {
      return { e: e, i: i, s: loreVisible(world, run, e) ? loreScore(t, e) : 0 };
    }).filter(function (x) { return x.s > 0; });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var out = [], bytes = 0;
    scored.forEach(function (x) {
      if (out.length >= (limit || 8)) return;
      var cost = String(x.e.text || '').length;
      if (out.length && bytes + cost > (budget || 1536)) return;
      out.push(x.e);
      bytes += cost;
    });
    return out;
  }

  /* ---------------- the world's story memory (v1.36.0) ---------------- */

  /** The world's memory keeps to the same cadence as the persona chats:
   *  every `every` turns, once per turn. memAt marks the last turn the
   *  memory was refreshed, so a re-render or a second turn never asks
   *  twice for the same beat. */
  function memoryDue(run, every) {
    var e = (typeof every === 'number' && every > 0) ? every : 14;
    var t = (run && run.turn) || 0;
    return t > 0 && t % e === 0 && (run.memAt || 0) !== t;
  }

  /** Write the memory the model handed back: bounded, deduped, and only
   *  stamped when something actually arrived - an empty pass must not
   *  burn the cadence marker, or the next due turn never happens. */
  function applyMemory(run, mem) {
    var summary = String((mem && mem.summary) || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
    var facts = [], seen = {};
    ((mem && mem.facts) || []).forEach(function (f) {
      var t = String(f || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      var k = t.toLowerCase();
      if (t && !seen[k] && facts.length < 12) { seen[k] = true; facts.push(t); }
    });
    if (!summary && !facts.length) return run;
    run.memory = { summary: summary, facts: facts };
    run.memAt = run.turn || 0;
    return run;
  }

  /** What the referee may know about a PRESENT npc's secrets. The hint is
   *  observable and flows while the npc is present; the truth is gated
   *  behind the entity's secretUnlock ({quest} or {stat:{id,min}}) and
   *  marked, so the referee knows the player may discover it now. No
   *  secretUnlock: hint only, truth locked to clever play. */
  function secretLines(world, run, n) {
    var list = n.secrets;
    if (!list) return [];
    if (typeof list === 'string') list = list.trim() ? [{ label: '', hint: list, truth: '' }] : [];
    if (!Array.isArray(list)) return [];
    var unlock = n.secretUnlock || null;
    var revealed = !!unlock && (
      (unlock.quest && questReached(run, unlock.quest)) ||
      (unlock.stat && run.stats[unlock.stat.id] !== undefined &&
       run.stats[unlock.stat.id] >= unlock.stat.min)
    );
    var lines = [];
    list.forEach(function (s) {
      if (!s) return;
      if (typeof s === 'string') s = { label: '', hint: s, truth: '' };
      var label = s.label ? ' (\u201C' + s.label + '\u201D)' : '';
      if (revealed && s.truth) {
        lines.push('The secret' + label + ' of ' + n.name +
          ' is revealed to the player: ' + s.truth);
      } else if (s.hint) {
        lines.push(n.name + ' keeps a secret' + label + ': ' + s.hint +
          (s.truth ? ' Do not reveal the truth; it may only surface if the player earns it.' : ''));
      }
    });
    return lines;
  }

  function relationshipsFor(world, entityId) {
    return (world.relationships || []).filter(function (r) {
      return r.a === entityId || r.b === entityId;
    });
  }

  /* ---------------- the world's pulse (v1.33.0) ---------------- */

  /** Turns between world beats; 0 = the world has no agent and does not
   *  tick. An agent that only says `intervalTurns` ticks by default
   *  (enabled is opt-out, matching the spec's {enabled:true} style). */
  function pulseInterval(world) {
    var a = world && world.worldAgent;
    if (!a || a.enabled === false) return 0;
    return (typeof a.intervalTurns === 'number' && a.intervalTurns > 0)
      ? Math.round(a.intervalTurns) : 15;
  }

  /** A beat lands exactly on multiples of the interval (turn counts up on
   *  commit), so each prompt builds the same beat whether asked once or
   *  many times - buildPrompt stays pure. */
  function pulseDue(world, run) {
    var iv = pulseInterval(world);
    return iv > 0 && (run.turn || 0) > 0 && run.turn % iv === 0;
  }

  /** How far along a goal program is: one step per beat that has landed,
   *  pinned on the final step afterwards (a program past its last step
   *  idles there - the deterministic world does not invent endings). */
  function goalStepIndex(world, run, prog) {
    var iv = pulseInterval(world);
    if (!iv) return 0;
    var beats = Math.floor((run.turn || 0) / iv);
    return Math.min(beats, prog.steps.length - 1);
  }

  /** The standing "the world is working toward" line: the first program's
   *  current step. Returns '' when the world has no goal programs. */
  function goalAhead(world, run) {
    var progs = (world && world.goalPrograms) || [];
    if (!progs.length) return '';
    var p = progs[0];
    return 'The world is working toward: ' + p.name +
      ' - now: "' + p.steps[goalStepIndex(world, run, p)] + '".';
  }

  /** The beat text for a pulse turn: what moved off-screen. Goal programs
   *  when the world has them; otherwise the factions' own goals, rotating
   *  one per beat so each breath says something different. */
  function worldBeat(world, run) {
    if (!pulseInterval(world)) return '';
    var beats = Math.floor((run.turn || 0) / pulseInterval(world));
    if (!beats) return '';   /* no beat has landed yet - the run just began */
    var progs = (world.goalPrograms || []);
    if (progs.length) {
      return progs.slice(0, 2).map(function (g) {
        return g.name + (g.actor ? ' (' + g.actor + ')' : '') +
          ' is at "' + g.steps[goalStepIndex(world, run, g)] + '"';
      }).join(' · ') + '.';
    }
    var fs = (world.factions || []).filter(function (f) { return f && f.goal; });
    if (!fs.length) return '';
    var f = fs[(beats - 1 + fs.length) % fs.length];
    return f.name + ' is still working to: ' + f.goal + '.';
  }

  /* ---------------- dice ---------------- */

  /* The world's dice are reproducible within a run: a seeded PRNG (mulberry32)
   * stored on the run, so the same seed and the same order of rolls always
   * give the same outcomes. Old runs without a seed start from a constant. */
  function imul32(a, b) {
    var ah = (a & 0xffff0000) | 0, al = (a & 0xffff) | 0;
    var bh = (b & 0xffff0000) | 0, bl = (b & 0xffff) | 0;
    return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  }
  function nextRand(run) {
    if (run.seed === undefined || run.seed === null) run.seed = 0x12345678;
    var t = (run.seed = (run.seed + 0x6D2B79F5) | 0);
    t = imul32(t ^ (t >>> 15), t | 1);
    t = (t ^ (t >>> 7)) + imul32(t ^ (t >>> 14), t | 61) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** "2d6+3", "1d20-1", "d20" -> { total, rolls, text }. rnd() supplies the
   *  randomness (Math.random by default; the world path passes the run's
   *  seeded generator). */
  function roll(spec, defaultSides, rnd) {
    rnd = rnd || Math.random;
    var m = /^\s*(?:(\d*)\s*)d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(spec || ''));
    if (!m) return null;
    var count = m[1] === '' || m[1] === undefined ? 1 : parseInt(m[1], 10);
    var sides = parseInt(m[2], 10) || defaultSides || 20;
    var sign = m[3] || '+';
    var mod = m[4] ? parseInt(m[4], 10) : 0;
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;

    var rolls = [], total = 0;
    for (var i = 0; i < count; i++) {
      var r = 1 + Math.floor(rnd() * sides);
      rolls.push(r);
      total += r;
    }
    if (sign === '-') total -= mod; else total += mod;
    return {
      total: total, rolls: rolls, sides: sides, count: count,
      modifier: sign === '-' ? -mod : mod,
      text: count + 'd' + sides + (mod ? (sign === '-' ? '-' : '+') + mod : '') +
            ' → ' + (rolls.length > 1 ? '[' + rolls.join(', ') + '] ' : '') + total
    };
  }

  /* ---------------- checks (v1.18.0) ---------------- */

  /** "1d20:check:DEX" -> { spec, name }; a plain roll spec -> null. */
  function parseCheckRequest(arg) {
    var m = /^([^:]*?)\s*:\s*check\s*:\s*(.+)$/i.exec(String(arg || ''));
    if (!m || !m[1].trim()) return null;
    return { spec: m[1].trim(), name: m[2].trim() };
  }

  /** The world's check definition for a name (case-insensitive, by name or
   *  stat). Worlds declare checks in gameRules.checks; nothing here comes
   *  from the model. */
  function checkDef(world, name) {
    var checks = (world && world.gameRules && world.gameRules.checks) || [];
    var low = String(name || '').toLowerCase();
    for (var i = 0; i < checks.length; i++) {
      var c = checks[i] || {};
      if (String(c.name || '').toLowerCase() === low ||
          String(c.stat || '').toLowerCase() === low) return c;
    }
    return null;
  }

  /* ---------------- the world's own dice table (v1.34.0) ---------------- */

  /** The DC a check falls back to when it does not declare its own - the
   *  world's table rule, then the house ten. */
  function defaultDifficulty(world) {
    var d = ((world && world.gameRules) || {}).dice || {};
    return (typeof d.defaultDifficulty === 'number' && d.defaultDifficulty > 0)
      ? d.defaultDifficulty : 10;
  }

  /** modifierMode "per_stat": a named check attached to a stat inherits the
   *  stat's authored fixedModifier from the sheet (roll.fixedModifier).
   *  Anything livelier (normalized curves) stays the author's job - only
   *  numbers the world actually wrote reach the dice. */
  function statRollMod(world, run, def) {
    var d = ((world && world.gameRules) || {}).dice || {};
    if (d.modifierMode !== 'per_stat' || !def || !def.stat) return 0;
    var st = ((world.hudConfig || {}).stats || []).filter(function (s) {
      return s.id === def.stat;
    })[0];
    var mod = st && st.roll && typeof st.roll.fixedModifier === 'number'
      ? st.roll.fixedModifier : 0;
    return Math.round(mod) || 0;
  }

  /** criticals: every die showing its max is a critical success, every die
   *  showing a one a critical failure - only at tables that opted in
   *  (dice.criticals). Returns 'crit' | 'fumble' | ''. Extremes override
   *  the DC both ways; the text says what the table saw. */
  function criticalOutcome(world, r) {
    var d = ((world && world.gameRules) || {}).dice || {};
    if (d.criticals !== true || !r || !r.rolls || !r.rolls.length) return '';
    var allMax = true, allMin = true;
    r.rolls.forEach(function (v) {
      if (v !== r.sides) allMax = false;
      if (v !== 1) allMin = false;
    });
    return allMax ? 'crit' : (allMin ? 'fumble' : '');
  }

  /* ---------------- health: the one stat whose zero means something (v1.34.0) */

  /** The vital stat exists only when the world opts the health module in
   *  AND names it - half-declared health is decor, not a heart. */
  function vitalStat(world) {
    var gr = (world && world.gameRules) || {};
    if (!(gr.modules || {}).health || !gr.vitalStatId) return null;
    return gr.vitalStatId;
  }

  /** Keep the downed flag honest after any movement of the vital stat:
   *  at zero you drop; back above it you are on your feet again.
   *  zeroHpMode "fail_forward" means the story continues from here -
   *  consequences, not a credits roll (that is the only mode we assert). */
  function syncDowned(world, run, changes) {
    var vs = vitalStat(world);
    if (!vs || run.stats[vs] === undefined) return;
    if (run.stats[vs] <= 0 && !run.downed) {
      run.downed = true;
      if (changes) changes.push('downed');
    } else if (run.stats[vs] > 0 && run.downed) {
      run.downed = false;
      if (changes) changes.push('back on their feet');
    }
  }

  /* ---------------- equipment: carried vs worn (v1.35.0) ---------------- */

  /** The world's equipment slots, in declared order, or [] when the
   *  equipment module is off. `equipment` may be an array of slot names
   *  or {slots:[...]}; half-written shapes quiet down to nothing. */
  function equipmentSlots(world) {
    var gr = (world && world.gameRules) || {};
    if (!((gr.modules || {}).equipment)) return [];
    var eq = gr.equipment;
    var raw = Array.isArray(eq) ? eq : (eq && Array.isArray(eq.slots) ? eq.slots : []);
    var out = [], seen = {};
    raw.forEach(function (s) {
      var name = String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (name && !seen[name]) { seen[name] = true; out.push(name); }
    });
    return out;
  }

  /** Carry an equipped item back to the pockets (deduped, case-insensitive). */
  function stow(run, item) {
    if (!run.inventory.some(function (x) { return String(x).toLowerCase() === item.toLowerCase(); })) {
      run.inventory.push(item);
    }
  }

  /** Parse a world-authored branch into the typed vocabulary the engine
   *  applies: stats {id:delta}, cash, items [names], quests [texts],
   *  clock minutes. Anything else is ignored - this is author data, not
   *  model output. */
  function parseBranchEffects(world, branch) {
    var stats = {}, cash = 0, items = [], quests = [], clock = 0;
    if (branch && typeof branch === 'object') {
      if (branch.stats && typeof branch.stats === 'object') {
        Object.keys(branch.stats).forEach(function (sid) {
          var d = branch.stats[sid];
          if (typeof d === 'number' && !isNaN(d)) stats[sid] = d;
        });
      }
      if (typeof branch.cash === 'number' && !isNaN(branch.cash)) cash = branch.cash;
      (branch.items || []).forEach(function (it) {
        var name = String((it && (it.name || it)) || '').trim();
        if (name) items.push(name);
      });
      (branch.quests || []).forEach(function (q) {
        var t = String((q && (q.text || q.name)) || q || '').trim();
        if (t) quests.push(t);
      });
      if (typeof branch.clock === 'number' && !isNaN(branch.clock)) clock = branch.clock;
    }
    return { stats: stats, cash: cash, items: items, quests: quests, clock: clock };
  }

  function effectSummary(world, eff) {
    var out = [];
    Object.keys(eff.stats).forEach(function (sid) {
      var d = eff.stats[sid];
      out.push(sid + ' ' + (d >= 0 ? '+' : '') + d);
    });
    if (eff.cash) out.push((eff.cash >= 0 ? '+' : '') + eff.cash + ' ' +
      (((world.gameRules || {}).currencyName) || 'cash'));
    eff.items.forEach(function (name) { out.push('gained ' + name); });
    eff.quests.forEach(function (t) { out.push('task: ' + t); });
    if (eff.clock) out.push(eff.clock + ' minutes');
    return out;
  }

  /** Apply a resolved check's branch to the run. The model proposed the
   *  check; the world decides the outcome and what it costs. */
  function applyCheckEffects(run, world, branch) {
    var eff = parseBranchEffects(world, branch);
    Object.keys(eff.stats).forEach(function (sid) {
      if (run.stats[sid] === undefined) run.stats[sid] = 0;
      run.stats[sid] += eff.stats[sid];
    });
    if (eff.cash) run.stats[run.cashId] = (run.stats[run.cashId] || 0) + eff.cash;
    eff.items.forEach(function (name) {
      if (!run.inventory.some(function (x) { return String(x).toLowerCase() === name.toLowerCase(); })) {
        run.inventory.push(name);
      }
    });
    eff.quests.forEach(function (t) {
      if (!run.quests.some(function (o) { return o.text === t && !o.done; })) {
        run.quests.push({ text: t, done: false });
      }
    });
    if (eff.clock) run.extraMinutes = (run.extraMinutes || 0) + eff.clock;
    return effectSummary(world, eff);
  }

  /** Resolve the checks the final reply of a turn requested. Runs once per
   *  turn, AFTER commit, so a repaired turn rolls its checks exactly once
   *  and the verdict lands in the log right after the referee's reply.
   *  Mutates the run (dice seed, branch effects, one 'check' log entry per
   *  check). A request whose name the world does not know still shows its
   *  dice but is reported as a rejection. */
  function resolveChecks(world, run, applied) {
    var list = [], changes = [], rejections = [];
    var reqs = (applied && applied.checkRequests) || [];
    var seen = {};
    reqs.forEach(function (req) {
      if (seen[req.name.toLowerCase()]) return;   /* one resolution per check per turn */
      seen[req.name.toLowerCase()] = true;
      var tag = '[[roll:' + req.spec + ':check:' + req.name + ']]';
      var r = roll(req.spec, (world.gameRules || {}).dice && (world.gameRules.dice.sides || 20),
        function () { return nextRand(run); });
      if (!r) {
        rejections.push({ tag: tag, reason: 'malformed roll \u201C' + req.spec + '\u201D', at: Date.now() });
        return;
      }
      var def = checkDef(world, req.name);
      if (!def) {
        changes.push(r.text);
        rejections.push({ tag: tag, reason: 'the world has no check named \u201C' + req.name + '\u201D', at: Date.now() });
        return;
      }
      /* v1.34.0: the check runs at the world's table - its fallback DC, its
         per-stat modifier, its criticals. The referee proposed; the table
         decides. */
      var dc = (typeof def.dc === 'number') ? def.dc : defaultDifficulty(world);
      var mod = statRollMod(world, run, def);
      var total = r.total + mod;
      var crit = criticalOutcome(world, r);
      var success = crit === 'crit' ? true : (crit === 'fumble' ? false : total >= dc);
      var eff = applyCheckEffects(run, world, success ? def.on_success : def.on_failure);
      var modTxt = mod ? (mod >= 0 ? ' +' : ' ') + mod + ' (' + def.stat + ')' : '';
      var critTxt = crit === 'crit' ? ' natural ' + r.sides + ' \u2014 critical!'
        : (crit === 'fumble' ? ' natural 1 \u2014 critical fumble' : '');
      var label = String(def.name || def.stat || req.name);
      var line = label + ' check: ' + r.text + modTxt + ' vs DC ' + dc + critTxt +
        (success ? ' \u2014 success' : ' \u2014 failure') + (eff.length ? ' (' + eff.join('; ') + ')' : '');
      run.log.push({ role: 'check', content: line, at: Date.now() });
      if (run.log.length > 200) run.log = run.log.slice(-200);
      list.push({
        name: label, text: line, chip: label + ' ' + total + ' vs ' + dc + (success ? ' \u2713' : ' \u2717'),
        success: success, total: total, dc: dc
      });
      changes.push(list[list.length - 1].chip);
      syncDowned(world, run, changes);
    });
    return { list: list, changes: changes, rejections: rejections };
  }

  /* ---------------- runs ---------------- */

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function clockOf(run, hud) {
    var step = (hud && hud.timeStep) || 5;
    var start = ((hud && hud.startTimeHours) || 8) * 60 + ((hud && hud.startTimeMinutes) || 0);
    var total = start + (run.turn || 0) * step + (run.extraMinutes || 0);
    var days = Math.floor(total / 1440);
    var minutes = ((total % 1440) + 1440) % 1440;
    var startDay = WEEKDAYS.indexOf((hud && hud.startWeekday) || 'Monday');
    if (startDay < 0) startDay = 1;
    return {
      day: days + 1,
      weekday: WEEKDAYS[(startDay + days) % 7],
      minutes: minutes,
      hh: Math.floor(minutes / 60),
      mm: minutes % 60,
      text: WEEKDAYS[(startDay + days) % 7] + ' ' +
            String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
            String(minutes % 60).padStart(2, '0')
    };
  }

  /** Begin a playthrough. lifeId is the starting role, if the world offers any. */
  function start(world, lifeId) {
    var hud = world.hudConfig || {};
    var life = null;
    if (lifeId) {
      (world.startingLives || []).forEach(function (l) { if (l.id === lifeId) life = l; });
    } else if ((world.startingLives || []).length === 1) {
      life = world.startingLives[0];
    }

    var stats = {};
    (hud.stats || []).forEach(function (s) { stats[s.id] = s.value; });
    /* v1.32.0: the chosen life's own numbers sit on top of the sheet
       defaults, clamped to each stat's bounds; overrides naming stats the
       sheet never declared ride along as raw values. */
    if (life && life.statOverrides) {
      Object.keys(life.statOverrides).forEach(function (k) {
        var v = Number(life.statOverrides[k]);
        if (isNaN(v)) return;
        var decl = null;
        (hud.stats || []).forEach(function (s) { if (s.id === k) decl = s; });
        if (decl) {
          if (typeof decl.min === 'number') v = Math.max(decl.min, v);
          /* world files use max: 0 for "no cap" (cash has no ceiling) -
             honor it as unbounded, not as a cap of zero */
          if (typeof decl.max === 'number' && decl.max > 0) v = Math.min(decl.max, v);
        }
        stats[k] = v;
      });
    }

    var cashId = (world.gameRules || {}).currencyStatId || 'cash';
    if (stats[cashId] === undefined) stats[cashId] = 0;

    /* v1.32.0: a life's obligations (and a world's starting quests) arrive
       as open tasks - the ledger can complete them by name from turn one. */
    var seedList = [];
    if (life && Array.isArray(life.obligations)) seedList = seedList.concat(life.obligations);
    if (Array.isArray(world.startingQuests)) seedList = seedList.concat(world.startingQuests);
    var seenQ = {}, quests = [];
    seedList.forEach(function (t) {
      t = String(t || '').trim();
      if (!t || seenQ[t.toLowerCase()] || quests.length >= 8) return;
      seenQ[t.toLowerCase()] = true;
      quests.push({ text: t, done: false });
    });

    var startAt = (life && life.startLocationId) || world.startLocationId || (world.locations[0] || {}).id;

    return {
      id: 'wr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      worldId: world.id,
      worldName: world.name,
      lifeId: life ? life.id : null,
      lifeName: life ? (life.role || life.name) : null,
      locationId: startAt,
      turn: 0,
      extraMinutes: 0,
      /* v1.18.0: the run's dice seed - reproducible within this run */
      seed: Math.floor(Math.random() * 0x7fffffff),
      stats: stats,
      cashId: cashId,
      inventory: (life && Array.isArray(life.inventory)) ? life.inventory.slice() : [],
      quests: quests,
      /* v1.32.0: who the life says you are - rank and standing for the
         state line, the authored clothes for the referee's eye. */
      identity: (function () {
        if (!life) return '';
        var bits = [life.socialRank, life.legalStatus]
          .map(function (x) { return String(x || '').trim(); }).filter(Boolean);
        return bits.join(' · ');
      })(),
      outfit: (life && life.outfit) ? String(life.outfit) : '',
      /* v1.24.0: the party - NPCs travelling with the player, as the
         referee records them ([[with:NAME]] / [[part:NAME]]). Each entry
         knows where and when they joined, so the prompt can say what they
         have witnessed. */
      companions: [],
      reputation: (life && life.factionReputation !== undefined && life.factionId)
        ? [{ factionId: life.factionId, score: life.factionReputation }] : [],
      log: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /* ---------------- the referee's reply ---------------- */

  var TAG = /\[\[([a-z_-]+)\s*:\s*([^\]]*)\]\]/gi;
  /* v1.24.0: how many NPCs may travel with the player at once. A party this
     big is a story, not a retinue - beyond it the ledger refuses. */
  var COMPA_MAX = 6;

  /* v1.30.4: the with/part grammar line used to carry an inline note -
     "[[with:NAME]] [[part:NAME]] - who is with the player". Models copied
     the note into their replies, either with the tags (the ledger strips
     the [[...]] spans, leaving the bare words) or alone. The copy is
     neither a tag nor a planning line, so nothing removed it and it
     surfaced in the story turn after turn. Drop the note wherever it
     stands as a line of its own; a player line or genuine prose is never
     touched. */
  var TAG_ARTIFACT = /^[-–—*:·(]?\s*who\s+is\s+with\s+the\s+player[.!?…)\]]*$/i;
  function stripTagArtifacts(text) {
    var t = String(text || '');
    if (t.toLowerCase().indexOf('who is with the player') === -1) return text;
    return t.split('\n').filter(function (line) {
      return !TAG_ARTIFACT.test(line.trim());
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------------- ledger v2 (validation) ---------------- */

  /** v1.17.0: a world validates its referee's tags instead of trusting them.
   *  A world file may opt out with "ledgerV2": false; everything else
   *  (AI-created, imported, bundled) is validated. */
  function ledgerV2(world) { return !!(world && world.ledgerV2 !== false); }

  /** Can the run's current place reach the target in one move? When the
   *  current place defines no exits at all, connectivity is unspecified and
   *  we stay lenient (the old behaviour for sketchy maps). */
  function reachable(world, run, target) {
    var cur = location(world, run.locationId);
    if (!cur || target.id === cur.id) return true;
    var ex = exits(world, cur.id).filter(function (e) { return e.to; });
    if (!ex.length) return true;
    return ex.some(function (e) { return e.to === target.id; });
  }

  /** How far one stat (or the purse) may move in a single turn. */
  function statBound(world) {
    var b = (world.gameRules || {}).statBound;
    return (typeof b === 'number' && b > 0) ? b : 100;
  }

  /** Item names a world declares. null = the world declares no item list,
   *  in which case item tags stay free-form, as before. */
  function itemNames(world) {
    if (!world || !Array.isArray(world.items)) return null;
    var names = {};
    world.items.forEach(function (it) {
      var n = String((it && (it.name || it.id)) || '').toLowerCase();
      if (n) names[n] = it.name || it.id;
    });
    return names;
  }

  /** Tasks a world declares, if it declares any. null = free-form tasks. */
  function questRegistry(world) {
    if (!world || !Array.isArray(world.quests)) return null;
    return world.quests;
  }

  function questText(q) { return String((q && (q.text || q.name)) || q || '').trim(); }

  /**
   * Apply the tags at the end of a referee reply.
   * Returns { text, changes, moved, rolled, rejections } - text has the
   * tags removed. On a v2 world, a tag the world cannot honour is not
   * applied: it is dropped from the text and reported in rejections with a
   * reason the referee can be shown.
   */
  function applyTags(world, run, text) {
    var changes = [], rejections = [], checkRequests = [];
    var moved = null, rolled = null;
    var v2 = ledgerV2(world);
    function reject(tag, reason) {
      rejections.push({ tag: tag, reason: reason, at: Date.now() });
    }

    var out = String(text || '').replace(TAG, function (whole, kind, arg) {
      kind = String(kind || '').toLowerCase().trim();
      arg = String(arg || '').trim();
      var num = parseFloat(arg);

      if (kind === 'move') {
        var target = location(world, arg);
        if (!target) {
          /* match on the name the referee wrote instead of the id */
          var lower = arg.toLowerCase();
          (world.locations || []).forEach(function (l) {
            if (!target && String(l.name).toLowerCase() === lower) target = l;
          });
        }
        if (!target) {
          if (v2) reject(whole, 'no such place as \u201C' + arg + '\u201D');
          return '';
        }
        /* v1.28.1: a model tagging a move to where the player already is
           changes nothing - not a chip, not a log line. */
        if (target.id === run.locationId) return '';
        if (v2 && !reachable(world, run, target)) {
          var from = location(world, run.locationId);
          reject(whole, 'cannot get from ' + (from ? from.name : 'here') +
            ' to ' + target.name + ' in one move');
          return '';
        }
        moved = target; run.locationId = target.id; changes.push('moved to ' + target.name);
        return '';
      }
      if (kind === 'clock') {
        if (isNaN(num)) { if (v2) reject(whole, 'minutes must be a number'); return ''; }
        /* v1.28.1: zero is not a change */
        if (num === 0) return '';
        run.extraMinutes = (run.extraMinutes || 0) + num;
        changes.push(num + ' minutes pass');
        return '';
      }
      if (kind === 'cash') {
        if (isNaN(num)) { if (v2) reject(whole, 'the amount must be a number'); return ''; }
        if (v2 && Math.abs(num) > statBound(world)) {
          reject(whole, 'a change of ' + num + ' is beyond \u00B1' + statBound(world) + ' in one turn');
          return '';
        }
        /* v1.28.1: zero is not a change */
        if (num === 0) return '';
        run.stats[run.cashId] = (run.stats[run.cashId] || 0) + num;
        changes.push((num >= 0 ? '+' : '') + num + ' ' + ((world.gameRules || {}).currencyName || 'cash'));
        return '';
      }
      if (kind === 'stat') {
        var bits = arg.split(':');
        if (bits.length < 2) { if (v2) reject(whole, 'expected STAT:+NUMBER'); return ''; }
        var sid = bits[0].trim(), delta = parseFloat(bits[1]);
        if (isNaN(delta)) { if (v2) reject(whole, 'a stat change must end in a number'); return ''; }
        /* v1.28.1: zero is not a change, and a stat id the world never
           declared is not a change either. Worlds that declare no stats
           at all stay free-form, as before. */
        if (delta === 0) return '';
        var declared = (world.hudConfig || {}).stats || [];
        if (declared.length && !declared.some(function (s) { return s.id === sid; })) return '';
        if (v2 && Math.abs(delta) > statBound(world)) {
          reject(whole, 'a change of ' + delta + ' is beyond \u00B1' + statBound(world) + ' in one turn');
          return '';
        }
        if (run.stats[sid] === undefined) run.stats[sid] = 0;
        run.stats[sid] = run.stats[sid] + delta;
        changes.push(sid + ' ' + (delta >= 0 ? '+' : '') + delta);
        return '';
      }
      if (kind === 'item') {
        if (!arg) { if (v2) reject(whole, 'name the item'); return ''; }
        if (v2) {
          var reg = itemNames(world);
          if (reg) {
            var have = run.inventory.some(function (x) {
              return String(x).toLowerCase() === arg.toLowerCase();
            });
            if (have) { reject(whole, 'already carrying ' + arg); return ''; }
            var canonical = reg[arg.toLowerCase()];
            if (!canonical) { reject(whole, 'the world has no item named \u201C' + arg + '\u201D'); return ''; }
            run.inventory.push(canonical);
            changes.push('picked up ' + canonical);
            return '';
          }
        }
        /* v1.27.1: a world without an item registry used to push blindly,
           so every turn that mentioned the item again grew another copy
           in the pockets. */
        if (!run.inventory.some(function (x) {
          return String(x).toLowerCase() === String(arg).toLowerCase();
        })) run.inventory.push(arg);
        changes.push('picked up ' + arg);
        return '';
      }
      if (kind === 'drop') {
        var i = run.inventory.indexOf(arg);
        if (i === -1) {
          var low = arg.toLowerCase();
          i = run.inventory.findIndex ? run.inventory.findIndex(function (x) {
            return String(x).toLowerCase() === low;
          }) : -1;
        }
        if (i === -1) { if (v2) reject(whole, 'not carrying \u201C' + arg + '\u201D'); return ''; }
        run.inventory.splice(i, 1);
        changes.push('lost ' + arg);
        return '';
      }
      if (kind === 'quest') {
        if (!arg) { if (v2) reject(whole, 'name the task'); return ''; }
        if (v2) {
          var regQ = questRegistry(world);
          if (regQ) {
            var known = regQ.some(function (q) {
              return questText(q).toLowerCase() === arg.toLowerCase();
            });
            if (!known) { reject(whole, 'the world has no such task'); return ''; }
          }
        }
        if (!run.quests.some(function (q) { return q.text === arg && !q.done; })) {
          run.quests.push({ text: arg, done: false });
          changes.push('quest: ' + arg);
        }
        return '';
      }
      if ((kind === 'quest-done' || kind === 'questdone') && arg) {
        var done = false;
        run.quests.forEach(function (q) {
          if (!q.done && String(q.text).toLowerCase().indexOf(arg.toLowerCase()) !== -1) {
            q.done = true; done = true;
          }
        });
        if (done) changes.push('completed: ' + arg);
        else if (v2) reject(whole, 'no open task matches \u201C' + arg + '\u201D');
        return '';
      }
      /* v1.33.0: standing has consequences - [[rep:FACTION:+N]] moves the
         player's score with a faction (by id or name; a name with colons
         still parses, the number is always last). Zero is not a change;
         a faction the world never declared is not a change either. The
         score itself is clamped to ±100 - a reputation is a ledger, not
         a runaway integer. */
      if (kind === 'rep' || kind === 'reputation') {
        var rbits = arg.split(':');
        if (rbits.length < 2) { if (v2) reject(whole, 'expected REP:FACTION:+N'); return ''; }
        var rref = rbits.slice(0, -1).join(':').trim();
        var rdelta = parseFloat(rbits[rbits.length - 1]);
        if (isNaN(rdelta)) { if (v2) reject(whole, 'a standing change must end in a number'); return ''; }
        if (rdelta === 0) return '';
        var rf = faction(world, rref);
        if (!rf) {
          var rlow = rref.toLowerCase();
          (world.factions || []).forEach(function (f) {
            if (!rf && String(f.name).toLowerCase() === rlow) rf = f;
          });
        }
        if (!rf) { if (v2) reject(whole, 'no such faction as \u201C' + rref + '\u201D'); return ''; }
        if (v2 && Math.abs(rdelta) > statBound(world)) {
          reject(whole, 'a change of ' + rdelta + ' is beyond \u00B1' + statBound(world) + ' in one turn');
          return '';
        }
        if (!run.reputation) run.reputation = [];
        var rent = run.reputation.filter(function (r) { return r.factionId === rf.id; })[0];
        if (!rent) { rent = { factionId: rf.id, score: 0 }; run.reputation.push(rent); }
        rent.score = Math.max(-100, Math.min(100, (rent.score || 0) + rdelta));
        changes.push('standing with ' + rf.name + ' ' + (rdelta >= 0 ? '+' : '') + rdelta);
        return '';
      }
      /* v1.34.0: conditions - the world's named states on the player.
         [[condition:NAME]] names one (idempotent), [[clear:NAME]] lifts it
         (names match case-insensitively). Only at tables that switched the
         module on; elsewhere the tag is refused, not dropped. */
      if (kind === 'condition' || kind === 'cond') {
        if (!(((world.gameRules || {}).modules || {}).conditions)) {
          if (v2) reject(whole, 'conditions are off in this world');
          return '';
        }
        var cnew = arg.replace(/\s+/g, ' ').trim();
        if (!cnew) { if (v2) reject(whole, 'name the condition'); return ''; }
        if (!run.conditions) run.conditions = [];
        if (!run.conditions.some(function (c) { return c.toLowerCase() === cnew.toLowerCase(); })) {
          run.conditions.push(cnew);
          changes.push('condition: ' + cnew);
        }
        return '';
      }
      if (kind === 'clear' || kind === 'cond-clear' || kind === 'clear-condition' || kind === 'condition-clear') {
        if (!(((world.gameRules || {}).modules || {}).conditions)) {
          if (v2) reject(whole, 'conditions are off in this world');
          return '';
        }
        var clow = arg.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!clow) { if (v2) reject(whole, 'name the condition to lift'); return ''; }
        var cidx = -1;
        (run.conditions || []).forEach(function (c, i) {
          if (cidx === -1 && c.toLowerCase() === clow) cidx = i;
        });
        if (cidx === -1) { if (v2) reject(whole, 'no such condition as \u201C' + arg + '\u201D'); return ''; }
        changes.push('condition lifts: ' + run.conditions[cidx]);
        run.conditions.splice(cidx, 1);
        return '';
      }
      /* v1.35.0: equipment - [[equip:SLOT:ITEM]] moves a carried thing into
         the world's named slot; [[unequip:SLOT]] stows it. With exactly one
         slot the slot may be omitted. Governing item is the thing in the
         pockets, so equipping something you do not carry is refused. */
      if (kind === 'equip' || kind === 'unequip') {
        var slots = equipmentSlots(world);
        if (!slots.length) {
          if (v2) reject(whole, 'equipment is off in this world');
          return '';
        }
        if (!run.equip || typeof run.equip !== 'object') run.equip = {};
        if (kind === 'unequip') {
          var uslot = arg.replace(/\s+/g, ' ').trim().toLowerCase();
          if (slots.length === 1 && !uslot) uslot = slots[0];
          if (slots.indexOf(uslot) === -1) {
            if (v2) reject(whole, 'no such slot as \u201C' + arg + '\u201D');
            return '';
          }
          var old = run.equip[uslot];
          if (!old) { if (v2) reject(whole, 'nothing in the \u201C' + uslot + '\u201D slot'); return ''; }
          delete run.equip[uslot];
          stow(run, old);
          changes.push('stowed ' + old);
          return '';
        }
        var ebits = arg.indexOf(':') !== -1 ? [arg.slice(0, arg.indexOf(':')), arg.slice(arg.indexOf(':') + 1)] :
          (slots.length === 1 ? [slots[0], arg] : [null, arg]);
        var eslot = String(ebits[0] || '').replace(/\s+/g, ' ').trim().toLowerCase();
        var eitem = String(ebits[1] || '').replace(/\s+/g, ' ').trim();
        if (slots.indexOf(eslot) === -1) {
          if (v2) reject(whole, 'name the slot - this world wears things: ' + slots.join(', '));
          return '';
        }
        if (!eitem) { if (v2) reject(whole, 'equip WHAT into the \u201C' + eslot + '\u201D slot?'); return ''; }
        var ei = -1;
        run.inventory.forEach(function (x, i) {
          if (ei === -1 && String(x).toLowerCase() === eitem.toLowerCase()) ei = i;
        });
        if (ei === -1) { if (v2) reject(whole, 'not carrying \u201C' + eitem + '\u201D'); return ''; }
        var canon = run.inventory[ei];
        run.inventory.splice(ei, 1);
        var prev = run.equip[eslot];
        if (prev) stow(run, prev);
        run.equip[eslot] = canon;
        changes.push(prev ? ('swapped ' + prev + ' for ' + canon + ' (' + eslot + ')')
                          : ('equipped ' + canon + ' (' + eslot + ')'));
        return '';
      }
      if (kind === 'with') {
        /* v1.24.0: an NPC joins the player. Names are matched against the
           world's cast (case-insensitive, canonical spelling stored); one
           name per tag, comma lists split. */
        run.companions = run.companions || [];
        var names = String(arg).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
        if (!names.length) { if (v2) reject(whole, 'name who is with the player'); return ''; }
        names.forEach(function (nm) {
          var known = npcNames(world).filter(function (n) {
            return n.toLowerCase() === nm.toLowerCase();
          })[0];
          if (!known) {
            if (v2) {
              var cast = npcNames(world);
              reject(whole, 'no one named \u201C' + nm + '\u201D in this world' +
                (cast.length ? ' (known: ' + cast.slice(0, 8).join(', ') + (cast.length > 8 ? ' \u2026' : '') + ')' : '') +
                ' - one name per tag');
            }
            return;
          }
          if (run.companions.some(function (c) { return c.name === known; })) {
            if (v2) reject(whole, known + ' is already with the player');
            return;
          }
          if (run.companions.length >= COMPA_MAX) {
            if (v2) reject(whole, 'the party is full (' + COMPA_MAX + ' companions)');
            return;
          }
          run.companions.push({ name: known, since: run.turn || 0, at: run.locationId });
          changes.push(known + ' joins the party');
        });
        return '';
      }
      if (kind === 'part') {
        /* v1.24.0: a companion parts ways with the player. */
        run.companions = run.companions || [];
        String(arg).split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (nm) {
          var known = npcNames(world).filter(function (n) {
            return n.toLowerCase() === nm.toLowerCase();
          })[0];
          var target = known || nm;
          var i = -1;
          if (run.companions.findIndex) {
            i = run.companions.findIndex(function (c) { return c.name === target; });
          } else {
            for (var ci = 0; ci < run.companions.length; ci++) if (run.companions[ci].name === target) { i = ci; break; }
          }
          if (i === -1) { if (v2) reject(whole, target + ' is not with the player'); return; }
          var leaver = run.companions[i];
          run.companions.splice(i, 1);
          changes.push(leaver.name + ' leaves the party');
        });
        return '';
      }
      if (kind === 'roll') {
        /* v1.18.0: "1d20:check:DEX" is a check request - the dice and the
           outcome are resolved by the world (resolveChecks), never by the
           model. On an opted-out world the whole thing is just a roll spec
           that fails to parse, as it always did. */
        var ck = v2 ? parseCheckRequest(arg) : null;
        if (ck) {
          if (!roll(ck.spec, (world.gameRules || {}).dice && (world.gameRules.dice.sides || 20))) {
            reject(whole, 'malformed roll \u201C' + ck.spec + '\u201D');
          } else {
            checkRequests.push({ spec: ck.spec, name: ck.name });
          }
          return '';
        }
        var r = roll(arg, (world.gameRules || {}).dice && (world.gameRules.dice.sides || 20),
          function () { return nextRand(run); });
        if (r) { rolled = r; changes.push(r.text); }
        else if (v2) reject(whole, 'malformed roll \u201C' + arg + '\u201D');
        return '';
      }
      /* v1.29.1: an unknown bracket command is the model's private
         bookkeeping leaking through - refuse it (and keep it out of the
         story) on a validating world. An opted-out world keeps the old
         leniency: the typo stays visible. */
      if (v2) { reject(whole, 'no such bookkeeping as \u201C' + kind + '\u201D'); return ''; }
      return whole;
    });

    /* v1.34.0: whatever the tags did to the vital stat, the sheet's floor
       is checked once, here. */
    syncDowned(world, run, changes);

    return {
      text: stripTagArtifacts(out).replace(/\n{3,}/g, '\n\n').trim(),
      changes: changes, moved: moved, rolled: rolled, rejections: rejections,
      checkRequests: checkRequests
    };
  }

  /* ---------------- the player correcting the ledger ---------------- */

  /** v1.17.0: the player sets the ledger straight by hand. Every corr field
   *  is optional; returns the list of human-readable changes (empty when
   *  nothing was actually changed). The caller records the entry and saves. */
  /** v1.27.1: make a saved run safe to show. Runs saved before the pocket
      dedup may hold duplicate items; opening a world heals them in place
      (first spelling wins). Also guarantees the array shapes the views
      rely on, so a hand-edited or half-written run cannot blank a screen. */
  function normalizeRun(run) {
    if (!run || typeof run !== 'object') return run;
    if (!Array.isArray(run.inventory)) run.inventory = [];
    var seen = {}, out = [];
    run.inventory.forEach(function (x) {
      var k = String(x).toLowerCase();
      if (seen[k]) return;
      seen[k] = true;
      out.push(x);
    });
    run.inventory = out;
    if (!Array.isArray(run.quests)) run.quests = [];
    if (!Array.isArray(run.log)) run.log = [];
    /* v1.30.4: scrub stored replies that predate the artifact cleanup, so
       old runs stop showing the copied note on re-open. Assistant lines
       only - what the player typed stays exactly as typed. */
    run.log.forEach(function (m) {
      if (m && m.role === 'assistant' && typeof m.content === 'string') {
        m.content = stripTagArtifacts(m.content);
      }
    });
    if (!Array.isArray(run.companions)) run.companions = [];
    if (typeof run.stats !== 'object' || run.stats === null) run.stats = {};
    /* v1.34.0: runs written before conditions and health floors existed */
    if (!Array.isArray(run.conditions)) run.conditions = [];
    if (run.downed === undefined) run.downed = false;
    /* v1.35.0: ...or before anything was ever worn */
    if (!run.equip || typeof run.equip !== 'object' || Array.isArray(run.equip)) run.equip = {};
    /* v1.36.0: ...or before the story could remember itself */
    if (!run.memory || typeof run.memory !== 'object' || Array.isArray(run.memory)) {
      run.memory = { summary: '', facts: [] };
    }
    if (!Array.isArray(run.memory.facts)) run.memory.facts = [];
    if (typeof run.memory.summary !== 'string') run.memory.summary = '';
    if (!run.loreFired || typeof run.loreFired !== 'object') run.loreFired = {};
    return run;
  }

  function correctState(world, run, corr) {
    corr = corr || {};
    var changes = [];

    if (corr.locationId) {
      var t = location(world, corr.locationId);
      if (t) { run.locationId = t.id; changes.push('set to ' + t.name); }
    }
    if (corr.cash !== undefined && corr.cash !== null && !isNaN(corr.cash)) {
      run.stats[run.cashId] = corr.cash;
      changes.push('cash set to ' + corr.cash);
    }
    if (corr.stats) {
      Object.keys(corr.stats).forEach(function (sid) {
        var v = corr.stats[sid];
        if (v !== undefined && v !== null && !isNaN(v)) {
          run.stats[sid] = v;
          changes.push(sid + ' set to ' + v);
        }
      });
    }
    if (corr.addInventory) {
      /* v1.27.1: same rule as the referee's tags - no duplicates */
      if (!run.inventory.some(function (x) {
        return String(x).toLowerCase() === String(corr.addInventory).toLowerCase();
      })) run.inventory.push(corr.addInventory);
      changes.push('added ' + corr.addInventory);
    }
    if (corr.removeInventory) {
      var i = run.inventory.indexOf(corr.removeInventory);
      if (i === -1) {
        i = run.inventory.findIndex ? run.inventory.findIndex(function (x) {
          return String(x).toLowerCase() === String(corr.removeInventory).toLowerCase();
        }) : -1;
      }
      if (i !== -1) {
        run.inventory.splice(i, 1);
        changes.push('removed ' + corr.removeInventory);
      }
    }
    if (corr.addCompanion) {
      /* v1.28.0: the party, by hand - the same ledger as the referee's
         [[with:NAME]] tag, reached from the Correct-state screen. Lenient
         about names: a cast member is stored under the canonical spelling,
         and anything else a story actually uses (a projection, a title, a
         nickname) is recorded as written - the referee's own grammar is
         stricter than a player's hand. */
      run.companions = run.companions || [];
      var nm = String(corr.addCompanion).trim();
      if (nm) {
        var known = npcNames(world).filter(function (n) {
          return n.toLowerCase() === nm.toLowerCase();
        })[0] || nm;
        if (run.companions.some(function (c) { return c.name === known; })) {
          changes.push(known + ' is already with the player');
        } else if (run.companions.length >= COMPA_MAX) {
          changes.push(known + ' cannot join - the party is full (' + COMPA_MAX + ')');
        } else {
          run.companions.push({ name: known, since: run.turn || 0, at: run.locationId });
          changes.push(known + ' joins the party');
        }
      }
    }
    if (corr.removeCompanion) {
      run.companions = run.companions || [];
      var nm2 = String(corr.removeCompanion).trim().toLowerCase();
      var i2 = -1;
      run.companions.forEach(function (c, j) {
        if (i2 === -1 && String(c.name).toLowerCase() === nm2) i2 = j;
      });
      if (i2 !== -1) {
        var leaver2 = run.companions.splice(i2, 1)[0];
        changes.push(leaver2.name + ' leaves the party');
      }
    }
    if (corr.addQuest) {
      run.quests.push({ text: corr.addQuest, done: false });
      changes.push('task: ' + corr.addQuest);
    }
    if (corr.doneQuestText) {
      var lowq = String(corr.doneQuestText).toLowerCase();
      run.quests.forEach(function (q) {
        if (!q.done && String(q.text).toLowerCase().indexOf(lowq) !== -1) {
          q.done = true;
          changes.push('completed: ' + q.text);
        }
      });
    }
    /* v1.29.1: a task the ledger never should have gained can actually go.
       The Correct-state screen used to offer only add/done, so a phantom
       task was stuck in the run forever. */
    if (corr.removeQuest) {
      var rmq = String(corr.removeQuest).toLowerCase();
      for (var qi = run.quests.length - 1; qi >= 0; qi--) {
        if (String(run.quests[qi].text).toLowerCase() === rmq) {
          changes.push('removed task: ' + run.quests[qi].text);
          run.quests.splice(qi, 1);
        }
      }
    }
    /* v1.29.1: the clock, by hand - a logged shift in extraMinutes, the
       same field the [[clock:+N]] tag writes, so the shift behaves like
       any other minute. */
    if (corr.clockDelta !== undefined && corr.clockDelta !== null && !isNaN(corr.clockDelta) && corr.clockDelta !== 0) {
      run.extraMinutes = (run.extraMinutes || 0) + corr.clockDelta;
      changes.push('clock: ' + (corr.clockDelta > 0 ? '+' : '') + corr.clockDelta + ' minutes');
    }

    if (changes.length) {
      run.corrections = (run.corrections || []).concat(changes);
      run.updatedAt = Date.now();
    }
    return changes;
  }

  /** v1.20.0: scene discipline. The player's words are a second ledger: a
   *  cheap local pass compares what the player asked for ("I take the key")
   *  with what the referee actually recorded. An action that landed in prose
   *  but not in the tags becomes an advisory note (and may spend the one
   *  repair round) - never a rejection, never a blocked turn. Detection is
   *  pure string work; no model round-trip.
   *
   *  Claims are verb-driven, and only the verbs that promise a ledger
   *  change are audited. Precision beats recall: a move claim fires only
   *  when its target resolves to a real place, a cash claim only when an
   *  amount is stated, and a negated ask ("I refuse to take the key") is
   *  not a claim at all. Returns { advisories: [{ claim, note, kind }] },
   *  capped at three per turn; any internal failure degrades to "none". */

  /* Longest phrases first, so "take on" claims its span before "take" and
   *  "throw away" before "throw". */
  var CLAIM_SCAN = /\b(take on|agree to|throw away|put down|leave behind|take hold of|reach for|pick up|throw|put|drop|take|grab|collect|pocket|snatch|steal|lift|pay|spend|buy|offer|bet|tip|walk|run|head|move|rush|hurry|climb|enter|leave|return|go)\b/gi;
  var CLAIM_KIND = {
    'take on': 'quest', 'agree to': 'quest',
    'throw away': 'drop', 'put down': 'drop', 'leave behind': 'drop',
    'throw': 'drop', 'put': 'drop', 'drop': 'drop',
    'take hold of': 'item', 'reach for': 'item', 'pick up': 'item',
    'take': 'item', 'grab': 'item', 'collect': 'item', 'pocket': 'item',
    'snatch': 'item', 'steal': 'item', 'lift': 'item',
    'pay': 'cash', 'spend': 'cash', 'buy': 'cash', 'offer': 'cash',
    'bet': 'cash', 'tip': 'cash',
    'walk': 'move', 'run': 'move', 'head': 'move', 'move': 'move',
    'rush': 'move', 'hurry': 'move', 'climb': 'move', 'enter': 'move',
    'leave': 'move', 'return': 'move', 'go': 'move'
  };
  /* words that never carry meaning at the start of an object */
  var CLAIM_SKIP = ' the a an my your his her its our this that some few one up out on at in to from off over under towards toward into onto down it them him her you me we they all both ';
  /* a word that ends the object we are capturing */
  var CLAIM_STOP = ' and then while as but so when if until before after with to from in at on off into onto out over under up down ';
  var CLAIM_NEGATION = /\b(not|no|never|won't|wont|can't|cant|cannot|refuse|refuses|refused|avoid|avoiding|deny|denying|denied|dare|daren't)\b/;
  /* phrasal verbs whose particle lands AFTER the object:
     "leave the key behind", "put the key down", "throw the key away" */
  var CLAIM_PARTICLE = { leave: 'behind', put: 'down', throw: 'away' };
  var CLAIM_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

  function claimTokens(s) {
    var out = [], re = /[a-z0-9']+/g, m;
    while ((m = re.exec(s)) !== null) out.push({ w: m[0], s: m.index, e: m.index + m[0].length });
    return out;
  }
  function inSet(set, w) { return set.indexOf(' ' + w + ' ') !== -1; }

  /** Capture the object after a verb (" the brass key," -> "the brass key").
   *  Returns { text, norm, start, end } relative to the slice, or null when
   *  the verb has nothing to act on. */
  function claimObject(afterLow) {
    var toks = claimTokens(afterLow);
    if (toks.length && toks[0].s > 1) return null;   /* punctuation right after the verb */
    var i = 0;
    while (i < toks.length && inSet(CLAIM_SKIP, toks[i].w)) i++;
    if (i >= toks.length) return null;
    var start = toks[i].s, end = start, count = 0;
    for (; i < toks.length; i++) {
      if (count >= 6) break;
      if (inSet(CLAIM_STOP, toks[i].w)) break;
      end = toks[i].e;
      count++;
      /* more than one char of gap means punctuation intervened */
      if (i + 1 < toks.length && toks[i + 1].s - toks[i].e > 1) break;
    }
    var text = afterLow.slice(start, end);
    if (!text.trim()) return null;
    return { text: text, norm: text.replace(/^\s+|\s+$/g, ''), start: start, end: end };
  }

  /** Does this phrase name a real place? The claim may carry extra words
   *  ("the reception desk"), so every prefix of the words is tried against
   *  the location list - and a location may carry the claim's extra words
   *  ("office" inside "Main Office"). */
  function resolvePlace(phrase, world) {
    if (!phrase) return null;
    var locs = (world && world.locations) || [];
    var words = String(phrase).toLowerCase().split(' ').filter(Boolean);
    for (var k = words.length; k >= 1; k--) {
      var p = words.slice(0, k).join(' ');
      for (var j = 0; j < locs.length; j++) {
        var name = String(locs[j].name || '').toLowerCase();
        if (!name) continue;
        if (name === p || p.indexOf(name) !== -1 ||
            (p.length >= 3 && name.indexOf(p) !== -1)) return locs[j];
      }
    }
    return null;
  }

  /** Where a move claim is pointing, if it names a real place. The span ends
   *  at the words that actually matched, so a following sentence never
   *  leaks in. */
  function claimMoveTarget(afterLow, world) {
    var toks = claimTokens(afterLow);
    if (toks.length && toks[0].s > 1) return null;   /* punctuation right after the verb */
    var i = 0;
    while (i < toks.length && inSet(CLAIM_SKIP, toks[i].w)) i++;
    var words = [];
    for (; i < toks.length && words.length < 5; i++) {
      if (inSet(CLAIM_STOP, toks[i].w)) break;
      words.push(toks[i]);
      if (i + 1 < toks.length && toks[i + 1].s - toks[i].e > 1) break;
    }
    if (!words.length) return null;
    for (var k = words.length; k >= 1; k--) {
      var loc = resolvePlace(words.slice(0, k).map(function (t) { return t.w; }).join(' '), world);
      if (loc) return { loc: loc, start: words[0].s, end: words[k - 1].e };
    }
    return null;
  }

  /** The object between a verb and its trailing particle ("leave the key
   *  behind" -> "the key"). Null when the particle never shows up. */
  function claimPhrasal(afterLow, particle) {
    var toks = claimTokens(afterLow);
    if (toks.length && toks[0].s > 1) return null;   /* punctuation right after the verb */
    var i = 0;
    while (i < toks.length && inSet(CLAIM_SKIP, toks[i].w)) i++;
    var j = i;
    while (j < toks.length && j - i < 5) {
      if (j > i && toks[j].s - toks[j - 1].e > 1) return null;   /* sentence boundary */
      if (toks[j].w === particle) break;
      if (inSet(CLAIM_STOP, toks[j].w)) return null;
      j++;
    }
    if (j === i || j >= toks.length || toks[j].w !== particle) return null;
    var text = afterLow.slice(toks[i].s, toks[j].s);
    if (!text.trim()) return null;
    return { text: text, norm: text.replace(/^\s+|\s+$/g, ''), start: toks[i].s, end: toks[j].s };
  }

  /** The amount a cash claim states, if it states one ("pay five" -> 5). */
  function claimAmount(afterLow) {
    var toks = claimTokens(afterLow);
    if (toks.length && toks[0].s > 1) return null;   /* punctuation right after the verb */
    for (var i = 0; i < toks.length && i < 10; i++) {
      if (i > 0 && toks[i].s - toks[i - 1].e > 1) break;   /* sentence boundary */
      var w = toks[i].w;
      if (/^\d+$/.test(w)) return { amt: parseInt(w, 10), end: toks[i].e };
      if (CLAIM_NUMBERS[w]) return { amt: CLAIM_NUMBERS[w], end: toks[i].e };
      if (inSet(CLAIM_STOP, w)) break;
    }
    return null;
  }

  /** Is this object a real, auditable one? "I take the key" counts when the
   *  world knows a Brass key; "I take one step" and "I take on the
   *  challenge" do not. An unauditable object is not a claim at all. */
  function claimVerified(kind, obj, world, run) {
    var words = claimTokens(obj).map(function (t) { return t.w; })
      .filter(function (w) { return !inSet(CLAIM_SKIP, w); });
    if (!words.length) return false;
    var sig = words.filter(function (w) { return w.length > 2; }).length;
    if (kind === 'item') {
      var reg = itemNames(world);
      if (reg) {
        var low = words.join(' ');
        return Object.keys(reg).some(function (k) {
          return k.indexOf(low) !== -1 || low.indexOf(k) !== -1;
        });
      }
      return sig >= 2;
    }
    if (kind === 'drop') {
      var inv = (run && run.inventory) || [];
      if (inv.some(function (x) { return softMatch(obj, String(x)); })) return true;
      if (itemNames(world)) return false;   /* a registry world can only lose what it holds */
      return sig >= 2;
    }
    if (kind === 'quest') {
      var regQ = questRegistry(world);
      if (regQ) return regQ.some(function (q) { return softMatch(obj, questText(q)); });
      return sig >= 2;
    }
    return true;
  }

  /** Loose enough to bridge "the key" and "Brass key", tight enough to keep
   *  "key" from matching "rope". */
  function softMatch(a, b) {
    a = String(a || '').toLowerCase().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    b = String(b || '').toLowerCase().replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
    if (!a || !b) return false;
    if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
    var wa = a.split(' '), wb = b.split(' ');
    var shorter = wa.length <= wb.length ? wa : wb;
    var longer = wa.length <= wb.length ? wb : wa;
    if (!shorter.length) return false;
    return shorter.every(function (x) { return x.length > 1 && longer.indexOf(x) !== -1; });
  }

  function auditClaims(world, run, input, applied) {
    var empty = { advisories: [] };
    try {
      applied = applied || {};
      var raw = String(input || '');
      var inLow = raw.toLowerCase();
      if (!inLow.trim()) return empty;
      var changes = applied.changes || [];
      var out = [];
      CLAIM_SCAN.lastIndex = 0;
      var m;
      while ((m = CLAIM_SCAN.exec(inLow)) !== null) {
        if (out.length >= 3) break;
        var verb = m[1].toLowerCase();
        var kind = CLAIM_KIND[verb];
        if (!kind) continue;
        /* a negated ask is not a claim */
        var before = inLow.slice(Math.max(0, m.index - 30), m.index);
        if (CLAIM_NEGATION.test(before)) continue;
        var after = inLow.slice(m.index + m[0].length);
        var claimText = m[0], note = '', matched = false;
        /* a phrasal verb with the particle behind the object: the object is
           what sits between - unless it names a place, in which case it is a
           move after all ("leave the office behind"). "leave" without its
           particle falls through as a plain move. */
        var ph = null;
        if (CLAIM_PARTICLE[verb]) {
          ph = claimPhrasal(after, CLAIM_PARTICLE[verb]);
          if (!ph && (verb === 'put' || verb === 'throw')) continue;
          var phPlace = ph ? resolvePlace(ph.norm, world) : null;
          if (phPlace) {
            kind = 'move';
            var tgtPh = { loc: phPlace, start: ph.start, end: ph.end };
            claimText = raw.slice(m.index, m.index + m[0].length + tgtPh.end).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
            var movedPh = applied.moved;
            if (movedPh && movedPh.id === tgtPh.loc.id) matched = true;
            else if (movedPh) note = 'the move went to ' + (movedPh.name || tgtPh.loc.name) + ' instead';
            else {
              var herePh = location(world, run.locationId);
              note = 'no move was recorded' + (herePh ? ' \u2014 you are still at ' + herePh.name : '');
            }
            if (!matched) out.push({ claim: claimText, note: note, kind: kind, at: Date.now() });
            continue;
          }
          if (ph) kind = 'drop';
        }
        if (kind === 'item' || kind === 'drop') {
          var obj = (kind === 'drop' && ph) ? ph : claimObject(after);
          if (!obj) continue;
          claimText = raw.slice(m.index, m.index + m[0].length + obj.end).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
          var prefix = kind === 'item' ? 'picked up ' : 'lost ';
          var hit = changes.some(function (c) {
            var t = String(c || '');
            return t.indexOf(prefix) === 0 && softMatch(obj.norm, t.slice(prefix.length));
          });
          if (hit) matched = true;
          else if (claimVerified(kind, obj.norm, world, run)) {
            note = 'no ' + kind + ' tag for \u201C' + obj.norm + '\u201D';
          } else {
            continue;   /* an unauditable object is not a real claim */
          }
        } else if (kind === 'move') {
          var tgt = claimMoveTarget(after, world);
          if (!tgt) continue;
          claimText = raw.slice(m.index, m.index + m[0].length + tgt.end).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
          var moved = applied.moved;
          if (moved && moved.id === tgt.loc.id) matched = true;
          else if (moved) note = 'the move went to ' + (moved.name || tgt.loc.name) + ' instead';
          else {
            var hereNow = location(world, run.locationId);
            note = 'no move was recorded' + (hereNow ? ' \u2014 you are still at ' + hereNow.name : '');
          }
        } else if (kind === 'cash') {
          var amt = claimAmount(after);
          if (!amt) continue;
          claimText = raw.slice(m.index, m.index + m[0].length + amt.end).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
          var spent = changes.some(function (c) {
            var mm = /^-\d+/.exec(String(c || ''));
            return !!mm;
          });
          if (spent) matched = true;
          else note = 'no spend was recorded';
        } else if (kind === 'quest') {
          var qobj = claimObject(after);
          if (!qobj) continue;
          claimText = raw.slice(m.index, m.index + m[0].length + qobj.end).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
          var qhit = changes.some(function (c) {
            var t = String(c || '');
            return t.indexOf('quest: ') === 0 && softMatch(qobj.norm, t.slice(7));
          }) || (run && (run.quests || []).some(function (q) {
            return !q.done && softMatch(qobj.norm, String(q.text || ''));
          }));
          if (qhit) matched = true;
          else if (claimVerified('quest', qobj.norm, world, run)) {
            note = 'no task tag for \u201C' + qobj.norm + '\u201D';
          } else {
            continue;   /* an unauditable object is not a real claim */
          }
        }
        if (!matched) out.push({ claim: claimText, note: note, kind: kind, at: Date.now() });
      }
      return { advisories: out };
    } catch (e) {
      return empty;   /* the audit must never block a turn */
    }
  }

  /* ---------------- the prompt ---------------- */

  function describeLocation(world, run) {
    var l = location(world, run.locationId);
    if (!l) return '';
    var out = ['You are at **' + l.name + '**' + (l.region && l.region !== l.name ? ', ' + l.region : '') + '.'];
    if (l.description) out.push(l.description);
    if (l.hiddenDescription) out.push('(Only the referee knows: ' + l.hiddenDescription + ')');
    /* v1.32.0: authored place texture the format always carried - danger and
       wealth weigh into the scene without inventing thresholds. */
    if (typeof l.danger === 'number' || typeof l.prosperity === 'number') {
      var tex = [];
      if (typeof l.danger === 'number') tex.push('danger ' + l.danger);
      if (typeof l.prosperity === 'number') tex.push('prosperity ' + l.prosperity);
      out.push('(Referee texture: ' + tex.join(', ') + ' of 100.)');
    }

    var ex = exits(world, l.id).filter(function (e) { return e.to; });
    if (ex.length) {
      out.push('From here you can go: ' + ex.map(function (e) {
        return e.label + (e.minutes !== null ? ' (' + e.minutes + ' min)' : '');
      }).join(', ') + '.');
    }
    var clock = clockOf(run, world.hudConfig || {});
    var here = npcsAt(world, l.id, clock);
    if (here.length) {
      out.push('Present: ' + here.map(function (n) {
        return n.name + (n.isMajor ? '' : '');
      }).join(', ') + '.');
      here.forEach(function (n) {
        if (n.persona) {
          /* prompt budget (v1.32.0): a full dossier until the referee has
             actually played them, a synopsis ever after */
          out.push('- ' + n.name + ': ' + (metNpc(run, n) ? synopsis(n.persona, 200) : n.persona));
        }
        if (n.goal) out.push('  ' + n.name + ' wants: ' + n.goal);
        /* v1.32.0: honor the declared schedule - what they should be doing
           right now lets the scene be true to the hour */
        var act = scheduleActiveAt(n, clock);
        if (act && act.activity) out.push('  ' + n.name + ' should be: ' + act.activity);
        /* v1.32.0: the social web around a present NPC - strongest ties
           first, at most three, or the referee writes isolates */
        relationshipsFor(world, n.id)
          .slice()
          .sort(function (a, b) { return Math.abs(b.score || 0) - Math.abs(a.score || 0); })
          .slice(0, 3)
          .forEach(function (r) {
            var label = r.label || r.reason || '';
            if (!label) return;
            var other = entityById(world, r.a === n.id ? r.b : r.a);
            out.push('  ' + n.name + ' ↔ ' + (other ? other.name : '?') + ': ' + label +
              (typeof r.score === 'number' ? ' (' + r.score + ')' : ''));
          });
        secretLines(world, run, n).forEach(function (s) { out.push('  ' + s); });
      });
    }
    return out.join('\n');
  }

  function describeState(world, run) {
    var hud = world.hudConfig || {}, gr = world.gameRules || {};
    var out = [];
    if (hud.showClock !== false) out.push('Time: ' + clockOf(run, hud).text);
    /* v1.32.0: the world's own calendar, and who the player set out to be. */
    var seas = seasonText(world, run);
    if (seas) out.push('Season: ' + seas);
    if (run.identity) out.push('You are: ' + run.identity + '.');

    var statLines = [];
    var vital = vitalStat(world);
    (hud.stats || []).forEach(function (s) {
      var v = run.stats[s.id];
      if (v === undefined) return;
      /* v1.34.0: the vital stat carries its mark into the referee's readout -
         this is the number whose floor matters. */
      statLines.push(s.name + (vital === s.id ? ' ✧' : '') + ' ' + v +
        (s.max !== undefined ? '/' + s.max : ''));
    });
    if (statLines.length) out.push('Stats: ' + statLines.join(', '));

    if ((gr.modules || {}).commerce !== false && run.stats[run.cashId] !== undefined) {
      out.push('Money: ' + run.stats[run.cashId] + ' ' + (gr.currencyName || 'cash'));
    }
    if ((gr.modules || {}).inventory !== false && run.inventory.length) {
      out.push('Carrying: ' + run.inventory.join(', '));
    }
    /* v1.32.0: the life's own clothes, as authored - so the referee dresses
       the player like their role, not like a blank. */
    if ((gr.modules || {}).inventory !== false && run.outfit) {
      out.push('Wearing: ' + run.outfit);
    }
    if ((gr.modules || {}).quests !== false) {
      var open = run.quests.filter(function (q) { return !q.done; });
      if (open.length) out.push('Tasks: ' + open.map(function (q) { return q.text; }).join('; '));
    }
    /* v1.35.0: worn apart from carried - the slots the world named, in
       the order it named them. */
    if (((gr.modules || {}).equipment) && run.equip && Object.keys(run.equip).length) {
      var eqOut = [];
      equipmentSlots(world).forEach(function (s) {
        if (run.equip[s]) eqOut.push(run.equip[s] + ' (' + s + ')');
      });
      if (eqOut.length) out.push('Equipped: ' + eqOut.join('; '));
    }
    /* v1.34.0: what ails the player, and the floor that outranks every
       other number on the sheet. */
    if (((gr.modules || {}).conditions) && (run.conditions || []).length) {
      out.push('Conditions: ' + run.conditions.join('; '));
    }
    if (run.downed && vital) {
      out.push('The player is downed - the next scene begins from consequences, ' +
        'not game over. Take their agency, never their story.');
    }
    /* v1.33.0: standing bleeds into the scene - who you are to the powers
       that be, and what the world itself is working toward. */
    if ((run.reputation || []).length) {
      out.push('Standing: ' + run.reputation.slice(0, 4).map(function (r) {
        var f = faction(world, r.factionId);
        return (f ? f.name : r.factionId) + ' ' +
          ((r.score || 0) >= 0 ? '+' : '') + (r.score || 0);
      }).join('; '));
    }
    var ahead = goalAhead(world, run);
    if (ahead) out.push(ahead);
    return out.join('\n');
  }

  /**
   * Build the messages for one turn.
   * Returns { system, messages }.
   */
  function buildPrompt(world, run, input) {
    var gr = world.gameRules || {};
    var sb = world.sandboxConfig || {};

    var parts = [];
    if (world.dmPrompt) parts.push(world.dmPrompt);
    else parts.push('You are the referee for this world. Narrate what happens, ' +
      'play everyone who is not the player, and keep the world consistent.');
    if (world.description) parts.push('The world: ' + world.description);
    if (world.authorNote) parts.push(world.authorNote);
    if (run.lifeName) parts.push('The player begins as: ' + run.lifeName + '.');
    if (sb.principles && sb.enabled !== false) parts.push('How the world moves: ' + sb.principles);

    parts.push(describeLocation(world, run));
    parts.push(describeState(world, run));

    /* v1.33.0: on a pulse turn the world breathes - one line of off-screen
       momentum the referee weaves in as texture, not a ticker-tape. */
    if (pulseDue(world, run)) {
      var beat = worldBeat(world, run);
      if (beat) parts.push('Off-screen, the world has moved: ' + beat +
        ' Let this color the background of the next scene - footsteps in ' +
        'another corridor, word that travels - without stopping the current one.');
    }

    /* v1.24.0: the party - who is with the player, and therefore what they
       have witnessed. This is what stops two men who went to the elder with
       you both coming home and asking what the elder said. */
    if ((run.companions || []).length) {
      parts.push(
        'Companions - with the player right now:\n' +
        run.companions.map(function (c) {
          var at = location(world, c.at);
          return '- ' + c.name + (at ? ' (joined at ' + at.name + ', turn ' + (c.since || 0) + ')' : '');
        }).join('\n') +
        '\nThey have witnessed every scene since they joined: never have a companion ask about, or be surprised by, anything they were present for. Keep their voices distinct, and let at most one of them ask the obvious question.'
      );
    }

    /* v1.36.0: the story remembers itself in prose - marked as memory, so
       nothing mistakes a summary for the ledger above it. */
    if (run.memory && (run.memory.summary || (run.memory.facts || []).length)) {
      var memPart = 'Story memory - what the past scenes established in prose ' +
        '(the ledger above outranks it):\n';
      if (run.memory.summary) memPart += 'Story so far: ' + run.memory.summary + '\n';
      if ((run.memory.facts || []).length) {
        memPart += 'Established facts:\n' +
          run.memory.facts.map(function (f) { return '- ' + f; }).join('\n');
      }
      parts.push(memPart);
    }

    /* v1.36.0: lore surfaces when it comes up - and "coming up" includes
       what the referee just said, not only what the player types this
       line. A hit also lingers a couple of turns (loreFired), so a
       conversation can chase a fact without every line re-uttering the
       keyword; the byte budget stays the ceiling either way. */
    var loreWindow = [String(input || '')];
    (run.log || []).slice(-2).forEach(function (m) {
      if (m && (m.role === 'user' || m.role === 'assistant')) loreWindow.push(m.content);
    });
    var hits = loreHits(world, run, loreWindow.join('\n\n'));
    var fired = run.loreFired;
    if (!fired || typeof fired !== 'object') fired = run.loreFired = {};
    var loreIds = (world.lorebook || []).map(function (e, i) { return e.id || ('i' + i); });
    hits.forEach(function (e) {
      fired[loreIds[(world.lorebook || []).indexOf(e)]] = run.turn || 0;
    });
    Object.keys(fired).forEach(function (k) {
      if ((run.turn || 0) - fired[k] > 3) delete fired[k];   /* warm memories expire */
    });
    if ((world.lorebook || []).length) {
      var hitSet = {};
      hits.forEach(function (e) { hitSet[loreIds[(world.lorebook || []).indexOf(e)]] = true; });
      var bytes = hits.reduce(function (n, e) { return n + String(e.text || '').length; }, 0);
      var sticky = 0;
      (world.lorebook || []).forEach(function (e, i) {
        if (sticky >= 2) return;
        var warm = (run.turn || 0) - (fired[loreIds[i]] === undefined ? -99 : fired[loreIds[i]]);
        if (!hitSet[loreIds[i]] && warm >= 1 && warm <= 2 &&
            bytes + String(e.text || '').length <= 1536) {
          hits.push(e);
          hitSet[loreIds[i]] = true;
          bytes += String(e.text || '').length;
          sticky++;
        }
      });
    }
    if (hits.length) {
      parts.push('Established lore:\n' + hits.map(function (e) { return '- ' + e.text; }).join('\n'));
    }

    var rules =
      'Rules:\n' +
      '- Reply in prose, in second person, at most a few paragraphs.\n' +
      '- Never speak for the player or decide what they feel.\n' +
      '- Move them only through a place listed as reachable from where they are.\n' +
      '- End your reply with tags on their own line so the world can keep score:\n' +
      '  [[move:LOCATION_ID]] [[clock:+MINUTES]] [[cash:+N]] [[stat:ID:+N]]\n' +
      '  [[item:THING]] [[drop:THING]] [[quest:TASK]] [[quest-done:TASK]] [[roll:2d6+1]]\n' +
        '  [[with:NAME]] [[part:NAME]] [[rep:FACTION:+N]]' +
      (((world.gameRules || {}).modules || {}).conditions
        ? ' [[condition:NAME]] [[clear:NAME]]' : '') +
      (((world.gameRules || {}).modules || {}).equipment
        ? ' [[equip:SLOT:ITEM]] [[unequip:SLOT]]' : '') + '\n' +
      '- Only include a tag when something actually changed.\n' +
      /* v1.30.2: some models echo the state block back into the story - the
         observed dump was the Time/Stats/Money/Carrying block, verbatim,
         appended to a scene. The block is THEIR bookkeeping, not the story. */
      '- The state given above (Time / Stats / Money / Carrying / Tasks) is for ' +
        'your own record-keeping. NEVER repeat, paste, or restate it in your ' +
        'reply - the player has the sheet for that. Your reply is the scene ' +
        'only, plus the tags it needs.\n' +
      /* v1.30.3: OOC notes are a direct instruction to the referee, not
         in-fiction speech - time-skips, house rules, corrections. */
      '- If the player writes an OOC note (OOC:, [ooc], (ooc)), treat it as a ' +
        'direct instruction to you the referee, not in-fiction speech: carry it ' +
        'out (a time-skip, a house rule, a correction), continue the scene from ' +
        'the new state, and never narrate the OOC itself in-fiction.\n' +
      '- Location ids for this world: ' + locationIdLine(world, run);
    /* v1.30.4: what the two party tags mean, told to every world in prose.
       It used to ride on the grammar line as a note ("- who is with the
       player") and models copied the note into their replies. */
    rules += '\n- Party: tag [[with:NAME]] when an NPC joins the player and ' +
      '[[part:NAME]] when they part ways - one name per tag, names exactly ' +
      'as listed in this world. Companions know everything they have ' +
      'witnessed; never have one of them ask about a scene they were in.';
    if (ledgerV2(world)) {
      rules += '\n- The world checks your tags: an impossible move, an out-of-bounds ' +
        'change, an item the world has no record of, or a task it does not know is ' +
        'rejected and reported back to you with the reason. Keep changes real and ' +
        'small (at most ' + statBound(world) + ' to any stat or the purse per turn).';
      if (world.factions && world.factions.length) {
        rules += '\n- When a faction\u2019s opinion of the player shifts by deed, tag ' +
          '[[rep:FACTION:+N]] with the faction\u2019s id (' +
          world.factions.map(function (f) { return f.id; }).slice(0, 6).join(', ') +
          (world.factions.length > 6 ? ' \u2026' : '') + '). The sheet keeps the score; ' +
          'do not narrate numbers - show the shift in how people treat the player.';
      }
      var reg = itemNames(world);
      if (reg) {
        var names = Object.keys(reg).map(function (k) { return reg[k]; });
        rules += '\n- Items the world has: ' + names.slice(0, 25).join(', ') +
          (names.length > 25 ? ' \u2026' : '') + '. Only take or drop these.';
      }
      var regQ = questRegistry(world);
      if (regQ && regQ.length) {
        rules += '\n- Tasks the world knows: ' +
          regQ.map(questText).slice(0, 20).join('; ') + '.';
      }
      var checks = (world.gameRules || {}).checks;
      if (Array.isArray(checks) && checks.length) {
        rules += '\n- Checks the world resolves:';
        checks.slice(0, 10).forEach(function (c) {
          var label = String(c.name || c.stat || '?');
          var dc = (typeof c.dc === 'number') ? c.dc : 10;
          var line = '  ' + label + ' (DC ' + dc + ')';
          var sum = effectSummary(world, parseBranchEffects(world, c.on_success));
          var flo = effectSummary(world, parseBranchEffects(world, c.on_failure));
          if (sum.length) line += ', on success: ' + sum.join('; ');
          if (flo.length) line += ', on failure: ' + flo.join('; ');
          rules += '\n' + line + '.';
        });
        rules += '\n  Request one with [[roll:SPEC:check:NAME]]. The world rolls it ' +
          'and applies the outcome itself - never narrate or guess a check ' +
          'outcome, and request each check at most once per reply.' +
          /* v1.34.0: the table's own fallback difficulty, told once */
          ' A check that declares no DC runs at ' + defaultDifficulty(world) + '.';
      }
    }
    parts.push(rules);

    var messages = [];
    /* correction notes are for the player, not the referee's context -
       the corrected state itself is in the system prompt */
    var log = (run.log || []).filter(function (m) { return m.role !== 'correction'; }).slice(-12);
    /* v1.30.4: a reply stored before the cleanup still carries the copied
       note - keep the model from reading it as a pattern to repeat. The
       player's own lines are never touched. */
    log.forEach(function (m) {
      messages.push({
        role: m.role,
        content: m.role === 'assistant' ? stripTagArtifacts(m.content) : m.content
      });
    });
    messages.push({ role: 'user', content: input });

    return { system: parts.join('\n\n'), messages: messages };
  }

  /** Advance the turn counter and record the exchange.
   *  Idempotent on the player's line: the app pushes the user message
   *  optimistically (so it is visible during the wait) and commit must not
   *  write it a second time. Rejections from the applied turn are kept on
   *  the run (capped) so the HUD can show what the world refused. */
  function commit(run, userText, reply, applied) {
    var last = (run.log || [])[run.log.length - 1];
    if (!last || last.role !== 'user' || last.content !== userText) {
      run.log.push({ role: 'user', content: userText, at: Date.now() });
    }
    run.log.push({ role: 'assistant', content: applied.text, at: Date.now() });
    if (run.log.length > 200) run.log = run.log.slice(-200);
    run.turn = (run.turn || 0) + 1;
    run.updatedAt = Date.now();
    if (applied && applied.rejections && applied.rejections.length) {
      run.rejections = (run.rejections || []).concat(applied.rejections.map(function (r) {
        return { turn: run.turn, tag: r.tag, reason: r.reason, at: r.at };
      }));
      if (run.rejections.length > 50) run.rejections = run.rejections.slice(-50);
    }
    if (applied && applied.advisories && applied.advisories.length) {
      run.advisories = (run.advisories || []).concat(applied.advisories.map(function (a) {
        return { turn: run.turn, claim: a.claim, note: a.note, at: a.at };
      }));
      if (run.advisories.length > 50) run.advisories = run.advisories.slice(-50);
    }
    return run;
  }

  /** v1.29.1 — a deep copy of a run. Runs are plain JSON (the old Android
   *  WebViews have no structuredClone), so a parse/stringify round trip is
   *  an exact copy: every mutable field — seed, turn, extraMinutes,
   *  location, stats, inventory, tasks, companions, log, rejections —
   *  comes along. The turn transaction judges candidates on copies like
   *  this, so the live run stays exactly as it was until one final
   *  answer is validated. */
  function cloneRun(run) { return JSON.parse(JSON.stringify(run)); }

  /* ---------------- v1.29.1: validating a reply before it is a turn ---- */

  /** A planning trailer the thinking filter can miss: a scene, then the
   *  model's own quality check and sign-off. Deliberately narrow — a story
   *  line merely CONTAINING these words is prose; only a line that STARTS
   *  with one is planning. */
  var TRAILER_LINE = /(^|\n)\s*(?:self[- ]correction\s+check|self[- ]check\s*:|ready\s+to\s+output)\b/im;

  function wordTokens(t) {
    return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(function (w) { return w.length > 1; });
  }

  /** How much of the reference text's vocabulary the candidate is built
   *  out of. ~1.0 = the candidate is the reference (dressed up or not).
   *  A short reference can't be "echoed" meaningfully, so ignore it. */
  function echoOf(candidate, reference) {
    var rt = wordTokens(reference);
    if (rt.length < 12) return false;
    var ct = {};
    wordTokens(candidate).forEach(function (w) { ct[w] = true; });
    var hit = 0;
    rt.forEach(function (w) { if (ct[w]) hit++; });
    return hit / rt.length >= 0.8;
  }

  /** v1.29.1 — is this reply even a world turn? Runs BEFORE any tag is
   *  parsed: a code block is not narration, a planning trailer is not a
   *  scene, an empty answer is not a turn, and a near-verbatim repeat of
   *  the opening (or of the referee's own last line) is not an answer.
   *  The reasons are safe to show the player — no raw tags in them. */
  function validateReply(world, run, playerText, raw) {
    var out = { ok: true, reasons: [], text: String(raw || '').trim() };
    var t = out.text;
    if (!t) { out.ok = false; out.reasons.push('the reply is empty'); return out; }
    if (/```|~~~/.test(t)) {
      out.ok = false; out.reasons.push('the reply contains a code block'); return out;
    }
    if (TRAILER_LINE.test(t)) {
      out.ok = false; out.reasons.push('the reply ends in planning notes, not the scene'); return out;
    }
    /* the scene with the bookkeeping out */
    var prose = t.replace(TAG, '').replace(/\s+/g, ' ').trim();
    if (prose.length < 8) {
      out.ok = false; out.reasons.push('the reply has no actual scene in it'); return out;
    }
    var lastAssistant = null;
    (run.log || []).slice().reverse().forEach(function (m) {
      if (!lastAssistant && m.role === 'assistant') lastAssistant = m;
    });
    var ref = (run.turn === 0 && world.intro) ? world.intro
      : (lastAssistant ? lastAssistant.content : '');
    if (ref && echoOf(prose, ref)) {
      out.ok = false;
      out.reasons.push(run.turn === 0
        ? 'the reply repeats the opening instead of answering'
        : 'the reply repeats the last answer instead of going on');
      return out;
    }
    return out;
  }

  /** v1.29.1 — the checks a reply requested, checked BEFORE anything is
   *  committed: a turn that asks for a check the world has no definition
   *  for must not settle half and then fail. Same dedupe as resolveChecks:
   *  one per name per turn. Returns rejection-shaped entries. */
  function preflightChecks(world, applied) {
    var out = [];
    var seen = {};
    ((applied && applied.checkRequests) || []).forEach(function (req) {
      if (seen[req.name.toLowerCase()]) return;
      seen[req.name.toLowerCase()] = true;
      if (!checkDef(world, req.name)) {
        out.push({
          tag: '[[roll:' + req.spec + ':check:' + req.name + ']]',
          reason: 'the world has no check named \u201C' + req.name + '\u201D',
          at: Date.now()
        });
      }
    });
    return out;
  }

  /** Worlds that came with the install but have not been added yet. */
  function bundled() {
    return fetch('worlds/authored.json').then(function (r) {
      if (!r.ok) return [];
      return r.json().then(function (d) { return d.worlds || []; });
    }).catch(function () { return []; });
  }

  /** Add one of those to the library. Idempotent, keyed on the catalogue id. */
  function installBundled(id) {
    return bundled().then(function (list) {
      var entry = null;
      (list || []).forEach(function (e) { if (e.id === id) entry = e; });
      if (!entry) throw new Error('That world is not in this build');
      return fetch('worlds/' + entry.file).then(function (r) {
        if (!r.ok) throw new Error('That world did not come with this install');
        return r.json();
      }).then(function (raw) {
        var w = parse(raw);
        if (!w) throw new Error('That world file is damaged');
        w.id = entry.id;              // match the catalogue so it is not offered twice
        if (entry.attribution) w.attribution = entry.attribution;
        return save(w);
      });
    });
  }

  /** v1.35.0: a look inside a catalogue world without installing it -
   *  the same fetch and parse installBundled walks, minus the save. */
  function peekBundled(id) {
    return bundled().then(function (list) {
      var entry = null;
      (list || []).forEach(function (e) { if (e.id === id) entry = e; });
      if (!entry) throw new Error('That world is not in this build');
      return fetch('worlds/' + entry.file).then(function (r) {
        if (!r.ok) throw new Error('That world did not come with this install');
        return r.json();
      }).then(function (raw) {
        var w = parse(raw);
        if (!w) throw new Error('That world file is damaged');
        return w;
      });
    });
  }

  var HW = {
    parse: parse,
    assemble: assemble,
    summarise: summarise,
    save: save, all: all, get: get, remove: remove,
    saveRun: saveRun, allRuns: allRuns, removeRun: removeRun,
    location: location, exits: exits, npcsAt: npcsAt, faction: faction,
    loreHits: loreHits, relationshipsFor: relationshipsFor,
    roll: roll, clockOf: clockOf, start: start,
    bundled: bundled, installBundled: installBundled,
    applyTags: applyTags, buildPrompt: buildPrompt, commit: commit,
    stripTagArtifacts: stripTagArtifacts,
    /* v1.32.0: testable seams for the world-the-player-is-looking-at */
    scheduleActiveAt: scheduleActiveAt, npcPlaceAt: npcPlaceAt,
    entityById: entityById, seasonText: seasonText,
    locationIdLine: locationIdLine, synopsis: synopsis, metNpc: metNpc,
    /* v1.33.0: the pulse and the goal needle, testable on their own */
    pulseInterval: pulseInterval, pulseDue: pulseDue,
    worldBeat: worldBeat, goalAhead: goalAhead,
    ledgerV2: ledgerV2, reachable: reachable, correctState: correctState,
    normalizeRun: normalizeRun, cloneRun: cloneRun,
    validateReply: validateReply, preflightChecks: preflightChecks,
    resolveChecks: resolveChecks, checkDef: checkDef,
    parseCheckRequest: parseCheckRequest, nextRand: nextRand,
    loreVisible: loreVisible, loreScore: loreScore, questReached: questReached,
    secretLines: secretLines,
    auditClaims: auditClaims,
    /* v1.34.0: the dice table and the health floor, testable directly
       instead of through the prompt */
    defaultDifficulty: defaultDifficulty, statRollMod: statRollMod,
    criticalOutcome: criticalOutcome, vitalStat: vitalStat, syncDowned: syncDowned,
    /* v1.35.0: worn things, and a peephole into the catalogue */
    equipmentSlots: equipmentSlots, peekBundled: peekBundled,
    /* v1.36.0: the memory cadence and its write-side, testable without
       a model in the room */
    memoryDue: memoryDue, applyMemory: applyMemory,
    /* tests inject a store; the app uses IDB directly */
    _useStore: function (s) { store = s; }
  };

  global.HW = HW;
})(typeof window !== 'undefined' ? window : globalThis);
