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
        goal: e.goal || '', secrets: e.secrets || ''
      };
    });
    w.factions = w.factions || [];
    w.relationships = w.relationships || [];
    w.lorebook = (w.lorebook || []).map(function (l) {
      return { id: l.id, keyword: l.keyword || '', text: l.text || '' };
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

  function faction(world, id) {
    var f = (world && world.factions) || [];
    for (var i = 0; i < f.length; i++) if (f[i].id === id) return f[i];
    return null;
  }

  /** Lorebook entries whose keywords appear in the text. */
  function loreHits(world, text, limit) {
    var t = String(text || '').toLowerCase();
    if (!t.trim()) return [];
    return (world.lorebook || []).filter(function (e) {
      return String(e.keyword || '').split(',').some(function (k) {
        k = String(k).trim().toLowerCase();
        return k.length > 2 && t.indexOf(k) !== -1;
      });
    }).slice(0, limit || 6);
  }

  function relationshipsFor(world, entityId) {
    return (world.relationships || []).filter(function (r) {
      return r.a === entityId || r.b === entityId;
    });
  }

  /* ---------------- dice ---------------- */

  /** "2d6+3", "1d20-1", "d20" -> { total, rolls, text } */
  function roll(spec, defaultSides) {
    var m = /^\s*(?:(\d*)\s*)d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(spec || ''));
    if (!m) return null;
    var count = m[1] === '' || m[1] === undefined ? 1 : parseInt(m[1], 10);
    var sides = parseInt(m[2], 10) || defaultSides || 20;
    var sign = m[3] || '+';
    var mod = m[4] ? parseInt(m[4], 10) : 0;
    if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;

    var rolls = [], total = 0;
    for (var i = 0; i < count; i++) {
      var r = 1 + Math.floor(Math.random() * sides);
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
      stats: stats,
      cashId: cashId,
      inventory: (life && Array.isArray(life.inventory)) ? life.inventory.slice() : [],
      quests: [],
      reputation: (life && life.factionReputation !== undefined && life.factionId)
        ? [{ factionId: life.factionId, score: life.factionReputation }] : [],
      log: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  /* ---------------- the referee's reply ---------------- */

  var TAG = /\[\[([a-z_-]+)\s*:\s*([^\]]*)\]\]/gi;

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
    var changes = [], rejections = [], moved = null, rolled = null;
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
      if (kind === 'roll') {
        var r = roll(arg, (world.gameRules || {}).dice && (world.gameRules.dice.sides || 20));
        if (r) { rolled = r; changes.push(r.text); }
        else if (v2) reject(whole, 'malformed roll \u201C' + arg + '\u201D');
        return '';
      }
      /* unknown tag: leave it, so a typo is visible rather than silently eaten */
      return whole;
    });

    return {
      text: out.replace(/\n{3,}/g, '\n\n').trim(),
      changes: changes, moved: moved, rolled: rolled, rejections: rejections
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

    /* lore that the player just mentioned */
    var hits = loreHits(world, input);
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
      '- Only include a tag when something actually changed.\n' +
      '- Location ids for this world: ' +
        (world.locations || []).map(function (l) { return l.id; }).join(', ');
    if (ledgerV2(world)) {
      rules += '\n- The world checks your tags: an impossible move, an out-of-bounds ' +
        'change, an item the world has no record of, or a task it does not know is ' +
        'rejected and reported back to you with the reason. Keep changes real and ' +
        'small (at most ' + statBound(world) + ' to any stat or the purse per turn).';
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
    /* tests inject a store; the app uses IDB directly */
    _useStore: function (s) { store = s; }
  };

  global.HW = HW;
})(typeof window !== 'undefined' ? window : globalThis);
