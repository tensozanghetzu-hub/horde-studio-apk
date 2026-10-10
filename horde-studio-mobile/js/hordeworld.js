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

  var MEDIA_KEYS = ['banner', 'mediaAssets', '_mediaManifest', 'visuals', 'presentation'];

  /* ---------------- import ---------------- */

  /** Join the three bounded AI-draft parts (places, people, rules) into one
   *  .horde_world-shaped object ready for parse(). Each part is the plain
   *  JSON of one model request; missing parts degrade to parse's defaults,
   *  so a partially drafted world can still be inspected instead of lost. */
  function assemble(parts) {
    parts = parts || {};
    var a = parts.places || {}, b = parts.people || {}, c = parts.rules || {};
    var w = { _format: 'horde-world' };
    ['name', 'description', 'startLocationId', 'locations',
     'entities', 'factions', 'relationships',
     'dmPrompt', 'intro', 'authorNote', 'startingLives', 'gameRules', 'hudConfig'
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
      /* anything still carrying a data: URI is art, not content */
      if (typeof raw[k] === 'string' && raw[k].indexOf('data:') === 0) return;
      w[k] = raw[k];
    });

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
        /* v1.19.0: when this entity's secret truth becomes discoverable */
        secretUnlock: e.secretUnlock || null
      };
    });
    w.factions = w.factions || [];
    w.relationships = w.relationships || [];
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

  function npcsAt(world, locationId) {
    return (world.entities || []).filter(function (e) {
      if (e.type && e.type !== 'npc') return false;
      return e.startLocation === locationId || e.homeLocation === locationId;
    });
  }

  /** v1.24.0: the names the party ledger accepts - every NPC, canonical spelling. */
  function npcNames(world) {
    return (world.entities || []).filter(function (e) {
      return !e.type || e.type === 'npc';
    }).map(function (e) { return e.name; }).filter(Boolean);
  }

  function faction(world, id) {
    var f = (world && world.factions) || [];
    for (var i = 0; i < f.length; i++) if (f[i].id === id) return f[i];
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
      var dc = (typeof def.dc === 'number') ? def.dc : 10;
      var success = r.total >= dc;
      var eff = applyCheckEffects(run, world, success ? def.on_success : def.on_failure);
      var label = String(def.name || def.stat || req.name);
      var line = label + ' check: ' + r.text + ' vs DC ' + dc +
        (success ? ' \u2014 success' : ' \u2014 failure') + (eff.length ? ' (' + eff.join('; ') + ')' : '');
      run.log.push({ role: 'check', content: line, at: Date.now() });
      if (run.log.length > 200) run.log = run.log.slice(-200);
      list.push({
        name: label, text: line, chip: label + ' ' + r.total + ' vs ' + dc + (success ? ' \u2713' : ' \u2717'),
        success: success, total: r.total, dc: dc
      });
      changes.push(list[list.length - 1].chip);
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

    var cashId = (world.gameRules || {}).currencyStatId || 'cash';
    if (stats[cashId] === undefined) stats[cashId] = 0;

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
      quests: [],
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
        run.stats[run.cashId] = (run.stats[run.cashId] || 0) + num;
        changes.push((num >= 0 ? '+' : '') + num + ' ' + ((world.gameRules || {}).currencyName || 'cash'));
        return '';
      }
      if (kind === 'stat') {
        var bits = arg.split(':');
        if (bits.length < 2) { if (v2) reject(whole, 'expected STAT:+NUMBER'); return ''; }
        var sid = bits[0].trim(), delta = parseFloat(bits[1]);
        if (isNaN(delta)) { if (v2) reject(whole, 'a stat change must end in a number'); return ''; }
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
        run.inventory.push(arg);
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
      /* unknown tag: leave it, so a typo is visible rather than silently eaten */
      return whole;
    });

    return {
      text: out.replace(/\n{3,}/g, '\n\n').trim(),
      changes: changes, moved: moved, rolled: rolled, rejections: rejections,
      checkRequests: checkRequests
    };
  }

  /* ---------------- the player correcting the ledger ---------------- */

  /** v1.17.0: the player sets the ledger straight by hand. Every corr field
   *  is optional; returns the list of human-readable changes (empty when
   *  nothing was actually changed). The caller records the entry and saves. */
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
      run.inventory.push(corr.addInventory);
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
            else note = 'no move tag recorded';
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
          else note = 'no move tag recorded';
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

    var ex = exits(world, l.id).filter(function (e) { return e.to; });
    if (ex.length) {
      out.push('From here you can go: ' + ex.map(function (e) {
        return e.label + (e.minutes !== null ? ' (' + e.minutes + ' min)' : '');
      }).join(', ') + '.');
    }
    var here = npcsAt(world, l.id);
    if (here.length) {
      out.push('Present: ' + here.map(function (n) {
        return n.name + (n.isMajor ? '' : '');
      }).join(', ') + '.');
      here.forEach(function (n) {
        if (n.persona) out.push('- ' + n.name + ': ' + n.persona);
        if (n.goal) out.push('  ' + n.name + ' wants: ' + n.goal);
        secretLines(world, run, n).forEach(function (s) { out.push('  ' + s); });
      });
    }
    return out.join('\n');
  }

  function describeState(world, run) {
    var hud = world.hudConfig || {}, gr = world.gameRules || {};
    var out = [];
    if (hud.showClock !== false) out.push('Time: ' + clockOf(run, hud).text);

    var statLines = [];
    (hud.stats || []).forEach(function (s) {
      var v = run.stats[s.id];
      if (v === undefined) return;
      statLines.push(s.name + ' ' + v + (s.max !== undefined ? '/' + s.max : ''));
    });
    if (statLines.length) out.push('Stats: ' + statLines.join(', '));

    if ((gr.modules || {}).commerce !== false && run.stats[run.cashId] !== undefined) {
      out.push('Money: ' + run.stats[run.cashId] + ' ' + (gr.currencyName || 'cash'));
    }
    if ((gr.modules || {}).inventory !== false && run.inventory.length) {
      out.push('Carrying: ' + run.inventory.join(', '));
    }
    if ((gr.modules || {}).quests !== false) {
      var open = run.quests.filter(function (q) { return !q.done; });
      if (open.length) out.push('Tasks: ' + open.map(function (q) { return q.text; }).join('; '));
    }
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

    /* lore that the player's situation may know and the player just
       mentioned - scored, gated, budgeted (v1.19.0) */
    var hits = loreHits(world, run, input);
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
      '  [[with:NAME]] [[part:NAME]] - who is with the player\n' +
      '- Only include a tag when something actually changed.\n' +
      '- Location ids for this world: ' +
        (world.locations || []).map(function (l) { return l.id; }).join(', ');
    if (ledgerV2(world)) {
      rules += '\n- The world checks your tags: an impossible move, an out-of-bounds ' +
        'change, an item the world has no record of, or a task it does not know is ' +
        'rejected and reported back to you with the reason. Keep changes real and ' +
        'small (at most ' + statBound(world) + ' to any stat or the purse per turn).';
      rules += '\n- Party: tag [[with:NAME]] when an NPC joins the player and ' +
        '[[part:NAME]] when they part ways - one name per tag, names exactly as ' +
        'listed in this world. Companions know everything they have witnessed; ' +
        'never have one of them ask about a scene they were in.';
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
          'outcome, and request each check at most once per reply.';
      }
    }
    parts.push(rules);

    var messages = [];
    /* correction notes are for the player, not the referee's context -
       the corrected state itself is in the system prompt */
    var log = (run.log || []).filter(function (m) { return m.role !== 'correction'; }).slice(-12);
    log.forEach(function (m) { messages.push({ role: m.role, content: m.content }); });
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
    ledgerV2: ledgerV2, reachable: reachable, correctState: correctState,
    resolveChecks: resolveChecks, checkDef: checkDef,
    parseCheckRequest: parseCheckRequest, nextRand: nextRand,
    loreVisible: loreVisible, loreScore: loreScore, questReached: questReached,
    secretLines: secretLines,
    auditClaims: auditClaims,
    /* tests inject a store; the app uses IDB directly */
    _useStore: function (s) { store = s; }
  };

  global.HW = HW;
})(typeof window !== 'undefined' ? window : globalThis);
